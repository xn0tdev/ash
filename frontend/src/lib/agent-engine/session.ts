import { ContentBlock, Message } from "./types";
import { PermissionGate, PermissionMode, PermissionRequest } from "./permissions";
import { resolveEngineConfig, ResolvedEngineConfig } from "./config";
import { buildSystemPrompt } from "./system-prompt";
import { runTurn } from "./loop";
import { compact, contextUsage } from "./context";
import { CommandGuard } from "./safety";
import type { SafetyContext } from "./types";

/** Role scoping for a session — restricts its tools, permission mode, and adds
 * role-specific system-prompt guidance. Omitted for the main chat (full access). */
export interface SessionRoleOptions {
  /** Tool names this session may call. undefined = every tool. */
  allowedTools?: string[];
  permissionMode?: PermissionMode;
  /** Extra system-prompt text describing the role. */
  promptAddon?: string;
}

export interface EngineEvents {
  onText: (text: string) => void;
  onThought?: (text: string) => void;
  /** kind = the tool's registry name (read_file, bash, …) for icon choice. */
  onToolCall: (id: string, title: string, status: string, kind?: string) => void;
  onPermissionRequest: (req: PermissionRequest) => void;
  onCompacting?: (status: "start" | "done") => void;
  /** Context window fill (0..1), fired after each turn/compaction. */
  onContext?: (usage: number) => void;
  /** Safe mode: the agent asked to review & merge its sandbox — open the UI. */
  onMergeReview?: () => void;
  /** Queued steering notes were just delivered to the model (mid-turn). The UI
   * uses this to move its "waiting to send" chips into the transcript. */
  onNotesFlushed?: () => void;
  onError: (message: string) => void;
}

/** Per-pane engine state — lives outside React like term.ts's TermSession,
 * so it survives a pane remount and keeps conversation history across turns. */
export class EngineSession {
  history: Message[] = [];
  system = "";
  config: ResolvedEngineConfig;
  permissions: PermissionGate;
  signal: AbortSignal;
  /** Model reasoning depth — changed from the chat UI, applied next turn. */
  reasoningEffort: ResolvedEngineConfig["reasoningEffort"] = "auto";
  /** Role tool whitelist — undefined means every tool. Read by the loop when
   * advertising tools to the model and when gating each tool call. */
  allowedTools?: string[];
  /** Set only while this session is operating in a Safe mode sandbox. */
  safety?: SafetyContext;
  commandGuard: CommandGuard;

  private abort: AbortController;
  private systemReady: Promise<void>;
  /** Steering notes typed while a turn runs — delivered to the model before
   * its next request instead of interrupting the stream. */
  private pendingNotes: string[] = [];

  constructor(
    public cwd: string,
    public events: EngineEvents,
    /** Owning agent pane id — tags background sessions it spawns. */
    public ownerId?: string,
    /** Role scoping — omitted for the main chat, set for background roles. */
    role?: SessionRoleOptions,
    safety?: SafetyContext,
  ) {
    this.config = resolveEngineConfig();
    this.reasoningEffort = this.config.reasoningEffort;
    this.allowedTools = role?.allowedTools;
    this.safety = safety;
    this.commandGuard = new CommandGuard(() => ({
      provider: this.config.provider,
      model: this.config.safetyModel,
    }));
    this.permissions = new PermissionGate(
      role?.permissionMode ?? this.config.permissionMode,
      events.onPermissionRequest,
    );
    this.abort = new AbortController();
    this.signal = this.abort.signal;
    const addon = role?.promptAddon?.trim();
    this.systemReady = buildSystemPrompt(cwd).then((s) => {
      this.system = addon ? `${s}\n\n${addon}` : s;
    });
  }

  async prompt(text: string, extraBlocks: ContentBlock[] = []): Promise<void> {
    // Fresh abort controller BEFORE the startup awaits: a Stop pressed during
    // systemReady must abort THIS turn. runTurn short-circuits on an
    // already-aborted signal, so no provider call happens if Stop won the race.
    this.abort = new AbortController();
    this.signal = this.abort.signal;
    await this.systemReady;
    const content: ContentBlock[] = [];
    if (text) content.push({ type: "text", text });
    content.push(...extraBlocks);
    this.history.push({ role: "user", content });
    await runTurn(this);
    // Notes that landed during the turn's final stretch (model already gave its
    // last reply) start a follow-up turn so they aren't silently dropped.
    while (this.flushNotes() && !this.signal.aborted) await runTurn(this);
    this.reportContext();
  }

  /** Queue a mid-task correction; the loop injects it before the next model call. */
  queueNote(text: string) {
    this.pendingNotes.push(text);
  }

  /** Move queued notes into history. Returns whether anything was flushed. */
  flushNotes(): boolean {
    if (!this.pendingNotes.length) return false;
    for (const n of this.pendingNotes)
      this.history.push({
        role: "user",
        content: [
          {
            type: "text",
            text: `[User note sent while you were working — adjust course accordingly]\n${n}`,
          },
        ],
      });
    this.pendingNotes = [];
    this.events.onNotesFlushed?.();
    return true;
  }

  /** Emit current context fill so the UI's battery gauge can update. */
  reportContext() {
    this.events.onContext?.(contextUsage(this.history, this.system, this.config.contextWindow));
  }

  /** Force a context compaction now (manual /compact) — summarizes the older
   * messages into one, keeping the recent tail. Fires the same start/done
   * indicator the automatic path does. Returns whether anything was compacted. */
  async compactNow(): Promise<boolean> {
    const before = this.history.length;
    this.abort = new AbortController();
    this.signal = this.abort.signal;
    this.events.onCompacting?.("start");
    try {
      this.history = await compact(
        this.history,
        this.config.provider,
        this.config.model,
        this.signal,
        this.config.contextWindow,
      );
    } finally {
      this.events.onCompacting?.("done");
      this.reportContext();
    }
    return this.history.length < before;
  }

  cancel() {
    this.abort.abort();
    this.permissions.denyAllPending();
  }

  resolvePermission(id: string, approved: boolean) {
    this.permissions.resolve(id, approved);
  }

  dispose() {
    this.cancel();
  }
}
