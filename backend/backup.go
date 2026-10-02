package backend

import (
	"archive/zip"
	"context"
	"crypto/md5"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
)

const backupFormat = "lunanahida-backup"
const backupVersion = 1
const maxBackupArchive = 2 << 30
const maxBackupContents = 4 << 30
const maxBackupDatabase = 1 << 30
const maxBackupCover = 20 << 20

type BackupImportResult struct {
	Tracks    int64 `json:"tracks"`
	Playlists int64 `json:"playlists"`
	Tags      int64 `json:"tags"`
	Covers    int64 `json:"covers"`
}

type backupManifest struct {
	Format  string `json:"format"`
	Version int    `json:"version"`
}

func validBackupCover(name string) bool {
	if name != strings.ToLower(name) {
		return false
	}
	ext := strings.ToLower(filepath.Ext(name))
	if ext != ".jpg" && ext != ".png" && ext != ".webp" && ext != ".gif" {
		return false
	}
	base := strings.TrimSuffix(name, ext)
	if len(base) != 32 {
		return false
	}
	_, err := hex.DecodeString(base)
	return err == nil
}

func addBackupFile(writer *zip.Writer, name, path string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	entry, err := writer.Create(name)
	if err != nil {
		return err
	}
	_, err = io.Copy(entry, file)
	return err
}

func (s *Store) ExportBackup(output io.Writer) error {
	s.coverMu.Lock()
	defer s.coverMu.Unlock()
	temporary, err := os.MkdirTemp("", "lunanahida-backup-*")
	if err != nil {
		return err
	}
	defer os.RemoveAll(temporary)
	snapshot := filepath.Join(temporary, "library.db")
	if _, err = s.DB.Exec(`VACUUM INTO ?`, snapshot); err != nil {
		return err
	}
	writer := zip.NewWriter(output)
	manifest, err := writer.Create("manifest.json")
	if err != nil {
		return err
	}
	if err = json.NewEncoder(manifest).Encode(backupManifest{Format: backupFormat, Version: backupVersion}); err != nil {
		return err
	}
	if err = addBackupFile(writer, "data/library.db", snapshot); err != nil {
		return err
	}
	covers := filepath.Join(s.Root, "cache", "covers")
	if err = cacheDirectoryWithinRoot(s.Root, covers); err != nil {
		return err
	}
	entries, err := os.ReadDir(covers)
	if err != nil {
		return err
	}
	for _, entry := range entries {
		if !entry.Type().IsRegular() || !validBackupCover(entry.Name()) {
			continue
		}
		if err = addBackupFile(writer, "cache/covers/"+entry.Name(), filepath.Join(covers, entry.Name())); err != nil {
			return err
		}
	}
	return writer.Close()
}

