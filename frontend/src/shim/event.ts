// Tauri → Wails shim for @tauri-apps/api/event `listen`. Wails' EventsOn
// already provides the subscription; we wrap it to match Tauri's
// listen<T>(name, cb) → Promise<UnlistenFn> shape, where the callback receives
// { event, payload } (Wails calls back with the payload directly).
import { EventsOn, EventsOff } from "../../wailsjs/runtime";

export interface Event<T> {
  event: string;
  payload: T;
}

export function listen<T>(eventName: string, handler: (event: Event<T>) => void): Promise<() => void> {
  // Wails passes payload args straight through; Tauri wraps them in {payload}.
  const cb = (payload: T) => handler({ event: eventName, payload });
  EventsOn(eventName, cb);
  return Promise.resolve(() => EventsOff(eventName));
}

export async function emit(eventName: string, payload?: unknown): Promise<void> {
  // Wails runtime has EventsEmit but Ash's frontend never emits backend-bound
  // events, so this is a best-effort pass-through.
  const { EventsEmit } = await import("../../wailsjs/runtime");
  EventsEmit(eventName, payload);
}
