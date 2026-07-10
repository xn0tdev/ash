import type { PermissionMode } from "./permissions";

// Roles scope what a background agent is ALLOWED to do — the structural half of
// "safe mode": a reviewer literally has no edit/write/bash tool in its schema,
// so it cannot modify the project even if the model tries. Each role also gets
// its own concurrency pool (up to `poolSize` running at once) and a prompt
// addon that specializes its behavior.

export interface AgentRole {
  id: string;
  label: string;
  /** Tool names this role may call. undefined = every tool (the general role). */
  tools?: string[];
  permissionMode: PermissionMode;
  /** Max agents of this role running at once — its category pool. */
  poolSize: number;
  /** Appended to the system prompt to specialize the agent. */
  promptAddon: string;
}

// Authoritative tool names — keep in sync with tools/registry.ts. Kept local
// (not imported from the registry) so roles.ts stays a dependency-free leaf and
// avoids the registry ↔ agent-bg import cycle.
export const ALL_TOOL_NAMES = [
  "read_file",
  "edit_file",
  "write_file",
  "bash",
  "bash_background",
  "kill_background",
  "agent",
  "stop_agent",
  "read_terminal",
  "terminal_input",
  "wait_for_terminal",
  "grep",
  "glob",
  "web_fetch",
  "skill",
] as const;

const READ_ONLY = ["read_file", "grep", "glob", "read_terminal", "wait_for_terminal"];

export const ROLES: Record<string, AgentRole> = {
  // Full toolset (including delegation) — the current, unrestricted agent.
  general: {
    id: "general",
    label: "General",
    tools: undefined,
    permissionMode: "full-auto",
    poolSize: 10,
    promptAddon: "",
  },
  reviewer: {
    id: "reviewer",
    label: "Reviewer",
    tools: [...READ_ONLY, "web_fetch"],
    permissionMode: "full-auto",
    poolSize: 10,
    promptAddon: `Your role: REVIEWER (read-only). You have NO ability to edit,
write, or run commands — inspect the code and report. Produce a precise,
structured report of findings: for each, give file:line, a short severity
(critical/major/minor), and a one-line description of the problem and why it
matters. Do not propose sweeping rewrites; point at concrete defects. If you
find nothing, say so plainly.`,
  },
  editor: {
    id: "editor",
    label: "Editor",
    tools: [
      "read_file",
      "edit_file",
      "write_file",
      "bash",
      "bash_background",
      "kill_background",
      "grep",
      "glob",
      "read_terminal",
      "wait_for_terminal",
      "terminal_input",
      "skill",
    ],
    permissionMode: "full-auto",
    poolSize: 10,
    promptAddon: `Your role: EDITOR. Implement exactly the fixes/changes you were
assigned — no more. Stay within the files you were given; if a change would
require touching files outside your assignment, note it in your final report
instead of editing them (another agent may own those). Prefer edit_file for
existing files. When done, verify with the project's build/test/typecheck if one
is apparent, and report what you changed (file:line) and the verification result.`,
  },
  verifier: {
    id: "verifier",
    label: "Verifier",
    tools: [...READ_ONLY, "bash", "terminal_input"],
    permissionMode: "full-auto",
    poolSize: 10,
    promptAddon: `Your role: VERIFIER. You may READ and RUN (build, tests,
typecheck, lint) but you must NOT edit or write files. Re-check the claimed
fixes: reproduce, run the relevant checks, and report a clear pass/fail per
item with the actual command output that proves it. Flag anything still broken
or any regression you spot.`,
  },
  researcher: {
    id: "researcher",
    label: "Researcher",
    tools: [...READ_ONLY, "web_fetch", "skill"],
    permissionMode: "full-auto",
    poolSize: 10,
    promptAddon: `Your role: RESEARCHER (read-only). Investigate the question and
report findings with references (file:line, or URLs for web sources). Do not
modify anything.`,
  },
};

export const DEFAULT_ROLE = ROLES.general;

/** How a custom role arrives from the agent tool (all optional bar the tools). */
export interface CustomRoleSpec {
  label?: string;
  tools: string[];
  prompt?: string;
}

/** Resolve a role id (or a custom spec) to a concrete AgentRole. Unknown tool
 * names in a custom spec are dropped; an empty result falls back to read-only. */
export function resolveRole(roleId?: string, custom?: CustomRoleSpec): AgentRole {
  if (custom && custom.tools?.length) {
    const known = new Set<string>(ALL_TOOL_NAMES);
    const tools = custom.tools.filter((t) => known.has(t));
    return {
      id: "custom",
      label: custom.label?.trim() || "Custom",
      tools: tools.length ? tools : [...READ_ONLY],
      permissionMode: "full-auto",
      poolSize: 10,
      promptAddon: custom.prompt?.trim()
        ? `Your role: ${custom.label?.trim() || "CUSTOM"}. ${custom.prompt.trim()}`
        : "",
    };
  }
  return (roleId && ROLES[roleId]) || DEFAULT_ROLE;
}
