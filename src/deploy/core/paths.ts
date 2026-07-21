// Where the per-instance deploy state (.deploy/<slug>.state.json + the rendered wrangler configs)
// lives. Two modes, so the CLI works whether it was `git clone`d or installed from npm:
//
//   - a git checkout (contributor) → `<packageRoot>/.deploy`, exactly as before, so existing
//     deployments keep finding their state.
//   - an npm install / npx run → `~/.alpha-gate`, because the package files sit in the (versioned,
//     ephemeral) npm cache — state written there would vanish on the next `npx alpha-gate@newer`.
//
// $ALPHA_GATE_HOME overrides both. Pure over its inputs (env + a "does <root>/.git exist" probe) so
// it's unit-testable without touching the filesystem.

export interface StateDirInputs {
  packageRoot: string;
  /** $ALPHA_GATE_HOME, if set. */
  home: string | undefined;
  /** $HOME (for the ~/.alpha-gate default). */
  userHome: string | undefined;
  /** Whether `<packageRoot>/.git` exists — the signal for "running from a checkout". */
  isGitCheckout: boolean;
}

/**
 * Absolutize a path the USER typed, against the directory they typed it in.
 *
 * Every wrangler call runs with `cwd` pinned to the package root (so the bundled wrangler resolves
 * from an npx install), which means a relative `--archive-dir ./backups` would land inside the
 * package — i.e. inside npm's prunable cache — while the summary cheerfully printed `./backups`. For a
 * pre-destroy database archive that is the difference between a backup and no backup.
 *
 * Pure string work on purpose (no `node:path`), so core stays runtime-free and testable.
 */
export function resolveUserPath(input: string, cwd: string): string {
  if (input.startsWith("/")) return input;
  const base = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
  const rel = input.startsWith("./") ? input.slice(2) : input;
  return rel === "" ? base : `${base}/${rel}`;
}

export function resolveStateDir(inputs: StateDirInputs): string {
  if (inputs.home !== undefined && inputs.home !== "") return inputs.home;
  if (inputs.isGitCheckout) return `${inputs.packageRoot}/.deploy`;
  const base = inputs.userHome !== undefined && inputs.userHome !== "" ? inputs.userHome : ".";
  return `${base}/.alpha-gate`;
}
