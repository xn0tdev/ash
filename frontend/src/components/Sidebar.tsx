import type { Tab } from "../tabs";

interface SidebarProps {
  tabs: Tab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  collapsed: boolean;
}

// Minimal sidebar for the spike: new-tab button + a list of tabs. The full
// Ash Sidebar (workspaces, commands, agents, ssh sections, pins, drag-reorder)
// arrives in a later phase — this is enough to drive multi-tab terminals.
export default function Sidebar({ tabs, activeTabId, onSelect, onClose, onNew, collapsed }: SidebarProps) {
  if (collapsed) return null;
  return (
    <aside className="sidebar">
      <button className="new-tab" onClick={onNew} title="New tab (Ctrl+Shift+T)">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
          <path d="M12 5v14M5 12h14" />
        </svg>
        <span>New</span>
      </button>
      <div className="tab-list">
        {tabs.map((t) => (
          <div
            key={t.id}
            className={`tab-row${t.id === activeTabId ? " active" : ""}`}
            onClick={() => onSelect(t.id)}
          >
            <span className="tab-dot" />
            <span className="tab-title">{t.title}</span>
            {tabs.length > 1 && (
              <button
                className="tab-close"
                title="Close"
                onClick={(e) => {
                  e.stopPropagation();
                  onClose(t.id);
                }}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M18 6 6 18M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        ))}
      </div>
    </aside>
  );
}
