import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { EventsOff, EventsOn } from "../../wailsjs/runtime";
import { OpenPTY, WritePTY, ResizePTY, KillPTY } from "../../wailsjs/go/main/Pty";

// Terminal session registry — the Wails/Go port of Ash's term.ts (Tauri).
// Sessions live OUTSIDE React (keyed by pane id) so they survive split
// re-parenting; TerminalPane only attaches/detaches the DOM container.
//
// ConPTY lifecycle lives in Go (Pty); here we own the xterm instance + the
// event subscription that pipes PTY output into it, and forward keystrokes
// back through WritePTY.

interface TermSession {
  term: Terminal;
  fit: FitAddon;
  ptyId: string;
  container: HTMLDivElement | null;
  disposed: boolean;
}

const sessions = new Map<string, TermSession>();

/** Default xterm theme — vercel-dark derived; replaced once themes.ts wires in. */
const DEFAULT_THEME = {
  background: "#0a0a0a",
  foreground: "#ededed",
  cursor: "#ededed",
  selectionBackground: "rgba(255,255,255,0.16)",
  black: "#262626",
  red: "#ff6369",
  green: "#3fd68f",
  yellow: "#f2b83b",
  blue: "#52a8ff",
  magenta: "#bf7af0",
  cyan: "#29c8d8",
  white: "#ededed",
  brightBlack: "#666666",
  brightRed: "#ff8589",
  brightGreen: "#62e6a8",
  brightYellow: "#ffd166",
  brightBlue: "#75bfff",
  brightMagenta: "#d29dff",
  brightCyan: "#56dfef",
  brightWhite: "#ffffff",
};

/** Create (or reuse) a rendered terminal session for a pane id. */
export function ensureSession(id: string, host: HTMLElement): TermSession {
  const existing = sessions.get(id);
  if (existing) {
    attachContainer(existing, host);
    return existing;
  }

  const term = new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: 'Consolas, "Cascadia Mono", monospace',
    fontSize: 15,
    theme: DEFAULT_THEME,
  });
  const fit = new FitAddon();
  term.loadAddon(fit);

  const container = document.createElement("div");
  container.className = "term-inner";
  host.appendChild(container);
  term.open(container);
  fit.fit();

  const session: TermSession = { term, fit, ptyId: "", container, disposed: false };
  sessions.set(id, session);

  // Open a ConPTY on the Go side, then wire bidirectional streaming.
  OpenPTY("", term.cols, term.rows)
    .then((ptyId: string) => {
      if (session.disposed) {
        KillPTY(ptyId).catch(() => {});
        return;
      }
      session.ptyId = ptyId;
      EventsOn("pty:" + ptyId, (data: string) => {
        if (!session.disposed) term.write(data);
      });
      EventsOn("pty:" + ptyId + ":done", () => {});
      term.onData((d) => WritePTY(ptyId, d).catch(() => {}));
    })
    .catch((e: unknown) => {
      term.writeln("\x1b[31mFailed to open terminal: " + String(e) + "\x1b[0m");
    });

  return session;
}

function attachContainer(session: TermSession, host: HTMLElement) {
  if (session.container?.parentElement === host) return;
  if (session.container) host.appendChild(session.container);
  else {
    const container = document.createElement("div");
    container.className = "term-inner";
    host.appendChild(container);
    session.term.open(container);
    session.container = container;
  }
  session.fit.fit();
}

export function getSession(id: string): TermSession | undefined {
  return sessions.get(id);
}

/** Resize the ConPTY when the pane geometry changes (split / window drag). */
export function resizeSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  s.fit.fit();
  if (s.ptyId) ResizePTY(s.ptyId, s.term.cols, s.term.rows).catch(() => {});
}

/** Detach the DOM container from its host (split reparenting) — keep the PTY. */
export function detachSession(id: string) {
  const s = sessions.get(id);
  if (s?.container?.parentElement) s.container.remove();
}

/** Fully tear down a session: dispose xterm, kill the ConPTY, drop listeners. */
export function disposeSession(id: string) {
  const s = sessions.get(id);
  if (!s) return;
  s.disposed = true;
  if (s.ptyId) {
    EventsOff("pty:" + s.ptyId);
    EventsOff("pty:" + s.ptyId + ":done");
    KillPTY(s.ptyId).catch(() => {});
  }
  s.term.dispose();
  s.container?.remove();
  sessions.delete(id);
}
