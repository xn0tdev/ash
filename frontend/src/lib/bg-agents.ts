import { EngineSession } from "./agent-engine/session";
import { AgentRole, DEFAULT_ROLE } from "./agent-engine/roles";
import type { SafetyContext } from "./agent-engine/types";
import type { DotMatrixVariant } from "../components/DotMatrix";

// Background Ash agents: autonomous child engine sessions the main agent can
// delegate subtasks to (up to MAX_BG_AGENTS at once). Like background
// terminals they live OUTSIDE React — the sidebar lists them, a read-only
// viewer pane shows their chat, and the owning chat is woken with the result
// when one finishes. Each gets a simple name + color + dot-matrix variant so
// they're tellable apart at a glance.

export const MAX_BG_AGENTS = 10;

const NAMES = ["Nova", "Echo", "Iris", "Bolt", "Juno", "Mira", "Pixel", "Dash", "Onyx", "Rex"];
const COLORS = [
  "#7aa2ff", "#5fb87a", "#d99a5b", "#c678dd", "#56b6c2",
  "#e06c75", "#e5c07b", "#61afef", "#98c379", "#ff92df",
];
const VARIANTS: DotMatrixVariant[] = ["vortex", "chase", "rain", "bits", "life"];

// Transcript item — mirrors AgentThread's Item union (kept as plain data so
// the viewer can cast and reuse the same renderer).
export interface BgItem {
  k: string;
  id: string;
  text?: string;
  done?: boolean;
  open?: boolean;
  toolId?: string;
  title?: string;
  status?: string;
  kind?: string;
  seconds?: number;
}

export interface BgAgent {
  id: string;
  name: string;
  color: string;
  variant: DotMatrixVariant;
  task: string;
  cwd: string;
  /** The role this agent runs as — scopes its tools and its concurrency pool. */
  role: AgentRole;
  /** Managed by a run_workflow orchestrator — its result is collected there, so
   * the owner chat's auto-wake must NOT also deliver it as a stray note. */
  managed?: boolean;
  /** Pane id of the chat that spawned it. */
  ownerId?: string;
  /** Inherited from a Safe mode owner; background agents cannot auto-approve it. */
  safety?: SafetyContext;
  /** "waiting" = reserved by a workflow but not yet started (its stage hasn't
   * begun) — shown up front so the whole team is visible from the outset. */
  status: "waiting" | "working" | "done" | "failed" | "stopped";
  items: BgItem[];
  /** Final assistant text, filled when the run ends. */
  result: string;
  /** The owner chat has already been woken with the result. */
  reported: boolean;
  /** Undefined until the agent is activated (a waiting reservation has none). */
  session?: EngineSession;
  /** 0 until activated; wall-clock start once running. */
  startedAt: number;
  /** Set when the run ends, so a finished agent shows a frozen elapsed time. */
  finishedAt?: number;
}

let agents: BgAgent[] = [];
const listeners = new Set<() => void>();
const doneListeners = new Set<(a: BgAgent) => void>();
let seq = 0;

// Coalesce change notifications to one per frame — up to 10 agents stream
// tokens concurrently, and per-token emits would re-render the sidebar and
// any open viewer hundreds of times a second.
let emitScheduled = false;
function emit() {
  if (emitScheduled) return;
  emitScheduled = true;
  requestAnimationFrame(() => {
    emitScheduled = false;
    listeners.forEach((fn) => fn());
  });
}

export function onBgAgentsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Fires when an agent's run ends (done/failed) — owners use it to wake up. */
export function onBgAgentFinished(fn: (a: BgAgent) => void): () => void {
  doneListeners.add(fn);
  return () => doneListeners.delete(fn);
}

export function getBgAgents(): readonly BgAgent[] {
  return agents;
}

export function getBgAgent(id: string): BgAgent | undefined {
  return agents.find((a) => a.id === id);
}

export function markBgAgentReported(id: string) {
  const a = getBgAgent(id);
  if (a) {
    a.reported = true;
    // Now delivered — let it fade like any other finished agent (its removal was
    // held off while the result was still undelivered; see scheduleRemoval).
    scheduleRemoval(id);
  }
}

/** Final trailing assistant text from the child's history. */
function extractResult(session: EngineSession): string {
  for (let i = session.history.length - 1; i >= 0; i--) {
    const m = session.history[i];
    if (m.role !== "assistant") continue;
    const text = m.content.reduce((s, b) => (b.type === "text" ? s + b.text : s), "");
    if (text.trim()) return text.trim();
  }
  return "";
}

