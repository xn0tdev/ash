import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { openUrl } from "@tauri-apps/plugin-opener";
import { readText, writeText } from "@tauri-apps/plugin-clipboard-manager";
import "@xterm/xterm/css/xterm.css";

import {
  DEFAULT_FONT_SIZE,
  fontFamily,
  getSettings,
  onSettingsChange,
  terminalTheme,
  updateSettings,
} from "./settings";
import {
  offPty,
  onPtyData,
  onPtyExit,
  ptyResize,
  ptySpawn,
  ptyWrite,
} from "./pty";

/**
 * Terminal sessions live here, OUTSIDE React. React components only attach
 * and detach the session's DOM container. This survives re-parenting during
 * split-layout changes — remounting a pane must not respawn its PTY.
 */

export interface TermSession {
  id: string;
  term: Terminal;
  /** null until a renderer is attached (background sessions start headless). */
  fit: FitAddon | null;
  webgl: WebglAddon | null;
  /** null until a renderer is attached (background sessions start headless). */
  container: HTMLDivElement | null;
  /** false for a headless background session that has never been opened. */
  rendered: boolean;
}

interface SessionEvents {
  onShell: (id: string, shell: string) => void;
  onTitle: (id: string, title: string) => void;
  onExit: (id: string) => void;
  /** Where a localhost link should open in-app (ctrl+click). */
  onOpenLocalUrl: (id: string, url: string) => void;
  /** cwd for newly spawned shells (active workspace). */
  getCwd: () => string | null;
}

const sessions = new Map<string, TermSession>();
let events: SessionEvents | null = null;

// Sessions the user actually touched (typed/pasted) or that started with a
// command/program. A pristine session can be safely re-created elsewhere
// (drag-to-workspace respawns it in the folder); a used one must be kept.
const used = new Set<string>();

/** True if anything happened in this terminal since it spawned. */
export function isSessionUsed(id: string): boolean {
  return used.has(id);
}

/** Per-pane overrides consumed at spawn time (utility / ssh launchers). */
interface SpawnOptions {
  cwd?: string | null;
  /** Typed into the shell after it starts (quick commands). */
  command?: string;
  /** Spawned directly as the PTY process instead of the shell (ssh). */
  program?: string;
  args?: string[];
  /** Auto-typed once when the process asks for a password. */
  password?: string;
}
const pendingSpawn = new Map<string, SpawnOptions>();

export function setSpawnOptions(id: string, opts: SpawnOptions) {
  pendingSpawn.set(id, opts);
}

export function configureSessions(e: SessionEvents) {
  events = e;
}

export function getSession(id: string): TermSession | undefined {
  return sessions.get(id);
}

export function adjustFontSize(delta: number) {
  const size =
    delta === 0
      ? DEFAULT_FONT_SIZE
      : Math.min(24, Math.max(9, getSettings().fontSize + delta));
  updateSettings({ fontSize: size });
}

// Re-apply visual settings to every live terminal — but ONLY when a terminal
// visual actually changed. onSettingsChange fires on EVERY settings write
// (sidebar/explorer width, section toggles, …); re-fitting and clearing every
// terminal's WebGL glyph atlas on an unrelated write (e.g. a sidebar drag-stop)
// caused visible flicker.
let lastFont = "";
let lastTheme = "";
let lastSize = -1;
onSettingsChange((s) => {
  // compute once, not per session
  const fam = fontFamily(s);
  const theme = terminalTheme(s);
  const themeKey = JSON.stringify(theme);
  if (s.fontSize === lastSize && fam === lastFont && themeKey === lastTheme) return;
  lastSize = s.fontSize;
  lastFont = fam;
  lastTheme = themeKey;
  // Defer the per-terminal refit/repaint to the next animation frame: the
  // WebGL atlas clear + fit + full-buffer refresh is heavy and was stalling
  // the current frame — running it in rAF lets the dropdown's open/close
  // animation keep its frame budget, so the switch reads as instant.
  requestAnimationFrame(() => {
    sessions.forEach((session) => {
      session.term.options.fontSize = s.fontSize;
      session.term.options.fontFamily = fam;
      session.term.options.theme = theme;
      // Headless background sessions have no renderer to refit/repaint.
      if (!session.rendered) return;
      // WebGL caches rendered glyphs in a texture atlas — without clearing it,
      // already-drawn text keeps the old font/theme while new text uses the new.
      session.webgl?.clearTextureAtlas();
      session.fit?.fit();
      session.term.refresh(0, session.term.rows - 1);
    });
  });
});

export function isLocalUrl(raw: string): boolean {
  try {
    const url = new URL(raw);
    return ["localhost", "127.0.0.1", "0.0.0.0", "[::1]", "::1"].includes(
      url.hostname,
    );
  } catch {
    return false;
  }
}

