import { Tool } from "../types";
import { runProcess } from "./run-process";

const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_OUTPUT = 12_000;

// One shell across the whole app: the bash tool runs through the SAME PowerShell
// the interactive/background terminals use (pty_spawn's default_shell), so the
// agent never has to guess whether it's in bash, cmd, or PowerShell. (This is a
// Windows/WebView2 app — default_shell only ever picks pwsh/powershell.)
export async function hasBash(): Promise<boolean> {
  return false;
}

function cap(s: string): string {
  return s.length > MAX_OUTPUT
    ? s.slice(0, MAX_OUTPUT) + `\n[truncated — ${s.length - MAX_OUTPUT} more chars]`
    : s;
}

export const bashTool: Tool = {
  name: "bash",
  description:
    "Run a shell command and return its combined stdout/stderr and exit code. Prefer this over asking the user to run commands manually.",
  parameters: {
    type: "object",
    properties: {
      command: { type: "string", description: "The command to run" },
      timeout_ms: { type: "number", description: `Max time to wait (default ${DEFAULT_TIMEOUT_MS}ms)` },
    },
    required: ["command"],
  },
  async run(args, ctx) {
    const command: string = args.command;
    const timeoutMs = args.timeout_ms ?? DEFAULT_TIMEOUT_MS;
    const res = await runProcess(
      "powershell.exe",
      ["-NoProfile", "-Command", command],
      ctx.cwd,
      { timeoutMs, signal: ctx.signal },
    );
    if (res.timedOut)
      return { ok: false, output: `Command timed out after ${timeoutMs}ms.\n${cap(res.stdout + res.stderr)}` };

    const combined = cap((res.stdout + res.stderr).trim());
    const header = `exit code: ${res.code ?? "?"}`;
    return { ok: res.code === 0, output: combined ? `${header}\n${combined}` : header };
  },
};
