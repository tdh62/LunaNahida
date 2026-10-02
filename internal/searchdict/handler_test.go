package searchdict

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func TestOptionalDictionary(t *testing.T) {
	root := t.TempDir()
	handler := Handler(root)
	available := func(want bool) {
		t.Helper()
		w := httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", "/search-dict/manifest.json", nil))
		var result struct {
			Available bool `json:"available"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &result); err != nil || w.Code != 200 || result.Available != want {
			t.Fatalf("availability = %s, want %v (%v)", w.Body.String(), want, err)
		}
	}
	available(false)
	directory := filepath.Join(root, "search-dict")
	if err := os.Mkdir(directory, 0755); err != nil {
		t.Fatal(err)
	}
	for i, name := range files {
		if err := os.WriteFile(filepath.Join(directory, name), []byte("dictionary"), 0644); err != nil {
			t.Fatal(err)
		}
		available(i == len(files)-1)
	}
	w := httptest.NewRecorder()
	r := httptest.NewRequest("GET", "/search-dict/base.dat.gz", nil)
	r.Header.Set("Range", "bytes=0-3")
	handler.ServeHTTP(w, r)
	if w.Code != 206 || w.Body.String() != "dict" || w.Header().Get("Content-Type") != "application/octet-stream" {
		t.Fatalf("dictionary response: %v", w)
	}
	for _, path := range []string{"/search-dict/", "/search-dict/../secret", "/search-dict/sub/base.dat.gz", "/search-dict/arbitrary.dat.gz"} {
		w = httptest.NewRecorder()
		handler.ServeHTTP(w, httptest.NewRequest("GET", path, nil))
		if w.Code != 404 {
			t.Fatalf("unexpected access to %s: %d", path, w.Code)
		}
	}
	if err := os.WriteFile(filepath.Join(directory, files[0]), nil, 0644); err != nil {
		t.Fatal(err)
	}
	available(false)
}
