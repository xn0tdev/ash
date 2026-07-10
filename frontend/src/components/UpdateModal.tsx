import { useEffect, useState } from "react";
import { getUpdateState, onUpdateState, runUpdate, type UpdateState, type UpdateStage } from "../lib/updater";

interface UpdateModalProps {
  onClose: () => void;
}

const STAGE_LABEL: Record<UpdateStage, string> = {
  idle: "Preparing…",
  checking: "Checking for updates…",
  available: "Update available",
  downloading: "Downloading…",
  downloaded: "Downloaded",
  installing: "Installing…",
  restarting: "Restarting…",
  error: "Update failed",
  "up-to-date": "You're up to date",
};

function bytes(n: number): string {
  if (!n) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const XGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function UpdateModal({ onClose }: UpdateModalProps) {
  const [st, setSt] = useState<UpdateState>(getUpdateState());

  useEffect(() => onUpdateState(setSt), []);

  // Escape closes — unless we're mid-install (can't safely abort a swap).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        if (!busy) onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.stage]);

  const r = st.release;
  const busy =
    st.stage === "downloading" ||
    st.stage === "installing" ||
    st.stage === "restarting" ||
    st.stage === "downloaded";
  const showingProgress =
    st.stage === "downloading" ||
    st.stage === "downloaded" ||
    st.stage === "installing" ||
    st.stage === "restarting";

  // Kick off download→apply→restart as soon as a release is available.
  useEffect(() => {
    if (st.stage === "available" && r) {
      runUpdate().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.stage]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => busy && e.preventDefault()}>
      <div className="modal update-modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span>{STAGE_LABEL[st.stage]}</span>
          {!busy && (
            <button className="row-btn" title="Close" onClick={onClose}>
              <XGlyph />
            </button>
          )}
        </div>

        {r && (
          <div className="update-version">
            <span className="uv-cur">{r.current}</span>
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <span className="uv-nxt">{r.latest}</span>
          </div>
        )}

        {r?.notes && (
          <div className="update-notes">
            <pre>{r.notes}</pre>
          </div>
        )}

        {showingProgress && (
          <div className="update-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${st.percent}%` }} />
            </div>
            <div className="progress-meta">
              <span>{st.percent}%</span>
              {st.stage === "downloading" && (
                <span className="muted">{bytes(st.downloaded)} / {bytes(st.total)}</span>
              )}
              {st.stage === "installing" && <span className="muted">Swapping binary…</span>}
              {st.stage === "restarting" && <span className="muted">Relaunching Ash…</span>}
            </div>
          </div>
        )}

        {st.stage === "error" && (
          <div className="update-error">{st.error ?? "Something went wrong."}</div>
        )}

        <div className="modal-actions">
          {st.stage === "error" && (
            <>
              <button className="btn" onClick={onClose}>Close</button>
              <button className="btn primary" onClick={() => runUpdate().catch(() => {})}>Retry</button>
            </>
          )}
          {st.stage === "up-to-date" && (
            <button className="btn primary" onClick={onClose}>Done</button>
          )}
          {busy && <span className="modal-hint">Please keep Ash open…</span>}
        </div>
      </div>
    </div>
  );
}
