package restorefiles

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"lunanahida/internal/restoreprotocol"
	"os"
	"path/filepath"
)

type Journal struct {
	Source       string                    `json:"source"`
	Output       string                    `json:"output"`
	Retired      string                    `json:"retired,omitempty"`
	Stage        string                    `json:"stage"`
	SourceHash   string                    `json:"sourceHash,omitempty"`
	OutputHash   string                    `json:"outputHash,omitempty"`
	Backup       bool                      `json:"backup,omitempty"`
	AddToLibrary bool                      `json:"addToLibrary,omitempty"`
	TrackID      int64                     `json:"trackId,omitempty"`
	Response     *restoreprotocol.Response `json:"response,omitempty"`
}

// Digest is also used during recovery to reject files replaced since the task ran.
func Digest(ctx context.Context, path string) (string, error) {
	f, err := os.Open(path)
	if err != nil {
		return "", err
	}
	defer f.Close()
	h := sha256.New()
	buffer := make([]byte, 128<<10)
	for {
		if err := ctx.Err(); err != nil {
			return "", err
		}
		n, err := f.Read(buffer)
		_, _ = h.Write(buffer[:n])
		if err == io.EOF {
			return hex.EncodeToString(h.Sum(nil)), nil
		}
		if err != nil {
			return "", err
		}
	}
}

func (j Journal) Save(dir string) error {
	data, err := json.MarshalIndent(j, "", "  ")
	if err != nil {
		return err
	}
	file, err := os.CreateTemp(dir, "operation-*.tmp")
	if err != nil {
		return err
	}
	defer os.Remove(file.Name())
	_, err = file.Write(data)
	if syncErr := file.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := file.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		return err
	}
	return os.Rename(file.Name(), filepath.Join(dir, "operation.json"))
}

// Retire never replaces a backup or a concurrently recreated source path.
func Retire(source, target string) error {
	if err := os.Link(source, target); err != nil {
		input, err := os.Open(source)
		if err != nil {
			return err
		}
		output, err := os.OpenFile(target, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
		if err != nil {
			_ = input.Close()
			return err
		}
		_, err = io.Copy(output, input)
		_ = input.Close()
		if syncErr := output.Sync(); err == nil {
			err = syncErr
		}
		if closeErr := output.Close(); err == nil {
			err = closeErr
		}
		if err != nil {
			_ = os.Remove(target)
			return err
		}
	}
	if err := os.Remove(source); err != nil {
		_ = os.Remove(target)
		return err
	}
	return nil
}

func Publish(temp, output string) error {
	if err := os.Link(temp, output); err == nil {
		_ = os.Remove(temp)
		return nil
	} else if _, statErr := os.Stat(output); statErr == nil {
		return errors.New("目标文件已存在，未覆盖")
	}
	source, err := os.Open(temp)
	if err != nil {
		return err
	}
	defer source.Close()
	target, err := os.OpenFile(output, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0600)
	if err != nil {
		return err
	}
	_, err = io.Copy(target, source)
	if syncErr := target.Sync(); err == nil {
		err = syncErr
	}
	if closeErr := target.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		_ = os.Remove(output)
		return err
	}
	_ = os.Remove(temp)
	return nil
}
