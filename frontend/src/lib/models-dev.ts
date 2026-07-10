// Integration with models.dev (https://models.dev/api.json): look up a model's
// context window, image support, and provider logo by its API model id, so the
// model editor can auto-fill those instead of the user hand-entering them.
//
// api.json is keyed by provider id → { id, name, models }, and each model is
// { id, name, attachment, modalities: { input: [...] }, limit: { context } }.
// Provider logos live at https://models.dev/logos/<provider>.svg.

export interface ModelInfo {
  /** models.dev bare model id, e.g. "claude-opus-4-5". */
  id: string;
  /** Display name, e.g. "Claude Opus 4.5 (latest)". */
  name: string;
  /** Provider id (drives the logo URL), e.g. "anthropic". */
  provider: string;
  /** Context window in tokens (limit.context). */
  contextWindow: number;
  /** modalities.input includes "image". */
  supportsImages: boolean;
}

const API = "https://models.dev/api.json";
const CACHE_KEY = "ash.modelsDev";
const TTL_MS = 24 * 60 * 60 * 1000; // refetch at most once a day

let catalog: ModelInfo[] | null = null;
let inflight: Promise<ModelInfo[]> | null = null;

function parse(json: Record<string, unknown>): ModelInfo[] {
  const out: ModelInfo[] = [];
  for (const [provId, provRaw] of Object.entries(json)) {
    const prov = provRaw as { id?: string; models?: Record<string, unknown> };
    const models = prov?.models;
    if (!models || typeof models !== "object") continue;
    const provider = String(prov.id ?? provId);
    for (const [mid, raw] of Object.entries(models)) {
      const m = raw as {
        id?: string;
        name?: string;
        attachment?: boolean;
        modalities?: { input?: unknown };
        limit?: { context?: unknown };
      };
      const ctx = m?.limit?.context;
      if (typeof ctx !== "number") continue;
      const input = m?.modalities?.input;
      const supportsImages = Array.isArray(input)
        ? input.includes("image")
        : m?.attachment === true;
      out.push({
        id: String(m?.id ?? mid),
        name: String(m?.name ?? mid),
        provider,
        contextWindow: ctx,
        supportsImages,
      });
    }
  }
  return out;
}

/** Load + cache the models.dev catalog (localStorage, 24h TTL; in-memory once
 * fetched). Safe to call repeatedly. Rejects if offline / the fetch fails. */
export function loadModelsDev(): Promise<ModelInfo[]> {
  if (catalog) return Promise.resolve(catalog);
  if (inflight) return inflight;

  inflight = (async () => {
    // A fresh-enough localStorage copy avoids a network hit every launch.
    try {
      const raw = localStorage.getItem(CACHE_KEY);
      if (raw) {
        const { at, data } = JSON.parse(raw) as { at?: number; data?: unknown };
        if (typeof at === "number" && Date.now() - at < TTL_MS && Array.isArray(data)) {
          catalog = data as ModelInfo[];
          return catalog;
        }
      }
    } catch {
      // ignore a corrupt cache
    }
    const res = await fetch(API);
    if (!res.ok) throw new Error(`models.dev HTTP ${res.status}`);
    const parsed = parse(await res.json());
    catalog = parsed;
    try {
      localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), data: parsed }));
    } catch {
      // localStorage full/unavailable — the in-memory cache still serves this session
    }
    return parsed;
  })();
  // Allow a retry after a transient failure (offline at launch, etc.).
  inflight.catch(() => {
    inflight = null;
  });
  return inflight;
}

const lastSeg = (s: string) => s.split("/").pop() || s;

/** Look up a model by API model id in the loaded catalog. Tries exact id, then
 * the last path segment (so "accounts/fireworks/models/kimi-k2" matches
 * "kimi-k2"), then the display name. Returns null if not loaded or no match. */
export function lookupModel(modelId: string | undefined): ModelInfo | null {
  const q = modelId?.trim().toLowerCase();
  if (!catalog || !q) return null;
  const qs = lastSeg(q);
  return (
    catalog.find((m) => m.id.toLowerCase() === q) ??
    catalog.find((m) => lastSeg(m.id.toLowerCase()) === qs) ??
    catalog.find((m) => m.name.toLowerCase() === q) ??
    null
  );
}

/** Provider logo URL (SVG). Loads cross-origin fine in an <img> (no CORS need). */
export function providerLogo(provider: string): string {
  return `https://models.dev/logos/${provider}.svg`;
}

/** The stored logo, or a live one resolved from the loaded catalog. */
export function modelLogo(model: { modelId: string; logo?: string }): string | undefined {
  if (model.logo) return model.logo;
  const info = lookupModel(model.modelId);
  return info ? providerLogo(info.provider) : undefined;
}
