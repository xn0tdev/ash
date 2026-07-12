//go:build windows

package app

import (
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
)

func hideProcessWindow(cmd *exec.Cmd) {
	cmd.SysProcAttr = &syscall.SysProcAttr{HideWindow: true}
}

// stopProcessTree kills the command and every descendant it spawned. A plain
// Process.Kill only terminates the root PowerShell process, leaving npm/dev
// servers alive and sometimes keeping stdout/stderr pipes open past timeout.
func stopProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	windir := os.Getenv("windir")
	if windir == "" {
		windir = os.Getenv("SystemRoot")
	}
	if windir == "" {
		windir = `C:\Windows`
	}
	taskkill := filepath.Join(windir, "System32", "taskkill.exe")
	killer := exec.Command(taskkill, "/PID", strconv.Itoa(cmd.Process.Pid), "/T", "/F")
	hideProcessWindow(killer)
	if err := killer.Run(); err == nil {
		return nil
	}
	// taskkill can race a naturally-exiting process or be unavailable on an
	// unusual Windows image. Killing the direct child remains a safe fallback.
	return cmd.Process.Kill()
}

// resolveProgram pins an absolute path to a shell binary when the frontend
// passes a bare name (powershell.exe / pwsh / cmd). The one-shot Process.Run
// path funnels every frontend shell caller (bash/grep/glob/web-fetch) through
// exec.CommandContext, which does its own exec.LookPath — but LookPath depends
// on PATH. ensureSystemPath patches PATH at startup, yet Process.Run has no
// fallback if that ever regresses, unlike the PTY path (findShell). This
// mirrors findShell's candidate list so the one-shot path is independent of
// PATH for shells too. Non-shell and already-absolute programs are returned
// unchanged; exec.CommandContext then handles them as before.
func resolveProgram(program string) string {
	if program == "" {
		return program
	}
	// Already an absolute or relative path — leave it.
	if strings.ContainsAny(program, `/\`) {
		return program
	}
	lower := strings.ToLower(program)
	isShell := false
	switch lower {
	case "powershell.exe", "powershell", "pwsh.exe", "pwsh", "cmd.exe", "cmd":
		isShell = true
	}
	if !isShell {
		return program
	}
	// LookPath first (works once ensureSystemPath has patched PATH at startup).
	if path, err := exec.LookPath(program); err == nil && path != "" {
		return path
	}
	windir := os.Getenv("windir")
	if windir == "" {
		windir = os.Getenv("SystemRoot")
	}
	if windir == "" {
		windir = `C:\Windows`
	}
	// Candidate order mirrors pty_windows.go findShell(): pwsh 7 first, then
	// Windows PowerShell 5.1, then cmd. Match the requested family where
	// possible — if the caller asked for cmd, prefer cmd candidates.
	var candidates []string
	switch lower {
	case "cmd.exe", "cmd":
		candidates = []string{
			filepath.Join(windir, "System32", "cmd.exe"),
			filepath.Join(windir, "SysWOW64", "cmd.exe"),
		}
	default:
		candidates = []string{
			`C:\Program Files\PowerShell\7\pwsh.exe`,
			filepath.Join(windir, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
			filepath.Join(windir, "SysWOW64", "WindowsPowerShell", "v1.0", "powershell.exe"),
		}
	}
	for _, c := range candidates {
		if _, err := os.Stat(c); err == nil {
			return c
		}
	}
	// Nothing found — return the original so exec surfaces its usual error.
	return program
}
