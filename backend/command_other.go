//go:build !windows

package backend

import "os/exec"

func hideCommandWindow(command *exec.Cmd) {}
