package backend

import (
	"database/sql"
	"errors"
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"strings"
)

type CacheStats struct {
	CoverBytes          int64 `json:"coverBytes"`
	WebviewBytes        int64 `json:"webviewBytes"`
	MetadataBytes       int64 `json:"metadataBytes"`
	NetworkAudioBytes   int64 `json:"networkAudioBytes"`
	TotalBytes          int64 `json:"totalBytes"`
	WebviewClearPending bool  `json:"webviewClearPending"`
}

func directorySize(path string) (int64, error) {
	var size int64
	err := filepath.WalkDir(path, func(_ string, entry fs.DirEntry, walkErr error) error {
		if errors.Is(walkErr, os.ErrNotExist) || errors.Is(walkErr, os.ErrPermission) {
			return nil
		}
		if walkErr != nil {
			return walkErr
		}
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 {
			return nil
		}
		info, err := entry.Info()
		if errors.Is(err, os.ErrNotExist) || errors.Is(err, os.ErrPermission) {
			return nil
		}
		if err != nil {
			return err
		}
		size += info.Size()
		return nil
	})
	return size, err
}

func (s *Store) CacheStats() (CacheStats, error) {
	var stats CacheStats
	var err error
	stats.CoverBytes, err = directorySize(filepath.Join(s.Root, "cache", "covers"))
	if err != nil {
		return stats, err
	}
	stats.WebviewBytes, err = directorySize(filepath.Join(s.Root, "cache", "webview"))
	if err != nil {
		return stats, err
	}
	stats.NetworkAudioBytes, err = s.networkCacheSize()
	if err != nil {
		return stats, err
	}
	err = s.DB.QueryRow(`SELECT COALESCE(SUM(LENGTH(CAST(key AS BLOB))+LENGTH(CAST(value AS BLOB))),0) FROM metadata_cache`).Scan(&stats.MetadataBytes)
	if err != nil {
		return stats, err
	}
	var pending string
	err = s.DB.QueryRow(`SELECT value FROM preferences WHERE key='webview_cache_clear_pending'`).Scan(&pending)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return stats, err
	}
	stats.WebviewClearPending = pending == "1"
	stats.TotalBytes = stats.CoverBytes + stats.WebviewBytes + stats.MetadataBytes + stats.NetworkAudioBytes
	return stats, nil
}

func coverName(reference string) string {
	const prefix = "/api/media/cover/"
	if !strings.HasPrefix(reference, prefix) {
		return ""
	}
	name := strings.TrimPrefix(reference, prefix)
	if name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return ""
	}
	return name
}

func cacheDirectoryWithinRoot(root, target string) error {
	resolvedRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return err
	}
	resolvedTarget, err := filepath.EvalSymlinks(target)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(resolvedRoot, resolvedTarget)
	if err != nil || relative == "." || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return fmt.Errorf("cache path is outside application data directory")
	}
	return nil
}

func (s *Store) ClearCache() (CacheStats, error) {
	s.coverMu.Lock()
	defer s.coverMu.Unlock()
	directory := filepath.Join(s.Root, "cache", "covers")
	if err := cacheDirectoryWithinRoot(s.Root, directory); err != nil {
		return CacheStats{}, err
	}
	entries, err := os.ReadDir(directory)
	if err != nil {
		return CacheStats{}, err
	}
	keep := map[string]bool{}
	tx, err := s.DB.Begin()
	if err != nil {
		return CacheStats{}, err
	}
	defer tx.Rollback()
	rows, err := tx.Query(`SELECT cover FROM tracks WHERE embedded_cover=1 UNION SELECT cover FROM playlists WHERE cover<>''`)
	if err != nil {
		return CacheStats{}, err
	}
	for rows.Next() {
		var reference string
		if err = rows.Scan(&reference); err != nil {
			break
		}
		if name := coverName(reference); name != "" {
			keep[name] = true
		}
	}
	if readErr := rows.Err(); err == nil {
		err = readErr
	}
	rows.Close()
	if err != nil {
		return CacheStats{}, err
	}
	s.mu.Lock()
	for _, track := range s.temporary {
		if name := coverName(track.Cover); name != "" {
			keep[name] = true
		}
	}
	s.mu.Unlock()
	if _, err = tx.Exec(`UPDATE tracks SET cover='/covers/local.svg' WHERE embedded_cover=0 AND cover<>'/covers/local.svg'`); err != nil {
		return CacheStats{}, err
	}
	if _, err = tx.Exec(`DELETE FROM metadata_cache`); err != nil {
		return CacheStats{}, err
	}
	if _, err = tx.Exec(`INSERT INTO preferences(key,value) VALUES('webview_cache_clear_pending','1') ON CONFLICT(key) DO UPDATE SET value='1'`); err != nil {
		return CacheStats{}, err
	}
	if err = tx.Commit(); err != nil {
		return CacheStats{}, err
	}
	for _, entry := range entries {
		if entry.IsDir() || entry.Type()&os.ModeSymlink != 0 || keep[entry.Name()] {
			continue
		}
		if err = os.Remove(filepath.Join(directory, entry.Name())); err != nil && !errors.Is(err, os.ErrNotExist) {
			return CacheStats{}, err
		}
	}
	_, _ = s.DB.Exec(`VACUUM`)
	return s.ClearNetworkCache()
}

func (s *Store) ClearPendingWebviewCache() error {
	var pending string
	err := s.DB.QueryRow(`SELECT value FROM preferences WHERE key='webview_cache_clear_pending'`).Scan(&pending)
	if errors.Is(err, sql.ErrNoRows) {
		return nil
	}
	if err != nil {
		return err
	}
	if pending != "1" {
		return nil
	}
	target := filepath.Join(s.Root, "cache", "webview")
	if _, err = os.Lstat(target); errors.Is(err, os.ErrNotExist) {
		_, err = s.DB.Exec(`DELETE FROM preferences WHERE key='webview_cache_clear_pending'`)
		return err
	} else if err != nil {
		return err
	}
	if err = cacheDirectoryWithinRoot(s.Root, target); err != nil {
		return err
	}
	if err = os.RemoveAll(target); err != nil {
		return err
	}
	_, err = s.DB.Exec(`DELETE FROM preferences WHERE key='webview_cache_clear_pending'`)
	return err
}
