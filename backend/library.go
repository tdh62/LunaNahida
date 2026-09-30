package backend

import (
	"bytes"
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"io/fs"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dhowden/tag"
)

func formatID(id int64) string { return strconv.FormatInt(id, 10) }

var audioTypes = map[string]bool{".mp3": true, ".m4a": true, ".mp4": true, ".aac": true, ".wav": true, ".ogg": true, ".oga": true, ".opus": true, ".flac": true, ".webm": true, ".wma": true, ".dff": true, ".ape": true}

func playbackStatus(path string) string {
	switch strings.ToLower(filepath.Ext(path)) {
	case ".wma", ".dff", ".ape":
		return "unplayable"
	default:
		return "unknown"
	}
}

func canonical(path string) (string, error) {
	if !filepath.IsAbs(path) {
		return "", errors.New("absolute path required")
	}
	path, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if resolved, err := filepath.EvalSymlinks(path); err == nil {
		path = resolved
	}
	return filepath.Clean(path), nil
}

func pathWithin(folder, path string) bool {
	relative, err := filepath.Rel(folder, path)
	return err == nil && relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) && !filepath.IsAbs(relative)
}

func (s *Store) readTrack(path string, info fs.FileInfo) (Track, error) {
	t := Track{Path: path, Title: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), Artist: "未知歌手", Album: "未知专辑", Genre: "", Year: "", Cover: "/covers/local.svg", Color: "#8daab0", FileName: filepath.Base(path), Available: true, PlaybackStatus: playbackStatus(path), EmbeddedTags: []string{}, CustomTags: []string{}, Size: info.Size(), Modified: info.ModTime().UnixNano()}
	file, err := os.Open(path)
	if err != nil {
		return t, err
	}
	defer file.Close()
	metadata, err := tag.ReadFrom(file)
	if err == nil {
		if v := strings.TrimSpace(metadata.Title()); v != "" {
			t.Title = v
		}
		if v := strings.TrimSpace(metadata.Artist()); v != "" {
			t.Artist = v
		} else if v := strings.TrimSpace(metadata.AlbumArtist()); v != "" {
			t.Artist = v
		}
		if v := strings.TrimSpace(metadata.Album()); v != "" {
			t.Album = v
		}
		t.Genre = strings.TrimSpace(metadata.Genre())
		t.EmbeddedTags = splitAudioTags(t.Genre)
		seen := map[string]bool{}
		for _, name := range t.EmbeddedTags {
			seen[strings.ToLower(name)] = true
		}
		for key, value := range metadata.Raw() {
			field := strings.ToLower(strings.TrimSpace(key))
			isCustomField := strings.HasPrefix(field, "txxx") || strings.HasPrefix(field, "txx")
			if field != "tag" && field != "tags" && field != "label" && field != "grouping" && field != "©grp" && !strings.Contains(field, "tagging") && !isCustomField {
				continue
			}
			values := []string{}
			switch v := value.(type) {
			case string:
				values = []string{v}
			case []string:
				values = v
			case []byte:
				values = []string{string(v)}
			case *tag.Comm:
				if strings.EqualFold(v.Description, "tag") || strings.EqualFold(v.Description, "tags") || strings.EqualFold(v.Description, "label") {
					values = []string{v.Text}
				}
			}
			for _, item := range values {
				for _, name := range splitAudioTags(item) {
					if !seen[strings.ToLower(name)] {
						t.EmbeddedTags = append(t.EmbeddedTags, name)
						seen[strings.ToLower(name)] = true
					}
				}
			}
		}
		if lyrics := strings.TrimSpace(metadata.Lyrics()); lyrics != "" && len(lyrics) <= 2<<20 {
			t.Lyrics = lyrics
			t.EmbeddedLyrics = true
		}
		if metadata.Year() > 0 {
			t.Year = strconv.Itoa(metadata.Year())
		}
		if pic := metadata.Picture(); pic != nil && len(pic.Data) > 0 && len(pic.Data) <= 15<<20 {
			imageType := http.DetectContentType(pic.Data)
			if imageType == "application/octet-stream" {
				imageType = pic.MIMEType
			}
			ext := ""
			switch imageType {
			case "image/jpeg":
				ext = ".jpg"
			case "image/png":
				ext = ".png"
			case "image/webp":
				ext = ".webp"
			case "image/gif":
				ext = ".gif"
			}
			if ext != "" {
				if saved, saveErr := s.SaveCover(bytes.NewReader(pic.Data), ext); saveErr == nil {
					t.Cover = saved
					t.EmbeddedCover = true
				}
			}
		}
	}
	if lyrics, ok := sidecarLyrics(path); ok {
		t.Lyrics = lyrics
		t.EmbeddedLyrics = false
		t.LocalLyrics = true
	}
	return t, nil
}

