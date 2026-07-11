// Shared shapes for the engine. Modeled closely on Anthropic's wire format
// (system is a separate field, not a message) so providers/anthropic.ts is
// close to a passthrough; providers/openai-compat.ts does the one real
// adapter into OpenAI's messages/tool_calls/role:"tool" shape.

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "image"; dataUrl: string }
  | { type: "tool_use"; id: string; name: string; input: unknown }
  | { type: "tool_result"; toolUseId: string; content: string; isError?: boolean };

export interface Message {
  role: "user" | "assistant";
  content: ContentBlock[];
}

// Normalized stream events every provider adapts into. loop.ts only ever
// sees this shape, never a provider's raw wire format.
export type NormalizedEvent =
  | { type: "text_delta"; text: string }
  | { type: "thought_delta"; text: string }
  | { type: "tool_call_start"; id: string; name: string }
  | { type: "tool_call_delta"; id: string; argsDelta: string }
  | { type: "tool_call_end"; id: string; name: string; args: unknown }
  | { type: "message_stop"; stopReason: "end_turn" | "tool_use" | "max_tokens" | "error" }
  | { type: "error"; message: string };

export interface JsonSchemaProperty {
  type: string;
  description?: string;
  enum?: string[];
  items?: JsonSchemaProperty;
}

export interface JsonSchema {
  type: "object";
  properties: Record<string, JsonSchemaProperty>;
  required?: string[];
}

// Shared between tools/registry.ts (assembles these from each Tool) and
// providers/provider.ts (sends them to the model as the function-calling
// schema) — defined once here to avoid a circular import between the two.
export interface ToolSchema {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface SafetyContext {
  /** Canonical sandbox root. Agent file tools must stay below this path. */
  root: string;
  /** Main chats can turn a risky operation into an explicit user approval. */
  interactive: boolean;
}

export interface ToolContext {
  cwd: string;
  signal: AbortSignal;
  /** Agent pane id — background sessions it spawns are tagged with this. */
  ownerId?: string;
  /** Safe mode: open the sandbox review/merge UI for the user. Present only on
   * the main chat session (undefined for background agents). */
  reviewMerge?: () => void;
  /** Present only for Safe mode sessions and inherited by child agents. */
  safety?: SafetyContext;
}

export interface ToolResult {
  ok: boolean;
  output: string;
}

// Defined here (not in tools/registry.ts) so individual tool files can import
// it without a circular dependency on the registry that assembles them.
export interface Tool {
  name: string;
  description: string;
  parameters: JsonSchema;
  run(args: any, ctx: ToolContext): Promise<ToolResult>;
}
