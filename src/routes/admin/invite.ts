import { renderInvite } from "../../core/invite-template";
import type { Env } from "../../env";
import { inviteUrl } from "../../lib/hosts";
import { loadBranding, loadInviteTemplate } from "../../services/branding";
import { emailStatus } from "../../services/email";
import type { AdminContext } from "./admin-context";

// Composing + delivering the §13 invite, shared by Add-user (clients) and Invite-request (pending).
// A delivery failure must NEVER 500 the request: the client row is already written, and the copy-paste
// link is the always-available fallback. So this catches the send error and reports it for the page to
// surface, rather than letting it bubble into a bare "Internal Server Error".

export interface Delivery {
  /** True only when email is configured AND the send succeeded. */
  sent: boolean;
  /** The provider's error when a configured send failed (shown to the admin). */
  error?: string;
}

/**
 * Build the invite link, attempt email delivery, and report the outcome. Returns `delivery: undefined`
 * in copy-paste mode (no email configured, nothing attempted) — callers then just show the link.
 */
export async function sendInvite(
  c: AdminContext,
  to: string,
  token: string,
): Promise<{ url: string; delivery?: Delivery | undefined }> {
  const deps = c.get("deps");
  const url = inviteUrl(c.req.url, token);
  const [branding, template] = await Promise.all([loadBranding(deps), loadInviteTemplate(deps)]);
  const invite = renderInvite(template, { appName: branding.appName, getUrl: url, token });

  // Only report a delivery status when email is actually configured; otherwise the sender is the no-op
  // (copy-paste) and there is nothing to report. `c.env` is always present at runtime; the guard keeps
  // this safe if a caller (or test) invokes the app without binding env.
  const env = c.env as Env | undefined;
  const configured = env !== undefined && emailStatus(env).mode === "active";
  try {
    await deps.email.send({ to, subject: invite.subject, body: invite.body });
    return { url, delivery: configured ? { sent: true } : undefined };
  } catch (e) {
    return { url, delivery: { sent: false, error: e instanceof Error ? e.message : String(e) } };
  }
}
