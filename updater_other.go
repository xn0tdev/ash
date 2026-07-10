//go:build !windows

package main

import (
	"fmt"
	"os/exec"
)

// relaunch starts a new instance of the app at exePath (mac/linux dev path).
func relaunch(exePath string) error {
	cmd := exec.Command(exePath)
	cmd.Stdin = nil
	cmd.Stdout = nil
	cmd.Stderr = nil
	return cmd.Start()
}

// elevatedSwap is Windows-only (UAC). On other OS the direct swap in
// updater.go is expected to succeed (user-writable locations).
func elevatedSwap(exePath, newPath, oldPath string) error {
	return fmt.Errorf("elevated swap: not supported on this OS")
}
