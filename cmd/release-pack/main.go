// release-pack writes a distribution archive using only the Go standard library.
package main

import (
	"archive/zip"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"io"
	"io/fs"
	"lunanahida/internal/buildinfo"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type fileRecord struct {
	Path   string `json:"path"`
	Size   int64  `json:"size"`
	SHA256 string `json:"sha256"`
}
type manifest struct {
	Version string       `json:"version"`
	Flavor  string       `json:"flavor"`
	Files   []fileRecord `json:"files"`
}

func pack(source, output, flavor string) (err error) {
	source, err = filepath.Abs(source)
	if err != nil {
		return err
	}
	output, err = filepath.Abs(output)
	if err != nil {
		return err
	}
	relative, err := filepath.Rel(source, output)
	if err != nil {
		return err
	}
	if relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator)) {
		return errors.New("archive must be outside its source directory")
	}
	if err = os.MkdirAll(filepath.Dir(output), 0755); err != nil {
		return err
	}
	temp, err := os.CreateTemp(filepath.Dir(output), "package-*.zip.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(temp.Name())
	defer temp.Close()
	archive := zip.NewWriter(temp)
	defer func() {
		if err != nil {
			_ = archive.Close()
		}
	}()
	records := []fileRecord{}
	err = filepath.WalkDir(source, func(path string, entry fs.DirEntry, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if entry.Type()&os.ModeSymlink != 0 {
			return errors.New("distribution packages cannot contain links")
		}
		if entry.IsDir() {
			if path != source {
				switch strings.ToLower(entry.Name()) {
				case "userdata", "logs", ".git", "cache":
					return fmt.Errorf("private data directory in package: %s", path)
				}
			}
			return nil
		}
		info, err := entry.Info()
		if err != nil {
			return err
		}
		if !info.Mode().IsRegular() {
			return errors.New("package file is not regular")
		}
		name, err := filepath.Rel(source, path)
		if err != nil {
			return err
		}
		name = filepath.ToSlash(name)
		if name == "MANIFEST.json" {
			return errors.New("MANIFEST.json is reserved for the generated file inventory")
		}
		header := &zip.FileHeader{Name: name, Method: zip.Deflate}
		header.SetMode(info.Mode())
		header.SetModTime(time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC))
		target, err := archive.CreateHeader(header)
		if err != nil {
			return err
		}
		input, err := os.Open(path)
		if err != nil {
			return err
		}
		digest := sha256.New()
		size, err := io.Copy(io.MultiWriter(target, digest), input)
		input.Close()
		if err != nil {
			return err
		}
		records = append(records, fileRecord{name, size, hex.EncodeToString(digest.Sum(nil))})
		return nil
	})
	if err != nil {
		return err
	}
	header := &zip.FileHeader{Name: "MANIFEST.json", Method: zip.Deflate}
	header.SetMode(0644)
	header.SetModTime(time.Date(2000, 1, 1, 0, 0, 0, 0, time.UTC))
	target, err := archive.CreateHeader(header)
	if err != nil {
		return err
	}
	encoder := json.NewEncoder(target)
	encoder.SetIndent("", "  ")
	if err = encoder.Encode(manifest{buildinfo.Version(), flavor, records}); err != nil {
		return err
	}
	if err = archive.Close(); err != nil {
		return err
	}
	if err = temp.Sync(); err != nil {
		return err
	}
	if err = temp.Close(); err != nil {
		return err
	}
	return os.Rename(temp.Name(), output)
}

func main() {
	source := flag.String("source", "", "package directory")
	output := flag.String("output", "", "zip output")
	flavor := flag.String("flavor", "", "distribution flavor")
	flag.Parse()
	if *source == "" || *output == "" || *flavor == "" {
		fmt.Fprintln(os.Stderr, "source, output and flavor are required")
		os.Exit(1)
	}
	if err := pack(*source, *output, *flavor); err != nil {
		fmt.Fprintln(os.Stderr, err)
		os.Exit(1)
	}
	fmt.Println(*output)
}
