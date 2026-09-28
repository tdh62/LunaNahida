package audio

import "unlock-music.dev/cli/internal/sniff"

func Extension(header []byte) (string, bool) {
	if len(header) >= 2 && header[0] == 0xff && header[1]&0xf6 == 0xf0 {
		return ".aac", true
	}
	return sniff.AudioExtension(header)
}
