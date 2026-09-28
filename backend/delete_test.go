package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestDeleteTracksProtectsFoldersAndRemovesOnlyLibraryRecords(t *testing.T) {
	store := testStore(t)
	root := t.TempDir()
	standalone := filepath.Join(root, "standalone.wav")
	importedDir := filepath.Join(root, "imported")
	coveredDir := filepath.Join(root, "covered")
	for _, dir := range []string{importedDir, coveredDir} {
		if err := os.Mkdir(dir, 0700); err != nil {
			t.Fatal(err)
		}
	}
	imported := filepath.Join(importedDir, "folder.wav")
	covered := filepath.Join(coveredDir, "watched.wav")
	for _, path := range []string{standalone, imported, covered} {
		if err := os.WriteFile(path, []byte("RIFFsample audio"), 0600); err != nil {
			t.Fatal(err)
		}
	}
	manual, err := store.Import([]string{standalone, covered}, "library")
	if err != nil {
		t.Fatal(err)
	}
	folder, err := store.Import([]string{importedDir}, "library")
	if err != nil {
		t.Fatal(err)
	}
	if err = store.AddFolder(coveredDir); err != nil {
		t.Fatal(err)
	}
	if err = store.DeleteTracks([]int64{manual[0].ID, folder[0].ID}); err == nil {
		t.Fatal("mixed selection must be rejected atomically")
	}
	if _, err = store.GetTrack(manual[0].ID); err != nil {
		t.Fatal("valid track was partially deleted:", err)
	}
	if err = store.DeleteTracks([]int64{manual[1].ID}); err == nil {
		t.Fatal("watched track was deleted")
	}
	state, err := store.State()
	if err != nil {
		t.Fatal(err)
	}
	for _, track := range state.Tracks {
		want := track.ID == manual[0].ID
		if track.Deletable != want {
			t.Fatalf("track %d deletable=%t, want %t", track.ID, track.Deletable, want)
		}
	}
	if err = store.DeleteTracks([]int64{manual[0].ID, manual[0].ID}); err != nil {
		t.Fatal(err)
	}
	if _, err = store.GetTrack(manual[0].ID); err == nil {
		t.Fatal("track still exists")
	}
	if _, err = os.Stat(standalone); err != nil {
		t.Fatal("audio file was removed:", err)
	}
	if err = store.RemoveFolder(coveredDir); err != nil {
		t.Fatal(err)
	}
	if err = store.DeleteTracks([]int64{manual[1].ID}); err != nil {
		t.Fatal(err)
	}
}