function buildTerminal(opts?: { scrollback?: number }): Terminal {
  const settings = getSettings();
  return new Terminal({
    allowProposedApi: true,
    cursorBlink: true,
    cursorStyle: "bar",
    fontFamily: fontFamily(settings),
    fontSize: settings.fontSize,
    lineHeight: 1.2,
    scrollback: opts?.scrollback ?? 10000,
    theme: terminalTheme(settings),
  });
}

// Wire PTY data/exit + spawn. Shared by headless and rendered sessions: the PTY
// side is identical whether or not a renderer is attached.
function wireAndSpawn(
  id: string,
  term: Terminal,
  spawnOpts: SpawnOptions | undefined,
  cols: number,
  rows: number,
) {
  // A terminal that starts by running something (utility, ssh, agent command)
  // is "used" from birth — only a bare shell counts as pristine.
  if (spawnOpts?.command || spawnOpts?.program) used.add(id);
  // Explicit spawn options (even with no cwd field) opt out of the ambient
  // workspace cwd — that's how a "no workspace" tab starts in the shell's
  // own default directory instead of inheriting whatever's active.
  const cwd = spawnOpts ? (spawnOpts.cwd ?? null) : (events?.getCwd() ?? null);

  // Auto-type a saved password once, when ssh/sudo prompts for it.
  let passwordPending = spawnOpts?.password ?? "";
  let promptBuffer = "";
  // Coalesce PTY events into ONE term.write per animation frame: a burst of
  // output (build/cat) fires many small events, and one batched write per frame
  // is far cheaper than one write per event. rAF always fires, so nothing sticks.
  let pendingWrite = "";
  let writeRaf = 0;
  const flushWrite = () => {
    writeRaf = 0;
    // Session was disposed while a flush was queued — drop it (term is gone).
    if (!sessions.has(id)) {
      pendingWrite = "";
      return;
    }
    if (!pendingWrite) return;
    const chunk = pendingWrite;
    pendingWrite = "";
    term.write(chunk);
    if (passwordPending) {
      promptBuffer = (promptBuffer + chunk).slice(-200);
      if (/(password|passphrase)[^:]*:\s*$/i.test(promptBuffer)) {
        ptyWrite(id, passwordPending + "\r");
        passwordPending = "";
        promptBuffer = "";
      }
    }
  };
  onPtyData(id, (data) => {
    pendingWrite += data;
    if (!writeRaf) writeRaf = requestAnimationFrame(flushWrite);
  });
  onPtyExit(id, () => events?.onExit(id));

  ptySpawn(id, cols, rows, cwd, spawnOpts?.program ?? null, spawnOpts?.args ?? null)
    .then((shell) => {
      events?.onShell(id, shell.replace(/\.exe$/i, ""));
      // Only shells get a typed command; a direct program (ssh) runs itself.
      if (spawnOpts?.command && !spawnOpts?.program)
        ptyWrite(id, spawnOpts.command + "\r");
    })
    .catch((err) => {
      term.writeln(`\x1b[31mfailed to start:\x1b[0m ${err}`);
    });
}

// Attach a renderer (DOM container + interaction handlers) to a session, opening
// the terminal so its buffer actually fills. `useWebgl` is off for background
// sessions: they open offscreen only to buffer output, and a fleet of WebGL
// contexts is exactly what froze the app — the DOM renderer buffers just fine.
function attachRenderer(session: TermSession, host: HTMLElement, useWebgl = true) {
  const { id, term } = session;
  const container = document.createElement("div");
  container.className = "term-container";
  host.appendChild(container);

  const fit = new FitAddon();
  term.loadAddon(fit);
  // Ctrl+Click: localhost goes to the in-app browser pane, the rest to the OS.
  term.loadAddon(
    new WebLinksAddon((event, uri) => {
      if (!event.ctrlKey) return;
      if (isLocalUrl(uri)) events?.onOpenLocalUrl(id, uri);
      else openUrl(uri).catch(() => {});
    }),
  );
  term.open(container);
  let webgl: WebglAddon | null = null;
  if (useWebgl) {
    try {
      webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch {
      // WebGL unavailable — DOM renderer still works fine.
      webgl = null;
    }
  }
  fit.fit();

  term.attachCustomKeyEventHandler((e) => {
    if (e.type !== "keydown") return true;
    if (e.ctrlKey && e.shiftKey && e.code === "KeyC" && term.hasSelection()) {
      writeText(term.getSelection()).catch(() => {});
      return false;
    }
    // Paste (Ctrl+V / Ctrl+Shift+V) is left to the browser's native paste
    // event, which xterm handles once — intercepting it here double-pastes.
    // App-level shortcuts pass through untouched.
    if (
      e.ctrlKey &&
      e.shiftKey &&
      ["KeyT", "KeyW", "KeyD", "KeyE", "KeyB", "KeyL", "KeyO", "KeyP"].includes(e.code)
    )
      return false;
    if (e.ctrlKey && e.code === "Tab") return false;
    if (
      e.altKey &&
      ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.code)
    )
      return false;
    if (e.ctrlKey && ["=", "+", "-", "0", ","].includes(e.key)) return false;
    return true;
  });

  // Right click: copy selection if there is one, otherwise paste.
  container.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    if (term.hasSelection()) {
      writeText(term.getSelection()).catch(() => {});
      term.clearSelection();
    } else {
      readText()
        .then((t) => {
          if (t) {
            used.add(id);
            ptyWrite(id, t);
          }
        })
        .catch(() => {});
    }
  });

  term.onData((data) => {
    used.add(id); // any keystroke makes the terminal non-pristine
    ptyWrite(id, data);
  });
  // Debounce the PTY resize: a divider/pane drag fires onResize every frame, but
  // ConPTY only needs the FINAL size. xterm's own visual reflow stays immediate.
  let resizeTimer = 0;
  term.onResize(({ cols, rows }) => {
    clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => ptyResize(id, cols, rows), 80);
  });
  term.onTitleChange((title) => events?.onTitle(id, title));

  session.container = container;
  session.fit = fit;
  session.webgl = webgl;
  session.rendered = true;
}

