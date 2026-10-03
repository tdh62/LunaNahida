package backend

import "os/exec"

func openRecoveryFolder(path string) error {
	command := exec.Command("explorer.exe", path)
	hideCommandWindow(command)
	if err := command.Start(); err != nil {
		return err
	}
	go command.Wait()
	return nil
}
