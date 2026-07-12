// The ONLY place R2 object keys are constructed (decision 0003), so the layout is single-sourced and
// testable. Build archives are append-only (build_number is UNIQUE); DMG + zip for one build coexist
// under one prefix; branding lives at fixed keys; audit anchors are append-only head objects (§16).

/** Reduce a user-supplied filename to one safe key segment (strips any path, restricts the charset). */
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/^.*[/\\]/, "");
  const safe = base.replace(/[^A-Za-z0-9._-]/g, "_");
  return safe.length > 0 ? safe : "artifact";
}

export function archiveKey(buildNumber: number, filename: string): string {
  return `build/${buildNumber}/${sanitizeFilename(filename)}`;
}

/** The prefix holding a build's archive object(s) — the unit the purge action deletes. */
export function buildPrefix(buildNumber: number): string {
  return `build/${buildNumber}/`;
}

export const BRANDING_ICON_KEY = "branding/icon";
export const BRANDING_HEADER_KEY = "branding/header";

/** One append-only head object per anchoring run (§16). */
export function auditAnchorKey(iso: string): string {
  return `audit/anchor/${iso}.json`;
}
