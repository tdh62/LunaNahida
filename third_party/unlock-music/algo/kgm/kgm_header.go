package kgm

import (
	"bytes"
	"encoding/binary"
	"errors"
	"fmt"
	"io"
)

var (
	vprHeader = []byte{
		0x05, 0x28, 0xBC, 0x96, 0xE9, 0xE4, 0x5A, 0x43,
		0x91, 0xAA, 0xBD, 0xD0, 0x7A, 0xF5, 0x36, 0x31,
	}
	kgmHeader = []byte{
		0x7C, 0xD5, 0x32, 0xEB, 0x86, 0x02, 0x7F, 0x4B,
		0xA8, 0xAF, 0xA6, 0x8E, 0x0F, 0xFF, 0x99, 0x14,
	}

	ErrKgmMagicHeader = errors.New("kgm magic header not matched")
)

// header is the header of a KGM file.
type header struct {
	MagicHeader    []byte // 0x00-0x0f: magic header
	AudioOffset    uint32 // 0x10-0x13: offset of audio data
	CryptoVersion  uint32 // 0x14-0x17: crypto version
	CryptoSlot     uint32 // 0x18-0x1b: crypto key slot
	CryptoTestData []byte // 0x1c-0x2b: crypto test data
	CryptoKey      []byte // 0x2c-0x3b: crypto key

	AudioHash string // v5: audio hash
}

func (h *header) FromFile(rd io.ReadSeeker) error {
	if _, err := rd.Seek(0, io.SeekStart); err != nil {
		return fmt.Errorf("kgm seek start: %w", err)
	}

	return h.FromBytes(rd)
}

func (h *header) FromBytes(r io.ReadSeeker) error {
	h.MagicHeader = make([]byte, 16)
	_, err := r.Read(h.MagicHeader)
	if err != nil {
		return err
	}
	if !bytes.Equal(kgmHeader, h.MagicHeader) && !bytes.Equal(vprHeader, h.MagicHeader) {
		return ErrKgmMagicHeader
	}

	err = binary.Read(r, binary.LittleEndian, &h.AudioOffset)
	if err != nil {
		return err
	}
	err = binary.Read(r, binary.LittleEndian, &h.CryptoVersion)
	if err != nil {
		return err
	}
	err = binary.Read(r, binary.LittleEndian, &h.CryptoSlot)
	if err != nil {
		return err
	}
	h.CryptoTestData = make([]byte, 0x10)
	_, err = r.Read(h.CryptoTestData)
	if err != nil {
		return err
	}
	h.CryptoKey = make([]byte, 0x10)
	_, err = r.Read(h.CryptoKey)
	if err != nil {
		return err
	}

	if h.CryptoVersion == 5 {
		r.Seek(0x08, io.SeekCurrent)
		var audioHashLen uint32 = 0
		err = binary.Read(r, binary.LittleEndian, &audioHashLen)
		if err != nil {
			return err
		}
		audioHashBuffer := make([]byte, audioHashLen)
		_, err = r.Read(audioHashBuffer)
		if err != nil {
			return err
		}
		h.AudioHash = string(audioHashBuffer)
	}

	return nil
}
