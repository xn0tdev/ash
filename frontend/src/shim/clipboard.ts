// Tauri → Wails shim for @tauri-apps/plugin-clipboard-manager. Routes to the
// Go Tools.ClipboardGetText/SetText (Wails runtime clipboard).
import * as Tools from "../../wailsjs/go/main/Tools";

export async function readText(): Promise<string> {
  return Tools.ClipboardGetText().catch(() => "");
}

export async function writeText(text: string): Promise<void> {
  await Tools.ClipboardSetText(text).catch(() => {});
}
