package backend

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"lunanahida/internal/restoreformats"
	"lunanahida/internal/restoreprotocol"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sync"
	"testing"
	"time"
)

var converterBuildOnce sync.Once
var converterTestPath, converterBuildDir string
var converterBuildErr error

func TestMain(m *testing.M) {
	if len(os.Args) == 2 && os.Args[1] == "--test-descendant" {
		_ = os.WriteFile(os.Getenv("LUNANAHIDA_TEST_CHILD_PID"), []byte(fmt.Sprint(os.Getpid())), 0600)
		time.Sleep(time.Hour)
		os.Exit(0)
	}
	// The test executable also acts as a deliberately broken module for client tests.
	if len(os.Args) >= 2 && (os.Args[1] == "--describe" || os.Args[1] == "--worker") {
		fakeConverter()
		os.Exit(0)
	}
	result := m.Run()
	if converterBuildDir != "" {
		_ = os.RemoveAll(converterBuildDir)
	}
	os.Exit(result)
}

func conversionStore(t *testing.T) *Store {
	t.Helper()
	converterBuildOnce.Do(func() {
		converterBuildDir, converterBuildErr = os.MkdirTemp("", "lunanahida-converter-tests-")
		if converterBuildErr != nil {
			return
		}
		name := "LunaNahida.Converter"
		if runtime.GOOS == "windows" {
			name += ".exe"
		}
		converterTestPath = filepath.Join(converterBuildDir, name)
		command := exec.Command("go", "build", "-o", converterTestPath, "./cmd/music-restore")
		command.Dir = ".."
		if output, err := command.CombinedOutput(); err != nil {
			converterBuildErr = fmt.Errorf("build converter: %w: %s", err, output)
		}
	})
	if converterBuildErr != nil {
		t.Fatal(converterBuildErr)
	}
	store := testStore(t)
	store.converter.cancel()
	store.converter = newConverter(converterTestPath)
	return store
}

func fakeConverter() {
	mode := os.Getenv("LUNANAHIDA_TEST_MODULE")
	if os.Args[1] == "--describe" {
		_, _ = io.Copy(io.Discard, os.Stdin)
		if mode == "handshake-timeout" {
			time.Sleep(5 * time.Second)
		}
		description := restoreprotocol.Describe()
		if mode == "protocol" {
			description.Protocol++
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
	response := restoreprotocol.Response{Protocol: 1, RequestID: request.RequestID, Status: "ready", AudioFile: "audio.mp3", SourceSuffix: ".qmc0", Extension: ".mp3"}
	_ = os.WriteFile(filepath.Join(request.WorkDir, response.AudioFile), append([]byte("ID3"), make([]byte, 128)...), 0600)
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
	encrypted, _, _ := qmcFixture(t, folder, "encrypted")
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
	for _, mode := range []string{"protocol", "handshake-timeout", "json", "large", "outside", "suffix", "request-id", "crash", "failed", "wait"} {
		t.Run(mode, func(t *testing.T) {
			t.Setenv("LUNANAHIDA_TEST_MODULE", mode)
			store := testStore(t)
			store.converter.cancel()
			executable, _ := os.Executable()
			store.converter = newConverter(executable)
			source, _, _ := qmcFixture(t, t.TempDir(), "song")
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

func TestStandaloneConverterRetainsSourceAndRejectsCollision(t *testing.T) {
	_ = conversionStore(t)
	source, _, want := qmcFixture(t, t.TempDir(), "歌曲 空格")
	outputDir := t.TempDir()
	command := exec.Command(converterTestPath, "restore", source, "--output-dir", outputDir)
	if output, err := command.CombinedOutput(); err != nil {
		t.Fatalf("CLI: %v %s", err, output)
	}
	actual, err := os.ReadFile(filepath.Join(outputDir, "歌曲 空格.mp3"))
	if err != nil || !bytes.Equal(actual, want) {
		t.Fatal("wrong standalone output")
	}
	if _, err := os.Stat(source); err != nil {
		t.Fatal("standalone mode removed source")
	}
	if err := exec.Command(converterTestPath, "restore", source, "--output-dir", outputDir).Run(); err == nil {
		t.Fatal("standalone mode overwrote output")
	}
}
