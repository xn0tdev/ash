//go:build windows

package app

import (
	"os"
	"path/filepath"
	"strings"
)

// ensureSystemPath makes sure the process PATH includes the standard Windows
// system directories. GUI launchers (autostart, shortcuts, Wails dev) often
// hand the app a PATH that's missing C:\Windows\System32 — which breaks every
// exec.LookPath("powershell") / ("git") / ("rg") and every child process that
// shells out to system tools. We patch os.Environ once at startup so all later
// exec.Cmd / conpty spawns inherit a sane PATH.
//
// Idempotent: only appends directories that are genuinely missing.
func ensureSystemPath() {
	windir := os.Getenv("windir")
	if windir == "" {
		windir = os.Getenv("SystemRoot")
	}
	if windir == "" {
		windir = `C:\Windows`
	}

	required := []string{
		filepath.Join(windir, "System32"),
		filepath.Join(windir, "System32", "WindowsPowerShell", "v1.0"),
		windir,
		filepath.Join(windir, "System32", "Wbem"),
	}

	current := os.Getenv("PATH")
	parts := strings.Split(current, ";")
	lower := make([]string, 0, len(parts))
	for _, p := range parts {
		lower = append(lower, strings.ToLower(strings.TrimRight(p, `\/`)))
	}

	var missing []string
	for _, r := range required {
		if r == "" {
			continue
		}
		rl := strings.ToLower(strings.TrimRight(r, `\/`))
		if !contains(lower, rl) {
			missing = append(missing, r)
		}
	}
	if len(missing) == 0 {
		return
	}

	merged := strings.Join(append(parts, missing...), ";")
	_ = os.Setenv("PATH", merged)
}

func contains(haystack []string, needle string) bool {
	for _, h := range haystack {
		if h == needle {
			return true
		}
	}
	return false
}
