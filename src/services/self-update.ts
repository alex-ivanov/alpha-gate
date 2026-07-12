import { isUpdateAvailable, type UpdateManifest } from "../core/version";
import * as meta from "../db/meta";
import type { Deps } from "../deps";

// §22 — checks the upstream manifest for a newer version of the TOOL ITSELF, stores the result in
// meta (the dashboard banner reads it), and emails the operator once per new version. Defensive: a
// failed/garbage fetch is swallowed (the cron just retries next time); never throws.

export interface SelfUpdateOptions {
  toolVersion: string;
  manifestUrl: string;
  ownerEmail: string | null;
}

export async function checkSelfUpdate(deps: Deps, opts: SelfUpdateOptions): Promise<void> {
  // Record the attempt time up front (before the fetch that may fail), so Settings can honestly show
  // "last checked" — and distinguish "checked, up to date" from "never checked / cron not firing".
  await meta.set(deps.db, "selfupdate_checked_at", deps.clock());

  let manifest: UpdateManifest;
  try {
    const res = await deps.fetch(opts.manifestUrl);
    if (!res.ok) return;
    manifest = (await res.json()) as UpdateManifest;
  } catch {
    return;
  }

  const status = isUpdateAvailable(opts.toolVersion, manifest);
  await meta.set(deps.db, "selfupdate_latest", status.latest ?? "");
  await meta.set(deps.db, "selfupdate_available", status.available ? "1" : "0");
  await meta.set(deps.db, "selfupdate_breaking", status.breaking ? "1" : "0");
  await meta.set(deps.db, "selfupdate_below_min", status.belowMinSupported ? "1" : "0");
  // notes_url is untrusted upstream input — only persist a safe http(s) link (the dashboard renders it).
  await meta.set(deps.db, "selfupdate_notes_url", safeHttpUrl(status.notesUrl) ?? "");

  if (status.available && status.latest !== null && opts.ownerEmail !== null) {
    const lastNotified = await meta.get(deps.db, "last_notified_version");
    if (lastNotified !== status.latest) {
      const notes = safeHttpUrl(status.notesUrl);
      await deps.email.send({
        to: opts.ownerEmail,
        subject: `Alpha Gate ${status.latest} is available`,
        body: `A newer Alpha Gate (${status.latest}) is available${
          status.breaking ? " — note: breaking changes" : ""
        }.${notes !== null ? ` Release notes: ${notes}.` : ""} Re-run deploy.sh to update.`,
      });
      await meta.set(deps.db, "last_notified_version", status.latest);
    }
  }
}

/** Accept only absolute http(s) URLs; reject javascript:/data: and anything unparseable (defense). */
function safeHttpUrl(url: string | null): string | null {
  if (url === null) return null;
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" || parsed.protocol === "http:" ? url : null;
  } catch {
    return null;
  }
}
