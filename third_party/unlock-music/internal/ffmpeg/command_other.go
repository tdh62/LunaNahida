//go:build !windows

package ffmpeg

import "os/exec"

func hideCommandWindow(command *exec.Cmd) {}
