// Tauri → Wails shim for @tauri-apps/api/path. Ash only uses homeDir(); the
// Go side (Fs.HomeDir) returns it. The other path helpers are unused but kept
// as thin wrappers so any importer compiles.
import * as Fs from "../../wailsjs/go/main/Fs";

export async function homeDir(): Promise<string> {
  return Fs.HomeDir();
}

export async function appDataDir(): Promise<string> {
  const h = await Fs.HomeDir();
  return h.replace(/[\\/]+$/, "") + "\\.ash";
}

export async function appConfigDir(): Promise<string> {
  return appDataDir();
}

export const sep = "\\";
