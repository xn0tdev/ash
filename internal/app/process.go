package app

import (
	"context"
	"fmt"
	"io"
	"os"
	"os/exec"
	"sync"
	"time"
)

// Process runs bounded, one-shot commands for agent tools (bash/grep/glob).
// Interactive or long-lived commands use the ConPTY path instead.
type Process struct{}

func NewProcess() *Process { return &Process{} }

type ProcessOutput struct {
	Code     *int   `json:"code"`
	Stdout   string `json:"stdout"`
	Stderr   string `json:"stderr"`
	TimedOut bool   `json:"timed_out"`
}

func processWorkDir(cwd string) string {
	if info, err := os.Stat(cwd); err == nil && info.IsDir() {
		return cwd
	}
	home, err := os.UserHomeDir()
	if err == nil {
		return home
	}
	return ""
}

// Run starts a short-lived process, waits for it without blocking the Wails UI
// thread, and captures both output streams. Timeout cancellation kills the
// child; callers receive its captured output along with TimedOut=true.
func (Process) Run(program string, args []string, cwd string, timeoutMs int) (ProcessOutput, error) {
	if program == "" {
		return ProcessOutput{}, fmt.Errorf("program is required")
	}
	if timeoutMs <= 0 {
		timeoutMs = 120_000
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Duration(timeoutMs)*time.Millisecond)
	defer cancel()

	cmd := exec.CommandContext(ctx, program, args...)
	cmd.Dir = processWorkDir(cwd)
	hideProcessWindow(cmd)
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return ProcessOutput{}, err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return ProcessOutput{}, err
	}
	if err := cmd.Start(); err != nil {
		return ProcessOutput{}, err
	}

	var stdoutData, stderrData []byte
	var stdoutErr, stderrErr error
	var readers sync.WaitGroup
	readers.Add(2)
	go func() {
		defer readers.Done()
		stdoutData, stdoutErr = io.ReadAll(stdout)
	}()
	go func() {
		defer readers.Done()
		stderrData, stderrErr = io.ReadAll(stderr)
	}()
	waitErr := cmd.Wait()
	readers.Wait()
	if stdoutErr != nil {
		return ProcessOutput{}, stdoutErr
	}
	if stderrErr != nil {
		return ProcessOutput{}, stderrErr
	}

	out := ProcessOutput{Stdout: string(stdoutData), Stderr: string(stderrData), TimedOut: ctx.Err() == context.DeadlineExceeded}
	if cmd.ProcessState != nil {
		code := cmd.ProcessState.ExitCode()
		out.Code = &code
	}
	if waitErr != nil && !out.TimedOut {
		if _, ok := waitErr.(*exec.ExitError); !ok {
			return ProcessOutput{}, waitErr
		}
	}
	return out, nil
}
