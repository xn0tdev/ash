import { ContentBlock, Message } from "./types";
import { Provider } from "./providers/provider";

// Context windows are configured per model in settings. This is only the
// fallback when a model entry is missing.
const DEFAULT_WINDOW = 128_000;
const COMPACT_THRESHOLD = 0.75;

const MIN_TAIL_MESSAGES = 2;
const MAX_TAIL_MESSAGES = 24;
const TAIL_WINDOW_FRACTION = 0.28;
const SUMMARY_INPUT_FRACTION = 0.45;
const SUMMARY_INPUT_MAX_CHARS = 180_000;
const SUMMARY_INPUT_MIN_CHARS = 16_000;

const TAIL_TEXT_LIMIT = 40_000;
const TAIL_TOOL_RESULT_LIMIT = 16_000;
const TAIL_TOOL_INPUT_LIMIT = 8_000;

// Reasoning models can spend a large chunk of max_tokens on hidden "thinking"
// before ever emitting the summary text. Keep this generous, then explicitly
// disable reasoning in the summary request below.
const SUMMARY_MAX_TOKENS = 2048;

const SUMMARY_SYSTEM =
  "Summarize this transcript, preserving files touched, decisions made, and remaining task state. Be terse.";

/** Fraction of the model's context window currently used (0..1). */
export function contextUsage(messages: Message[], system: string, window: number): number {
  return Math.min(1, estimateTokens(messages, system) / (window || DEFAULT_WINDOW));
}

function safeJson(value: unknown, fallback = ""): string {
  try {
    return JSON.stringify(value);
  } catch {
    return fallback;
  }
}

function compactString(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const head = Math.max(1, Math.floor(limit * 0.6));
  const tail = Math.max(1, limit - head);
  const omitted = text.length - head - tail;
  return `${text.slice(0, head)}\n[...trimmed ${omitted} chars...]\n${text.slice(-tail)}`;
}

function blockChars(block: ContentBlock): number {
  if (block.type === "text") return block.text.length;
  if (block.type === "image") return 2048;
  if (block.type === "tool_use") return safeJson(block.input, String(block.input)).length + block.name.length;
  if (block.type === "tool_result") return block.content.length;
  return 0;
}

/** Cheap chars/4 estimate. It is intentionally based on the actual retained
 * payload size, not UI-preview sizes, because compaction must trigger before
 * a large tool result blows the next provider request past the context limit.
 * Histories are append-only in normal flow, so the cache updates incrementally. */
const estCache = new WeakMap<Message[], { len: number; sys: number; chars: number }>();

export function estimateTokens(messages: Message[], system: string): number {
  const cached = estCache.get(messages);
  let chars: number;
  if (cached && cached.sys === system.length && cached.len <= messages.length) {
    chars = cached.chars;
    for (let i = cached.len; i < messages.length; i++)
      for (const b of messages[i].content) chars += blockChars(b);
  } else {
    chars = system.length;
    for (const m of messages) for (const b of m.content) chars += blockChars(b);
  }
  estCache.set(messages, { len: messages.length, sys: system.length, chars });
  return Math.ceil(chars / 4);
}

export function shouldCompact(messages: Message[], system: string, window: number): boolean {
  return estimateTokens(messages, system) > (window || DEFAULT_WINDOW) * COMPACT_THRESHOLD;
}

function tokenEstimate(messages: Message[]): number {
  let chars = 0;
  for (const m of messages) for (const b of m.content) chars += blockChars(b);
  return Math.ceil(chars / 4);
}

function trimTailBlock(block: ContentBlock): ContentBlock {
  if (block.type === "text") return { ...block, text: compactString(block.text, TAIL_TEXT_LIMIT) };
  if (block.type === "tool_result")
    return { ...block, content: compactString(block.content, TAIL_TOOL_RESULT_LIMIT) };
  if (block.type === "tool_use") {
    const json = safeJson(block.input);
    if (json.length <= TAIL_TOOL_INPUT_LIMIT) return block;
    return {
      ...block,
      input: {
        _trimmed: true,
        preview: compactString(json, TAIL_TOOL_INPUT_LIMIT),
      },
    };
  }
  return block;
}

