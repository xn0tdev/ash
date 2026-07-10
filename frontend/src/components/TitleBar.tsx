import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

const win = getCurrentWindow();

// macOS draws native traffic-light controls; only Windows/Linux get our custom
// set. The dev Mac-preview flag (Ctrl+Shift+M) also hides them on Windows.
const isMac =
  navigator.userAgent.includes("Macintosh") ||
  localStorage.getItem("ash.macPreview") === "1";

interface TitleBarProps {
  title: string;
  workspaceName: string | null;
  branch: string | null;
  sidebarOpen: boolean;
  showUpdateBadge: boolean;
  onUpdate: () => void;
}

export default function TitleBar({
  title,
  workspaceName,
  branch,
  sidebarOpen,
  showUpdateBadge,
  onUpdate,
}: TitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    win.isMaximized().then((m) => !disposed && setMaximized(m));
    // During an OS window-border drag the webview resizes every frame →
    // terminal ResizeObserver → per-frame fit(). Mark the body `resizing` for
    // the duration so TerminalPane defers to a single trailing fit. Debounced
    // on the JS resize event (fires continuously) plus the Tauri onResized
    // (fires at the OS level).
    let resizeTimer = 0;
    const onJsResize = () => {
      document.body.classList.add("resizing");
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(
        () => document.body.classList.remove("resizing"),
        120,
      );
    };
    window.addEventListener("resize", onJsResize);
    win
      .onResized(async () => setMaximized(await win.isMaximized()))
      .then((u) => (disposed ? u() : (unlisten = u)));
    return () => {
      disposed = true;
      window.removeEventListener("resize", onJsResize);
      window.clearTimeout(resizeTimer);
      unlisten?.();
    };
  }, []);

  return (
    <header
      className={`main-head${sidebarOpen ? " with-toggle" : ""}${showUpdateBadge ? " has-update" : ""}`}
      data-tauri-drag-region
    >
      {showUpdateBadge && (
        <button
          className="update-badge"
          title="A new version of Ash is available"
          onClick={onUpdate}
        >
          Update
        </button>
      )}
      <span className="head-title" data-tauri-drag-region>
        {title}
      </span>
      {workspaceName && (
        <span className="head-ws" data-tauri-drag-region>
          {workspaceName}
          {branch && (
            <>
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <line x1="6" y1="3" x2="6" y2="15" />
                <circle cx="18" cy="6" r="3" />
                <circle cx="6" cy="18" r="3" />
                <path d="M18 9a9 9 0 0 1-9 9" />
              </svg>
              {branch}
            </>
          )}
        </span>
      )}
      <div className="head-spacer" data-tauri-drag-region />
      <div className="head-right">
        {!isMac && (
        <div className="window-controls">
          <button className="wc-btn" title="Minimize" onClick={() => win.minimize()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14" />
            </svg>
          </button>
          <button
            className="wc-btn"
            title={maximized ? "Restore" : "Maximize"}
            onClick={() => win.toggleMaximize()}
          >
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
          <button className="wc-btn wc-close" title="Close" onClick={() => win.close()}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 5l14 14M19 5L5 19" />
            </svg>
          </button>
        </div>
        )}
      </div>
    </header>
  );
}
