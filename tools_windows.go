//go:build windows

package main

import (
	"context"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
)

// Tools ports Ash's src-tauri/src/tools.rs (Windows-only behavior — matches
// the AGENTS.md constraint that the backend assumes Windows). detect_bins,
// ssh_hosts, open_in, resolve_bash, find_editors are all simple PATH/filesystem
// probes or a single process spawn.

type Tools struct{}

func NewTools() *Tools { return &Tools{} }

// ctx is stashed on startup so dialog/clipboard helpers can call Wails runtime
// (OpenFileDialog, MessageDialog, ClipboardGetText/SetText).
var toolsCtx context.Context

// DetectBins returns the subset of `names` that exist on PATH.
func (Tools) DetectBins(names []string) []string {
	var out []string
	for _, n := range names {
		if _, err := exec.LookPath(n); err == nil {
			out = append(out, n)
		}
	}
	return out
}

// ResolveBash returns an absolute path to a real POSIX bash (Git for Windows /
// MSYS2), skipping the WSL launcher masquerading as `bash` on Windows — both
// C:\Windows\System32\bash.exe and the WindowsApps App Execution Alias (a 0-
// byte reparse stub). Neither can run Windows-side git/ls in a Windows cwd.
func (Tools) ResolveBash() string {
	pathEnv := os.Getenv("PATH")
	for _, dir := range filepath.SplitList(pathEnv) {
		if isSystemDir(dir) {
			continue
		}
		cand := filepath.Join(dir, "bash.exe")
		if fi, err := os.Stat(cand); err == nil && fi.Size() > 0 {
			return cand
		}
	}
	return ""
}

func isSystemDir(dir string) bool {
	s := strings.ToLower(filepath.Clean(dir))
	return strings.Contains(s, `\windows\system32`) ||
		strings.Contains(s, `\windows\syswow64`) ||
		strings.Contains(s, `\windows\sysnative`) ||
		strings.Contains(s, `\microsoft\windowsapps`)
}

// FindEditors returns the subset of known editor CLIs present on PATH
// (code, cursor, zed, …). The frontend lists these as "Open in…" actions.
func (Tools) FindEditors() []string {
	names := []string{"code", "code-insiders", "cursor", "zed", "zed-dev", "windsurf", "trae", "clave"}
	var found []string
	for _, n := range names {
		if _, err := exec.LookPath(n); err == nil {
			found = append(found, n)
		}
	}
	return found
}

// SshHosts parses Host entries from ~/.ssh/config (Windows: USERPROFILE).
// Wildcard/negated hosts are excluded — only concrete hostnames.
func (Tools) SshHosts() []string {
	home := os.Getenv("USERPROFILE")
	if home == "" {
		h, err := os.UserHomeDir()
		if err != nil {
			return nil
		}
		home = h
	}
	b, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return nil
	}
	var hosts []string
	for _, line := range strings.Split(string(b), "\n") {
		line = strings.TrimSpace(line)
		lower := strings.ToLower(line)
		if !strings.HasPrefix(lower, "host ") {
			continue
		}
		rest := strings.TrimSpace(line[5:])
		for _, h := range strings.Fields(rest) {
			if !strings.ContainsAny(h, "*?!") {
				hosts = append(hosts, h)
			}
		}
	}
	sort.Strings(hosts)
	// dedup
	out := hosts[:0]
	for i, h := range hosts {
		if i == 0 || h != hosts[i-1] {
			out = append(out, h)
		}
	}
	return out
}

// OpenIn launches an external app for a path: "explorer" reveals/opens it,
// or an editor CLI on PATH opens the file.
func (Tools) OpenIn(app, path string, isDir bool) error {
	if app == "explorer" {
		if isDir {
			return exec.Command("explorer.exe", path).Start()
		}
		return exec.Command("explorer.exe", "/select,"+path).Start()
	}
	if exe, err := exec.LookPath(app); err == nil {
		if strings.HasSuffix(strings.ToLower(exe), ".exe") {
			return exec.Command(exe, path).Start()
		}
		return exec.Command("cmd", "/c", exe, path).Start()
	}
	return fmt.Errorf("editor not found: %s", app)
}
