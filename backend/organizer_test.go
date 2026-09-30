package backend

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func organizerWrite(t *testing.T, path string, data []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
}

func organizerTempDir(t *testing.T) string {
	t.Helper()
	path, err := canonical(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	return path
}

func organizerMP3(title, artist, album string) []byte {
	var frames []byte
	for _, entry := range [][2]string{{"TIT2", title}, {"TPE1", artist}, {"TALB", album}} {
		payload := append([]byte{3}, []byte(entry[1])...)
		frame := make([]byte, 10+len(payload))
		copy(frame, entry[0])
		binary.BigEndian.PutUint32(frame[4:8], uint32(len(payload)))
		copy(frame[10:], payload)
		frames = append(frames, frame...)
	}
	size := len(frames)
	header := []byte{'I', 'D', '3', 3, 0, 0, byte(size >> 21), byte(size >> 14 & 127), byte(size >> 7 & 127), byte(size & 127)}
	return append(append(header, frames...), 0xff, 0xfb, 0x90, 0)
}

func organizerWAV(rate uint32, depth uint16) []byte {
	dataSize := rate * uint32(depth/8)
	data := make([]byte, 44+dataSize)
	copy(data, "RIFF")
	binary.LittleEndian.PutUint32(data[4:8], uint32(len(data)-8))
	copy(data[8:12], "WAVE")
	copy(data[12:16], "fmt ")
	binary.LittleEndian.PutUint32(data[16:20], 16)
	binary.LittleEndian.PutUint16(data[20:22], 1)
	binary.LittleEndian.PutUint16(data[22:24], 1)
	binary.LittleEndian.PutUint32(data[24:28], rate)
	binary.LittleEndian.PutUint32(data[28:32], dataSize)
	binary.LittleEndian.PutUint16(data[32:34], depth/8)
	binary.LittleEndian.PutUint16(data[34:36], depth)
	copy(data[36:40], "data")
	binary.LittleEndian.PutUint32(data[40:44], dataSize)
	return data
}

func organizerAssertFile(t *testing.T, path string, expected []byte) {
	t.Helper()
	actual, err := os.ReadFile(path)
	if err != nil || !bytes.Equal(actual, expected) {
		t.Fatalf("file %s: %v, content matches=%t", path, err, bytes.Equal(actual, expected))
	}
}

func organizerAssertAbsent(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !errors.Is(err, os.ErrNotExist) {
		t.Fatalf("file should not exist: %s, %v", path, err)
	}
}

func TestOrganizerIndependentMoves(t *testing.T) {
	for _, mode := range []string{"rename", "artist", "consolidate"} {
		t.Run(mode, func(t *testing.T) {
			store := testStore(t)
			root, target := organizerTempDir(t), organizerTempDir(t)
			audio := filepath.Join(root, "nested", "original.mp3")
			data := organizerMP3("歌曲", "歌手", "专辑")
			organizerWrite(t, audio, data)
			for _, extension := range []string{".LRC", ".JpG", ".mp3.txt"} {
				organizerWrite(t, strings.TrimSuffix(audio, ".mp3")+extension, []byte(extension))
			}
			tracks, err := store.ImportWithoutConversion([]string{audio}, "library")
			if err != nil || len(tracks) != 1 {
				t.Fatalf("import: %v", err)
			}
			organizer := newOrganizer(store)
			plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{root, filepath.Dir(audio)}, Target: target, Mode: mode, Template: "{artist} - {title}"})
			if err != nil || plan.Scanned != 1 || len(plan.Moves) != 1 {
				t.Fatalf("preview: %+v %v", plan, err)
			}
			organizerAssertFile(t, audio, data)
			destination := filepath.Join(target, "original.mp3")
			if mode == "rename" {
				destination = filepath.Join(target, "歌手 - 歌曲.mp3")
			}
			if mode == "artist" {
				destination = filepath.Join(target, "歌手", "original.mp3")
			}
			if plan.Moves[0].Destination != destination {
				t.Fatalf("destination: %s", plan.Moves[0].Destination)
			}
			result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID})
			if err != nil || result.Moved != 1 || result.Companions != 3 {
				t.Fatalf("execute: %+v %v", result, err)
			}
			organizerAssertAbsent(t, audio)
			organizerAssertFile(t, destination, data)
			for _, extension := range []string{".LRC", ".JpG", ".mp3.txt"} {
				organizerAssertFile(t, strings.TrimSuffix(destination, ".mp3")+extension, []byte(extension))
			}
			track, err := store.GetTrack(tracks[0].ID)
			if err != nil || track.Path != destination {
				t.Fatalf("library ID/path: %+v %v", track, err)
			}
			manifest, err := os.ReadFile(result.Manifest)
			if err != nil || !bytes.Contains(manifest, []byte(`"completed"`)) {
				t.Fatalf("manifest: %s %v", manifest, err)
			}
			if _, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID}); err == nil {
				t.Fatal("consumed preview reused")
			}
		})
	}
}

