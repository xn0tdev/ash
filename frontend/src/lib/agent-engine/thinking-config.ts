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
// the model id stem. Unknown families fall back to the OpenAI-compat default
// (reasoning_effort + reasoning_content), which is the most widely accepted
// shape across proxy/compat APIs.

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
// Ordered longest-prefix-first where overlap exists. Matched case-insensitively
// on `family === prefix` or `family.startsWith(prefix + "-")`.
const FAMILY_THINKING: { prefix: string; spec: ThinkingSpec }[] = [
  // GLM — Zhipu uses enable_thinking natively; through OpenAI-compat proxies
  // reasoning_effort is often forwarded too, but enable_thinking is the
  // canonical shape that actually flips the model's thinking on/off.
  { prefix: "glm", spec: enableThinking },

  // Claude — Anthropic's thinking object; through compat proxies that forward
  // it (OpenRouter etc.). Falls back to reasoning_content in the stream.
  { prefix: "claude", spec: thinkingObject },

  // OpenAI o-series + GPT-5 — reasoning_effort is the native param.
  { prefix: "gpt", spec: reasoningEffort },
  { prefix: "o", spec: reasoningEffort },
  { prefix: "codex", spec: reasoningEffort },

  // Grok — xAI accepts reasoning_effort through compat.
  { prefix: "grok", spec: reasoningEffort },

  // DeepSeek — R1/thinking models stream reasoning_content natively; the
  // param isn't needed (they think by default), so nativeThinking.
  { prefix: "deepseek", spec: nativeThinking },

  // Gemini — through compat proxies, reasoning_effort is typically forwarded.
  { prefix: "gemini", spec: reasoningEffort },

  // Mistral / Qwen / Kimi / Minimax / Llama — reasoning_effort is the most
  // widely accepted compat shape; if a model doesn't support it, the proxy
  // ignores the unknown field rather than erroring.
  { prefix: "mistral", spec: reasoningEffort },
  { prefix: "mixtral", spec: reasoningEffort },
  { prefix: "kimi", spec: reasoningEffort },
  { prefix: "minimax", spec: reasoningEffort },
  { prefix: "qwen", spec: reasoningEffort },
  { prefix: "llama", spec: reasoningEffort },
];

const DEFAULT_SPEC = reasoningEffort;

/** Resolve the thinking spec for a model family. Falls back to the OpenAI-compat
 *  default (reasoning_effort + reasoning_content) for unknown families. */
export function thinkingSpecForFamily(family: string): ThinkingSpec {
  const f = family.trim().toLowerCase();
  if (f) {
    for (const { prefix, spec } of FAMILY_THINKING) {
      if (f === prefix || f.startsWith(prefix + "-")) return spec;
    }
  }
  return DEFAULT_SPEC;
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
