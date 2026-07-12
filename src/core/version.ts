// §22 self-update version logic. Pure: the manifest is passed in (the fetch lives in
// services/self-update). The manifest is untrusted input from an upstream URL, so isUpdateAvailable
// is defensive — it never throws and defaults to "no update" on anything malformed.
//
// Two manifest shapes are accepted so the check works against the npm registry OR a static file:
//   - npm's registry `/latest` endpoint returns the published package.json: { version, homepage,
//     alphaGate? }. The upgrade signals (breaking / min-supported / notes) ride in a custom
//     `alphaGate` field, which npm preserves in the version manifest.
//   - the legacy static release.json: { latest, min_supported, notes_url, breaking }.

/** The upstream release manifest — either npm's `/latest` response or a static release.json. */
export interface UpdateManifest {
  /** Static release.json: the latest version string. */
  latest?: string;
  /** npm registry `/latest`: the published version. */
  version?: string;
  min_supported?: string;
  notes_url?: string;
  breaking?: boolean;
  /** npm package.json `homepage` — a notes-URL fallback for the npm channel. */
  homepage?: string;
  /** Upgrade signals carried through npm (a custom package.json field npm preserves). */
  alphaGate?: {
    minSupported?: string;
    breaking?: boolean;
    notesUrl?: string;
  };
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
  // The latest version: release.json's `latest`, else npm's `version`.
  const latestRaw = manifest.latest ?? manifest.version;
  if (typeof latestRaw !== "string" || latestRaw.length === 0) return noUpdate;
  const latest = latestRaw;

  const ag = manifest.alphaGate;
  const minSupported =
    typeof manifest.min_supported === "string"
      ? manifest.min_supported
      : typeof ag?.minSupported === "string"
        ? ag.minSupported
        : null;
  const notesUrl =
    typeof manifest.notes_url === "string"
      ? manifest.notes_url
      : typeof ag?.notesUrl === "string"
        ? ag.notesUrl
        : typeof manifest.homepage === "string"
          ? manifest.homepage
          : null;

  return {
    available: compareVersion(latest, toolVersion) > 0,
    breaking: manifest.breaking === true || ag?.breaking === true,
    belowMinSupported: minSupported !== null && compareVersion(toolVersion, minSupported) < 0,
    latest,
    notesUrl,
  };
}
