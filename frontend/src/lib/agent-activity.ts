// Which terminal sessions the agent is driving right now. A session is
// "active" from the first tool that touches it until the agent's turn ends
// (released by owner in loop.ts) — a continuous working state, not a blink
// per action. While active the TerminalPane shows the overlay and blocks
// user input; the agent owns the terminal.

const active = new Map<string, Set<string>>();
const listeners = new Set<() => void>();

function notify() {
  listeners.forEach((fn) => fn());
}

export function acquireTerminal(termId: string, owner: string) {
  let owners = active.get(termId);
  if (!owners) {
    owners = new Set();
    active.set(termId, owners);
  }
  if (!owners.has(owner)) {
    owners.add(owner);
    notify();
  }
}

export function releaseTerminalsByOwner(owner: string) {
  let changed = false;
  for (const [termId, owners] of active) {
    if (owners.delete(owner)) {
      changed = true;
      if (owners.size === 0) active.delete(termId);
    }
  }
  if (changed) notify();
}

export function isTerminalActive(id: string): boolean {
  return active.has(id);
}

export function onTerminalActivityChange(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
