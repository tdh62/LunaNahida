package backend

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/dhowden/tag"
)

func formatID(id int64) string { return strconv.FormatInt(id, 10) }

var audioTypes = map[string]bool{".mp3": true, ".m4a": true, ".mp4": true, ".aac": true, ".wav": true, ".ogg": true, ".oga": true, ".opus": true, ".flac": true, ".webm": true}

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

func (s *Store) readTrack(path string, info fs.FileInfo) (Track, error) {
	t := Track{Path: path, Title: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), Artist: "未知歌手", Album: "未知专辑", Genre: "", Year: "", Cover: "/covers/local.svg", Color: "#8daab0", FileName: filepath.Base(path), Available: true, Size: info.Size(), Modified: info.ModTime().UnixNano()}
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
		t.Lyrics = metadata.Lyrics()
		if metadata.Year() > 0 {
			t.Year = strconv.Itoa(metadata.Year())
		}
		if pic := metadata.Picture(); pic != nil && len(pic.Data) > 0 && len(pic.Data) <= 15<<20 {
			sum := sha256.Sum256(pic.Data)
			name := hex.EncodeToString(sum[:])
			ext := ".jpg"
			switch pic.MIMEType {
			case "image/png":
				ext = ".png"
			case "image/webp":
				ext = ".webp"
			case "image/gif":
				ext = ".gif"
			}
			name += ext
			target := filepath.Join(s.Root, "cache", "covers", name)
			if _, err = os.Stat(target); errors.Is(err, os.ErrNotExist) {
				_ = os.WriteFile(target, pic.Data, 0600)
			}
			t.Cover = "/api/media/cover/" + name
		}
	}
	if t.Lyrics == "" {
		sidecar := strings.TrimSuffix(path, filepath.Ext(path)) + ".lrc"
		if data, err := os.ReadFile(sidecar); err == nil && len(data) < 2<<20 {
			t.Lyrics = string(data)
		}
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
	err = s.DB.QueryRow(`SELECT id,size,modified,duration,cover FROM tracks WHERE path=?`, path).Scan(&old.ID, &old.Size, &old.Modified, &old.Duration, &old.Cover)
	if err == nil && old.Size == info.Size() && old.Modified == info.ModTime().UnixNano() {
		_, err = s.DB.Exec(`UPDATE tracks SET available=1 WHERE id=?`, old.ID)
		if err != nil {
			return Track{}, err
		}
		return s.GetTrack(old.ID)
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
	_, err = s.DB.Exec(`INSERT INTO tracks(path,title,artist,album,duration,cover,genre,year,lyrics,size,modified,available,added_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,1,?) ON CONFLICT(path) DO UPDATE SET title=excluded.title,artist=excluded.artist,album=excluded.album,cover=CASE WHEN excluded.cover='/covers/local.svg' THEN tracks.cover ELSE excluded.cover END,genre=excluded.genre,year=excluded.year,lyrics=CASE WHEN excluded.lyrics='' THEN tracks.lyrics ELSE excluded.lyrics END,size=excluded.size,modified=excluded.modified,available=1`, path, t.Title, t.Artist, t.Album, t.Duration, t.Cover, t.Genre, t.Year, t.Lyrics, t.Size, t.Modified, time.Now().Unix())
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
	var available int
	err := s.DB.QueryRow(`SELECT id,path,title,artist,album,duration,cover,genre,year,lyrics,translation,size,modified,available FROM tracks WHERE id=?`, id).Scan(&t.ID, &t.Path, &t.Title, &t.Artist, &t.Album, &t.Duration, &t.Cover, &t.Genre, &t.Year, &t.Lyrics, &t.Translation, &t.Size, &t.Modified, &available)
	if err != nil {
		return t, err
	}
	t.Available = available == 1
	t.Source = "/api/media/audio/" + formatID(t.ID)
	t.FileName = filepath.Base(t.Path)
	t.Color = "#8daab0"
	return t, nil
}

func (s *Store) Import(paths []string, mode string) ([]Track, error) {
	if mode != "temporary" && mode != "library" && mode != "watch" {
		return nil, errors.New("invalid import mode")
	}
	result := []Track{}
	seen := map[string]bool{}
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
				if entry.IsDir() || !audioTypes[strings.ToLower(filepath.Ext(item))] {
					return nil
				}
				t, loadErr := s.importFile(item, mode)
				if loadErr == nil && !seen[t.Path] {
					result = append(result, t)
					seen[t.Path] = true
				}
				return nil
			})
			if err != nil {
				return nil, err
			}
			continue
		}
		if mode == "watch" {
			if err = s.AddFolder(filepath.Dir(path)); err != nil {
				return nil, err
			}
		}
		t, err := s.importFile(path, mode)
		if err != nil {
			return nil, err
		}
		if !seen[t.Path] {
			result = append(result, t)
			seen[t.Path] = true
		}
	}
	return result, nil
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