func (s *Store) SaveBackup(path string) error {
	if !strings.EqualFold(filepath.Ext(path), ".zip") {
		path += ".zip"
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(filepath.Dir(path), ".lunanahida-export-*.zip")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	if err = s.ExportBackup(file); err != nil {
		file.Close()
		return err
	}
	if err = file.Close(); err != nil {
		return err
	}
	return os.Rename(file.Name(), path)
}

func extractBackupEntry(entry *zip.File, path string, limit int64) error {
	input, err := entry.Open()
	if err != nil {
		return err
	}
	defer input.Close()
	output, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	count, copyErr := io.Copy(output, io.LimitReader(input, limit+1))
	closeErr := output.Close()
	if copyErr != nil {
		return copyErr
	}
	if closeErr != nil {
		return closeErr
	}
	if count > limit || uint64(count) != entry.UncompressedSize64 {
		return errors.New("备份文件大小无效")
	}
	return nil
}

func (s *Store) ImportBackup(input io.Reader) (BackupImportResult, error) {
	result := BackupImportResult{}
	temporary, err := os.MkdirTemp("", "lunanahida-restore-*")
	if err != nil {
		return result, err
	}
	defer os.RemoveAll(temporary)
	archivePath := filepath.Join(temporary, "archive.zip")
	archive, err := os.Create(archivePath)
	if err != nil {
		return result, err
	}
	count, copyErr := io.Copy(archive, io.LimitReader(input, maxBackupArchive+1))
	closeErr := archive.Close()
	if copyErr != nil {
		return result, copyErr
	}
	if closeErr != nil {
		return result, closeErr
	}
	if count > maxBackupArchive {
		return result, errors.New("备份文件过大")
	}
	reader, err := zip.OpenReader(archivePath)
	if err != nil {
		return result, errors.New("不是有效的 ZIP 备份文件")
	}
	defer reader.Close()
	if len(reader.File) > 100000 {
		return result, errors.New("备份文件条目过多")
	}
	var manifest backupManifest
	var hasManifest, hasDatabase bool
	var total uint64
	coverFiles := []string{}
	seen := map[string]bool{}
	databasePath := filepath.Join(temporary, "data", "library.db")
	if err = os.MkdirAll(filepath.Dir(databasePath), 0700); err != nil {
		return result, err
	}
	coverDir := filepath.Join(temporary, "cache", "covers")
	if err = os.MkdirAll(coverDir, 0700); err != nil {
		return result, err
	}
	for _, entry := range reader.File {
		if seen[entry.Name] || !entry.Mode().IsRegular() {
			return result, errors.New("备份文件包含无效条目")
		}
		seen[entry.Name] = true
		if entry.UncompressedSize64 > maxBackupContents-total {
			return result, errors.New("备份内容过大")
		}
		total += entry.UncompressedSize64
		switch {
		case entry.Name == "manifest.json":
			if entry.UncompressedSize64 > 4096 {
				return result, errors.New("备份清单无效")
			}
			file, openErr := entry.Open()
			if openErr != nil {
				return result, openErr
			}
			data, readErr := io.ReadAll(io.LimitReader(file, 4097))
			closeErr := file.Close()
			if readErr != nil || closeErr != nil || len(data) > 4096 || json.Unmarshal(data, &manifest) != nil {
				return result, errors.New("备份清单无效")
			}
			hasManifest = true
		case entry.Name == "data/library.db":
			if entry.UncompressedSize64 > maxBackupDatabase {
				return result, errors.New("备份数据库过大")
			}
			if err = extractBackupEntry(entry, databasePath, maxBackupDatabase); err != nil {
				return result, err
			}
			hasDatabase = true
		case strings.HasPrefix(entry.Name, "cache/covers/"):
			name := strings.TrimPrefix(entry.Name, "cache/covers/")
			if !validBackupCover(name) || entry.UncompressedSize64 > maxBackupCover {
				return result, errors.New("备份封面文件无效")
			}
			path := filepath.Join(coverDir, name)
			if err = extractBackupEntry(entry, path, maxBackupCover); err != nil {
				return result, err
			}
			data, readErr := os.ReadFile(path)
			sum := md5.Sum(data)
			if readErr != nil || hex.EncodeToString(sum[:]) != strings.TrimSuffix(name, filepath.Ext(name)) {
				return result, errors.New("备份封面校验失败")
			}
			coverFiles = append(coverFiles, name)
		default:
			return result, errors.New("备份文件包含未知条目")
		}
	}
	if !hasManifest || !hasDatabase || manifest.Format != backupFormat || manifest.Version != backupVersion {
		return result, errors.New("不支持的备份文件格式")
	}
	imported, err := Open(temporary)
	if err != nil {
		return result, fmt.Errorf("备份数据库无效：%w", err)
	}
	var schemaVersion int
	err = imported.DB.QueryRow(`SELECT version FROM schema_version LIMIT 1`).Scan(&schemaVersion)
	var integrity string
	if err == nil {
		err = imported.DB.QueryRow(`PRAGMA quick_check`).Scan(&integrity)
	}
	closeErr = imported.Close()
	if err != nil || closeErr != nil || schemaVersion != 14 || integrity != "ok" {
		return result, errors.New("备份数据库无效或版本不兼容")
	}
	s.coverMu.Lock()
	defer s.coverMu.Unlock()
	targetDir := filepath.Join(s.Root, "cache", "covers")
	if err = cacheDirectoryWithinRoot(s.Root, targetDir); err != nil {
		return result, err
	}
	addedCovers := []string{}
	committed := false
	defer func() {
		if !committed {
			for _, path := range addedCovers {
				os.Remove(path)
			}
		}
	}()
	for _, name := range coverFiles {
		target := filepath.Join(targetDir, name)
		if _, statErr := os.Lstat(target); statErr == nil {
			continue
		} else if !errors.Is(statErr, os.ErrNotExist) {
			return result, statErr
		}
		source, openErr := os.Open(filepath.Join(coverDir, name))
		if openErr != nil {
			return result, openErr
		}
		destination, openErr := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if errors.Is(openErr, os.ErrExist) {
			source.Close()
			continue
		}
		if openErr != nil {
			source.Close()
			return result, openErr
		}
		_, err = io.Copy(destination, source)
		closeErr := destination.Close()
		source.Close()
		if err != nil || closeErr != nil {
			os.Remove(target)
			if err != nil {
				return result, err
			}
			return result, closeErr
		}
		addedCovers = append(addedCovers, target)
		result.Covers++
	}
	merged, err := s.mergeBackupDatabase(databasePath)
	if err != nil {
		return BackupImportResult{}, err
	}
	result.Tracks, result.Playlists, result.Tags = merged.Tracks, merged.Playlists, merged.Tags
	committed = true
	return result, nil
}

func (s *Store) mergeBackupDatabase(path string) (BackupImportResult, error) {
	result := BackupImportResult{}
	ctx := context.Background()
	conn, err := s.DB.Conn(ctx)
	if err != nil {
		return result, err
	}
	defer conn.Close()
	if _, err = conn.ExecContext(ctx, `ATTACH DATABASE ? AS imported`, path); err != nil {
		return result, err
	}
	defer conn.ExecContext(ctx, `DETACH DATABASE imported`)
	var integrity string
	if err = conn.QueryRowContext(ctx, `PRAGMA imported.quick_check`).Scan(&integrity); err != nil || integrity != "ok" {
		return result, errors.New("备份数据库校验失败")
	}
	tx, err := conn.BeginTx(ctx, nil)
	if err != nil {
		return result, err
	}
	defer tx.Rollback()
	statements := []struct {
		query string
		count *int64
	}{
		{`INSERT OR IGNORE INTO network_sources(kind,url,username,secret) SELECT kind,url,username,secret FROM imported.network_sources`, nil},
		{`INSERT OR IGNORE INTO tracks(path,title,artist,album,duration,cover,genre,year,lyrics,translation,size,modified,available,added_at,embedded_cover,embedded_lyrics,local_lyrics,tags_checked,embedded_tags,playback_status,provider,provider_id,converted,folder_imported,manual_metadata)
			SELECT path,title,artist,album,duration,cover,genre,year,lyrics,translation,size,modified,available,added_at,embedded_cover,embedded_lyrics,local_lyrics,tags_checked,embedded_tags,playback_status,provider,provider_id,converted,folder_imported,manual_metadata FROM imported.tracks`, &result.Tracks},
		{`INSERT OR IGNORE INTO network_tracks(track_id,url,etag,last_modified,size,content_type,source_id,remote_key)
			SELECT dest.id,nt.url,nt.etag,nt.last_modified,nt.size,nt.content_type,ns.id,nt.remote_key FROM imported.network_tracks nt JOIN imported.tracks src ON src.id=nt.track_id JOIN tracks dest ON dest.path=src.path LEFT JOIN imported.network_sources ins ON ins.id=nt.source_id LEFT JOIN network_sources ns ON ns.kind=ins.kind AND ns.url=ins.url`, nil},
		{`INSERT OR IGNORE INTO custom_tags(name) SELECT name FROM imported.custom_tags`, &result.Tags},
		{`INSERT OR IGNORE INTO track_custom_tags(track_id,name) SELECT dest.id,tags.name FROM imported.track_custom_tags ct JOIN imported.tracks src ON src.id=ct.track_id JOIN tracks dest ON dest.path=src.path JOIN custom_tags tags ON tags.name=ct.name`, nil},
		{`CREATE TEMP TABLE backup_new_playlists AS SELECT id FROM imported.playlists WHERE id NOT IN (SELECT id FROM playlists)`, nil},
		{`INSERT INTO playlists(id,name,description,cover,cover_mode) SELECT id,name,description,cover,cover_mode FROM imported.playlists WHERE id IN (SELECT id FROM backup_new_playlists)`, &result.Playlists},
		{`INSERT OR IGNORE INTO playlist_rules(playlist_id,rules) SELECT pr.playlist_id,pr.rules FROM imported.playlist_rules pr JOIN backup_new_playlists bp ON bp.id=pr.playlist_id`, nil},
		{`INSERT OR IGNORE INTO playlist_tracks(playlist_id,track_id,position) SELECT pt.playlist_id,dest.id,pt.position FROM imported.playlist_tracks pt JOIN backup_new_playlists bp ON bp.id=pt.playlist_id JOIN imported.tracks src ON src.id=pt.track_id JOIN tracks dest ON dest.path=src.path`, nil},
		{`INSERT OR IGNORE INTO track_lyric_offsets(track_id,offset_ms) SELECT dest.id,lo.offset_ms FROM imported.track_lyric_offsets lo JOIN imported.tracks src ON src.id=lo.track_id JOIN tracks dest ON dest.path=src.path`, nil},
		{`INSERT OR IGNORE INTO liked(track_id) SELECT dest.id FROM imported.liked il JOIN imported.tracks src ON src.id=il.track_id JOIN tracks dest ON dest.path=src.path`, nil},
		{`INSERT OR IGNORE INTO history(track_id,played_at) SELECT dest.id,ih.played_at FROM imported.history ih JOIN imported.tracks src ON src.id=ih.track_id JOIN tracks dest ON dest.path=src.path`, nil},
		{`INSERT OR IGNORE INTO queue(track_id,position) SELECT dest.id,(SELECT COALESCE(MAX(position),-1) FROM queue)+ROW_NUMBER() OVER(ORDER BY iq.position) FROM imported.queue iq JOIN imported.tracks src ON src.id=iq.track_id JOIN tracks dest ON dest.path=src.path WHERE dest.id NOT IN (SELECT track_id FROM queue)`, nil},
		{`INSERT OR IGNORE INTO folders(path) SELECT path FROM imported.folders`, nil},
		{`INSERT OR IGNORE INTO preferences(key,value) SELECT key,value FROM imported.preferences WHERE key<>'webview_cache_clear_pending'`, nil},
		{`INSERT OR IGNORE INTO metadata_cache(key,value,expires_at) SELECT key,value,expires_at FROM imported.metadata_cache`, nil},
		{`DROP TABLE backup_new_playlists`, nil},
	}
	for _, statement := range statements {
		change, execErr := tx.Exec(statement.query)
		if execErr != nil {
			return BackupImportResult{}, execErr
		}
		if statement.count != nil {
			*statement.count, err = change.RowsAffected()
			if err != nil {
				return BackupImportResult{}, err
			}
		}
	}
	return result, tx.Commit()
}
