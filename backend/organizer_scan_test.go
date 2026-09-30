package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestOrganizerQuickMatchesAreNeverExact(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	first, second := filepath.Join(root, "one", "Song.wav"), filepath.Join(root, "two", "song.wav")
	organizerWrite(t, first, []byte("first"))
	organizerWrite(t, second, []byte("other"))
	organizerWrite(t, filepath.Join(root, "three", "song.wav"), []byte("different size"))
	organizerWrite(t, filepath.Join(root, "unrelated.wav"), []byte("first"))
	organizerWrite(t, filepath.Join(root, "one", "Song.lrc"), []byte("lyrics"))
	organizer := newOrganizer(store)
	var events []organizeProgress
	plan, err := organizer.previewWithProgress(context.Background(), organizeOptions{Paths: []string{root}, Mode: "deduplicate", MatchMode: "quick"}, func(event organizeProgress) { events = append(events, event) })
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Groups) != 1 || len(plan.Groups[0].Files) != 2 || plan.Groups[0].Match != "filename" || plan.Groups[0].SuggestedKeep != "" {
		t.Fatalf("unsafe quick grouping: %+v", plan.Groups)
	}
	for _, item := range plan.files {
		if item.Digest != "" || !strings.Contains(item.Quality, "未读取") {
			t.Fatalf("quick read audio: %+v", item)
		}
	}
	for _, stamp := range plan.stamps {
		if stamp.Digest != "" {
			t.Fatal("quick preview hashed audio or sidecars")
		}
	}
	for _, event := range events {
		if !event.Quick || event.Bytes != 0 || event.TotalBytes != 0 {
			t.Fatalf("unexpected audio IO: %+v", event)
		}
	}
	last := events[len(events)-1]
	if last.Phase != "ready" || last.Processed != 4 || last.Total != 4 {
		t.Fatalf("progress: %+v", last)
	}
	if _, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID}); err == nil {
		t.Fatal("quick group auto-selected")
	}
	result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{plan.Groups[0].ID: second}})
	if err != nil || result.Quarantined != 1 || result.Companions != 1 {
		t.Fatalf("quick execution: %+v %v", result, err)
	}
	organizerAssertFile(t, second, []byte("other"))
	organizerAssertFile(t, filepath.Join(result.RecoveryPaths[0], "Song.wav"), []byte("first"))
	organizerAssertFile(t, filepath.Join(result.RecoveryPaths[0], "Song.lrc"), []byte("lyrics"))
	if plan.stamps[first].Digest == "" {
		t.Fatal("execution did not restore copy checksum")
	}
}

func TestOrganizerQuickUsesOnlyFreshLibraryMetadata(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	first, second := filepath.Join(root, "one.mp3"), filepath.Join(root, "two.mp3")
	organizerWrite(t, first, organizerMP3("Song", "Singer", "Album"))
	organizerWrite(t, second, append(organizerMP3("Song", "Singer", "Album"), []byte("another encoding")...))
	if _, err := store.ImportWithoutConversion([]string{first, second}, "library"); err != nil {
		t.Fatal(err)
	}
	organizer := newOrganizer(store)
	options := organizeOptions{Paths: []string{root}, Mode: "deduplicate", MatchMode: "quick"}
	plan, err := organizer.preview(context.Background(), options)
	if err != nil || len(plan.Groups) != 1 || plan.Groups[0].Match != "metadata" || plan.Groups[0].SuggestedKeep != "" {
		t.Fatalf("metadata: %+v %v", plan, err)
	}
	if _, err := store.DB.Exec(`UPDATE tracks SET modified=0 WHERE path=?`, second); err != nil {
		t.Fatal(err)
	}
	plan, err = organizer.preview(context.Background(), options)
	if err != nil || len(plan.Groups) != 0 {
		t.Fatalf("stale cache used: %+v %v", plan, err)
	}
	info, err := os.Stat(second)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB.Exec(`UPDATE tracks SET modified=? WHERE path=?`, info.ModTime().UnixNano(), second); err != nil {
		t.Fatal(err)
	}
	if _, err := store.DB.Exec(`UPDATE tracks SET artist='未知歌手'`); err != nil {
		t.Fatal(err)
	}
	plan, err = organizer.preview(context.Background(), options)
	if err != nil || len(plan.Groups) != 0 || plan.files[0].Title != "one" || plan.files[1].Title != "two" {
		t.Fatalf("incomplete metadata did not fall back to actual filename: %+v %v", plan, err)
	}
}

func TestOrganizerQuickRejectsChangedSources(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	first, second := filepath.Join(root, "one", "song.wav"), filepath.Join(root, "two", "song.wav")
	organizerWrite(t, first, []byte("same"))
	organizerWrite(t, second, []byte("same"))
	organizer := newOrganizer(store)
	plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{root}, Mode: "deduplicate", MatchMode: "quick"})
	if err != nil {
		t.Fatal(err)
	}
	organizerWrite(t, first, []byte("changed size"))
	if _, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{plan.Groups[0].ID: second}}); err == nil {
		t.Fatal("changed source accepted")
	}
	organizerAssertFile(t, first, []byte("changed size"))
	organizerAssertFile(t, second, []byte("same"))
}

