package backend

import (
	"context"
	"database/sql"
	"fmt"
	"net/http"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestLiveMusicSources(t *testing.T) {
	if os.Getenv("LUMA_TUNE_LIVE_TEST") != "1" {
		t.Skip("set LUMA_TUNE_LIVE_TEST=1 for upstream diagnostics")
	}
	music := NewMusic(testStore(t))
	result, err := music.enrich(context.Background(), "奇妙能力歌", "陈粒", "", true, true, true)
	if err != nil || result.Cover == "" || result.Lyric == "" {
		t.Fatalf("live enrichment incomplete: cover=%t lyric=%t error=%v", result.Cover != "", result.Lyric != "", err)
	}
}

func TestAlbumArtworkFallback(t *testing.T) {
	music := NewMusic(testStore(t))
	title, artist := "Same Song", "Singer"
	seed := func(key string, value any) {
		t.Helper()
		if _, err := music.cached(key, time.Hour, false, func() (any, error) { return value, nil }); err != nil {
			t.Fatal(err)
		}
	}
	seed("search:v6:ncm:"+music.normalized(title), []song{{ID: "1", Title: title, Artist: artist, Artwork: "invalid"}})
	for _, query := range []string{title, title + " " + artist} {
		seed("search:v6:qq:"+music.normalized(query), []song{})
	}
	for _, album := range []string{"First Album", "Second Album"} {
		seed("album-description:v2:"+music.normalized(album)+":"+music.normalized(artist), map[string]any{"picture": "/api/media/cover/" + url.PathEscape(album) + ".jpg"})
		query := url.Values{"title": {title}, "artist": {artist}, "album": {album}, "cover": {"1"}, "lyric": {"0"}}
		response := httptest.NewRecorder()
		music.Enrich(response, httptest.NewRequest(http.MethodGet, "/api/music/enrich?"+query.Encode(), nil))
		want := "/api/media/cover/" + url.PathEscape(album) + ".jpg"
		if response.Code != 200 || !strings.Contains(response.Body.String(), want) {
			t.Fatalf("album %q fallback: %d %s", album, response.Code, response.Body.String())
		}
	}
	result, err := music.enrich(context.Background(), title, artist, "", true, false, false)
	if err != nil || result.Cover != "" {
		t.Fatalf("unknown album gained artwork: %+v, %v", result, err)
	}
}

func TestAlbumArtworkDoesNotReplaceSongArtwork(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "song.wav")
	if err := os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "library")
	if err != nil {
		t.Fatal(err)
	}
	songCover, err := store.SaveCover(strings.NewReader("song image"), ".jpg")
	if err != nil {
		t.Fatal(err)
	}
	albumCover, err := store.SaveCover(strings.NewReader("album image"), ".jpg")
	if err != nil {
		t.Fatal(err)
	}
	api := NewAPI(store, Dialogs{}).Handler()
	update := func(cover string, fallback bool) {
		t.Helper()
		path := fmt.Sprintf("/api/tracks/%d/enrichment", tracks[0].ID)
		if fallback {
			path += "?fallback=1"
		}
		response := httptest.NewRecorder()
		api.ServeHTTP(response, httptest.NewRequest(http.MethodPut, path, strings.NewReader(fmt.Sprintf(`{"cover":%q}`, cover))))
		if response.Code != 200 {
			t.Fatalf("cover update returned %d: %s", response.Code, response.Body.String())
		}
	}
	update(songCover, false)
	update(albumCover, true)
	track, err := store.GetTrack(tracks[0].ID)
	if err != nil || track.Cover != songCover {
		t.Fatalf("album artwork replaced song artwork: %+v, %v", track, err)
	}
	if _, err = store.DB.Exec(`UPDATE tracks SET cover='/covers/local.svg' WHERE id=?`, tracks[0].ID); err != nil {
		t.Fatal(err)
	}
	update(albumCover, true)
	track, err = store.GetTrack(tracks[0].ID)
	if err != nil || track.Cover != albumCover {
		t.Fatalf("album artwork did not replace placeholder: %+v, %v", track, err)
	}
}

func testStore(t *testing.T) *Store {
	t.Helper()
	store, err := Open(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = store.Close() })
	return store
}

func TestLibraryImportAndRestore(t *testing.T) {
	store := testStore(t)
	state, err := store.State()
	if err != nil || len(state.Tracks) != 0 || len(state.Playlists) != 0 {
		t.Fatalf("new library is not empty: %+v, %v", state, err)
	}
	folder := t.TempDir()
	path := filepath.Join(folder, "track.wav")
	if err = os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "temporary")
	if err != nil || len(tracks) != 1 || tracks[0].ID >= 0 {
		t.Fatalf("temporary import: %+v, %v", tracks, err)
	}
	state, _ = store.State()
	if len(state.Tracks) != 0 {
		t.Fatal("temporary track persisted")
	}
	tracks, err = store.Import([]string{path, path}, "watch")
	if err != nil || len(tracks) != 1 || tracks[0].ID <= 0 {
		t.Fatalf("watched import: %+v, %v", tracks, err)
	}
	id := tracks[0].ID
	again, err := store.Import([]string{path}, "library")
	if err != nil || again[0].ID != id {
		t.Fatalf("duplicate path changed id: %+v, %v", again, err)
	}
	state, _ = store.State()
	if len(state.Tracks) != 1 || len(state.Folders) != 1 {
		t.Fatalf("watch did not persist: %+v", state)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	missing, err := store.GetTrack(id)
	if err != nil || missing.Available {
		t.Fatalf("missing track was lost or available: %+v, %v", missing, err)
	}
	if err = os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	restored, err := store.GetTrack(id)
	if err != nil || !restored.Available || restored.ID != id {
		t.Fatalf("restored track changed id: %+v, %v", restored, err)
	}
}

