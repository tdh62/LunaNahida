package backend

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
)

func connectFTP(ctx context.Context, item networkSourcePrivate) (*ftp.ServerConn, error) {
	u, _ := url.Parse(item.URL)
	port := "21"
	if u.Port() != "" {
		port = u.Port()
	}
	dialer := &net.Dialer{Timeout: 15 * time.Second}
	firstConnection := true
	tlsConfig := &tls.Config{ServerName: u.Hostname(), MinVersion: tls.VersionTLS12}
	options := []ftp.DialOption{ftp.DialWithDialFunc(func(network, address string) (net.Conn, error) {
		conn, err := dialer.DialContext(ctx, network, address)
		if err != nil {
			return nil, err
		}
		if deadline, ok := ctx.Deadline(); ok {
			_ = conn.SetDeadline(deadline)
		}
		go func() { <-ctx.Done(); _ = conn.Close() }()
		if item.Kind == "ftps" && !firstConnection {
			return tls.Client(conn, tlsConfig), nil
		}
		firstConnection = false
		return conn, nil
	})}
	if item.Kind == "ftps" {
		options = append(options, ftp.DialWithExplicitTLS(tlsConfig))
	}
	conn, err := ftp.Dial(net.JoinHostPort(u.Hostname(), port), options...)
	if err != nil {
		return nil, err
	}
	user := item.Username
	if user == "" {
		user = "anonymous"
	}
	if err = conn.Login(user, item.Password); err != nil {
		_ = conn.Quit()
		return nil, err
	}
	return conn, nil
}

func listFTP(ctx context.Context, item networkSourcePrivate) ([]remoteEntry, error) {
	conn, err := connectFTP(ctx, item)
	if err != nil {
		return nil, err
	}
	defer conn.Quit()
	u, _ := url.Parse(item.URL)
	root := path.Clean(u.Path)
	queue := []string{root}
	entries := []remoteEntry{}
	visited := map[string]bool{}
	for len(queue) > 0 {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if len(visited) > maxSourceEntries {
			return nil, errors.New("FTP 文件夹数量超过限制")
		}
		dir := queue[0]
		queue = queue[1:]
		if visited[dir] {
			continue
		}
		visited[dir] = true
		listed, listErr := conn.List(dir)
		if listErr != nil {
			return nil, listErr
		}
		for _, entry := range listed {
			if entry.Name == "." || entry.Name == ".." || strings.ContainsAny(entry.Name, `/\`) {
				continue
			}
			file := path.Join(dir, entry.Name)
			if file != root && !strings.HasPrefix(file, strings.TrimSuffix(root, "/")+"/") {
				return nil, errors.New("FTP 返回了目录外路径")
			}
			if entry.Type == ftp.EntryTypeFolder {
				queue = append(queue, file)
				continue
			}
			if entry.Type != ftp.EntryTypeFile || !audioTypes[strings.ToLower(path.Ext(file))] || entry.Size > uint64(maxNetworkAudioSize) {
				continue
			}
			fileURL := *u
			fileURL.Path = file
			fileURL.RawPath = ""
			modified := ""
			if !entry.Time.IsZero() {
				modified = entry.Time.UTC().Format(time.RFC1123)
			}
			entries = append(entries, remoteEntry{Key: file, URL: fileURL.String(), Size: int64(entry.Size), LastModified: modified})
			if len(entries) > maxSourceEntries {
				return nil, errors.New("FTP 音频数量超过限制")
			}
		}
	}
	return entries, nil
}

func parseFTPRange(value string, size int64) (int64, int64, error) {
	if size <= 0 {
		return 0, 0, errors.New("FTP 文件大小未知")
	}
	if value == "" {
		return 0, size - 1, nil
	}
	if !strings.HasPrefix(value, "bytes=") || strings.Contains(value, ",") {
		return 0, 0, errors.New("无效的播放区间")
	}
	parts := strings.SplitN(strings.TrimPrefix(value, "bytes="), "-", 2)
	if len(parts) != 2 {
		return 0, 0, errors.New("无效的播放区间")
	}
	if parts[0] == "" {
		suffix, err := strconv.ParseInt(parts[1], 10, 64)
		if err != nil || suffix <= 0 {
			return 0, 0, errors.New("无效的播放区间")
		}
		if suffix > size {
			suffix = size
		}
		return size - suffix, size - 1, nil
	}
	start, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || start < 0 || start >= size {
		return 0, 0, errors.New("无效的播放区间")
	}
	end := size - 1
	if parts[1] != "" {
		end, err = strconv.ParseInt(parts[1], 10, 64)
		if err != nil || end < start {
			return 0, 0, errors.New("无效的播放区间")
		}
		if end >= size {
			end = size - 1
		}
	}
	return start, end, nil
}

func (s *Store) serveFTPAudio(w http.ResponseWriter, r *http.Request, item networkTrack) {
	start, end, err := parseFTPRange(r.Header.Get("Range"), item.Size)
	if err != nil {
		w.Header().Set("Content-Range", fmt.Sprintf("bytes */%d", item.Size))
		http.Error(w, err.Error(), http.StatusRequestedRangeNotSatisfiable)
		return
	}
	status := http.StatusOK
	if r.Header.Get("Range") != "" {
		status = http.StatusPartialContent
	}
	writeHeaders := func() {
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", networkContentType(item.URL, item.ContentType))
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Accept-Ranges", "bytes")
		w.Header().Set("Content-Length", strconv.FormatInt(end-start+1, 10))
		if status == http.StatusPartialContent {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes %d-%d/%d", start, end, item.Size))
		}
	}
	if r.Method == http.MethodHead {
		writeHeaders()
		w.WriteHeader(status)
		return
	}
	source, err := s.privateNetworkSource(item.SourceID)
	if err != nil {
		http.Error(w, "FTP 来源不可用", http.StatusBadGateway)
		return
	}
	conn, err := connectFTP(r.Context(), source)
	if err != nil {
		http.Error(w, "FTP 连接失败", http.StatusBadGateway)
		return
	}
	defer conn.Quit()
	u, _ := url.Parse(item.URL)
	stream, err := conn.RetrFrom(u.Path, uint64(start))
	if err != nil {
		http.Error(w, "FTP 文件读取失败", http.StatusBadGateway)
		return
	}
	defer stream.Close()
	writeHeaders()
	w.WriteHeader(status)
	_, _ = io.CopyN(w, stream, end-start+1)
}

func (s *Store) cacheFTPAudio(ctx context.Context, id int64, item networkTrack, epoch uint64) {
	if item.Size <= 0 || item.Size > maxNetworkAudioSize {
		return
	}
	source, err := s.privateNetworkSource(item.SourceID)
	if err != nil {
		return
	}
	conn, err := connectFTP(ctx, source)
	if err != nil {
		return
	}
	defer conn.Quit()
	u, _ := url.Parse(item.URL)
	stream, err := conn.Retr(u.Path)
	if err != nil {
		return
	}
	defer stream.Close()
	file, err := os.CreateTemp(filepath.Join(s.Root, "cache", "network-audio"), ".download-*")
	if err != nil {
		return
	}
	defer os.Remove(file.Name())
	written, copyErr := io.Copy(file, io.LimitReader(stream, maxNetworkAudioSize+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil || written != item.Size {
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
		return
	}
	s.networkChecks[id] = time.Now()
	_ = s.pruneNetworkCacheLocked(settings.NetworkCacheCount)
}
