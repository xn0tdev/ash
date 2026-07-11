package app

import (
	"os"
	"path/filepath"
	"testing"
)

func TestCopySandboxTreeFiltersIgnoredAndBuildFiles(t *testing.T) {
	source := t.TempDir()
	destination := filepath.Join(t.TempDir(), "sandbox")
	if err := os.WriteFile(filepath.Join(source, "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, ".env"), []byte("secret"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, ".gitignore"), []byte(".env\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Mkdir(filepath.Join(source, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(source, "node_modules", "large.js"), []byte("skip"), 0o644); err != nil {
		t.Fatal(err)
	}

	files, err := copySandboxTree(source, destination, gitignoreNames(source))
	if err != nil {
		t.Fatal(err)
	}
	if files != 2 { // keep.txt + .gitignore
		t.Fatalf("copied %d files, want 2", files)
	}
	if _, err := os.Stat(filepath.Join(destination, "keep.txt")); err != nil {
		t.Fatalf("expected copied source file: %v", err)
	}
	for _, path := range []string{filepath.Join(destination, ".env"), filepath.Join(destination, "node_modules")} {
		if _, err := os.Lstat(path); !os.IsNotExist(err) {
			t.Fatalf("expected %s to be excluded, got %v", path, err)
		}
	}
}

func TestSafeJoinRejectsEscapingPaths(t *testing.T) {
	root := t.TempDir()
	if _, err := safeJoin(root, filepath.Join("src", "main.go")); err != nil {
		t.Fatalf("expected safe relative path: %v", err)
	}
	for _, path := range []string{"..", filepath.Join("..", "outside.txt"), filepath.VolumeName(root) + string(filepath.Separator) + "outside.txt"} {
		if _, err := safeJoin(root, path); err == nil {
			t.Fatalf("expected %q to be rejected", path)
		}
	}
}
