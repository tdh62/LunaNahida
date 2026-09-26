package backend

import (
	"bytes"
	"context"
	"crypto/md5"
	"database/sql"
	"encoding/binary"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/png"
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

func embeddedMP3(t *testing.T, path string) {
	t.Helper()
	var picture bytes.Buffer
	pixel := image.NewRGBA(image.Rect(0, 0, 1, 1))
	pixel.Set(0, 0, color.RGBA{R: 220, G: 70, B: 90, A: 255})
	if err := png.Encode(&picture, pixel); err != nil {
		t.Fatal(err)
	}
	frame := func(name string, payload []byte) []byte {
		value := make([]byte, 10+len(payload))
		copy(value, name)
		binary.BigEndian.PutUint32(value[4:8], uint32(len(payload)))
		copy(value[10:], payload)
		return value
	}
	frames := bytes.Join([][]byte{
		frame("TIT2", append([]byte{3}, []byte("Embedded Track")...)),
		frame("TPE1", append([]byte{3}, []byte("Singer")...)),
		frame("TALB", append([]byte{3}, []byte("Album")...)),
		frame("USLT", append([]byte{3, 'e', 'n', 'g', 0}, []byte("[00:01.00]Embedded lyric")...)),
		frame("APIC", append([]byte{3}, append([]byte("image/png\x00\x03\x00"), picture.Bytes()...)...)),
	}, nil)
	size := len(frames)
	header := []byte{'I', 'D', '3', 3, 0, 0, byte(size >> 21), byte(size >> 14 & 0x7f), byte(size >> 7 & 0x7f), byte(size & 0x7f)}
	if err := os.WriteFile(path, append(header, frames...), 0600); err != nil {
		t.Fatal(err)
	}
}

func TestEmbeddedMetadataHasPriority(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "embedded.mp3")
	embeddedMP3(t, path)
	temporary, err := store.Import([]string{path}, "temporary")
	if err != nil || len(temporary) != 1 || !temporary[0].EmbeddedCover || !temporary[0].EmbeddedLyrics {
		t.Fatalf("temporary embedded track: %+v, %v", temporary, err)
	}
	tracks, err := store.Import([]string{path}, "library")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("import embedded track: %+v, %v", tracks, err)
	}
	track := tracks[0]
	if !track.EmbeddedCover || !track.EmbeddedLyrics || !strings.HasSuffix(track.Cover, ".png") || track.Lyrics != "[00:01.00]Embedded lyric" {
		t.Fatalf("embedded metadata missing: %+v", track)
	}
	onlineCover, err := store.SaveCover(strings.NewReader("online image"), ".jpg")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPut, fmt.Sprintf("/api/tracks/%d/enrichment", track.ID), strings.NewReader(fmt.Sprintf(`{"cover":%q,"lyric":"[00:02.00]Online lyric","translation":"Online translation"}`, onlineCover)))
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, request)
	if response.Code != 200 {
		t.Fatalf("online enrichment returned %d: %s", response.Code, response.Body.String())
	}
	updated, err := store.GetTrack(track.ID)
	if err != nil || updated.Cover != track.Cover || updated.Lyrics != track.Lyrics || updated.Translation != "" || !updated.EmbeddedCover || !updated.EmbeddedLyrics {
		t.Fatalf("online metadata replaced embedded data: %+v, %v", updated, err)
	}
}

func TestExistingLibraryRechecksEmbeddedMetadata(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "existing.mp3")
	embeddedMP3(t, path)
	tracks, err := store.Import([]string{path}, "library")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	db, err := sql.Open("sqlite", filepath.Join(root, "data", "library.db"))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = db.Exec(`UPDATE tracks SET cover='/covers/local.svg', lyrics='old online lyric', translation='old translation';
		ALTER TABLE tracks DROP COLUMN embedded_cover;
		ALTER TABLE tracks DROP COLUMN embedded_lyrics;
		ALTER TABLE tracks DROP COLUMN tags_checked;
		UPDATE schema_version SET version=3`); err != nil {
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
	if err != nil || len(state.Tracks) != 1 || state.Tracks[0].ID != tracks[0].ID || !state.Tracks[0].EmbeddedCover || !state.Tracks[0].EmbeddedLyrics || state.Tracks[0].Lyrics != "[00:01.00]Embedded lyric" || state.Tracks[0].Translation != "" {
		t.Fatalf("legacy embedded metadata not restored: %+v, %v", state.Tracks, err)
	}
}

func TestCoverMD5Deduplication(t *testing.T) {
	store := testStore(t)
	content := []byte("same image bytes")
	first, err := store.SaveCover(bytes.NewReader(content), ".jpg")
	if err != nil {
		t.Fatal(err)
	}
	sum := md5.Sum(content)
	if first != fmt.Sprintf("/api/media/cover/%x.jpg", sum) {
		t.Fatalf("unexpected cover name: %s", first)
	}
	path, err := store.CoverPath(coverName(first))
	if err != nil {
		t.Fatal(err)
	}
	before, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	second, err := store.SaveCover(bytes.NewReader(content), ".png")
	if err != nil || second != first {
		t.Fatalf("duplicate image was saved again: %s, %v", second, err)
	}
	after, err := os.Stat(path)
	if err != nil || !after.ModTime().Equal(before.ModTime()) {
		t.Fatalf("duplicate image was rewritten: %v", err)
	}
	entries, err := os.ReadDir(filepath.Join(store.Root, "cache", "covers"))
	if err != nil || len(entries) != 1 {
		t.Fatalf("unexpected cover files: %+v, %v", entries, err)
	}
}

