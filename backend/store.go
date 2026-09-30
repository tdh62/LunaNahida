package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"math"
	"os"
	"path/filepath"
	"sync"
	"time"
	"unicode/utf8"

	_ "modernc.org/sqlite"
)

type Track struct {
	ID             int64    `json:"id"`
	Path           string   `json:"path"`
	Kind           string   `json:"kind"`
	Title          string   `json:"title"`
	English        string   `json:"english"`
	Artist         string   `json:"artist"`
	Album          string   `json:"album"`
	Duration       float64  `json:"duration"`
	Cover          string   `json:"cover"`
	Genre          string   `json:"genre"`
	EmbeddedTags   []string `json:"embeddedTags"`
	CustomTags     []string `json:"customTags"`
	Year           string   `json:"year"`
	Color          string   `json:"color"`
	Source         string   `json:"source"`
	FileName       string   `json:"fileName"`
	Lyrics         string   `json:"lyrics,omitempty"`
	Translation    string   `json:"translation,omitempty"`
	EmbeddedCover  bool     `json:"embeddedCover"`
	EmbeddedLyrics bool     `json:"embeddedLyrics"`
	LocalLyrics    bool     `json:"localLyrics"`
	Available      bool     `json:"available"`
	PlaybackStatus string   `json:"playbackStatus"`
	Provider       string   `json:"provider,omitempty"`
	ProviderID     string   `json:"providerId,omitempty"`
	Converted      bool     `json:"converted,omitempty"`
	Temporary      bool     `json:"temporary,omitempty"`
	Deletable      bool     `json:"deletable"`
	Size           int64    `json:"-"`
	Modified       int64    `json:"-"`
}

type Playlist struct {
	ID          string  `json:"id"`
	Name        string  `json:"name"`
	Description string  `json:"description"`
	Cover       string  `json:"cover"`
	CoverMode   string  `json:"coverMode"`
	TrackIDs    []int64 `json:"trackIds"`
}

type Settings struct {
	DropAction          string          `json:"dropAction"`
	NetworkCacheCount   int             `json:"networkCacheCount"`
	ScanOnStart         bool            `json:"scanOnStart"`
	ScanIntervalMinutes int             `json:"scanIntervalMinutes"`
	AutoConvert         bool            `json:"autoConvert"`
	BackupOriginal      bool            `json:"backupOriginal"`
	Theme               string          `json:"theme"`
	Appearance          string          `json:"appearance"`
	Visual              string          `json:"visual"`
	Scope               ScopeSettings   `json:"scope"`
	LyricEffect         string          `json:"lyricEffect"`
	LyricScroll         string          `json:"lyricScroll"`
	ShowTranslation     bool            `json:"showTranslation"`
	LyricAppearance     json.RawMessage `json:"lyricAppearance"`
	ArtistMappings      json.RawMessage `json:"artistMappings"`
	Volume              int             `json:"volume"`
	Mode                string          `json:"mode"`
	Effect              string          `json:"effect"`
	Equalizer           []float64       `json:"equalizer"`
	CustomEffects       []SavedEffect   `json:"customEffects"`
}

type SavedEffect struct {
	ID     string       `json:"id"`
	Name   string       `json:"name"`
	Filter CustomFilter `json:"filter"`
}

type CustomFilter struct {
	FIRSize        int             `json:"firSize"`
	FrequencyBands []FrequencyBand `json:"frequencyBands"`
	Time           string          `json:"time"`
	DurationMs     int             `json:"durationMs"`
	Delays         []FilterDelay   `json:"delays"`
}

type FrequencyBand struct {
	Expression   string   `json:"expression"`
	StartHz      float64  `json:"startHz"`
	EndHz        *float64 `json:"endHz"`
	TransitionHz float64  `json:"transitionHz"`
}

type FilterDelay struct {
	Ms   float64 `json:"ms"`
	Gain float64 `json:"gain"`
}

func validCustomFilter(filter CustomFilter) bool {
	if filter.FIRSize != 2048 && filter.FIRSize != 4096 && filter.FIRSize != 8192 && filter.FIRSize != 16384 {
		return false
	}
	if len(filter.FrequencyBands) < 1 || len(filter.FrequencyBands) > 8 || len(filter.Time) < 1 || len(filter.Time) > 200 || filter.DurationMs < 50 || filter.DurationMs > 1000 || len(filter.Delays) > 8 {
		return false
	}
	for _, band := range filter.FrequencyBands {
		if len(band.Expression) < 1 || len(band.Expression) > 200 || math.IsNaN(band.StartHz) || band.StartHz < 0 || band.StartHz > 192000 || math.IsNaN(band.TransitionHz) || band.TransitionHz < 0 || band.TransitionHz > 10000 {
			return false
		}
		if band.EndHz != nil && (math.IsNaN(*band.EndHz) || *band.EndHz <= band.StartHz || *band.EndHz > 192000) {
			return false
		}
	}
	for _, delay := range filter.Delays {
		if math.IsNaN(delay.Ms) || math.IsNaN(delay.Gain) || delay.Ms < 1 || delay.Ms > float64(filter.DurationMs) || math.Abs(delay.Gain) > 1 {
			return false
		}
	}
	return true
}

