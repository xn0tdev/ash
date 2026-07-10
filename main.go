package main

import (
	"embed"

	"github.com/wailsapp/wails/v2"
	"github.com/wailsapp/wails/v2/pkg/options"
	"github.com/wailsapp/wails/v2/pkg/options/assetserver"
	"github.com/wailsapp/wails/v2/pkg/options/windows"
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
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,        // App (root, no methods yet beyond lifecycle)
			app.pty,    // PtySpawn / PtyWrite / PtyResize / PtyKill
			app.fs,     // ReadText / WriteText / DeletePath / ListDir / HomeDir
			app.git,    // Branch / Status / DiffStat
			app.tools,  // DetectBins / ResolveBash / FindEditors / SshHosts / OpenIn
			app.sandbox, // Copy / Changes / Merge / Remove (stubbed for now)
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
