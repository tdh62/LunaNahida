//go:build windows

package backend

import (
	"context"
	"golang.org/x/sys/windows"
	"os"
	"path/filepath"
	"strconv"
	"testing"
	"time"
)

func TestConverterCancellationKillsDescendants(t *testing.T) {
	for _, shutdown := range []bool{false, true} {
		name := "request-cancel"
		if shutdown {
			name = "store-shutdown"
		}
		t.Run(name, func(t *testing.T) {
			t.Setenv("LUNANAHIDA_TEST_MODULE", "tree")
			pidFile := filepath.Join(t.TempDir(), "child-pid")
			t.Setenv("LUNANAHIDA_TEST_CHILD_PID", pidFile)
			store, err := Open(t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			closed := false
			defer func() {
				if !closed {
					_ = store.Close()
				}
			}()
			executable, _ := os.Executable()
			store.converter.cancel()
			store.converter = newConverter(executable)
			source, _, _ := qmcFixture(t, t.TempDir(), "song")
			ctx, cancel := context.WithCancel(context.Background())
			defer cancel()
			done := make(chan ConversionResult, 1)
			go func() { done <- store.Convert(ctx, source, false, false) }()
			var pidData []byte
			deadline := time.Now().Add(3 * time.Second)
			for time.Now().Before(deadline) {
				pidData, _ = os.ReadFile(pidFile)
				if len(pidData) > 0 {
					break
				}
				time.Sleep(10 * time.Millisecond)
			}
			pid, err := strconv.Atoi(string(pidData))
			if err != nil {
				t.Fatalf("child did not start: %v", err)
			}
			child, err := windows.OpenProcess(windows.SYNCHRONIZE|windows.PROCESS_QUERY_LIMITED_INFORMATION, false, uint32(pid))
			if err != nil {
				t.Fatal(err)
			}
			defer windows.CloseHandle(child)
			if shutdown {
				err = store.Close()
				closed = true
				if err != nil {
					t.Fatal(err)
				}
			} else {
				cancel()
			}
			select {
			case result := <-done:
				if result.Status != "cancelled" && !(shutdown && result.Status == "failed") {
					t.Fatalf("result: %+v", result)
				}
			case <-time.After(3 * time.Second):
				t.Fatal("conversion did not stop")
			}
			state, err := windows.WaitForSingleObject(child, 1000)
			if err != nil || state != windows.WAIT_OBJECT_0 {
				t.Fatalf("module descendant survived cancellation: %d %v", state, err)
			}
			if _, err := os.Stat(source); err != nil {
				t.Fatal("cancelled conversion changed source")
			}
		})
	}
}
