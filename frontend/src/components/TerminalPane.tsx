import { useEffect, useRef } from "react";

import { ensureSession, getSession, resizeSession } from "../lib/term";

interface TerminalPaneProps {
  id: string;
  focused: boolean;
  dimmed: boolean;
  onFocus: () => void;
}

// Wails port of Ash's TerminalPane. The session registry (term.ts) lives
// outside React so a terminal survives split re-parenting — this component
// only attaches/detaches the DOM container + keeps fit() in sync with the
// pane geometry. Agent-takeover overlay isn't ported yet (no agent-engine).
export default function TerminalPane({ id, focused, dimmed, onFocus }: TerminalPaneProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const session = ensureSession(id, host);
    session.fit.fit();

    // Debounce fit() during continuous resizes (sidebar/divider) — xterm's fit
    // recomputes the cell grid + repaints, so per-frame calls tank the FPS.
    let raf = 0;
    let trailing = 0;
    const runFit = () => {
      raf = 0;
      resizeSession(id);
    };
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      if (document.body.classList.contains("dragging") || document.body.classList.contains("resizing")) {
        clearTimeout(trailing);
        trailing = window.setTimeout(runFit, 120);
        return;
      }
      raf = requestAnimationFrame(runFit);
    });
    observer.observe(host);

    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      clearTimeout(trailing);
    };
  }, [id]);

  useEffect(() => {
    if (focused) getSession(id)?.term.focus();
  }, [focused, id]);

  return (
    <div
      className={`pane term-pane${dimmed ? " dim" : ""}`}
      data-pane-id={id}
      onMouseDownCapture={onFocus}
    >
      <div className="term-host" ref={hostRef} />
    </div>
  );
}
