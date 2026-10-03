package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
	"time"
)

func TestConvertBackupAndLibrary(t *testing.T) {
	store := conversionStore(t)
	folder := t.TempDir()
	source, encrypted, want := conversionFixture(t, folder, "song")
	result := store.Convert(context.Background(), source, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil {
		t.Fatalf("convert: %+v", result)
	}
	expectedOutput, _ := canonical(filepath.Join(folder, "song.mp3"))
	expectedBackup, _ := canonical(filepath.Join(folder, backupFolder, "song.qmc0"))
	if result.Output != expectedOutput || result.Backup != expectedBackup {
		t.Fatalf("paths: %+v; expected output=%q backup=%q", result, expectedOutput, expectedBackup)
	}
	got, err := os.ReadFile(result.Output)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("decoded output differs: %v", err)
	}
	backup, err := os.ReadFile(result.Backup)
	if err != nil || !bytes.Equal(backup, encrypted) {
		t.Fatalf("backup differs: %v", err)
	}
	if _, err = os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source still exists: %v", err)
	}
	if result.Track.Path != result.Output || result.Track.PlaybackStatus != "unknown" {
		t.Fatalf("library track: %+v", result.Track)
	}
	tracks, err := store.Import([]string{folder}, "library")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("backup reimported: %+v, %v", tracks, err)
	}
}

func TestConvertWithoutBackupAndCollision(t *testing.T) {
	store := conversionStore(t)
	folder := t.TempDir()
	source, encrypted, _ := conversionFixture(t, folder, "song")
	out := filepath.Join(folder, "song.mp3")
	if err := os.WriteFile(out, []byte("existing"), 0600); err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), source, false, false)
	if result.Status != "failed" || result.Error == "" {
		t.Fatalf("collision: %+v", result)
	}
	got, _ := os.ReadFile(source)
	if !bytes.Equal(got, encrypted) {
		t.Fatal("collision changed source")
	}
	got, _ = os.ReadFile(out)
	if !bytes.Equal(got, []byte("existing")) {
		t.Fatal("collision changed target")
	}
	if err := os.Remove(out); err != nil {
		t.Fatal(err)
	}
	result = store.Convert(context.Background(), source, false, false)
	if result.Status != "converted" || result.Backup != "" {
		t.Fatalf("no-backup conversion: %+v", result)
	}
	if _, err := os.Stat(source); !os.IsNotExist(err) {
		t.Fatalf("source was not removed: %v", err)
	}
	if _, err := os.Stat(filepath.Join(folder, backupFolder)); !os.IsNotExist(err) {
		t.Fatalf("unexpected backup directory: %v", err)
	}
}

func TestUnsupportedPlaybackStatus(t *testing.T) {
	for _, ext := range []string{".wma", ".dff", ".ape"} {
		if got := playbackStatus("song" + ext); got != "unplayable" {
			t.Fatalf("%s: %s", ext, got)
		}
	}
	if got := playbackStatus("song.mp3"); got != "unknown" {
		t.Fatal(got)
	}
}

func TestConvertedDFFStaysInLibraryAsUnplayable(t *testing.T) {
	store := conversionStore(t)
	path := filepath.Join(t.TempDir(), "dsd.tm0")
	data := append([]byte("FRM8"), make([]byte, 128)...)
	if err := os.WriteFile(path, data, 0600); err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Track == nil || result.Track.PlaybackStatus != "unplayable" || filepath.Ext(result.Output) != ".dff" {
		t.Fatalf("dff conversion: %+v", result)
	}
}

func TestConvertModuleMetadata(t *testing.T) {
	store := conversionStore(t)
	path := filepath.Join(t.TempDir(), "local.ncm")
	if err := os.WriteFile(path, append([]byte("LUNA-TEST:"), stubAudio()...), 0600); err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), path, true, true)
	if result.Status != "converted" || result.Error != "" || result.Track == nil {
		t.Fatalf("conversion: %+v", result)
	}
	track := result.Track
	if track.Title != "Local title" || track.Artist != "Local artist" || track.Album != "Local album" || !track.EmbeddedCover || track.Provider != "ncm" || track.ProviderID != "123456" {
		t.Fatalf("module metadata: %+v", track)
	}
}

