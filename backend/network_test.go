package backend

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func waitForNetworkCache(t *testing.T, store *Store, id int64) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for time.Now().Before(deadline) {
		if _, err := os.Stat(store.networkCachePath(id)); err == nil {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	t.Fatal("network audio was not cached")
}

func TestNetworkSongPlaybackAndRecentCache(t *testing.T) {
	store := testStore(t)
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	settings.NetworkCacheCount = 1
	if err = store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	var first atomic.Value
	first.Store("RIFFabcdefghij")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := "RIFFklmnopqrst"
		if strings.HasSuffix(r.URL.Path, "one.wav") {
			body = first.Load().(string)
		}
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("ETag", fmt.Sprintf("%q", body))
		w.Header().Set("Accept-Ranges", "bytes")
		if r.Header.Get("Range") == "bytes=0-0" {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-0/%d", len(body)))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte(body[:1]))
			return
		}
		if r.Header.Get("Range") == "bytes=4-7" {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes 4-7/%d", len(body)))
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte(body[4:8]))
			return
		}
		w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		if r.Method != http.MethodHead {
			_, _ = w.Write([]byte(body))
		}
	}))
	defer server.Close()
	firstTrack, err := store.ImportNetwork(context.Background(), server.URL+"/one.wav")
	if err != nil || firstTrack.Kind != "network" || firstTrack.Path != "" || firstTrack.FileName != "one.wav" {
		t.Fatalf("import network song: %+v, %v", firstTrack, err)
	}
	api := NewAPI(store, Dialogs{}).Handler()
	request := httptest.NewRequest(http.MethodGet, firstTrack.Source, nil)
	request.Header.Set("Range", "bytes=4-7")
	response := httptest.NewRecorder()
	api.ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "abcd" || response.Header().Get("Content-Range") != "bytes 4-7/14" {
		t.Fatalf("network range: %d %q %q", response.Code, response.Body.String(), response.Header().Get("Content-Range"))
	}
	if err = store.RecordPlay(firstTrack.ID); err != nil {
		t.Fatal(err)
	}
	waitForNetworkCache(t, store, firstTrack.ID)
	secondTrack, err := store.ImportNetwork(context.Background(), server.URL+"/two.wav")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.RecordPlay(secondTrack.ID); err != nil {
		t.Fatal(err)
	}
	waitForNetworkCache(t, store, secondTrack.ID)
	if _, err = os.Stat(store.networkCachePath(firstTrack.ID)); !os.IsNotExist(err) {
		t.Fatalf("old song cache was retained: %v", err)
	}
	stats, err := store.CacheStats()
	if err != nil || stats.NetworkAudioBytes != int64(len("RIFFklmnopqrst")) {
		t.Fatalf("network cache stats: %+v, %v", stats, err)
	}
	stats, err = store.ClearNetworkCache()
	if err != nil || stats.NetworkAudioBytes != 0 {
		t.Fatalf("clear network cache: %+v, %v", stats, err)
	}
	if _, err = store.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	track, err := store.GetTrack(firstTrack.ID)
	if err != nil || !track.Available {
		t.Fatalf("local scan changed network song: %+v, %v", track, err)
	}
}

func TestNetworkCacheInvalidatesChangedSong(t *testing.T) {
	store := testStore(t)
	var content atomic.Value
	content.Store("RIFFfirst-song")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		body := content.Load().(string)
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("Content-Length", fmt.Sprint(len(body)))
		w.Header().Set("ETag", fmt.Sprintf("%q", body))
		if r.Method == http.MethodHead {
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		if r.Header.Get("Range") == "bytes=0-0" {
			w.Header().Set("Content-Range", fmt.Sprintf("bytes 0-0/%d", len(body)))
			w.Header().Set("Content-Length", "1")
			w.WriteHeader(http.StatusPartialContent)
			_, _ = w.Write([]byte(body[:1]))
			return
		}
		_, _ = w.Write([]byte(body))
	}))
	defer server.Close()
	track, err := store.ImportNetwork(context.Background(), server.URL+"/song.wav")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.RecordPlay(track.ID); err != nil {
		t.Fatal(err)
	}
	waitForNetworkCache(t, store, track.ID)
	content.Store("RIFFsecond-song")
	store.networkMu.Lock()
	delete(store.networkChecks, track.ID)
	store.networkMu.Unlock()
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, httptest.NewRequest(http.MethodGet, track.Source, nil))
	if response.Code != http.StatusOK || response.Body.String() != "RIFFsecond-song" {
		t.Fatalf("stale cache served: %d %q", response.Code, response.Body.String())
	}
	if _, err = os.Stat(store.networkCachePath(track.ID)); !os.IsNotExist(err) {
		t.Fatalf("stale cache still exists: %v", err)
	}
}

