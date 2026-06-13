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

  if (status.available && status.latest !== null && opts.ownerEmail !== null) {
    const lastNotified = await meta.get(deps.db, "last_notified_version");
    if (lastNotified !== status.latest) {
      await deps.email.send({
        to: opts.ownerEmail,
        subject: `Alpha Gate ${status.latest} is available`,
        body: `A newer Alpha Gate (${status.latest}) is available${
          status.breaking ? " — note: breaking changes" : ""
        }. Re-run deploy.sh to update.`,
      });
      await meta.set(deps.db, "last_notified_version", status.latest);
    }
  }
}
