import type { EngineSession } from "./session";
import { ContentBlock } from "./types";
import { getTool, toolSchemas } from "./tools/registry";
import { compact, shouldCompact } from "./context";
import { releaseTerminalsByOwner } from "../agent-activity";

// Reasoning models can spend a large share of this on hidden "thinking"
// before emitting text/tool_calls (verified against Fireworks' kimi-k2p6 and
// glm-5p2 — GLM can burn thousands of tokens reasoning before any output) —
// keep generous rather than tuning it per model.
const MAX_TOKENS = 16384;
// Backstop against a model that never stops calling tools (the exact OpenCode
// failure mode the user described — looping on the same skill for hours).
// Generous — real refactors legitimately take dozens of round-trips — and
// hitting it wraps the turn up gracefully instead of erroring out.
const MAX_ITERATIONS = 100;

const TOOL_TITLES: Record<string, string> = {
  read_file: "Read",
  edit_file: "Edit",
  write_file: "Write",
  bash: "Run",
  bash_background: "Run in background",
  kill_background: "Stop session",
  read_terminal: "Read terminal",
  terminal_input: "Type in terminal",
  wait_for_terminal: "Wait for output",
  agent: "Background agent",
  stop_agent: "Stop agent",
  run_workflow: "Workflow",
  spawn_agents: "Spawn agents",
  grep: "Search",
  glob: "List",
  web_fetch: "Fetch",
  skill: "Skill",
  propose_merge: "Review & merge",
};

// File tools get a past-tense suffix ("notes.txt edited") instead of an
// imperative "Label:" prefix — reads like a status line, not a command.
// bash/grep/glob/web_fetch stay bare (the command/pattern/url is already
// self-explanatory) since a verb there just reads as clutter.
const PAST_TENSE: Record<string, string> = {
  read_file: "read",
  edit_file: "edited",
  write_file: "created",
};

function prettyName(name: string): string {
  return TOOL_TITLES[name] ?? name;
}

function describeTool(name: string, args: unknown): string {
  const a = (args ?? {}) as Record<string, unknown>;
  // wait_for_terminal's "detail" is a raw regex pattern — dumping it into the
  // row reads as noise (e.g. "PS C:|\.exe|^go :…"), so use the friendly label.
  if (name === "wait_for_terminal") return prettyName(name);
  // `name` last: only the skill tool uses it as its detail field
  const detail = a.path ?? a.command ?? a.pattern ?? a.url ?? a.session ?? a.name ?? a.task;
  if (!detail) return prettyName(name);
  const verb = PAST_TENSE[name];
  const text = String(detail).length > 90 ? `${String(detail).slice(0, 90)}…` : String(detail);
  return verb ? `${text} ${verb}` : text;
}

function toolArgParseError(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const parseError = (args as Record<string, unknown>)._parseError;
  return typeof parseError === "string" ? parseError : null;
}

/** The agentic loop: call the provider, stream events to the UI, dispatch
 * any tool calls (through the permission gate), feed results back, repeat
 * until the model gives a final answer with no more tool calls. */
export async function runTurn(session: EngineSession): Promise<void> {
  try {
    await runTurnInner(session);
  } finally {
    // Terminals the agent grabbed this turn go back to the user.
    releaseTerminalsByOwner(session.ownerId ?? "engine");
  }
}

