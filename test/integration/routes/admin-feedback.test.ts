import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as accessRequests from "../../../src/db/access-requests";
import { listInOrder } from "../../../src/db/admin-audit";
import * as builds from "../../../src/db/builds";
import * as clients from "../../../src/db/clients";
import * as streams from "../../../src/db/streams";
import { buildDeps } from "../../../src/deps";
import {
  adminWorker,
  setupTestAccess,
  type TestAccess,
  withToken,
  withTokenForm,
} from "../../support/access";
import { resetAll } from "../../support/db";
import { seedServableClient } from "../../support/scenario";

// The post-action feedback + safety contract of the redesigned back office:
//  - mutations 303 back to the page the operator acted from (validated return_to) with a flash
//    notice the target page renders;
//  - destructive actions (revoke, reissue, delete channel) are confirmed, and revoked users can be
//    REACTIVATED (the old dead-link trap);
//  - stale forms (deleted channel/build) are clear 400s BEFORE any write — never half-applied 500s;
//  - re-posts that change nothing are flash no-ops, not phantom audit rows.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

const userToken = () => access.signValidUser();

async function postAdmin(path: string, fields: Record<string, string>): Promise<Response> {
  return adminWorker(access).request(path, withTokenForm(await userToken(), fields));
}

async function getAdmin(path: string): Promise<string> {
  return (await adminWorker(access).request(path, withToken(await userToken()))).text();
}

describe("return_to + flash", () => {
  it("a mutation 303s back to the page it was made from, carrying a flash the page renders", async () => {
    const { client } = await seedServableClient(deps);

    const res = await postAdmin(`/admin/clients/${client.id}/revoke`, {
      confirm: "true",
      return_to: `/admin/users/${client.id}`,
    });
    expect(res.status).toBe(303);
    const location = res.headers.get("location") ?? "";
    expect(location).toContain(`/admin/users/${client.id}`);
    expect(location).toContain("done=user.revoked");

    const page = await getAdmin(location);
    expect(page).toContain("Revoked user@example.test");
  });

  it("rejects a tampered return_to (external URL, protocol-relative, non-admin path)", async () => {
    const { client } = await seedServableClient(deps);
    for (const evil of ["https://evil.example/x", "//evil.example", "/get?token=x", "/admin//x"]) {
      const res = await postAdmin(`/admin/clients/${client.id}/hidden`, {
        hidden: "true",
        return_to: evil,
      });
      expect(res.status).toBe(303);
      expect(res.headers.get("location") ?? "").toMatch(/^\/admin\/users\?/); // fallback, not `evil`
    }
  });

  it("an unknown flash slug renders as a plain Done, not an injected message", async () => {
    const page = await getAdmin("/admin/users?done=totally.bogus&s=IGNORED");
    expect(page).toContain("Done.");
    expect(page).not.toContain("IGNORED");
  });
});

describe("revoke / reactivate / reissue", () => {
  it("reactivate restores a revoked user and their existing link", async () => {
    const { client, token } = await seedServableClient(deps);
    await clients.setStatus(deps.db, client.id, "revoked");

    const res = await postAdmin(`/admin/clients/${client.id}/reactivate`, {});
    expect(res.status).toBe(303);
    const updated = await clients.getById(deps.db, client.id);
    expect(updated?.status).toBe("active");
    expect(updated?.token).toBe(token); // the SAME link revives — no rotation
    expect((await listInOrder(deps.db)).some((r) => r.action === "client.reactivate")).toBe(true);
  });

  it("reactivating an already-active user is a no-op flash, not a phantom audit row", async () => {
    const { client } = await seedServableClient(deps);
    const res = await postAdmin(`/admin/clients/${client.id}/reactivate`, {});
    expect(res.status).toBe(303);
    expect(res.headers.get("location") ?? "").toContain("done=noop");
    expect((await listInOrder(deps.db)).some((r) => r.action === "client.reactivate")).toBe(false);
  });

  it("reissue on a REVOKED user offers reactivate-and-reissue, and confirming restores access", async () => {
    const { client } = await seedServableClient(deps);
    await clients.setStatus(deps.db, client.id, "revoked");

    const confirm = await postAdmin(`/admin/clients/${client.id}/reissue`, {});
    expect(await confirm.text()).toContain("Reactivate"); // no dead-link trap: the page says what happens

    const res = await postAdmin(`/admin/clients/${client.id}/reissue`, { confirm: "true" });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("/get?token=");
    expect((await clients.getById(deps.db, client.id))?.status).toBe("active");
  });

  it("the duplicate-email 409 for a revoked user recommends Reactivate, not the dead-link Reissue", async () => {
    const { client } = await seedServableClient(deps);
    await clients.setStatus(deps.db, client.id, "revoked");
    const res = await postAdmin("/admin/clients", { email: client.email });
    expect(res.status).toBe(409);
    expect(await res.text()).toContain("Reactivate");
  });
});

