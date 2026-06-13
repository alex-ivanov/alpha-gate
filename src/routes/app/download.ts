import { gateToken } from "../../auth/token-gate";
import { insertEvent } from "../../db/access-log";
import { getObject } from "../../r2/builds-bucket";
import type { AppContext } from "./app-context";
import { resolveServed } from "./resolve";

// §8/§16 — streams the archive from R2 behind the token gate (never a presigned URL). via=install
// serves the first-install DMG when present (else the zip); via=update serves the EdDSA-signed zip
// Sparkle installs. Logs a download (install) or update (update) event. An invalid token is denied
// with no R2 read.
export async function downloadRoute(c: AppContext): Promise<Response> {
  const deps = c.get("deps");
  const gate = await gateToken(deps, c.req.query("token"));
  if (gate.kind !== "active") return c.text("Not found", 404);
  const client = gate.client;

  const result = await resolveServed(deps, client);
  if (result.kind !== "target") return c.text("Not found", 404);
  const build = result.build;

  const via = c.req.query("via") === "update" ? "update" : "install";
  const key =
    via === "install" && build.dmgObjectKey !== null ? build.dmgObjectKey : build.objectKey;
  const object = await getObject(deps.r2, key);
  if (object === null) return c.text("Not found", 404);

  await insertEvent(deps.db, {
    clientId: client.id,
    email: client.email,
    event: via === "update" ? "update" : "download",
    shortVersion: build.shortVersion,
    buildNumber: build.buildNumber,
    ip: c.req.header("cf-connecting-ip") ?? null,
    userAgent: c.req.header("user-agent") ?? null,
    createdAt: deps.clock(),
  });

  const filename = key.slice(key.lastIndexOf("/") + 1);
  return new Response(object.body, {
    headers: {
      "Content-Type": "application/octet-stream",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
