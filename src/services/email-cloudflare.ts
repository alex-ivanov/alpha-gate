import type { ComposedEmail, EmailSender } from "./email";

// §24 — the Cloudflare Email Service adapter (EMAIL_PROVIDER="cloudflare"). It composes an RFC 5322
// message from the purely-composed invite (core/invite-template) and hands it to the `send_email`
// binding via cloudflare:email's EmailMessage. ACTUAL DELIVERY is real-infra-only — it needs Workers
// Paid + an onboarded sending domain, so it is exercised against live Cloudflare, never in the offline
// test runtime (§23). The MIME composition below is pure and unit-tested; cloudflare:email is imported
// lazily inside send() so the test module graph never loads a binding it can't satisfy.

export interface CloudflareEmailDeps {
  /** The `EMAIL` send_email binding (admin Worker only). */
  binding: SendEmail;
  /** The verified From address on the onboarded sending domain (EMAIL_FROM). */
  from: string;
  /** RFC 5322 date for the `Date:` header — the clock seam (lib/clock emailDate). */
  emailDate: () => string;
}

export function createCloudflareEmailSender(deps: CloudflareEmailDeps): EmailSender {
  return {
    async send(email: ComposedEmail): Promise<void> {
      // Lazy: only the real send path touches cloudflare:email (unavailable/irrelevant in tests).
      const { EmailMessage } = await import("cloudflare:email");
      const date = deps.emailDate();
      const raw = composeMimeMessage({
        from: deps.from,
        to: email.to,
        subject: email.subject,
        body: email.body,
        date,
        messageId: makeMessageId(deps.from, email.to, date),
      });
      await deps.binding.send(new EmailMessage(deps.from, email.to, raw));
    },
  };
}

export interface MimeParts {
  from: string;
  to: string;
  subject: string;
  body: string;
  date: string;
  messageId: string;
}

/**
 * Pure RFC 5322 plain-text message builder. Header values are stripped of CR/LF to prevent header
 * injection (a hostile app name in the subject must not be able to forge headers); the body is
 * normalised to CRLF line endings and separated from the headers by a blank line.
 */
export function composeMimeMessage(parts: MimeParts): string {
  const headers = [
    `From: ${sanitizeHeader(parts.from)}`,
    `To: ${sanitizeHeader(parts.to)}`,
    `Subject: ${sanitizeHeader(parts.subject)}`,
    `Message-ID: ${sanitizeHeader(parts.messageId)}`,
    `Date: ${sanitizeHeader(parts.date)}`,
    "MIME-Version: 1.0",
    "Content-Type: text/plain; charset=utf-8",
  ];
  const body = parts.body.replace(/\r\n/g, "\n").replace(/\n/g, "\r\n");
  return `${headers.join("\r\n")}\r\n\r\n${body}`;
}

/** A deterministic, header-safe Message-ID derived from the date + recipient + sender domain. */
export function makeMessageId(from: string, to: string, date: string): string {
  const at = from.lastIndexOf("@");
  const domain = at >= 0 ? from.slice(at + 1) : "alpha-gate.local";
  const local = idSafe(`${date}.${to}`);
  return `<${local}@${idSafe(domain)}>`;
}

function sanitizeHeader(value: string): string {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function idSafe(value: string): string {
  return value.replace(/[^A-Za-z0-9.-]/g, "-");
}
