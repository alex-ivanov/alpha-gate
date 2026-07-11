import * as builds from "../../db/builds";
import * as streams from "../../db/streams";
import { headObject, putArchive } from "../../r2/builds-bucket";
import { recordAudit } from "../../services/audit";
import { ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { field, toId } from "./form";
import { wantsHtml } from "./negotiate";

// §20 / decision 0007 — the convergence point for all publish paths. Both routes accept a service
// token (CI) as well as a human (decision 0006 scopes service tokens to exactly here). The Worker
// NEVER signs; it stores bytes + the supplied EdDSA signature. A wrong length would break Sparkle
// for every client, so the register path asserts the stored object's size matches the declared one.

const MAX_UPLOAD_BYTES = 90 * 1024 * 1024; // conservative ceiling under the 100 MB Workers body cap

interface BuildMeta {
  shortVersion: string;
  buildNumber: number;
  edSignature: string;
  minOs: string | null;
  critical: boolean;
  streamId: number | null;
}

// STRICT digits only — parseInt would quietly accept "1.2.3" as 1 and "1500abc" as 1500, minting a
// wrong (and permanent: build_number is unique and monotonic) build number from a swapped argument.
function intField(body: Record<string, unknown>, name: string): number | null {
  const raw = field(body, name);
  if (raw === null || !/^\d+$/.test(raw.trim())) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) ? n : null;
}

function parseBuildMeta(
  body: Record<string, unknown>,
): { ok: true; value: BuildMeta } | { ok: false; error: string } {
  const shortVersion = field(body, "short_version");
  const edSignature = field(body, "ed_signature");
  const buildNumber = intField(body, "build_number");
  if (shortVersion === null || edSignature === null) {
    return { ok: false, error: "short_version and ed_signature are required" };
  }
  if (buildNumber === null || buildNumber <= 0) {
    return { ok: false, error: "build_number must be a positive integer" };
  }
  return {
    ok: true,
    value: {
      shortVersion,
      buildNumber,
      edSignature,
      minOs: field(body, "min_os"),
      critical: field(body, "critical") === "true",
      streamId: toId(field(body, "stream_id")),
    },
  };
}

// Content-negotiated responses (decision 0006 — both routes serve a human form AND a CI service token).
// A browser gets a page; CI keeps the machine JSON/text contract. See ./negotiate.

function fail(c: AdminContext, status: 400 | 409 | 413, message: string): Response {
  if (!wantsHtml(c)) return c.text(message, status);
  return c.html(
    renderPage(
      <ResultPage
        title="Upload failed"
        intent="error"
        back={{ href: "/admin/upload", label: "← Back to upload" }}
      >
        <p>{message}</p>
      </ResultPage>,
    ),
    status,
  );
}

// build_number is UNIQUE (Sparkle's monotonic key). A re-upload of an existing one would hit the DB
// constraint and surface as a bare 500; pre-check so the admin gets an actionable message instead. In
// uploadBuild this runs BEFORE the R2 PUT, so a rejected duplicate never leaves an orphan archive.
async function duplicateBuild(c: AdminContext, buildNumber: number): Promise<Response | null> {
  const existing = await builds.getByBuildNumber(c.get("deps").db, buildNumber);
  if (existing === null) return null;
  return fail(
    c,
    409,
    `Build number ${buildNumber} already exists (published as ${existing.shortVersion}). Each ` +
      `build number is unique — to publish a corrected build, give it a higher number (a roll-forward).`,
  );
}

/**
 * Pre-write validation shared by both publish endpoints, run BEFORE any R2 or D1 write so a rejected
 * publish never half-registers (the old failure mode: build row inserted, then the channel link threw
 * a raw foreign-key 500 with the archive already stored).
 */
async function rejectPublish(
  c: AdminContext,
  body: Record<string, unknown>,
  meta: BuildMeta,
): Promise<Response | null> {
  const deps = c.get("deps");

  const duplicate = await duplicateBuild(c, meta.buildNumber);
  if (duplicate !== null) return duplicate;

  // The selected channel must still exist (a stale form otherwise FK-500s AFTER the insert).
  if (meta.streamId !== null && (await streams.getById(deps.db, meta.streamId)) === null) {
    return fail(
      c,
      400,
      `Channel ${meta.streamId} not found — it may have been deleted. Nothing was published; ` +
        `pick another channel (or none) and retry.`,
    );
  }

  // Rollback mode's whole point is a build number ABOVE the current highest (Sparkle can't
  // downgrade); enforce the floor the form only explains.
  if (field(body, "mode") === "rollback") {
    const all = await builds.listAll(deps.db);
    const top = all.reduce((max, b) => Math.max(max, b.buildNumber), 0);
    if (meta.buildNumber <= top) {
      return fail(
        c,
        400,
        `A rollback build must exceed the current highest build number (${top}) — Sparkle never ` +
          `offers a lower build. Rebuild the previous good code with a number above ${top}.`,
      );
    }
  }
  return null;
}

