// The Rust read_text/write_text commands take a path as-is — a relative
// path resolves against the Rust process's own cwd, not the agent session's
// cwd. Every file tool must resolve through this before calling invoke().
function isAbsolute(path: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(path) || path.startsWith("\\\\") || path.startsWith("/");
}

export function resolveInCwd(cwd: string, path: string): string {
  if (!path || isAbsolute(path)) return path;
  const sep = cwd.includes("\\") ? "\\" : "/";
  return `${cwd.replace(/[\\/]+$/, "")}${sep}${path.replace(/^[\\/]+/, "")}`;
}
