package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
)

// Fs ports Ash's src-tauri/src/fs.rs to Go. Every exported method is auto-bound
// to the frontend (frontend/wailsjs/go/main/Fs.ts), and the Tauri shim
// (src/lib/wails-shim.ts) routes invoke("read_text", …) → Fs.ReadText(…), so
// the ~30 files that call invoke() need no edits.

type Fs struct{}

func NewFs() *Fs { return &Fs{} }

// DirItem mirrors the Tauri DirItem shape (name + isDir + size) the frontend
// already expects from list_dir.
type DirItem struct {
	Name  string `json:"name"`
	IsDir bool   `json:"isDir"`
	Size  int64  `json:"size"`
}

// ReadText returns the file contents, or nil if it doesn't exist (matches the
// Tauri command's null-on-missing contract the settings/chat loaders rely on).
func (Fs) ReadText(path string) (*string, error) {
	b, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	s := string(b)
	return &s, nil
}

// WriteText writes contents to path, creating parent dirs as needed (Ash's
// chat-store + settings rely on ~/.ash/ being auto-created).
func (Fs) WriteText(path, contents string) error {
	if dir := filepath.Dir(path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	return os.WriteFile(path, []byte(contents), 0o644)
}

// DeletePath removes a file or directory (recursive for dirs). Missing is fine.
func (Fs) DeletePath(path string) error {
	err := os.RemoveAll(path)
	if err == nil || os.IsNotExist(err) {
		return nil
	}
	return err
}

// ListDir lists one directory level, sorted: dirs first then files, both
// alphabetical. Hidden entries (leading dot) are included — the frontend
// filters them per-context (explorer vs skill discovery).
func (Fs) ListDir(path string) ([]DirItem, error) {
	entries, err := os.ReadDir(path)
	if err != nil {
		return nil, err
	}
	items := make([]DirItem, 0, len(entries))
	for _, e := range entries {
		info, err := e.Info()
		if err != nil {
			continue
		}
		items = append(items, DirItem{
			Name:  e.Name(),
			IsDir: e.IsDir(),
			Size:  info.Size(),
		})
	}
	// dirs first, then files; alphabetical within each group.
	sort.SliceStable(items, func(i, j int) bool {
		if items[i].IsDir != items[j].IsDir {
			return items[i].IsDir
		}
		return strings.ToLower(items[i].Name) < strings.ToLower(items[j].Name)
	})
	return items, nil
}

// HomeDir returns the user's home directory (~ on Windows = USERPROFILE).
func (Fs) HomeDir() (string, error) {
	h, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("home dir: %w", err)
	}
	return h, nil
}