func (s *Store) upsert(path string) (Track, error) {
	path, err := canonical(path)
	if err != nil {
		return Track{}, err
	}
	if !audioTypes[strings.ToLower(filepath.Ext(path))] {
		return Track{}, errors.New("unsupported audio format")
	}
	info, err := os.Stat(path)
	if err != nil {
		return Track{}, err
	}
	if info.IsDir() {
		return Track{}, errors.New("expected audio file")
	}
	var old Track
	var tagsChecked, oldLocalLyrics int
	err = s.DB.QueryRow(`SELECT id,size,modified,duration,cover,lyrics,local_lyrics,tags_checked FROM tracks WHERE path=?`, path).Scan(&old.ID, &old.Size, &old.Modified, &old.Duration, &old.Cover, &old.Lyrics, &oldLocalLyrics, &tagsChecked)
	if err == nil && old.Size == info.Size() && old.Modified == info.ModTime().UnixNano() && tagsChecked == 1 {
		lyrics, found := sidecarLyrics(path)
		if found && oldLocalLyrics == 1 && old.Lyrics == lyrics || !found && oldLocalLyrics == 0 {
			_, err = s.DB.Exec(`UPDATE tracks SET available=1 WHERE id=?`, old.ID)
			if err != nil {
				return Track{}, err
			}
			return s.GetTrack(old.ID)
		}
	}
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return Track{}, err
	}
	t, err := s.readTrack(path, info)
	if err != nil {
		return Track{}, err
	}
	if old.ID != 0 {
		t.Duration = old.Duration
	}
	embeddedJSON, _ := json.Marshal(t.EmbeddedTags)
	_, err = s.DB.Exec(`INSERT INTO tracks(path,title,artist,album,duration,cover,genre,year,lyrics,size,modified,available,added_at,embedded_cover,embedded_lyrics,local_lyrics,tags_checked,embedded_tags,playback_status)
		VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?,1,?,?)
		ON CONFLICT(path) DO UPDATE SET
		title=CASE WHEN tracks.manual_metadata=1 THEN tracks.title ELSE excluded.title END,
		artist=CASE WHEN tracks.manual_metadata=1 THEN tracks.artist ELSE excluded.artist END,
		album=CASE WHEN tracks.manual_metadata=1 THEN tracks.album ELSE excluded.album END,
		cover=CASE WHEN excluded.embedded_cover=1 OR tracks.embedded_cover=1 THEN excluded.cover WHEN excluded.cover='/covers/local.svg' THEN tracks.cover ELSE excluded.cover END,
		genre=excluded.genre,year=excluded.year,
		lyrics=CASE WHEN excluded.local_lyrics=1 OR excluded.embedded_lyrics=1 THEN excluded.lyrics WHEN tracks.local_lyrics=1 OR tracks.embedded_lyrics=1 THEN '' ELSE tracks.lyrics END,
		translation=CASE WHEN excluded.local_lyrics=1 OR excluded.embedded_lyrics=1 OR tracks.local_lyrics=1 OR tracks.embedded_lyrics=1 THEN '' ELSE tracks.translation END,
		size=excluded.size,modified=excluded.modified,available=1,embedded_cover=excluded.embedded_cover,embedded_lyrics=excluded.embedded_lyrics,local_lyrics=excluded.local_lyrics,tags_checked=1,embedded_tags=excluded.embedded_tags,playback_status=excluded.playback_status`,
		path, t.Title, t.Artist, t.Album, t.Duration, t.Cover, t.Genre, t.Year, t.Lyrics, t.Size, t.Modified, time.Now().Unix(), t.EmbeddedCover, t.EmbeddedLyrics, t.LocalLyrics, string(embeddedJSON), t.PlaybackStatus)
	if err != nil {
		return Track{}, err
	}
	if err = s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, path).Scan(&t.ID); err != nil {
		return Track{}, err
	}
	return s.GetTrack(t.ID)
}

