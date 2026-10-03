package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	"image/png"
	"io"
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprotocol"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

var converterTestPath string

func TestMain(m *testing.M) {
	if len(os.Args) == 2 && os.Args[1] == "--test-descendant" {
		_ = os.WriteFile(os.Getenv("LUNANAHIDA_TEST_CHILD_PID"), []byte(fmt.Sprint(os.Getpid())), 0600)
		time.Sleep(time.Hour)
		os.Exit(0)
	}
	// The test executable also acts as a simulated module for client tests.
	if len(os.Args) >= 2 && (os.Args[1] == "--describe" || os.Args[1] == "--worker") {
		fakeConverter()
		os.Exit(0)
	}
	result := m.Run()

	os.Exit(result)
}

func conversionStore(t *testing.T) *Store {
	t.Helper()
	executable, err := os.Executable()
	if err != nil {
		t.Fatal(err)
	}
	converterTestPath = executable
	store := testStore(t)
	store.converter.cancel()
	store.converter = newConverter(executable)
	return store
}

func fakeConverter() {
	mode := os.Getenv("LUNANAHIDA_TEST_MODULE")
	if os.Args[1] == "--describe" {
		_, _ = io.Copy(io.Discard, os.Stdin)
		if mode == "handshake-timeout" {
			time.Sleep(5 * time.Second)
		}
		description := restoreprotocol.Describe("99.0.0")
		if mode == "protocol" {
			description.Protocol++
		}
		if mode == "classification" {
			description.ClassificationRevision++
		}
		_ = json.NewEncoder(os.Stdout).Encode(description)
		return
	}
	var request restoreprotocol.Request
	_ = restoreprotocol.Decode(os.Stdin, &request)
	if mode == "tree" {
		executable, _ := os.Executable()
		child := exec.Command(executable, "--test-descendant")
		if err := child.Start(); err != nil {
			os.Exit(3)
		}
		time.Sleep(time.Hour)
		return
	}
	if mode == "wait" {
		time.Sleep(10 * time.Second)
		return
	}
	if mode == "crash" {
		os.Exit(2)
	}
	if mode == "json" {
		fmt.Print("not JSON")
		return
	}
	if mode == "large" {
		fmt.Print(string(bytes.Repeat([]byte("x"), restoreprotocol.MaxMessage+1)))
		return
	}

	response := restoreprotocol.Response{Protocol: restoreprotocol.Version, RequestID: request.RequestID, Status: "ready", AudioFile: "audio.mp3", SourceSuffix: restoreformats.SourceSuffix(request.Source), Extension: ".mp3"}
	audio := stubAudio()
	if mode == "" {
		input, err := os.ReadFile(request.Source)
		if err != nil {
			os.Exit(3)
		}
		switch {
		case bytes.HasPrefix(input, []byte("LUNA-TEST:")):
			audio = input[len("LUNA-TEST:"):]
		case bytes.HasPrefix(input, []byte("ifmt")) && len(input) > 16:
			audio = input[16:]
		case bytes.HasPrefix(input, []byte("FRM8")):
			audio, response.Extension, response.AudioFile = input, ".dff", "audio.dff"
		default:
			response.Status, response.Code, response.Message = "failed", "RESTORE_FAILED", "测试输入损坏"
		}
		if response.SourceSuffix == ".ncm" && response.Status == "ready" {
			response.Metadata = &restoreprotocol.Metadata{Title: "Local title", Artists: []string{"Local artist"}, Album: "Local album", Provider: "ncm", ProviderID: "123456", CoverFile: "cover.image"}
			var cover bytes.Buffer
			_ = png.Encode(&cover, image.NewRGBA(image.Rect(0, 0, 2, 2)))
			_ = os.WriteFile(filepath.Join(request.WorkDir, "cover.image"), cover.Bytes(), 0600)
		}
	}
	_ = os.WriteFile(filepath.Join(request.WorkDir, response.AudioFile), audio, 0600)

	switch mode {
	case "outside":
		response.AudioFile = "../outside.mp3"
	case "suffix":
		response.SourceSuffix = ".ncm"
	case "request-id":
		response.RequestID = "wrong"
	case "failed":
		response.Status, response.Message = "failed", "文件需要额外密钥"
	}
	_ = json.NewEncoder(os.Stdout).Encode(response)
}