func TestNetworkImportRejectsCredentialsAndOtherSchemes(t *testing.T) {
	store := testStore(t)
	for _, target := range []string{"ftp://example.com/song.mp3", "https://user:pass@example.com/song.mp3", "file:///tmp/song.mp3"} {
		if _, err := store.ImportNetwork(context.Background(), target); err == nil {
			t.Fatalf("accepted invalid network URL: %s", target)
		}
	}
}

func TestNetworkImportAPIHidesSourceURL(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write([]byte("RIFFdata"))
	}))
	defer server.Close()
	request := httptest.NewRequest(http.MethodPost, "/api/import/network", strings.NewReader(fmt.Sprintf(`{"url":%q}`, server.URL+"/song.wav?token=private")))
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, request)
	if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "token=private") {
		t.Fatalf("network import response: %d %s", response.Code, response.Body.String())
	}
	var track Track
	if err := json.Unmarshal(response.Body.Bytes(), &track); err != nil || track.Kind != "network" || track.Path != "" || track.Source == "" {
		t.Fatalf("network import track: %+v, %v", track, err)
	}
}

func TestNetworkSongSeekWithoutUpstreamRanges(t *testing.T) {
	store := testStore(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "audio/wav")
		w.Header().Set("Content-Length", "12")
		_, _ = w.Write([]byte("RIFFabcdefgh"))
	}))
	defer server.Close()
	track, err := store.ImportNetwork(context.Background(), server.URL+"/song.wav")
	if err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodGet, track.Source, nil)
	request.Header.Set("Range", "bytes=4-7")
	response := httptest.NewRecorder()
	NewAPI(store, Dialogs{}).Handler().ServeHTTP(response, request)
	if response.Code != http.StatusPartialContent || response.Body.String() != "abcd" || response.Header().Get("Content-Range") != "bytes 4-7/12" {
		t.Fatalf("range fallback: %d %q %q", response.Code, response.Body.String(), response.Header().Get("Content-Range"))
	}
}

func TestNetworkSongWithoutExtensionKeepsAudioType(t *testing.T) {
	store := testStore(t)
	var mediaType atomic.Value
	mediaType.Store("audio/wav")
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", mediaType.Load().(string))
		_, _ = w.Write([]byte("RIFFdata"))
	}))
	defer server.Close()
	track, err := store.ImportNetwork(context.Background(), server.URL+"/stream")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.RecordPlay(track.ID); err != nil {
		t.Fatal(err)
	}
	waitForNetworkCache(t, store, track.ID)
	api := NewAPI(store, Dialogs{}).Handler()
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodGet, track.Source, nil))
	if response.Code != http.StatusOK || response.Header().Get("Content-Type") != "audio/wav" {
		t.Fatalf("cached audio type: %d %q", response.Code, response.Header().Get("Content-Type"))
	}
	if _, err = store.ClearNetworkCache(); err != nil {
		t.Fatal(err)
	}
	mediaType.Store("text/html")
	response = httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodGet, track.Source, nil))
	if response.Code != http.StatusBadGateway || strings.Contains(response.Header().Get("Content-Type"), "text/html") {
		t.Fatalf("non-audio response was served: %d %q", response.Code, response.Header().Get("Content-Type"))
	}
}
