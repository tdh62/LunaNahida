package restorefiles

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestRetireAndPublishNeverOverwrite(t *testing.T) {
	for _, operation := range []struct {
		name string
		run  func(string, string) error
	}{{"retire", Retire}, {"publish", Publish}} {
		t.Run(operation.name, func(t *testing.T) {
			dir := t.TempDir()
			source, target := filepath.Join(dir, "source"), filepath.Join(dir, "target")
			_ = os.WriteFile(source, []byte("original"), 0600)
			_ = os.WriteFile(target, []byte("existing"), 0600)
			if err := operation.run(source, target); err == nil {
				t.Fatal("collision accepted")
			}
			data, _ := os.ReadFile(source)
			if string(data) != "original" {
				t.Fatal("source changed after collision")
			}
			data, _ = os.ReadFile(target)
			if string(data) != "existing" {
				t.Fatal("target overwritten")
			}
			_ = os.Remove(target)
			if err := operation.run(source, target); err != nil {
				t.Fatal(err)
			}
			data, _ = os.ReadFile(target)
			if string(data) != "original" {
				t.Fatal("wrong published bytes")
			}
			if _, err := os.Stat(source); !os.IsNotExist(err) {
				t.Fatal("source not retired")
			}
		})
	}
}

func TestJournalUpdatesKeepCompleteRecord(t *testing.T) {
	dir := t.TempDir()
	journal := Journal{Source: "source", Output: "output", Retired: "backup", Stage: "source-retired"}
	if err := journal.Save(dir); err != nil {
		t.Fatal(err)
	}
	journal.Stage = "published"
	if err := journal.Save(dir); err != nil {
		t.Fatal(err)
	}
	data, err := os.ReadFile(filepath.Join(dir, "operation.json"))
	if err != nil {
		t.Fatal(err)
	}
	var actual Journal
	if err = json.Unmarshal(data, &actual); err != nil || actual != journal {
		t.Fatalf("record: %+v %v", actual, err)
	}
	entries, _ := os.ReadDir(dir)
	if len(entries) != 1 {
		t.Fatal("journal temporaries leaked")
	}
}
