// Package restoreformats contains classification rules, without importing decoders.
package restoreformats

import (
	"bytes"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const JobPrefix = ".lunanahida-convert-job-"

var Suffixes = []string{
	".kgm.flac", ".vpr.flac", ".ncm", ".kgg", ".kgm", ".kgma", ".vpr", ".kwm", ".xm", ".x2m", ".x3m",
	".tm0", ".tm2", ".tm3", ".tm6", ".qmc0", ".qmc3", ".qmc2", ".qmc4", ".qmc6", ".qmc8", ".qmcflac", ".qmcogg", ".tkm",
	".bkcmp3", ".bkcm4a", ".bkcflac", ".bkcwav", ".bkcape", ".bkcogg", ".bkcwma",
	".666c6163", ".6d7033", ".6f6767", ".6d3461", ".776176", ".mmp4",
	".mgg", ".mgg0", ".mgg1", ".mgga", ".mggh", ".mggl", ".mggm",
	".mflac", ".mflac0", ".mflac1", ".mflaca", ".mflach", ".mflacl", ".mflacm",
}

func SourceSuffix(path string) string {
	name := strings.ToLower(filepath.Base(path))
	for _, suffix := range Suffixes {
		if strings.HasSuffix(name, suffix) {
			return suffix
		}
	}
	switch strings.ToLower(filepath.Ext(path)) {
	case ".mp3", ".flac", ".m4a", ".wav":
		file, err := os.Open(path)
		if err != nil {
			return ""
		}
		defer file.Close()
		var header [4]byte
		if _, err = io.ReadFull(file, header[:]); err == nil && string(header[:]) == "ifmt" {
			return strings.ToLower(filepath.Ext(path))
		}
	}
	return ""
}

func Encrypted(path string) bool    { return SourceSuffix(path) != "" }
func JobDirectory(name string) bool { return strings.HasPrefix(name, JobPrefix) }

func ImageMIME(data []byte) string {
	if len(data) == 0 {
		return ""
	}
	mime := http.DetectContentType(data)
	switch mime {
	case "image/jpeg", "image/png", "image/webp", "image/gif":
		return mime
	}
	return ""
}

// Verify checks a staged output without any third-party decoding dependency.
func Verify(path, ext string) error {
	file, err := os.Open(path)
	if err != nil {
		return err
	}
	defer file.Close()
	var header [64]byte
	if _, err = io.ReadFull(file, header[:]); err != nil {
		return errors.New("转换结果过短")
	}
	h := header[:]
	valid := false
	switch ext {
	case ".mp3":
		valid = bytes.HasPrefix(h, []byte("ID3")) || h[0] == 0xff && h[1]&0xe0 == 0xe0
	case ".flac":
		valid = bytes.HasPrefix(h, []byte("fLaC"))
	case ".ogg":
		valid = bytes.HasPrefix(h, []byte("OggS"))
	case ".wav":
		valid = bytes.HasPrefix(h, []byte("RIFF"))
	case ".ape":
		valid = bytes.HasPrefix(h, []byte("MAC "))
	case ".aac":
		valid = h[0] == 0xff && h[1]&0xf6 == 0xf0
	case ".m4a", ".mp4":
		valid = string(h[4:8]) == "ftyp"
	case ".wma":
		valid = bytes.HasPrefix(h, []byte{0x30, 0x26, 0xb2, 0x75, 0x8e, 0x66, 0xcf, 0x11, 0xa6, 0xd9})
	case ".dff":
		valid = bytes.HasPrefix(h, []byte("FRM8"))
	case ".dsf":
		valid = bytes.HasPrefix(h, []byte("DSD "))
	}
	if !valid {
		return errors.New("转换结果音频格式不匹配")
	}
	return nil
}

// StagedFile accepts only an ordinary file directly inside the job directory.
func StagedFile(dir, name string, maxSize int64) (string, error) {
	if name == "" || name == "." || name == ".." || filepath.Base(name) != name || strings.ContainsAny(name, "/\\:") {
		return "", errors.New("模块返回了无效文件路径")
	}
	path := filepath.Join(dir, name)
	info, err := os.Lstat(path)
	if err != nil {
		return "", err
	}
	if !info.Mode().IsRegular() || info.Size() == 0 || maxSize > 0 && info.Size() > maxSize {
		return "", errors.New("模块返回了无效文件")
	}
	return path, nil
}
