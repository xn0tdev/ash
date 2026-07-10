import { invoke } from "@tauri-apps/api/core";

export interface RunProcessResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

export interface RunProcessOpts {
  timeoutMs: number;
  signal?: AbortSignal;
}

/** Promise wrapper over the raw one-shot process bridge, shared by every
 * tool that shells out (bash/grep/glob/web_fetch) — ties a timeout and the
 * tool-call AbortSignal to the same kill path the Stop button already uses. */
export function runProcess(
  program: string,
  args: string[],
  cwd: string,
  opts: RunProcessOpts,
): Promise<RunProcessResult> {
  if (opts.signal?.aborted)
    return Promise.resolve({ code: null, stdout: "", stderr: "", timedOut: false });
  return invoke<{
    code: number | null;
    stdout: string;
    stderr: string;
    timed_out: boolean;
  }>("process_run", {
    program,
    args,
    cwd,
    timeoutMs: opts.timeoutMs,
  }).then((res) => ({
    code: res.code,
    stdout: res.stdout,
    stderr: res.stderr,
    timedOut: res.timed_out,
  }));
}