func TestOrganizerCollisionIncludesCompanions(t *testing.T) {
	store := testStore(t)
	source, target := organizerTempDir(t), organizerTempDir(t)
	for _, directory := range []string{"first", "second"} {
		organizerWrite(t, filepath.Join(source, directory, "song.wav"), []byte(directory))
		organizerWrite(t, filepath.Join(source, directory, "song.png"), []byte(directory+" image"))
	}
	organizerWrite(t, filepath.Join(target, "song.png"), []byte("existing image"))
	organizer := newOrganizer(store)
	plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{source}, Target: target, Mode: "consolidate"})
	if err != nil || len(plan.Moves) != 2 {
		t.Fatalf("preview: %+v %v", plan, err)
	}
	if filepath.Base(plan.Moves[0].Destination) != "song (2).wav" || filepath.Base(plan.Moves[1].Destination) != "song (3).wav" {
		t.Fatalf("collisions: %+v", plan.Moves)
	}
	if _, err = organizer.execute(context.Background(), organizeExecute{ID: plan.ID}); err != nil {
		t.Fatal(err)
	}
	organizerAssertFile(t, filepath.Join(target, "song.png"), []byte("existing image"))
	organizerAssertFile(t, filepath.Join(target, "song (2).png"), []byte("first image"))
	organizerAssertFile(t, filepath.Join(target, "song (3).png"), []byte("second image"))
}

func TestOrganizerSharedSidecarsAndInPlaceRename(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	first, second := filepath.Join(root, "song.mp3"), filepath.Join(root, "song.flac")
	organizerWrite(t, first, []byte("mp3"))
	organizerWrite(t, second, []byte("flac"))
	organizerWrite(t, filepath.Join(root, "song.lrc"), []byte("shared lyrics"))
	organizer := newOrganizer(store)
	plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{first}, Mode: "rename", Template: "renamed"})
	if err != nil {
		t.Fatal(err)
	}
	result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID})
	if err != nil || result.Moved != 1 {
		t.Fatalf("execute: %+v %v", result, err)
	}
	organizerAssertFile(t, second, []byte("flac"))
	organizerAssertFile(t, filepath.Join(root, "song.lrc"), []byte("shared lyrics"))
	organizerAssertFile(t, filepath.Join(root, "renamed.lrc"), []byte("shared lyrics"))
}