func TestSameExtensionConversionPreservesTrackID(t *testing.T) {
	store := conversionStore(t)
	path := filepath.Join(t.TempDir(), "typed.mp3")
	want := stubAudio()
	var err error
	header := []byte{'i', 'f', 'm', 't', ' ', 'M', 'P', '3', 0xfe, 0xfe, 0xfe, 0xfe, 0, 0, 0, 0}
	if err = os.WriteFile(path, append(header, want...), 0600); err != nil {
		t.Fatal(err)
	}
	old, err := store.upsert(path)
	if err != nil {
		t.Fatal(err)
	}
	result := store.Convert(context.Background(), path, true, false)
	if result.Status != "converted" || result.Track == nil || result.Track.ID != old.ID {
		t.Fatalf("same-path conversion: %+v", result)
	}
	got, err := os.ReadFile(result.Output)
	if err != nil || !bytes.Equal(got, want) {
		t.Fatalf("same-path output differs: %v", err)
	}
	backup, err := os.ReadFile(result.Backup)
	if err != nil || !bytes.HasPrefix(backup, header) {
		t.Fatalf("same-path backup: %v", err)
	}
}

func TestAutoConvertImportAndScan(t *testing.T) {
	store := conversionStore(t)
	settings, err := store.Settings()
	if err != nil {
		t.Fatal(err)
	}
	if settings.AutoConvert || !settings.BackupOriginal {
		t.Fatalf("conversion defaults: %+v", settings)
	}
	settings.AutoConvert = true
	if err = store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	folder := t.TempDir()
	conversionFixture(t, folder, "first")
	tracks, err := store.Import([]string{folder}, "watch")
	if err != nil || len(tracks) != 1 {
		t.Fatalf("auto import: %+v, %v", tracks, err)
	}
	conversionFixture(t, folder, "second")
	result, err := store.Scan(context.Background())
	if err != nil || result.Added != 1 || len(result.Errors) != 0 {
		t.Fatalf("auto scan: %+v, %v", result, err)
	}
	state, err := store.State()
	if err != nil || len(state.Tracks) != 2 {
		t.Fatalf("library after scan: %+v, %v", state.Tracks, err)
	}
}

func TestImportSkipsConversionUntilToolbox(t *testing.T) {
	for _, folderInput := range []bool{false, true} {
		name := "mixed files"
		if folderInput {
			name = "folder"
		}
		t.Run(name, func(t *testing.T) {
			store := conversionStore(t)
			settings, err := store.Settings()
			if err != nil {
				t.Fatal(err)
			}
			settings.AutoConvert = true
			if err = store.SaveSettings(settings); err != nil {
				t.Fatal(err)
			}
			folder := t.TempDir()
			encrypted, _, _ := conversionFixture(t, folder, "encrypted")
			plain := filepath.Join(folder, "plain.wav")
			if err = os.WriteFile(plain, []byte("RIFFsample audio"), 0600); err != nil {
				t.Fatal(err)
			}
			canonicalEncrypted, err := canonical(encrypted)
			if err != nil {
				t.Fatal(err)
			}
			canonicalPlain, err := canonical(plain)
			if err != nil {
				t.Fatal(err)
			}
			paths := []string{encrypted, plain}
			if folderInput {
				paths = []string{folder}
			}
			api := NewAPI(store, Dialogs{}).Handler()
			post := func(endpoint string, body any) *httptest.ResponseRecorder {
				data, marshalErr := json.Marshal(body)
				if marshalErr != nil {
					t.Fatal(marshalErr)
				}
				response := httptest.NewRecorder()
				api.ServeHTTP(response, httptest.NewRequest(http.MethodPost, endpoint, bytes.NewReader(data)))
				return response
			}
			inspected := post("/api/conversion/inspect", map[string]any{"paths": paths})
			var found struct {
				Paths []string `json:"paths"`
			}
			if inspected.Code != http.StatusOK || json.Unmarshal(inspected.Body.Bytes(), &found) != nil || len(found.Paths) != 1 || found.Paths[0] != canonicalEncrypted {
				t.Fatalf("inspect: status=%d body=%s", inspected.Code, inspected.Body.String())
			}
			imported := post("/api/import", map[string]any{"paths": paths, "mode": "library", "skipConversion": true})
			var tracks []Track
			if imported.Code != http.StatusOK || json.Unmarshal(imported.Body.Bytes(), &tracks) != nil || len(tracks) != 1 || tracks[0].Path != canonicalPlain {
				t.Fatalf("plain import: status=%d body=%s", imported.Code, imported.Body.String())
			}
			if _, err = os.Stat(encrypted); err != nil {
				t.Fatalf("encrypted source changed before conversion: %v", err)
			}
			if _, err = os.Stat(filepath.Join(folder, "encrypted.mp3")); !os.IsNotExist(err) {
				t.Fatalf("encrypted output appeared before toolbox conversion: %v", err)
			}
			converted := post("/api/conversion", map[string]any{"path": encrypted, "addToLibrary": true})
			var result ConversionResult
			if converted.Code != http.StatusOK || json.Unmarshal(converted.Body.Bytes(), &result) != nil || result.Status != "converted" || result.Track == nil {
				t.Fatalf("toolbox conversion: status=%d body=%s", converted.Code, converted.Body.String())
			}
			state, err := store.State()
			if err != nil || len(state.Tracks) != 2 {
				t.Fatalf("library after conversion: %+v, %v", state.Tracks, err)
			}
		})
	}
}

