import { Tool } from "../types";
import { ensureBackgroundSession, setSpawnOptions, disposeSession } from "../../term";
import { ptyKill } from "../../pty";
import { acquireTerminal } from "../../agent-activity";
import {
  addBackgroundTerm,
  findBackgroundTerm,
  getBackgroundTerms,
  removeBackgroundTerm,
} from "../../background-terms";

export const bashBackgroundTool: Tool = {
  name: "bash_background",
  description:
    "Start a long-running command (dev server, watcher, build --watch) in a background terminal session. Returns immediately; the terminal keeps running and the user can inspect it in the sidebar under Sessions. Use bash for commands that finish.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to run" },
      title: { type: "string", description: "Short human label for the session (defaults to the command)" },
    },
    required: ["command"],
  },
  async run(args, ctx) {
    const command = String(args.command ?? "").trim();
    if (!command) return { ok: false, output: "command must be non-empty." };
    if (ctx.signal.aborted) return { ok: false, output: "Cancelled." };

    const title: string = String(args.title ?? command).slice(0, 40);
    const id = crypto.randomUUID();

    setSpawnOptions(id, { cwd: ctx.cwd, command });
    // Opens offscreen (no WebGL) so its buffer fills for read_terminal without a
    // fleet of WebGL contexts freezing the UI; re-parented into a pane on open.
    try {
      await ensureBackgroundSession(id);
    } catch (error) {
      return {
        ok: false,
        output: `Failed to start background terminal: ${error instanceof Error ? error.message : String(error)}`,
      };
    }
    if (ctx.signal.aborted) {
      await ptyKill(id).catch(() => {});
      disposeSession(id);
      return { ok: false, output: "Cancelled." };
    }

    addBackgroundTerm({ id, title, ownerId: ctx.ownerId });
    acquireTerminal(id, ctx.ownerId ?? "engine");

    return {
      ok: true,
      output: `Started background terminal "${title}" (id: ${id}). It keeps running after this turn; the user can watch it in the sidebar. Read its output with read_terminal, type into it with terminal_input, stop it with kill_background.`,
    };
  },
};

export const bashBackgroundKillTool: Tool = {
  name: "kill_background",
  description:
    "Stop a background terminal session previously started with bash_background (kills the whole process tree, so the dev server it launched actually dies and its port frees up). Accepts the session id or its title. Always kill the old session before restarting the same server, or the port stays busy.",
  parameters: {
    type: "object",
    properties: {
      session: { type: "string", description: "Session id or title (as returned by bash_background)" },
    },
    required: ["session"],
  },
  async run(args) {
    const query: string = String(args.session ?? "");
    const match = findBackgroundTerm(query);
    if (!match) {
      const list = getBackgroundTerms();
      const available = list.length
        ? list.map((t) => `"${t.title}" (id: ${t.id})`).join(", ")
        : "none";
      return { ok: false, output: `No background session matches "${query}". Running sessions: ${available}.` };
    }
    // Kill the whole tree first (frees the port), then tear the session down
    // explicitly instead of relying on the async exit event. Don't swallow a
    // kill failure — an orphaned dev server keeps holding its port.
    let killed = true;
    try {
      await ptyKill(match.id);
    } catch {
      killed = false;
    }
    removeBackgroundTerm(match.id);
    disposeSession(match.id);
    return killed
      ? { ok: true, output: `Stopped "${match.title}" and freed its port.` }
      : { ok: false, output: `Failed to stop "${match.title}" — it may still be running and holding its port. Try again or check Task Manager.` };
  },
};
