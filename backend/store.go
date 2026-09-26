package backend

import (
	"database/sql"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	_ "modernc.org/sqlite"
)

type Track struct {
	ID          int64   `json:"id"`
	Path        string  `json:"path"`
	Title       string  `json:"title"`
	English     string  `json:"english"`
	Artist      string  `json:"artist"`
	Album       string  `json:"album"`
	Duration    float64 `json:"duration"`
	Cover       string  `json:"cover"`
	Genre       string  `json:"genre"`
	Year        string  `json:"year"`
	Color       string  `json:"color"`
	Source      string  `json:"source"`
	FileName    string  `json:"fileName"`
	Lyrics      string  `json:"lyrics,omitempty"`
	Translation string  `json:"translation,omitempty"`
	Available   bool    `json:"available"`
	Temporary   bool    `json:"temporary,omitempty"`
	Size        int64   `json:"-"`
	Modified    int64   `json:"-"`
}

type Playlist struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Cover       string  `json:"cover"`
	TrackIDs    []int64 `json:"trackIds"`
}

type Settings struct {
	DropAction          string          `json:"dropAction"`
	ScanOnStart         bool            `json:"scanOnStart"`
	ScanIntervalMinutes int             `json:"scanIntervalMinutes"`
	Theme               string          `json:"theme"`
	Appearance          string          `json:"appearance"`
	Visual              string          `json:"visual"`
	LyricEffect         string          `json:"lyricEffect"`
	LyricScroll         string          `json:"lyricScroll"`
	ShowTranslation     bool            `json:"showTranslation"`
	LyricAppearance     json.RawMessage `json:"lyricAppearance"`
	ArtistMappings      json.RawMessage `json:"artistMappings"`
	Volume              int             `json:"volume"`
	Mode                string          `json:"mode"`
	Effect              string          `json:"effect"`
	Equalizer           []float64       `json:"equalizer"`
}

func DefaultSettings() Settings {
	return Settings{DropAction: "ask", ScanOnStart: true, Theme: "dusk", Appearance: "dark", Visual: "频谱", LyricEffect: "流动", LyricScroll: "平滑", ShowTranslation: true, LyricAppearance: json.RawMessage(`{"font":"default","size":16,"lineHeight":57,"spacing":0}`), ArtistMappings: json.RawMessage(`[]`), Volume: 65, Mode: "list", Effect: "原声", Equalizer: []float64{0, 0, 0, 0, 0}}
}

type State struct {
	Tracks    []Track    `json:"tracks"`
	Playlists []Playlist `json:"playlists"`
	Liked     []int64    `json:"liked"`
	Recent    []int64    `json:"recent"`
	Queue     []int64    `json:"queue"`
	Folders   []string   `json:"folders"`
	Settings  Settings   `json:"settings"`
}

type Store struct {
	DB            *sql.DB
	Root          string
	mu            sync.Mutex
	temporary     map[int64]Track
	nextTemporary int64
	scanning      bool
}

func Open(root string) (*Store, error) {
	if root == "" {
		root = os.Getenv("LUMA_TUNE_DATA_DIR")
	}
	if root == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			return nil, err
		}
		root = filepath.Join(base, "LumaTune")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "cache", "covers"), 0700); err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "data"), 0700); err != nil {
		return nil, err
	}
	db, err := sql.Open("sqlite", filepath.Join(root, "data", "library.db"))
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	store := &Store{DB: db, Root: root, temporary: map[int64]Track{}, nextTemporary: -1}
	if _, err = db.Exec(`PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;`); err != nil {
		db.Close()
		return nil, err
	}
	if err = store.migrate(); err != nil {
		db.Close()
		return nil, err
	}
	return store, nil
}

func (s *Store) Close() error { return s.DB.Close() }

