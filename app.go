package main

import (
	"context"
)

// App is the root struct Wails binds to the frontend. Every exported method
// becomes a typed TS call in frontend/wailsjs/go/main/App.ts — no manual IPC
// layer like Tauri's #[tauri::command] + invoke(). Sub-systems (PTY, soon
// fs/git/ssh) hang off it so a single Bind entrypoint exposes them all.
type App struct {
	ctx context.Context
	pty *Pty
}

func NewApp() *App {
	return &App{pty: NewPty()}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.pty.startup(ctx)
}

func (a *App) shutdown(ctx context.Context) {
	a.pty.shutdown(ctx)
}
