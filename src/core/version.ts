// §22 self-update version logic. Pure: the manifest is passed in (the fetch lives in
// services/self-update). The manifest is untrusted input from an upstream URL, so isUpdateAvailable
// is defensive — it never throws and defaults to "no update" on anything malformed.

/** The upstream release manifest shape (§22, decision 0004). Extra keys are tolerated. */
export interface UpdateManifest {
  latest: string;
  min_supported?: string;
  notes_url?: string;
  breaking?: boolean;
}

export interface UpdateStatus {
  available: boolean;
  breaking: boolean;
  belowMinSupported: boolean;
  latest: string | null;
  notesUrl: string | null;
}

interface ParsedVersion {
  core: number[];
  prerelease: string | null;
}

function parse(version: string): ParsedVersion {
  const cleaned = version.trim().replace(/^v/i, "");
  const dash = cleaned.indexOf("-");
  const core = dash === -1 ? cleaned : cleaned.slice(0, dash);
  const prerelease = dash === -1 ? null : cleaned.slice(dash + 1);
  const segments = core.split(".").map((part) => {
    const n = Number.parseInt(part, 10);
    return Number.isFinite(n) ? n : 0;
  });
  return { core: segments, prerelease };
}

/** Returns <0, 0, or >0 (semver-ish; numeric segments, missing treated as 0, prerelease < release). */
export function compareVersion(a: string, b: string): number {
  const pa = parse(a);
  const pb = parse(b);

  const length = Math.max(pa.core.length, pb.core.length);
  for (let i = 0; i < length; i++) {
    const diff = (pa.core[i] ?? 0) - (pb.core[i] ?? 0);
    if (diff !== 0) return diff < 0 ? -1 : 1;
  }

  // Equal core: a release outranks a prerelease of the same core; otherwise compare the tags.
  if (pa.prerelease === pb.prerelease) return 0;
  if (pa.prerelease === null) return 1;
  if (pb.prerelease === null) return -1;
  if (pa.prerelease < pb.prerelease) return -1;
  if (pa.prerelease > pb.prerelease) return 1;
  return 0;
}

export function isUpdateAvailable(toolVersion: string, manifest: UpdateManifest): UpdateStatus {
  const noUpdate: UpdateStatus = {
    available: false,
    breaking: false,
    belowMinSupported: false,
    latest: null,
    notesUrl: null,
  };

  if (typeof manifest !== "object" || manifest === null) return noUpdate;
  const latest = (manifest as { latest?: unknown }).latest;
  if (typeof latest !== "string" || latest.length === 0) return noUpdate;

  const minSupported = typeof manifest.min_supported === "string" ? manifest.min_supported : null;

  return {
    available: compareVersion(latest, toolVersion) > 0,
    breaking: manifest.breaking === true,
    belowMinSupported: minSupported !== null && compareVersion(toolVersion, minSupported) < 0,
    latest,
    notesUrl: typeof manifest.notes_url === "string" ? manifest.notes_url : null,
  };
}
