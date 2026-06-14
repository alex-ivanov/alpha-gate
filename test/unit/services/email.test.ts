import { describe, expect, it } from "vitest";
import type { Env } from "../../../src/env";
import { emailStatus, noopEmailSender, selectEmailSender } from "../../../src/services/email";
import {
  composeMimeMessage,
  createCloudflareEmailSender,
  makeMessageId,
} from "../../../src/services/email-cloudflare";

// §24 — the Cloudflare email adapter. Only the MIME COMPOSITION and the provider SELECTION are unit
// tested; actual delivery via the send_email binding is real-infra-only and not exercised here (§23).

const DATE = "Fri, 13 Jun 2026 12:00:00 GMT";

describe("composeMimeMessage", () => {
  it("builds a plain-text RFC 5322 message with the expected headers and CRLF body separator", () => {
    const raw = composeMimeMessage({
      from: "alpha@example.com",
      to: "user@example.test",
      subject: "You're invited",
      body: "Hi,\n\nHere is your link.",
      date: DATE,
      messageId: "<id@example.com>",
    });

    expect(raw).toContain("From: alpha@example.com");
    expect(raw).toContain("To: user@example.test");
    expect(raw).toContain("Subject: You're invited");
    expect(raw).toContain(`Date: ${DATE}`);
    expect(raw).toContain("MIME-Version: 1.0");
    expect(raw).toContain("Content-Type: text/plain; charset=utf-8");
    expect(raw).toContain("\r\n\r\n"); // header/body separator
    expect(raw).toContain("Here is your link.");
    expect(raw).toContain("Hi,\r\n\r\nHere is your link."); // body normalised to CRLF
  });

  it("strips CR/LF from header values to prevent header injection", () => {
    const raw = composeMimeMessage({
      from: "alpha@example.com",
      to: "user@example.test",
      // A hostile app name in the subject must not be able to forge a Bcc header.
      subject: "Hello\r\nBcc: victim@example.test",
      body: "body",
      date: DATE,
      messageId: "<id@example.com>",
    });

    // The injected CRLF is collapsed, so "Bcc:" survives only inside the Subject value, never as its
    // own header line (which is what would actually add a recipient).
    expect(raw).not.toMatch(/\r\nBcc:/);
    expect(raw).toContain("Subject: Hello Bcc: victim@example.test");
  });
});

describe("makeMessageId", () => {
  it("is header-safe and uses the sender's domain", () => {
    const id = makeMessageId("alpha@example.com", "user@example.test", DATE);
    expect(id.startsWith("<")).toBe(true);
    expect(id.endsWith("@example.com>")).toBe(true);
    expect(id).not.toMatch(/[\r\n\s]/); // no whitespace/newlines in the id
  });

  it("is deterministic for the same inputs", () => {
    const a = makeMessageId("alpha@example.com", "u@x.test", DATE);
    const b = makeMessageId("alpha@example.com", "u@x.test", DATE);
    expect(a).toBe(b);
  });
});

const fakeBinding = { send: async () => ({}) } as unknown as NonNullable<Env["EMAIL"]>;

function emailEnv(overrides: Partial<Env>): Env {
  return { EMAIL_PROVIDER: "none", EMAIL_FROM: "", ...overrides } as Env;
}

describe("emailStatus", () => {
  it("is copy-paste when the provider is none (the intentional free-tier default)", () => {
    const s = emailStatus(emailEnv({ EMAIL_PROVIDER: "none" }));
    expect(s.mode).toBe("copy-paste");
    expect(s.missing).toEqual([]);
  });

  it("is active only when provider, binding, and From are all present", () => {
    const s = emailStatus(
      emailEnv({
        EMAIL_PROVIDER: "cloudflare",
        EMAIL_FROM: "alpha@example.com",
        EMAIL: fakeBinding,
      }),
    );
    expect(s.mode).toBe("active");
    expect(s.from).toBe("alpha@example.com");
    expect(s.missing).toEqual([]);
  });

  it("is incomplete (not active) when cloudflare is set but the binding is absent", () => {
    const s = emailStatus(emailEnv({ EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "a@x.com" }));
    expect(s.mode).toBe("incomplete");
    expect(s.missing).toContain("the EMAIL send_email binding");
  });

  it("is incomplete when cloudflare is set but From is empty", () => {
    const s = emailStatus(
      emailEnv({ EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "", EMAIL: fakeBinding }),
    );
    expect(s.mode).toBe("incomplete");
    expect(s.missing).toContain("a From address (EMAIL_FROM)");
  });

  it("lists every missing prerequisite when cloudflare is set with nothing wired", () => {
    const s = emailStatus(emailEnv({ EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "" }));
    expect(s.mode).toBe("incomplete");
    expect(s.missing).toHaveLength(2);
  });
});

describe("selectEmailSender", () => {
  function env(overrides: Partial<Env>): Env {
    return emailEnv(overrides);
  }

  it("falls back to copy-paste when the provider is none", () => {
    expect(selectEmailSender(env({ EMAIL_PROVIDER: "none" }), () => DATE)).toBe(noopEmailSender);
  });

  it("falls back to copy-paste when cloudflare is selected but the binding is absent", () => {
    const sender = selectEmailSender(
      env({ EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "alpha@example.com" }),
      () => DATE,
    );
    expect(sender).toBe(noopEmailSender);
  });

  it("falls back to copy-paste when cloudflare is selected but From is empty", () => {
    const sender = selectEmailSender(
      env({ EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "", EMAIL: fakeBinding }),
      () => DATE,
    );
    expect(sender).toBe(noopEmailSender);
  });

  it("returns the Cloudflare adapter when fully configured", () => {
    const sender = selectEmailSender(
      env({ EMAIL_PROVIDER: "cloudflare", EMAIL_FROM: "alpha@example.com", EMAIL: fakeBinding }),
      () => DATE,
    );
    expect(sender).not.toBe(noopEmailSender);
    expect(typeof sender.send).toBe("function");
  });
});

describe("createCloudflareEmailSender (composition wiring)", () => {
  it("constructs a sender without touching cloudflare:email until send() is called", () => {
    // Constructing must not import cloudflare:email (real-infra-only); this just proves it's lazy.
    const sender = createCloudflareEmailSender({
      binding: { send: async () => ({}) } as unknown as SendEmail,
      from: "alpha@example.com",
      emailDate: () => DATE,
    });
    expect(typeof sender.send).toBe("function");
  });
});
