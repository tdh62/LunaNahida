package restoreprocess

import (
	"bytes"
	"context"
	"errors"
	"io"
	"lunanahida/internal/restoreprotocol"
	"os/exec"
	"time"
)

type boundedBuffer struct {
	bytes.Buffer
	overflow bool
}

func (b *boundedBuffer) Write(p []byte) (int, error) {
	n := len(p)
	space := restoreprotocol.MaxMessage - b.Len()
	if n > space {
		b.overflow = true
		p = p[:space]
	}
	_, _ = b.Buffer.Write(p)
	return n, nil
}

// Run attaches the child to its process group before sending worker input.
func Run(ctx context.Context, executable string, args []string, input []byte) ([]byte, error) {
	command := exec.CommandContext(ctx, executable, args...)
	configure(command)
	command.WaitDelay = 2 * time.Second
	var stdout, stderr boundedBuffer
	command.Stdout, command.Stderr = &stdout, &stderr
	stdin, err := command.StdinPipe()
	if err != nil {
		return nil, err
	}
	if err = command.Start(); err != nil {
		return nil, err
	}
	cleanup, err := attach(command)
	if err != nil {
		_ = stdin.Close()
		_ = command.Process.Kill()
		_ = command.Wait()
		return nil, err
	}
	defer cleanup()
	if len(input) > 0 {
		_, err = io.Copy(stdin, bytes.NewReader(input))
	}
	_ = stdin.Close()
	if err != nil {
		_ = command.Process.Kill()
	}
	waitErr := command.Wait()
	if ctx.Err() != nil {
		return nil, ctx.Err()
	}
	if err != nil {
		return nil, err
	}
	if waitErr != nil {
		return nil, waitErr
	}
	if stdout.overflow {
		return nil, errors.New("module response is too large")
	}
	return stdout.Bytes(), nil
}
