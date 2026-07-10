// Tauri → Wails shim for @tauri-apps/plugin-dialog. Ash uses `open` (file/dir
// picker) and `ask` (yes/no confirm). Both route to Tools methods on the Go
// side which call Wails runtime dialogs.
import * as Tools from "../../wailsjs/go/main/Tools";

export async function open(
  opts?: { directory?: boolean; multiple?: boolean; title?: string },
): Promise<string | string[] | null> {
  const title = opts?.title ?? "";
  const isDir = !!opts?.directory;
  const path = await Tools.OpenDialog(title, isDir).catch(() => "");
  return path || null;
}

export async function ask(
  message: string,
  opts?: { title?: string; kind?: string },
): Promise<boolean> {
  return Tools.Ask(message, opts?.title ?? "Confirm").catch(() => false);
}

export async function confirm(
  message: string,
  opts?: { title?: string },
): Promise<boolean> {
  return ask(message, opts);
}
