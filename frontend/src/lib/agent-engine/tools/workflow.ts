import { Tool } from "../types";
import { ROLES, resolveRole } from "../roles";
import {
  BgAgent,
  reserveBgAgent,
  activateBgAgent,
  startBgAgent,
  markBgAgentReported,
  stopOrRemoveBgAgent,
} from "../../bg-agents";

// Multi-agent orchestration. Like agent-bg.ts, this sits on the bg-agents import
// cycle, so it must only touch bg-agents exports INSIDE run(), never at module
// init. run_workflow blocks the caller's turn, driving a review→edit→verify
// pipeline with automatic handoff; spawn_agents is the manual fan-out.

const clamp = (n: unknown, lo: number, hi: number) =>
  Math.max(lo, Math.min(hi, Math.round(Number(n) || 0)));

const REVIEW_FOCUS = [
  "correctness and logic bugs",
  "security, input validation, and error handling",
  "edge cases and race conditions",
  "performance and code quality",
  "tests and missing coverage",
];

const focusOf = (i: number) => REVIEW_FOCUS[i % REVIEW_FOCUS.length];

export const runWorkflowTool: Tool = {
  name: "run_workflow",
  description:
    "Run a full multi-agent pipeline on a goal and BLOCK until it finishes, then return a consolidated report. The whole team is shown up front (waiting), then stages hand off automatically: N read-only reviewers run in parallel → their findings are collected → M editors apply fixes → an optional verifier runs the build/tests. Use this for substantial, self-contained work worth a whole team (a thorough audit-and-fix, a big review). The sub-agents are visible in the sidebar while it runs. For simple fan-out without the pipeline, use spawn_agents; for a single delegated task, use agent.",
  parameters: {
    type: "object",
    properties: {
      goal: {
        type: "string",
        description: "The complete, standalone objective for the pipeline (what to review/fix and any constraints).",
      },
      reviewers: {
        type: "number",
        description: "How many read-only reviewers to run in parallel (default 3, max 10).",
      },
      editors: {
        type: "number",
        description: "How many editors apply the fixes afterwards (default 0 = review-only; max 10). With >1, each editor is told to take a disjoint slice of the findings.",
      },
      verify: {
        type: "boolean",
        description: "Run a verifier (build/tests, no edits) at the end. Defaults to true when editors > 0.",
      },
    },
    required: ["goal"],
  },
  async run(args, ctx) {
    const goal = String(args.goal ?? "").trim();
    if (!goal) return { ok: false, output: "Provide a goal for the workflow." };
    const reviewers = clamp(args.reviewers ?? 3, 1, ROLES.reviewer.poolSize);
    const editors = clamp(args.editors ?? 0, 0, ROLES.editor.poolSize);
    const verify = args.verify ?? editors > 0;

    // Elapsed work time, reported back in the chat (via this tool's result).
    const t0 = Date.now();
    const took = () => {
      const s = Math.max(1, Math.round((Date.now() - t0) / 1000));
      return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`;
    };

    // Stop/clear every workflow agent (running OR still waiting) on user Stop.
    const all: BgAgent[] = [];
    const onAbort = () => all.forEach((a) => stopOrRemoveBgAgent(a.id));
    ctx.signal.addEventListener("abort", onAbort, { once: true });

    const reserve = (n: number, role: (typeof ROLES)[string], hint: (i: number) => string) =>
      Array.from({ length: n }, (_, i) => {
        const a = reserveBgAgent(hint(i), ctx.cwd, ctx.ownerId, role);
        all.push(a);
        return a;
      });
    // Activate a stage's agents with their real (now-known) task, await, release.
    const runStage = async (stage: BgAgent[], task: (i: number) => string) => {
      const done = await Promise.all(stage.map((a, i) => activateBgAgent(a, task(i))));
      done.forEach((a) => markBgAgentReported(a.id));
      return done;
    };

    try {
      // Reserve the WHOLE team up front so the user sees every agent (waiting)
      // from the moment the workflow starts, not trickling in per stage.
      const reviewerAgents = reserve(reviewers, ROLES.reviewer, (i) => `Reviewer · ${focusOf(i)}`);
      const editorAgents = reserve(editors, ROLES.editor, () => "Editor · waiting for review");
      const verifierAgents = verify ? reserve(1, ROLES.verifier, () => "Verifier · waiting for edits") : [];

      // ── Stage 1: review ──────────────────────────────────────────────
      const reviews = await runStage(
        reviewerAgents,
        (i) =>
          `Review this project against the goal below. You are READ-ONLY — do not edit.\n\nGoal:\n${goal}\n\nFocus especially on: ${focusOf(i)}.\n\nReport concrete findings: for each, give file:line, a severity (critical/major/minor), and a one-line description. If you find nothing, say so.`,
      );
      if (ctx.signal.aborted) return { ok: false, output: "Workflow cancelled during review." };

      const reviewReport = reviews
        .map((a, i) => `## ${a.name} — ${focusOf(i)}\n${a.result || "(no findings)"}`)
        .join("\n\n");

      if (editors === 0) {
        return { ok: true, output: `Review complete in ${took()} — ${reviews.length} reviewer(s).\n\n${reviewReport}` };
      }

      // ── Stage 2: edit (handoff of the review findings) ───────────────
      const edits = await runStage(editorAgents, (i) =>
        editors === 1
          ? `Apply fixes for the goal below, using the review findings. Fix what's real, skip false positives, and verify with the project's build/test if apparent. Report what you changed (file:line).\n\nGoal:\n${goal}\n\nReview findings:\n${reviewReport}`
          : `You are editor ${i + 1} of ${editors}. Work ONLY on the findings whose position (counting top to bottom across the whole review) modulo ${editors} equals ${i}; leave the others to the other editors and do not touch their files. Report what you changed (file:line).\n\nGoal:\n${goal}\n\nReview findings:\n${reviewReport}`,
      );
      if (ctx.signal.aborted) return { ok: false, output: "Workflow cancelled during edit." };

      const editReport = edits.map((a) => `## ${a.name}\n${a.result || "(no summary)"}`).join("\n\n");

      if (!verifierAgents.length) {
        return {
          ok: true,
          output: `Workflow complete in ${took()}: ${reviews.length} reviewer(s) → ${edits.length} editor(s).\n\n### Edits\n${editReport}`,
        };
      }

      // ── Stage 3: verify ──────────────────────────────────────────────
      const [verifier] = await runStage(
        verifierAgents,
        () =>
          `Verify the fixes below for the goal. You may read and RUN (build, tests, typecheck) but must NOT edit. Confirm each reported issue is resolved and nothing regressed; report pass/fail per item with the actual command output.\n\nGoal:\n${goal}\n\nReview findings:\n${reviewReport}\n\nEditor changes:\n${editReport}`,
      );

      return {
        ok: true,
        output:
          `Workflow complete in ${took()}: ${reviews.length} reviewer(s) → ${edits.length} editor(s) → verify.\n\n` +
          `### Verification\n${verifier?.result || "(no verdict)"}\n\n### Edits\n${editReport}`,
      };
    } finally {
      ctx.signal.removeEventListener("abort", onAbort);
    }
  },
};

