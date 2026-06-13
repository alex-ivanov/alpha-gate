import { generateToken } from "../../src/core/tokens";
import * as builds from "../../src/db/builds";
import * as clients from "../../src/db/clients";
import * as streams from "../../src/db/streams";
import type { Deps } from "../../src/deps";
import { putArchive } from "../../src/r2/builds-bucket";

// Builds a servable world THROUGH the production query modules (so the builders exercise the same
// SQL the app uses): an active client assigned to a stream, an available build in that stream with
// its archive(s) in R2. Returns the handles a CUJ test needs.
export interface ServableOptions {
  buildNumber?: number;
  shortVersion?: string;
  withDmg?: boolean;
  zipBody?: string;
  dmgBody?: string;
  email?: string;
}

export async function seedServableClient(deps: Deps, opts: ServableOptions = {}) {
  const buildNumber = opts.buildNumber ?? 1500;
  const zipBody = opts.zipBody ?? "ZIP-BYTES";
  const dmgBody = opts.dmgBody ?? "DMG-BYTES";

  const token = generateToken();
  const client = await clients.insert(deps.db, {
    email: opts.email ?? "user@example.test",
    token,
  });
  const stream = await streams.create(deps.db, "stable");
  await streams.assignUser(deps.db, client.id, stream.id);

  const objectKey = await putArchive(deps.r2, buildNumber, "App.zip", zipBody);
  const dmgObjectKey = opts.withDmg
    ? await putArchive(deps.r2, buildNumber, "App.dmg", dmgBody)
    : null;

  const build = await builds.insert(deps.db, {
    shortVersion: opts.shortVersion ?? "1.4.0",
    buildNumber,
    objectKey,
    edSignature: "ed-sig",
    length: zipBody.length,
    dmgObjectKey,
    dmgLength: dmgObjectKey ? dmgBody.length : null,
  });
  await builds.linkStream(deps.db, build.id, stream.id);

  return { token, client, stream, build };
}

/** Publishes another available build into an existing client's stream (a normal update, §12.2). */
export async function publishBuild(
  deps: Deps,
  streamId: number,
  opts: { buildNumber: number; shortVersion?: string; critical?: boolean; zipBody?: string },
) {
  const zipBody = opts.zipBody ?? "ZIP-BYTES-NEW";
  const objectKey = await putArchive(deps.r2, opts.buildNumber, "App.zip", zipBody);
  const build = await builds.insert(deps.db, {
    shortVersion: opts.shortVersion ?? "1.5.0",
    buildNumber: opts.buildNumber,
    objectKey,
    edSignature: "ed-sig-new",
    length: zipBody.length,
    critical: opts.critical ?? false,
  });
  await builds.linkStream(deps.db, build.id, streamId);
  return build;
}
