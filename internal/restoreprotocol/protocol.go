package restoreprotocol

import (
	"encoding/json"
	"errors"
	"io"
)

const Version = 1
const ClassificationRevision = 1
const MaxMessage = 256 << 10
const MaxCover = 15 << 20
const Module = "LunaNahida.MusicRestore"

type Description struct {
	Module                 string   `json:"module"`
	Protocol               int      `json:"protocol"`
	Version                string   `json:"version"`
	Operations             []string `json:"operations"`
	ClassificationRevision int      `json:"classificationRevision"`
}

func Describe(version string) Description {
	return Description{Module, Version, version, []string{"restore"}, ClassificationRevision}
}

type Metadata struct {
	Title      string   `json:"title,omitempty"`
	Artists    []string `json:"artists,omitempty"`
	Album      string   `json:"album,omitempty"`
	Provider   string   `json:"provider,omitempty"`
	ProviderID string   `json:"providerId,omitempty"`
	CoverFile  string   `json:"coverFile,omitempty"`
}

type Request struct {
	Protocol  int    `json:"protocol"`
	RequestID string `json:"requestId"`
	Operation string `json:"operation"`
	Source    string `json:"source"`
	WorkDir   string `json:"workDir"`
}

type Response struct {
	Protocol     int       `json:"protocol"`
	RequestID    string    `json:"requestId"`
	Status       string    `json:"status"`
	AudioFile    string    `json:"audioFile,omitempty"`
	SourceSuffix string    `json:"sourceSuffix,omitempty"`
	Extension    string    `json:"extension,omitempty"`
	Metadata     *Metadata `json:"metadata,omitempty"`
	Warnings     []string  `json:"warnings,omitempty"`
	Code         string    `json:"code,omitempty"`
	Message      string    `json:"message,omitempty"`
}

// Decode requires exactly one bounded JSON message.
func Decode(reader io.Reader, value any) error {
	data, err := io.ReadAll(io.LimitReader(reader, MaxMessage+1))
	if err != nil {
		return err
	}
	if len(data) > MaxMessage {
		return errors.New("module message is too large")
	}
	return json.Unmarshal(data, value)
}
