//go:build windows

package app

import (
	"fmt"
	"io"
	"os"
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

// pid returns the root shell's OS process id — the anchor for walking the
// process tree to find the foreground agent (claude.exe / agy.exe / …)
// currently driving this ConPTY.
func (p *ptyProc) pid() int {
	if p.proc != nil {
		return p.proc.Pid()
	}
	return 0
}

// resolveWorkDir mirrors Ash's pty_spawn: a real directory wins, otherwise
// fall back to the user's home. Never inherit the app's launch dir (e.g.
// C:\Program Files\Ash) — New Terminal should open in ~, not the install folder.
func resolveWorkDir(cwd string) string {
	if cwd != "" {
		if info, err := os.Stat(cwd); err == nil && info.IsDir() {
			return cwd
		}
	}
	if home, err := os.UserHomeDir(); err == nil && home != "" {
		return home
	}
	return cwd
}

func openConPTY(cwd string, cols, rows uint16, program string, args []string) (*ptyProc, error) {
	// Caller-supplied program wins (agent may spawn a specific shell); else
	// auto-detect pwsh/powershell/cmd (matches Ash's Windows-shell assumption).
	var cmdLine string
	if program != "" {
		cmdLine = "\"" + program + "\""
		for _, a := range args {
			cmdLine += " \"" + a + "\""
		}
	} else {
		shell := findShell()
		cmdLine = "\"" + shell[0] + "\""
	}
	workDir := resolveWorkDir(cwd)
	opts := []conpty.ConPtyOption{
		conpty.ConPtyDimensions(int(cols), int(rows)),
	}
	if workDir != "" {
		opts = append(opts, conpty.ConPtyWorkDir(workDir))
	}
	c, err := conpty.Start(cmdLine, opts...)
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
