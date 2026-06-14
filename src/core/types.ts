// Shared domain vocabulary — plain data the pure core operates on. The db/ layer maps snake_case D1
// rows onto these camelCase shapes; the core never sees a binding. Types grow as later milestones
// need them (AdminAuditEntry, AppcastItem, AccessIdentity arrive with M5/M4/M11).

export type ClientStatus = "active" | "revoked";
export type BuildStatus = "available" | "withdrawn";
export type AccessEvent = "check" | "download" | "update";

export interface Client {
  id: number;
  email: string;
  token: string;
  status: ClientStatus;
  /** Overrides stream resolution when set and the build is available (§8). */
  pinnedBuildId: number | null;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Build {
  id: number;
  /** Human version, e.g. "1.4.0". */
  shortVersion: string;
  /** Machine CFBundleVersion — monotonic, the value Sparkle compares (§8). */
  buildNumber: number;
  /** R2 key of the EdDSA-signed .app zip (the Sparkle enclosure). */
  objectKey: string;
  edSignature: string;
  /** Byte length of the signed zip (the enclosure length). */
  length: number;
  minOs: string | null;
  critical: boolean;
  /** §9/§13 operator marker: a designated rollback (roll-forward) target. Label only — see §9. */
  rollbackTarget: boolean;
  status: BuildStatus;
  /** Optional first-install DMG (decision 0003); no EdDSA — notarization seals it. */
  dmgObjectKey: string | null;
  dmgLength: number | null;
  createdAt: string;
}

export interface Stream {
  id: number;
  name: string;
}

/** A build_streams row: which stream a build belongs to. */
export interface BuildStreamLink {
  buildId: number;
  streamId: number;
}

/** A user_streams row: which stream a client is assigned to. */
export interface UserStreamLink {
  clientId: number;
  streamId: number;
}

/**
 * Outcome of resolving what a client should be served (§8). The single source of truth behind the
 * appcast, the /download target, and the §11 no-build preview.
 *
 * `none` means "no build to serve" — the empty-vs-stranded distinction (§11) is a separate
 * classification (core/no-build) because it needs the client's last-reported installed build, which
 * §8 resolution never uses.
 */
export type ResolverResult =
  | { kind: "target"; build: Build }
  | { kind: "informational"; reason: "revoked" | "unknown" }
  | { kind: "none" };
