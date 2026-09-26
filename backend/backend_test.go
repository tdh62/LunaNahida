package backend

import (
	"context"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestLiveMusicSources(t *testing.T) {
	if os.Getenv("LUMA_TUNE_LIVE_TEST") != "1" {
		t.Skip("set LUMA_TUNE_LIVE_TEST=1 for upstream diagnostics")
	}
	music := NewMusic(testStore(t))
	result, err := music.enrich(context.Background(), "奇妙能力歌", "陈粒", true, true, true)
	if err != nil || result.Cover == "" || result.Lyric == "" {
		t.Fatalf("live enrichment incomplete: cover=%t lyric=%t error=%v", result.Cover != "", result.Lyric != "", err)
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
