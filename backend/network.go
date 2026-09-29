package backend

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

const maxNetworkAudioSize int64 = 512 << 20

var networkHTTP = &http.Client{
	Transport: &http.Transport{
		Proxy:                 http.ProxyFromEnvironment,
		DialContext:           (&net.Dialer{Timeout: 10 * time.Second, KeepAlive: 30 * time.Second}).DialContext,
		TLSHandshakeTimeout:   10 * time.Second,
		ResponseHeaderTimeout: 15 * time.Second,
		DisableCompression:    true,
	},
	CheckRedirect: func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !validNetworkURL(req.URL) || len(via) > 0 && via[0].URL.Scheme == "https" && req.URL.Scheme != "https" {
			return errors.New("invalid network redirect")
		}
		return nil
	},
}

func validNetworkURL(u *url.URL) bool {
	return u != nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && u.Fragment == ""
}

func networkRequest(ctx context.Context, method, target string, rangeHeader string) (*http.Response, error) {
	req, err := http.NewRequestWithContext(ctx, method, target, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Accept-Encoding", "identity")
	if rangeHeader != "" {
		req.Header.Set("Range", rangeHeader)
	}
	return networkHTTP.Do(req)
}

func networkSize(response *http.Response) int64 {
	if response.StatusCode == http.StatusPartialContent {
		if _, total, ok := strings.Cut(response.Header.Get("Content-Range"), "/"); ok {
			if size, err := strconv.ParseInt(total, 10, 64); err == nil {
				return size
			}
		}
	}
	return response.ContentLength
}

func networkFileName(target string) string {
	u, err := url.Parse(target)
	if err != nil {
		return "网络歌曲"
	}
	name, err := url.PathUnescape(path.Base(u.EscapedPath()))
	if err != nil || name == "" || name == "." || name == "/" {
		return "网络歌曲"
	}
	return name
}

func networkContentType(target, upstream string) string {
	if ext := strings.ToLower(path.Ext(networkFileName(target))); audioTypes[ext] {
		return audioMIME(ext)
	}
	if strings.HasPrefix(strings.ToLower(upstream), "audio/") {
		return upstream
	}
	return ""
}

func (s *Store) ImportNetwork(ctx context.Context, target string) (Track, error) {
	u, err := url.Parse(strings.TrimSpace(target))
	if err != nil || !validNetworkURL(u) {
		return Track{}, errors.New("请输入有效的 HTTP 或 HTTPS 音频文件地址")
	}
	ctx, cancel := context.WithTimeout(ctx, 20*time.Second)
	defer cancel()
	response, err := networkRequest(ctx, http.MethodGet, u.String(), "bytes=0-0")
	if err != nil {
		return Track{}, errors.New("无法连接网络音频")
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return Track{}, fmt.Errorf("网络音频返回状态 %d", response.StatusCode)
	}
	name := networkFileName(u.String())
	ext := strings.ToLower(path.Ext(name))
	contentType := strings.ToLower(response.Header.Get("Content-Type"))
	if strings.HasPrefix(contentType, "text/") || strings.Contains(contentType, "html") || !audioTypes[ext] && !strings.HasPrefix(contentType, "audio/") {
		return Track{}, errors.New("地址没有返回可识别的音频文件")
	}
	size := networkSize(response)
	if size > maxNetworkAudioSize {
		return Track{}, errors.New("网络音频超过 512 MB 限制")
	}
	hash := sha256.Sum256([]byte(u.String()))
	key := "remote:" + hex.EncodeToString(hash[:])
	var priorID int64
	_ = s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, key).Scan(&priorID)
	var prior networkTrack
	if priorID > 0 {
		prior, _ = s.networkTrack(priorID)
	}
	title := strings.TrimSuffix(name, path.Ext(name))
	if title == "" {
		title = "网络歌曲"
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return Track{}, err
	}
	defer tx.Rollback()
	_, err = tx.Exec(`INSERT INTO tracks(path,title,artist,album,cover,size,modified,available,added_at,tags_checked,playback_status) VALUES(?,?,?,?,'/covers/local.svg',?,?,1,?,1,?) ON CONFLICT(path) DO UPDATE SET available=1`, key, title, "未知歌手", "网络音乐", max(size, 0), int64(0), time.Now().Unix(), playbackStatus(name))
	if err != nil {
		return Track{}, err
	}
	var id int64
	if err = tx.QueryRow(`SELECT id FROM tracks WHERE path=?`, key).Scan(&id); err != nil {
		return Track{}, err
	}
	_, err = tx.Exec(`INSERT INTO network_tracks(track_id,url,content_type,etag,last_modified,size) VALUES(?,?,?,?,?,?) ON CONFLICT(track_id) DO UPDATE SET url=excluded.url,content_type=excluded.content_type,etag=excluded.etag,last_modified=excluded.last_modified,size=excluded.size`, id, u.String(), response.Header.Get("Content-Type"), response.Header.Get("ETag"), response.Header.Get("Last-Modified"), max(size, 0))
	if err != nil {
		return Track{}, err
	}
	if err = tx.Commit(); err != nil {
		return Track{}, err
	}
	if priorID > 0 && networkVersionChanged(prior, response.Header.Get("ETag"), response.Header.Get("Last-Modified"), size) {
		s.networkMu.Lock()
		delete(s.networkChecks, id)
		_ = os.Remove(s.networkCachePath(id))
		s.networkMu.Unlock()
	}
	return s.GetTrack(id)
}