export const spawnAgentsTool: Tool = {
  name: "spawn_agents",
  description:
    "Start a GROUP of background agents at once, each with its own task, all in the same role. Fire-and-forget: each result is delivered to you automatically when it finishes (never wait or poll). Use for parallel fan-out — several reviewers over different areas, or editors over different files you assign. For an automatic review→edit→verify pipeline, use run_workflow instead; for one task, use agent.",
  parameters: {
    type: "object",
    properties: {
      role: {
        type: "string",
        enum: ["general", "reviewer", "editor", "verifier", "researcher"],
        description: "Role shared by every agent in the group. Prefer a read-only role (reviewer/researcher/verifier) unless they must edit.",
      },
      tasks: {
        type: "array",
        items: { type: "string" },
        description: "One complete, standalone task per agent to start (each sees nothing but its own task).",
      },
    },
    required: ["tasks"],
  },
  async run(args, ctx) {
    const role = resolveRole(String(args.role ?? "general"));
    const tasks = (Array.isArray(args.tasks) ? args.tasks : []).map((t: unknown) => String(t).trim()).filter(Boolean);
    if (!tasks.length) return { ok: false, output: "Provide one or more tasks." };

    const started: string[] = [];
    let poolMsg = "";
    for (const task of tasks) {
      try {
        started.push(startBgAgent(task, ctx.cwd, ctx.ownerId, role).name);
      } catch (e) {
        poolMsg = ` Could not start the rest: ${e instanceof Error ? e.message : String(e)}`;
        break;
      }
    }
    if (!started.length) return { ok: false, output: `Couldn't start any agents.${poolMsg}` };
    return {
      ok: true,
      output:
        `Started ${started.length} ${role.label} agent(s): ${started.join(", ")}.${poolMsg}\n` +
        "Each works autonomously; you'll get each result automatically when it finishes. End your turn now — do NOT wait or poll.",
    };
  },
};