func TestClearCachePreservesLocalArtworkAndLibrary(t *testing.T) {
	root := t.TempDir()
	store, err := Open(root)
	if err != nil {
		t.Fatal(err)
	}
	embeddedPath := filepath.Join(t.TempDir(), "embedded.mp3")
	embeddedMP3(t, embeddedPath)
	embeddedTracks, err := store.Import([]string{embeddedPath}, "library")
	if err != nil {
		t.Fatal(err)
	}
	plainPath := filepath.Join(t.TempDir(), "plain.wav")
	if err = os.WriteFile(plainPath, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	plainTracks, err := store.Import([]string{plainPath}, "library")
	if err != nil {
		t.Fatal(err)
	}
	networkCover, err := store.SaveCover(strings.NewReader("network image"), ".jpg")
	if err != nil {
		t.Fatal(err)
	}
	uploadCover, err := store.SaveCover(strings.NewReader("custom image"), ".png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(`UPDATE tracks SET cover=? WHERE id=?`, networkCover, plainTracks[0].ID); err != nil {
		t.Fatal(err)
	}
	if err = store.SavePlaylists([]Playlist{{ID: "custom", Name: "Custom", CoverMode: "upload", Cover: uploadCover, TrackIDs: []int64{plainTracks[0].ID}}}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(`INSERT INTO metadata_cache(key,value,expires_at) VALUES('artist','cached data',9999999999)`); err != nil {
		t.Fatal(err)
	}
	webviewPath := filepath.Join(root, "cache", "webview", "Default", "Cache")
	if err = os.MkdirAll(webviewPath, 0700); err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(filepath.Join(webviewPath, "entry"), []byte("webview cache"), 0600); err != nil {
		t.Fatal(err)
	}
	before, err := store.CacheStats()
	if err != nil || before.CoverBytes == 0 || before.WebviewBytes == 0 || before.MetadataBytes == 0 {
		t.Fatalf("cache statistics incomplete: %+v, %v", before, err)
	}
	api := NewAPI(store, Dialogs{}).Handler()
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/cache", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"coverBytes"`) {
		t.Fatalf("cache statistics endpoint: %d %s", response.Code, response.Body.String())
	}
	response = httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/cache/clear", nil))
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"webviewClearPending":true`) {
		t.Fatalf("cache cleanup endpoint: %d %s", response.Code, response.Body.String())
	}
	after, err := store.CacheStats()
	if err != nil || !after.WebviewClearPending || after.MetadataBytes != 0 || after.CoverBytes >= before.CoverBytes {
		t.Fatalf("cache was not cleared: %+v, %v", after, err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 2 || len(state.Playlists) != 1 || state.Playlists[0].Cover != uploadCover {
		t.Fatalf("library changed during cache cleanup: %+v, %v", state, err)
	}
	embedded, err := store.GetTrack(embeddedTracks[0].ID)
	if err != nil || embedded.Cover != embeddedTracks[0].Cover || !embedded.EmbeddedCover {
		t.Fatalf("embedded artwork removed: %+v, %v", embedded, err)
	}
	plain, err := store.GetTrack(plainTracks[0].ID)
	if err != nil || plain.Cover != "/covers/local.svg" {
		t.Fatalf("online artwork reference survived cleanup: %+v, %v", plain, err)
	}
	for _, reference := range []string{embedded.Cover, uploadCover} {
		path, pathErr := store.CoverPath(coverName(reference))
		if pathErr != nil {
			t.Fatal(pathErr)
		}
		if _, pathErr = os.Stat(path); pathErr != nil {
			t.Fatalf("retained cover missing: %s, %v", reference, pathErr)
		}
	}
	path, err := store.CoverPath(coverName(networkCover))
	if err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("network cover still present: %v", err)
	}
	if err = store.Close(); err != nil {
		t.Fatal(err)
	}
	store, err = Open(root)
	if err != nil {
		t.Fatal(err)
	}
	defer store.Close()
	if err = store.ClearPendingWebviewCache(); err != nil {
		t.Fatal(err)
	}
	if _, err = os.Stat(filepath.Join(root, "cache", "webview")); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("webview cache survived restart: %v", err)
	}
	stats, err := store.CacheStats()
	if err != nil || stats.WebviewClearPending || stats.WebviewBytes != 0 {
		t.Fatalf("webview cleanup still pending: %+v, %v", stats, err)
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
	if _, err = db.Exec(`ALTER TABLE playlists DROP COLUMN cover_mode;
		ALTER TABLE tracks DROP COLUMN embedded_cover;
		ALTER TABLE tracks DROP COLUMN embedded_lyrics;
		ALTER TABLE tracks DROP COLUMN tags_checked;
		UPDATE schema_version SET version=2`); err != nil {
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