// Retain only a handful of finished agents — each keeps its full transcript
// and history, so an unbounded pile is silent memory growth.
const MAX_FINISHED = 6;
function pruneFinished() {
  // Only evict agents whose result has already been DELIVERED to their owner.
  // An unreported done/failed result (owner was closed at finish) must survive
  // until a reopened owner can drain it — otherwise the subtask result is lost.
  const finished = agents.filter((x) => x.status !== "working" && x.reported);
  if (finished.length <= MAX_FINISHED) return;
  for (const old of finished.slice(0, finished.length - MAX_FINISHED)) {
    cancelRemoval(old.id);
    old.session?.dispose();
    agents = agents.filter((x) => x.id !== old.id);
  }
}

// Finished agents also fade away on their own after a while — the row exists
// so the user can peek at the result, not to pile up forever.
const FINISHED_TTL_MS = 60_000;
// Track pending removal timers so a manual remove can cancel them instead of
// leaving a no-op timer to fire later (and so re-scheduling replaces, not stacks).
const removalTimers = new Map<string, number>();
function cancelRemoval(id: string) {
  const t = removalTimers.get(id);
  if (t !== undefined) {
    clearTimeout(t);
    removalTimers.delete(id);
  }
}
function scheduleRemoval(id: string) {
  cancelRemoval(id);
  const t = window.setTimeout(() => {
    removalTimers.delete(id);
    const a = getBgAgent(id);
    if (!a || a.status === "working") return;
    // Keep an undelivered result alive past the TTL (owner was closed at finish)
    // so a reopened owner can still be woken with it. A stopped agent has no
    // result to deliver, so it fades normally.
    if (!a.reported && (a.status === "done" || a.status === "failed")) return;
    a.session?.dispose();
    agents = agents.filter((x) => x.id !== id);
    emit();
  }, FINISHED_TTL_MS);
  removalTimers.set(id, t);
}

// Transcript mutators for one agent. Split out so both an immediate start and a
// deferred (workflow) activation share the exact same streaming behavior.
// Mutations are O(1): push/replace the TAIL SLOT in place, but always with a NEW
// object for the changed item — memoized viewer rows compare by identity, and
// subscribers get a fresh array copy per coalesced emit.
function makeBuilders(a: BgAgent) {
  const nextId = () => `${a.id}:${++seq}`;
  const push = (item: BgItem) => {
    a.items.push(item);
    emit();
  };
  const appendText = (t: string) => {
    const last = a.items[a.items.length - 1];
    if (last?.k === "text") a.items[a.items.length - 1] = { ...last, text: (last.text ?? "") + t };
    else a.items.push({ k: "text", id: nextId(), text: t });
    emit();
  };
  const appendThought = (t: string) => {
    const last = a.items[a.items.length - 1];
    if (last?.k === "thought" && !last.done) {
      const merged = (last.text ?? "") + t;
      // Cap the kept reasoning to its tail — a nonstop fast-mode stream would
      // otherwise grow it without bound (the live view only shows the tail).
      a.items[a.items.length - 1] = {
        ...last,
        text: merged.length > 24000 ? merged.slice(-24000) : merged,
      };
    } else a.items.push({ k: "thought", id: nextId(), text: t, done: false });
    emit();
  };
  const sealThought = () => {
    const last = a.items[a.items.length - 1];
    if (last?.k === "thought" && !last.done) {
      a.items[a.items.length - 1] = { ...last, done: true };
      emit();
    }
  };
  const upsertTool = (toolId: string, title: string, status: string, kind?: string) => {
    const i = a.items.findIndex((x) => x.k === "tool" && x.toolId === toolId);
    if (i >= 0) a.items[i] = { ...a.items[i], title, status, kind: kind ?? a.items[i].kind };
    else a.items.push({ k: "tool", id: nextId(), toolId, title, status, kind });
    emit();
  };
  return { nextId, push, appendText, appendThought, sealThought, upsertTool };
}

// Create the store record (name/colour/id) without a session. status "waiting"
// = reserved by a workflow, shown up front; "working" callers activate at once.
function newBgRecord(
  task: string,
  cwd: string,
  ownerId: string | undefined,
  role: AgentRole,
  managed: boolean,
  safety?: SafetyContext,
): BgAgent {
  const used = new Set(agents.map((a) => a.name));
  const slot = NAMES.findIndex((n) => !used.has(n));
  const name = slot >= 0 ? NAMES[slot] : `Agent ${agents.length + 1}`;
  const idx = slot >= 0 ? slot : agents.length % NAMES.length;
  const id = crypto.randomUUID();
  const a: BgAgent = {
    id,
    name,
    color: COLORS[idx % COLORS.length],
    variant: VARIANTS[idx % VARIANTS.length],
    task,
    cwd,
    role,
    managed,
    ownerId,
    safety: safety ? { ...safety, interactive: false } : undefined,
    status: "waiting",
    items: [{ k: "user", id: `${id}:0`, text: task }],
    result: "",
    reported: false,
    session: undefined,
    startedAt: 0,
  };
  agents = [...agents, a];
  emit();
  return a;
}

