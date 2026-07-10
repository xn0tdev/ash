import type { Tab } from "../App";
import { termLeaf } from "./layout";

// Pure tab/pane helpers. Extracted verbatim from App.tsx.

export function makeTab(
  title = "shell",
  pinned = false,
  workspaceId: string | null = null,
): Tab {
  const paneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    title,
    titlePinned: pinned,
    root: termLeaf(paneId),
    activePane: paneId,
    workspaceId,
  };
}

export function paneRect(id: string): DOMRect | null {
  const el = document.querySelector(`[data-pane-id="${id}"]`);
  return el ? el.getBoundingClientRect() : null;
}

export function basename(path: string): string {
  return path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? path;
}

/** Shell OSC titles are often raw exe paths — reduce them to a short name. */
export function prettyTitle(raw: string): string {
  const t = raw.trim();
  if (t.includes("\\") || t.includes("/")) {
    return basename(t).replace(/\.exe$/i, "").toLowerCase();
  }
  return t.replace(/\.exe$/i, "");
}
