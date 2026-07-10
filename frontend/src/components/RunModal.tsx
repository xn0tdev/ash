import { useEffect, useState } from "react";

import { RunConfig } from "../lib/runs";

interface RunModalProps {
  projectName: string | null;
  runs: RunConfig[];
  onRun: (run: RunConfig) => void;
  onSave: (runs: RunConfig[]) => void;
  onClose: () => void;
}

const GlobeGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
    <circle cx="12" cy="12" r="9" />
    <path d="M3 12h18M12 3a15 15 0 0 1 0 18a15 15 0 0 1 0-18" />
  </svg>
);

const TermGlyph = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 17 10 11 4 5" />
    <line x1="12" y1="19" x2="20" y2="19" />
  </svg>
);

const XGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function RunModal({
  projectName,
  runs,
  onRun,
  onSave,
  onClose,
}: RunModalProps) {
  const [adding, setAdding] = useState(runs.length === 0);
  const [name, setName] = useState("");
  const [type, setType] = useState<"command" | "url">("command");
  const [command, setCommand] = useState("");
  const [url, setUrl] = useState("");
  const [cwd, setCwd] = useState("");

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  const canSave =
    name.trim() &&
    (type === "command" ? command.trim() : url.trim());

  const addRun = () => {
    if (!canSave) return;
    const run: RunConfig = {
      id: crypto.randomUUID(),
      name: name.trim(),
      type,
      ...(type === "command"
        ? { command: command.trim(), cwd: cwd.trim() || undefined }
        : { url: url.trim() }),
    };
    onSave([...runs, run]);
    setName("");
    setCommand("");
    setUrl("");
    setCwd("");
    setAdding(false);
  };

  const del = (id: string) => onSave(runs.filter((r) => r.id !== id));

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>Run · {projectName ?? "no project"}</span>
        </div>

        {!projectName && (
          <div className="modal-hint">
            Open a workspace folder first — runs are saved in its
            <code> .ash/run.json</code>.
          </div>
        )}

        {runs.length > 0 && (
          <div className="run-list">
            {runs.map((r) => (
              <div key={r.id} className="run-row" onClick={() => onRun(r)}>
                <span className="run-type">
                  {r.type === "url" ? <GlobeGlyph /> : <TermGlyph />}
                </span>
                <span className="run-name">{r.name}</span>
                <span className="run-detail">
                  {r.type === "url" ? r.url : r.command}
                </span>
                <button
                  className="row-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    del(r.id);
                  }}
                >
                  <XGlyph />
                </button>
              </div>
            ))}
          </div>
        )}

        {projectName &&
          (adding ? (
            <div className="run-form">
              <div className="field">
                <label>Name</label>
                <input
                  autoFocus
                  value={name}
                  placeholder="Dev server"
                  spellCheck={false}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => e.stopPropagation()}
                />
              </div>
              <div className="seg">
                <button
                  className={type === "command" ? "on" : ""}
                  onClick={() => setType("command")}
                >
                  Command
                </button>
                <button
                  className={type === "url" ? "on" : ""}
                  onClick={() => setType("url")}
                >
                  URL
                </button>
              </div>
              {type === "command" ? (
                <>
                  <div className="field">
                    <label>Command</label>
                    <input
                      value={command}
                      placeholder="npm run dev"
                      spellCheck={false}
                      onChange={(e) => setCommand(e.target.value)}
                      onKeyDown={(e) => {
                        e.stopPropagation();
                        if (e.key === "Enter") addRun();
                      }}
                    />
                  </div>
                  <div className="field">
                    <label>Folder (optional, relative to project)</label>
                    <input
                      value={cwd}
                      placeholder="apps/web"
                      spellCheck={false}
                      onChange={(e) => setCwd(e.target.value)}
                      onKeyDown={(e) => e.stopPropagation()}
                    />
                  </div>
                </>
              ) : (
                <div className="field">
                  <label>URL</label>
                  <input
                    value={url}
                    placeholder="localhost:3000"
                    spellCheck={false}
                    onChange={(e) => setUrl(e.target.value)}
                    onKeyDown={(e) => {
                      e.stopPropagation();
                      if (e.key === "Enter") addRun();
                    }}
                  />
                </div>
              )}
              <div className="modal-actions">
                {runs.length > 0 && (
                  <button className="btn" onClick={() => setAdding(false)}>
                    Cancel
                  </button>
                )}
                <button className="btn primary" disabled={!canSave} onClick={addRun}>
                  Add
                </button>
              </div>
            </div>
          ) : (
            <button className="tab-new run-add" onClick={() => setAdding(true)}>
              <span className="tab-icon">
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
              </span>
              <span>Add run</span>
            </button>
          ))}
      </div>
    </div>
  );
}