func TestOrganizerDifferentQualityRequiresChoice(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	first, second := filepath.Join(root, "first", "song.wav"), filepath.Join(root, "second", "song.wav")
	firstData, secondData := organizerWAV(44100, 16), organizerWAV(48000, 24)
	organizerWrite(t, first, firstData)
	organizerWrite(t, second, secondData)
	organizerWrite(t, filepath.Join(root, "first", "song.lrc"), []byte("lyrics"))
	organizer := newOrganizer(store)
	options := organizeOptions{Paths: []string{root}, Mode: "deduplicate"}
	plan, err := organizer.preview(context.Background(), options)
	if err != nil || len(plan.Groups) != 1 {
		t.Fatalf("preview: %+v %v", plan, err)
	}
	group := plan.Groups[0]
	if group.SuggestedKeep != "" || !strings.Contains(group.Files[0].Quality, "44100 Hz / 16 bit") || !strings.Contains(group.Files[1].Quality, "48000 Hz / 24 bit") {
		t.Fatalf("quality: %+v", group)
	}
	if _, err = organizer.execute(context.Background(), organizeExecute{ID: plan.ID}); err == nil {
		t.Fatal("missing quality choice accepted")
	}
	if _, err = organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{group.ID: filepath.Join(root, "outsider.wav")}}); err == nil {
		t.Fatal("out-of-group choice accepted")
	}
	if _, err = organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{group.ID: "*"}}); err != nil {
		t.Fatal(err)
	}
	organizerAssertFile(t, first, firstData)
	plan, err = organizer.preview(context.Background(), options)
	if err != nil {
		t.Fatal(err)
	}
	result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{plan.Groups[0].ID: second}})
	if err != nil || result.Quarantined != 1 || len(result.RecoveryPaths) != 1 {
		t.Fatalf("cleanup: %+v %v", result, err)
	}
	organizerAssertAbsent(t, first)
	organizerAssertFile(t, second, secondData)
	organizerAssertFile(t, filepath.Join(result.RecoveryPaths[0], "song.wav"), firstData)
	organizerAssertFile(t, filepath.Join(result.RecoveryPaths[0], "song.lrc"), []byte("lyrics"))
	plan, err = organizer.preview(context.Background(), options)
	if err != nil || plan.Scanned != 1 || len(plan.Groups) != 0 {
		t.Fatalf("recovery rescanned: %+v %v", plan, err)
	}
	tracks, err := store.ImportWithoutConversion([]string{root}, "watch")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("recovery imported: %+v %v", tracks, err)
	}
	if _, err = store.Scan(context.Background()); err != nil {
		t.Fatal(err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 1 {
		t.Fatalf("recovery watched: %+v %v", state.Tracks, err)
	}
}

func TestOrganizerDeduplicatePreservesLibraryReferences(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	first, second := filepath.Join(root, "first.mp3"), filepath.Join(root, "second.mp3")
	data := organizerMP3("Song", "Singer", "Album")
	organizerWrite(t, first, data)
	organizerWrite(t, second, data)
	tracks, err := store.ImportWithoutConversion([]string{first, second}, "library")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.SaveIDs("liked", []int64{tracks[1].ID}); err != nil {
		t.Fatal(err)
	}
	if err = store.SaveIDs("queue", []int64{tracks[1].ID}); err != nil {
		t.Fatal(err)
	}
	if err = store.RecordPlay(tracks[1].ID); err != nil {
		t.Fatal(err)
	}
	if err = store.SavePlaylists([]Playlist{{ID: "test", Name: "Test", TrackIDs: []int64{tracks[1].ID}}}); err != nil {
		t.Fatal(err)
	}
	if err = store.CreateTag("Favorite"); err != nil {
		t.Fatal(err)
	}
	if err = store.SaveTrackTags([]int64{tracks[1].ID}, []string{"Favorite"}); err != nil {
		t.Fatal(err)
	}
	organizer := newOrganizer(store)
	plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{root}, Mode: "deduplicate"})
	if err != nil || len(plan.Groups) != 1 || plan.Groups[0].Match != "exact" || plan.Groups[0].SuggestedKeep == "" {
		t.Fatalf("duplicates: %+v %v", plan, err)
	}
	result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{plan.Groups[0].ID: first}})
	if err != nil || result.RemappedIDs[tracks[1].ID] != tracks[0].ID {
		t.Fatalf("merge: %+v %v", result, err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 1 || state.Tracks[0].ID != tracks[0].ID || len(state.Tracks[0].CustomTags) != 1 {
		t.Fatalf("state: %+v %v", state, err)
	}
	for _, ids := range [][]int64{state.Queue, state.Liked, state.Recent, state.Playlists[0].TrackIDs} {
		if len(ids) != 1 || ids[0] != tracks[0].ID {
			t.Fatalf("reference lost: %+v", ids)
		}
	}
}

func TestOrganizerRefusesChangedPreview(t *testing.T) {
	for _, change := range []string{"audio", "companion", "new-companion", "new-target", "expiry", "shared"} {
		t.Run(change, func(t *testing.T) {
			store := testStore(t)
			root, target := organizerTempDir(t), organizerTempDir(t)
			audio := filepath.Join(root, "song.wav")
			lyric := filepath.Join(root, "song.lrc")
			organizerWrite(t, audio, []byte("original"))
			organizerWrite(t, lyric, []byte("lyrics"))
			organizer := newOrganizer(store)
			plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{root}, Target: target, Mode: "consolidate"})
			if err != nil {
				t.Fatal(err)
			}
			switch change {
			case "audio":
				stamp := plan.stamps[audio]
				organizerWrite(t, audio, []byte("modified"))
				if err := os.Chtimes(audio, time.Now(), time.Unix(0, stamp.Modified)); err != nil {
					t.Fatal(err)
				}
			case "companion":
				organizerWrite(t, lyric, []byte("changed lyrics"))
			case "new-companion":
				organizerWrite(t, filepath.Join(root, "song.png"), []byte("new image"))
			case "new-target":
				organizerWrite(t, plan.Moves[0].Destination, []byte("do not overwrite"))
			case "expiry":
				plan.created = time.Now().Add(-time.Hour)
			case "shared":
				organizerWrite(t, filepath.Join(root, "song.mp3"), []byte("new sibling"))
			}
			if _, err = organizer.execute(context.Background(), organizeExecute{ID: plan.ID}); err == nil {
				t.Fatal("stale preview accepted")
			}
			if _, err = os.Stat(audio); err != nil {
				t.Fatal("original removed", err)
			}
			if change == "new-target" {
				organizerAssertFile(t, plan.Moves[0].Destination, []byte("do not overwrite"))
			} else {
				organizerAssertAbsent(t, plan.Moves[0].Destination)
			}
		})
	}
}

