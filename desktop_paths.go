//go:build !portable

package main

func desktopPaths() (string, string, error) {
	return "", "", nil
}
