package backend

import (
	"os"
	"path/filepath"
	"testing"
)

// Neutral wire fixtures keep player tests independent of decoder source and samples.
func stubAudio() []byte { return append([]byte("ID3"), make([]byte, 128)...) }
func conversionFixture(t *testing.T, folder, name string) (string, []byte, []byte) {
	t.Helper()
	audio := stubAudio()
	input := append([]byte("LUNA-TEST:"), audio...)
	source := filepath.Join(folder, name+".qmc0")
	if err := os.WriteFile(source, input, 0600); err != nil {
		t.Fatal(err)
	}
	return source, input, audio
}