func TestOrganizerRetainedVersionRefreshesLyrics(t *testing.T) {
	for _, mode := range []string{"library", "temporary"} {
		t.Run(mode, func(t *testing.T) {
			store := testStore(t)
			root := organizerTempDir(t)
			source, keep := filepath.Join(root, "source", "song.wav"), filepath.Join(root, "keep", "song.wav")
			organizerWrite(t, source, organizerWAV(44100, 16))
			organizerWrite(t, keep, organizerWAV(48000, 24))
			organizerWrite(t, strings.TrimSuffix(source, ".wav")+".lrc", []byte("[00:01.00]Discarded version"))
			organizerWrite(t, strings.TrimSuffix(keep, ".wav")+".lrc", []byte("[00:01.00]Retained version"))
			tracks, err := store.ImportWithoutConversion([]string{source}, mode)
			if err != nil {
				t.Fatal(err)
			}
			organizer := newOrganizer(store)
			plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{root}, Mode: "deduplicate"})
			if err != nil || len(plan.Groups) != 1 {
				t.Fatalf("preview: %+v %v", plan, err)
			}
			result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID, Keep: map[string]string{plan.Groups[0].ID: keep}})
			if err != nil {
				t.Fatal(err)
			}
			if mode == "library" {
				state, err := store.State()
				if err != nil || len(state.Tracks) != 1 {
					t.Fatalf("state: %+v %v", state, err)
				}
			} else if len(result.TemporaryTracks) != 1 {
				t.Fatalf("temporary refresh: %+v", result)
			}
			track, err := store.GetTrack(tracks[0].ID)
			if err != nil || track.Path != keep || !track.LocalLyrics || track.Lyrics != "[00:01.00]Retained version" {
				t.Fatalf("retained metadata/identity: %+v %v", track, err)
			}
		})
	}
}

func TestOrganizerAudioQualityHeaders(t *testing.T) {
	root := organizerTempDir(t)
	flac := make([]byte, 42)
	copy(flac, "fLaC")
	flac[4], flac[7] = 0x80, 34
	binary.BigEndian.PutUint64(flac[18:26], uint64(96000)<<44|uint64(1)<<41|uint64(23)<<36|96000)
	for _, entry := range []struct {
		name     string
		data     []byte
		expected string
		duration float64
	}{
		{"song.flac", flac, "96000 Hz / 24 bit / 2 声道", 1},
		{"song.wav", organizerWAV(48000, 24), "48000 Hz / 24 bit / 1 声道", 1},
		{"song.mp3", organizerMP3("Song", "Singer", "Album"), "首帧 128 kbps", 0},
		{"song.aac", []byte("unknown"), "音质参数未知", 0},
	} {
		path := filepath.Join(root, entry.name)
		organizerWrite(t, path, entry.data)
		quality, duration := organizeQuality(path)
		if !strings.Contains(quality, entry.expected) || duration != entry.duration {
			t.Fatalf("%s: %s, duration %v", entry.name, quality, duration)
		}
	}
}

type organizerCancelAfterRemoval struct {
	context.Context
	path string
}

func (ctx organizerCancelAfterRemoval) Err() error {
	if _, err := os.Stat(ctx.path); errors.Is(err, os.ErrNotExist) {
		return context.Canceled
	}
	return nil
}

