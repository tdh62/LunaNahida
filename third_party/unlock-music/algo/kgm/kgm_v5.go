package kgm

import (
	"fmt"

	"unlock-music.dev/cli/algo/common"
	"unlock-music.dev/cli/algo/kgm/pc_kugou_db"
	"unlock-music.dev/cli/algo/qmc"
)

func newKgmCryptoV5(header *header, kggDatabasePath string) (common.StreamDecoder, error) {
	if header.AudioHash == "" {
		return nil, fmt.Errorf("kgm v5: missing audio hash")
	}

	if kggDatabasePath == "" {
		return nil, fmt.Errorf("kgm v5: missing kgg database path")
	}

	m, err := pc_kugou_db.CachedDumpEKey(kggDatabasePath)
	if err != nil {
		return nil, fmt.Errorf("kgm v5: decrypt kgg database: %w", err)
	}
	ekey, ok := m[header.AudioHash]
	if !ok || ekey == "" {
		return nil, fmt.Errorf("kgm v5: ekey missing from db (audio_hash=%s)", header.AudioHash)
	}

	return qmc.NewQmcCipherDecoderFromEKey([]byte(ekey))
}
