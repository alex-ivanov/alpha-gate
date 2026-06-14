import { describe, expect, it } from "vitest";
import { adminToAppOrigin, inviteUrl } from "../../../src/lib/hosts";

describe("adminToAppOrigin", () => {
  it("drops the -admin suffix to get the public App Worker origin", () => {
    expect(adminToAppOrigin("https://alpha-gate-myalpha-admin.acct.workers.dev")).toBe(
      "https://alpha-gate-myalpha.acct.workers.dev",
    );
  });

  it("ignores path/query and keeps the protocol", () => {
    expect(adminToAppOrigin("https://alpha-gate-x-admin.acct.workers.dev/admin/setup?a=1")).toBe(
      "https://alpha-gate-x.acct.workers.dev",
    );
  });

  it("returns null for a custom (non-workers.dev) domain — can't know the app host", () => {
    expect(adminToAppOrigin("https://admin.example.com")).toBeNull();
  });

  it("returns null when the host isn't an -admin worker", () => {
    expect(adminToAppOrigin("https://alpha-gate-x.acct.workers.dev")).toBeNull();
  });

  it("returns null for a malformed URL", () => {
    expect(adminToAppOrigin("not a url")).toBeNull();
  });
});

describe("inviteUrl", () => {
  it("builds the /get link on the public App host, not the gated Admin host", () => {
    expect(inviteUrl("https://alpha-gate-acme-admin.acct.workers.dev/admin/clients", "ABC")).toBe(
      "https://alpha-gate-acme.acct.workers.dev/get?token=ABC",
    );
  });

  it("url-encodes the token", () => {
    expect(inviteUrl("https://alpha-gate-x-admin.acct.workers.dev/admin", "a/b+c")).toBe(
      "https://alpha-gate-x.acct.workers.dev/get?token=a%2Fb%2Bc",
    );
  });

  it("falls back to the request origin when the app host can't be derived (local dev)", () => {
    expect(inviteUrl("http://localhost:8788/admin/clients", "ABC")).toBe(
      "http://localhost:8788/get?token=ABC",
    );
  });
});
