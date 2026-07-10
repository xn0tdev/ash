import type { ReasoningEffort } from "../settings";

// Per-model-family thinking configuration. Different APIs enable and stream
// "thinking" differently — sending the wrong param (e.g. reasoning_effort to a
// model that uses enable_thinking) is either ignored (fake value that does
// nothing) or rejected. This registry maps each model family to:
//  - `encode(effort)`: the body fields to merge so thinking is actually enabled
//    at the requested depth (or disabled). Returns null = send nothing (model
//    uses its native default / doesn't support thinking).
//  - `streamFields`: the SSE delta field name(s) that carry thought content, so
//    the provider surfaces them as thought_delta instead of final text.
//
// The family is resolved from models.dev (see models-dev.ts) or inferred from
// the model id stem. Unknown/proxy-hosted families fall back to native/no-param:
// many OpenAI-compatible gateways reject or mis-handle reasoning params, which
// can produce Thought-only turns with no tool calls.

export interface ThinkingSpec {
  /** Body fields to merge for the requested effort. null = send nothing. */
  encode: (effort: ReasoningEffort) => Record<string, unknown> | null;
  /** Delta field name(s) in the stream that carry thought content. */
  streamFields: string[];
}

// ── encoders ──────────────────────────────────────────────

/** reasoning_effort: string — OpenAI o-series + most compat proxies. */
const reasoningEffort: ThinkingSpec = {
  encode: (effort) =>
    effort === "auto" ? null : { reasoning_effort: effort === "none" ? "none" : effort },
  streamFields: ["reasoning_content", "reasoning"],
};

/** enable_thinking: boolean — Zhipu/GLM native API shape. */
const enableThinking: ThinkingSpec = {
  encode: (effort) => {
    if (effort === "auto") return null;
    // GLM's enable_thinking is a boolean; depth isn't granular — map
    // none→false, anything else→true. The model handles intensity natively.
    return { enable_thinking: effort !== "none" };
  },
  streamFields: ["reasoning_content", "thinking"],
};

/** thinking: { type: "enabled"|"disabled" } — Anthropic-style (through compat
 *  proxies that forward it). budget_tokens could be added but most compat
 *  layers ignore it, so we keep it minimal. */
const thinkingObject: ThinkingSpec = {
  encode: (effort) => {
    if (effort === "auto") return null;
    return { thinking: { type: effort === "none" ? "disabled" : "enabled" } };
  },
  streamFields: ["thinking", "reasoning_content"],
};

/** No thinking param — the model thinks natively (or doesn't support it).
 *  We still watch for reasoning_content in the stream in case it streams
 *  thoughts without being asked. */
const nativeThinking: ThinkingSpec = {
  encode: () => null,
  streamFields: ["reasoning_content", "reasoning", "thinking"],
};

// ── family → spec registry ────────────────────────────────
// DEFAULT is native/no-param — safest for agent loops on OpenAI-compatible
// proxies. Some gateways accept reasoning_effort but then stream only
// reasoning_content and never call tools. Models/endpoints that really support a
// thinking param can override it per-model in Settings > Agents > Models > Edit.
const FAMILY_THINKING: { prefix: string; spec: ThinkingSpec }[] = [
  // OpenAI o-series + GPT-5 — reasoning_effort is the native param.
  { prefix: "gpt", spec: reasoningEffort },
  { prefix: "o", spec: reasoningEffort },
  { prefix: "codex", spec: reasoningEffort },

  // Grok — xAI accepts reasoning_effort through compat.
  { prefix: "grok", spec: reasoningEffort },

  // DeepSeek — R1/thinking models stream reasoning_content natively; the
  // param isn't needed (they think by default), so nativeThinking.
  { prefix: "deepseek", spec: nativeThinking },

  // GLM / Claude / Gemini / Mistral / Qwen / Kimi / Minimax / Llama are often
  // served through compat proxies with different/restricted schemas; do not
  // send a reasoning param by default. If a specific endpoint supports one, set
  // it explicitly per-model in Settings.
  { prefix: "glm", spec: nativeThinking },
  { prefix: "claude", spec: nativeThinking },
  { prefix: "gemini", spec: nativeThinking },
  { prefix: "mistral", spec: nativeThinking },
  { prefix: "mixtral", spec: nativeThinking },
  { prefix: "kimi", spec: nativeThinking },
  { prefix: "minimax", spec: nativeThinking },
  { prefix: "qwen", spec: nativeThinking },
  { prefix: "llama", spec: nativeThinking },
];

const DEFAULT_SPEC = nativeThinking;

/** Thinking format ids, stable for persistence in EngineModel.thinkingFormat. */
export type ThinkingFormat = "reasoning_effort" | "enable_thinking" | "thinking_object" | "native";

const FORMAT_SPEC: Record<ThinkingFormat, ThinkingSpec> = {
  reasoning_effort: reasoningEffort,
  enable_thinking: enableThinking,
  thinking_object: thinkingObject,
  native: nativeThinking,
};

/** Resolve the thinking spec from an explicit per-model format override, or
 *  fall back to the family heuristic. */
export function thinkingSpecForModel(modelId: string, format?: ThinkingFormat): ThinkingSpec {
  if (format) return FORMAT_SPEC[format] ?? DEFAULT_SPEC;
  return thinkingSpecForModelId(modelId);
}

/** Heuristic on a model id when the family isn't known yet (catalog not
 *  loaded). The family prefixes double as id stems. */
export function thinkingSpecForModelId(modelId: string): ThinkingSpec {
  const id = modelId.toLowerCase();
  for (const { prefix, spec } of FAMILY_THINKING) {
    if (id === prefix || id.includes(prefix + "-") || id.includes("/" + prefix))
      return spec;
  }
  return DEFAULT_SPEC;
}
