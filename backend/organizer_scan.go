package backend

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

type organizeProgress struct {
	Phase      string `json:"phase"`
	Processed  int    `json:"processed"`
	Total      int    `json:"total"`
	Current    string `json:"current"`
	Bytes      int64  `json:"bytes"`
	TotalBytes int64  `json:"totalBytes"`
	Quick      bool   `json:"quick"`
}

type organizeReporter struct {
	value organizeProgress
	last  time.Time
	emit  func(organizeProgress)
}

func (reporter *organizeReporter) send(force bool) {
	if reporter.emit != nil && (force || time.Since(reporter.last) >= 100*time.Millisecond) {
		reporter.last = time.Now()
		reporter.emit(reporter.value)
	}
}

func (o *Organizer) organizeCachedMetadata(ctx context.Context) (map[string]organizeFile, error) {
	cache := map[string]organizeFile{}
	rows, err := o.store.DB.QueryContext(ctx, `SELECT path,title,artist,album,duration,size,modified FROM tracks`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	for rows.Next() {
		var item organizeFile
		if err := rows.Scan(&item.Path, &item.Title, &item.Artist, &item.Album, &item.Duration, &item.Size, &item.Modified); err != nil {
			return nil, err
		}
		item.Tagged = strings.TrimSpace(item.Title) != "" && strings.TrimSpace(item.Artist) != "" && item.Artist != "未知歌手"
		cache[strings.ToLower(filepath.Clean(item.Path))] = item
	}
	return cache, rows.Err()
}

func organizeQuickRead(path string, cache map[string]organizeFile) (organizeFile, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return organizeFile{}, err
	}
	if !info.Mode().IsRegular() {
		return organizeFile{}, fmt.Errorf("不支持符号链接或非普通文件：%s", path)
	}
	item := organizeFile{Path: path, Title: strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)), Artist: "未知歌手", Album: "未知专辑", Size: info.Size(), Modified: info.ModTime().UnixNano()}
	if cached, present := cache[strings.ToLower(filepath.Clean(path))]; present && cached.Tagged && cached.Size == item.Size && cached.Modified == item.Modified {
		item.Title, item.Artist, item.Album, item.Tagged, item.Duration = cached.Title, cached.Artist, cached.Album, cached.Tagged, cached.Duration
	}
	item.Quality = strings.ToUpper(strings.TrimPrefix(filepath.Ext(path), ".")) + " · 快速匹配，未读取音频参数"
	return item, nil
}

type organizeSidecarDirectory struct {
	files       map[string][]string
	audioCounts map[string]int
	invalid     map[string]bool
}

func organizeSidecarsCached(path string, cache map[string]*organizeSidecarDirectory) ([]string, map[string]bool, error) {
	directory := filepath.Dir(path)
	index := cache[directory]
	if index == nil {
		entries, err := os.ReadDir(directory)
		if err != nil {
			return nil, nil, err
		}
		index = &organizeSidecarDirectory{files: map[string][]string{}, audioCounts: map[string]int{}, invalid: map[string]bool{}}
		for _, entry := range entries {
			ext := strings.ToLower(filepath.Ext(entry.Name()))
			base := strings.ToLower(strings.TrimSuffix(entry.Name(), filepath.Ext(entry.Name())))
			if !entry.IsDir() && audioTypes[ext] {
				index.audioCounts[base]++
			}
			switch ext {
			case ".lrc", ".srt", ".vtt", ".txt", ".jpg", ".jpeg", ".png", ".webp", ".gif", ".bmp":
				full := filepath.Join(directory, entry.Name())
				index.files[base] = append(index.files[base], full)
				index.invalid[full] = entry.IsDir() || entry.Type()&os.ModeSymlink != 0
			}
		}
		cache[directory] = index
	}
	stem := strings.ToLower(strings.TrimSuffix(filepath.Base(path), filepath.Ext(path)))
	companions := append([]string{}, index.files[stem]...)
	companions = append(companions, index.files[strings.ToLower(filepath.Base(path))]...)
	sort.Strings(companions)
	shared := map[string]bool{}
	for _, companion := range companions {
		if index.invalid[companion] {
			return nil, nil, fmt.Errorf("附属文件不是普通文件：%s", companion)
		}
		base := strings.ToLower(strings.TrimSuffix(filepath.Base(companion), filepath.Ext(companion)))
		shared[companion] = index.audioCounts[stem] > 1 && base == stem
	}
	return companions, shared, nil
}
