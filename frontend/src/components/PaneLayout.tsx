import { memo } from "react";

import TerminalPane from "./TerminalPane";
import { PaneNode } from "../lib/layout";

// Wails port of Ash's PaneLayout. Renders the recursive split tree; for now
// only the terminal pane kind is implemented (browser/file/agent arrive in
// later phases — a leaf of those kinds shows a placeholder so splits don't
// crash). Memoized at every level so an unchanged subtree bails out.
interface PaneLayoutProps {
  node: PaneNode;
  tabId: string;
  tabActive: boolean;
  activePane: string;
  multi: boolean;
  onFocus: (tabId: string, paneId: string) => void;
  onRatio: (tabId: string, splitId: string, ratio: number) => void;
}

function PaneLayout(props: PaneLayoutProps) {
  const { node, tabId, tabActive, activePane, multi, onFocus, onRatio } = props;

  if (node.type === "leaf") {
    if (node.kind === "term") {
      return (
        <TerminalPane
          id={node.id}
          focused={tabActive && activePane === node.id}
          dimmed={multi && activePane !== node.id}
          onFocus={() => onFocus(tabId, node.id)}
        />
      );
    }
    // Placeholder for not-yet-ported pane kinds (web/file/agent) — keeps the
    // split tree valid while those components are migrated.
    return (
      <div
        className={`pane placeholder-pane${multi && activePane !== node.id ? " dim" : ""}`}
        data-pane-id={node.id}
        onMouseDownCapture={() => onFocus(tabId, node.id)}
      >
        <span>{node.kind} pane — not ported yet</span>
      </div>
    );
  }

  const { dir, ratio } = node;

  const startDrag = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    const container = e.currentTarget.parentElement!;
    const rect = container.getBoundingClientRect();
    let raf = 0;
    let lastPos = ratio;
    const apply = () => {
      raf = 0;
      onRatio(tabId, node.id, Math.min(0.85, Math.max(0.15, lastPos)));
    };
    const move = (ev: MouseEvent) => {
      lastPos =
        dir === "row"
          ? (ev.clientX - rect.left) / rect.width
          : (ev.clientY - rect.top) / rect.height;
      if (!raf) raf = requestAnimationFrame(apply);
    };
    const stop = () => {
      window.removeEventListener("mousemove", move);
      window.removeEventListener("mouseup", stop);
      if (raf) cancelAnimationFrame(raf);
      apply();
      document.body.style.cursor = "";
      document.body.classList.remove("dragging");
    };
    window.addEventListener("mousemove", move);
    window.addEventListener("mouseup", stop);
    document.body.style.cursor = dir === "row" ? "col-resize" : "row-resize";
    document.body.classList.add("dragging");
  };

  return (
    <div className={`split ${dir}`}>
      <div className="split-child" style={{ flexGrow: ratio }}>
        <MemoPaneLayout {...props} node={node.a} />
      </div>
      <div className="divider" onMouseDown={startDrag} />
      <div className="split-child" style={{ flexGrow: 1 - ratio }}>
        <MemoPaneLayout {...props} node={node.b} />
      </div>
    </div>
  );
}

const MemoPaneLayout = memo(PaneLayout);
export default MemoPaneLayout;
