import { ContentBlock, Message } from "../types";
import { ParsedSession } from "./types";
import { flattenText } from "./common";

// Claude Code writes one JSON object per line to
// ~/.claude/projects/<cwd-hash>/<sessionId>.jsonl. Conversation entries are
// type "user"/"assistant" (Anthropic wire format); everything else (mode,
// permission-mode, file-history-snapshot, system, attachment, summary) is
// metadata we skip. Entries form a tree via parentUuid/uuid — edits/retries
// branch it, so we walk up from the active leaf to get the real thread.

interface Entry {
  type?: string;
  uuid?: string;
  parentUuid?: string | null;
  isSidechain?: boolean;
  isMeta?: boolean;
  timestamp?: string;
  cwd?: string;
  sessionId?: string;
  message?: { role?: string; content?: unknown };
}

function parseLines(text: string): Entry[] {
  const out: Entry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      out.push(JSON.parse(line));
    } catch {
      // a torn last line — ignore
    }
  }
  return out;
}

const isConvo = (e: Entry) =>
  (e.type === "user" || e.type === "assistant") &&
  !e.isSidechain &&
  !e.isMeta &&
  !!e.message;

/** Walk up parentUuid from the last conversation entry to root, collecting the
 * active branch (skipping metadata entries encountered along the way). */
function activeBranch(entries: Entry[]): Entry[] {
  const byUuid = new Map<string, Entry>();
  for (const e of entries) if (e.uuid) byUuid.set(e.uuid, e);

  let leaf: Entry | undefined;
  for (const e of entries) if (isConvo(e)) leaf = e; // last one in file order

  const chain: Entry[] = [];
  const seen = new Set<string>();
  let cur: Entry | undefined = leaf;
  while (cur && cur.uuid && !seen.has(cur.uuid)) {
    seen.add(cur.uuid);
    if (isConvo(cur)) chain.push(cur);
    cur = cur.parentUuid ? byUuid.get(cur.parentUuid) : undefined;
  }
  return chain.reverse();
}

function mapContent(role: string, content: unknown): ContentBlock[] {
  if (typeof content === "string") {
    const t = content.trim();
    return t ? [{ type: "text", text: content }] : [];
  }
  if (!Array.isArray(content)) return [];
  const out: ContentBlock[] = [];
  for (const b of content) {
    if (!b || typeof b !== "object") continue;
    const blk = b as Record<string, any>;
    switch (blk.type) {
      case "text":
        if (typeof blk.text === "string" && blk.text.trim())
          out.push({ type: "text", text: blk.text });
        break;
      case "tool_use":
        if (role === "assistant")
          out.push({ type: "tool_use", id: String(blk.id), name: String(blk.name), input: blk.input ?? {} });
        break;
      case "tool_result":
        out.push({
          type: "tool_result",
          toolUseId: String(blk.tool_use_id),
          content: flattenText(blk.content),
          isError: !!blk.is_error,
        });
        break;
      case "image": {
        const s = blk.source;
        if (s?.type === "base64" && s.data)
          out.push({ type: "image", dataUrl: `data:${s.media_type || "image/png"};base64,${s.data}` });
        break;
      }
      // "thinking" is intentionally dropped — Ash's history has no such block
    }
  }
  return out;
}

export function parseClaudeSession(text: string): ParsedSession {
  const entries = parseLines(text);
  const branch = activeBranch(entries);

  const messages: Message[] = [];
  for (const e of branch) {
    const role = e.message!.role === "assistant" ? "assistant" : "user";
    const content = mapContent(role, e.message!.content);
    if (content.length) messages.push({ role, content });
  }

  const cwd = branch.find((e) => e.cwd)?.cwd ?? entries.find((e) => e.cwd)?.cwd ?? "";
  const last = branch[branch.length - 1]?.timestamp;
  const updatedAt = last ? Date.parse(last) || 0 : 0;
  let title = "";
  for (const e of branch)
    if (e.message!.role === "user") {
      const t = flattenText(e.message!.content).trim();
      if (t && !t.startsWith("<")) {
        title = t;
        break;
      }
    }
  return { cwd, title, updatedAt, messages };
}
