// Self-update against GitHub Releases. The Go side (updater.go) does the
// real work: CheckUpdate queries /releases/latest, DownloadUpdate streams the
// Ash.exe asset to disk (emitting "update:progress" events), ApplyUpdate
// swaps the binary in place and relaunches. This module wraps the invoke
// calls + event stream into a tiny reactive store the UI subscribes to.
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { app } from "../../wailsjs/go/models";

export type UpdateStage = "idle" | "checking" | "available" | "downloading" | "downloaded" | "installing" | "restarting" | "error" | "up-to-date";

export interface UpdateState {
  stage: UpdateStage;
  /** Latest release found by CheckUpdate (null until a check succeeds). */
  release: app.UpdateRelease | null;
  /** 0-100 during downloading; 100 once downloaded. */
  percent: number;
  downloaded: number;
  total: number;
  error: string | null;
}

export interface UpdateReleaseInfo {
  hasUpdate: boolean;
  latest: string;
  current: string;
  notes: string;
  url: string;
  downloadUrl: string;
  downloadSize: number;
  assetName: string;
}

type Listener = (s: UpdateState) => void;

let state: UpdateState = {
  stage: "idle",
  release: null,
  percent: 0,
  downloaded: 0,
  total: 0,
  error: null,
};
const listeners = new Set<Listener>();
let progressUnlisten: (() => void) | null = null;
// A check has run at least once this session — drives whether the titlebar
// badge appears (we don't spam a button before the first check resolves).
let checkedThisSession = false;

function set(patch: Partial<UpdateState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l(state));
}

export function getUpdateState(): UpdateState {
  return state;
}

export function hasChecked(): boolean {
  return checkedThisSession;
}

export function onUpdateState(l: Listener): () => void {
  listeners.add(l);
  l(state);
  return () => listeners.delete(l);
}

/** Subscribe to the backend "update:progress" event stream (idempotent). */
async function ensureProgressListener() {
  if (progressUnlisten) return;
  progressUnlisten = await listen<{ percent: number; downloaded: number; total: number; stage: string }>(
    "update:progress",
    (e) => {
      const p = e.payload;
      if (p.stage === "downloading") {
        set({ stage: "downloading", percent: p.percent ?? 0, downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
      } else if (p.stage === "downloaded") {
        set({ stage: "downloaded", percent: 100, downloaded: p.downloaded ?? 0, total: p.total ?? 0 });
      } else if (p.stage === "installing") {
        set({ stage: "installing", percent: 100 });
      } else if (p.stage === "restarting") {
        set({ stage: "restarting", percent: 100 });
      }
    },
  );
}

/** Query GitHub for the latest release. Safe to call repeatedly. */
export async function checkForUpdate(): Promise<UpdateState> {
  set({ stage: "checking", error: null });
  try {
    const r = (await invoke<UpdateReleaseInfo>("check_update"));
    checkedThisSession = true;
    if (r.hasUpdate) {
      set({ stage: "available", release: r as unknown as app.UpdateRelease, error: null });
    } else {
      set({ stage: "up-to-date", release: r as unknown as app.UpdateRelease, error: null });
    }
    return state;
  } catch (err) {
    set({ stage: "error", error: String(err) });
    return state;
  }
}

/** Download → apply → restart. The modal drives this; progress arrives via
 *  the "update:progress" event stream. */
export async function runUpdate(): Promise<void> {
  await ensureProgressListener();
  try {
    set({ stage: "downloading", percent: 0, error: null });
    const path = await invoke<string>("download_update");
    // ApplyUpdate swaps the binary and relaunches; it emits "installing" then
    // "restarting" before os.Exit. We may not get to update state ourselves.
    set({ stage: "installing", percent: 100 });
    await invoke<void>("apply_update", { path });
  } catch (err) {
    set({ stage: "error", error: String(err) });
  }
}

/** Auto-check on startup, quietly — the titlebar badge only shows if an
 *  update is actually available. Network failures are swallowed. */
export function startAutoCheck(): void {
  // Delay so it doesn't compete with startup IO (PTY spawn, settings load).
  setTimeout(() => {
    checkForUpdate().catch(() => {});
  }, 4000);
}
