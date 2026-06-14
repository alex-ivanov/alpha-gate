import { execFile } from "node:child_process";

// The wrangler seam: the ONLY place the CLI shells out. Commands are passed as an argv array (never a
// shell string), so there's no quoting/injection surface. run() resolves with the exit code + captured
// output — it does NOT reject on a non-zero exit, so the command layer decides what a failure means
// and can surface a clear message. A dry-run variant logs the intended command and no-ops; tests use a
// programmable fake.

export interface RunResult {
  ok: boolean;
  code: number;
  stdout: string;
  stderr: string;
}

export interface RunOptions {
  /** Written to the process stdin (used for `wrangler secret put`). */
  input?: string;
}

export interface Wrangler {
  run(args: readonly string[], opts?: RunOptions): Promise<RunResult>;
}

export interface WranglerOptions {
  /** When true, log the command and return success without running anything. */
  dryRun?: boolean;
  /** Sink for the dry-run echo / live command echo (defaults to console.error). */
  log?: (line: string) => void;
}

export function createWrangler(options: WranglerOptions = {}): Wrangler {
  const log = options.log ?? ((line) => console.error(line));
  return {
    run(args, opts = {}) {
      if (options.dryRun) {
        log(`[dry-run] wrangler ${args.join(" ")}`);
        return Promise.resolve({ ok: true, code: 0, stdout: "", stderr: "" });
      }
      return new Promise<RunResult>((resolve) => {
        const child = execFile(
          "npx",
          ["wrangler", ...args],
          { maxBuffer: 64 * 1024 * 1024 },
          (error, stdout, stderr) => {
            const code = error && typeof error.code === "number" ? error.code : error ? 1 : 0;
            resolve({ ok: code === 0, code, stdout, stderr });
          },
        );
        if (opts.input !== undefined) {
          child.stdin?.end(opts.input);
        }
      });
    },
  };
}

/**
 * A programmable fake for orchestration tests: `handler` returns the result for a given argv (defaults
 * to success). Every call is recorded in `calls` so tests assert the command sequence.
 */
export function createFakeWrangler(
  handler: (args: readonly string[], input?: string) => Partial<RunResult> = () => ({}),
): Wrangler & { calls: string[][] } {
  const calls: string[][] = [];
  return {
    calls,
    run(args, opts = {}) {
      calls.push([...args]);
      const partial = handler(args, opts.input);
      return Promise.resolve({
        ok: partial.ok ?? (partial.code === undefined || partial.code === 0),
        code: partial.code ?? 0,
        stdout: partial.stdout ?? "",
        stderr: partial.stderr ?? "",
      });
    },
  };
}
