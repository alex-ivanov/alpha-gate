import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../../src/db/admin-audit";
import * as builds from "../../../src/db/builds";
import { create as createStream } from "../../../src/db/streams";
import { buildDeps } from "../../../src/deps";
import { headObject } from "../../../src/r2/builds-bucket";
import {
  adminWorker,
  setupTestAccess,
  type TestAccess,
  withToken,
  withTokenForm,
} from "../../support/access";
import { resetAll } from "../../support/db";
import { seedServableClient } from "../../support/scenario";

// The operator-simplification publish surface: channel-by-NAME on upload/register, the
// service-token-allowed /admin/publish-info read helper, and the withdrawn-build archive purge
// (storage lifecycle). All keep the "never a DB row id / never a bare 500" principles.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

const userToken = () => access.signValidUser();

function uploadForm(fields: Record<string, string>): FormData {
  const form = new FormData();
  form.set("archive", new File(["ARCHIVE-BYTES"], "App.zip", { type: "application/zip" }));
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  return form;
}

async function upload(token: string, fields: Record<string, string>): Promise<Response> {
  return adminWorker(access).request("/admin/builds/upload", {
    method: "POST",
    headers: { "Cf-Access-Jwt-Assertion": token },
    body: uploadForm(fields),
  });
}

describe("publish by channel NAME", () => {
  const base = { short_version: "2.0.0", ed_signature: "SIG==" };

  it("links the build to the channel named by --channel (no DB id needed)", async () => {
    const stream = await createStream(deps.db, "beta");
    const res = await upload(await userToken(), {
      ...base,
      build_number: "20001",
      channel: "beta",
    });
    expect(res.status).toBe(201);
    const build = await builds.getByBuildNumber(deps.db, 20001);
    const links = await builds.listBuildStreams(deps.db);
    expect(links).toContainEqual({ buildId: build?.id, streamId: stream.id });
  });

  it("an unknown channel name is a 400 listing what exists — and publishes nothing", async () => {
    await createStream(deps.db, "stable");
    const res = await upload(await userToken(), {
      ...base,
      build_number: "20002",
      channel: "typo",
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("stable"); // names the real channels
    expect(await builds.getByBuildNumber(deps.db, 20002)).toBeNull(); // nothing half-registered
  });

  it("rejects giving both stream_id and channel", async () => {
    const stream = await createStream(deps.db, "beta");
    const res = await upload(await userToken(), {
      ...base,
      build_number: "20003",
      channel: "beta",
      stream_id: String(stream.id),
    });
    expect(res.status).toBe(400);
  });
});

describe("GET /admin/publish-info", () => {
  it("returns the top build, channels, and cap — and admits a service token", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    await createStream(deps.db, "beta");

    const res = await adminWorker(access).request(
      "/admin/publish-info",
      withToken(await access.signValidService()), // publish-scoped read (decision 0006)
    );
    expect(res.status).toBe(200);
    const info = (await res.json()) as {
      topBuild: number;
      nextBuildHint: number;
      channels: { name: string }[];
      maxUploadBytes: number;
    };
    expect(info.topBuild).toBe(1500);
    expect(info.nextBuildHint).toBe(1501);
    expect(info.channels.map((c) => c.name)).toEqual(expect.arrayContaining(["stable", "beta"]));
    expect(info.maxUploadBytes).toBeGreaterThan(0);
  });
});

describe("archive purge (storage lifecycle)", () => {
  it("purges a withdrawn build's bytes, keeps the row, and blocks restore", async () => {
    const { build } = await seedServableClient(deps, { buildNumber: 1500 });
    // The archive exists in R2 after seeding.
    expect(await headObject(deps.r2, build.objectKey)).not.toBeNull();

    // Purge is refused while available.
    const early = await adminWorker(access).request(
      `/admin/builds/${build.id}/purge-archive`,
      withTokenForm(await userToken(), { confirm: "true" }),
    );
    expect(early.status).toBe(409);
    expect(await early.text()).toContain("Withdraw it first");

    await builds.setStatus(deps.db, build.id, "withdrawn");

    // Unconfirmed → confirmation page naming the build.
    const confirm = await adminWorker(access).request(
      `/admin/builds/${build.id}/purge-archive`,
      withTokenForm(await userToken(), {}),
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("Purge the archive");
    expect(await headObject(deps.r2, build.objectKey)).not.toBeNull(); // not yet gone

    // Confirmed → bytes deleted, row stamped, audit recorded.
    const done = await adminWorker(access).request(
      `/admin/builds/${build.id}/purge-archive`,
      withTokenForm(await userToken(), { confirm: "true" }),
    );
    expect(done.status).toBe(303);
    expect(await headObject(deps.r2, build.objectKey)).toBeNull(); // R2 bytes gone
    const row = await builds.getById(deps.db, build.id);
    expect(row?.purgedAt).not.toBeNull(); // row kept + stamped
    expect((await listInOrder(deps.db)).some((r) => r.action === "build.purge")).toBe(true);

    // Restore is now blocked — the archive is gone.
    const restore = await adminWorker(access).request(
      `/admin/builds/${build.id}/restore`,
      withTokenForm(await userToken(), {}),
    );
    expect(restore.status).toBe(409);
    expect(await restore.text()).toContain("Archive was purged");
  });

  it("the Builds page shows archive sizes and a stored total", async () => {
    await seedServableClient(deps, { buildNumber: 1500 });
    const html = await (
      await adminWorker(access).request("/admin/builds", withToken(await userToken()))
    ).text();
    expect(html).toContain("of archives"); // the stored-total line
    expect(html).toMatch(/>Size</); // the per-build size column header
  });
});

describe("reason-bearing admin 403", () => {
  it("names the AUD-mismatch category when a JWT was presented, stays bare otherwise", async () => {
    // A wrong-audience token: a real Access session against a recreated app.
    const wrongAud = await access.sign(access.validUserClaims({ aud: "stale-aud" }));
    const named = await adminWorker(access).request("/admin", withToken(wrongAud));
    expect(named.status).toBe(403);
    const body = await named.text();
    expect(body).toContain("AUD");
    expect(body).toContain("deploy.sh");

    // No token at all → nothing revealed (never passed edge Access).
    const bare = await adminWorker(access).request("/admin");
    expect(bare.status).toBe(403);
    expect(await bare.text()).toBe("Forbidden");
  });
});
