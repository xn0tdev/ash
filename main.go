package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
)

// Build-time vars (set via -ldflags "-X main.Version=... -X main.Commit=...").
// Defaults let a plain `go build` / `wails build` run without flags.
var (
	Version = "dev"
	Commit   = "none"
)

//go:embed all:frontend/dist
var assets embed.FS

func main() {
	app := NewApp()

	// Frameless: the React app draws its own titlebar (drag via
	// --wails-draggable:drag in CSS, the same model as Tauri's
	// data-tauri-drag-region). Every backend struct is bound here so its
	// exported methods become typed TS calls in frontend/wailsjs/go/main/*.
	err := wails.Run(&options.App{
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
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,         // App (root) — AppInfo / Version / Commit
			app.pty,     // PtySpawn / PtyWrite / PtyResize / PtyKill
			app.fs,      // ReadText / WriteText / DeletePath / ListDir / HomeDir
			app.git,     // Branch / Status / DiffStat
			app.tools,   // DetectBins / ResolveBash / FindEditors / SshHosts / OpenIn
			app.sandbox, // Copy / Changes / Merge / Remove (stubbed for now)
			app.updater, // CheckUpdate / DownloadUpdate / ApplyUpdate / Restart
		},
		Windows: &windows.Options{
			WebviewIsTransparent: false,
			WindowIsTranslucent:  false,
		},
	})

	if err != nil {
		println("Error:", err.Error())
	}
}
