package backend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"os"
	"path"
	"strings"
	"time"
)

type NetworkSource struct {
	ID       int64  `json:"id"`
	Kind     string `json:"kind"`
	URL      string `json:"url"`
	Username string `json:"username"`
}

type networkSourcePrivate struct {
	NetworkSource
	Password string
}

type remoteEntry struct {
	Key          string
	URL          string
	Size         int64
	ETag         string
	LastModified string
}

func validSourceURL(kind string, u *url.URL) bool {
	if u == nil || u.User != nil || u.Fragment != "" || u.Hostname() == "" {
		return false
	}
	switch kind {
	case "webdav":
		return validNetworkURL(u) && u.RawQuery == ""
	case "playlist":
		return validNetworkURL(u)
	case "ftp":
		return u.Scheme == "ftp" && u.RawQuery == ""
	case "ftps":
		return u.Scheme == "ftps" && u.RawQuery == ""
	}
	return false
}

func (s *Store) NetworkSources() ([]NetworkSource, error) {
	rows, err := s.DB.Query(`SELECT id,kind,url,username FROM network_sources ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	result := []NetworkSource{}
	for rows.Next() {
		var item NetworkSource
		if err = rows.Scan(&item.ID, &item.Kind, &item.URL, &item.Username); err != nil {
			return nil, err
		}
		if item.Kind == "playlist" {
			u, _ := url.Parse(item.URL)
			u.RawQuery = ""
			item.URL = u.String()
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Store) privateNetworkSource(id int64) (networkSourcePrivate, error) {
	var item networkSourcePrivate
	var secret []byte
	err := s.DB.QueryRow(`SELECT id,kind,url,username,secret FROM network_sources WHERE id=?`, id).Scan(&item.ID, &item.Kind, &item.URL, &item.Username, &secret)
	if err != nil {
		return item, err
	}
	item.Password, err = unprotectNetworkSecret(secret)
	return item, err
}

func (s *Store) AddNetworkSource(ctx context.Context, kind, target, username, password string) (NetworkSource, ScanResult, error) {
	target = strings.TrimSpace(target)
	u, err := url.Parse(target)
	if err != nil || !validSourceURL(kind, u) {
		return NetworkSource{}, ScanResult{}, errors.New("网络来源地址或类型无效")
	}
	if kind == "playlist" && (username != "" || password != "") {
		return NetworkSource{}, ScanResult{}, errors.New("HTTP 清单暂不支持身份验证")
	}
	if password != "" && username == "" {
		return NetworkSource{}, ScanResult{}, errors.New("填写密码时也需要用户名")
	}
	if kind == "webdav" && !strings.HasSuffix(u.Path, "/") {
		u.Path += "/"
		u.RawPath = ""
	}
	if len(username) > 256 || len(password) > 1024 || len(target) > 2048 {
		return NetworkSource{}, ScanResult{}, errors.New("网络来源信息过长")
	}
	item := networkSourcePrivate{NetworkSource: NetworkSource{Kind: kind, URL: u.String(), Username: username}, Password: password}
	ctx, cancel := context.WithTimeout(ctx, 2*time.Minute)
	defer cancel()
	entries, err := listNetworkSource(ctx, item)
	if err != nil {
		return NetworkSource{}, ScanResult{}, err
	}
	secret, err := protectNetworkSecret(password)
	if err != nil {
		return NetworkSource{}, ScanResult{}, err
	}
	if secret == nil {
		secret = []byte{}
	}
	_, err = s.DB.Exec(`INSERT INTO network_sources(kind,url,username,secret) VALUES(?,?,?,?) ON CONFLICT(kind,url) DO UPDATE SET username=excluded.username,secret=excluded.secret`, kind, u.String(), username, secret)
	if err != nil {
		return NetworkSource{}, ScanResult{}, err
	}
	err = s.DB.QueryRow(`SELECT id FROM network_sources WHERE kind=? AND url=?`, kind, u.String()).Scan(&item.ID)
	if err != nil {
		return NetworkSource{}, ScanResult{}, err
	}
	scan, err := s.applyNetworkSource(item.ID, entries)
	if kind == "playlist" {
		publicURL := *u
		publicURL.RawQuery = ""
		item.URL = publicURL.String()
	}
	return item.NetworkSource, scan, err
}

func (s *Store) RemoveNetworkSource(id int64) error {
	rows, err := s.DB.Query(`SELECT track_id FROM network_tracks WHERE source_id=?`, id)
	if err != nil {
		return err
	}
	ids := []int64{}
	for rows.Next() {
		var trackID int64
		if err = rows.Scan(&trackID); err != nil {
			break
		}
		ids = append(ids, trackID)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM tracks WHERE id IN (SELECT track_id FROM network_tracks WHERE source_id=?)`, id); err != nil {
		return err
	}
	if _, err = tx.Exec(`DELETE FROM network_sources WHERE id=?`, id); err != nil {
		return err
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	s.networkMu.Lock()
	for _, trackID := range ids {
		delete(s.networkChecks, trackID)
		if cancel := s.networkCancel[trackID]; cancel != nil {
			cancel()
		}
		_ = os.Remove(s.networkCachePath(trackID))
	}
	s.networkMu.Unlock()
	return nil
}

func listNetworkSource(ctx context.Context, item networkSourcePrivate) ([]remoteEntry, error) {
	switch item.Kind {
	case "webdav":
		return listWebDAV(ctx, item)
	case "ftp", "ftps":
		return listFTP(ctx, item)
	case "playlist":
		return listHTTPPlaylist(ctx, item)
	}
	return nil, errors.New("不支持的网络来源")
}

func (s *Store) scanNetworkSources(ctx context.Context, result *ScanResult) error {
	sources, err := s.NetworkSources()
	if err != nil {
		return err
	}
	for _, source := range sources {
		if err = ctx.Err(); err != nil {
			return err
		}
		item, loadErr := s.privateNetworkSource(source.ID)
		if loadErr != nil {
			result.Errors = append(result.Errors, source.URL+": "+loadErr.Error())
			continue
		}
		scanCtx, cancel := context.WithTimeout(ctx, 2*time.Minute)
		entries, scanErr := listNetworkSource(scanCtx, item)
		cancel()
		if scanErr != nil {
			result.Errors = append(result.Errors, source.URL+": "+scanErr.Error())
			continue
		}
		part, applyErr := s.applyNetworkSource(source.ID, entries)
		if applyErr != nil {
			result.Errors = append(result.Errors, source.URL+": "+applyErr.Error())
			continue
		}
		result.Added += part.Added
		result.Updated += part.Updated
		result.Missing += part.Missing
		result.Folders++
	}
	return nil
}

func (s *Store) applyNetworkSource(sourceID int64, entries []remoteEntry) (ScanResult, error) {
	result := ScanResult{Errors: []string{}}
	seen := map[string]bool{}
	for _, entry := range entries {
		if seen[entry.Key] {
			continue
		}
		seen[entry.Key] = true
		hash := sha256.Sum256([]byte(fmt.Sprintf("%d\x00%s", sourceID, entry.Key)))
		key := "remote:" + hex.EncodeToString(hash[:])
		var id int64
		lookupErr := s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, key).Scan(&id)
		if lookupErr != nil && !errors.Is(lookupErr, sql.ErrNoRows) {
			return result, lookupErr
		}
		var old networkTrack
		if id != 0 {
			old, _ = s.networkTrack(id)
		}
		name := networkFileName(entry.URL)
		title := strings.TrimSuffix(name, path.Ext(name))
		if title == "" {
			title = "网络歌曲"
		}
		tx, err := s.DB.Begin()
		if err != nil {
			return result, err
		}
		_, err = tx.Exec(`INSERT INTO tracks(path,title,artist,album,cover,size,modified,available,added_at,tags_checked,playback_status,folder_imported) VALUES(?,?,?,?,'/covers/local.svg',?,0,1,?,1,?,1) ON CONFLICT(path) DO UPDATE SET available=1,size=excluded.size`, key, title, "未知歌手", "网络音乐", max(entry.Size, 0), time.Now().Unix(), playbackStatus(name))
		if err == nil {
			err = tx.QueryRow(`SELECT id FROM tracks WHERE path=?`, key).Scan(&id)
		}
		if err == nil {
			_, err = tx.Exec(`INSERT INTO network_tracks(track_id,url,etag,last_modified,size,content_type,source_id,remote_key) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(track_id) DO UPDATE SET url=excluded.url,etag=excluded.etag,last_modified=excluded.last_modified,size=excluded.size,source_id=excluded.source_id,remote_key=excluded.remote_key`, id, entry.URL, entry.ETag, entry.LastModified, max(entry.Size, 0), audioMIME(path.Ext(name)), sourceID, entry.Key)
		}
		if err != nil {
			tx.Rollback()
			return result, err
		}
		if err = tx.Commit(); err != nil {
			return result, err
		}
		if lookupErr == sql.ErrNoRows {
			result.Added++
		} else {
			result.Updated++
			if networkVersionChanged(old, entry.ETag, entry.LastModified, entry.Size) {
				s.networkMu.Lock()
				delete(s.networkChecks, id)
				if cancel := s.networkCancel[id]; cancel != nil {
					cancel()
				}
				_ = os.Remove(s.networkCachePath(id))
				s.networkMu.Unlock()
			}
		}
	}
	rows, err := s.DB.Query(`SELECT n.track_id,n.remote_key FROM network_tracks n WHERE n.source_id=?`, sourceID)
	if err != nil {
		return result, err
	}
	type oldEntry struct {
		id  int64
		key string
	}
	old := []oldEntry{}
	for rows.Next() {
		var item oldEntry
		if err = rows.Scan(&item.id, &item.key); err != nil {
			break
		}
		old = append(old, item)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return result, err
	}
	for _, item := range old {
		if seen[item.key] {
			continue
		}
		change, updateErr := s.DB.Exec(`UPDATE tracks SET available=0 WHERE id=? AND available=1`, item.id)
		if updateErr != nil {
			return result, updateErr
		}
		if count, _ := change.RowsAffected(); count > 0 {
			result.Missing++
		}
	}
	return result, nil
}
