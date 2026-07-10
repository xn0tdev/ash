//go:build windows

package app

import (
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
)

// relaunch starts a new instance of the app at exePath and returns. The
// caller is responsible for exiting the current process afterwards.
func relaunch(exePath string) error {
	dir := filepath.Dir(exePath)
	cmd := exec.Command(exePath)
	cmd.Dir = dir
	// Detach: CREATE_NEW_PROCESS_GROUP so the child survives the parent exit.
	cmd.SysProcAttr = &syscall.SysProcAttr{CreationFlags: 0x00000200}
	// Detach stdio so the child doesn't inherit (and block on) our pipes.
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

// elevatedSwap runs a UAC-elevated PowerShell snippet that swaps the binary
// when the install dir isn't user-writable (Program Files as non-admin).
// It renames the running exe → .old and moves the new file into place; the
// relaunch is still done by the parent (now pointing at the new binary).
func elevatedSwap(exePath, newPath, oldPath string) error {
	// Single-quoted args; escape any embedded single quotes.
	q := func(s string) string { return "'" + strings.ReplaceAll(s, "'", "''") + "'" }
	// PowerShell script: remove stale .old, rename running exe, move new in.
	script := fmt.Sprintf(
		"Remove-Item -Force -ErrorAction SilentlyContinue %s; "+
			"Rename-Item -Path %s -NewName %s; "+
			"Move-Item -Force -Path %s -Destination %s",
		q(oldPath), q(exePath), q(filepath.Base(oldPath)), q(newPath), q(exePath),
	)
	// -Verb RunAs triggers the UAC prompt; -Wait blocks until the swap finishes.
	cmd := exec.Command("powershell", "-NoProfile", "-WindowStyle", "Hidden",
		"-Command", "Start-Process powershell -Verb RunAs -Wait -ArgumentList "+
			q("-NoProfile -WindowStyle Hidden -Command "+script))
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	if err := cmd.Run(); err != nil {
		return fmt.Errorf("elevated swap (exit %v): %w", cmd.ProcessState.ExitCode(), err)
	}
	// Verify the swap actually happened (the elevated process may have been
	// cancelled at the UAC prompt).
	if _, err := os.Stat(exePath); err != nil {
		return fmt.Errorf("exe missing after swap: %w", err)
	}
	if _, err := os.Stat(newPath); err == nil {
		// new file still there → swap didn't happen (user declined UAC).
		return fmt.Errorf("update cancelled (UAC declined)")
	}
	return nil
}
