package main

import (
	"archive/zip"
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"io"
	"os"
	"path/filepath"
	"testing"
)

func TestDistributionInventoryAndDeterministicArchive(t *testing.T) {
	parent := t.TempDir()
	source := filepath.Join(parent, "source")
	os.MkdirAll(filepath.Join(source, "modules", "music-restore"), 0755)
	os.WriteFile(filepath.Join(source, "modules", "music-restore", "中文说明.txt"), []byte("文件清单测试"), 0644)
	first, second := filepath.Join(parent, "first.zip"), filepath.Join(parent, "second.zip")
	if err := pack(source, first, "full"); err != nil {
		t.Fatal(err)
	}
	if err := pack(source, second, "full"); err != nil {
		t.Fatal(err)
	}
	a, _ := os.ReadFile(first)
	b, _ := os.ReadFile(second)
	if !bytes.Equal(a, b) {
		t.Fatal("unchanged inputs produced different archives")
	}
	archive, err := zip.OpenReader(first)
	if err != nil {
		t.Fatal(err)
	}
	defer archive.Close()
	var inventory manifest
	actual := map[string][]byte{}
	for _, file := range archive.File {
		input, _ := file.Open()
		body, _ := io.ReadAll(input)
		input.Close()
		if file.Name == "MANIFEST.json" {
			if err = json.Unmarshal(body, &inventory); err != nil {
				t.Fatal(err)
			}
		} else {
			actual[file.Name] = body
		}
	}
	if inventory.Flavor != "full" || len(inventory.Files) != 1 {
		t.Fatalf("%+v", inventory)
	}
	for _, record := range inventory.Files {
		body := actual[record.Path]
		digest := sha256.Sum256(body)
		if record.Size != int64(len(body)) || record.SHA256 != hex.EncodeToString(digest[:]) {
			t.Fatal("inventory does not match archive contents")
		}
	}
}

func TestDistributionRejectsPrivateDataAndPreservesPreviousArchive(t *testing.T) {
	parent := t.TempDir()
	source := filepath.Join(parent, "source")
	os.MkdirAll(filepath.Join(source, "userdata"), 0755)
	output := filepath.Join(parent, "package.zip")
	os.WriteFile(output, []byte("previous release"), 0644)
	if err := pack(source, output, "lean"); err == nil {
		t.Fatal("private data packaged")
	}
	got, _ := os.ReadFile(output)
	if string(got) != "previous release" {
		t.Fatal("failed build destroyed previous archive")
	}
}
