import { useEffect, useState } from "react";
import {
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
  Quit,
  EventsOn,
} from "../wailsjs/runtime";

// Custom titlebar for the frameless window. Drag regions use Wails'
// --wails-draggable CSS var (the equivalent of Tauri's data-tauri-drag-region);
// window controls call into @wailsio/runtime. A near-1:1 port of Ash's
// TitleBar.tsx so we can feel the parity — just function-style runtime calls
// (WindowMinimise/EventsOn) instead of Tauri's object API.
export default function TitleBar() {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlistenMax: (() => void) | undefined;
    let unlistenRest: (() => void) | undefined;
    WindowIsMaximised().then((m: boolean) => !disposed && setMaximized(m));
    // Wails fires OS-level events on maximize/restore — same role as Tauri's
    // win.onResized + isMaximized polling.
    EventsOn("wails:window:maximise", () => setMaximized(true));
    EventsOn("wails:window:unmaximise", () => setMaximized(false));
    return () => {
      disposed = true;
      unlistenMax?.();
      unlistenRest?.();
    };
  }, []);

  const dragStyle = { "--wails-draggable": "drag" } as React.CSSProperties;
  const noDrag = { "--wails-draggable": "no-drag" } as React.CSSProperties;

  return (
    <header className="main-head" style={dragStyle}>
      <span className="head-title" style={dragStyle}>
        Ash — Wails spike
      </span>
      <div className="head-spacer" style={dragStyle} />
      <div className="head-right" style={noDrag}>
        <button className="wc-btn" title="Minimize" onClick={() => WindowMinimise()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 12h14" />
          </svg>
        </button>
        <button className="wc-btn" title={maximized ? "Restore" : "Maximize"} onClick={() => WindowToggleMaximise()}>
          {maximized ? (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="8.5" width="10.5" height="10.5" rx="2.4" />
              <path d="M8.5 8.5V6.5A1.5 1.5 0 0 1 10 5h7.5A1.5 1.5 0 0 1 19 6.5V14a1.5 1.5 0 0 1-1.5 1.5H16" />
            </svg>
          ) : (
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5" y="5" width="14" height="14" rx="2.6" />
            </svg>
          )}
        </button>
        <button className="wc-btn wc-close" title="Close" onClick={() => Quit()}>
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
            <path d="M5 5l14 14M19 5L5 19" />
          </svg>
        </button>
      </div>
    </header>
  );
}