type ScanResult struct {
	Added   int      `json:"added"`
	Updated int      `json:"updated"`
	Missing int      `json:"missing"`
	Folders int      `json:"folders"`
	Errors  []string `json:"errors"`
}

func (s *Store) Scan(ctx context.Context) (ScanResult, error) {
	s.mu.Lock()
	if s.scanning {
		s.mu.Unlock()
		return ScanResult{}, errors.New("scan already running")
	}
	s.scanning = true
	s.mu.Unlock()
	defer func() { s.mu.Lock(); s.scanning = false; s.mu.Unlock() }()
	result := ScanResult{Errors: []string{}}
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
	for _, folder := range folders {
		if err = ctx.Err(); err != nil {
			return result, err
		}
		info, statErr := os.Stat(folder)
		if statErr != nil || !info.IsDir() {
			result.Errors = append(result.Errors, folder+": unavailable")
			continue
		}
		result.Folders++
		seen := map[string]bool{}
		_ = filepath.WalkDir(folder, func(path string, entry fs.DirEntry, walkErr error) error {
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if walkErr != nil {
				result.Errors = append(result.Errors, path+": "+walkErr.Error())
				return nil
			}
			if entry.IsDir() || !audioTypes[strings.ToLower(filepath.Ext(path))] {
				return nil
			}
			path, canonErr := canonical(path)
			if canonErr != nil {
				return nil
			}
			seen[path] = true
			var id int64
			lookupErr := s.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, path).Scan(&id)
			if _, upsertErr := s.upsert(path); upsertErr != nil {
				result.Errors = append(result.Errors, path+": "+upsertErr.Error())
			} else if errors.Is(lookupErr, sql.ErrNoRows) {
				result.Added++
			} else {
				result.Updated++
			}
			return nil
		})
		rows, queryErr := s.DB.Query(`SELECT id,path FROM tracks`)
		if queryErr != nil {
			return result, queryErr
		}
		type item struct {
			id   int64
			path string
		}
		items := []item{}
		for rows.Next() {
			var v item
			if err = rows.Scan(&v.id, &v.path); err != nil {
				break
			}
			items = append(items, v)
		}
		rows.Close()
		if err != nil {
			return result, err
		}
		for _, v := range items {
			relative, relErr := filepath.Rel(folder, v.path)
			if relErr != nil || relative == ".." || strings.HasPrefix(relative, ".."+string(filepath.Separator)) || seen[v.path] {
				continue
			}
			changed, updateErr := s.DB.Exec(`UPDATE tracks SET available=0 WHERE id=? AND available=1`, v.id)
			if updateErr != nil {
				return result, updateErr
			}
			if count, _ := changed.RowsAffected(); count > 0 {
				result.Missing++
			}
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
		if err = ctx.Err(); err != nil {
			return result, err
		}
		info, statErr := os.Stat(item.path)
		if statErr != nil || info.IsDir() {
			if item.available {
				_, err = s.DB.Exec(`UPDATE tracks SET available=0 WHERE id=?`, item.id)
				if err != nil {
					return result, err
				}
				result.Missing++
			}
		} else if !item.available {
			if _, err = s.upsert(item.path); err == nil {
				result.Updated++
			} else {
				result.Errors = append(result.Errors, item.path+": "+err.Error())
			}
		}
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
	sum := sha256.Sum256(data)
	name := fmt.Sprintf("%x%s", sum, extension)
	if err = os.WriteFile(filepath.Join(s.Root, "cache", "covers", name), data, 0600); err != nil {
		return "", err
	}
	return "/api/media/cover/" + name, nil
}