func (s *Store) GetTrack(id int64) (Track, error) {
	if id < 0 {
		s.mu.Lock()
		t, ok := s.temporary[id]
		s.mu.Unlock()
		if !ok {
			return Track{}, sql.ErrNoRows
		}
		return t, nil
	}
	var t Track
	var available, embeddedCover, embeddedLyrics, localLyrics, converted, folderImported int
	var embeddedJSON string
	err := s.DB.QueryRow(`SELECT id,path,title,artist,album,duration,cover,genre,year,lyrics,translation,size,modified,available,embedded_cover,embedded_lyrics,local_lyrics,embedded_tags,playback_status,provider,provider_id,converted,folder_imported FROM tracks WHERE id=?`, id).Scan(&t.ID, &t.Path, &t.Title, &t.Artist, &t.Album, &t.Duration, &t.Cover, &t.Genre, &t.Year, &t.Lyrics, &t.Translation, &t.Size, &t.Modified, &available, &embeddedCover, &embeddedLyrics, &localLyrics, &embeddedJSON, &t.PlaybackStatus, &t.Provider, &t.ProviderID, &converted, &folderImported)
	if err != nil {
		return t, err
	}
	t.Available = available == 1
	t.Converted = converted == 1
	t.Deletable = folderImported == 0
	if t.Deletable {
		rows, queryErr := s.DB.Query(`SELECT path FROM folders`)
		if queryErr != nil {
			return t, queryErr
		}
		for rows.Next() {
			var folder string
			if scanErr := rows.Scan(&folder); scanErr != nil {
				rows.Close()
				return t, scanErr
			}
			if pathWithin(folder, t.Path) {
				t.Deletable = false
				break
			}
		}
		err = rows.Err()
		rows.Close()
		if err != nil {
			return t, err
		}
	}
	t.EmbeddedCover = embeddedCover == 1
	t.EmbeddedLyrics = embeddedLyrics == 1
	t.LocalLyrics = localLyrics == 1
	t.Source = "/api/media/audio/" + formatID(t.ID)
	t.FileName = filepath.Base(t.Path)
	if err = s.decorateNetworkTrack(&t); err != nil {
		return Track{}, err
	}
	t.Color = "#8daab0"
	t.EmbeddedTags = decodeTags(embeddedJSON)
	t.CustomTags, err = s.trackCustomTags(id)
	return t, err
}

func (s *Store) UpdateTrackMetadata(id int64, title, artist, album string) (Track, error) {
	if id < 0 {
		s.mu.Lock()
		track, ok := s.temporary[id]
		if ok {
			track.Title, track.Artist, track.Album = title, artist, album
			s.temporary[id] = track
		}
		s.mu.Unlock()
		if !ok {
			return Track{}, sql.ErrNoRows
		}
		return track, nil
	}
	changed, err := s.DB.Exec(`UPDATE tracks SET title=?,artist=?,album=?,manual_metadata=1 WHERE id=?`, title, artist, album, id)
	if err != nil {
		return Track{}, err
	}
	if count, _ := changed.RowsAffected(); count == 0 {
		return Track{}, sql.ErrNoRows
	}
	return s.GetTrack(id)
}

func (s *Store) recheckLegacyTags() error {
	rows, err := s.DB.Query(`SELECT path FROM tracks WHERE tags_checked=0 AND path NOT LIKE 'remote:%'`)
	if err != nil {
		return err
	}
	paths := []string{}
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			break
		}
		paths = append(paths, path)
	}
	if readErr := rows.Err(); err == nil {
		err = readErr
	}
	rows.Close()
	if err != nil {
		return err
	}
	for _, path := range paths {
		_, _ = s.upsert(path)
	}
	return nil
}

func (s *Store) Import(paths []string, mode string) ([]Track, error) {
	return s.importPaths(paths, mode, false)
}

func (s *Store) ImportWithoutConversion(paths []string, mode string) ([]Track, error) {
	return s.importPaths(paths, mode, true)
}

