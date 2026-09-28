//go:build portable && windows

package main

import (
	"fmt"
	"os"
	"path/filepath"
)

func desktopPaths() (string, string, error) {
	executable, err := os.Executable()
	if err != nil {
		return "", "", fmt.Errorf("locate portable executable: %w", err)
	}
	directory := filepath.Dir(executable)
	browserPath := filepath.Join(directory, "WebView2")
	for _, name := range []string{"msedgewebview2.exe", filepath.Join("EBWebView", "x64", "EmbeddedBrowserWebView.dll")} {
		path := filepath.Join(browserPath, name)
		info, err := os.Stat(path)
		if err != nil {
			return "", "", fmt.Errorf("portable WebView2 runtime is incomplete (%s): %w", path, err)
		}
		if info.IsDir() {
			return "", "", fmt.Errorf("portable WebView2 runtime file is a directory: %s", path)
		}
	}
	return filepath.Join(directory, "userdata"), browserPath, nil
}
