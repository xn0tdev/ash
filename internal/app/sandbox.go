package app

import (
	"crypto/rand"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Sandbox keeps Safe mode's working copy separate from the user's project.
// It intentionally copies source files instead of linking any directories back
// to the project: a command running in a sandbox must never be able to mutate
// the live workspace through a dependency junction.
type Sandbox struct{}

func NewSandbox() *Sandbox { return &Sandbox{} }

type SandboxInfo struct {
	Path  string `json:"path"`
	Files int    `json:"files"`
}

type FileChange struct {
	Path   string `json:"path"`
	Status string `json:"status"`
}

var sandboxAlwaysSkip = map[string]struct{}{
	".git": {}, "node_modules": {}, "target": {}, "dist": {}, "build": {},
	"out": {}, ".next": {}, ".turbo": {}, ".cache": {}, ".parcel-cache": {},
	"coverage": {}, ".svelte-kit": {}, ".nuxt": {}, "__pycache__": {},
	".venv": {}, "venv": {}, ".mypy_cache": {}, ".pytest_cache": {},
	".gradle": {}, ".idea": {},
}

func sandboxHome() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil || home == "" {
		return "", fmt.Errorf("couldn't determine the user home directory")
	}
	return filepath.Join(home, ".ash", "sandboxes"), nil
}

func canonicalDir(path string) (string, error) {
	abs, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	real, err := filepath.EvalSymlinks(abs)
	if err != nil {
		return "", err
	}
	info, err := os.Stat(real)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("not a directory: %s", path)
	}
	return filepath.Clean(real), nil
}

func pathInside(root, path string) bool {
	rel, err := filepath.Rel(root, path)
	if err != nil {
		return false
	}
	return rel != ".." && !strings.HasPrefix(rel, ".."+string(filepath.Separator)) && !filepath.IsAbs(rel)
}

func randomSuffix() (string, error) {
	bytes := make([]byte, 6)
	if _, err := rand.Read(bytes); err != nil {
		return "", err
	}
	return fmt.Sprintf("%x", bytes), nil
}

// gitignoreNames deliberately handles only plain basenames. Pattern matching a
// full .gitignore safely is out of scope here; the fixed heavy-directory list
// handles build output, while simple ignored secrets such as .env stay out of a
// sandbox copy.
func gitignoreNames(root string) map[string]struct{} {
	skipped := map[string]struct{}{}
	content, err := os.ReadFile(filepath.Join(root, ".gitignore"))
	if err != nil {
		return skipped
	}
	for _, raw := range strings.Split(string(content), "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") || strings.HasPrefix(line, "!") {
			continue
		}
		name := strings.Trim(line, "/")
		if name == "" || strings.ContainsAny(name, "\\/*?[") {
			continue
		}
		skipped[name] = struct{}{}
	}
	return skipped
}

func shouldSkip(name string, ignored map[string]struct{}) bool {
	if _, ok := sandboxAlwaysSkip[name]; ok {
		return true
	}
	_, ok := ignored[name]
	return ok
}

func copySandboxTree(source, destination string, ignored map[string]struct{}) (int, error) {
	files := 0
	var copyDir func(string, string) error
	copyDir = func(from, to string) error {
		if err := os.MkdirAll(to, 0o755); err != nil {
			return err
		}
		entries, err := os.ReadDir(from)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if shouldSkip(entry.Name(), ignored) {
				continue
			}
			sourcePath := filepath.Join(from, entry.Name())
			destinationPath := filepath.Join(to, entry.Name())
			info, err := entry.Info()
			if err != nil {
				return err
			}
			// Never follow a link from the source tree into an arbitrary location.
			if info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			if info.IsDir() {
				if err := copyDir(sourcePath, destinationPath); err != nil {
					return err
				}
				continue
			}
			if !info.Mode().IsRegular() {
				continue
			}
			if err := copyFile(sourcePath, destinationPath, info.Mode()); err != nil {
				return err
			}
			files++
		}
		return nil
	}
	if err := copyDir(source, destination); err != nil {
		return 0, err
	}
	return files, nil
}

func copyFile(from, to string, mode os.FileMode) error {
	in, err := os.Open(from)
	if err != nil {
		return err
	}
	defer in.Close()
	out, err := os.OpenFile(to, os.O_CREATE|os.O_TRUNC|os.O_WRONLY, mode.Perm())
	if err != nil {
		return err
	}
	_, copyErr := io.Copy(out, in)
	closeErr := out.Close()
	if copyErr != nil {
		return copyErr
	}
	return closeErr
}

