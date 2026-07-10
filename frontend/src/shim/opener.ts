// Tauri → Wails shim for @tauri-apps/plugin-opener. openUrl maps to Wails'
// BrowserOpenURL; openPath uses the Go Tools.OpenIn("explorer", …) to reveal
// a file / open a folder natively (Windows explorer.exe /select,).
import { BrowserOpenURL } from "../../wailsjs/runtime";
import * as Tools from "../../wailsjs/go/app/Tools";

export async function openUrl(url: string): Promise<void> {
  BrowserOpenURL(url);
}

export async function openPath(path: string): Promise<void> {
  // Reveal in explorer (is_dir=false → /select,path; true → open folder). We
  // don't know dir-ness here, so assume file → select; callers that pass a
  // dir are rare in Ash and the worst case is explorer opens the parent.
  await Tools.OpenIn("explorer", path, false);
}
