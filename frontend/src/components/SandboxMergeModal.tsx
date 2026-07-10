import { useEffect, useState } from "react";

import {
  FileChange,
  sandboxChanges,
  mergeSandbox,
  discardSandbox,
} from "../lib/sandbox";

interface Props {
  ownerId: string;
  projectName: string;
  /** Called with how many files were applied after a successful merge. */
  onMerged?: (count: number) => void;
  onClose: () => void;
}

const STATUS_LABEL: Record<FileChange["status"], string> = {
  added: "new",
  modified: "changed",
  deleted: "deleted",
};

// Review what the safe-mode agents changed in the sandbox and merge the chosen
// files back into the live project (or discard the sandbox entirely).
export default function SandboxMergeModal({ ownerId, projectName, onMerged, onClose }: Props) {
  const [changes, setChanges] = useState<FileChange[] | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    sandboxChanges(ownerId)
      .then((c) => {
        if (!alive) return;
        setChanges(c);
        setSelected(new Set(c.map((x) => x.path)));
      })
      .catch((e) => alive && setError(e instanceof Error ? e.message : String(e)));
    return () => {
      alive = false;
    };
  }, [ownerId]);

  const toggle = (path: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });

  const doMerge = async () => {
    if (!changes) return;
    const files = changes.filter((c) => selected.has(c.path)).map((c) => c.path);
    if (!files.length) return;
    setBusy(true);
    setError(null);
    try {
      await mergeSandbox(ownerId, files);
      onMerged?.(files.length);
      const remaining = await sandboxChanges(ownerId);
      if (!remaining.length) {
        await discardSandbox(ownerId);
        onClose();
      } else {
        setChanges(remaining);
        setSelected(new Set(remaining.map((c) => c.path)));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doDiscard = async () => {
    setBusy(true);
    setError(null);
    try {
      await discardSandbox(ownerId);
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setBusy(false);
    }
  };

  const count = selected.size;

  return (
    <div className="modal-backdrop" onMouseDown={() => !busy && onClose()}>
      <div className="confirm-modal sandbox-modal" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Merge sandbox changes</h3>
        <p>
          Safe mode ran in a copy of <b>{projectName}</b>. Choose what to merge
          into your project.
        </p>

        {error && <div className="sandbox-error">{error}</div>}

        {changes === null ? (
          <div className="sandbox-empty">Scanning sandbox…</div>
        ) : changes.length === 0 ? (
          <div className="sandbox-empty">No changes — the sandbox matches your project.</div>
        ) : (
          <div className="sandbox-changes">
            {changes.map((c) => (
              <label className="sandbox-change" key={c.path}>
                <input
                  type="checkbox"
                  checked={selected.has(c.path)}
                  onChange={() => toggle(c.path)}
                />
                <span className={`sandbox-status s-${c.status}`}>{STATUS_LABEL[c.status]}</span>
                <span className="sandbox-path">{c.path}</span>
              </label>
            ))}
          </div>
        )}

        <div className="confirm-actions">
          <button className="cancel" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          {changes !== null && changes.length > 0 && (
            <>
              <button className="danger" onClick={doDiscard} disabled={busy}>
                Discard sandbox
              </button>
              <button className="primary" onClick={doMerge} disabled={busy || count === 0}>
                {busy ? "Merging…" : `Merge ${count} file${count === 1 ? "" : "s"}`}
              </button>
            </>
          )}
          {changes !== null && changes.length === 0 && (
            <button className="danger" onClick={doDiscard} disabled={busy}>
              Remove sandbox
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
