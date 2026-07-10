//go:build windows

package main

import (
	"fmt"
	"io"
	"os/exec"

	"github.com/UserExistsError/conpty"
)

// ptyProc wraps a single ConPTY session. Compared to the raw CreatePseudoConsole
// dance in pty_windows_raw.go (kept for reference), this is the Go DX payoff:
// a battle-tested crate does the Win API plumbing and we get a clean
// Read/Write/Resize/Close surface — a few lines vs ~200 of pty.rs.
type ptyProc struct {
	proc *conpty.ConPty
}

func (p *ptyProc) Read(buf []byte) (int, error)  { return p.proc.Read(buf) }
func (p *ptyProc) Write(b []byte) (int, error) { return p.proc.Write(b) }

func openConPTY(cwd string, cols, rows uint16) (*ptyProc, error) {
	shell := findShell()
	// conpty.Start takes a single command-line string + functional options
	// for dimensions / working dir. We quote the shell path so paths with
	// spaces parse. Read/Write hang off the returned ConPty directly — no
	// separate pipe handles to juggle.
	cmdLine := "\"" + shell[0] + "\""
	c, err := conpty.Start(
		cmdLine,
		conpty.ConPtyDimensions(int(cols), int(rows)),
		conpty.ConPtyWorkDir(cwd),
	)
	if err != nil {
		return nil, fmt.Errorf("conpty start: %w", err)
	}
	return &ptyProc{proc: c}, nil
}

func (p *ptyProc) resize(cols, rows uint16) error {
	return p.proc.Resize(int(cols), int(rows))
}

func (p *ptyProc) Close() error {
	if p.proc != nil {
		return p.proc.Close()
	}
	return nil
}

func isPipeClosed(err error) bool { return err == io.EOF }

func findShell() []string {
	// pwsh preferred, powershell fallback, cmd last resort — matches Ash's
	// Windows-shell assumption (AGENTS.md).
	for _, name := range []string{"pwsh", "powershell", "cmd"} {
		if path, err := exec.LookPath(name); err == nil {
			return []string{path}
		}
	}
	return []string{"cmd.exe"}
}
