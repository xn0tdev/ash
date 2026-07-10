import { EnginePermissionMode, EngineProvider, getSettings, ReasoningEffort } from "../settings";
import { OpenAICompatProvider } from "./providers/openai-compat";
import { Provider } from "./providers/provider";

export interface ResolvedEngineConfig {
  provider: Provider;
  model: string;
  /** Active model's context window in tokens (battery gauge + compaction). */
  contextWindow: number;
  /** Whether the active model accepts image inputs. */
  supportsImages: boolean;
  permissionMode: EnginePermissionMode;
  /** Default reasoning depth for a new session (UI can change it per-chat). */
  reasoningEffort: ReasoningEffort;
}

/** Build a Provider adapter for a configured provider entry. Exported so the
 * chat can swap the live session's provider when the user picks a model that
 * lives under a different endpoint (every provider is OpenAI-compatible, so
 * the same adapter serves them all). */
export function providerInstance(p: EngineProvider): Provider {
  return new OpenAICompatProvider(p.baseUrl, p.apiKey);
}

/** Reads settings.ts and resolves the active provider + model into a Provider. */
export function resolveEngineConfig(): ResolvedEngineConfig {
  const s = getSettings().engine;
  const prov = s.providers.find((p) => p.id === s.activeProviderId) ?? s.providers[0];
  if (!prov) throw new Error("No provider configured — add one in Settings > Agents.");
  if (!prov.apiKey)
    throw new Error(`No API key set for "${prov.name}" — add one in Settings > Agents.`);
  const active = prov.models.find((m) => m.id === s.activeModelId) ?? prov.models[0];
  if (!active)
    throw new Error(`No model configured for "${prov.name}" — add one in Settings > Agents.`);

  return {
    provider: providerInstance(prov),
    model: s.useFast && active.fastId ? active.fastId : active.modelId,
    contextWindow: active.contextWindow,
    supportsImages: active.supportsImages,
    permissionMode: s.permissionMode,
    reasoningEffort: s.reasoningEffort,
  };
}
