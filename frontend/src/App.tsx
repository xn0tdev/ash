import { useCallback, useEffect, useRef, useState } from "react";
import TitleBar from "./TitleBar";
import Sidebar from "./components/Sidebar";
import PaneLayout from "./components/PaneLayout";
import { disposeSession } from "./lib/term";
import { leaves, removeLeaf, splitLeaf, termLeaf } from "./lib/layout";
import { makeTab, Tab } from "./tabs";
import "./sidebar.css";
import "./layout.css";
import "./App.css";

// Phase-1 shell: frameless titlebar + sidebar + multi-tab + recursive split
// tree of terminal panes. This is the first app-shaped milestone of the
// Wails port — enough to feel the layout/split/sidebar UX on Go. Agent /
// explorer / settings / browser panes arrive in later phases (placeholders
// inside PaneLayout for now).
export default function App() {
  const [tabs, setTabs] = useState<Tab[]>(() => [makeTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const tabsRef = useRef(tabs);
  tabsRef.current = tabs;

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? tabs[0];

  const setTab = useCallback((id: string, patch: Partial<Tab>) => {
    setTabs((ts) => ts.map((t) => (t.id === id ? { ...t, ...patch } : t)));
  }, []);

  const focusPane = useCallback((tabId: string, paneId: string) => {
    setTab(tabId, { activePane: paneId });
    setActiveTabId(tabId);
  }, [setTab]);

  const setRatio = useCallback((tabId: string, splitId: string, ratio: number) => {
    setTabs((ts) =>
      ts.map((t) =>
        t.id === tabId ? { ...t, root: setSplitRatioLocal(t.root, splitId, ratio) } : t,
      ),
    );
  }, []);

  const newTab = useCallback(() => {
    const t = makeTab();
    setTabs((ts) => [...ts, t]);
    setActiveTabId(t.id);
  }, []);

  const closeTab = useCallback((id: string) => {
    setTabs((ts) => {
      if (ts.length <= 1) return ts;
      const idx = ts.findIndex((t) => t.id === id);
      // Tear down every terminal session in the tab before dropping it.
      leaves(ts[idx].root).forEach((l) => {
        if (l.kind === "term") disposeSession(l.id);
      });
      const next = ts.filter((t) => t.id !== id);
      if (id === activeTabId) setActiveTabId(next[Math.max(0, idx - 1)].id);
      return next;
    });
  }, [activeTabId]);

  const splitActive = useCallback((dir: "row" | "col") => {
    if (!activeTab) return;
    const paneId = crypto.randomUUID();
    setTabs((ts) =>
      ts.map((t) =>
        t.id === activeTab.id
          ? { ...t, root: splitLeaf(t.root, t.activePane, dir, termLeaf(paneId)), activePane: paneId }
          : t,
      ),
    );
  }, [activeTab]);

  const closePane = useCallback((paneId: string) => {
    if (!activeTab) return;
    const ls = leaves(activeTab.root);
    if (ls.length <= 1) return; // never empty a tab to zero panes
    disposeSession(paneId);
    const newRoot = removeLeaf(activeTab.root, paneId);
    if (newRoot) {
      setTab(activeTab.id, {
        root: newRoot,
        activePane: activeTab.activePane === paneId ? leaves(newRoot)[0].id : activeTab.activePane,
      });
    }
  }, [activeTab, setTab]);

  // Hotkeys: new tab, close tab, split right/down, cycle tabs. Matches Ash.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.ctrlKey || !e.shiftKey) return;
      if (e.key === "T") { e.preventDefault(); newTab(); }
      else if (e.key === "W") { e.preventDefault(); if (activeTab) closeTab(activeTab.id); }
      else if (e.key === "D") { e.preventDefault(); splitActive("row"); }
      else if (e.key === "E") { e.preventDefault(); splitActive("col"); }
      else if (e.key === "B") { e.preventDefault(); setSidebarCollapsed((c) => !c); }
      else if (e.key === "Tab") {
        e.preventDefault();
        const ts = tabsRef.current;
        if (ts.length < 2) return;
        const idx = ts.findIndex((t) => t.id === activeTabId);
        setActiveTabId(ts[(idx + 1) % ts.length].id);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newTab, closeTab, splitActive, activeTabId, activeTab]);

  if (!activeTab) return null;
  const panes = leaves(activeTab.root);

  return (
    <div className="main">
      <TitleBar />
      <div className="main-body">
        <Sidebar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelect={setActiveTabId}
          onClose={closeTab}
          onNew={newTab}
          collapsed={sidebarCollapsed}
        />
        <div className="pane-area">
          <PaneLayout
            node={activeTab.root}
            tabId={activeTab.id}
            tabActive={true}
            activePane={activeTab.activePane}
            multi={panes.length > 1}
            onFocus={focusPane}
            onRatio={setRatio}
          />
        </div>
      </div>
    </div>
  );
}

// Local copy of setSplitRatio to avoid pulling the whole layout module surface
// through an import cycle — the helper is tiny and stable.
function setSplitRatioLocal(node: import("./lib/layout").PaneNode, splitId: string, ratio: number): import("./lib/layout").PaneNode {
  if (node.type === "leaf") return node;
  if (node.id === splitId) return { ...node, ratio };
  return { ...node, a: setSplitRatioLocal(node.a, splitId, ratio), b: setSplitRatioLocal(node.b, splitId, ratio) };
}
