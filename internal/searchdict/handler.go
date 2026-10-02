package searchdict

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

var files = []string{"base.dat.gz", "check.dat.gz", "tid.dat.gz", "tid_pos.dat.gz", "tid_map.dat.gz", "cc.dat.gz", "unk.dat.gz", "unk_pos.dat.gz", "unk_map.dat.gz", "unk_char.dat.gz", "unk_compat.dat.gz", "unk_invoke.dat.gz"}

// Handler serves only dictionary resources from the executable's directory.
func Handler(executableDirectory string) http.Handler {
	root := filepath.Join(executableDirectory, "search-dict")
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodGet && r.Method != http.MethodHead {
			w.Header().Set("Allow", "GET, HEAD")
			w.WriteHeader(http.StatusMethodNotAllowed)
			return
		}
		name := strings.TrimPrefix(r.URL.Path, "/search-dict/")
		if name == "manifest.json" {
			available := true
			for _, file := range files {
				f, err := os.Open(filepath.Join(root, file))
				if err != nil {
					available = false
					break
				}
				info, err := f.Stat()
				f.Close()
				if err != nil || !info.Mode().IsRegular() || info.Size() == 0 {
					available = false
					break
				}
			}
			w.Header().Set("Content-Type", "application/json")
			w.Header().Set("Cache-Control", "no-store")
			if r.Method == http.MethodGet {
				json.NewEncoder(w).Encode(map[string]bool{"available": available})
			}
			return
		}
		allowed := name == "LICENSE-2.0.txt" || name == "NOTICE.md"
		for _, file := range files {
			if name == file {
				allowed = true
				break
			}
		}
		if !allowed {
			http.NotFound(w, r)
			return
		}
		f, err := os.Open(filepath.Join(root, name))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer f.Close()
		info, err := f.Stat()
		if err != nil || !info.Mode().IsRegular() {
			http.NotFound(w, r)
			return
		}
		if strings.HasSuffix(name, ".dat.gz") {
			w.Header().Set("Content-Type", "application/octet-stream")
		}
		http.ServeContent(w, r, name, info.ModTime(), f)
	})
}
