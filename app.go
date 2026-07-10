package main

import (
	"context"
)

// App is the root struct Wails binds to the frontend. Sub-systems (PTY, fs,
// git, tools, sandbox) hang off it so a single OnStartup feeds ctx into each,
// and a single OnShutdown tears them down. The frontend calls their methods
// directly via the auto-generated bindings (frontend/wailsjs/go/main/*), OR
// through the Tauri-compat shim (src/lib/wails-shim.ts) which routes
// invoke("read_text", …) → Fs.ReadText(…).
type App struct {
	ctx     context.Context
	pty     *Pty
	fs      *Fs
	git     *Git
	tools   *Tools
	sandbox *Sandbox
}

func NewApp() *App {
	return &App{
		pty:     NewPty(),
		fs:      NewFs(),
		git:     NewGit(),
		tools:   NewTools(),
		sandbox: NewSandbox(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.pty.startup(ctx)
	storeToolsCtx(ctx)
}

func (a *App) shutdown(ctx context.Context) {
	a.pty.shutdown(ctx)
}
