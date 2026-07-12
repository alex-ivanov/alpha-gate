import { isValidAccent } from "../../core/invite-template";
import * as meta from "../../db/meta";
import type { Deps } from "../../deps";
import { putBranding } from "../../r2/builds-bucket";
import { BRANDING_HEADER_KEY, BRANDING_ICON_KEY } from "../../r2/keys";
import { recordAudit } from "../../services/audit";
import { emailStatus } from "../../services/email";
import { ResultPage } from "../../views/admin/manage-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { auditFields } from "./audit-fields";
import { doneRedirect } from "./flash";
import { field, isEmail } from "./form";
import { requireUser } from "./middleware";

// §13 — download-page branding + invite template. Human-only. Text config goes to `meta`; images go
// to R2 under the fixed branding keys after a content-type + size check (branding attack surface).

const TEXT_FIELDS = [
  "app_name",
  "blurb",
  "accent",
  "activate_scheme",
  "sparkle_public_key",
  "invite_subject",
  "invite_body",
  "notice_title",
  "notice_message",
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

  // accent is interpolated raw into a public <style> — reject anything that isn't a hex colour so it
  // can never break out of the style block (loadBranding also coerces stored values defensively).
  const accent = field(body, "accent");
  if (accent !== null && accent.trim() !== "" && !isValidAccent(accent)) {
    return c.text("Accent colour must be a hex value like #0A84FF", 400);
  }

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
  // Close the feedback loop: land back on Settings with the "Settings saved." flash.
  return doneRedirect(c, body, "/admin/settings", "settings.saved");
}

const back = { href: "/admin/settings", label: "← Settings" } as const;

// Send a one-off test email so the admin can debug delivery without creating users. Sends to a given
// address (defaults to the admin's own), reuses the real send path, and reports the exact outcome —
// success, or the provider's error (also logged for `wrangler tail`). Reproduces the create-user failure.
export async function sendTestEmail(c: AdminContext): Promise<Response> {
  const actor = requireUser(c);
  if (actor === null) return c.text("Forbidden", 403);
  const deps = c.get("deps");

  const status = emailStatus(c.env);
  if (status.mode !== "active") {
    return c.html(
      renderPage(
        <ResultPage title="Email not configured" intent="error" back={back}>
          <p>
            Email delivery isn't active ({status.mode}); there's nothing to test. Turn it on first —
            see <a href="/admin/settings">Settings</a>.
          </p>
        </ResultPage>,
      ),
      400,
    );
  }

  const requested = field(await c.req.parseBody(), "to");
  const to = requested && requested.trim().length > 0 ? requested.trim() : actor.email;
  if (!isEmail(to)) {
    return c.html(
      renderPage(
        <ResultPage title="Test email failed" intent="error" back={back}>
          <p>
            <code>{to}</code> isn't a valid email address.
          </p>
        </ResultPage>,
      ),
      400,
    );
  }

  try {
    await deps.email.send({
      to,
      subject: "Alpha Gate — test email",
      body: `This is a test from your Alpha Gate admin (${status.from}). If you received it, invite delivery works.`,
    });
    await recordAudit(deps, auditFields(c, "email.test", to));
    return c.html(
      renderPage(
        <ResultPage title="Test email sent" back={back}>
          <p>
            Handed to Cloudflare for delivery to <strong>{to}</strong>. Check the inbox (and spam).
            If it never arrives, the provider accepted it but couldn't deliver — verify the
            recipient and sending domain in Cloudflare Email Routing.
          </p>
        </ResultPage>,
      ),
    );
  } catch (e) {
    const detail = e instanceof Error ? e.message : String(e);
    console.error("[email.test] send to", to, "failed:", e); // full error → `wrangler tail`
    return c.html(
      renderPage(
        <ResultPage title="Test email failed" intent="error" back={back}>
          <p>
            Sending to <strong>{to}</strong> failed: <code>{detail}</code>
          </p>
          <p class="muted">
            For the full error, run <code>wrangler tail alpha-gate-&lt;instance&gt;-admin</code> and
            resend. Common causes: the sending domain (<code>{status.from}</code>) isn't fully
            onboarded for sending in Cloudflare Email Routing (SPF/DKIM/DMARC), or the recipient
            isn't allowed.
          </p>
        </ResultPage>,
      ),
      502,
    );
  }
}
