package musicrestore

import (
	"lunanahida/internal/restoreformats"
	"os"
	"path/filepath"
	"testing"
	"unlock-music.dev/cli/algo/common"
)

func TestClassificationMatchesDecoderRegistry(t *testing.T) {
	dir := t.TempDir()
	for _, factory := range common.DecoderRegistry {
		name := "song" + factory.Suffix
		if len(common.GetDecoder(name, true)) == 0 {
			continue
		}
		path := filepath.Join(dir, name)
		if err := os.WriteFile(path, []byte("ifmt"), 0600); err != nil {
			t.Fatal(err)
		}
		if !restoreformats.Encrypted(path) {
			t.Fatalf("unclassified decoder suffix: %s", factory.Suffix)
		}
	}
	for _, suffix := range restoreformats.Suffixes {
		if len(common.GetDecoder("song"+suffix, true)) == 0 {
			t.Fatalf("classification without decoder: %s", suffix)
		}
	}
	path := filepath.Join(dir, "ordinary.flac")
	_ = os.WriteFile(path, []byte("fLaC"), 0600)
	if restoreformats.Encrypted(path) {
		t.Fatal("ordinary flac classified as encrypted")
	}
	for _, suffix := range []string{".kgm.flac", ".vpr.flac"} {
		path := filepath.Join(dir, "song"+suffix)
		_ = os.WriteFile(path, []byte("not ifmt"), 0600)
		if restoreformats.SourceSuffix(path) != suffix {
			t.Fatalf("compound suffix lost: %s", suffix)
		}
	}
}