func TestOrganizerRollsBackFilesAndDatabase(t *testing.T) {
	for _, failure := range []string{"database", "after-removal"} {
		t.Run(failure, func(t *testing.T) {
			store := testStore(t)
			root, target := organizerTempDir(t), organizerTempDir(t)
			audio := filepath.Join(root, "song.wav")
			lyric := filepath.Join(root, "song.lrc")
			organizerWrite(t, audio, []byte("original"))
			organizerWrite(t, lyric, []byte("lyrics"))
			tracks, err := store.ImportWithoutConversion([]string{audio}, "library")
			if err != nil {
				t.Fatal(err)
			}
			organizer := newOrganizer(store)
			plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{root}, Target: target, Mode: "consolidate"})
			if err != nil {
				t.Fatal(err)
			}
			ctx := context.Background()
			if failure == "database" {
				if _, err := store.DB.Exec(`CREATE TRIGGER organizer_fail BEFORE UPDATE OF path ON tracks BEGIN SELECT RAISE(ABORT, 'test failure'); END`); err != nil {
					t.Fatal(err)
				}
			} else {
				ctx = organizerCancelAfterRemoval{Context: context.Background(), path: audio}
			}
			if _, err = organizer.execute(ctx, organizeExecute{ID: plan.ID}); err == nil || !strings.Contains(err.Error(), "文件已恢复") {
				t.Fatalf("rollback error: %v", err)
			}
			organizerAssertFile(t, audio, []byte("original"))
			organizerAssertFile(t, lyric, []byte("lyrics"))
			organizerAssertAbsent(t, filepath.Join(target, "song.wav"))
			organizerAssertAbsent(t, filepath.Join(target, "song.lrc"))
			track, err := store.GetTrack(tracks[0].ID)
			if err != nil || track.Path != audio {
				t.Fatalf("database rollback: %+v %v", track, err)
			}
		})
	}
}

func TestOrganizerTemporaryTracksAndValidation(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	audio := filepath.Join(root, "song.wav")
	organizerWrite(t, audio, []byte("audio"))
	tracks, err := store.ImportWithoutConversion([]string{audio}, "temporary")
	if err != nil {
		t.Fatal(err)
	}
	organizer := newOrganizer(store)
	for _, options := range []organizeOptions{
		{Paths: []string{root}, Mode: "unknown"},
		{Paths: []string{root}, Mode: "artist"},
		{Paths: []string{root}, Mode: "consolidate", Target: "relative"},
		{Paths: []string{root}, Mode: "rename", Template: "{unknown}"},
	} {
		if _, err := organizer.preview(context.Background(), options); err == nil {
			t.Fatalf("invalid input accepted: %+v", options)
		}
	}
	plan, err := organizer.preview(context.Background(), organizeOptions{Paths: []string{audio}, Mode: "rename", Template: "CON"})
	if err != nil || filepath.Base(plan.Moves[0].Destination) != "_CON.wav" {
		t.Fatalf("safe name: %+v %v", plan, err)
	}
	result, err := organizer.execute(context.Background(), organizeExecute{ID: plan.ID})
	if err != nil || len(result.TemporaryTracks) != 1 {
		t.Fatalf("temporary result: %+v %v", result, err)
	}
	track, err := store.GetTrack(tracks[0].ID)
	if err != nil || track.Path != plan.Moves[0].Destination {
		t.Fatalf("temporary track: %+v %v", track, err)
	}
	if organizeName("../歌手:*?") != "_歌手___" {
		t.Fatalf("invalid characters: %s", organizeName("../歌手:*?"))
	}
}

func TestOrganizerAPI(t *testing.T) {
	store := testStore(t)
	root := organizerTempDir(t)
	audio := filepath.Join(root, "song.wav")
	organizerWrite(t, audio, []byte("audio"))
	handler := NewAPI(store, Dialogs{}).Handler()
	call := func(path string, payload any) *httptest.ResponseRecorder {
		t.Helper()
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatal(err)
		}
		response := httptest.NewRecorder()
		handler.ServeHTTP(response, httptest.NewRequest(http.MethodPost, path, bytes.NewReader(body)))
		return response
	}
	response := call("/api/organizer/preview", organizeOptions{Paths: []string{root}, Mode: "rename", Template: "new"})
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	var plan organizePlan
	if err := json.Unmarshal(response.Body.Bytes(), &plan); err != nil {
		t.Fatal(err)
	}
	response = call("/api/organizer/execute", map[string]any{"id": plan.ID, "destination": filepath.Join(root, "injected.wav")})
	if response.Code != 400 {
		t.Fatal("client destinations accepted", response.Code)
	}
	response = call("/api/organizer/execute", organizeExecute{ID: plan.ID})
	if response.Code != 200 {
		t.Fatal(response.Body.String())
	}
	organizerAssertFile(t, filepath.Join(root, "new.wav"), []byte("audio"))
}
