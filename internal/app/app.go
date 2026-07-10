package app

import (
	"context"
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// Build-time vars (set via -ldflags "-X ash-wails/internal/app.Version=...").
// Defaults let a plain `go build` / `wails build` run without flags.
var (
	Version = "dev"
	Commit  = "none"
)

// App is the root struct Wails binds to the frontend. Sub-systems (PTY, fs,
// git, tools, sandbox, updater) hang off it so a single OnStartup feeds ctx
// into each, and a single OnShutdown tears them down. The frontend calls
// their methods directly via the auto-generated bindings
// (frontend/wailsjs/go/...), OR through the Tauri-compat shim
// (src/shim/core.ts) which routes invoke("read_text", …) → Fs.ReadText(…).
type App struct {
	ctx     context.Context
	pty     *Pty
	fs      *Fs
	git     *Git
	tools   *Tools
	sandbox *Sandbox
	updater *Updater
}

func NewApp() *App {
	return &App{
		pty:     NewPty(),
		fs:      NewFs(),
		git:     NewGit(),
		tools:   NewTools(),
		sandbox: NewSandbox(),
		updater: NewUpdater(),
	}
}

func (a *App) startup(ctx context.Context) {
	a.ctx = ctx
	a.pty.startup(ctx)
	a.updater.startup(ctx)
	storeToolsCtx(ctx)
}

// AppInfo exposes build metadata to the frontend (About section, update check).
// Version/Commit are set at build time via -ldflags; default to "dev"/"none".
func (a *App) AppInfo() map[string]string {
	return map[string]string{
		"version": Version,
		"commit":  Commit,
	}
}

func (a *App) shutdown(ctx context.Context) {
	a.pty.shutdown(ctx)
}

// Run builds the Wails app options and starts the event loop. assets is the
// embedded frontend/dist (embedded in package main so the //go:embed path
// resolves relative to the repo root) and passed in here. Keeping all the
// Wails wiring in the app package means main.go never touches unexported
// App fields/methods — only this package does.
func Run(assets embed.FS) error {
	a := NewApp()

	// Frameless: the React app draws its own titlebar (drag via
	// --wails-draggable:drag in CSS, the same model as Tauri's
	// data-tauri-drag-region). Every backend struct is bound here so its
	// exported methods become typed TS calls in frontend/wailsjs/go/....
	return wails.Run(&options.App{
		Title:     "Ash",
		Width:     1180,
		Height:    740,
		MinWidth:  720,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// near-black to match vercel-dark — avoids a white flash pre-paint.
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 10, A: 255},
		Frameless:        true,
		// Wails frameless drag: an element with the CSS var
		// (--wails-draggable: drag) becomes a window drag handle. The property
		// and value must be declared here (the default only kicks in with these
		// set on Windows). Value unquoted in the CSS so the matcher sees `drag`.
		CSSDragProperty: "--wails-draggable",
		CSSDragValue:    "drag",
		OnStartup:       a.startup,
		OnShutdown:      a.shutdown,
		Bind: []interface{}{
			a,         // App (root) — AppInfo
			a.pty,     // PtySpawn / PtyWrite / PtyResize / PtyKill
			a.fs,      // ReadText / WriteText / DeletePath / ListDir / HomeDir
			a.git,     // Branch / Status / DiffStat
			a.tools,   // DetectBins / ResolveBash / FindEditors / SshHosts / OpenIn
			a.sandbox, // Copy / Changes / Merge / Remove (stubbed for now)
			a.updater, // CheckUpdate / DownloadUpdate / ApplyUpdate / Restart
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})
}
