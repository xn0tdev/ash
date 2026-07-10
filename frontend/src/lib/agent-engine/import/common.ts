import { ContentBlock, Message } from "../types";

const TOOL_RESULT_CAP = 4000;

// Foreign tool names (Claude Code's Read/Write/…, Pi's read/bash/…) mapped to
// Ash's registry names so the transcript picks the right icon.
const KIND_ALIAS: Record<string, string> = {
  read: "read_file",
  read_file: "read_file",
  readfile: "read_file",
  write: "write_file",
  write_file: "write_file",
  writefile: "write_file",
  edit: "edit_file",
  edit_file: "edit_file",
  str_replace_editor: "edit_file",
  multiedit: "edit_file",
  bash: "bash",
  shell: "bash",
  grep: "grep",
  glob: "glob",
  ls: "glob",
  webfetch: "web_fetch",
  web_fetch: "web_fetch",
  fetch: "web_fetch",
};

export function normalizeKind(name: string): string {
  return KIND_ALIAS[name.toLowerCase()] ?? name.toLowerCase();
}

/** Flatten a Claude/Pi content value (string or block array) into plain text. */
export function flattenText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content))
    return content
      .map((b) =>
        typeof b === "string"
          ? b
          : b && typeof b === "object" && "text" in b
            ? String((b as { text: unknown }).text ?? "")
            : "",
      )
      .join("");
  return "";
}

/** Cap tool_result payloads so a big transcript doesn't blow the localStorage
 * quota — the tail of a huge file dump adds little context anyway. */
export function capToolResults(messages: Message[]): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content.map((b) =>
      b.type === "tool_result" && b.content.length > TOOL_RESULT_CAP
        ? { ...b, content: b.content.slice(0, TOOL_RESULT_CAP) + "\n… (truncated on import)" }
        : b,
    ),
  }));
}

/** Collapse consecutive same-role messages into one — the engine normally
 * emits a single assistant message carrying both text and tool_use blocks, but
 * Claude Code splits them across entries. Normalizing avoids two assistant
 * messages in a row (which stricter providers reject). Safe for pairing: no
 * tool_result ever sits between two same-role messages. */
export function mergeConsecutive(messages: Message[]): Message[] {
  const out: Message[] = [];
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content = [...prev.content, ...m.content];
    else out.push({ role: m.role, content: [...m.content] });
  }
  return out;
}

/** Make the history satisfy the provider's strict tool-call/result pairing:
 * drop tool_result blocks whose tool_use was pruned, and synthesize a
 * placeholder result for any tool_use left dangling (e.g. a truncated turn). */
export function ensureToolPairing(messages: Message[]): Message[] {
  const useIds = new Set<string>();
  const resultIds = new Set<string>();
  for (const m of messages)
    for (const b of m.content) {
      if (b.type === "tool_use") useIds.add(b.id);
      if (b.type === "tool_result") resultIds.add(b.toolUseId);
    }

  // 1) drop orphan tool_result blocks; drop messages left empty
  const cleaned: Message[] = [];
  for (const m of messages) {
    const content = m.content.filter(
      (b) => b.type !== "tool_result" || useIds.has(b.toolUseId),
    );
    if (content.length) cleaned.push({ role: m.role, content });
  }

  // 2) after every assistant tool_use with no result anywhere, insert one
  const out: Message[] = [];
  for (const m of cleaned) {
    out.push(m);
    if (m.role !== "assistant") continue;
    const missing = m.content.filter(
      (b): b is Extract<ContentBlock, { type: "tool_use" }> =>
        b.type === "tool_use" && !resultIds.has(b.id),
    );
    if (missing.length)
      out.push({
        role: "user",
        content: missing.map((t) => ({
          type: "tool_result" as const,
          toolUseId: t.id,
          content: "(tool result not saved on import)",
          isError: false,
        })),
      });
  }
  return out;
}

function describeImportedTool(name: string, input: unknown): string {
  const a = (input ?? {}) as Record<string, unknown>;
  const detail =
    a.file_path ?? a.path ?? a.command ?? a.pattern ?? a.query ?? a.url ?? a.prompt;
  if (detail) return String(detail).slice(0, 140);
  return name;
}

/** Rebuild AgentThread's visible transcript (Item[]) from mapped history, so
 * an imported chat opens showing the past conversation, not a blank pane. The
 * Item shape is mirrored as plain objects to avoid a UI import cycle. */
export function buildTranscriptItems(messages: Message[]): unknown[] {
  const items: unknown[] = [];
  const uid = () => crypto.randomUUID();
  for (const m of messages) {
    for (const b of m.content) {
      if (b.type === "text") {
        const text = b.text.trim();
        if (!text) continue;
        items.push({ k: m.role === "user" ? "user" : "text", id: uid(), text });
      } else if (b.type === "tool_use") {
        items.push({
          k: "tool",
          id: uid(),
          toolId: b.id,
          title: describeImportedTool(b.name, b.input),
          status: "completed",
          kind: normalizeKind(b.name),
        });
      }
      // tool_result / image blocks stay in history but aren't separate rows
    }
  }
  return items;
}

/** First non-empty user text across the mapped messages → the chat's title. */
export function deriveTitle(messages: Message[]): string {
  for (const m of messages)
    if (m.role === "user")
      for (const b of m.content)
        if (b.type === "text") {
          const t = b.text.trim();
          if (t) return t.length > 60 ? t.slice(0, 60) + "…" : t;
        }
  return "Imported chat";
}
