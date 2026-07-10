// Background terminal sessions started by the agent (dev servers, watchers).
// The PTY + xterm session lives in term.ts as usual; this store only tracks
// which session ids are "background" so the sidebar can list them and the
// app knows not to kill them when a viewing tab closes.

export interface BackgroundTerm {
  id: string;
  title: string;
  /** Agent pane that spawned it — its sessions nest under that chat in the sidebar. */
  ownerId?: string;
}

const terms: BackgroundTerm[] = [];
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function addBackgroundTerm(term: BackgroundTerm) {
  terms.push(term);
  notify();
}

export function removeBackgroundTerm(id: string) {
  const i = terms.findIndex((t) => t.id === id);
  if (i >= 0) {
    terms.splice(i, 1);
    notify();
  }
}

export function isBackgroundTerm(id: string): boolean {
  return terms.some((t) => t.id === id);
}

export function getBackgroundTerms(): readonly BackgroundTerm[] {
  return terms;
}

export function onBackgroundTermsChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Match a session by exact id/title first. Substring matching is allowed only
 * when it is unique; otherwise the caller should ask for a clearer session. */
export function findBackgroundTerm(query: string): BackgroundTerm | undefined {
  const q = query.trim();
  if (!q) return undefined;
  const exactId = terms.find((t) => t.id === q);
  if (exactId) return exactId;

  const lower = q.toLowerCase();
  const exactTitle = terms.find((t) => t.title.toLowerCase() === lower);
  if (exactTitle) return exactTitle;

  const matches = terms.filter((t) => t.title.toLowerCase().includes(lower));
  return matches.length === 1 ? matches[0] : undefined;
}