// Copy creates a fresh, filtered project copy in ~/.ash/sandboxes. It refuses
// home directories and volume roots, which are never meaningful Safe mode
// workspaces and could copy a user's entire machine.
func (Sandbox) Copy(source string) (SandboxInfo, error) {
	project, err := canonicalDir(source)
	if err != nil {
		return SandboxInfo{}, fmt.Errorf("safe mode can't read the workspace: %w", err)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return SandboxInfo{}, fmt.Errorf("safe mode couldn't determine the user home directory")
	}
	if realHome, err := canonicalDir(home); err == nil && samePath(project, realHome) {
		return SandboxInfo{}, fmt.Errorf("Safe mode can't sandbox your home directory — open a project folder")
	}
	if filepath.Dir(project) == project {
		return SandboxInfo{}, fmt.Errorf("Safe mode can't sandbox a drive root — open a project folder")
	}

	root, err := sandboxHome()
	if err != nil {
		return SandboxInfo{}, err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return SandboxInfo{}, err
	}
	if pathInside(project, root) {
		return SandboxInfo{}, fmt.Errorf("safe mode storage can't be inside the workspace")
	}
	if err := os.MkdirAll(root, 0o700); err != nil {
		return SandboxInfo{}, fmt.Errorf("safe mode couldn't create its storage: %w", err)
	}

	suffix, err := randomSuffix()
	if err != nil {
		return SandboxInfo{}, fmt.Errorf("safe mode couldn't create a sandbox id: %w", err)
	}
	name := fmt.Sprintf("%s-%d-%s", filepath.Base(project), time.Now().UnixMilli(), suffix)
	destination := filepath.Join(root, name)
	if !pathInside(root, destination) {
		return SandboxInfo{}, fmt.Errorf("invalid sandbox destination")
	}
	files, err := copySandboxTree(project, destination, gitignoreNames(project))
	if err != nil {
		_ = os.RemoveAll(destination)
		return SandboxInfo{}, fmt.Errorf("safe mode couldn't copy the workspace: %w", err)
	}
	return SandboxInfo{Path: destination, Files: files}, nil
}

func samePath(a, b string) bool {
	if filepath.VolumeName(a) != "" || filepath.VolumeName(b) != "" {
		return strings.EqualFold(filepath.Clean(a), filepath.Clean(b))
	}
	return filepath.Clean(a) == filepath.Clean(b)
}

func sandboxDir(path string) (string, error) {
	root, err := sandboxHome()
	if err != nil {
		return "", err
	}
	root, err = filepath.Abs(root)
	if err != nil {
		return "", err
	}
	candidate, err := filepath.Abs(path)
	if err != nil {
		return "", err
	}
	if !pathInside(root, candidate) || samePath(root, candidate) {
		return "", fmt.Errorf("refusing a path outside Safe mode storage")
	}
	info, err := os.Stat(candidate)
	if err != nil {
		return "", err
	}
	if !info.IsDir() {
		return "", fmt.Errorf("no sandbox at %s", path)
	}
	return filepath.Clean(candidate), nil
}

func collectFiles(root string, ignored map[string]struct{}) (map[string]string, error) {
	files := map[string]string{}
	var walk func(string) error
	walk = func(directory string) error {
		entries, err := os.ReadDir(directory)
		if err != nil {
			return err
		}
		for _, entry := range entries {
			if shouldSkip(entry.Name(), ignored) {
				continue
			}
			path := filepath.Join(directory, entry.Name())
			info, err := entry.Info()
			if err != nil {
				return err
			}
			if info.Mode()&os.ModeSymlink != 0 {
				continue
			}
			if info.IsDir() {
				if err := walk(path); err != nil {
					return err
				}
				continue
			}
			if !info.Mode().IsRegular() {
				continue
			}
			rel, err := filepath.Rel(root, path)
			if err != nil || !safeRelativePath(rel) {
				return fmt.Errorf("unsafe workspace path: %s", path)
			}
			files[filepath.ToSlash(rel)] = path
		}
		return nil
	}
	if err := walk(root); err != nil {
		return nil, err
	}
	return files, nil
}

func safeRelativePath(path string) bool {
	if path == "" || filepath.IsAbs(path) {
		return false
	}
	clean := filepath.Clean(path)
	return clean != ".." && !strings.HasPrefix(clean, ".."+string(filepath.Separator))
}

