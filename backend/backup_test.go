package backend

import (
	"archive/zip"
	"bytes"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestBackupImportMergesWithoutOverwriting(t *testing.T) {
	source := testStore(t)
	target := testStore(t)
	folder := t.TempDir()
	targetOnlyPath := filepath.Join(folder, "target-only.wav")
	existingPath := filepath.Join(folder, "existing.wav")
	newPath := filepath.Join(folder, "new.wav")
	for _, path := range []string{targetOnlyPath, existingPath, newPath} {
		if err := os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	sourceTracks, err := source.Import([]string{existingPath, newPath}, "library")
	if err != nil || len(sourceTracks) != 2 {
		t.Fatalf("source tracks: %+v, %v", sourceTracks, err)
	}
	targetTracks, err := target.Import([]string{targetOnlyPath, existingPath}, "library")
	if err != nil || len(targetTracks) != 2 {
		t.Fatalf("target track: %+v, %v", targetTracks, err)
	}
	existingID := targetTracks[1].ID
	sharedCover, err := source.SaveCover(strings.NewReader("shared-cover"), ".png")
	if err != nil {
		t.Fatal(err)
	}
	newCover, err := source.SaveCover(strings.NewReader("new-cover"), ".jpg")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`UPDATE tracks SET title='备份标题',lyrics='备份歌词',cover=? WHERE id=?`, sharedCover, sourceTracks[0].ID); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`UPDATE tracks SET lyrics='新歌歌词',cover=? WHERE id=?`, newCover, sourceTracks[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err = target.DB.Exec(`UPDATE tracks SET title='当前标题',lyrics='当前歌词',cover=? WHERE id=?`, sharedCover, existingID); err != nil {
		t.Fatal(err)
	}
	sharedName := strings.TrimPrefix(sharedCover, "/api/media/cover/")
	if err = os.WriteFile(filepath.Join(target.Root, "cache", "covers", sharedName), []byte("current-cover"), 0600); err != nil {
		t.Fatal(err)
	}
	if err = source.CreateTag("备份标签"); err != nil {
		t.Fatal(err)
	}
	if err = source.CreateTag("rock"); err != nil {
		t.Fatal(err)
	}
	if err = source.SaveTrackTags([]int64{sourceTracks[0].ID}, []string{"备份标签", "rock"}); err != nil {
		t.Fatal(err)
	}
	if err = source.SaveTrackTags([]int64{sourceTracks[1].ID}, []string{"备份标签"}); err != nil {
		t.Fatal(err)
	}
	if err = target.CreateTag("当前标签"); err != nil {
		t.Fatal(err)
	}
	if err = target.CreateTag("Rock"); err != nil {
		t.Fatal(err)
	}
	if err = target.SaveTrackTags([]int64{existingID}, []string{"当前标签", "Rock"}); err != nil {
		t.Fatal(err)
	}
	for _, store := range []*Store{source, target} {
		name := "备份歌单"
		if store == target {
			name = "当前歌单"
		}
		if _, err = store.DB.Exec(`INSERT INTO playlists(id,name,cover_mode) VALUES('shared',?,'first-track')`, name); err != nil {
			t.Fatal(err)
		}
	}
	if _, err = source.DB.Exec(`INSERT INTO playlists(id,name,cover_mode) VALUES('new','新歌单','first-track')`); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`INSERT INTO playlist_tracks(playlist_id,track_id,position) VALUES('new',?,0)`, sourceTracks[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`INSERT INTO liked(track_id) VALUES(?)`, sourceTracks[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`INSERT INTO network_sources(kind,url) VALUES('playlist','https://example.com/source.m3u')`); err != nil {
		t.Fatal(err)
	}
	if _, err = target.DB.Exec(`INSERT INTO network_sources(kind,url) VALUES('playlist','https://example.com/current.m3u')`); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`INSERT INTO network_tracks(track_id,url,source_id) VALUES(?,'https://example.com/new.wav',1)`, sourceTracks[1].ID); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`INSERT INTO metadata_cache(key,value,expires_at) VALUES('same','backup',1),('new','value',1)`); err != nil {
		t.Fatal(err)
	}
	if _, err = target.DB.Exec(`INSERT INTO metadata_cache(key,value,expires_at) VALUES('same','current',1)`); err != nil {
		t.Fatal(err)
	}
	if _, err = source.DB.Exec(`INSERT INTO preferences(key,value) VALUES('backup-test','source')`); err != nil {
		t.Fatal(err)
	}
	if _, err = target.DB.Exec(`INSERT INTO preferences(key,value) VALUES('backup-test','current')`); err != nil {
		t.Fatal(err)
	}
	if err = source.SaveIDs("queue", []int64{sourceTracks[1].ID}); err != nil {
		t.Fatal(err)
	}
	if err = target.SaveIDs("queue", []int64{targetTracks[0].ID}); err != nil {
		t.Fatal(err)
	}
	var archive bytes.Buffer
	if err = source.ExportBackup(&archive); err != nil {
		t.Fatal(err)
	}
	result, err := target.ImportBackup(bytes.NewReader(archive.Bytes()))
	if err != nil || result.Tracks != 1 || result.Playlists != 1 || result.Tags != 1 || result.Covers != 1 {
		t.Fatalf("merge result: %+v, %v", result, err)
	}
	state, err := target.State()
	if err != nil || len(state.Tracks) != 3 || len(state.Playlists) != 2 || len(state.Liked) != 1 {
		t.Fatalf("merged state: %+v, %v", state, err)
	}
	existing, err := target.GetTrack(existingID)
	if err != nil || existing.Title != "当前标题" || existing.Lyrics != "当前歌词" || existing.Cover != sharedCover || len(existing.CustomTags) != 3 {
		t.Fatalf("existing track changed or tags missing: %+v, %v", existing, err)
	}
	var newID, importedSourceID int64
	canonicalNewPath, err := canonical(newPath)
	if err != nil {
		t.Fatal(err)
	}
	if err = target.DB.QueryRow(`SELECT id FROM tracks WHERE path=?`, canonicalNewPath).Scan(&newID); err != nil {
		t.Fatal(err)
	}
	if err = target.DB.QueryRow(`SELECT source_id FROM network_tracks WHERE track_id=?`, newID).Scan(&importedSourceID); err != nil || importedSourceID == 1 {
		t.Fatalf("network source ID was not remapped: %d, %v", importedSourceID, err)
	}
	if len(state.Queue) != 2 || state.Queue[0] != targetTracks[0].ID || state.Queue[1] != newID {
		t.Fatalf("queue merge: %+v", state.Queue)
	}
	if state.Playlists[0].Name != "当前歌单" || state.Playlists[1].Name != "新歌单" || len(state.Playlists[1].TrackIDs) != 1 || state.Playlists[1].TrackIDs[0] != newID {
		t.Fatalf("playlist merge: %+v", state.Playlists)
	}
	var cached string
	if err = target.DB.QueryRow(`SELECT value FROM metadata_cache WHERE key='same'`).Scan(&cached); err != nil || cached != "current" {
		t.Fatalf("existing cache changed: %q, %v", cached, err)
	}
	if err = target.DB.QueryRow(`SELECT value FROM preferences WHERE key='backup-test'`).Scan(&cached); err != nil || cached != "current" {
		t.Fatalf("existing preference changed: %q, %v", cached, err)
	}
	data, err := os.ReadFile(filepath.Join(target.Root, "cache", "covers", sharedName))
	if err != nil || string(data) != "current-cover" {
		t.Fatalf("existing cover changed: %q, %v", data, err)
	}
	data, err = os.ReadFile(filepath.Join(target.Root, "cache", "covers", strings.TrimPrefix(newCover, "/api/media/cover/")))
	if err != nil || string(data) != "new-cover" {
		t.Fatalf("new cover missing: %q, %v", data, err)
	}
	result, err = target.ImportBackup(bytes.NewReader(archive.Bytes()))
	if err != nil || result != (BackupImportResult{}) {
		t.Fatalf("duplicate import: %+v, %v", result, err)
	}
}

func TestBackupImportRejectsUnexpectedEntries(t *testing.T) {
	store := testStore(t)
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	entry, err := writer.Create("cache/covers/../../bad.png")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = entry.Write([]byte("bad")); err != nil {
		t.Fatal(err)
	}
	if err = writer.Close(); err != nil {
		t.Fatal(err)
	}
	if _, err = store.ImportBackup(&buffer); err == nil {
		t.Fatal("invalid archive accepted")
	}
}

func TestBackupAPIExportAndImport(t *testing.T) {
	store := testStore(t)
	handler := NewAPI(store, Dialogs{}).Handler()
	native := httptest.NewRecorder()
	handler.ServeHTTP(native, httptest.NewRequest(http.MethodPost, "/api/backup/save", nil))
	if native.Code != http.StatusOK || !strings.Contains(native.Body.String(), `"available":false`) {
		t.Fatalf("browser save fallback: %d %s", native.Code, native.Body.String())
	}
	savedPath := filepath.Join(t.TempDir(), "native.zip")
	if err := os.WriteFile(savedPath, []byte("older backup"), 0600); err != nil {
		t.Fatal(err)
	}
	nativeHandler := NewAPI(store, Dialogs{BackupSave: func() (string, error) { return savedPath, nil }}).Handler()
	native = httptest.NewRecorder()
	nativeHandler.ServeHTTP(native, httptest.NewRequest(http.MethodPost, "/api/backup/save", nil))
	saved, err := os.ReadFile(savedPath)
	if native.Code != http.StatusOK || err != nil || !bytes.HasPrefix(saved, []byte("PK")) {
		t.Fatalf("native save: %d %s, %v", native.Code, native.Body.String(), err)
	}
	export := httptest.NewRecorder()
	handler.ServeHTTP(export, httptest.NewRequest(http.MethodGet, "/api/backup", nil))
	if export.Code != http.StatusOK || !bytes.HasPrefix(export.Body.Bytes(), []byte("PK")) {
		t.Fatalf("export: %d %s", export.Code, export.Body.String())
	}
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreateFormFile("archive", "backup.zip")
	if err != nil {
		t.Fatal(err)
	}
	if _, err = part.Write(export.Body.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err = form.Close(); err != nil {
		t.Fatal(err)
	}
	request := httptest.NewRequest(http.MethodPost, "/api/backup/import", &body)
	request.Header.Set("Content-Type", form.FormDataContentType())
	imported := httptest.NewRecorder()
	handler.ServeHTTP(imported, request)
	if imported.Code != http.StatusOK {
		t.Fatalf("import: %d %s", imported.Code, imported.Body.String())
	}
}
