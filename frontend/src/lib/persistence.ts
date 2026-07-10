import type { Workspace, Utility, SshHost } from "../App";

// localStorage-backed persistence for workspaces / utilities / ssh hosts, plus
// the generic JSON helpers. Extracted verbatim from App.tsx.

const WS_KEY = "ash.workspaces";
const UTILS_KEY = "ash.utils";
export const SSH_KEY = "ash.ssh";
export const PINNED_KEY = "ash.pinned";

export function loadJson<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}

export function saveJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // best-effort persistence
  }
}

export interface WorkspaceState {
  list: Workspace[];
  activeId: string | null;
}

export function loadWorkspaces(): WorkspaceState {
  try {
    // ash.workspaces, falling back to the pre-rename spark.workspaces (and then
    // the oldest single-workspace spark.workspace) so renaming never loses data.
    const raw = localStorage.getItem(WS_KEY) ?? localStorage.getItem("spark.workspaces");
    if (raw) return JSON.parse(raw) as WorkspaceState;
    // migrate the old single-workspace key
    const old = localStorage.getItem("spark.workspace");
    if (old) {
      const ws = JSON.parse(old) as { path: string; name: string };
      const entry = { id: crypto.randomUUID(), ...ws };
      return { list: [entry], activeId: entry.id };
    }
  } catch {
    // fall through to empty
  }
  return { list: [], activeId: null };
}

export function saveWorkspaces(state: WorkspaceState) {
  try {
    localStorage.setItem(WS_KEY, JSON.stringify(state));
  } catch {
    // best-effort persistence
  }
}

export function loadUtilities(): Utility[] {
  try {
    const raw = localStorage.getItem(UTILS_KEY) ?? localStorage.getItem("spark.utils");
    return raw ? (JSON.parse(raw) as Utility[]) : [];
  } catch {
    return [];
  }
}

export function loadSshCustom(): SshHost[] {
  try {
    const raw = localStorage.getItem(SSH_KEY) ?? localStorage.getItem("spark.ssh");
    if (!raw) return [];
    const list = JSON.parse(raw) as (SshHost & { command?: string })[];
    // migrate older entries that stored a single command string
    return list.map((h) =>
      h.args
        ? h
        : {
            ...h,
            args: (h.command ?? "")
              .replace(/^ssh\s+/, "")
              .split(/\s+/)
              .filter(Boolean),
          },
    );
  } catch {
    return [];
  }
}

export function saveUtilities(list: Utility[]) {
  try {
    localStorage.setItem(UTILS_KEY, JSON.stringify(list));
  } catch {
    // best-effort persistence
  }
}