/** Start a waiting agent: build its engine session, run the task, and resolve
 * when it settles (done/failed). Re-prompts with `task` (which may differ from
 * the reservation's placeholder — a workflow's edit/verify tasks only exist once
 * earlier stages finish). Pool-full is surfaced as a failure, not a throw, so a
 * workflow awaiting it doesn't hang. */
export function activateBgAgent(a: BgAgent, task: string): Promise<BgAgent> {
  if (a.status !== "waiting") return Promise.resolve(a);
  const running = agents.filter((x) => x.status === "working" && x.role.id === a.role.id).length;
  if (running >= a.role.poolSize) {
    a.status = "failed";
    a.result = `The ${a.role.label} pool is full (${a.role.poolSize}).`;
    a.finishedAt = Date.now();
    emit();
    return Promise.resolve(a);
  }

  a.task = task;
  a.items[0] = { k: "user", id: `${a.id}:0`, text: task };
  const b = makeBuilders(a);
  const session = new EngineSession(
    a.cwd,
    {
      onText: (t) => {
        b.sealThought();
        b.appendText(t);
      },
      onThought: (t) => b.appendThought(t),
      onToolCall: (toolId, title, status, kind) => {
        b.sealThought();
        b.upsertTool(toolId, title, status, kind);
      },
      // A Safe mode background agent cannot silently grant a risky operation.
      // It reports the block to its owner, whose interactive session can ask
      // the user; non-safe role permissions retain the existing autonomous flow.
      onPermissionRequest: (req) => a.session?.resolvePermission(req.id, !a.safety),
      onCompacting: (status) => {
        if (status === "start") b.upsertTool(`compact:${a.id}`, "Compressing context…", "in_progress", "compact");
        else b.upsertTool(`compact:${a.id}`, "Context compressed", "completed", "compact");
      },
      onError: (msg) => b.push({ k: "error", id: b.nextId(), text: msg }),
    },
    a.id,
    { allowedTools: a.role.tools, permissionMode: a.role.permissionMode, promptAddon: a.role.promptAddon },
    a.safety,
  );
  a.session = session;
  a.status = "working";
  a.startedAt = Date.now();
  emit();

  return session
    .prompt(task)
    .then(() => {
      if (a.status !== "working") return;
      a.result = extractResult(session);
      a.status = "done";
    })
    .catch((e) => {
      if (a.status !== "working") return;
      a.result = e instanceof Error ? e.message : String(e);
      a.status = "failed";
      b.push({ k: "error", id: b.nextId(), text: a.result });
    })
    .finally(() => {
      a.finishedAt = Date.now();
      if (a.status === "stopped") return;
      b.push({
        k: "worked",
        id: b.nextId(),
        seconds: Math.max(1, Math.round((a.finishedAt - a.startedAt) / 1000)),
      });
      pruneFinished();
      scheduleRemoval(a.id);
      emit();
      doneListeners.forEach((fn) => fn(a));
    })
    .then(() => a);
}

export function startBgAgent(
  task: string,
  cwd: string,
  ownerId?: string,
  role: AgentRole = DEFAULT_ROLE,
  managed = false,
  safety?: SafetyContext,
): BgAgent {
  // Concurrency is capped PER ROLE (its category pool), so several roles can run
  // full pools side by side — e.g. 10 reviewers and 10 editors at once.
  const runningInRole = agents.filter(
    (a) => a.status === "working" && a.role.id === role.id,
  ).length;
  if (runningInRole >= role.poolSize)
    throw new Error(
      `Already running ${role.poolSize} ${role.label} agents — wait for one to finish or stop one.`,
    );
  const a = newBgRecord(task, cwd, ownerId, role, managed, safety);
  activateBgAgent(a, task); // fire-and-forget: result reaches the owner via the wake
  return a;
}

/** Reserve a workflow agent shown as "waiting" from the outset; the orchestrator
 * calls activateBgAgent(agent, task) when its stage begins. Marked `managed` so
 * the owner chat's auto-wake won't ALSO deliver the result as a stray note. */
export function reserveBgAgent(
  hint: string,
  cwd: string,
  ownerId: string | undefined,
  role: AgentRole,
  safety?: SafetyContext,
): BgAgent {
  return newBgRecord(hint, cwd, ownerId, role, true, safety);
}

/** Sidebar close button: stop a working agent, remove a finished one. */
export function stopOrRemoveBgAgent(id: string) {
  const a = getBgAgent(id);
  if (!a) return;
  if (a.status === "working") {
    a.status = "stopped";
    a.session?.cancel();
    scheduleRemoval(a.id);
    emit();
  } else {
    // "waiting" (never activated) reservations dispose the same way — no session.
    cancelRemoval(id);
    a.session?.dispose();
    agents = agents.filter((x) => x.id !== id);
    emit();
  }
}