func TestOrganizerFullProgressAndCancellation(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	path := filepath.Join(root, "large.wav")
	data := bytes.Repeat([]byte("audio"), 300000)
	organizerWrite(t, path, data)
	organizer := newOrganizer(store)
	var events []organizeProgress
	plan, err := organizer.previewWithProgress(context.Background(), organizeOptions{Paths: []string{root}, Mode: "deduplicate"}, func(event organizeProgress) { events = append(events, event) })
	if err != nil || plan.MatchMode != "content" {
		t.Fatalf("full preview: %+v %v", plan, err)
	}
	last := events[len(events)-1]
	if last.Phase != "ready" || last.Bytes != int64(len(data)) || last.TotalBytes != last.Bytes || last.Processed != 1 {
		t.Fatalf("byte progress: %+v", events)
	}
	ctx, cancel := context.WithCancel(context.Background())
	count := 0
	_, err = organizeDigestContext(ctx, path, func(bytes int64) { count++; cancel() })
	if !errors.Is(err, context.Canceled) || count != 1 {
		t.Fatalf("cancel hash: %v %d", err, count)
	}
	ctx, cancel = context.WithCancel(context.Background())
	_, err = organizer.previewWithProgress(ctx, organizeOptions{Paths: []string{root}, Mode: "deduplicate"}, func(event organizeProgress) {
		if event.Phase == "scan" {
			cancel()
		}
	})
	if !errors.Is(err, context.Canceled) || len(organizer.plans) != 1 {
		t.Fatalf("cancel created plan: %v", err)
	}
	organizerAssertFile(t, path, data)
}

func TestOrganizerQuickLargeFilesAndSidecarIndex(t *testing.T) {
	root := organizerTempDir(t)
	path := filepath.Join(root, "song.wav")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := file.Truncate(256 * 1024 * 1024); err != nil {
		file.Close()
		t.Fatal(err)
	}
	file.Close()
	item, err := organizeQuickRead(path, nil)
	if err != nil || item.Size != 256*1024*1024 || item.Digest != "" {
		t.Fatalf("large fast stat: %+v %v", item, err)
	}
	organizerWrite(t, filepath.Join(root, "song.mp3"), []byte("alternate"))
	organizerWrite(t, filepath.Join(root, "SONG.LRC"), []byte("shared"))
	organizerWrite(t, filepath.Join(root, "song.wav.png"), []byte("private"))
	cache := map[string]*organizeSidecarDirectory{}
	files, shared, err := organizeSidecarsCached(path, cache)
	if err != nil || len(files) != 2 || !shared[filepath.Join(root, "SONG.LRC")] || shared[filepath.Join(root, "song.wav.png")] {
		t.Fatalf("sidecar index: %+v %+v %v", files, shared, err)
	}
	if _, _, err := organizeSidecarsCached(filepath.Join(root, "song.mp3"), cache); err != nil || len(cache) != 1 {
		t.Fatal("directory re-indexed", err)
	}
}

func TestOrganizerStreamingAPI(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	organizerWrite(t, filepath.Join(root, "song.wav"), []byte("audio"))
	handler := NewAPI(store, Dialogs{}).Handler()
	for _, mode := range []string{"content", "quick", "invalid"} {
		body, _ := json.Marshal(organizeOptions{Paths: []string{root}, Mode: "deduplicate", MatchMode: mode})
		request := httptest.NewRequest(http.MethodPost, "/api/organizer/preview", bytes.NewReader(body))
		request.Header.Set("Accept", "application/x-ndjson")
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, request)
		if !response.Flushed || !strings.Contains(response.Header().Get("Content-Type"), "application/x-ndjson") {
			t.Fatal("not streaming")
		}
		decoder := json.NewDecoder(response.Body)
		var event struct {
			Progress *organizeProgress `json:"progress"`
			Plan     *organizePlan     `json:"plan"`
			Error    string            `json:"error"`
		}
		var final bool
		for decoder.More() {
			event.Progress, event.Plan, event.Error = nil, nil, ""
			if err := decoder.Decode(&event); err != nil {
				t.Fatal(err)
			}
			if event.Plan != nil {
				final = event.Plan.Scanned == 1
			}
			if event.Error != "" {
				final = mode == "invalid"
			}
		}
		if !final {
			t.Fatalf("missing terminal message for %s", mode)
		}
	}
}

func TestOrganizerDurationGroupingAndLargeQuickCollection(t *testing.T) {
	files := []organizeFile{}
	for index, duration := range []float64{100, 101.8, 103.5, 110} {
		files = append(files, organizeFile{Path: fmt.Sprint(index), Title: "Song", Artist: "Singer", Album: "Album", Tagged: true, Duration: duration})
	}
	groups := organizeDuplicates(files)
	if len(groups) != 1 || len(groups[0].Files) != 3 {
		t.Fatalf("duration graph changed: %+v", groups)
	}
	files = append(files, organizeFile{Path: "unknown", Title: "Song", Artist: "Singer", Album: "Album", Tagged: true})
	groups = organizeDuplicates(files)
	if len(groups) != 1 || len(groups[0].Files) != 5 {
		t.Fatal("unknown duration should bridge candidate group")
	}
	store := testStore(t)
	root := organizerTempDir(t)
	for index := 0; index < 1000; index++ {
		organizerWrite(t, filepath.Join(root, fmt.Sprintf("song-%04d.wav", index)), []byte("audio"))
		organizerWrite(t, filepath.Join(root, fmt.Sprintf("song-%04d.lrc", index)), []byte("lyrics"))
	}
	started := time.Now()
	plan, err := newOrganizer(store).preview(context.Background(), organizeOptions{Paths: []string{root}, Mode: "deduplicate", MatchMode: "quick"})
	if err != nil || plan.Scanned != 1000 || len(plan.Groups) != 0 || len(plan.stamps) != 2000 {
		t.Fatalf("large collection: %+v %v", plan, err)
	}
	for _, item := range plan.files {
		if len(item.Companions) != 1 || item.Digest != "" {
			t.Fatal("large quick scan lost sidecars or read contents")
		}
	}
	t.Logf("quick metadata/stat scan of 1000 audio files and 1000 sidecars: %s", time.Since(started))
}
