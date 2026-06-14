// ANSI color, kept behind a Palette so the renderers stay pure and testable: callers pass a palette
// in, and the "should we actually emit color?" decision (TTY / NO_COLOR) lives at the edge (the CLI),
// never in a render function. Tests use plainPalette for stable, code-free assertions.

export interface Palette {
  green(s: string): string;
  red(s: string): string;
  yellow(s: string): string;
  cyan(s: string): string;
  dim(s: string): string;
  bold(s: string): string;
}

// Close with the attribute-specific reset (39 = default fg, 22 = normal intensity) rather than 0, so
// nesting one style inside another doesn't wipe the outer style.
function sgr(open: number, close: number): (s: string) => string {
  return (s) => `\x1b[${open}m${s}\x1b[${close}m`;
}

export const colorPalette: Palette = {
  green: sgr(32, 39),
  red: sgr(31, 39),
  yellow: sgr(33, 39),
  cyan: sgr(36, 39),
  dim: sgr(2, 22),
  bold: sgr(1, 22),
};

const identity = (s: string): string => s;
export const plainPalette: Palette = {
  green: identity,
  red: identity,
  yellow: identity,
  cyan: identity,
  dim: identity,
  bold: identity,
};

export function selectPalette(useColor: boolean): Palette {
  return useColor ? colorPalette : plainPalette;
}

/** Honor NO_COLOR / FORCE_COLOR, else color only when stdout is a TTY. Pure over its inputs (testable). */
export function shouldColor(env: NodeJS.ProcessEnv, isTty: boolean): boolean {
  if (env.NO_COLOR !== undefined && env.NO_COLOR !== "") return false;
  if (env.FORCE_COLOR !== undefined && env.FORCE_COLOR !== "" && env.FORCE_COLOR !== "0")
    return true;
  return isTty;
}
