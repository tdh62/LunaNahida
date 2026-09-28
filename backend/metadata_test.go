package backend

import (
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestEditTrackMetadataSurvivesRescan(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "original.wav")
	if err := os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "library")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("import: %v, %+v", err, tracks)
	}
	id := tracks[0].ID
	endpoint := fmt.Sprintf("/api/tracks/%d/metadata", id)
	api := NewAPI(store, Dialogs{}).Handler()
	for _, body := range []string{`{"title":"  ","artist":"Singer","album":"Album"}`, `{"title":"Song","artist":"Singer","album":""}`} {
		response := httptest.NewRecorder()
		api.ServeHTTP(response, httptest.NewRequest(http.MethodPut, endpoint, strings.NewReader(body)))
		if response.Code != 400 {
			t.Fatalf("invalid metadata accepted: %d %s", response.Code, response.Body.String())
		}
	}
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodPut, endpoint, strings.NewReader(`{"title":" New Song ","artist":" New Singer ","album":" New Album "}`)))
	if response.Code != 200 {
		t.Fatalf("update: %d %s", response.Code, response.Body.String())
	}
	if !strings.Contains(response.Body.String(), `"title":"New Song"`) {
		t.Fatalf("response did not contain trimmed title: %s", response.Body.String())
	}
	if err := os.WriteFile(path, []byte("RIFFsample audio changed"), 0600); err != nil {
		t.Fatal(err)
	}
	rescanned, err := store.upsert(path)
	if err != nil {
		t.Fatal(err)
	}
	if rescanned.Title != "New Song" || rescanned.Artist != "New Singer" || rescanned.Album != "New Album" {
		t.Fatalf("manual metadata lost on rescan: %+v", rescanned)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 1 || state.Tracks[0].Title != "New Song" {
		t.Fatalf("state after update: %v, %+v", err, state.Tracks)
	}
}

func TestEditTemporaryTrackMetadata(t *testing.T) {
	store := testStore(t)
	path := filepath.Join(t.TempDir(), "temporary.wav")
	if err := os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	tracks, err := store.Import([]string{path}, "temporary")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("temporary import: %v, %+v", err, tracks)
	}
	endpoint := fmt.Sprintf("/api/tracks/%d/metadata", tracks[0].ID)
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, httptest.NewRequest(http.MethodPut, endpoint, strings.NewReader(`{"title":"Song","artist":"Singer","album":"Album"}`)))
	if response.Code != 200 {
		t.Fatalf("temporary update: %d %s", response.Code, response.Body.String())
	}
	updated, err := store.GetTrack(tracks[0].ID)
	if err != nil || updated.Title != "Song" || updated.Artist != "Singer" || updated.Album != "Album" {
		t.Fatalf("temporary metadata: %+v, %v", updated, err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 0 {
		t.Fatalf("temporary track entered library: %+v, %v", state.Tracks, err)
	}
}
