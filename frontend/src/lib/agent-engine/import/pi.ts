import { ContentBlock, Message } from "../types";
import { ParsedSession } from "./types";
import { flattenText } from "./common";

// Pi (badlogic/pi) writes one JSON object per line to
// ~/.pi/agent/sessions/<cwd-hash>/<ts>_<id>.jsonl. Conversation lines are
// type "message" with message.role user | assistant | toolResult; everything
// else (session, model_change, thinking_level_change, custom_message) is
// metadata. Entries thread via id/parentId.

interface Entry {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  message?: {
    role?: string;
    content?: unknown;
    toolCallId?: string;
    isError?: boolean;
  };
}

function parseLines(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // torn last line — ignore
    }
  }
  return out;
}

const isMsg = (e: Entry) => e.type === "message" && !!e.message?.role;

function activeBranch(entries: Entry[]): Entry[] {
  const byId = new Map<string, Entry>();
  for (const e of entries) if (e.id) byId.set(e.id, e);

  let leaf: Entry | undefined;
  for (const e of entries) if (isMsg(e)) leaf = e;

  const chain: Entry[] = [];
  const seen = new Set<string>();
  let cur: Entry | undefined = leaf;
  while (cur && cur.id && !seen.has(cur.id)) {
    seen.add(cur.id);
    if (isMsg(cur)) chain.push(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain.reverse();
}

function mapAssistantOrUser(role: "user" | "assistant", content: unknown): ContentBlock[] {
  if (!Array.isArray(content)) {
    const t = flattenText(content).trim();
    return t ? [{ type: "text", text: flattenText(content) }] : [];
  }
  const out: ContentBlock[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const blk = b as Record<string, any>;
    if (blk.type === "text" && typeof blk.text === "string" && blk.text.trim())
      out.push({ type: "text", text: blk.text });
    else if (blk.type === "toolCall" && role === "assistant")
      out.push({ type: "tool_use", id: String(blk.id), name: String(blk.name), input: blk.arguments ?? {} });
    // "thinking" dropped
  }
  return out;
}

export function parsePiSession(text: string): ParsedSession {
  const entries = parseLines(text);
  const branch = activeBranch(entries);

  const messages: Message[] = [];
  for (const e of branch) {
    const m = e.message!;
    if (m.role === "toolResult") {
      messages.push({
        role: "user",
        content: [
          {
            type: "tool_result",
            toolUseId: String(m.toolCallId),
            content: flattenText(m.content),
            isError: !!m.isError,
          },
        ],
      });
      continue;
    }
    const role = m.role === "assistant" ? "assistant" : "user";
    const content = mapAssistantOrUser(role, m.content);
    if (content.length) messages.push({ role, content });
  }

  const cwd = entries.find((e) => e.type === "session" && e.cwd)?.cwd ?? "";
  const last = branch[branch.length - 1]?.timestamp;
  const updatedAt = last ? Date.parse(last) || 0 : 0;
  let title = "";
  for (const e of branch)
    if (e.message!.role === "user") {
      // Pi injects skill/system blocks as the first user turns — skip those.
      const t = flattenText(e.message!.content).trim();
      if (t && !t.startsWith("<")) {
        title = t;
        break;
      }
    }
  return { cwd, title, updatedAt, messages };
}