type networkTrack struct {
	URL          string
	ContentType  string
	ETag         string
	LastModified string
	Size         int64
	SourceID     int64
}

func (s *Store) networkTrack(id int64) (networkTrack, error) {
	var item networkTrack
	err := s.DB.QueryRow(`SELECT url,content_type,etag,last_modified,size,COALESCE(source_id,0) FROM network_tracks WHERE track_id=?`, id).Scan(&item.URL, &item.ContentType, &item.ETag, &item.LastModified, &item.Size, &item.SourceID)
	return item, err
}

func (s *Store) networkRequestFor(ctx context.Context, item networkTrack, method, rangeHeader string) (*http.Response, error) {
	if item.SourceID == 0 {
		return networkRequest(ctx, method, item.URL, rangeHeader)
	}
	source, err := s.privateNetworkSource(item.SourceID)
	if err != nil {
		return nil, err
	}
	return sourceRequest(ctx, source, method, item.URL, rangeHeader, nil)
}

func (s *Store) decorateNetworkTrack(track *Track) error {
	if !strings.HasPrefix(track.Path, "remote:") {
		track.Kind = "local"
		return nil
	}
	item, err := s.networkTrack(track.ID)
	if err != nil {
		return err
	}
	track.Kind = "network"
	track.Path = ""
	track.FileName = networkFileName(item.URL)
	return nil
}

func (s *Store) networkCachePath(id int64) string {
	return filepath.Join(s.Root, "cache", "network-audio", formatID(id)+".audio")
}

func networkVersionChanged(old networkTrack, etag, lastModified string, size int64) bool {
	if old.ETag != "" && etag != "" {
		return old.ETag != etag
	}
	if old.LastModified != "" && lastModified != "" && old.LastModified != lastModified {
		return true
	}
	return old.Size > 0 && size > 0 && old.Size != size
}

func (s *Store) networkCacheVersionMatches(id int64, item networkTrack) bool {
	current, err := s.networkTrack(id)
	return err == nil && current.URL == item.URL && current.ETag == item.ETag && current.LastModified == item.LastModified && current.Size == item.Size
}

func (s *Store) hasValidNetworkCache(ctx context.Context, id int64, item networkTrack) bool {
	if info, err := os.Lstat(s.networkCachePath(id)); err != nil || !info.Mode().IsRegular() {
		return false
	}
	if item.SourceID != 0 && (strings.HasPrefix(item.URL, "ftp:") || strings.HasPrefix(item.URL, "ftps:")) {
		return true
	}
	s.networkMu.Lock()
	checked := s.networkChecks[id]
	s.networkMu.Unlock()
	if time.Since(checked) < 5*time.Minute {
		return true
	}
	probeCtx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	response, err := s.networkRequestFor(probeCtx, item, http.MethodHead, "")
	if err != nil {
		return true
	}
	response.Body.Close()
	if response.StatusCode == http.StatusMethodNotAllowed || response.StatusCode == http.StatusNotImplemented {
		response, err = s.networkRequestFor(probeCtx, item, http.MethodGet, "bytes=0-0")
		if err != nil {
			return true
		}
		response.Body.Close()
	}
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent {
		return true
	}
	if networkVersionChanged(item, response.Header.Get("ETag"), response.Header.Get("Last-Modified"), networkSize(response)) {
		s.networkMu.Lock()
		delete(s.networkChecks, id)
		_ = os.Remove(s.networkCachePath(id))
		s.networkMu.Unlock()
		_, _ = s.DB.Exec(`UPDATE network_tracks SET etag=?,last_modified=?,size=? WHERE track_id=?`, response.Header.Get("ETag"), response.Header.Get("Last-Modified"), max(networkSize(response), 0), id)
		return false
	}
	s.networkMu.Lock()
	s.networkChecks[id] = time.Now()
	s.networkMu.Unlock()
	return true
}

