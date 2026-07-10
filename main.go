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

	// Frameless: we draw our own titlebar (drag via --wails-draggable:drag in
	// CSS, the same model as Tauri's data-tauri-drag-region). Windows gets the
	// custom Chrome_WidgetWin to support native shadow + snap on a frameless
	// window (Webview2 alone gives a flat, shadow-less frame).
	err := wails.Run(&options.App{
		Title:     "Ash",
		Width:     1180,
		Height:    740,
		MinWidth:  720,
		MinHeight: 480,
		AssetServer: &assetserver.Options{
			Assets: assets,
		},
		// near-black background to match Ash's vercel-dark default — avoids a
		// white flash before the React app paints.
		BackgroundColour: &options.RGBA{R: 10, G: 10, B: 10, A: 255},
		Frameless:        true,
		OnStartup:        app.startup,
		OnShutdown:       app.shutdown,
		Bind: []interface{}{
			app,
			app.pty,
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
