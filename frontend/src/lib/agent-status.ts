// Tiny cross-component store: AgentThread reports whether its pane is
// working/done, the Sidebar re-renders its tab icons off it. Keyed by the
// agent pane's leaf id (the same id AgentThread receives as a prop).

export type AgentStatus = "working" | "done";

const statuses = new Map<string, AgentStatus>();
const listeners = new Set<() => void>();

export function setAgentStatus(id: string, status: AgentStatus | null) {
  const prev = statuses.get(id);
  if (status === null) statuses.delete(id);
  else statuses.set(id, status);
  // unchanged status must not re-render every subscriber (the whole Sidebar)
  if (prev !== (status ?? undefined)) listeners.forEach((fn) => fn());
}

export function getAgentStatus(id: string): AgentStatus | undefined {
  return statuses.get(id);
}

export function onAgentStatusChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
