package logging

import (
	"compress/gzip"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	maxActiveBytes  = 1 << 20
	maxArchiveBytes = 10 << 20
	maxAge          = 30 * 24 * time.Hour
)

// Writer bounds the active log and retains gzip archives by age and total size.
type Writer struct {
	mu           sync.Mutex
	dir          string
	file         *os.File
	size         int64
	day          string
	now          func() time.Time
	activeLimit  int64
	archiveLimit int64
	retention    time.Duration
	closed       bool
}

func Open(dir string) (*Writer, error) {
	if err := os.MkdirAll(dir, 0700); err != nil {
		return nil, err
	}
	w := &Writer{dir: dir, now: time.Now, activeLimit: maxActiveBytes, archiveLimit: maxArchiveBytes, retention: maxAge}
	if err := w.archive(); err != nil {
		return nil, err
	}
	if err := w.prune(); err != nil {
		return nil, err
	}
	return w, nil
}

func (w *Writer) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return 0, os.ErrClosed
	}
	written := 0
	for len(p) > 0 {
		day := w.now().Format("2006-01-02")
		if w.size >= w.activeLimit || (w.file != nil && w.day != day) {
			if err := w.rotate(); err != nil {
				return written, err
			}
		}
		if w.file == nil {
			file, err := os.OpenFile(filepath.Join(w.dir, "app.log"), os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0600)
			if err != nil {
				return written, err
			}
			w.file, w.day = file, day
		}
		chunk := int64(len(p))
		if room := w.activeLimit - w.size; chunk > room {
			chunk = room
		}
		n, err := w.file.Write(p[:chunk])
		written += n
		w.size += int64(n)
		p = p[n:]
		if err != nil {
			return written, err
		}
	}
	return written, nil
}

func (w *Writer) rotate() error {
	if w.file != nil {
		if err := w.file.Close(); err != nil {
			return err
		}
		w.file = nil
	}
	if err := w.archive(); err != nil {
		return err
	}
	w.size = 0
	return w.prune()
}

func (w *Writer) archive() error {
	path := filepath.Join(w.dir, "app.log")
	source, err := os.Open(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	if err != nil {
		return err
	}
	defer source.Close()
	info, err := source.Stat()
	if err != nil {
		return err
	}
	if info.Size() == 0 {
		return nil
	}
	target, err := os.CreateTemp(w.dir, "app-"+info.ModTime().UTC().Format("20060102T150405.000000000")+"-*.gz.tmp")
	if err != nil {
		return err
	}
	temporary := target.Name()
	defer os.Remove(temporary)
	compressed := gzip.NewWriter(target)
	_, copyErr := io.Copy(compressed, source)
	err = errors.Join(copyErr, compressed.Close(), target.Close())
	if err != nil {
		return err
	}
	archive := strings.TrimSuffix(temporary, ".tmp")
	if err := os.Chtimes(temporary, info.ModTime(), info.ModTime()); err != nil {
		return err
	}
	if err := os.Rename(temporary, archive); err != nil {
		return err
	}
	if err := source.Close(); err != nil {
		return err
	}
	return os.Remove(path)
}

// Prune also runs while the app is idle, so expired archives do not linger.
func (w *Writer) Prune() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	return w.prune()
}

func (w *Writer) prune() error {
	entries, err := os.ReadDir(w.dir)
	if err != nil {
		return err
	}
	var archives []os.FileInfo
	var total int64
	cutoff := w.now().Add(-w.retention)
	for _, entry := range entries {
		if entry.IsDir() || !strings.HasPrefix(entry.Name(), "app-") || !strings.HasSuffix(entry.Name(), ".gz") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if info.ModTime().Before(cutoff) {
			if err := os.Remove(filepath.Join(w.dir, info.Name())); err != nil {
				return err
			}
			continue
		}
		total += info.Size()
		archives = append(archives, info)
	}
	sort.Slice(archives, func(i, j int) bool { return archives[i].ModTime().Before(archives[j].ModTime()) })
	for _, info := range archives {
		if total <= w.archiveLimit {
			break
		}
		if err := os.Remove(filepath.Join(w.dir, info.Name())); err != nil {
			return fmt.Errorf("remove old log: %w", err)
		}
		total -= info.Size()
	}
	return nil
}

func (w *Writer) Close() error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.closed {
		return nil
	}
	w.closed = true
	return w.rotate()
}
