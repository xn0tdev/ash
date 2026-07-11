import { Tool } from "../types";
import { getBgAgents, startBgAgent, stopOrRemoveBgAgent } from "../../bg-agents";
import { resolveRole } from "../roles";

// Delegation: spawn an autonomous background Ash agent (a child engine
// session) working on a subtask in this project. The caller is woken with the
// result automatically — it must NOT poll or sleep.
//
// NOTE: this module sits on an import cycle (bg-agents → session → loop →
// registry → here → bg-agents), so it must not touch bg-agents exports at
// module-init time — only inside run(). Hence the literal "10" below.

export const bgAgentTool: Tool = {
  name: "agent",
  description:
    "Start an autonomous background agent on a self-contained subtask in this project. " +
    "Use ONLY when the work is both INDEPENDENT and substantial — e.g. several investigations/audits in parallel, or a long side-quest while you keep working. Do small, quick, one-off, or dependent/sequential work inline yourself: spinning up an agent has real latency and it cannot share results with the others. " +
    "Choose a ROLE, which scopes what the agent can do (each role has its own pool of up to 10 running at once): " +
    "'reviewer' — READ-ONLY, finds bugs and writes a report (cannot edit); " +
    "'editor' — can read, edit/write files and run commands (use for applying fixes); " +
    "'verifier' — can read and RUN builds/tests but NOT edit (confirms fixes); " +
    "'researcher' — READ-ONLY investigation with web access; " +
    "'general' — full toolset incl. delegation (the default; only role that can spawn its own agents); " +
    "'custom' — provide allowed_tools to hand-pick the toolset. " +
    "Prefer read-only roles (reviewer/researcher/verifier) whenever the agent doesn't need to modify the project — that is the safe default. " +
    "Its chat is visible to the user in the sidebar. Returns immediately with the agent's name. When it finishes, its result is DELIVERED TO YOU AUTOMATICALLY — " +
    "after starting agents, say what you delegated and END YOUR TURN. Never wait for, poll, or sleep on a background agent. " +
    "Give each agent a complete, standalone task description (it doesn't see this conversation).",
  parameters: {
    type: "object",
    properties: {
      task: {
        type: "string",
        description: "Complete standalone task for the agent (context, goal, constraints — it sees nothing else)",
      },
      role: {
        type: "string",
        enum: ["general", "reviewer", "editor", "verifier", "researcher", "custom"],
        description: "Scopes the agent's tools and its concurrency pool. Default 'general'. Prefer a read-only role when the agent needn't modify anything.",
      },
      allowed_tools: {
        type: "array",
        items: { type: "string" },
        description: "For role='custom' only: the exact tool names the agent may use (e.g. read_file, grep, glob, edit_file, bash). Ignored for built-in roles.",
      },
      role_label: {
        type: "string",
        description: "For role='custom' only: a short name for the custom role (shown in the sidebar).",
      },
      role_instructions: {
        type: "string",
        description: "For role='custom' only: extra guidance describing how this custom role should behave.",
      },
    },
    required: ["task"],
  },
  async run(args, ctx) {
    const task = String(args.task ?? "").trim();
    if (!task) return { ok: false, output: "Provide a task." };
    const roleId = String(args.role ?? "general");
    const role =
      roleId === "custom"
        ? resolveRole("custom", {
            label: args.role_label ? String(args.role_label) : undefined,
            tools: Array.isArray(args.allowed_tools) ? args.allowed_tools.map(String) : [],
            prompt: args.role_instructions ? String(args.role_instructions) : undefined,
          })
        : resolveRole(roleId);
    try {
      const a = startBgAgent(task, ctx.cwd, ctx.ownerId, role, false, ctx.safety);
      const active = getBgAgents().filter(
        (x) => x.status === "working" && x.role.id === role.id,
      ).length;
      return {
        ok: true,
        output:
          `Started ${role.label} agent "${a.name}" (${active}/${role.poolSize} ${role.label} running) on: ${task.slice(0, 120)}\n` +
          `${a.name} works autonomously${role.tools ? " with a scoped, role-limited toolset" : ""}; you'll receive its result automatically when it finishes. ` +
          "Finish your reply now and end your turn — do NOT wait or poll.",
      };
    } catch (e) {
      return { ok: false, output: e instanceof Error ? e.message : String(e) };
    }
  },
};

export const stopAgentTool: Tool = {
  name: "stop_agent",
  description:
    "Stop a running background agent (or remove a finished one) by its name or id — when its work is no longer needed, it duplicated effort, or it went off the rails.",
  parameters: {
    type: "object",
    properties: {
      agent: { type: "string", description: 'Agent name (e.g. "Nova") or id' },
    },
    required: ["agent"],
  },
  async run(args) {
    const q = String(args.agent ?? "").trim().toLowerCase();
    const list = getBgAgents();
    const a = list.find((x) => x.id === q || x.name.toLowerCase() === q);
    if (!a) {
      const names = list.length ? list.map((x) => `${x.name} (${x.status})`).join(", ") : "none";
      return { ok: false, output: `No background agent matches "${args.agent}". Current agents: ${names}.` };
    }
    const wasWorking = a.status === "working";
    stopOrRemoveBgAgent(a.id);
    return { ok: true, output: wasWorking ? `Stopped ${a.name}.` : `Removed ${a.name} (was ${a.status}).` };
  },
};
