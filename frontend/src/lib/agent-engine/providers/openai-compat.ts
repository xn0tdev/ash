import { Message, NormalizedEvent } from "../types";
import { Provider, StreamRequest } from "./provider";
import { parseSSE } from "./sse";
import { thinkingSpecForModelId, ThinkingSpec } from "../thinking-config";
import type { ReasoningEffort } from "../../settings";

// Our Message/ContentBlock shape mirrors Anthropic's wire format (tool
// results live inside a "user" message). OpenAI wants each tool_use as a
// tool_calls entry on the assistant message and each tool_result as its own
// separate role:"tool" message — this is the one real adapter.
function toOpenAIMessages(messages: Message[], supportsImages: boolean): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const m of messages) {
    if (m.role === "assistant") {
      const text = m.content
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      const toolUses = m.content.filter((c) => c.type === "tool_use");
      const msg: Record<string, unknown> = { role: "assistant", content: text || null };
      if (toolUses.length)
        msg.tool_calls = toolUses.map((tu) =>
          tu.type === "tool_use"
            ? { id: tu.id, type: "function", function: { name: tu.name, arguments: JSON.stringify(tu.input) } }
            : null,
        );
      out.push(msg);
    } else {
      const text = m.content
        .filter((c) => c.type === "text")
        .map((c) => (c.type === "text" ? c.text : ""))
        .join("");
      const images = m.content.filter((c) => c.type === "image");
      if (images.length && supportsImages) {
        // OpenAI vision shape: content is an array of text + image_url parts.
        const parts: unknown[] = [];
        if (text) parts.push({ type: "text", text });
        for (const im of images)
          if (im.type === "image")
            parts.push({ type: "image_url", image_url: { url: im.dataUrl } });
        out.push({ role: "user", content: parts });
      } else if (images.length) {
        // model has no vision — send a text placeholder instead of 400-ing
        const note = `${text ? text + "\n" : ""}[${images.length} image(s) attached — the current model does not support image input]`;
        out.push({ role: "user", content: note });
      } else if (text) {
        out.push({ role: "user", content: text });
      }
      for (const c of m.content) {
        if (c.type === "tool_result") out.push({ role: "tool", tool_call_id: c.toolUseId, content: c.content });
      }
    }
  }
  return out;
}

interface PendingCall {
  id: string;
  name: string;
  args: string;
  started: boolean;
}

export class OpenAICompatProvider implements Provider {
  readonly id = "openai-compat";

  constructor(
    private baseUrl: string,
    private apiKey: string,
  ) {}

  async *streamChat(req: StreamRequest, signal: AbortSignal): AsyncGenerator<NormalizedEvent, void, unknown> {
    // Resolve the per-model thinking spec so we send the RIGHT param for this
    // model's family (enable_thinking for GLM, thinking object for Claude,
    // reasoning_effort for OpenAI/Grok, etc.) instead of always reasoning_effort
    // — which was a fake no-op on models that don't accept it.
    const think: ThinkingSpec = thinkingSpecForModelId(req.model);
    const thinkBody = think.encode((req.reasoningEffort ?? "auto") as ReasoningEffort);

    const body = {
      model: req.model,
      stream: true,
      max_tokens: req.maxTokens,
      messages: [{ role: "system", content: req.system }, ...toOpenAIMessages(req.messages, req.supportsImages ?? false)],
      ...thinkBody,
      ...(req.tools.length
        ? {
            tools: req.tools.map((t) => ({
              type: "function",
              function: { name: t.name, description: t.description, parameters: t.parameters },
            })),
          }
        : {}),
    };

    let res: Response;
    try {
      res = await fetch(`${this.baseUrl.replace(/\/$/, "")}/chat/completions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
        body: JSON.stringify(body),
        signal,
      });
    } catch (e) {
      yield { type: "error", message: e instanceof Error ? e.message : String(e) };
      return;
    }

    if (!res.ok || !res.body) {
      const text = await res.text().catch(() => "");
      yield { type: "error", message: `HTTP ${res.status}: ${text.slice(0, 500)}` };
      return;
    }

    const calls = new Map<number, PendingCall>();
    let finishReason: string | null = null;

    for await (const raw of parseSSE(res.body)) {
      if (raw === "[DONE]") break;
      let obj: any;
      try {
        obj = JSON.parse(raw);
      } catch {
        continue;
      }
      const choice = obj.choices?.[0];
      if (!choice) continue;
      const delta = choice.delta ?? {};
      if (choice.finish_reason) finishReason = choice.finish_reason;

      if (typeof delta.content === "string" && delta.content)
        yield { type: "text_delta", text: delta.content };
      // Thought content — check every field the model's family spec lists
      // (reasoning_content for OpenAI-compat, thinking for Claude/GLM, etc.)
      // so thoughts surface as thought_delta regardless of the field name.
      for (const field of think.streamFields) {
        const val = (delta as Record<string, unknown>)[field];
        if (typeof val === "string" && val) {
          yield { type: "thought_delta", text: val };
          break; // one field carries it — don't double-emit
        }
      }

      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const idx: number = tc.index ?? 0;
          let entry = calls.get(idx);
          if (!entry) {
            entry = { id: tc.id ?? `call_${idx}`, name: tc.function?.name ?? "", args: "", started: false };
            calls.set(idx, entry);
          }
          if (tc.id) entry.id = tc.id;
          if (tc.function?.name) entry.name = tc.function.name;
          // Wait for the name before announcing the call — the first delta often
          // carries only the id, and emitting start with name:"" renders a blank
          // pending tool row in the UI.
          if (!entry.started && entry.name) {
            yield { type: "tool_call_start", id: entry.id, name: entry.name };
            entry.started = true;
          }
          if (tc.function?.arguments) {
            entry.args += tc.function.arguments;
            yield { type: "tool_call_delta", id: entry.id, argsDelta: tc.function.arguments };
          }
        }
      }
    }

    for (const entry of calls.values()) {
      let args: unknown = {};
      try {
        args = entry.args ? JSON.parse(entry.args) : {};
      } catch {
        args = { _parseError: "Malformed JSON tool arguments.", _raw: entry.args };
      }
      yield { type: "tool_call_end", id: entry.id, name: entry.name, args };
    }

    const stopReason =
      finishReason === "tool_calls" ? "tool_use" : finishReason === "length" ? "max_tokens" : "end_turn";
    yield { type: "message_stop", stopReason };
  }
}
