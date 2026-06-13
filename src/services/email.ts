import type { EmailProvider } from "../env";

// §13/§24 — the email seam. Invites are composed purely (core/invite-template); this only delivers.
// The free-tier default is copy-paste: nothing is sent and the admin UI surfaces the /get link. The
// Cloudflare Email Service adapter (EMAIL_PROVIDER="cloudflare", Workers Paid + an onboarded sending
// domain) is a deferred follow-up — exercised only against real infra (§23) — so until it is wired
// every provider falls back to copy-paste. The interface keeps callers unchanged when it lands.

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

export function selectEmailSender(_provider: EmailProvider): EmailSender {
  // TODO: return a CloudflareEmailSender(send_email binding) when EMAIL_PROVIDER === "cloudflare".
  return noopEmailSender;
}