type ScopeSettings struct {
	Mode         string  `json:"mode"`
	FFTSize      int     `json:"fftSize"`
	MinFrequency int     `json:"minFrequency"`
	MaxFrequency int     `json:"maxFrequency"`
	Smoothing    float64 `json:"smoothing"`
}

func DefaultSettings() Settings {
	return Settings{DropAction: "ask", NetworkCacheCount: 10, ScanOnStart: true, BackupOriginal: true, Theme: "forest", Appearance: "light", Visual: "频谱", Scope: ScopeSettings{Mode: "spectrum", FFTSize: 8192, MinFrequency: 20, MaxFrequency: 20000, Smoothing: 0.72}, LyricEffect: "流动", LyricScroll: "平滑", ShowTranslation: true, LyricAppearance: json.RawMessage(`{"font":"default","size":16,"lineHeight":57,"spacing":0}`), ArtistMappings: json.RawMessage(`[]`), Volume: 65, Mode: "list", Effect: "原声", Equalizer: []float64{0, 0, 0, 0, 0}, CustomEffects: []SavedEffect{}}
}

type State struct {
	Tracks         []Track         `json:"tracks"`
	Tags           []string        `json:"tags"`
	Playlists      []Playlist      `json:"playlists"`
	Liked          []int64         `json:"liked"`
	Recent         []int64         `json:"recent"`
	Queue          []int64         `json:"queue"`
	Folders        []string        `json:"folders"`
	NetworkSources []NetworkSource `json:"networkSources"`
	Settings       Settings        `json:"settings"`
}

type Store struct {
	DB            *sql.DB
	Root          string
	mu            sync.Mutex
	coverMu       sync.Mutex
	convertMu     sync.Mutex
	timerMu       sync.Mutex
	temporary     map[int64]Track
	nextTemporary int64
	scanning      bool
	networkMu     sync.Mutex
	networkJobs   map[int64]bool
	networkCancel map[int64]context.CancelFunc
	networkChecks map[int64]time.Time
	networkSlots  chan struct{}
	networkWG     sync.WaitGroup
	networkClosed bool
	networkEpoch  uint64
}

