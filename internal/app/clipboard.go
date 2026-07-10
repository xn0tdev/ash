package app

import (
	"context"
	"strings"
	"time"

	"github.com/wailsapp/wails/v2/pkg/runtime"
)

// ClipboardWatcher polls the OS clipboard and emits a "clipboard:changed"
// Wails event whenever the text changes. This exists so external dictation
// apps (Wispr Flow) can insert into the terminal even when their paste
// mechanism never reaches the Wails webview's DOM — the frontend listens for
// the event and writes the new text into the focused terminal's PTY directly.
//
// Polling (vs. a Win32 clipboard-format-listener) is deliberately simple and
// cheap at a 400ms interval; the watcher only emits on a real text change, so
// the frontend isn't spammed.
type ClipboardWatcher struct {
	ctx    context.Context
	stop   chan struct{}
	last   string
	haveLast bool
}

func NewClipboardWatcher() *ClipboardWatcher {
	return &ClipboardWatcher{stop: make(chan struct{})}
}

func (w *ClipboardWatcher) startup(ctx context.Context) {
	w.ctx = ctx
	go w.loop()
}

func (w *ClipboardWatcher) shutdown(_ context.Context) {
	select {
	case <-w.stop:
	default:
		close(w.stop)
	}
}

func (w *ClipboardWatcher) loop() {
	ticker := time.NewTicker(400 * time.Millisecond)
	defer ticker.Stop()
	for {
		select {
		case <-w.stop:
			return
		case <-ticker.C:
			text, err := runtime.ClipboardGetText(w.ctx)
			if err != nil {
				continue
			}
			// Normalize: trim a trailing CR/LF pair that some apps tack on, so
			// a dictation that ends in a newline doesn't re-fire every poll.
			normalized := strings.TrimRight(text, "\r\n")
			if !w.haveLast {
				w.last = normalized
				w.haveLast = true
				continue
			}
			if normalized == w.last {
				continue
			}
			w.last = normalized
			// Emit the ORIGINAL text (with any trailing newline) so paste
			// behavior matches a normal Ctrl+V; the frontend decides whether
			// to auto-insert based on focus + the last text it wrote itself.
			runtime.EventsEmit(w.ctx, "clipboard:changed", map[string]string{
				"text": text,
			})
		}
	}
}
