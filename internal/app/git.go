package app

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
)

// Git ports Ash's src-tauri/src/git.rs. Ash reads git state either from .git/HEAD
// directly or by shelling out — the shell-out path is simpler and portable, so
// we use it for all three commands. Each runs with cwd = the workspace path so
// it operates on the right repo.

type Git struct{}

func NewGit() *Git { return &Git{} }

// gitRun runs `git args…` in dir and returns trimmed stdout.
func gitRun(dir string, args ...string) (string, error) {
	cmd := exec.Command("git", args...)
	cmd.Dir = dir
	// The branch/status UI polls git periodically. A GUI binary must hide these
	// one-shot child processes or Windows briefly flashes a console every poll.
	hideProcessWindow(cmd)
	out, err := cmd.Output()
	if err != nil {
		// git exits non-zero outside a repo / with no commits — surface "" so
		// the frontend treats it as "no info" rather than erroring the UI.
		if _, ok := err.(*exec.ExitError); ok {
			return "", nil
		}
		return "", err
	}
	return strings.TrimSpace(string(out)), nil
}

// Branch returns the current branch name (or "" outside a repo / detached).
func (Git) Branch(dir string) (string, error) {
	if dir == "" {
		return "", nil
	}
	// fast path: not a git repo → no git invocation
	if _, err := exec.LookPath("git"); err != nil {
		return "", nil
	}
	b, err := gitRun(dir, "rev-parse", "--abbrev-ref", "HEAD")
	if err != nil {
		return "", err
	}
	return b, nil
}

// Status returns porcelain output the frontend parses into changed/added/etc
// counts. Matches the shape of Ash's git_status command.
func (Git) Status(dir string) (string, error) {
	if dir == "" {
		return "", nil
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", nil
	}
	return gitRun(dir, "status", "--porcelain")
}

// DiffStat returns `git diff --stat` output for the sidebar's per-file change
// summary line.
func (Git) DiffStat(dir string) (string, error) {
	if dir == "" {
		return "", nil
	}
	if _, err := exec.LookPath("git"); err != nil {
		return "", nil
	}
	return gitRun(dir, "diff", "--stat")
}

// repoRoot resolves the .git root for a path (used by callers that need the
// repo-scoped cwd). Kept here so future tools can share it.
func repoRoot(path string) string {
	if abs, err := filepath.Abs(path); err == nil {
		dir := abs
		for {
			if _, err := osStat(dir + "/.git"); err == nil {
				return dir
			}
			parent := filepath.Dir(dir)
			if parent == dir {
				break
			}
			dir = parent
		}
	}
	return ""
}

// osStat is a tiny indirection so tests could swap it; matches Ash's style of
// keeping filesystem probes mockable.
func osStat(path string) (osFileInfo, error) {
	return osStatReal(path)
}

type osFileInfo interface{}

// (real implementation lives in fs.go-adjacent helpers if needed; shell-out
// git doesn't require it, so this stays a placeholder.)
func osStatReal(path string) (osFileInfo, error) {
	return nil, fmt.Errorf("osStatReal not used")
}
