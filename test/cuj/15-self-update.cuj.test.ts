import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { get as metaGet } from "../../src/db/meta";
import { buildDeps } from "../../src/deps";
import { checkSelfUpdate } from "../../src/services/self-update";
import { cleanDb } from "../support/db";
import { recordingEmailSender } from "../support/email";

// CUJ-15 (§22) — Tool self-update. The cron fetches the manifest, records the result in meta, and
// emails the operator exactly once per new version. The manifest fetch is mocked (offline).
const base = buildDeps(env);
beforeEach(cleanDb);

function manifestFetch(body: unknown, status = 200): typeof fetch {
  return (async () => new Response(JSON.stringify(body), { status })) as typeof fetch;
}

describe("CUJ-15 self-update", () => {
  it("detects a newer version, stores it, and notifies the operator once", async () => {
    const email = recordingEmailSender();
    const deps = { ...base, email, fetch: manifestFetch({ latest: "1.3.0", breaking: false }) };
    const opts = {
      toolVersion: "1.2.0",
      manifestUrl: "https://x/release.json",
      ownerEmail: "owner@x",
    };

    await checkSelfUpdate(deps, opts);
    expect(await metaGet(deps.db, "selfupdate_available")).toBe("1");
    expect(await metaGet(deps.db, "selfupdate_latest")).toBe("1.3.0");
    expect(email.outbox).toHaveLength(1);

    // Same version again → deduped, no second email.
    await checkSelfUpdate(deps, opts);
    expect(email.outbox).toHaveLength(1);
  });

  it("records notes_url, breaking, and below-min, and links the notes in the email", async () => {
    const email = recordingEmailSender();
    const deps = {
      ...base,
      email,
      fetch: manifestFetch({
        latest: "2.0.0",
        min_supported: "1.5.0",
        notes_url: "https://example.com/notes",
        breaking: true,
      }),
    };
    await checkSelfUpdate(deps, {
      toolVersion: "1.2.0",
      manifestUrl: "https://x",
      ownerEmail: "owner@x",
    });

    expect(await metaGet(deps.db, "selfupdate_breaking")).toBe("1");
    expect(await metaGet(deps.db, "selfupdate_below_min")).toBe("1");
    expect(await metaGet(deps.db, "selfupdate_notes_url")).toBe("https://example.com/notes");
    expect(email.outbox[0]?.body).toContain("https://example.com/notes");
    expect(email.outbox[0]?.body).toContain("breaking");
  });

  it("ignores an unsafe (javascript:) notes_url — stores empty, never links it", async () => {
    const email = recordingEmailSender();
    const deps = {
      ...base,
      email,
      fetch: manifestFetch({ latest: "2.0.0", notes_url: "javascript:alert(1)" }),
    };
    await checkSelfUpdate(deps, {
      toolVersion: "1.2.0",
      manifestUrl: "https://x",
      ownerEmail: "owner@x",
    });
    expect(await metaGet(deps.db, "selfupdate_notes_url")).toBe("");
    expect(email.outbox[0]?.body).not.toContain("javascript:");
  });

  it("reports no update and sends nothing when already current", async () => {
    const email = recordingEmailSender();
    const deps = { ...base, email, fetch: manifestFetch({ latest: "1.3.0" }) };
    await checkSelfUpdate(deps, {
      toolVersion: "1.3.0",
      manifestUrl: "https://x",
      ownerEmail: "owner@x",
    });
    expect(await metaGet(deps.db, "selfupdate_available")).toBe("0");
    expect(email.outbox).toHaveLength(0);
  });

  it("swallows a failed manifest fetch without throwing", async () => {
    const deps = {
      ...base,
      email: recordingEmailSender(),
      fetch: (() => Promise.reject(new Error("network"))) as typeof fetch,
    };
    await expect(
      checkSelfUpdate(deps, { toolVersion: "1.2.0", manifestUrl: "https://x", ownerEmail: null }),
    ).resolves.toBeUndefined();
  });
});