func (s *Store) migrate() error {
	_, err := s.DB.Exec(`CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL);
	INSERT INTO schema_version(version) SELECT 1 WHERE NOT EXISTS(SELECT 1 FROM schema_version);
	CREATE TABLE IF NOT EXISTS tracks(id INTEGER PRIMARY KEY,path TEXT NOT NULL COLLATE NOCASE UNIQUE,title TEXT NOT NULL,artist TEXT NOT NULL,album TEXT NOT NULL,duration REAL NOT NULL DEFAULT 0,cover TEXT NOT NULL DEFAULT '',genre TEXT NOT NULL DEFAULT '',year TEXT NOT NULL DEFAULT '',lyrics TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL,modified INTEGER NOT NULL,available INTEGER NOT NULL DEFAULT 1,added_at INTEGER NOT NULL);
	CREATE TABLE IF NOT EXISTS playlists(id TEXT PRIMARY KEY,name TEXT NOT NULL,description TEXT NOT NULL DEFAULT '',cover TEXT NOT NULL DEFAULT '');
	CREATE TABLE IF NOT EXISTS playlist_tracks(playlist_id TEXT NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,position INTEGER NOT NULL,PRIMARY KEY(playlist_id,track_id));
	CREATE TABLE IF NOT EXISTS liked(track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE);
	CREATE TABLE IF NOT EXISTS history(track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,played_at INTEGER NOT NULL);
	CREATE TABLE IF NOT EXISTS queue(track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,position INTEGER NOT NULL);
	CREATE TABLE IF NOT EXISTS folders(path TEXT PRIMARY KEY COLLATE NOCASE);
	CREATE TABLE IF NOT EXISTS preferences(key TEXT PRIMARY KEY,value TEXT NOT NULL);
	CREATE TABLE IF NOT EXISTS metadata_cache(key TEXT PRIMARY KEY,value TEXT NOT NULL,expires_at INTEGER NOT NULL);
	CREATE INDEX IF NOT EXISTS tracks_artist ON tracks(artist); CREATE INDEX IF NOT EXISTS history_played_at ON history(played_at DESC);`)
	if err != nil {
		return err
	}
	var version int
	if err = s.DB.QueryRow(`SELECT version FROM schema_version LIMIT 1`).Scan(&version); err != nil {
		return err
	}
	if version < 2 {
		tx, beginErr := s.DB.Begin()
		if beginErr != nil {
			return beginErr
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`ALTER TABLE tracks ADD COLUMN translation TEXT NOT NULL DEFAULT ''`); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE schema_version SET version=2`); err != nil {
			return err
		}
		return tx.Commit()
	}
	return nil
}

func (s *Store) Settings() (Settings, error) {
	value := DefaultSettings()
	var raw string
	err := s.DB.QueryRow(`SELECT value FROM preferences WHERE key='settings'`).Scan(&raw)
	if errors.Is(err, sql.ErrNoRows) {
		return value, nil
	}
	if err != nil {
		return value, err
	}
	if err = json.Unmarshal([]byte(raw), &value); err != nil {
		return DefaultSettings(), err
	}
	return value, nil
}

func (s *Store) SaveSettings(value Settings) error {
	if value.DropAction != "ask" && value.DropAction != "temporary" && value.DropAction != "library" && value.DropAction != "watch" {
		return errors.New("invalid drop action")
	}
	if value.ScanIntervalMinutes < 0 || value.ScanIntervalMinutes > 10080 {
		return errors.New("invalid scan interval")
	}
	if value.Volume < 0 || value.Volume > 100 {
		return errors.New("invalid volume")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO preferences(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw))
	return err
}

func (s *Store) State() (State, error) {
	state := State{Tracks: []Track{}, Playlists: []Playlist{}, Liked: []int64{}, Recent: []int64{}, Queue: []int64{}, Folders: []string{}}
	var err error
	state.Settings, err = s.Settings()
	if err != nil {
		return state, err
	}
	rows, err := s.DB.Query(`SELECT id,path,title,artist,album,duration,cover,genre,year,lyrics,translation,size,modified,available FROM tracks ORDER BY id`)
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var t Track
		var available int
		if err = rows.Scan(&t.ID, &t.Path, &t.Title, &t.Artist, &t.Album, &t.Duration, &t.Cover, &t.Genre, &t.Year, &t.Lyrics, &t.Translation, &t.Size, &t.Modified, &available); err != nil {
			rows.Close()
			return state, err
		}
		t.Available = available == 1
		t.Source = "/api/media/audio/" + formatID(t.ID)
		t.FileName = filepath.Base(t.Path)
		t.Color = "#8daab0"
		state.Tracks = append(state.Tracks, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return state, err
	}
	rows, err = s.DB.Query(`SELECT id,name,description,cover FROM playlists ORDER BY rowid`)
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var p Playlist
		if err = rows.Scan(&p.ID, &p.Name, &p.Description, &p.Cover); err != nil {
			rows.Close()
			return state, err
		}
		p.TrackIDs = []int64{}
		state.Playlists = append(state.Playlists, p)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return state, err
	}
	for i := range state.Playlists {
		rows, err = s.DB.Query(`SELECT track_id FROM playlist_tracks WHERE playlist_id=? ORDER BY position`, state.Playlists[i].ID)
		if err != nil {
			return state, err
		}
		for rows.Next() {
			var id int64
			if err = rows.Scan(&id); err != nil {
				break
			}
			state.Playlists[i].TrackIDs = append(state.Playlists[i].TrackIDs, id)
		}
		rows.Close()
		if err != nil {
			return state, err
		}
	}
	for _, item := range []struct {
		query string
		dest  *[]int64
	}{{`SELECT track_id FROM liked ORDER BY rowid`, &state.Liked}, {`SELECT track_id FROM history ORDER BY played_at DESC LIMIT 50`, &state.Recent}, {`SELECT track_id FROM queue ORDER BY position`, &state.Queue}} {
		rows, err = s.DB.Query(item.query)
		if err != nil {
			return state, err
		}
		for rows.Next() {
			var id int64
			if err = rows.Scan(&id); err != nil {
				break
			}
			*item.dest = append(*item.dest, id)
		}
		rows.Close()
		if err != nil {
			return state, err
		}
	}
	rows, err = s.DB.Query(`SELECT path FROM folders ORDER BY path`)
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var path string
		if err = rows.Scan(&path); err != nil {
			break
		}
		state.Folders = append(state.Folders, path)
	}
	rows.Close()
	return state, err
}

func (s *Store) SaveIDs(table string, ids []int64) error {
	if table != "liked" && table != "queue" {
		return errors.New("invalid list")
	}
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM ` + table); err != nil {
		return err
	}
	for index, id := range ids {
		if id <= 0 {
			continue
		}
		if table == "queue" {
			_, err = tx.Exec(`INSERT OR IGNORE INTO queue(track_id,position) VALUES(?,?)`, id, index)
		} else {
			_, err = tx.Exec(`INSERT OR IGNORE INTO liked(track_id) VALUES(?)`, id)
		}
		if err != nil {
			return err
		}
	}
	return tx.Commit()
}

func (s *Store) RecordPlay(id int64) error {
	if id <= 0 {
		return nil
	}
	_, err := s.DB.Exec(`INSERT INTO history(track_id,played_at) VALUES(?,?) ON CONFLICT(track_id) DO UPDATE SET played_at=excluded.played_at`, id, time.Now().UnixNano())
	return err
}

func (s *Store) SavePlaylists(playlists []Playlist) error {
	tx, err := s.DB.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	if _, err = tx.Exec(`DELETE FROM playlists`); err != nil {
		return err
	}
	for _, p := range playlists {
		if p.ID == "" || p.Name == "" {
			return errors.New("invalid playlist")
		}
		if _, err = tx.Exec(`INSERT INTO playlists(id,name,description,cover) VALUES(?,?,?,?)`, p.ID, p.Name, p.Description, p.Cover); err != nil {
			return err
		}
		for pos, id := range p.TrackIDs {
			if id <= 0 {
				continue
			}
			if _, err = tx.Exec(`INSERT OR IGNORE INTO playlist_tracks(playlist_id,track_id,position) VALUES(?,?,?)`, p.ID, id, pos); err != nil {
				return err
			}
		}
	}
	return tx.Commit()
}
