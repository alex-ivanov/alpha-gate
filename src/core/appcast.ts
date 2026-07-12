import type { Build } from "./types";

// §8/§14/§15 — per-user appcast generation. Pure string building over already-resolved data (the
// route passes the build + enclosure URL). The out-of-scope Sparkle client depends on this output
// being exactly right, so every interpolated value is XML-escaped and the shape is golden-tested.

const SPARKLE_NS = "http://www.andymatuschak.org/xml-namespaces/sparkle";
const ENCLOSURE_TYPE = "application/octet-stream";

/**
 * Sentinel version for the §15 informational item — fixed, far above any real build_number, and
 * below INT32 max. Safe permanently because the item carries no enclosure, so Sparkle can never
 * "install" it regardless of the number (decision 0008). Real build_numbers must stay below this.
 */
export const INFORMATIONAL_SENTINEL_VERSION = 999_000_000;

// Shown in Sparkle's dialog in place of the raw sentinel number: sparkle:shortVersionString is the
// human-readable version string (the sentinel stays the machine-comparable sparkle:version).
const INFORMATIONAL_DISPLAY_VERSION = "Access renewal";

export interface InformationalNotice {
  /** The /access page the notice links to. */
  accessUrl: string;
  /** Dialog title (already {app_name}-filled by the caller). */
  title: string;
  /** Plain-text body, shown as the dialog's release notes (already {app_name}-filled). */
  message: string;
}

export function xmlEscape(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** The `<item>` Sparkle installs: machine version, enclosure with the fixed EdDSA signature (§8/§14). */
export function renderUpdateItem(build: Build, enclosureUrl: string): string {
  const children = [
    `<title>${xmlEscape(build.shortVersion)}</title>`,
    `<sparkle:version>${build.buildNumber}</sparkle:version>`,
    `<sparkle:shortVersionString>${xmlEscape(build.shortVersion)}</sparkle:shortVersionString>`,
  ];

  if (build.minOs !== null) {
    children.push(
      `<sparkle:minimumSystemVersion>${xmlEscape(build.minOs)}</sparkle:minimumSystemVersion>`,
    );
  }
  if (build.critical) {
    children.push("<sparkle:criticalUpdate></sparkle:criticalUpdate>");
  }
  children.push(
    `<enclosure url="${xmlEscape(enclosureUrl)}" length="${build.length}" type="${ENCLOSURE_TYPE}" sparkle:edSignature="${xmlEscape(build.edSignature)}" />`,
  );

  return wrapItem(children);
}

/**
 * The §15 informational notice for revoked/unknown tokens (decision 0011): a title, a message, the
 * sentinel `sparkle:version` with a friendly `shortVersionString` (so Sparkle shows "Access renewal",
 * not "999000000"), an explicit empty `<sparkle:informationalUpdate>` (Sparkle 2's documented marker;
 * 1.x falls back to "no enclosure → informational"), a `<link>`, and NO enclosure (never installable).
 */
export function renderInformationalItem(notice: InformationalNotice): string {
  return wrapItem([
    `<title>${xmlEscape(notice.title)}</title>`,
    `<description>${descriptionCdata(notice.message)}</description>`,
    `<sparkle:version>${INFORMATIONAL_SENTINEL_VERSION}</sparkle:version>`,
    `<sparkle:shortVersionString>${xmlEscape(INFORMATIONAL_DISPLAY_VERSION)}</sparkle:shortVersionString>`,
    "<sparkle:informationalUpdate></sparkle:informationalUpdate>",
    `<link>${xmlEscape(notice.accessUrl)}</link>`,
  ]);
}

// The admin message becomes the dialog's HTML release notes. xmlEscape first so it renders as literal
// text (no markup/script reaches Sparkle's WebView) — escaping `>` also guarantees the content can't
// contain `]]>`, so it can't break out of the CDATA. Newlines become <br> for a readable paragraph.
function descriptionCdata(message: string): string {
  return `<![CDATA[<p>${xmlEscape(message).replace(/\n/g, "<br>")}</p>]]>`;
}

export interface AppcastOptions {
  title: string;
  items: readonly string[];
}

/** Wraps zero or more item fragments in the rss/channel document with the sparkle namespace. */
export function renderAppcast({ title, items }: AppcastOptions): string {
  const lines = [
    '<?xml version="1.0" encoding="utf-8"?>',
    `<rss version="2.0" xmlns:sparkle="${SPARKLE_NS}">`,
    "  <channel>",
    `    <title>${xmlEscape(title)}</title>`,
    ...items,
    "  </channel>",
    "</rss>",
  ];
  return `${lines.join("\n")}\n`;
}

function wrapItem(children: readonly string[]): string {
  return ["    <item>", ...children.map((child) => `      ${child}`), "    </item>"].join("\n");
}