export function ensureSession(id: string, host: HTMLElement): TermSession {
  const existing = sessions.get(id);
  if (existing) {
    // Re-parent the existing (already-open) terminal into this host — including
    // a background terminal moving from its offscreen host into a visible pane.
    if (existing.container && existing.container.parentElement !== host) {
      host.appendChild(existing.container);
      existing.fit?.fit();
      ptyResize(id, existing.term.cols, existing.term.rows);
    }
    return existing;
  }

  const spawnOpts = pendingSpawn.get(id);
  pendingSpawn.delete(id);
  const term = buildTerminal();
  const session: TermSession = {
    id,
    term,
    fit: null,
    webgl: null,
    container: null,
    rendered: false,
  };
  attachRenderer(session, host);
  // Spawn at the fitted size so the shell starts with the right geometry.
  wireAndSpawn(id, term, spawnOpts, term.cols, term.rows);
  sessions.set(id, session);
  return session;
}

// A PTY+xterm session for agent background terminals (dev servers, watchers).
// It's opened into an OFFSCREEN host so its buffer actually fills — that's what
// read_terminal / wait_for_terminal read — but with NO WebGL: a fleet of WebGL
// contexts is what froze the app ("not responding"), while the DOM renderer
// buffers fine. Opening it in a pane later just re-parents the same container.
export function ensureBackgroundSession(id: string): TermSession {
  const existing = sessions.get(id);
  if (existing) return existing;

  const spawnOpts = pendingSpawn.get(id);
  pendingSpawn.delete(id);
  // Small scrollback: read_terminal only ever reads the last ~300 lines, so a
  // fleet of chatty background servers needn't each hold 10k lines of history.
  const term = buildTerminal({ scrollback: 1000 });
  const session: TermSession = {
    id,
    term,
    fit: null,
    webgl: null,
    container: null,
    rendered: false,
  };
  const host = document.createElement("div");
  host.style.cssText = "position:fixed;left:-10000px;top:0;width:900px;height:500px;overflow:hidden;";
  document.body.appendChild(host);
  attachRenderer(session, host, false);
  // Spawn at the fitted size so the program lays out sensibly before it's viewed.
  wireAndSpawn(id, term, spawnOpts, term.cols, term.rows);
  sessions.set(id, session);
  return session;
}

/** Scroll a session's viewport to the bottom (safe before a renderer exists). */
export function scrollSessionToBottom(id: string) {
  const s = sessions.get(id);
  if (s?.rendered) s.term.scrollToBottom();
}

export function disposeSession(id: string) {
  // Clear any unconsumed spawn options FIRST: a tab can be created with
  // setSpawnOptions() and closed before its pane ever mounts (so no session
  // exists), which otherwise leaks the entry forever.
  pendingSpawn.delete(id);
  const session = sessions.get(id);
  if (!session) return;
  sessions.delete(id);
  used.delete(id);
  offPty(id);
  session.term.dispose();
  session.container?.remove();
}

/** Dispose of every live terminal session (PTY + xterm). Used by the
 * "clear terminals on exit" setting — terminals aren't persisted, so this is
 * purely a teardown of the in-memory sessions. */
export function disposeAllSessions() {
  for (const id of [...sessions.keys()]) disposeSession(id);
}