func Open(root string) (*Store, error) {
	if root == "" {
		root = os.Getenv("LUNANAHIDA_DATA_DIR")
	}
	if root == "" {
		base, err := os.UserCacheDir()
		if err != nil {
			return nil, err
		}
		root = filepath.Join(base, "LunaNahida")
	}
	root, err := filepath.Abs(root)
	if err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "cache", "covers"), 0700); err != nil {
		return nil, err
	}
	if err = os.MkdirAll(filepath.Join(root, "cache", "network-audio"), 0700); err != nil {
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
	store := &Store{DB: db, Root: root, temporary: map[int64]Track{}, nextTemporary: -1, networkJobs: map[int64]bool{}, networkCancel: map[int64]context.CancelFunc{}, networkChecks: map[int64]time.Time{}, networkSlots: make(chan struct{}, 2)}
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

func (s *Store) Close() error {
	s.networkMu.Lock()
	s.networkClosed = true
	s.networkEpoch++
	for _, cancel := range s.networkCancel {
		cancel()
	}
	s.networkMu.Unlock()
	s.networkWG.Wait()
	return s.DB.Close()
}

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
		if err = tx.Commit(); err != nil {
			return err
		}
		version = 2
	}
	if version < 3 {
		tx, beginErr := s.DB.Begin()
		if beginErr != nil {
			return beginErr
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`ALTER TABLE playlists ADD COLUMN cover_mode TEXT NOT NULL DEFAULT 'first-track'`); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE schema_version SET version=3`); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		version = 3
	}
	if version < 4 {
		tx, beginErr := s.DB.Begin()
		if beginErr != nil {
			return beginErr
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`ALTER TABLE tracks ADD COLUMN embedded_cover INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE tracks ADD COLUMN embedded_lyrics INTEGER NOT NULL DEFAULT 0;
		ALTER TABLE tracks ADD COLUMN tags_checked INTEGER NOT NULL DEFAULT 0;
		UPDATE schema_version SET version=4`); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		version = 4
	}
	if version < 5 {
		tx, beginErr := s.DB.Begin()
		if beginErr != nil {
			return beginErr
		}
		defer tx.Rollback()
		if _, err = tx.Exec(`ALTER TABLE tracks ADD COLUMN local_lyrics INTEGER NOT NULL DEFAULT 0;
		UPDATE tracks SET tags_checked=0;
		UPDATE schema_version SET version=5`); err != nil {
			return err
		}
		if err = tx.Commit(); err != nil {
			return err
		}
		version = 5
	}
	if version < 6 {
		var hasColumn int
		if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='embedded_tags'`).Scan(&hasColumn); err != nil {
			return err
		}
		if hasColumn == 0 {
			if _, err = s.DB.Exec(`ALTER TABLE tracks ADD COLUMN embedded_tags TEXT NOT NULL DEFAULT '[]'`); err != nil {
				return err
			}
		}
		_, err = s.DB.Exec(`CREATE TABLE IF NOT EXISTS custom_tags(name TEXT PRIMARY KEY COLLATE NOCASE);
		CREATE TABLE IF NOT EXISTS track_custom_tags(track_id INTEGER NOT NULL REFERENCES tracks(id) ON DELETE CASCADE,name TEXT NOT NULL REFERENCES custom_tags(name) ON UPDATE CASCADE ON DELETE CASCADE,PRIMARY KEY(track_id,name));
		UPDATE tracks SET tags_checked=0;
		UPDATE schema_version SET version=6`)
		if err != nil {
			return err
		}
	}
	if version < 7 {
		var hasColumn int
		if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='playback_status'`).Scan(&hasColumn); err != nil {
			return err
		}
		if hasColumn == 0 {
			if _, err = s.DB.Exec(`ALTER TABLE tracks ADD COLUMN playback_status TEXT NOT NULL DEFAULT 'unknown'`); err != nil {
				return err
			}
		}
		if _, err = s.DB.Exec(`UPDATE schema_version SET version=7`); err != nil {
			return err
		}
	}
	if version < 8 {
		for _, column := range []string{"provider", "provider_id"} {
			var hasColumn int
			if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name=?`, column).Scan(&hasColumn); err != nil {
				return err
			}
			if hasColumn == 0 {
				if _, err = s.DB.Exec(`ALTER TABLE tracks ADD COLUMN ` + column + ` TEXT NOT NULL DEFAULT ''`); err != nil {
					return err
				}
			}
		}
		if _, err = s.DB.Exec(`UPDATE schema_version SET version=8`); err != nil {
			return err
		}
	}
	if version < 9 {
		var hasColumn int
		if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='converted'`).Scan(&hasColumn); err != nil {
			return err
		}
		if hasColumn == 0 {
			if _, err = s.DB.Exec(`ALTER TABLE tracks ADD COLUMN converted INTEGER NOT NULL DEFAULT 0`); err != nil {
				return err
			}
		}
		if _, err = s.DB.Exec(`UPDATE schema_version SET version=9`); err != nil {
			return err
		}
	}
	if version < 10 {
		var hasColumn int
		if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='folder_imported'`).Scan(&hasColumn); err != nil {
			return err
		}
		if hasColumn == 0 {
			if _, err = s.DB.Exec(`ALTER TABLE tracks ADD COLUMN folder_imported INTEGER NOT NULL DEFAULT 0`); err != nil {
				return err
			}
		}
		if _, err = s.DB.Exec(`UPDATE schema_version SET version=10`); err != nil {
			return err
		}
	}
	if version < 11 {
		var hasColumn int
		if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('tracks') WHERE name='manual_metadata'`).Scan(&hasColumn); err != nil {
			return err
		}
		if hasColumn == 0 {
			if _, err = s.DB.Exec(`ALTER TABLE tracks ADD COLUMN manual_metadata INTEGER NOT NULL DEFAULT 0`); err != nil {
				return err
			}
		}
		if _, err = s.DB.Exec(`UPDATE schema_version SET version=11`); err != nil {
			return err
		}
	}
	if version < 12 {
		if _, err = s.DB.Exec(`CREATE TABLE IF NOT EXISTS network_tracks(track_id INTEGER PRIMARY KEY REFERENCES tracks(id) ON DELETE CASCADE,url TEXT NOT NULL,etag TEXT NOT NULL DEFAULT '',last_modified TEXT NOT NULL DEFAULT '',size INTEGER NOT NULL DEFAULT 0);
		UPDATE schema_version SET version=12`); err != nil {
			return err
		}
	}
	if version < 13 {
		var hasColumn int
		if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('network_tracks') WHERE name='content_type'`).Scan(&hasColumn); err != nil {
			return err
		}
		if hasColumn == 0 {
			if _, err = s.DB.Exec(`ALTER TABLE network_tracks ADD COLUMN content_type TEXT NOT NULL DEFAULT ''`); err != nil {
				return err
			}
		}
		if _, err = s.DB.Exec(`UPDATE schema_version SET version=13`); err != nil {
			return err
		}
	}
	if version < 14 {
		if _, err = s.DB.Exec(`CREATE TABLE IF NOT EXISTS network_sources(id INTEGER PRIMARY KEY,kind TEXT NOT NULL,url TEXT NOT NULL,username TEXT NOT NULL DEFAULT '',secret BLOB NOT NULL DEFAULT X'',UNIQUE(kind,url))`); err != nil {
			return err
		}
		for _, column := range []struct{ name, definition string }{{"source_id", "INTEGER REFERENCES network_sources(id) ON DELETE CASCADE"}, {"remote_key", "TEXT NOT NULL DEFAULT ''"}} {
			var found int
			if err = s.DB.QueryRow(`SELECT COUNT(*) FROM pragma_table_info('network_tracks') WHERE name=?`, column.name).Scan(&found); err != nil {
				return err
			}
			if found == 0 {
				if _, err = s.DB.Exec(`ALTER TABLE network_tracks ADD COLUMN ` + column.name + ` ` + column.definition); err != nil {
					return err
				}
			}
		}
		if _, err = s.DB.Exec(`CREATE INDEX IF NOT EXISTS network_tracks_source ON network_tracks(source_id); UPDATE schema_version SET version=14`); err != nil {
			return err
		}
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
	if value.Scope.Mode != "spectrum" && value.Scope.Mode != "waveform" {
		value.Scope.Mode = "spectrum"
	}
	if value.Scope.FFTSize != 2048 && value.Scope.FFTSize != 4096 && value.Scope.FFTSize != 8192 && value.Scope.FFTSize != 16384 {
		value.Scope.FFTSize = 8192
	}
	if value.Scope.MinFrequency < 20 || value.Scope.MinFrequency >= value.Scope.MaxFrequency {
		value.Scope.MinFrequency = 20
	}
	if value.Scope.MaxFrequency < 100 || value.Scope.MaxFrequency > 192000 {
		value.Scope.MaxFrequency = 20000
	}
	if value.CustomEffects == nil {
		value.CustomEffects = []SavedEffect{}
	}
	if value.NetworkCacheCount < 0 || value.NetworkCacheCount > 50 {
		value.NetworkCacheCount = 10
	}
	if value.Scope.Smoothing < 0 || value.Scope.Smoothing > 0.95 {
		value.Scope.Smoothing = 0.72
	}
	return value, nil
}

