import type { SafetyContext } from "../types";

function isAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

/** Normalize a Windows-style path lexically without asking the host filesystem.
 * Sandbox copies never contain symlinks, so this is sufficient for agent tool
 * paths; the backend repeats validation for every merge path. */
function normalize(path: string): string {
  const slashPath = path.replace(/\\/g, "/");
  const drive = /^[a-zA-Z]:/.exec(slashPath)?.[0] ?? "";
  const rest = drive ? slashPath.slice(drive.length) : slashPath;
  const parts: string[] = [];
  for (const part of rest.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      if (parts.length) parts.pop();
      else parts.push("..");
      continue;
    }
    parts.push(part);
  }
  const prefix = drive ? `${drive}/` : slashPath.startsWith("/") ? "/" : "";
  return `${prefix}${parts.join("/")}` || prefix || ".";
}

/** Resolve a caller path against the agent's working directory. */
export function resolveInCwd(cwd: string, path: string): string {
  if (!path || isAbsolute(path)) return normalize(path);
  return normalize(`${cwd.replace(/[\\/]+$/, "")}/${path.replace(/^[\\/]+/, "")}`);
}

export function isInsideRoot(root: string, path: string): boolean {
  const normalizedRoot = normalize(root).replace(/\/+$/, "").toLowerCase();
  const normalizedPath = normalize(path).toLowerCase();
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

/** Resolve a tool path and reject attempts to leave a Safe mode sandbox. */
export function resolveToolPath(cwd: string, path: string, safety?: SafetyContext): string {
  const resolved = resolveInCwd(cwd, path);
  if (safety && !isInsideRoot(safety.root, resolved))
    throw new Error(`Safe mode blocked access outside the sandbox: ${path}`);
  return resolved;
}
