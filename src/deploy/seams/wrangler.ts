import { execFile, spawn } from "node:child_process";

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
  /** Spawn a long-running command with inherited stdio (e.g. `wrangler dev`); resolves on exit. */
  exec(args: readonly string[]): Promise<number>;
}

export interface WranglerOptions {
  /** When true, log the command and return success without running anything. */
  dryRun?: boolean;
  /** Sink for the dry-run echo / live command echo (defaults to console.error). */
  log?: (line: string) => void;
  /** Directory to run `npx wrangler` from — set to the package root so the bundled wrangler (a
      dependency) resolves even when the user's CWD has no node_modules (an npx install). */
  cwd?: string;
}

export function createWrangler(options: WranglerOptions = {}): Wrangler {
  const log = options.log ?? ((line) => console.error(line));
  const cwd = options.cwd;
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
          { maxBuffer: 64 * 1024 * 1024, cwd },
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
    exec(args) {
      if (options.dryRun) {
        log(`[dry-run] wrangler ${args.join(" ")}`);
        return Promise.resolve(0);
      }
      return new Promise<number>((resolve) => {
        const child = spawn("npx", ["wrangler", ...args], { stdio: "inherit", cwd });
        child.on("exit", (code) => resolve(code ?? 0));
        child.on("error", () => resolve(1));
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
    exec(args) {
      calls.push([...args]);
      return Promise.resolve(0);
    },
  };
}
