import { Message, NormalizedEvent, ToolSchema } from "../types";

export interface StreamRequest {
  model: string;
  system: string;
  messages: Message[];
  tools: ToolSchema[];
  maxTokens: number;
  /** reasoning_effort to send; "auto" (or undefined) sends nothing. */
  reasoningEffort?: string;
  /** When false, image blocks are stripped so a text-only model doesn't 400. */
  supportsImages?: boolean;
}

// The provider-agnostic contract loop.ts talks to. Every provider adapts its
// own wire format into NormalizedEvent so the loop never branches on which
// provider is active.
export interface Provider {
  id: string;
  streamChat(req: StreamRequest, signal: AbortSignal): AsyncGenerator<NormalizedEvent, void, unknown>;
}
