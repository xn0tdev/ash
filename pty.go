package main

import (
	"context"
	"fmt"
	"io"
	"sync"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// Pty is a ConPTY-backed terminal session manager. Wails binds every exported
// method to the frontend (auto-generated, typed TS in frontend/wailsjs), so
// the React side calls OpenPTY/WritePTY/ResizePTY/KillPTY directly — no IPC
// boilerplate like Tauri's #[tauri::command].
//
// Output is streamed via Wails runtime events (one per id) so xterm.js on the
// frontend can attach its own onData handler — same shape as Ash's ConPTY loop
// in pty.rs, just in Go.
type Pty struct {
	ctx    context.Context
	mu     sync.Mutex
	procs  map[string]*ptyProc
	nextID int
}

func NewPty() *Pty {
	return &Pty{procs: map[string]*ptyProc{}}
}

func (p *Pty) startup(ctx context.Context) {
	p.ctx = ctx
}

// OpenPTY spawns a shell under a new ConPTY and starts streaming its output as
// "pty:<id>" events. Returns the id the frontend uses to address it.
func (p *Pty) OpenPTY(cwd string, cols, rows uint16) (string, error) {
	if cols == 0 {
		cols = 80
	}
	if rows == 0 {
		rows = 24
	}

	proc, err := openConPTY(cwd, cols, rows)
	if err != nil {
		return "", fmt.Errorf("open pty: %w", err)
	}

	p.mu.Lock()
	p.nextID++
	id := fmt.Sprintf("pty-%d", p.nextID)
	p.procs[id] = proc
	p.mu.Unlock()

	// Stream ConPTY output → Wails event "pty:<id>". The frontend listens and
	// writes chunks into xterm.js. Closing the PTY emits a final "pty:<id>:done"
	// so the UI can mark the pane dead.
	go func() {
		buf := make([]byte, 8192)
		for {
			n, err := proc.Read(buf)
			if n > 0 {
				runtime.EventsEmit(p.ctx, "pty:"+id, string(buf[:n]))
			}
			if err != nil {
				if err == io.EOF || isPipeClosed(err) {
					break
				}
				// transient read error — back off so a flaky PTY doesn't spin
				time.Sleep(20 * time.Millisecond)
			}
		}
		proc.Close()
		runtime.EventsEmit(p.ctx, "pty:"+id+":done")
		p.mu.Lock()
		delete(p.procs, id)
		p.mu.Unlock()
	}()

	return id, nil
}

// WritePTY sends input bytes to the PTY's stdin (user keystrokes from xterm).
func (p *Pty) WritePTY(id string, data string) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pty %s", id)
	}
	_, err := proc.Write([]byte(data))
	return err
}

// ResizePTY resizes the ConPTY for a pane geometry change (split / window drag).
func (p *Pty) ResizePTY(id string, cols, rows uint16) error {
	p.mu.Lock()
	proc, ok := p.procs[id]
	p.mu.Unlock()
	if !ok {
		return fmt.Errorf("no pty %s", id)
	}
	return proc.resize(cols, rows)
}

// KillPTY terminates the underlying process + closes the PTY.
func (p *Pty) KillPTY(id string) error {
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
