package main

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Pty is a ConPTY-backed terminal session manager, ported to Wails from Ash's
// src-tauri/src/pty.rs. The frontend (lib/pty.ts) drives it through the SAME
// contract the Tauri app used: PtySpawn(id, cols, rows, cwd, program, args),
// PtyWrite/PtyResize/PtyKill by id, and output streamed as Wails events named
// "pty:data" ({id, data}) + "pty:exit" ({id}). That lets lib/pty.ts stay
// byte-for-byte the same — only the import path of invoke/listen changes.
type Pty struct {
	ctx   context.Context
	mu    sync.Mutex
	procs map[string]*ptyProc
}

func NewPty() *Pty {
	return &Pty{procs: map[string]*ptyProc{}}
}

func (p *Pty) startup(ctx context.Context) {
	p.ctx = ctx
}

// PtySpawn mirrors the Tauri pty_spawn command. `id` is the frontend's pane id
// (so events route back to the right session); program/args let the agent
// spawn a specific shell, null = auto-detect (pwsh/powershell/cmd on Windows).
func (p *Pty) PtySpawn(id string, cols, rows uint16, cwd string, program string, args []string) (string, error) {
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}
	proc, err := openConPTY(cwd, cols, rows, program, args)
	if err != nil {
		return "", fmt.Errorf("spawn pty: %w", err)
	}
	p.mu.Lock()
	// if a previous session reused this id, tear it down first
	if old := p.procs[id]; old != nil {
		old.Close()
	}
	p.procs[id] = proc
	p.mu.Unlock()

	// Stream ConPTY output → "pty:data" ({id, data}). EOF → "pty:exit" ({id}).
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := proc.Read(buf)
			if n > 0 {
				runtime.EventsEmit(p.ctx, "pty:data", map[string]string{"id": id, "data": string(buf[:n])})
			}
			if err != nil {
				if err == io.EOF || isPipeClosed(err) {
					break
				}
				time.Sleep(20 * time.Millisecond) // transient — back off, don't spin
			}
		}
		proc.Close()
		runtime.EventsEmit(p.ctx, "pty:exit", map[string]string{"id": id})
		p.mu.Lock()
		delete(p.procs, id)
		p.mu.Unlock()
	}()

	return id, nil
}

// PtyWrite sends user keystrokes to the PTY's stdin.
func (p *Pty) PtyWrite(id, data string) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pty %s", id)
	}
	_, err := proc.Write([]byte(data))
	return err
}

// PtyResize resizes the ConPTY for a pane geometry change.
func (p *Pty) PtyResize(id string, cols, rows uint16) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pty %s", id)
	}
	return proc.resize(cols, rows)
}

// PtyKill terminates the process + closes the PTY.
func (p *Pty) PtyKill(id string) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return nil
	}
	return proc.Close()
}

// shutdown tears down every live PTY when the app quits.
func (p *Pty) shutdown(_ context.Context) {
	p.mu.Lock()
	defer p.mu.Unlock()
	for _, proc := range p.procs {
		proc.Close()
	}
}
