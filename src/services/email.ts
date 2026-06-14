import type { Env } from "../env";
import { createCloudflareEmailSender } from "./email-cloudflare";

// §13/§24 — the email seam. Invites are composed purely (core/invite-template); this only delivers.
// The free-tier default is copy-paste: nothing is sent and the admin UI surfaces the /get link. The
// Cloudflare Email Service adapter (EMAIL_PROVIDER="cloudflare", Workers Paid + an onboarded sending
// domain + the `EMAIL` send_email binding) delivers for real; its actual send is real-infra-only (§23).
// Anything misconfigured falls back to copy-paste so a missing binding never throws at request time.

export interface ComposedEmail {
  to: string;
  subject: string;
  body: string;
}

export interface EmailSender {
  send(email: ComposedEmail): Promise<void>;
}

/** Copy-paste mode: nothing leaves the Worker; the invite link is shown in the back office. */
export const noopEmailSender: EmailSender = {
  async send() {
    // intentionally no-op
  },
};

export type EmailMode =
  | "active" // provider=cloudflare, fully wired — invites are actually emailed
  | "incomplete" // provider=cloudflare but a prerequisite is missing — silently falls back to copy-paste
  | "copy-paste"; // provider=none — intentional free-tier default; the back office shows the link

export interface EmailStatus {
  mode: EmailMode;
  /** EMAIL_FROM as configured (may be empty). */
  from: string;
  /** For "incomplete": the human-readable prerequisites the cloudflare provider is still missing. */
  missing: string[];
}

/**
 * The true email-delivery state for this Worker — the single source of truth shared by delivery
 * (selectEmailSender) and the admin UI, so what the Settings page reports can't drift from what actually
 * sends. Cloudflare delivery needs ALL of: provider="cloudflare", the `EMAIL` binding (admin Worker only,
 * added by deploy when email is on), and a non-empty From. Any gap with provider="cloudflare" is
 * "incomplete" — delivery quietly falls back to copy-paste, which the UI must call out rather than hide.
 */
export function emailStatus(env: Env): EmailStatus {
  const from = env.EMAIL_FROM;
  if (env.EMAIL_PROVIDER !== "cloudflare") return { mode: "copy-paste", from, missing: [] };
  const missing: string[] = [];
  if (env.EMAIL === undefined) missing.push("the EMAIL send_email binding");
  if (from.length === 0) missing.push("a From address (EMAIL_FROM)");
  return missing.length > 0
    ? { mode: "incomplete", from, missing }
    : { mode: "active", from, missing };
}

/**
 * Picks the delivery adapter from the runtime env, off the same {@link emailStatus} the UI reports. Only
 * "active" delivers for real; everything else falls back to copy-paste rather than fail. `emailDate` is
 * the clock seam for the Date header.
 */
export function selectEmailSender(env: Env, emailDate: () => string): EmailSender {
  if (emailStatus(env).mode === "active" && env.EMAIL !== undefined) {
    return createCloudflareEmailSender({ binding: env.EMAIL, from: env.EMAIL_FROM, emailDate });
  }
  return noopEmailSender;
}