func (s *Store) importPaths(paths []string, mode string, skipConversion bool) ([]Track, error) {
	if mode != "temporary" && mode != "library" && mode != "watch" {
		return nil, errors.New("invalid import mode")
	}
	result := []Track{}
	seen := map[string]bool{}
	failures := []error{}
	settings, err := s.Settings()
	if err != nil {
		return nil, err
	}
	for _, input := range paths {
		path, err := canonical(input)
		if err != nil {
			return nil, err
		}
		info, err := os.Stat(path)
		if err != nil {
			return nil, err
		}
		if info.IsDir() {
			if mode == "watch" {
				if err = s.AddFolder(path); err != nil {
					return nil, err
				}
			}
			err = filepath.WalkDir(path, func(item string, entry fs.DirEntry, walkErr error) error {
				if walkErr != nil {
					return nil
				}
				if entry.IsDir() {
					if entry.Name() == backupFolder || entry.Name() == organizerRecoveryFolder {
						return filepath.SkipDir
					}
					return nil
				}
				if !audioTypes[strings.ToLower(filepath.Ext(item))] && !encryptedFile(item) {
					return nil
				}
				if skipConversion && encryptedFile(item) {
					return nil
				}
				t, loadErr := s.importWithConversion(item, mode, settings)
				if loadErr == nil && mode == "library" {
					_, loadErr = s.DB.Exec(`UPDATE tracks SET folder_imported=1 WHERE id=?`, t.ID)
				}
				if loadErr == nil && !seen[t.Path] {
					result = append(result, t)
					seen[t.Path] = true
				} else if loadErr != nil && settings.AutoConvert && encryptedFile(item) && len(failures) < 5 {
					failures = append(failures, errors.New(filepath.Base(item)+": "+loadErr.Error()))
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
			continue
		}
		if !audioTypes[strings.ToLower(filepath.Ext(path))] && !encryptedFile(path) {
			continue
		}
		if skipConversion && encryptedFile(path) {
			continue
		}
		if mode == "watch" {
			if err = s.AddFolder(filepath.Dir(path)); err != nil {
				return nil, err
			}
		}
		t, err := s.importWithConversion(path, mode, settings)
		if err != nil {
			return nil, err
		}
		if !seen[t.Path] {
			result = append(result, t)
			seen[t.Path] = true
		}
	}
	return result, errors.Join(failures...)
}

func (s *Store) importWithConversion(path, mode string, settings Settings) (Track, error) {
	if encryptedFile(path) {
		if !settings.AutoConvert {
			return Track{}, errors.New("此文件需要先转换，请使用工具箱")
		}
		converted := s.Convert(context.Background(), path, settings.BackupOriginal, mode != "temporary")
		if converted.Status != "converted" {
			return Track{}, errors.New(converted.Error)
		}
		if converted.Track != nil {
			return *converted.Track, nil
		}
		path = converted.Output
	}
	return s.importFile(path, mode)
}

func (s *Store) importFile(path, mode string) (Track, error) {
	if mode != "temporary" {
		return s.upsert(path)
	}
	path, err := canonical(path)
	if err != nil {
		return Track{}, err
	}
	if !audioTypes[strings.ToLower(filepath.Ext(path))] {
		return Track{}, errors.New("unsupported audio format")
	}
	info, err := os.Stat(path)
	if err != nil {
		return Track{}, err
	}
	t, err := s.readTrack(path, info)
	if err != nil {
		return Track{}, err
	}
	s.mu.Lock()
	t.ID = s.nextTemporary
	s.nextTemporary--
	t.Temporary = true
	t.Source = "/api/media/audio/" + formatID(t.ID)
	s.temporary[t.ID] = t
	s.mu.Unlock()
	return t, nil
}

func (s *Store) AddFolder(path string) error {
	path, err := canonical(path)
	if err != nil {
		return err
	}
	info, err := os.Stat(path)
	if err != nil {
		return err
	}
	if !info.IsDir() {
		return errors.New("expected folder")
	}
	_, err = s.DB.Exec(`INSERT OR IGNORE INTO folders(path) VALUES(?)`, path)
	return err
}
func (s *Store) RemoveFolder(path string) error {
	path, err := canonical(path)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`DELETE FROM folders WHERE path=?`, path)
	return err
}

func (s *Store) DeleteTracks(ids []int64) error {
	if len(ids) == 0 {
		return errors.New("请选择要删除的歌曲")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	folders := []string{}
	rows, err := tx.Query(`SELECT path FROM folders`)
	if err != nil {
		return err
	}
	for rows.Next() {
		var folder string
		if err = rows.Scan(&folder); err != nil {
			break
		}
		folders = append(folders, folder)
	}
	if err == nil {
		err = rows.Err()
	}
	rows.Close()
	if err != nil {
		return err
	}
	seen := map[int64]bool{}
	for _, id := range ids {
		if id <= 0 {
			return errors.New("无效的歌曲")
		}
		if seen[id] {
			continue
		}
		seen[id] = true
		var path string
		var imported int
		if err = tx.QueryRow(`SELECT path,folder_imported FROM tracks WHERE id=?`, id).Scan(&path, &imported); err != nil {
			return err
		}
		if imported == 1 {
			return errors.New("文件夹导入的歌曲不支持单独删除")
		}
		for _, folder := range folders {
			if pathWithin(folder, path) {
				return errors.New("监听路径下的歌曲不支持单独删除")
			}
		}
	}
	for id := range seen {
		if _, err = tx.Exec(`DELETE FROM tracks WHERE id=?`, id); err != nil {
			return err
		}
	}
	if err = tx.Commit(); err != nil {
		return err
	}
	settings, err := s.Settings()
	if err != nil {
		return err
	}
	return s.pruneNetworkCache(settings.NetworkCacheCount)
}

type ScanResult struct {
	Added     int      `json:"added"`
	Updated   int      `json:"updated"`
	Missing   int      `json:"missing"`
	Removed   int      `json:"removed"`
	Folders   int      `json:"folders"`
	Converted int      `json:"converted"`
	Errors    []string `json:"errors"`
}

func (s *Store) Scan(ctx context.Context) (ScanResult, error) {
	return s.scan(ctx, nil)
}

func (s *Store) ScanManual(ctx context.Context, backupOriginal bool) (ScanResult, error) {
	return s.scan(ctx, &backupOriginal)
}

func (s *Store) scan(ctx context.Context, manualBackup *bool) (ScanResult, error) {
	s.mu.Lock()
	if s.scanning {
		s.mu.Unlock()
		return ScanResult{}, errors.New("scan already running")
	}
	s.scanning = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.scanning = false; s.mu.Unlock() }()
	result := ScanResult{Errors: []string{}}
	settings, err := s.Settings()
	if err != nil {
		return result, err
	}
	if manualBackup != nil {
		settings.AutoConvert = true
		settings.BackupOriginal = *manualBackup
	}
	rows, err := s.DB.Query(`SELECT path FROM folders`)
	if err != nil {
		return result, err
	}
	folders := []string{}
	for rows.Next() {
		var folder string
		if err = rows.Scan(&folder); err != nil {
			break
		}
		folders = append(folders, folder)
	}
	rows.Close()
	if err != nil {
		return result, err
	}
	scanned := map[string]bool{}
	unavailableFolders := []string{}
	for _, folder := range folders {
		if err = ctx.Err(); err != nil {
			return result, err
		}
		info, statErr := os.Stat(folder)
		if statErr != nil || !info.IsDir() {
			result.Errors = append(result.Errors, folder+": unavailable")
			unavailableFolders = append(unavailableFolders, folder)
			continue
		}
		result.Folders++
		walkErr := filepath.WalkDir(folder, func(path string, entry fs.DirEntry, walkErr error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if walkErr != nil {
				result.Errors = append(result.Errors, path+": "+walkErr.Error())
				return nil
			}
			if entry.IsDir() {
				if entry.Name() == backupFolder || entry.Name() == organizerRecoveryFolder {
					return filepath.SkipDir
				}
				return nil
			}
			if !audioTypes[strings.ToLower(filepath.Ext(path))] && !encryptedFile(path) {
				return nil
			}
			convertedNew := false
			if encryptedFile(path) {
				if !settings.AutoConvert {
					return nil
				}
				var oldID int64
				convertedNew = errors.Is(s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, path).Scan(&oldID), sql.ErrNoRows)
				converted := s.Convert(ctx, path, settings.BackupOriginal, true)
				if converted.Status != "converted" {
					result.Errors = append(result.Errors, path+": "+converted.Error)
					return nil
				}
				result.Converted++
				if converted.Error != "" {
					result.Errors = append(result.Errors, path+": "+converted.Error)
				}
				path = converted.Output
			}
			path, canonErr := canonical(path)
			if canonErr != nil {
				return nil
			}
			scanned[path] = true
			var id int64
			lookupErr := s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, path).Scan(&id)
			if _, upsertErr := s.upsert(path); upsertErr != nil {
				result.Errors = append(result.Errors, path+": "+upsertErr.Error())
			} else if convertedNew || errors.Is(lookupErr, sql.ErrNoRows) {
				result.Added++
			} else {
				result.Updated++
			}
			return nil
		})
		if walkErr != nil {
			return result, walkErr
		}
	}
	rows, err = s.DB.Query(`SELECT id,path,available FROM tracks`)
	if err != nil {
		return result, err
	}
	type existingTrack struct {
		id        int64
		path      string
		available bool
	}
	existing := []existingTrack{}
	for rows.Next() {
		var item existingTrack
		if err = rows.Scan(&item.id, &item.path, &item.available); err != nil {
			break
		}
		existing = append(existing, item)
	}
	rows.Close()
	if err != nil {
		return result, err
	}
	for _, item := range existing {
		if strings.HasPrefix(item.path, "remote:") {
			continue
		}
		if err = ctx.Err(); err != nil {
			return result, err
		}
		unavailable := false
		for _, folder := range unavailableFolders {
			if pathWithin(folder, item.path) {
				unavailable = true
				break
			}
		}
		if unavailable {
			continue
		}
		info, statErr := os.Stat(item.path)
		if errors.Is(statErr, os.ErrNotExist) || statErr == nil && info.IsDir() {
			if _, err = s.DB.Exec(`DELETE FROM tracks WHERE id=?`, item.id); err != nil {
				return result, err
			}
			result.Missing++
			result.Removed++
		} else if statErr != nil {
			result.Errors = append(result.Errors, item.path+": "+statErr.Error())
		} else if !item.available || !scanned[item.path] {
			if _, err = s.upsert(item.path); err == nil {
				result.Updated++
			} else {
				result.Errors = append(result.Errors, item.path+": "+err.Error())
			}
		}
	}
	if err = s.scanNetworkSources(ctx, &result); err != nil {
		return result, err
	}
	return result, nil
}

