package main

import (
	"io/fs"
	"testing"
)

func TestEmbeddedInterfaceExcludesDictionary(t *testing.T) {
	if _, err := frontend.ReadFile("dist/index.html"); err != nil {
		t.Fatal(err)
	}
	assets, err := fs.Glob(frontend, "dist/assets/*")
	if err != nil || len(assets) == 0 {
		t.Fatalf("missing frontend assets: %v", err)
	}
	dictionary, err := fs.Glob(frontend, "dist/search-dict/*")
	if err != nil || len(dictionary) != 0 {
		t.Fatalf("dictionary must remain external: %v, %v", dictionary, err)
	}
}
