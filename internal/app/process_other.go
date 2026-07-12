//go:build !windows

package app

import "os/exec"

func hideProcessWindow(_ *exec.Cmd) {}

func stopProcessTree(cmd *exec.Cmd) error {
	if cmd.Process == nil {
		return nil
	}
	return cmd.Process.Kill()
}

// resolveProgram is a no-op off Windows: bare-name resolution via absolute
// candidate paths is a Windows GUI-launch PATH issue only.
func resolveProgram(program string) string { return program }