func (s *Store) SaveSettings(value Settings) error {
	previous, err := s.Settings()
	if err != nil {
		return err
	}
	if value.NetworkCacheCount < 0 || value.NetworkCacheCount > 50 {
		return errors.New("invalid network cache count")
	}
	if value.DropAction != "ask" && value.DropAction != "temporary" && value.DropAction != "library" && value.DropAction != "watch" {
		return errors.New("invalid drop action")
	}
	if value.ScanIntervalMinutes < 0 || value.ScanIntervalMinutes > 10080 {
		return errors.New("invalid scan interval")
	}
	if value.Volume < 0 || value.Volume > 100 {
		return errors.New("invalid volume")
	}
	if value.Scope.Mode != "spectrum" && value.Scope.Mode != "waveform" {
		return errors.New("invalid scope mode")
	}
	if value.Scope.FFTSize != 2048 && value.Scope.FFTSize != 4096 && value.Scope.FFTSize != 8192 && value.Scope.FFTSize != 16384 {
		return errors.New("invalid scope fft size")
	}
	if value.Scope.MinFrequency < 20 || value.Scope.MaxFrequency > 192000 || value.Scope.MaxFrequency < 100 || value.Scope.MinFrequency >= value.Scope.MaxFrequency {
		return errors.New("invalid scope frequency")
	}
	if len(value.CustomEffects) > 40 {
		return errors.New("too many custom effects")
	}
	seenEffects := map[string]bool{}
	for _, effect := range value.CustomEffects {
		if len(effect.ID) == 0 || len(effect.ID) > 80 || utf8.RuneCountInString(effect.Name) == 0 || utf8.RuneCountInString(effect.Name) > 60 || seenEffects[effect.ID] {
			return errors.New("invalid custom effect name or id")
		}
		seenEffects[effect.ID] = true
		if !validCustomFilter(effect.Filter) {
			return errors.New("invalid custom effect filter")
		}
	}
	if value.Scope.Smoothing < 0 || value.Scope.Smoothing > 0.95 {
		return errors.New("invalid scope smoothing")
	}
	raw, err := json.Marshal(value)
	if err != nil {
		return err
	}
	_, err = s.DB.Exec(`INSERT INTO preferences(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw))
	if err != nil || previous.NetworkCacheCount == value.NetworkCacheCount {
		return err
	}
	if err = s.pruneNetworkCache(value.NetworkCacheCount); err != nil {
		return err
	}
	if value.NetworkCacheCount > previous.NetworkCacheCount {
		return s.backfillNetworkCache(value.NetworkCacheCount)
	}
	return nil
}

func (s *Store) State() (State, error) {
	state := State{Tracks: []Track{}, Tags: []string{}, Playlists: []Playlist{}, Liked: []int64{}, Recent: []int64{}, Queue: []int64{}, Folders: []string{}, NetworkSources: []NetworkSource{}}
	if err := s.recheckLegacyTags(); err != nil {
		return state, err
	}
	var err error
	state.Settings, err = s.Settings()
	if err != nil {
		return state, err
	}
	state.NetworkSources, err = s.NetworkSources()
	if err != nil {
		return state, err
	}
	rows, err := s.DB.Query(`SELECT id,path,title,artist,album,duration,cover,genre,year,lyrics,translation,size,modified,available,embedded_cover,embedded_lyrics,local_lyrics,embedded_tags,playback_status,provider,provider_id,converted,folder_imported FROM tracks ORDER BY id`)
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var t Track
		var available, embeddedCover, embeddedLyrics, localLyrics, converted, folderImported int
		var embeddedJSON string
		if err = rows.Scan(&t.ID, &t.Path, &t.Title, &t.Artist, &t.Album, &t.Duration, &t.Cover, &t.Genre, &t.Year, &t.Lyrics, &t.Translation, &t.Size, &t.Modified, &available, &embeddedCover, &embeddedLyrics, &localLyrics, &embeddedJSON, &t.PlaybackStatus, &t.Provider, &t.ProviderID, &converted, &folderImported); err != nil {
			rows.Close()
			return state, err
		}
		t.Available = available == 1
		t.Converted = converted == 1
		t.Deletable = folderImported == 0
		t.EmbeddedCover = embeddedCover == 1
		t.EmbeddedLyrics = embeddedLyrics == 1
		t.LocalLyrics = localLyrics == 1
		t.Source = "/api/media/audio/" + formatID(t.ID)
		t.FileName = filepath.Base(t.Path)
		t.Color = "#8daab0"
		t.EmbeddedTags = decodeTags(embeddedJSON)
		t.CustomTags = []string{}
		state.Tracks = append(state.Tracks, t)
	}
	err = rows.Err()
	rows.Close()
	if err != nil {
		return state, err
	}
	for i := range state.Tracks {
		if err = s.decorateNetworkTrack(&state.Tracks[i]); err != nil {
			return state, err
		}
	}
	if err = s.loadCustomTags(&state); err != nil {
		return state, err
	}
	rows, err = s.DB.Query(`SELECT id,name,description,cover,cover_mode FROM playlists ORDER BY rowid`)
	if err != nil {
		return state, err
	}
	for rows.Next() {
		var p Playlist
		if err = rows.Scan(&p.ID, &p.Name, &p.Description, &p.Cover, &p.CoverMode); err != nil {
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
	if err == nil {
		for i := range state.Tracks {
			for _, folder := range state.Folders {
				if pathWithin(folder, state.Tracks[i].Path) {
					state.Tracks[i].Deletable = false
					break
				}
			}
		}
	}
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
	if err == nil {
		s.scheduleNetworkCache(id)
	}
	return err
}

func (s *Store) SavePlaylists(playlists []Playlist) error {
	s.coverMu.Lock()
	defer s.coverMu.Unlock()
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
		if p.CoverMode == "" {
			p.CoverMode = "first-track"
		}
		if p.CoverMode != "first-track" && p.CoverMode != "upload" {
			return errors.New("invalid playlist cover mode")
		}
		if _, err = tx.Exec(`INSERT INTO playlists(id,name,description,cover,cover_mode) VALUES(?,?,?,?,?)`, p.ID, p.Name, p.Description, p.Cover, p.CoverMode); err != nil {
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
