package backend

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strings"
	"unicode"

	"github.com/dhowden/tag"
)

type organizeFile struct {
	Path       string   `json:"path"`
	Title      string   `json:"title"`
	Artist     string   `json:"artist"`
	Album      string   `json:"album"`
	Quality    string   `json:"quality"`
	Size       int64    `json:"size"`
	Modified   int64    `json:"-"`
	Digest     string   `json:"-"`
	Tagged     bool     `json:"-"`
	Duration   float64  `json:"-"`
	Companions []string `json:"companions"`
	shared     map[string]bool
}

func organizeDigest(path string) (string, error) {
	return organizeDigestContext(context.Background(), path, nil)
}

func organizeDigestContext(ctx context.Context, path string, progress func(int64)) (string, error) {
	file, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer file.Close()
	hash := sha256.New()
	buffer := make([]byte, 256*1024)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		count, readErr := file.Read(buffer)
		if count > 0 {
			_, _ = hash.Write(buffer[:count])
			if progress != nil {
				progress(int64(count))
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			return "", readErr
		}
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

func organizeName(value string) string {
	value = strings.Map(func(character rune) rune {
		if unicode.IsControl(character) || strings.ContainsRune(`<>:"/\|?*`, character) {
			return '_'
		}
		return character
	}, value)
	value = strings.Trim(strings.TrimSpace(value), ". ")
	if value == "" {
		value = "未知"
	}
	upper := strings.ToUpper(strings.Split(value, ".")[0])
	if upper == "CON" || upper == "PRN" || upper == "AUX" || upper == "NUL" || len(upper) == 4 && (strings.HasPrefix(upper, "COM") || strings.HasPrefix(upper, "LPT")) && upper[3] >= '0' && upper[3] <= '9' {
		value = "_" + value
	}
	runes := []rune(value)
	if len(runes) > 100 {
		value = string(runes[:100])
	}
	return strings.TrimRight(value, ". ")
}

func organizeRead(path string) (organizeFile, error) {
	item, err := organizeReadContext(context.Background(), path, nil)
	if err == nil {
		item.Companions, item.shared, err = organizeSidecars(path)
	}
	return item, err
}

func organizeReadContext(ctx context.Context, path string, progress func(int64)) (organizeFile, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return organizeFile{}, err
	}
	if !info.Mode().IsRegular() {
		return organizeFile{}, fmt.Errorf("不支持符号链接或非普通文件：%s", path)
	}
	item := organizeFile{Path: path, Title: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), Artist: "未知歌手", Album: "未知专辑", Size: info.Size(), Modified: info.ModTime().UnixNano(), Companions: []string{}, shared: map[string]bool{}}
	file, err := os.Open(path)
	if err != nil {
		return item, err
	}
	metadata, readErr := tag.ReadFrom(file)
	if readErr == nil {
		title, artist := strings.TrimSpace(metadata.Title()), strings.TrimSpace(metadata.Artist())
		if artist == "" {
			artist = strings.TrimSpace(metadata.AlbumArtist())
		}
		item.Tagged = title != "" && artist != ""
		if title != "" {
			item.Title = title
		}
		if artist != "" {
			item.Artist = artist
		}
		if album := strings.TrimSpace(metadata.Album()); album != "" {
			item.Album = album
		}
	}
	file.Close()
	item.Quality, item.Duration = organizeQuality(path)
	item.Digest, err = organizeDigestContext(ctx, path, progress)
	if err != nil {
		return item, err
	}
	return item, err
}

func organizeSidecars(path string) ([]string, map[string]bool, error) {
	return organizeSidecarsCached(path, map[string]*organizeSidecarDirectory{})
}

func organizeQuality(path string) (string, float64) {
	format := strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), "."))
	file, err := os.Open(path)
	if err != nil {
		return format + " · 参数未知", 0
	}
	defer file.Close()
	header := make([]byte, 65536)
	count, _ := file.Read(header)
	header = header[:count]
	if len(header) >= 42 && string(header[:4]) == "fLaC" && header[4]&127 == 0 {
		packed := binary.BigEndian.Uint64(header[18:26])
		rate, channels, depth := packed>>44, (packed>>41&7)+1, (packed>>36&31)+1
		if rate > 0 {
			return fmt.Sprintf("FLAC · 无损 · %d Hz / %d bit / %d 声道", rate, depth, channels), float64(packed&0xfffffffff) / float64(rate)
		}
	}
	if len(header) >= 12 && string(header[:4]) == "RIFF" && string(header[8:12]) == "WAVE" {
		var rate, bytesPerSecond uint32
		var depth, channels, encoding uint16
		var dataSize uint32
		for offset := 12; offset+8 <= len(header); {
			length := binary.LittleEndian.Uint32(header[offset+4 : offset+8])
			if string(header[offset:offset+4]) == "fmt " && length >= 16 && offset+24 <= len(header) {
				encoding = binary.LittleEndian.Uint16(header[offset+8 : offset+10])
				channels = binary.LittleEndian.Uint16(header[offset+10 : offset+12])
				rate = binary.LittleEndian.Uint32(header[offset+12 : offset+16])
				bytesPerSecond = binary.LittleEndian.Uint32(header[offset+16 : offset+20])
				depth = binary.LittleEndian.Uint16(header[offset+22 : offset+24])
			}
			if string(header[offset:offset+4]) == "data" {
				dataSize = length
				break
			}
			next := int64(offset) + 8 + int64(length) + int64(length%2)
			if next > int64(len(header)) {
				break
			}
			offset = int(next)
		}
		if rate > 0 && bytesPerSecond > 0 && (encoding == 1 || encoding == 3) {
			return fmt.Sprintf("WAV · %d Hz / %d bit / %d 声道", rate, depth, channels), float64(dataSize) / float64(bytesPerSecond)
		}
	}
	if format == "MP3" {
		start := 0
		if len(header) >= 10 && string(header[:3]) == "ID3" {
			start = 10 + (int(header[6]&127) << 21) + (int(header[7]&127) << 14) + (int(header[8]&127) << 7) + int(header[9]&127)
		}
		for offset := start; offset+4 <= len(header); offset++ {
			if header[offset] != 0xff || header[offset+1]&0xe0 != 0xe0 {
				continue
			}
			version, layer := header[offset+1]>>3&3, header[offset+1]>>1&3
			index, rateIndex := header[offset+2]>>4, header[offset+2]>>2&3
			if version == 1 || layer != 1 || index == 0 || index == 15 || rateIndex == 3 {
				continue
			}
			rate := []int{44100, 48000, 32000}[rateIndex]
			bitrates := []int{0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320}
			if version != 3 {
				rate /= 2
				bitrates = []int{0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160}
			}
			if version == 0 {
				rate /= 2
			}
			return fmt.Sprintf("MP3 · %d Hz · 首帧 %d kbps（VBR 可能不同）", rate, bitrates[index]), 0
		}
	}
	return format + " · 音质参数未知（不会推断优劣）", 0
}
