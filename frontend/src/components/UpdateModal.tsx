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

export default function UpdateModal({ onClose }: UpdateModalProps) {
  const [st, setSt] = useState<UpdateState>(getUpdateState());

  useEffect(() => onUpdateState(setSt), []);

  const r = st.release;
  const busy = st.stage === "downloading" || st.stage === "installing" || st.stage === "restarting" || st.stage === "downloaded";
  const canInstall = st.stage === "available" && !!r;

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
        <div className="update-head">
          <div className="update-icon">
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 12a9 9 0 1 1-2.64-6.36" />
              <path d="M21 3v6h-6" />
            </svg>
          </div>
          <div className="update-titles">
            <h3>{STAGE_LABEL[st.stage]}</h3>
            {r && (
              <div className="update-ver">
                <span className="cur">{r.current}</span>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14M13 6l6 6-6 6"/></svg>
                <span className="nxt">{r.latest}</span>
              </div>
            )}
          </div>
          {!busy && st.stage !== "installing" && (
            <button className="modal-x" title="Close" onClick={onClose}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d="M5 5l14 14M19 5L5 19"/></svg>
            </button>
          )}
        </div>

        {r?.notes && (
          <div className="update-notes">
            <pre>{r.notes}</pre>
          </div>
        )}

        {(st.stage === "downloading" || st.stage === "downloaded" || st.stage === "installing" || st.stage === "restarting") && (
          <div className="update-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${st.percent}%` }} />
            </div>
            <div className="progress-meta">
              <span>{st.percent}%</span>
              {st.stage === "downloading" && <span className="muted">{bytes(st.downloaded)} / {bytes(st.total)}</span>}
              {st.stage === "installing" && <span className="muted">Swapping binary…</span>}
              {st.stage === "restarting" && <span className="muted">Relaunching Ash…</span>}
            </div>
          </div>
        )}

        {st.stage === "error" && (
          <div className="update-error">
            <p>{st.error ?? "Something went wrong."}</p>
            <div className="update-actions">
              <button className="btn-primary" onClick={() => runUpdate().catch(() => {})}>Retry</button>
              <button className="btn-ghost" onClick={onClose}>Close</button>
            </div>
          </div>
        )}

        {st.stage === "up-to-date" && (
          <div className="update-actions">
            <button className="btn-primary" onClick={onClose}>Done</button>
          </div>
        )}

        {canInstall && (
          <div className="update-actions">
            <span className="muted">Starting download…</span>
          </div>
        )}
      </div>
    </div>
  );
}