func (s *Store) MediaPath(id int64) (string, error) {
	t, err := s.GetTrack(id)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(t.Path)
	if err != nil {
		if id > 0 {
			_, _ = s.DB.Exec(`UPDATE tracks SET available=0 WHERE id=?`, id)
		}
		return "", err
	}
	if info.IsDir() {
		return "", errors.New("invalid media path")
	}
	return t.Path, nil
}

func (s *Store) CoverPath(name string) (string, error) {
	if name == "" || filepath.Base(name) != name || strings.ContainsAny(name, `/\`) {
		return "", errors.New("invalid cover")
	}
	return filepath.Join(s.Root, "cache", "covers", name), nil
}

func (s *Store) SaveCover(reader io.Reader, extension string) (string, error) {
	if extension == ".jpeg" {
		extension = ".jpg"
	}
	if extension != ".png" && extension != ".jpg" && extension != ".webp" && extension != ".gif" {
		return "", errors.New("invalid image type")
	}
	data, err := io.ReadAll(io.LimitReader(reader, (15<<20)+1))
	if err != nil {
		return "", err
	}
	if len(data) > 15<<20 {
		return "", errors.New("image too large")
	}
	sum := md5.Sum(data)
	base := hex.EncodeToString(sum[:])
	s.coverMu.Lock()
	defer s.coverMu.Unlock()
	directory := filepath.Join(s.Root, "cache", "covers")
	for _, ext := range []string{".jpg", ".png", ".webp", ".gif"} {
		name := base + ext
		existing, readErr := os.ReadFile(filepath.Join(directory, name))
		if readErr == nil {
			if bytes.Equal(existing, data) {
				return "/api/media/cover/" + name, nil
			}
			return "", errors.New("cover hash collision")
		}
		if !errors.Is(readErr, os.ErrNotExist) {
			return "", readErr
		}
	}
	file, err := os.CreateTemp(directory, ".cover-*")
	if err != nil {
		return "", err
	}
	defer os.Remove(file.Name())
	if _, err = file.Write(data); err != nil {
		file.Close()
		return "", err
	}
	if err = file.Close(); err != nil {
		return "", err
	}
	name := base + extension
	if err = os.Rename(file.Name(), filepath.Join(directory, name)); err != nil {
		return "", err
	}
	return "/api/media/cover/" + name, nil
}