func (s *Store) ServeNetworkAudio(w http.ResponseWriter, r *http.Request, id int64) {
	item, err := s.networkTrack(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	if s.hasValidNetworkCache(r.Context(), id, item) {
		file, openErr := os.Open(s.networkCachePath(id))
		if openErr != nil {
			http.Error(w, "网络歌曲缓存不可用", http.StatusInternalServerError)
			return
		}
		defer file.Close()
		if info, statErr := file.Stat(); statErr == nil {
			w.Header().Set("Cache-Control", "no-store")
			contentType := networkContentType(item.URL, item.ContentType)
			if contentType == "" {
				http.Error(w, "网络地址没有返回音频", http.StatusBadGateway)
				return
			}
			w.Header().Set("Content-Type", contentType)
			w.Header().Set("X-Content-Type-Options", "nosniff")
			http.ServeContent(w, r, networkFileName(item.URL), info.ModTime(), file)
			return
		}
	}
	if strings.HasPrefix(item.URL, "ftp:") || strings.HasPrefix(item.URL, "ftps:") {
		s.serveFTPAudio(w, r, item)
		return
	}
	response, err := s.networkRequestFor(r.Context(), item, r.Method, r.Header.Get("Range"))
	if err != nil {
		http.Error(w, "网络音频暂不可用", http.StatusBadGateway)
		return
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusPartialContent && response.StatusCode != http.StatusRequestedRangeNotSatisfiable {
		http.Error(w, "网络音频暂不可用", http.StatusBadGateway)
		return
	}
	if response.StatusCode == http.StatusPartialContent && response.Header.Get("Content-Range") == "" {
		http.Error(w, "网络音频分段响应无效", http.StatusBadGateway)
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	contentType := networkContentType(item.URL, response.Header.Get("Content-Type"))
	if contentType == "" {
		http.Error(w, "网络地址没有返回音频", http.StatusBadGateway)
		return
	}
	w.Header().Set("Content-Type", contentType)
	w.Header().Set("X-Content-Type-Options", "nosniff")
	if r.Method == http.MethodGet && r.Header.Get("Range") != "" && response.StatusCode == http.StatusOK {
		if response.ContentLength > maxNetworkAudioSize {
			http.Error(w, "服务器不支持大文件分段读取", http.StatusBadGateway)
			return
		}
		file, err := os.CreateTemp(filepath.Join(s.Root, "cache", "network-audio"), ".range-*")
		if err != nil {
			http.Error(w, "无法暂存网络音频", http.StatusInternalServerError)
			return
		}
		defer os.Remove(file.Name())
		defer file.Close()
		written, copyErr := io.Copy(file, io.LimitReader(response.Body, maxNetworkAudioSize+1))
		if copyErr != nil || written > maxNetworkAudioSize || response.ContentLength >= 0 && written != response.ContentLength {
			http.Error(w, "网络音频下载不完整", http.StatusBadGateway)
			return
		}
		if _, err = file.Seek(0, io.SeekStart); err != nil {
			http.Error(w, "无法读取网络音频", http.StatusInternalServerError)
			return
		}
		http.ServeContent(w, r, networkFileName(item.URL), time.Time{}, file)
		return
	}
	for _, name := range []string{"Content-Length", "Content-Range", "Accept-Ranges", "ETag", "Last-Modified"} {
		if value := response.Header.Get(name); value != "" {
			w.Header().Set(name, value)
		}
	}
	w.WriteHeader(response.StatusCode)
	if r.Method != http.MethodHead {
		_, _ = io.Copy(w, response.Body)
	}
}

func (s *Store) scheduleNetworkCache(id int64) {
	settings, err := s.Settings()
	if err != nil || settings.NetworkCacheCount == 0 {
		return
	}
	item, err := s.networkTrack(id)
	if err != nil {
		return
	}
	if _, err = os.Stat(s.networkCachePath(id)); err == nil {
		_ = s.pruneNetworkCache(settings.NetworkCacheCount)
		return
	}
	s.networkMu.Lock()
	if s.networkClosed || s.networkJobs[id] {
		s.networkMu.Unlock()
		return
	}
	s.networkJobs[id] = true
	s.networkWG.Add(1)
	epoch := s.networkEpoch
	s.networkMu.Unlock()
	go func() {
		defer s.networkWG.Done()
		defer func() {
			s.networkMu.Lock()
			delete(s.networkJobs, id)
			delete(s.networkCancel, id)
			s.networkMu.Unlock()
		}()
		s.networkSlots <- struct{}{}
		defer func() { <-s.networkSlots }()
		s.networkMu.Lock()
		stale := epoch != s.networkEpoch
		s.networkMu.Unlock()
		if stale {
			return
		}
		ctx, cancel := context.WithTimeout(context.Background(), 10*time.Minute)
		defer cancel()
		s.networkMu.Lock()
		if epoch != s.networkEpoch {
			s.networkMu.Unlock()
			return
		}
		s.networkCancel[id] = cancel
		s.networkMu.Unlock()
		if strings.HasPrefix(item.URL, "ftp:") || strings.HasPrefix(item.URL, "ftps:") {
			s.cacheFTPAudio(ctx, id, item, epoch)
			return
		}
		response, err := s.networkRequestFor(ctx, item, http.MethodGet, "")
		if err != nil {
			return
		}
		defer response.Body.Close()
		if response.StatusCode != http.StatusOK || response.ContentLength > maxNetworkAudioSize {
			return
		}
		file, err := os.CreateTemp(filepath.Join(s.Root, "cache", "network-audio"), ".download-*")
		if err != nil {
			return
		}
		defer os.Remove(file.Name())
		written, err := io.Copy(file, io.LimitReader(response.Body, maxNetworkAudioSize+1))
		closeErr := file.Close()
		if err != nil || closeErr != nil || written > maxNetworkAudioSize || response.ContentLength >= 0 && written != response.ContentLength {
			return
		}
		s.networkMu.Lock()
		defer s.networkMu.Unlock()
		if epoch != s.networkEpoch || !s.networkCacheVersionMatches(id, item) {
			return
		}
		settings, err := s.Settings()
		if err != nil || settings.NetworkCacheCount == 0 {
			return
		}
		if err = os.Rename(file.Name(), s.networkCachePath(id)); err != nil {
			log.Printf("network cache save: %v", err)
			return
		}
		_, _ = s.DB.Exec(`UPDATE network_tracks SET content_type=?,etag=?,last_modified=?,size=? WHERE track_id=?`, response.Header.Get("Content-Type"), response.Header.Get("ETag"), response.Header.Get("Last-Modified"), written, id)
		s.networkChecks[id] = time.Now()
		if err = s.pruneNetworkCacheLocked(settings.NetworkCacheCount); err != nil {
			log.Printf("network cache prune: %v", err)
		}
	}()
}

func (s *Store) backfillNetworkCache(count int) error {
	rows, err := s.DB.Query(`SELECT n.track_id FROM network_tracks n JOIN history h ON h.track_id=n.track_id ORDER BY h.played_at DESC LIMIT ?`, count)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			break
		}
		ids = append(ids, id)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	for _, id := range ids {
		s.scheduleNetworkCache(id)
	}
	return nil
}

func (s *Store) pruneNetworkCache(count int) error {
	s.networkMu.Lock()
	defer s.networkMu.Unlock()
	return s.pruneNetworkCacheLocked(count)
}

func (s *Store) pruneNetworkCacheLocked(count int) error {
	if count == 0 {
		s.networkEpoch++
		for _, cancel := range s.networkCancel {
			cancel()
		}
	}
	rows, err := s.DB.Query(`SELECT n.track_id FROM network_tracks n JOIN history h ON h.track_id=n.track_id ORDER BY h.played_at DESC`)
	if err != nil {
		return err
	}
	keep := map[string]bool{}
	for rows.Next() {
		var id int64
		if err = rows.Scan(&id); err != nil {
			break
		}
		if len(keep) < count {
			keep[formatID(id)+".audio"] = true
		}
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	entries, err := os.ReadDir(filepath.Join(s.Root, "cache", "network-audio"))
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".audio") || keep[entry.Name()] {
			continue
		}
		if err = os.Remove(filepath.Join(s.Root, "cache", "network-audio", entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	}
	return nil
}

func (s *Store) ClearNetworkCache() (CacheStats, error) {
	s.networkMu.Lock()
	defer s.networkMu.Unlock()
	s.networkEpoch++
	for _, cancel := range s.networkCancel {
		cancel()
	}
	s.networkChecks = map[int64]time.Time{}
	entries, err := os.ReadDir(filepath.Join(s.Root, "cache", "network-audio"))
	if err != nil {
		return CacheStats{}, err
	}
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasSuffix(entry.Name(), ".audio") {
			continue
		}
		if err = os.Remove(filepath.Join(s.Root, "cache", "network-audio", entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return CacheStats{}, err
		}
	}
	return s.CacheStats()
}

func (s *Store) networkCacheSize() (int64, error) {
	entries, err := os.ReadDir(filepath.Join(s.Root, "cache", "network-audio"))
	if err != nil {
		return 0, err
	}
	var total int64
	for _, entry := range entries {
		if !strings.HasSuffix(entry.Name(), ".audio") || entry.IsDir() {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return 0, err
		}
		total += info.Size()
	}
	return total, nil
}
