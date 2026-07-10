import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";

const dataHandlers = new Map<string, (data: string) => void>();
const exitHandlers = new Map<string, () => void>();

let initialized = false;

/** Single global subscription; events are routed to per-session handlers. */
export function initPtyEvents() {
  if (initialized) return;
  initialized = true;
  listen<{ id: string; data: string }>("pty:data", (e) => {
    dataHandlers.get(e.payload.id)?.(e.payload.data);
  });
  listen<{ id: string }>("pty:exit", (e) => {
    exitHandlers.get(e.payload.id)?.();
  });
}

export function onPtyData(id: string, handler: (data: string) => void) {
  dataHandlers.set(id, handler);
}

export function onPtyExit(id: string, handler: () => void) {
  exitHandlers.set(id, handler);
}

export function offPty(id: string) {
  dataHandlers.delete(id);
  exitHandlers.delete(id);
}

export const ptySpawn = (
  id: string,
  cols: number,
  rows: number,
  cwd: string | null,
  program: string | null = null,
  args: string[] | null = null,
) => invoke<string>("pty_spawn", { id, cols, rows, cwd, program, args });

export const ptyWrite = (id: string, data: string) =>
  invoke("pty_write", { id, data });

export const ptyResize = (id: string, cols: number, rows: number) =>
  invoke("pty_resize", { id, cols, rows });

export const ptyKill = (id: string) => invoke("pty_kill", { id });
