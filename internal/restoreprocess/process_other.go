//go:build !windows

package restoreprocess

import (
	"os/exec"
	"syscall"
)

func configure(command *exec.Cmd) { command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true} }
func attach(command *exec.Cmd) (func(), error) {
	return func() { _ = syscall.Kill(-command.Process.Pid, syscall.SIGKILL) }, nil
}