func TestAPIValidationAndRanges(t *testing.T) {
	store := testStore(t)
	api := NewAPI(store, Dialogs{}).Handler()
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/music/enrich?title=x&artist=y&cover=0&lyric=0", nil))
	if response.Code != 400 {
		t.Fatalf("invalid music query returned %d", response.Code)
	}
	response = httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/state", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"tracks":[]`) {
		t.Fatalf("invalid empty state: %d %s", response.Code, response.Body.String())
	}
	path := filepath.Join(t.TempDir(), "sound.wav")
	payload := []byte("RIFFabcdefghijklmnop")
	if err := os.WriteFile(path, payload, 0600); err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "library")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, "/api/media/audio/"+formatID(tracks[0].ID), nil)
	request.Header.Set("Range", "bytes=4-7")
	response = httptest.NewRecorder()
	api.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "abcd" {
		t.Fatalf("invalid media range: %d %q", response.Code, response.Body.String())
	}
}

func TestDatabaseSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	folder := t.TempDir()
	path := filepath.Join(folder, "persist.flac")
	if err := os.WriteFile(path, []byte("fLaCdata"), 0600); err != nil {
		t.Fatal(err)
	}
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "library")
	if err != nil {
		t.Fatal(err)
	}
	id := tracks[0].ID
	if err = store.SaveIDs("liked", []int64{id}); err != nil {
		t.Fatal(err)
	}
	if err = store.SavePlaylists([]Playlist{{ID: "mine", Name: "Mine", TrackIDs: []int64{id}}}); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, "/api/tracks/"+formatID(id)+"/enrichment", strings.NewReader(`{"cover":"","lyric":"[00:01.00]line","translation":"[00:01.00]translation"}`))
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("enrichment update failed: %d %s", response.Code, response.Body.String())
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err := store.State()
	if err != nil {
		t.Fatal(err)
	}
	if len(state.Tracks) != 1 || state.Tracks[0].ID != id || state.Tracks[0].Lyrics == "" || state.Tracks[0].Translation == "" || len(state.Liked) != 1 || len(state.Playlists) != 1 || len(state.Playlists[0].TrackIDs) != 1 {
		t.Fatalf("state did not survive restart: %+v", state)
	}
	if err = os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if _, err = store.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, err = store.State()
	if err != nil || state.Tracks[0].Available == true || len(state.Playlists[0].TrackIDs) != 1 {
		t.Fatalf("unwatched missing file handling failed: %+v, %v", state, err)
	}
}

func TestPlaylistCoverModeSurvivesRestart(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	playlists := []Playlist{
		{ID: "automatic", Name: "Automatic", CoverMode: "first-track", Cover: "/api/media/cover/old.jpg"},
		{ID: "custom", Name: "Custom", CoverMode: "upload", Cover: "/api/media/cover/custom.jpg"},
	}
	if err = store.SavePlaylists(playlists); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err := store.State()
	if err != nil || len(state.Playlists) != 2 {
		t.Fatalf("playlists after restart: %+v, %v", state.Playlists, err)
	}
	for index, expected := range playlists {
		actual := state.Playlists[index]
		if actual.CoverMode != expected.CoverMode || actual.Cover != expected.Cover {
			t.Fatalf("playlist cover changed after restart: %+v", actual)
		}
	}
	if err = store.SavePlaylists([]Playlist{{ID: "invalid", Name: "Invalid", CoverMode: "other"}}); err == nil {
		t.Fatal("invalid cover mode accepted")
	}
	state, err = store.State()
	if err != nil || len(state.Playlists) != 2 {
		t.Fatalf("failed save changed playlists: %+v, %v", state.Playlists, err)
	}
}

func TestPlaylistCoverModeMigration(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	if err = store.SavePlaylists([]Playlist{{ID: "legacy", Name: "Legacy", Cover: "/api/media/cover/old.jpg"}}); err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(root, "data", "library.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`ALTER TABLE playlists DROP COLUMN cover_mode; UPDATE schema_version SET version=2`); err != nil {
		t.Fatal(err)
	}
	if err = db.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	state, err := store.State()
	if err != nil || len(state.Playlists) != 1 || state.Playlists[0].CoverMode != "first-track" || state.Playlists[0].Cover != "/api/media/cover/old.jpg" {
		t.Fatalf("legacy cover migration: %+v, %v", state.Playlists, err)
	}
}
