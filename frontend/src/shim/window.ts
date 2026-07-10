// Tauri → Wails shim for @tauri-apps/api/window. Emulates the Window object
// returned by getCurrentWindow() using @wailsio/runtime window functions.
import {
  WindowIsMaximised,
  WindowMinimise,
  WindowToggleMaximise,
  WindowSetSize,
  Quit,
  EventsOn,
  EventsOff,
} from "../../wailsjs/runtime";

export interface Window {
  isMaximized(): Promise<boolean>;
  minimize(): Promise<void>;
  toggleMaximize(): Promise<void>;
  close(): Promise<void>;
  destroy(): void;
  setSize(width: number, height: number): Promise<void>;
  onCloseRequested(handler: (e: { preventDefault: () => void }) => void): Promise<() => void>;
  onResized(handler: () => void): Promise<() => void>;
  //listen convenience for the few callers that use it
}

// Tauri's onCloseRequested is a preventable close. Wails has no direct equiv
// in the runtime, so we synthesize it from a custom event "app:close-requested"
// the app can emit; the handler calls preventDefault() to keep the window. For
// the Ash clear-on-exit feature we'll wire this up properly later. For now
// close() goes straight to Quit().

export function getCurrentWindow(): Window {
  return {
    async isMaximized() {
      return WindowIsMaximised();
    },
    async minimize() {
      WindowMinimise();
    },
    async toggleMaximize() {
      WindowToggleMaximise();
    },
    async close() {
      Quit();
    },
    destroy() {
      Quit();
    },
    async setSize(width: number, height: number) {
      WindowSetSize(width, height);
    },
    async onCloseRequested(handler) {
      const cb = () => {
        let prevented = false;
        handler({ preventDefault: () => { prevented = true; } });
        if (!prevented) Quit();
      };
      EventsOn("app:close-requested", cb);
      return () => EventsOff("app:close-requested");
    },
    async onResized(handler) {
      EventsOn("wails:window:resize", handler);
      // also fire on maximise/unmaximise which Wails emits separately
      EventsOn("wails:window:maximise", handler);
      EventsOn("wails:window:unmaximise", handler);
      return () => {
        EventsOff("wails:window:resize");
        EventsOff("wails:window:maximise");
        EventsOff("wails:window:unmaximise");
      };
    },
  };
}