func equalFiles(a, b string) bool {
	left, err := os.ReadFile(a)
	if err != nil {
		return false
	}
	right, err := os.ReadFile(b)
	if err != nil {
		return false
	}
	return string(left) == string(right)
}

// Changes lists the files that differ between a sandbox and its source project.
func (Sandbox) Changes(sandbox, project string) ([]FileChange, error) {
	sandboxRoot, err := sandboxDir(sandbox)
	if err != nil {
		return nil, err
	}
	projectRoot, err := canonicalDir(project)
	if err != nil {
		return nil, fmt.Errorf("couldn't read the original workspace: %w", err)
	}
	ignored := gitignoreNames(projectRoot)
	sandboxFiles, err := collectFiles(sandboxRoot, ignored)
	if err != nil {
		return nil, err
	}
	projectFiles, err := collectFiles(projectRoot, ignored)
	if err != nil {
		return nil, err
	}

	changes := make([]FileChange, 0)
	for rel, sandboxPath := range sandboxFiles {
		projectPath, exists := projectFiles[rel]
		if !exists {
			changes = append(changes, FileChange{Path: rel, Status: "added"})
		} else if !equalFiles(sandboxPath, projectPath) {
			changes = append(changes, FileChange{Path: rel, Status: "modified"})
		}
	}
	for rel := range projectFiles {
		if _, exists := sandboxFiles[rel]; !exists {
			changes = append(changes, FileChange{Path: rel, Status: "deleted"})
		}
	}
	sort.Slice(changes, func(i, j int) bool { return changes[i].Path < changes[j].Path })
	return changes, nil
}

func safeJoin(root, relative string) (string, error) {
	if !safeRelativePath(relative) {
		return "", fmt.Errorf("unsafe path: %s", relative)
	}
	path := filepath.Join(root, relative)
	if !pathInside(root, path) {
		return "", fmt.Errorf("unsafe path: %s", relative)
	}
	return path, nil
}

// rejectLinkedPath prevents a merge from following a symlink that exists in
// either the sandbox or the original project. Without this, an in-tree-looking
// path could resolve to a location outside the project when copied or deleted.
func rejectLinkedPath(root, path string) error {
	rel, err := filepath.Rel(root, path)
	if err != nil || !safeRelativePath(rel) {
		return fmt.Errorf("unsafe path: %s", path)
	}
	current := root
	for _, part := range strings.Split(rel, string(filepath.Separator)) {
		current = filepath.Join(current, part)
		info, err := os.Lstat(current)
		if os.IsNotExist(err) {
			return nil
		}
		if err != nil {
			return err
		}
		if info.Mode()&os.ModeSymlink != 0 {
			return fmt.Errorf("refusing a linked path: %s", path)
		}
	}
	return nil
}

// Merge applies explicitly selected, in-tree files from a sandbox. The UI gets
// the selectable change list from Changes; merge still independently validates
// every path because Wails arguments are untrusted input.
func (Sandbox) Merge(sandbox, project string, files []string) (int, error) {
	sandboxRoot, err := sandboxDir(sandbox)
	if err != nil {
		return 0, err
	}
	projectRoot, err := canonicalDir(project)
	if err != nil {
		return 0, fmt.Errorf("couldn't read the original workspace: %w", err)
	}
	applied := 0
	for _, relative := range files {
		from, err := safeJoin(sandboxRoot, filepath.FromSlash(relative))
		if err != nil {
			return 0, err
		}
		to, err := safeJoin(projectRoot, filepath.FromSlash(relative))
		if err != nil {
			return 0, err
		}
		if err := rejectLinkedPath(sandboxRoot, from); err != nil {
			return 0, err
		}
		if err := rejectLinkedPath(projectRoot, to); err != nil {
			return 0, err
		}
		info, statErr := os.Lstat(from)
		switch {
		case statErr == nil && info.Mode().IsRegular():
			if err := os.MkdirAll(filepath.Dir(to), 0o755); err != nil {
				return 0, err
			}
			if err := copyFile(from, to, info.Mode()); err != nil {
				return 0, err
			}
			applied++
		case os.IsNotExist(statErr):
			if err := os.RemoveAll(to); err != nil {
				return 0, err
			}
			applied++
		case statErr != nil:
			return 0, statErr
		default:
			return 0, fmt.Errorf("refusing to merge a non-regular file: %s", relative)
		}
	}
	return applied, nil
}

// Remove only deletes a per-chat directory inside ~/.ash/sandboxes.
func (Sandbox) Remove(sandbox string) error {
	path, err := sandboxDir(sandbox)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	return os.RemoveAll(path)
}