function trimTailMessage(message: Message): Message {
  return { ...message, content: message.content.map(trimTailBlock) };
}

function hasToolResult(message: Message): boolean {
  return message.content.some((b) => b.type === "tool_result");
}

function chooseTail(messages: Message[], window: number): Message[] {
  const targetTokens = Math.max(2_000, Math.floor((window || DEFAULT_WINDOW) * TAIL_WINDOW_FRACTION));
  const tail: Message[] = [];
  let tokens = 0;
  let start = messages.length;

  for (let i = messages.length - 1; i >= 0 && tail.length < MAX_TAIL_MESSAGES; i--) {
    const trimmed = trimTailMessage(messages[i]);
    const nextTokens = tokenEstimate([trimmed]);
    if (tail.length >= MIN_TAIL_MESSAGES && tokens + nextTokens > targetTokens) break;
    tail.unshift(trimmed);
    tokens += nextTokens;
    start = i;
  }

  // Do not split an assistant tool_use from its following user tool_result.
  if (start > 0 && hasToolResult(messages[start])) tail.unshift(trimTailMessage(messages[start - 1]));

  return tail.length ? tail : messages.slice(-MIN_TAIL_MESSAGES).map(trimTailMessage);
}

function summaryBlockText(block: ContentBlock): string {
  if (block.type === "text") return block.text;
  if (block.type === "image") return "[image]";
  if (block.type === "tool_use")
    return `called ${block.name}(${compactString(safeJson(block.input, String(block.input)), 1200)})`;
  if (block.type === "tool_result")
    return `tool_result: ${compactString(block.content, 4000)}`;
  return "";
}

function serializeForSummary(messages: Message[], maxChars: number): string {
  const lines: string[] = [];
  for (const m of messages) {
    for (const b of m.content) {
      const text = summaryBlockText(b);
      if (text) lines.push(`${m.role}: ${text}`);
    }
  }
  const transcript = lines.join("\n");
  if (transcript.length <= maxChars) return transcript;

  const headChars = Math.floor(maxChars * 0.3);
  const tailChars = maxChars - headChars;
  const omitted = transcript.length - headChars - tailChars;
  return `${transcript.slice(0, headChars)}\n[...omitted ${omitted} chars before compaction...]\n${transcript.slice(-tailChars)}`;
}

/** Summarizes older messages into one synthetic assistant message, keeping a
 * recent tail by token budget. The retained tail is also trimmed so a single
 * huge command output cannot keep the next request oversized after compaction. */
export async function compact(
  messages: Message[],
  provider: Provider,
  model: string,
  signal: AbortSignal,
  window = DEFAULT_WINDOW,
): Promise<Message[]> {
  if (messages.length <= MIN_TAIL_MESSAGES) return messages;

  const tail = chooseTail(messages, window);
  const head = messages.slice(0, Math.max(0, messages.length - tail.length));
  if (!head.length) return tail;

  const maxTranscriptChars = Math.max(
    SUMMARY_INPUT_MIN_CHARS,
    Math.min(SUMMARY_INPUT_MAX_CHARS, Math.floor((window || DEFAULT_WINDOW) * 4 * SUMMARY_INPUT_FRACTION)),
  );
  const transcript = serializeForSummary(head, maxTranscriptChars);
  let summary = "";
  let errored = false;
  for await (const ev of provider.streamChat(
    {
      model,
      system: SUMMARY_SYSTEM,
      messages: [{ role: "user", content: [{ type: "text", text: transcript }] }],
      tools: [],
      maxTokens: SUMMARY_MAX_TOKENS,
      // Reasoning models can otherwise burn the entire summary budget on
      // hidden thinking and return no visible text.
      reasoningEffort: "none",
    },
    signal,
  )) {
    if (ev.type === "text_delta") summary += ev.text;
    else if (ev.type === "error") errored = true;
  }

  // If summarization errored or produced nothing, keep the full history rather
  // than replacing the head with an empty placeholder.
  if (errored || !summary.trim()) return messages;

  const summaryMsg: Message = {
    role: "assistant",
    content: [{ type: "text", text: `[Earlier conversation summary]\n${summary}` }],
  };
  return [summaryMsg, ...tail];
}
