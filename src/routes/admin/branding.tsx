import * as meta from "../../db/meta";
import type { Deps } from "../../deps";
import { putBranding } from "../../r2/builds-bucket";
import { BRANDING_HEADER_KEY, BRANDING_ICON_KEY } from "../../r2/keys";
import { recordAudit } from "../../services/audit";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { field } from "./form";
import { requireUser } from "./middleware";

// §13 — download-page branding + invite template. Human-only. Text config goes to `meta`; images go
// to R2 under the fixed branding keys after a content-type + size check (branding attack surface).

const TEXT_FIELDS = [
  "app_name",
  "blurb",
  "accent",
  "activate_scheme",
  "invite_subject",
  "invite_body",
] as const;
// Raster only — SVG served from the app origin is a stored-XSS vector (scriptable when opened
// directly at /assets/icon), so it is intentionally excluded.
const ALLOWED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const MAX_IMAGE_BYTES = 512 * 1024;

type Body = Record<string, unknown>;

async function saveImage(
  deps: Deps,
  body: Body,
  fileField: string,
  key: string,
  metaFlag: string,
): Promise<string | null> {
  const file = body[fileField];
  if (!(file instanceof File)) return null;
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) return "unsupported image type";
  if (file.size > MAX_IMAGE_BYTES) return "image too large";
  await putBranding(deps.r2, key, await file.arrayBuffer(), file.type);
  await meta.set(deps.db, metaFlag, "1");
  return null;
}

export async function saveBranding(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");
  const body = await c.req.parseBody();

  for (const name of TEXT_FIELDS) {
    const value = field(body, name);
    if (value !== null) await meta.set(deps.db, name, value);
  }

  for (const [fileField, key, flag] of [
    ["icon", BRANDING_ICON_KEY, "icon"],
    ["header", BRANDING_HEADER_KEY, "header"],
  ] as const) {
    const error = await saveImage(deps, body, fileField, key, flag);
    if (error !== null) return c.text(error, 400);
  }

  await recordAudit(deps, auditFields(c, "branding.update"));
  return c.redirect("/admin", 303);
}
