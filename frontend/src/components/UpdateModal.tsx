import { useEffect, useState } from "react";
import { getUpdateState, onUpdateState, runUpdate, type UpdateState, type UpdateStage } from "../lib/updater";

interface UpdateModalProps {
  onClose: () => void;
}

const XGlyph = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
    <path d="M18 6 6 18M6 6l12 12" />
  </svg>
);

export default function UpdateModal({ onClose }: UpdateModalProps) {
  const [st, setSt] = useState<UpdateState>(getUpdateState());

  useEffect(() => onUpdateState(setSt), []);

  const r = st.release;
  const demo = st.stage === "demo";
  const busy =
    st.stage === "downloading" ||
    st.stage === "installing" ||
    st.stage === "restarting" ||
    st.stage === "downloaded";
  const showingProgress =
    demo ||
    st.stage === "downloading" ||
    st.stage === "downloaded" ||
    st.stage === "installing" ||
    st.stage === "restarting";

  // Escape closes — unless mid-install (can't safely abort a binary swap).
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

  // Kick off the real download→apply→restart when a release is available.
  // (demo never triggers this — it's a fake, closeable preview.)
  useEffect(() => {
    if (st.stage === "available" && r && !demo) {
      runUpdate().catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [st.stage]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => busy && e.preventDefault()}>
      <div className="modal update-modal" onMouseDown={(e) => e.stopPropagation()}>
        {/* Close (demo / pre-install only — never while a swap is in flight). */}
        {!busy && (
          <button className="modal-x" title="Close" onClick={onClose}>
            <XGlyph />
          </button>
        )}

        {/* Centered version header — old → new, the title of the dialog. */}
        {r && (
          <div className="update-version">
            <span className="uv-cur">{r.current}</span>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M5 12h14M13 6l6 6-6 6" />
            </svg>
            <span className="uv-nxt">{r.latest}</span>
          </div>
        )}

        {/* Subtitle — right under the header. */}
        <p className="update-subtitle">
          Updating Ash — it will restart automatically.
        </p>

        {/* Progress bar. */}
        {showingProgress && (
          <div className="update-progress">
            <div className="progress-track">
              <div className="progress-fill" style={{ width: `${st.percent}%` }} />
            </div>
            <span className="progress-pct">{st.percent}%</span>
          </div>
        )}
      </div>
    </div>
  );
}
