package sniff

import "testing"

func TestAudioExtensionM4APrecedesMP4(t *testing.T) {
	header := []byte{0, 0, 0, 20, 'f', 't', 'y', 'p', 'i', 's', 'o', 'm', 0, 0, 0, 0, 'M', '4', 'A', ' '}
	for i := 0; i < 100; i++ {
		if ext, ok := AudioExtension(header); !ok || ext != ".m4a" {
			t.Fatalf("extension = %q, %v", ext, ok)
		}
	}
}
