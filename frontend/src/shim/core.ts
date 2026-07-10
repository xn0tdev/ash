// Tauri → Wails shim: emulates @tauri-apps/api/core `invoke` so the ~30 files
// that call invoke("read_text", { path }) keep working unchanged. Each command
// routes to the corresponding Go binding method (auto-generated in
// frontend/wailsjs/go/main/*). Wails bindings are async and return Promises,
// matching invoke()'s contract.
import * as Fs from "../../wailsjs/go/main/Fs";
import * as Git from "../../wailsjs/go/main/Git";
import * as Tools from "../../wailsjs/go/main/Tools";
import * as Sandbox from "../../wailsjs/go/main/Sandbox";
import * as Pty from "../../wailsjs/go/main/Pty";
import * as Updater from "../../wailsjs/go/main/Updater";
import * as AppBinding from "../../wailsjs/go/main/App";

// invoke<T>(cmd, args) → Promise<T>. Args is a flat object (Tauri convention);
// Wails binding methods take positional args, so each case maps the named
// fields to the method call.
export function invoke<T = unknown>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  switch (cmd) {
    // ── fs ───────────────────────────────────────────────────
    case "read_text":
      // Tauri returns string | null; our binding returns *string (Wails treats
      // nil pointer as null in JSON).
      return Fs.ReadText(args?.path as string) as Promise<T>;
    case "write_text":
      return Fs.WriteText(args?.path as string, args?.contents as string) as Promise<T>;
    case "delete_path":
      return Fs.DeletePath(args?.path as string) as Promise<T>;
    case "list_dir":
      return (Fs.ListDir(args?.path as string) as Promise<unknown[]>).then(
        (r) => (r ?? []) as unknown as T,
      );

    // ── git ──────────────────────────────────────────────────
    case "git_branch":
      return Git.Branch(args?.dir as string) as Promise<T>;
    case "git_status":
      return Git.Status(args?.dir as string) as Promise<T>;
    case "git_diff_stat":
      return Git.DiffStat(args?.dir as string) as Promise<T>;

    // ── tools ────────────────────────────────────────────────
    case "detect_bins":
      return Tools.DetectBins(args?.names as string[]).then(
        (r: string[] | null) => (r ?? []) as unknown as T,
      );
    case "ssh_hosts":
      return Tools.SshHosts().then((r: string[] | null) => (r ?? []) as unknown as T);
    case "open_in":
      return Tools.OpenIn(args?.app as string, args?.path as string, args?.isDir as boolean) as Promise<T>;
    case "resolve_bash":
      return Promise.resolve(Tools.ResolveBash() as unknown as T);
    case "find_editors":
      return Tools.FindEditors().then((r: string[] | null) => (r ?? []) as unknown as T);

    // ── pty ──────────────────────────────────────────────────
    case "pty_spawn":
      return Pty.PtySpawn(
        args?.id as string,
        args?.cols as number,
        args?.rows as number,
        (args?.cwd as string | null) ?? "",
        (args?.program as string | null) ?? "",
        (args?.args as string[] | null) ?? [],
      ) as Promise<T>;
    case "pty_write":
      return Pty.PtyWrite(args?.id as string, args?.data as string) as Promise<T>;
    case "pty_resize":
      return Pty.PtyResize(args?.id as string, args?.cols as number, args?.rows as number) as Promise<T>;
    case "pty_kill":
      return Pty.PtyKill(args?.id as string) as Promise<T>;

    // ── updater (self-update against GitHub Releases) ────────
    case "check_update":
      return Updater.CheckUpdate() as Promise<T>;
    case "download_update":
      return Updater.DownloadUpdate() as Promise<T>;
    case "apply_update":
      return Updater.ApplyUpdate(args?.path as string) as Promise<T>;
    case "restart_app":
      return Updater.Restart() as Promise<T>;
    case "app_info":
      // AppInfo is on the root App binding, not Updater.
      return AppBinding.AppInfo() as unknown as Promise<T>;

    // ── sandbox (stubbed — returns the error Go sends) ───────
    case "sandbox_copy":
      return Sandbox.Copy(args?.source as string) as Promise<T>;
    case "sandbox_changes":
      return (Sandbox.Changes(args?.sandbox as string, args?.project as string) as Promise<unknown[]>).then(
        (r) => (r ?? []) as unknown as T,
      );
    case "sandbox_merge":
      return Sandbox.Merge(args?.sandbox as string, args?.project as string, args?.files as string[]) as Promise<T>;
    case "sandbox_remove":
      return Sandbox.Remove(args?.sandbox as string) as Promise<T>;

    default:
      return Promise.reject(new Error(`invoke: unshimmed command "${cmd}"`));
  }
}

export function convertFileSrc(filePath: string): string {
  // Tauri's asset URL scheme — not used meaningfully in Ash's frontend, but
  // kept as a no-op pass-through so any importer compiles.
  return filePath;
}
