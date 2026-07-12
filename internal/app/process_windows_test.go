//go:build windows

package app

import (
	"testing"
	"time"
)

func TestProcessCancelStopsRunningCommand(t *testing.T) {
	process := NewProcess()
	type result struct {
		out ProcessOutput
		err error
	}
	finished := make(chan result, 1)
	started := time.Now()

	go func() {
		out, err := process.Run(
			"cancel-test",
			"powershell.exe",
			[]string{"-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 10"},
			t.TempDir(),
			30_000,
		)
		finished <- result{out: out, err: err}
	}()

	time.Sleep(250 * time.Millisecond)
	process.Cancel("cancel-test")

	select {
	case got := <-finished:
		if got.err != nil {
			t.Fatalf("Run() error = %v", got.err)
		}
		if !got.out.Cancelled {
			t.Fatalf("Run() Cancelled = false, output = %#v", got.out)
		}
		if elapsed := time.Since(started); elapsed > 5*time.Second {
			t.Fatalf("Run() returned after %s, want cancellation within 5s", elapsed)
		}
	case <-time.After(6 * time.Second):
		t.Fatal("Run() did not return after Cancel()")
	}
}

func TestProcessTimeoutStopsRunningCommand(t *testing.T) {
	process := NewProcess()
	started := time.Now()
	out, err := process.Run(
		"timeout-test",
		"powershell.exe",
		[]string{"-NoProfile", "-NonInteractive", "-Command", "Start-Sleep -Seconds 10"},
		t.TempDir(),
		500,
	)
	if err != nil {
		t.Fatalf("Run() error = %v", err)
	}
	if !out.TimedOut {
		t.Fatalf("Run() TimedOut = false, output = %#v", out)
	}
	if out.Cancelled {
		t.Fatalf("Run() Cancelled = true after timeout, output = %#v", out)
	}
	if elapsed := time.Since(started); elapsed > 5*time.Second {
		t.Fatalf("Run() returned after %s, want timeout within 5s", elapsed)
	}
}
