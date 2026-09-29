package backend

import (
	"os"
	"path/filepath"
	"testing"
)

func TestImportSkipsUnsupportedFiles(t *testing.T) {
	for _, mode := range []string{"temporary", "library", "watch"} {
		t.Run(mode, func(t *testing.T) {
			store := testStore(t)
			folder := t.TempDir()
			lyric := filepath.Join(folder, "notes.lrc")
			text := filepath.Join(folder, "notes.txt")
			audio := filepath.Join(folder, "song.wav")
			for path, content := range map[string]string{lyric: "[00:01.00]line", text: "notes", audio: "RIFFsample audio"} {
				if err := os.WriteFile(path, []byte(content), 0600); err != nil {
					t.Fatal(err)
				}
			}

			tracks, err := store.Import([]string{lyric, text}, mode)
			if err != nil || len(tracks) != 0 {
				t.Fatalf("unsupported files: %+v, %v", tracks, err)
			}
			state, err := store.State()
			if err != nil || len(state.Folders) != 0 {
				t.Fatalf("unsupported files changed watched folders: %+v, %v", state.Folders, err)
			}

			tracks, err = store.Import([]string{lyric, audio, text}, mode)
			canonicalAudio, pathErr := canonical(audio)
			if err != nil || pathErr != nil || len(tracks) != 1 || tracks[0].Path != canonicalAudio {
				t.Fatalf("mixed files: %+v, %v", tracks, err)
			}
		})
	}
}
