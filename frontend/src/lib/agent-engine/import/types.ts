import { Message } from "../types";

export type ImportSource = "claude-code" | "pi";

// Lightweight listing entry — enough to render a row in the Search palette
// without fully parsing/mapping the whole session.
export interface ImportedSessionMeta {
  source: ImportSource;
  /** Absolute path of the source .jsonl file (also the cache key). */
  path: string;
  sessionId: string;
  cwd: string;
  /** First user prompt, trimmed — the row's display title. */
  title: string;
  /** Last activity, ms since epoch — used to sort newest-first. */
  updatedAt: number;
  /** User + assistant message count (excludes tool traffic + metadata). */
  msgCount: number;
}

// A fully parsed session: the mapped engine history ready to seed a chat.
export interface ParsedSession {
  cwd: string;
  title: string;
  updatedAt: number;
  messages: Message[];
}
