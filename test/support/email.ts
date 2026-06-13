import type { ComposedEmail, EmailSender } from "../../src/services/email";

/** A test EmailSender that captures what would have been sent, so tests assert composition. */
export function recordingEmailSender(): EmailSender & { outbox: ComposedEmail[] } {
  const outbox: ComposedEmail[] = [];
  return {
    outbox,
    async send(email: ComposedEmail) {
      outbox.push(email);
    },
  };
}