describe("stale-form safety (no half-applied writes)", () => {
  it("add user with a deleted channel is a clear 400 and creates NO user", async () => {
    const res = await postAdmin("/admin/clients", { email: "zoe@example.test", streamId: "999" });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("channel");
    expect(await clients.list(deps.db)).toHaveLength(0); // nothing half-created
  });

  it("upload with a deleted channel is a clear 400 and registers NO build", async () => {
    const form = new FormData();
    form.set("archive", new File(["BYTES"], "App.zip", { type: "application/zip" }));
    form.set("short_version", "2.0.0");
    form.set("build_number", "9001");
    form.set("ed_signature", "SIG==");
    form.set("stream_id", "999");
    const res = await adminWorker(access).request("/admin/builds/upload", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await userToken() },
      body: form,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Channel 999 not found");
    expect(await builds.getByBuildNumber(deps.db, 9001)).toBeNull(); // NOT half-registered
  });

  it("linking a build to a deleted channel is a 400, not a foreign-key 500", async () => {
    const { build } = await seedServableClient(deps);
    const res = await postAdmin(`/admin/builds/${build.id}/streams/link`, { streamId: "999" });
    expect(res.status).toBe(400);
  });

  it("re-linking an already-linked channel is a no-op flash, not a unique-constraint 500", async () => {
    const { build, stream } = await seedServableClient(deps);
    const res = await postAdmin(`/admin/builds/${build.id}/streams/link`, {
      streamId: String(stream.id),
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location") ?? "").toContain("done=noop");
    expect((await listInOrder(deps.db)).some((r) => r.action === "build.link")).toBe(false);
  });

  it("pinning to a nonexistent build is a 400, not a silent dangling pin", async () => {
    const { client } = await seedServableClient(deps);
    const res = await postAdmin(`/admin/clients/${client.id}/pin`, { buildId: "999" });
    expect(res.status).toBe(400);
    expect((await clients.getById(deps.db, client.id))?.pinnedBuildId).toBeNull();
  });
});

describe("publish guards", () => {
  it("rejects a non-integer build number outright (parseInt would truncate it)", async () => {
    for (const bad of ["1.2.3", "1500abc", "-3"]) {
      const form = new FormData();
      form.set("archive", new File(["BYTES"], "App.zip", { type: "application/zip" }));
      form.set("short_version", "2.0.0");
      form.set("build_number", bad);
      form.set("ed_signature", "SIG==");
      const res = await adminWorker(access).request("/admin/builds/upload", {
        method: "POST",
        headers: { "Cf-Access-Jwt-Assertion": await userToken() },
        body: form,
      });
      expect(res.status).toBe(400);
    }
    expect(await builds.getByBuildNumber(deps.db, 1)).toBeNull();
  });

  it("rollback mode enforces the floor: a build number at/below the current highest is rejected", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    const form = new FormData();
    form.set("archive", new File(["BYTES"], "App.zip", { type: "application/zip" }));
    form.set("short_version", "1.3.9");
    form.set("build_number", "1400"); // below the 1500 floor
    form.set("ed_signature", "SIG==");
    form.set("mode", "rollback");
    const res = await adminWorker(access).request("/admin/builds/upload", {
      method: "POST",
      headers: { "Cf-Access-Jwt-Assertion": await userToken() },
      body: form,
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("1500"); // states the floor
    expect(await builds.getByBuildNumber(deps.db, 1400)).toBeNull();
  });
});

describe("channel delete + request handling", () => {
  it("deleting a channel is ALWAYS confirmed, even when nobody would be stranded", async () => {
    const stream = await streams.create(deps.db, "empty-channel");

    const confirm = await postAdmin(`/admin/streams/${stream.id}/delete`, {});
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("empty-channel"); // names its target
    expect(await streams.getById(deps.db, stream.id)).not.toBeNull(); // not deleted yet

    const res = await postAdmin(`/admin/streams/${stream.id}/delete`, { confirm: "true" });
    expect(res.status).toBe(303);
    expect(await streams.getById(deps.db, stream.id)).toBeNull();
  });

  it("dismissing a nonexistent request is a 404, not a phantom audit row", async () => {
    const res = await postAdmin("/admin/pending/999/dismiss", {});
    expect(res.status).toBe(404);
    expect((await listInOrder(deps.db)).some((r) => r.action === "request.dismiss")).toBe(false);
  });

  it("inviting one of several duplicate requests resolves ALL of that email's pending rows", async () => {
    const now = "2026-07-11T00:00:00Z";
    await accessRequests.insert(deps.db, {
      email: "dup@example.test",
      ip: null,
      userAgent: null,
      createdAt: now,
    });
    await accessRequests.insert(deps.db, {
      email: "dup@example.test",
      ip: null,
      userAgent: null,
      createdAt: now,
    });
    const pending = await accessRequests.listByStatus(deps.db, "pending");
    expect(pending.length).toBe(2);

    const res = await postAdmin(`/admin/pending/${pending[0]?.id}/invite`, {});
    expect(res.status).toBe(200);
    expect(await accessRequests.listByStatus(deps.db, "pending")).toHaveLength(0); // both handled
  });

  it("theme toggle: sets the cookie, returns whence toggled, and the page renders it", async () => {
    const res = await postAdmin("/admin/theme", { value: "dark", return_to: "/admin/users" });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toBe("/admin/users");
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toContain("theme=dark");

    const page = await adminWorker(access).request("/admin/users", {
      headers: { "Cf-Access-Jwt-Assertion": await userToken(), Cookie: "theme=dark" },
    });
    expect(await page.text()).toContain('<html lang="en" data-theme="dark">');

    // "system" clears the override — back to following the OS.
    const clear = await postAdmin("/admin/theme", { value: "system" });
    expect(clear.headers.get("set-cookie") ?? "").toMatch(/theme=;|Max-Age=0/);
    // A garbage value changes nothing.
    expect((await postAdmin("/admin/theme", { value: "blink" })).status).toBe(400);
    // No audit rows for a UI preference.
    expect((await listInOrder(deps.db)).some((r) => r.action.startsWith("theme"))).toBe(false);
  });

  it("batch link: several buildId fields link in one POST, skipping dups and ghosts", async () => {
    const { stream, build } = await seedServableClient(deps); // build already linked to stable
    const b2 = await builds.insert(deps.db, {
      shortVersion: "1.5.0",
      buildNumber: 1600,
      objectKey: "build/1600/App.zip",
      edSignature: "s",
      length: 1,
    });
    const b3 = await builds.insert(deps.db, {
      shortVersion: "1.6.0",
      buildNumber: 1700,
      objectKey: "build/1700/App.zip",
      edSignature: "s",
      length: 1,
    });

    const res = await adminWorker(access).request(`/admin/streams/${stream.id}/link`, {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": await userToken(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      // two new builds + one already linked + one that doesn't exist
      body: `buildId=${b2.id}&buildId=${b3.id}&buildId=${build.id}&buildId=999`,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("done=channel.builds-linked");
    expect(res.headers.get("location")).toContain("s=2+builds"); // honest count

    const links = await builds.listBuildStreams(deps.db);
    expect(links.filter((l) => l.streamId === stream.id)).toHaveLength(3); // 1 seeded + 2 new
    const audits = (await listInOrder(deps.db)).filter((r) => r.action === "build.link");
    expect(audits).toHaveLength(2); // no phantom rows for the dup or the ghost
  });

  it("batch assign: several clientId fields assign in one POST; empty selection is a no-op", async () => {
    const { stream } = await seedServableClient(deps);
    const u1 = await clients.insert(deps.db, { email: "u1@example.test", token: "A".repeat(32) });
    const u2 = await clients.insert(deps.db, { email: "u2@example.test", token: "B".repeat(32) });

    const res = await adminWorker(access).request(`/admin/streams/${stream.id}/assign`, {
      method: "POST",
      headers: {
        "Cf-Access-Jwt-Assertion": await userToken(),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: `clientId=${u1.id}&clientId=${u2.id}`,
    });
    expect(res.status).toBe(303);
    expect(res.headers.get("location")).toContain("done=channel.users-assigned");
    const memberships = await streams.listUserStreams(deps.db);
    expect(memberships.filter((m) => m.streamId === stream.id)).toHaveLength(3); // seeded + 2

    // Empty selection (no clientId at all) → flash no-op, not a 400 wall.
    const empty = await postAdmin(`/admin/streams/${stream.id}/assign`, {});
    expect(empty.status).toBe(303);
    expect(empty.headers.get("location")).toContain("done=noop");

    // Nonexistent channel → 404.
    expect((await postAdmin("/admin/streams/999/assign", { clientId: "1" })).status).toBe(404);
  });

  it("no-op re-withdraw of an already-withdrawn build writes no second audit row", async () => {
    const { build } = await seedServableClient(deps);
    await postAdmin(`/admin/builds/${build.id}/withdraw`, { confirm: "true" });
    await postAdmin(`/admin/builds/${build.id}/withdraw`, { confirm: "true" }); // double submit
    const rows = (await listInOrder(deps.db)).filter((r) => r.action === "build.withdraw");
    expect(rows).toHaveLength(1);
  });
});