function published(
  c: AdminContext,
  build: { id: number; buildNumber: number; shortVersion: string },
  streamName: string | null,
): Response {
  return c.html(
    renderPage(
      <ResultPage
        title="Build published"
        back={{ href: `/admin/builds/${build.id}`, label: `Open build ${build.buildNumber} →` }}
      >
        <p>
          Build <strong>{build.buildNumber}</strong> ({build.shortVersion}) is now available.
        </p>
        {streamName !== null ? (
          <p class="muted">
            It's in the <strong>{streamName}</strong> channel — users assigned there are offered it
            on their next update check (unless a higher build already serves them).
          </p>
        ) : (
          <p class="callout callout-warn">
            It isn't in any channel yet, so <strong>no one receives it</strong> until you link a
            channel from the <a href={`/admin/builds/${build.id}`}>build page</a>.
          </p>
        )}
      </ResultPage>,
    ),
    201,
  );
}

/** Full upload: streams the archive body to R2 (under the size ceiling), then registers the build. */
export async function uploadBuild(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");

  const declaredLength = Number.parseInt(c.req.header("content-length") ?? "", 10);
  if (Number.isFinite(declaredLength) && declaredLength > MAX_UPLOAD_BYTES) {
    return fail(c, 413, "Archive exceeds the upload ceiling; use /admin/builds/register");
  }

  const body = await c.req.parseBody();
  const archive = body.archive;
  if (!(archive instanceof File)) return fail(c, 400, "an archive file is required");
  if (archive.size > MAX_UPLOAD_BYTES) {
    return fail(c, 413, "Archive exceeds the upload ceiling; use /admin/builds/register");
  }

  const meta = parseBuildMeta(body);
  if (!meta.ok) return fail(c, 400, meta.error);

  const rejected = await rejectPublish(c, body, meta.value);
  if (rejected !== null) return rejected;

  const objectKey = await putArchive(
    deps.r2,
    meta.value.buildNumber,
    archive.name || "App.zip",
    await archive.arrayBuffer(),
  );
  const build = await builds.insert(deps.db, {
    shortVersion: meta.value.shortVersion,
    buildNumber: meta.value.buildNumber,
    objectKey,
    edSignature: meta.value.edSignature,
    length: archive.size,
    minOs: meta.value.minOs,
    critical: meta.value.critical,
  });
  const streamName =
    meta.value.streamId === null
      ? null
      : ((await streams.getById(deps.db, meta.value.streamId))?.name ?? null);
  if (meta.value.streamId !== null) await builds.linkStream(deps.db, build.id, meta.value.streamId);
  await recordAudit(deps, auditFields(c, "build.upload", String(meta.value.buildNumber)));

  if (wantsHtml(c)) return published(c, build, streamName);
  return c.json({ ok: true, buildNumber: meta.value.buildNumber, objectKey }, 201);
}

/** Metadata-only register for an archive already PUT to R2 out of band (large builds, §20). */
export async function registerBuild(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const body = await c.req.parseBody();

  const objectKey = field(body, "object_key");
  const size = intField(body, "size");
  if (objectKey === null || size === null || size < 0) {
    return fail(c, 400, "object_key and a non-negative size are required");
  }
  const meta = parseBuildMeta(body);
  if (!meta.ok) return fail(c, 400, meta.error);

  const rejected = await rejectPublish(c, body, meta.value);
  if (rejected !== null) return rejected;

  const head = await headObject(deps.r2, objectKey);
  if (head === null) return fail(c, 400, "object not found in R2");
  if (head.size !== size) return fail(c, 400, "declared size does not match the stored object");

  const build = await builds.insert(deps.db, {
    shortVersion: meta.value.shortVersion,
    buildNumber: meta.value.buildNumber,
    objectKey,
    edSignature: meta.value.edSignature,
    length: size,
    minOs: meta.value.minOs,
    critical: meta.value.critical,
  });
  const streamName =
    meta.value.streamId === null
      ? null
      : ((await streams.getById(deps.db, meta.value.streamId))?.name ?? null);
  if (meta.value.streamId !== null) await builds.linkStream(deps.db, build.id, meta.value.streamId);
  await recordAudit(deps, auditFields(c, "build.register", String(meta.value.buildNumber)));

  if (wantsHtml(c)) return published(c, build, streamName);
  return c.json({ ok: true, buildNumber: meta.value.buildNumber }, 201);
}