func TestMissingConverterDisablesEveryBackendEntry(t *testing.T) {
	store := testStore(t)
	store.converter.cancel()
	store.converter = newConverter(filepath.Join(t.TempDir(), "missing.exe"))
	folder := t.TempDir()
	encrypted, _, _ := conversionFixture(t, folder, "encrypted")
	plain := filepath.Join(folder, "plain.wav")
	if err := os.WriteFile(plain, []byte("RIFFsample audio"), 0600); err != nil {
		t.Fatal(err)
	}
	canonicalPlain, err := canonical(plain)
	if err != nil {
		t.Fatal(err)
	}
	settings := DefaultSettings()
	settings.AutoConvert = true
	raw, _ := json.Marshal(settings)
	if _, err := store.DB.Exec(`INSERT INTO preferences(key,value) VALUES('settings',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, string(raw)); err != nil {
		t.Fatal(err)
	}
	restored, err := store.Settings()
	if err != nil || restored.AutoConvert {
		t.Fatalf("settings: %+v %v", restored, err)
	}
	var saved string
	_ = store.DB.QueryRow(`SELECT value FROM preferences WHERE key='settings'`).Scan(&saved)
	if bytes.Contains([]byte(saved), []byte(`"autoConvert":true`)) {
		t.Fatal("disabled setting not persisted")
	}
	if err = store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	restored, _ = store.Settings()
	if restored.AutoConvert {
		t.Fatal("settings update bypassed capability")
	}
	for _, paths := range [][]string{{encrypted, plain}, {folder}} {
		tracks, err := store.Import(paths, "library")
		if err != nil || len(tracks) != 1 || tracks[0].Path != canonicalPlain {
			t.Fatalf("mixed import: %+v %v", tracks, err)
		}
	}
	if _, err = store.Import([]string{encrypted}, "library"); err == nil {
		t.Fatal("encrypted-only import accepted")
	}
	if err = store.AddFolder(folder); err != nil {
		t.Fatal(err)
	}
	legacy, err := store.upsert(plain)
	if err != nil {
		t.Fatal(err)
	}
	canonicalEncrypted, err := canonical(encrypted)
	if err != nil {
		t.Fatal(err)
	}
	if _, err = store.DB.Exec(`UPDATE tracks SET path=? WHERE id=?`, canonicalEncrypted, legacy.ID); err != nil {
		t.Fatal(err)
	}
	for _, manual := range []bool{false, true} {
		var scan ScanResult
		if manual {
			scan, err = store.ScanManual(context.Background(), false)
		} else {
			scan, err = store.Scan(context.Background())
		}
		if err != nil || scan.Converted != 0 {
			t.Fatalf("scan: %+v %v", scan, err)
		}
		if _, err := store.GetTrack(legacy.ID); err != nil {
			t.Fatal("scan removed an existing encrypted track because the module was missing")
		}
	}
	api := NewAPI(store, Dialogs{}).Handler()
	body, _ := json.Marshal(map[string]any{"path": encrypted, "addToLibrary": true})
	response := httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodPost, "/api/conversion", bytes.NewReader(body)))
	if response.Code != 503 || !bytes.Contains(response.Body.Bytes(), []byte("CONVERTER_UNAVAILABLE")) {
		t.Fatalf("conversion API: %s", response.Body.String())
	}
	response = httptest.NewRecorder()
	api.ServeHTTP(response, httptest.NewRequest(http.MethodGet, "/api/capabilities", nil))
	if !bytes.Contains(response.Body.Bytes(), []byte(`"conversion":false`)) {
		t.Fatalf("capabilities: %s", response.Body.String())
	}
	before, err := os.ReadFile(encrypted)
	if err != nil || len(before) == 0 {
		t.Fatal("source modified")
	}
	if _, err := os.Stat(filepath.Join(folder, "encrypted.mp3")); !os.IsNotExist(err) {
		t.Fatal("output appeared without module")
	}
}

func TestConverterFailuresPreserveSource(t *testing.T) {
	for _, mode := range []string{"protocol", "classification", "handshake-timeout", "json", "large", "outside", "suffix", "request-id", "crash", "failed", "wait"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("LUNANAHIDA_TEST_MODULE", mode)
			store := testStore(t)
			store.converter.cancel()
			executable, _ := os.Executable()
			store.converter = newConverter(executable)
			source, _, _ := conversionFixture(t, t.TempDir(), "song")
			before, _ := os.ReadFile(source)
			ctx := context.Background()
			if mode == "wait" {
				var cancel context.CancelFunc
				ctx, cancel = context.WithTimeout(ctx, 200*time.Millisecond)
				defer cancel()
			}
			result := store.Convert(ctx, source, false, true)
			if result.Status != "failed" && !(mode == "wait" && result.Status == "cancelled") {
				t.Fatalf("unexpected conversion: %+v", result)
			}
			after, err := os.ReadFile(source)
			if err != nil || !bytes.Equal(before, after) {
				t.Fatal("source changed after module failure")
			}
			entries, _ := os.ReadDir(filepath.Dir(source))
			for _, entry := range entries {
				if restoreformats.JobDirectory(entry.Name()) {
					t.Fatal("staging directory leaked")
				}
			}
			if (mode == "failed" || mode == "wait") && !store.ConversionAvailable() {
				t.Fatal("single-file failure/cancellation disabled the module")
			}
		})
	}
}

func TestConverterRemovalAndReinstallation(t *testing.T) {
	store := conversionStore(t)
	module := filepath.Join(t.TempDir(), filepath.Base(converterTestPath))
	data, err := os.ReadFile(converterTestPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(module, data, 0700); err != nil {
		t.Fatal(err)
	}
	store.converter.cancel()
	store.converter = newConverter(module)
	if !store.ConversionAvailable() {
		t.Fatal("installed module not detected")
	}
	settings, _ := store.Settings()
	settings.AutoConvert = true
	if err = store.SaveSettings(settings); err != nil {
		t.Fatal(err)
	}
	if err = os.Remove(module); err != nil {
		t.Fatal(err)
	}
	settings, _ = store.Settings()
	if settings.AutoConvert || store.ConversionAvailable() {
		t.Fatal("removed module still enabled")
	}
	if err = os.WriteFile(module, data, 0700); err != nil {
		t.Fatal(err)
	}
	if !store.ConversionAvailable() {
		t.Fatal("reinstalled module not detected")
	}
	settings, _ = store.Settings()
	if settings.AutoConvert {
		t.Fatal("reinstallation enabled automatic restore")
	}
}
