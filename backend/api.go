package backend

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

type Dialogs struct {
	Files  func() ([]string, error)
	Folder func() (string, error)
}

type API struct {
	Store   *Store
	Dialogs Dialogs
	Music   *Music
}

func NewAPI(store *Store, dialogs Dialogs) *API {
	return &API{Store: store, Dialogs: dialogs, Music: NewMusic(store)}
}

func respond(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.Header().Set("Cache-Control", "no-store")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}
func fail(w http.ResponseWriter, status int, err error) {
	respond(w, status, map[string]string{"error": err.Error()})
}
func decode(r *http.Request, value any) error {
	r.Body = http.MaxBytesReader(nil, r.Body, 2<<20)
	decoder := json.NewDecoder(r.Body)
	decoder.DisallowUnknownFields()
	if err := decoder.Decode(value); err != nil {
		return err
	}
	var extra any
	if err := decoder.Decode(&extra); err != io.EOF {
		return errors.New("unexpected trailing data")
	}
	return nil
}

func (a *API) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", func(w http.ResponseWriter, r *http.Request) {
		state, err := a.Store.State()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, state)
	})
	mux.HandleFunc("DELETE /api/tracks", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs []int64 `json:"ids"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.DeleteTracks(input.IDs); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/tags", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Name string `json:"name"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.CreateTag(input.Name); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("PUT /api/tags/rename", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			OldName string `json:"oldName"`
			NewName string `json:"newName"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.RenameTag(input.OldName, input.NewName); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("DELETE /api/tags", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Name string `json:"name"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.DeleteTag(input.Name); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("PUT /api/tracks/tags", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs  []int64  `json:"ids"`
			Tags []string `json:"tags"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.SaveTrackTags(input.IDs, input.Tags); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("PATCH /api/tracks/tags", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			IDs  []int64 `json:"ids"`
			Name string  `json:"name"`
			Add  bool    `json:"add"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.ChangeTrackTag(input.IDs, input.Name, input.Add); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("PUT /api/settings", func(w http.ResponseWriter, r *http.Request) {
		var settings Settings
		if err := decode(r, &settings); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.SaveSettings(settings); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, settings)
	})
	mux.HandleFunc("GET /api/cache", func(w http.ResponseWriter, r *http.Request) {
		stats, err := a.Store.CacheStats()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, stats)
	})
	mux.HandleFunc("POST /api/cache/clear", func(w http.ResponseWriter, r *http.Request) {
		stats, err := a.Store.ClearCache()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, stats)
	})
	mux.HandleFunc("PUT /api/playlists", func(w http.ResponseWriter, r *http.Request) {
		var playlists []Playlist
		if err := decode(r, &playlists); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.SavePlaylists(playlists); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	for _, name := range []string{"liked", "queue"} {
		name := name
		mux.HandleFunc("PUT /api/"+name, func(w http.ResponseWriter, r *http.Request) {
			var ids []int64
			if err := decode(r, &ids); err != nil {
				fail(w, 400, err)
				return
			}
			if err := a.Store.SaveIDs(name, ids); err != nil {
				fail(w, 400, err)
				return
			}
			respond(w, 200, map[string]bool{"ok": true})
		})
	}
	mux.HandleFunc("POST /api/history", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			ID int64 `json:"id"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.RecordPlay(input.ID); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("PUT /api/tracks/{id}/duration", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id <= 0 {
			fail(w, 400, errors.New("invalid track"))
			return
		}
		var input struct {
			Duration float64 `json:"duration"`
		}
		if err = decode(r, &input); err != nil || input.Duration < 0 || input.Duration > 86400 {
			fail(w, 400, errors.New("invalid duration"))
			return
		}
		_, err = a.Store.DB.Exec(`UPDATE tracks SET duration=? WHERE id=?`, input.Duration, id)
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("PUT /api/tracks/{id}/enrichment", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id <= 0 {
			fail(w, 400, errors.New("invalid track"))
			return
		}
		var input struct {
			Cover       string `json:"cover"`
			Lyric       string `json:"lyric"`
			Translation string `json:"translation"`
		}
		if err = decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if len(input.Lyric) > 2<<20 || len(input.Translation) > 2<<20 {
			fail(w, 400, errors.New("lyric too large"))
			return
		}
		a.Store.coverMu.Lock()
		defer a.Store.coverMu.Unlock()
		if input.Cover != "" {
			if !strings.HasPrefix(input.Cover, "/api/media/cover/") {
				fail(w, 400, errors.New("invalid cover"))
				return
			}
			coverPath, pathErr := a.Store.CoverPath(strings.TrimPrefix(input.Cover, "/api/media/cover/"))
			if pathErr != nil {
				fail(w, 400, pathErr)
				return
			}
			if _, pathErr = os.Stat(coverPath); pathErr != nil {
				fail(w, 400, pathErr)
				return
			}
		}
		changed, err := a.Store.DB.Exec(`UPDATE tracks SET cover=CASE WHEN embedded_cover=1 OR ?='' OR (?='1' AND cover<>'/covers/local.svg') THEN cover ELSE ? END,lyrics=CASE WHEN embedded_lyrics=1 OR local_lyrics=1 OR ?='' THEN lyrics ELSE ? END,translation=CASE WHEN embedded_lyrics=1 OR local_lyrics=1 OR ?='' THEN translation ELSE ? END WHERE id=?`, input.Cover, r.URL.Query().Get("fallback"), input.Cover, input.Lyric, input.Lyric, input.Translation, input.Translation, id)
		if err != nil {
			fail(w, 500, err)
			return
		}
		if count, _ := changed.RowsAffected(); count == 0 {
			fail(w, 404, errors.New("track not found"))
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/tracks/{id}/lyrics", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id == 0 {
			fail(w, 400, errors.New("invalid track"))
			return
		}
		var input struct {
			Lyrics string `json:"lyrics"`
		}
		if err = decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		track, err := a.Store.SaveLyrics(id, input.Lyrics)
		if err != nil {
			status := 500
			if errors.Is(err, sql.ErrNoRows) || errors.Is(err, os.ErrNotExist) {
				status = 404
			} else if errors.Is(err, errNoLyrics) || errors.Is(err, errLyricsTooLarge) {
				status = 400
			} else if errors.Is(err, errLyricsExist) {
				status = 409
			}
			fail(w, status, err)
			return
		}
		respond(w, 200, track)
	})
	mux.HandleFunc("POST /api/import", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Paths []string `json:"paths"`
			Mode  string   `json:"mode"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if len(input.Paths) == 0 || len(input.Paths) > 1000 {
			fail(w, 400, errors.New("invalid paths"))
			return
		}
		tracks, err := a.Store.Import(input.Paths, input.Mode)
		if err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, tracks)
	})
	mux.HandleFunc("POST /api/conversion/inspect", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Paths []string `json:"paths"`
		}
		if err := decode(r, &input); err != nil || len(input.Paths) > 1000 {
			fail(w, 400, errors.New("invalid paths"))
			return
		}
		found := []string{}
		for _, raw := range input.Paths {
			path, err := canonical(raw)
			if err != nil {
				continue
			}
			info, err := os.Stat(path)
			if err != nil {
				continue
			}
			if !info.IsDir() {
				if encryptedFile(path) {
					found = append(found, path)
				}
				continue
			}
			_ = filepath.WalkDir(path, func(item string, entry os.DirEntry, walkErr error) error {
				if walkErr != nil {
					return nil
				}
				if entry.IsDir() {
					if entry.Name() == backupFolder {
						return filepath.SkipDir
					}
					return nil
				}
				if encryptedFile(item) {
					found = append(found, item)
				}
				if len(found) >= 1000 {
					return filepath.SkipAll
				}
				return nil
			})
		}
		respond(w, 200, map[string]any{"paths": found})
	})
	mux.HandleFunc("POST /api/conversion", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Path         string `json:"path"`
			AddToLibrary bool   `json:"addToLibrary"`
		}
		if err := decode(r, &input); err != nil || input.Path == "" {
			fail(w, 400, errors.New("invalid path"))
			return
		}
		settings, err := a.Store.Settings()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, a.Store.Convert(r.Context(), input.Path, settings.BackupOriginal, input.AddToLibrary))
	})
	mux.HandleFunc("PUT /api/tracks/{id}/playback", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil || id <= 0 {
			fail(w, 400, errors.New("invalid track"))
			return
		}
		var input struct {
			Status string `json:"status"`
		}
		if err = decode(r, &input); err != nil || input.Status != "playable" && input.Status != "unplayable" && input.Status != "unknown" {
			fail(w, 400, errors.New("invalid status"))
			return
		}
		if _, err = a.Store.DB.Exec(`UPDATE tracks SET playback_status=? WHERE id=?`, input.Status, id); err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("POST /api/scan", func(w http.ResponseWriter, r *http.Request) {
		result, err := a.Store.Scan(r.Context())
		if err != nil {
			fail(w, 409, err)
			return
		}
		respond(w, 200, result)
	})
	mux.HandleFunc("POST /api/folders", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Path string `json:"path"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.AddFolder(input.Path); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("DELETE /api/folders", func(w http.ResponseWriter, r *http.Request) {
		var input struct {
			Path string `json:"path"`
		}
		if err := decode(r, &input); err != nil {
			fail(w, 400, err)
			return
		}
		if err := a.Store.RemoveFolder(input.Path); err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]bool{"ok": true})
	})
	mux.HandleFunc("GET /api/dialog/files", func(w http.ResponseWriter, r *http.Request) {
		if a.Dialogs.Files == nil {
			fail(w, 501, errors.New("native file dialog requires Wails"))
			return
		}
		paths, err := a.Dialogs.Files()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]any{"paths": paths})
	})
	mux.HandleFunc("GET /api/dialog/folder", func(w http.ResponseWriter, r *http.Request) {
		if a.Dialogs.Folder == nil {
			fail(w, 501, errors.New("native folder dialog requires Wails"))
			return
		}
		path, err := a.Dialogs.Folder()
		if err != nil {
			fail(w, 500, err)
			return
		}
		respond(w, 200, map[string]any{"paths": []string{path}})
	})
	mux.HandleFunc("GET /api/media/audio/{id}", func(w http.ResponseWriter, r *http.Request) {
		id, err := strconv.ParseInt(r.PathValue("id"), 10, 64)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		path, err := a.Store.MediaPath(id)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		file, err := os.Open(path)
		if err != nil {
			http.NotFound(w, r)
			return
		}
		defer file.Close()
		info, err := file.Stat()
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Type", audioMIME(filepath.Ext(path)))
		http.ServeContent(w, r, info.Name(), info.ModTime(), file)
	})
	mux.HandleFunc("GET /api/media/cover/{name}", func(w http.ResponseWriter, r *http.Request) {
		path, err := a.Store.CoverPath(r.PathValue("name"))
		if err != nil {
			http.NotFound(w, r)
			return
		}
		w.Header().Set("Cache-Control", "private, max-age=86400")
		http.ServeFile(w, r, path)
	})
	mux.HandleFunc("POST /api/media/cover", func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, 15<<20)
		file, header, err := r.FormFile("image")
		if err != nil {
			fail(w, 400, err)
			return
		}
		defer file.Close()
		ext := strings.ToLower(filepath.Ext(header.Filename))
		cover, err := a.Store.SaveCover(file, ext)
		if err != nil {
			fail(w, 400, err)
			return
		}
		respond(w, 200, map[string]string{"cover": cover})
	})
	mux.HandleFunc("GET /api/music/enrich", a.Music.Enrich)
	mux.HandleFunc("GET /api/music/artist", a.Music.Artist)
	mux.HandleFunc("GET /api/music/album", a.Music.Album)
	return mux
}

func audioMIME(ext string) string {
	switch strings.ToLower(ext) {
	case ".mp3":
		return "audio/mpeg"
	case ".m4a", ".mp4":
		return "audio/mp4"
	case ".aac":
		return "audio/aac"
	case ".wav":
		return "audio/wav"
	case ".ogg", ".oga":
		return "audio/ogg"
	case ".opus":
		return "audio/opus"
	case ".flac":
		return "audio/flac"
	case ".webm":
		return "audio/webm"
	default:
		return "application/octet-stream"
	}
}

func (a *API) RunScans(ctx context.Context, notify func(ScanResult)) {
	settings, err := a.Store.Settings()
	if err == nil && settings.ScanOnStart {
		go func() {
			result, err := a.Store.Scan(ctx)
			if err != nil {
				log.Printf("startup scan: %v", err)
			} else if notify != nil {
				notify(result)
			}
		}()
	}
	go func() {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		last := time.Now()
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				settings, err := a.Store.Settings()
				if err != nil || settings.ScanIntervalMinutes <= 0 {
					continue
				}
				if time.Since(last) < time.Duration(settings.ScanIntervalMinutes)*time.Minute {
					continue
				}
				last = time.Now()
				result, err := a.Store.Scan(ctx)
				if err != nil {
					log.Printf("scheduled scan: %v", err)
				} else if notify != nil {
					notify(result)
				}
			}
		}
	}()
}
