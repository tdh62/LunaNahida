//go:build !windows

package backend

import (
	"os/exec"
	"runtime"
)

func openRecoveryFolder(path string) error {
	program := "xdg-open"
	if runtime.GOOS == "darwin" {
		program = "open"
	}
	command := exec.Command(program, path)
	if err := command.Start(); err != nil {
		return err
	}
	go command.Wait()
	return nil
}
