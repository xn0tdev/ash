import { Tool } from "../types";
import { getSession, scrollSessionToBottom } from "../../term";
import { ptyWrite } from "../../pty";
import { acquireTerminal } from "../../agent-activity";
import { findBackgroundTerm, getBackgroundTerms } from "../../background-terms";

const MAX_LINES = 300;
const DEFAULT_LINES = 80;

/** Abortable sleep that detaches its abort listener — adding one per poll
 * iteration without removal leaked ~300 listeners over a 2-minute wait. */
function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(t);
      resolve();
    };
    const t = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

// Named keys → the escape sequences a human pressing them would send.
const KEYS: Record<string, string> = {
  enter: "\r",
  tab: "\t",
  escape: "\x1b",
  esc: "\x1b",
  space: " ",
  backspace: "\x7f",
  delete: "\x1b[3~",
  up: "\x1b[A",
  down: "\x1b[B",
  right: "\x1b[C",
  left: "\x1b[D",
  home: "\x1b[H",
  end: "\x1b[F",
  pageup: "\x1b[5~",
  pagedown: "\x1b[6~",
  "ctrl+a": "\x01",
  "ctrl+c": "\x03",
  "ctrl+d": "\x04",
  "ctrl+e": "\x05",
  "ctrl+k": "\x0b",
  "ctrl+l": "\x0c",
  "ctrl+r": "\x12",
  "ctrl+u": "\x15",
  "ctrl+w": "\x17",
  "ctrl+z": "\x1a",
};

function noMatch(query: string) {
  const list = getBackgroundTerms();
  const available = list.length
    ? list.map((t) => `"${t.title}" (id: ${t.id})`).join(", ")
    : "none";
  return { ok: false, output: `No background session matches "${query}". Running sessions: ${available}.` };
}

/** Last N non-empty-tail lines of a session's terminal buffer as plain text. */
function readBuffer(id: string, lines: number): string {
  const term = getSession(id)?.term;
  if (!term) return "";
  const buf = term.buffer.active;
  const out: string[] = [];
  const start = Math.max(0, buf.length - lines);
  for (let i = start; i < buf.length; i++) {
    out.push(buf.getLine(i)?.translateToString(true) ?? "");
  }
  while (out.length && out[out.length - 1].trim() === "") out.pop();
  return out.join("\n");
}

export const readTerminalTool: Tool = {
  name: "read_terminal",
  description:
    "Read the recent output of a background terminal session (errors, server logs, TUI screens). Accepts the session id or title.",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "Session id or title" },
      lines: { type: "number", description: `How many trailing lines (default ${DEFAULT_LINES}, max ${MAX_LINES})` },
    },
    required: ["session"],
  },
  async run(args, ctx) {
    const match = findBackgroundTerm(String(args.session ?? ""));
    if (!match) return noMatch(String(args.session ?? ""));
    acquireTerminal(match.id, ctx.ownerId ?? "engine");
    scrollSessionToBottom(match.id);
    const lines = Math.min(MAX_LINES, Math.max(1, args.lines ?? DEFAULT_LINES));
    const text = readBuffer(match.id, lines);
    return { ok: true, output: text || "(terminal is empty so far)" };
  },
};

const WAIT_POLL_MS = 400;
const WAIT_DEFAULT_S = 120;
const WAIT_MAX_S = 600;

export const waitForTerminalTool: Tool = {
  name: "wait_for_terminal",
  description:
    "Block until a pattern (regex, case-insensitive) appears in a background terminal's output, then return the matching context — instead of sleeping or repeatedly calling read_terminal. Use it to wait for a dev server to be ready, a build/tests to finish, an error, or a prompt. Returns early if the session's process exits.",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "Session id or title" },
      pattern: {
        type: "string",
        description: 'Regex matched against the terminal text (e.g. "ready in|listening on|error|✓ built")',
      },
      timeout_s: { type: "number", description: `Give up after this many seconds (default ${WAIT_DEFAULT_S}, max ${WAIT_MAX_S})` },
    },
    required: ["session", "pattern"],
  },
  async run(args, ctx) {
    const match = findBackgroundTerm(String(args.session ?? ""));
    if (!match) return noMatch(String(args.session ?? ""));
    let re: RegExp;
    try {
      re = new RegExp(String(args.pattern ?? ""), "i");
    } catch (e) {
      return { ok: false, output: `Bad regex: ${e instanceof Error ? e.message : String(e)}` };
    }
    acquireTerminal(match.id, ctx.ownerId ?? "engine");

    const timeoutMs = Math.min(WAIT_MAX_S, Math.max(1, args.timeout_s ?? WAIT_DEFAULT_S)) * 1000;
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      if (ctx.signal.aborted) return { ok: false, output: "Cancelled." };
      const text = readBuffer(match.id, MAX_LINES);
      const m = re.exec(text);
      if (m) {
        const lines = text.split("\n");
        const hit = lines.findIndex((l) => re.test(l));
        const ctxStart = Math.max(0, hit - 2);
        const context = lines.slice(ctxStart, Math.min(lines.length, hit + 13)).join("\n");
        return { ok: true, output: `Matched "${m[0]}" in session "${match.title}":\n${context}` };
      }
      // session's process gone → stop waiting, hand back what's there
      if (!getSession(match.id))
        return { ok: false, output: `Session "${match.title}" exited before the pattern appeared. Last output:\n${text.slice(-2000)}` };
      await sleep(WAIT_POLL_MS, ctx.signal);
    }
    const tail = readBuffer(match.id, 30);
    return {
      ok: false,
      output: `Timed out after ${Math.round(timeoutMs / 1000)}s waiting for /${args.pattern}/ in "${match.title}". Recent output:\n${tail}`,
    };
  },
};

export const terminalInputTool: Tool = {
  name: "terminal_input",
  description:
    "Type into a background terminal session like a human: send text and/or named keys (enter, up, down, tab, escape, ctrl+c, …). Use it to answer prompts and drive TUIs. Returns the terminal's output after the input.",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "Session id or title" },
      text: { type: "string", description: "Literal text to type (not sent as a command unless you include enter in keys)" },
      keys: {
        type: "array",
        description: `Named keys pressed after the text, in order. Supported: ${Object.keys(KEYS).join(", ")}`,
        items: { type: "string" },
      },
    },
    required: ["session"],
  },
  async run(args, ctx) {
    const match = findBackgroundTerm(String(args.session ?? ""));
    if (!match) return noMatch(String(args.session ?? ""));

    let payload = typeof args.text === "string" ? args.text : "";
    const badKeys: string[] = [];
    for (const k of (args.keys ?? []) as string[]) {
      const seq = KEYS[String(k).toLowerCase()];
      if (seq === undefined) badKeys.push(String(k));
      else payload += seq;
    }
    if (badKeys.length)
      return { ok: false, output: `Unknown key(s): ${badKeys.join(", ")}. Supported: ${Object.keys(KEYS).join(", ")}` };
    if (!payload) return { ok: false, output: "Nothing to send — provide text and/or keys." };

    acquireTerminal(match.id, ctx.ownerId ?? "engine");
    scrollSessionToBottom(match.id);
    await ptyWrite(match.id, payload);

    // Give the program a beat to react, then show the agent what happened.
    await sleep(450, ctx.signal);
    scrollSessionToBottom(match.id);
    const after = readBuffer(match.id, 25);
    return { ok: true, output: after || "(no visible output yet)" };
  },
};