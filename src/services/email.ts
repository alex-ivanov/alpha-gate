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

/**
 * Picks the delivery adapter from the runtime env. Cloudflare delivery requires all of: the provider
 * set to "cloudflare", a present `EMAIL` binding (admin Worker only), and a non-empty From — otherwise
 * we fall back to copy-paste rather than fail. `emailDate` is the clock seam for the Date header.
 */
export function selectEmailSender(env: Env, emailDate: () => string): EmailSender {
  if (env.EMAIL_PROVIDER === "cloudflare" && env.EMAIL !== undefined && env.EMAIL_FROM.length > 0) {
    return createCloudflareEmailSender({ binding: env.EMAIL, from: env.EMAIL_FROM, emailDate });
  }
  return noopEmailSender;
}
