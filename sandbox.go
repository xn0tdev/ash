package main

import (
	"fmt"
)

// Sandbox ports Ash's src-tauri/src/sandbox.rs. The Rust impl does a recursive
// directory copy (honoring .gitignore + ALWAYS_SKIP), a file-by-file diff for
// changes, and a selective merge back. That's substantial — ported properly in
// a later phase. For now these return errors so the frontend's safe-mode path
// fails gracefully (the agent falls back to working in the real project), and
// nothing crashes. No silent success: safe mode must not claim a sandbox it
// didn't create.

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

func (Sandbox) Copy(source string) (SandboxInfo, error) {
	return SandboxInfo{}, fmt.Errorf("sandbox not yet ported (phase 5)")
}

func (Sandbox) Changes(sandbox, project string) ([]FileChange, error) {
	return nil, fmt.Errorf("sandbox not yet ported (phase 5)")
}

func (Sandbox) Merge(sandbox, project string, files []string) (int, error) {
	return 0, fmt.Errorf("sandbox not yet ported (phase 5)")
}

func (Sandbox) Remove(sandbox string) error {
	// nothing to remove — we never created one. No error so the discard path
	// in the frontend stays clean.
	return nil
}
