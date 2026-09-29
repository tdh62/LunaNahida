package backend

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"unicode/utf16"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
)

const maxLyricFileSize = 2 << 20

var errNoLyrics = errors.New("没有可保存的歌词")
var errLyricsTooLarge = errors.New("歌词内容过大")
var errLyricsExist = errors.New("歌曲旁已存在歌词文件")

var subtitleCue = regexp.MustCompile(`^\s*(?:(\d+):)?(\d{2}):(\d{2})[.,](\d{1,3})\s*-->`)
var subtitleBreak = regexp.MustCompile(`\n\s*\n`)

func decodeLyricFile(data []byte) string {
	if len(data) >= 2 && (data[0] == 0xff && data[1] == 0xfe || data[0] == 0xfe && data[1] == 0xff) {
		var order binary.ByteOrder = binary.LittleEndian
		if data[0] == 0xfe {
			order = binary.BigEndian
		}
		data = data[2:]
		if len(data)%2 != 0 {
			return ""
		}
		units := make([]uint16, len(data)/2)
		for i := range units {
			units[i] = order.Uint16(data[i*2:])
		}
		return strings.TrimSpace(string(utf16.Decode(units)))
	}
	data = []byte(strings.TrimPrefix(string(data), "\ufeff"))
	if utf8.Valid(data) && !strings.ContainsRune(string(data), 0) {
		return strings.TrimSpace(string(data))
	}
	decoded, err := simplifiedchinese.GB18030.NewDecoder().Bytes(data)
	if err != nil || strings.ContainsRune(string(decoded), 0) {
		return ""
	}
	return strings.TrimSpace(string(decoded))
}

func subtitleLyrics(text string) string {
	text = strings.ReplaceAll(strings.ReplaceAll(text, "\r\n", "\n"), "\r", "\n")
	var lines []string
	for _, block := range subtitleBreak.Split(text, -1) {
		rows := strings.Split(block, "\n")
		for i, row := range rows {
			match := subtitleCue.FindStringSubmatch(row)
			if match == nil {
				continue
			}
			hours, _ := strconv.Atoi(match[1])
			minutes, _ := strconv.Atoi(match[2])
			seconds, _ := strconv.Atoi(match[3])
			fraction, _ := strconv.Atoi(match[4])
			for digits := len(match[4]); digits < 3; digits++ {
				fraction *= 10
			}
			lyric := strings.TrimSpace(strings.Join(rows[i+1:], " "))
			if lyric != "" && seconds < 60 {
				lines = append(lines, fmt.Sprintf("[%02d:%02d.%03d]%s", hours*60+minutes, seconds, fraction, lyric))
			}
			break
		}
	}
	return strings.Join(lines, "\n")
}

func sidecarLyrics(audioPath string) (string, bool) {
	bases := []string{strings.TrimSuffix(audioPath, filepath.Ext(audioPath)), audioPath}
	for _, ext := range []string{".lrc", ".srt", ".vtt", ".txt"} {
		for _, base := range bases {
			for _, suffix := range []string{ext, strings.ToUpper(ext)} {
				file, err := os.Open(base + suffix)
				if err != nil {
					continue
				}
				info, err := file.Stat()
				if err != nil || !info.Mode().IsRegular() || info.Size() > maxLyricFileSize {
					file.Close()
					continue
				}
				data, err := io.ReadAll(io.LimitReader(file, maxLyricFileSize+1))
				file.Close()
				if err != nil || len(data) > maxLyricFileSize {
					continue
				}
				lyric := decodeLyricFile(data)
				if ext == ".srt" || ext == ".vtt" {
					lyric = subtitleLyrics(lyric)
				}
				if lyric != "" {
					return lyric, true
				}
			}
		}
	}
	return "", false
}

func (s *Store) SaveLyrics(id int64, lyrics string) (Track, error) {
	lyrics = strings.TrimSpace(lyrics)
	if lyrics == "" {
		return Track{}, errNoLyrics
	}
	if len(lyrics)+1 > maxLyricFileSize {
		return Track{}, errLyricsTooLarge
	}
	track, err := s.GetTrack(id)
	if err != nil {
		return Track{}, err
	}
	if track.Kind == "network" {
		return Track{}, errors.New("网络歌曲不支持保存到源文件旁")
	}
	info, err := os.Stat(track.Path)
	if err != nil {
		return Track{}, err
	}
	if !info.Mode().IsRegular() {
		return Track{}, errors.New("歌曲文件不可用")
	}
	if track.LocalLyrics {
		return Track{}, errLyricsExist
	}
	if _, found := sidecarLyrics(track.Path); found {
		return Track{}, errLyricsExist
	}
	path := strings.TrimSuffix(track.Path, filepath.Ext(track.Path)) + ".lrc"
	file, err := os.OpenFile(path, os.O_WRONLY|os.O_CREATE|os.O_EXCL, 0644)
	if errors.Is(err, os.ErrExist) {
		return Track{}, errLyricsExist
	}
	if err != nil {
		return Track{}, err
	}
	if _, err = file.WriteString(lyrics + "\n"); err != nil {
		file.Close()
		os.Remove(path)
		return Track{}, err
	}
	if err = file.Close(); err != nil {
		os.Remove(path)
		return Track{}, err
	}
	if id > 0 {
		return s.upsert(track.Path)
	}
	track.Lyrics = lyrics
	track.Translation = ""
	track.LocalLyrics = true
	track.EmbeddedLyrics = false
	s.mu.Lock()
	s.temporary[id] = track
	s.mu.Unlock()
	return track, nil
}