async function runTurnInner(session: EngineSession): Promise<void> {
  const { events } = session;
  let emptyRetries = 0;

  for (let iter = 0; iter < MAX_ITERATIONS; iter++) {
    if (session.signal.aborted) return;

    // Steering notes typed while the previous round streamed / ran tools —
    // injected here (after that round's tool results) so the very next model
    // call sees the correction without the user having to stop the turn.
    session.flushNotes();

    // Compaction can take a moment (a summarization call) — surface it as a
    // live "compressing…" row that flips to done, not a silent after-the-fact
    // note. Checked before every iteration, so a tool-heavy turn is covered too.
    if (shouldCompact(session.history, session.system, session.config.contextWindow)) {
      events.onCompacting?.("start");
      // A failed/aborted compaction must ALWAYS flip the indicator off (else the
      // UI is stuck on "compressing…") and surface a real error. compact() only
      // returns a new array — history is untouched on throw — so on failure we
      // keep the existing history and end the turn.
      let compacted: typeof session.history | null = null;
      try {
        compacted = await compact(
          session.history,
          session.config.provider,
          session.config.model,
          session.signal,
          session.config.contextWindow,
        );
      } catch (e) {
        if (!session.signal.aborted) events.onError(e instanceof Error ? e.message : String(e));
      } finally {
        events.onCompacting?.("done");
      }
      if (!compacted) return;
      session.history = compacted;
      session.reportContext();
    }

    let assistantText = "";
    const toolCalls: { id: string; name: string; args: unknown }[] = [];
    let stopReason = "end_turn";
    let hardError: string | null = null;

    try {
      for await (const ev of session.config.provider.streamChat(
        {
          model: session.config.model,
          system: session.system,
          messages: session.history,
          tools: toolSchemas(session.allowedTools),
          maxTokens: MAX_TOKENS,
          reasoningEffort: session.reasoningEffort,
          supportsImages: session.config.supportsImages,
        },
        session.signal,
      )) {
        switch (ev.type) {
          case "text_delta":
            assistantText += ev.text;
            events.onText(ev.text);
            break;
          case "thought_delta":
            events.onThought?.(ev.text);
            break;
          case "tool_call_start":
            events.onToolCall(ev.id, prettyName(ev.name), "pending", ev.name);
            break;
          case "tool_call_end":
            toolCalls.push({ id: ev.id, name: ev.name, args: ev.args });
            break;
          case "message_stop":
            stopReason = ev.stopReason;
            break;
          case "error":
            hardError = ev.message;
            break;
        }
      }
    } catch (e) {
      hardError = e instanceof Error ? e.message : String(e);
    }

    // A user Stop aborts the fetch mid-stream — that surfaces as an
    // AbortError/"BodyStreamBuffer was aborted", not a real failure.
    if (session.signal.aborted) return;

    if (hardError) {
      events.onError(hardError);
      return;
    }

    // Reasoning models (verified: GLM via Fireworks) can spend the ENTIRE
    // output budget on hidden reasoning_content and finish with no visible
    // text and no tool calls — previously this silently killed the turn.
    // Nudge the model to answer without the deep think and retry.
    if (!assistantText && toolCalls.length === 0) {
      if (emptyRetries < 2) {
        emptyRetries++;
        session.history.push({
          role: "user",
          content: [
            {
              type: "text",
              text:
                stopReason === "max_tokens"
                  ? "[system] Your reply was cut off by the output-token limit before any visible text or tool call (hidden reasoning used it all). Answer again, concisely — go straight to the tool call or the answer."
                  : "[system] Your reply was empty. Answer again with visible text or a tool call.",
            },
          ],
        });
        continue;
      }
      events.onError(
        stopReason === "max_tokens"
          ? "The model kept hitting its output limit while reasoning, without producing a reply. Try rephrasing, or a different model."
          : "The model returned an empty reply several times in a row.",
      );
      return;
    }
    emptyRetries = 0;

    const assistantContent: ContentBlock[] = [];
    if (assistantText) assistantContent.push({ type: "text", text: assistantText });
    for (const tc of toolCalls) assistantContent.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.args });
    session.history.push({ role: "assistant", content: assistantContent });

    // Gate on whether tools were actually requested, NOT on stopReason alone:
    // some providers stream tool_calls but report finish_reason "stop", which
    // would otherwise leave the pushed assistant tool_use blocks unanswered.
    if (toolCalls.length === 0) return; // final answer — turn done

    const resultBlocks: ContentBlock[] = [];
    for (const tc of toolCalls) {
      // On Stop, quit dispatching further tools but DON'T return yet — every
      // tool_use in the assistant message above must get a matching tool_result
      // (filled below) or every later request 400s ("tool_calls must be
      // followed by tool messages") and the chat is permanently broken.
      if (session.signal.aborted) break;
      const title = describeTool(tc.name, tc.args);
      const parseError = toolArgParseError(tc.args);
      if (parseError) {
        events.onToolCall(tc.id, title, "failed", tc.name);
        resultBlocks.push({
          type: "tool_result",
          toolUseId: tc.id,
          content: `${parseError} Re-send this tool call with valid JSON arguments.`,
          isError: true,
        });
        continue;
      }
      const tool = getTool(tc.name);
      if (!tool) {
        events.onToolCall(tc.id, title, "failed", tc.name);
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: `Unknown tool: ${tc.name}`, isError: true });
        continue;
      }
      // Role scoping (defense in depth): the model isn't given out-of-scope tool
      // schemas, but reject a call anyway if it invents one — a reviewer must
      // never reach edit_file/bash.
      if (session.allowedTools && !session.allowedTools.includes(tc.name)) {
        events.onToolCall(tc.id, title, "failed", tc.name);
        resultBlocks.push({
          type: "tool_result",
          toolUseId: tc.id,
          content: `Tool "${tc.name}" is not available to this agent's role.`,
          isError: true,
        });
        continue;
      }

      events.onToolCall(tc.id, title, "in_progress", tc.name);
      const approved = await session.permissions.check(tc.name, tc.args);
      if (!approved) {
        events.onToolCall(tc.id, title, "failed", tc.name);
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: "User denied this action.", isError: true });
        continue;
      }

      try {
        const result = await tool.run(tc.args, {
          cwd: session.cwd,
          signal: session.signal,
          ownerId: session.ownerId,
          reviewMerge: session.events.onMergeReview,
        });
        events.onToolCall(tc.id, title, result.ok ? "completed" : "failed", tc.name);
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: result.output, isError: !result.ok });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        events.onToolCall(tc.id, title, "failed", tc.name);
        resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: `Tool threw: ${msg}`, isError: true });
      }
    }
    // Close any tool_use we broke out of (Stop mid-loop) with a cancellation
    // result, so the tool_use/tool_result pairing invariant holds in history.
    if (resultBlocks.length < toolCalls.length) {
      const answered = new Set(
        resultBlocks.map((b) => (b.type === "tool_result" ? b.toolUseId : "")),
      );
      for (const tc of toolCalls)
        if (!answered.has(tc.id))
          resultBlocks.push({ type: "tool_result", toolUseId: tc.id, content: "Cancelled.", isError: true });
    }
    session.history.push({ role: "user", content: resultBlocks });
    if (session.signal.aborted) return;
  }

  // Out of iterations: instead of surfacing a raw error (all the work so far
  // is still valid and in history), ask the model — with tools withheld — to
  // report where things stand, so the turn ends in prose the user can act on.
  session.history.push({
    role: "user",
    content: [
      {
        type: "text",
        text: "[system] Tool-call limit for this turn reached. Stop using tools and briefly summarize what you completed and what still remains to be done.",
      },
    ],
  });
  let wrapUp = "";
  try {
    for await (const ev of session.config.provider.streamChat(
      {
        model: session.config.model,
        system: session.system,
        messages: session.history,
        tools: [],
        maxTokens: MAX_TOKENS,
        reasoningEffort: session.reasoningEffort,
        supportsImages: session.config.supportsImages,
      },
      session.signal,
    )) {
      if (ev.type === "text_delta") {
        wrapUp += ev.text;
        events.onText(ev.text);
      } else if (ev.type === "error") {
        if (!session.signal.aborted) events.onError(ev.message);
        return;
      }
    }
  } catch (e) {
    if (!session.signal.aborted) events.onError(e instanceof Error ? e.message : String(e));
    return;
  }
  if (wrapUp)
    session.history.push({ role: "assistant", content: [{ type: "text", text: wrapUp }] });
}
