import { useState } from "react";

export interface Tab {
  id: string;
  title: string;
  titlePinned: boolean;
  root: import("./lib/layout").PaneNode;
  activePane: string;
  workspaceId: string | null;
}

// Minimal tab factory for the spike — full Ash makeTab lives in tab-utils but
// depends on more state; this is enough to spin up real multi-tab terminals.
export function makeTab(title = "shell"): Tab {
  const paneId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    title,
    titlePinned: false,
    root: { type: "leaf", kind: "term", id: paneId },
    activePane: paneId,
    workspaceId: null,
  };
}

// Local hook so App can hold tabs without a separate module yet.
export function useTabs(initial: Tab[]) {
  const [tabs, setTabs] = useState<Tab[]>(initial);
  return { tabs, setTabs };
}
