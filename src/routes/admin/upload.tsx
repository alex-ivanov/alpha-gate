import * as builds from "../../db/builds";
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

function intField(body: Record<string, unknown>, name: string): number | null {
  const raw = field(body, name);
  if (raw === null) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isInteger(n) ? n : null;
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

function fail(c: AdminContext, status: 400 | 413, message: string): Response {
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

function published(c: AdminContext, buildNumber: number, shortVersion: string): Response {
  return c.html(
    renderPage(
      <ResultPage title="Build published" back={{ href: "/admin/builds", label: "View builds →" }}>
        <p>
          Build <strong>{buildNumber}</strong> ({shortVersion}) is now available.
        </p>
        <p class="muted">
          If it isn't yet in a channel your testers are assigned to, link it from the build page so
          their next update check picks it up.
        </p>
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
  if (meta.value.streamId !== null) await builds.linkStream(deps.db, build.id, meta.value.streamId);
  await recordAudit(deps, auditFields(c, "build.upload", String(meta.value.buildNumber)));

  if (wantsHtml(c)) return published(c, meta.value.buildNumber, meta.value.shortVersion);
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
  if (meta.value.streamId !== null) await builds.linkStream(deps.db, build.id, meta.value.streamId);
  await recordAudit(deps, auditFields(c, "build.register", String(meta.value.buildNumber)));

  if (wantsHtml(c)) return published(c, meta.value.buildNumber, meta.value.shortVersion);
  return c.json({ ok: true, buildNumber: meta.value.buildNumber }, 201);
}