func TestManualScanConvertsWithOneTimeBackupChoice(t *testing.T) {
	for _, backup := range []bool{false, true} {
		name := "without backup"
		if backup {
			name = "with backup"
		}
		t.Run(name, func(t *testing.T) {
			store := conversionStore(t)
			settings, err := store.Settings()
			if err != nil {
				t.Fatal(err)
			}
			settings.BackupOriginal = !backup
			if err = store.SaveSettings(settings); err != nil {
				t.Fatal(err)
			}
			folder := t.TempDir()
			source, _, want := conversionFixture(t, folder, "song")
			if err = os.WriteFile(filepath.Join(folder, "broken.ncm"), []byte("invalid"), 0600); err != nil {
				t.Fatal(err)
			}
			if err = store.AddFolder(folder); err != nil {
				t.Fatal(err)
			}
			autoResult, err := store.Scan(context.Background())
			if err != nil || autoResult.Converted != 0 {
				t.Fatalf("automatic scan should respect disabled conversion: %+v, %v", autoResult, err)
			}
			if _, err = os.Stat(source); err != nil {
				t.Fatalf("automatic scan changed source: %v", err)
			}
			result, err := store.ScanManual(context.Background(), backup)
			if err != nil || result.Added != 1 || result.Converted != 1 || len(result.Errors) != 1 {
				t.Fatalf("manual scan: %+v, %v", result, err)
			}
			output, err := os.ReadFile(filepath.Join(folder, "song.mp3"))
			if err != nil || !bytes.Equal(output, want) {
				t.Fatalf("converted output: %v", err)
			}
			if _, err = os.Stat(source); !os.IsNotExist(err) {
				t.Fatalf("source should be retired: %v", err)
			}
			backupPath := filepath.Join(folder, backupFolder, "song.qmc0")
			_, backupErr := os.Stat(backupPath)
			if backup && backupErr != nil || !backup && !os.IsNotExist(backupErr) {
				t.Fatalf("one-time backup choice was ignored: %v", backupErr)
			}
			after, err := store.Settings()
			if err != nil || after.AutoConvert || after.BackupOriginal != settings.BackupOriginal {
				t.Fatalf("manual scan changed saved settings: %+v, %v", after, err)
			}
		})
	}
}

func TestDirectIDEnrichmentUsesVerifiedCachedSong(t *testing.T) {
	music := NewMusic(conversionStore(t))
	if _, err := music.cached("direct:v1:ncm:123456", time.Hour, false, func() (any, error) {
		return song{ID: "123456", Title: "Local title", Artist: "Local artist, Guest"}, nil
	}); err != nil {
		t.Fatal(err)
	}
	if _, err := music.cached("lyric:ncm:123456:", time.Hour, false, func() (any, error) {
		return map[string]any{"lyric": "[00:01.00]Local lyric", "translation": ""}, nil
	}); err != nil {
		t.Fatal(err)
	}
	result, err := music.enrichWithID(context.Background(), "Local title", "Local artist / Guest", "", false, true, false, "ncm", "123456")
	if err != nil || result.Lyric != "[00:01.00]Local lyric" {
		t.Fatalf("direct enrichment: %+v, %v", result, err)
	}
}
