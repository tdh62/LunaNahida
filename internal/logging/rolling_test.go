package logging

import (
	"compress/gzip"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"testing"
	"time"
)

func TestRotationPreservesContentAndBoundsActiveLog(t *testing.T) {
	dir := t.TempDir()
	w, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	w.activeLimit = 16
	now := time.Now()
	w.now = func() time.Time { return now }
	content := strings.Repeat("hello", 10)
	if n, err := w.Write([]byte(content)); err != nil || n != len(content) {
		t.Fatalf("write: %d, %v", n, err)
	}
	info, err := os.Stat(filepath.Join(dir, "app.log"))
	if err != nil || info.Size() > 16 {
		t.Fatalf("active size: %v, %v", info, err)
	}
	now = now.Add(24 * time.Hour)
	if _, err := w.Write([]byte("next day")); err != nil {
		t.Fatal(err)
	}
	if err := w.Close(); err != nil {
		t.Fatal(err)
	}
	paths, _ := filepath.Glob(filepath.Join(dir, "app-*.gz"))
	var chunks []string
	for _, path := range paths {
		file, err := os.Open(path)
		if err != nil {
			t.Fatal(err)
		}
		reader, err := gzip.NewReader(file)
		if err != nil {
			t.Fatal(err)
		}
		data, err := io.ReadAll(reader)
		if err != nil {
			t.Fatal(err)
		}
		reader.Close()
		file.Close()
		chunks = append(chunks, string(data))
	}
	sort.Strings(chunks)
	want := []string{content[:16], content[16:32], content[32:48], content[48:], "next day"}
	sort.Strings(want)
	if strings.Join(chunks, "|") != strings.Join(want, "|") {
		t.Fatalf("chunks: %q", chunks)
	}
	if _, err := w.Write([]byte("closed")); err != os.ErrClosed {
		t.Fatalf("closed writer: %v", err)
	}
}

func TestPruneAgeAndCombinedCompressedSize(t *testing.T) {
	dir := t.TempDir()
	now := time.Now()
	for _, item := range []struct {
		name string
		age  time.Duration
	}{
		{"app-expired.gz", 31 * 24 * time.Hour},
		{"app-old.gz", 2 * 24 * time.Hour},
		{"app-new.gz", time.Hour},
		{"unrelated.gz", 40 * 24 * time.Hour},
	} {
		path := filepath.Join(dir, item.name)
		if err := os.WriteFile(path, []byte(strings.Repeat("x", 10)), 0600); err != nil {
			t.Fatal(err)
		}
		stamp := now.Add(-item.age)
		if err := os.Chtimes(path, stamp, stamp); err != nil {
			t.Fatal(err)
		}
	}
	w, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	w.archiveLimit = 15
	if err := w.Prune(); err != nil {
		t.Fatal(err)
	}
	for _, name := range []string{"app-expired.gz", "app-old.gz"} {
		if _, err := os.Stat(filepath.Join(dir, name)); !os.IsNotExist(err) {
			t.Fatalf("retained %s", name)
		}
	}
	for _, name := range []string{"app-new.gz", "unrelated.gz"} {
		if _, err := os.Stat(filepath.Join(dir, name)); err != nil {
			t.Fatal(err)
		}
	}
	w.Close()
}

func TestStartupArchivesPreviousSessionAndKeepsOriginalAge(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "app.log")
	if err := os.WriteFile(path, []byte("previous session"), 0600); err != nil {
		t.Fatal(err)
	}
	stamp := time.Now().Add(-31 * 24 * time.Hour)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
	w, err := Open(dir)
	if err != nil {
		t.Fatal(err)
	}
	defer w.Close()
	entries, err := os.ReadDir(dir)
	if err != nil || len(entries) != 0 {
		t.Fatalf("expired previous session: %v, %v", entries, err)
	}
}
