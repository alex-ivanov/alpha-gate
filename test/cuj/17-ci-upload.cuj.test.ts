import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../src/db/admin-audit";
import { getByBuildNumber, listBuildStreams } from "../../src/db/builds";
import * as streams from "../../src/db/streams";
import { buildDeps } from "../../src/deps";
import { getObject, putArchive } from "../../src/r2/builds-bucket";
import { adminWorker, setupTestAccess, type TestAccess } from "../support/access";
import { resetAll } from "../support/db";

// CUJ-17 (§20) — Publish via CI. A Cloudflare Access service token uploads + registers a build (no
// interactive login). The Worker stores the bytes + the supplied EdDSA signature and the build row.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

function tokenHeaders(token: string): HeadersInit {
  return { "Cf-Access-Jwt-Assertion": token };
}

describe("CUJ-17 publish via CI", () => {
  it("a service token uploads an archive and registers the build", async () => {
    const stable = await streams.create(deps.db, "stable");

    const form = new FormData();
    form.set("archive", new File(["ZIPBYTES!"], "App.zip", { type: "application/zip" }));
    form.set("short_version", "1.4.0");
    form.set("build_number", "1500");
    form.set("ed_signature", "ed-sig");
    form.set("stream_id", String(stable.id));

    const res = await adminWorker(access).request("/admin/builds/upload", {
      method: "POST",
      headers: tokenHeaders(await access.signValidService("ci-bot")),
      body: form,
    });
    expect(res.status).toBe(201);
    // CI contract: a service token always gets machine JSON, never an HTML page.
    expect(res.headers.get("content-type")).toContain("application/json");
    expect(await res.json()).toMatchObject({ ok: true, buildNumber: 1500 });

    const build = await getByBuildNumber(deps.db, 1500);
    expect(build?.objectKey).toBe("build/1500/App.zip");
    expect(build?.length).toBe(9);
    expect(await (await getObject(deps.r2, "build/1500/App.zip"))?.text()).toBe("ZIPBYTES!");
    expect(
      (await listBuildStreams(deps.db)).some(
        (l) => l.buildId === build?.id && l.streamId === stable.id,
      ),
    ).toBe(true);
    // attributed to the service token's common name
    expect(
      (await listInOrder(deps.db)).some(
        (r) => r.action === "build.upload" && r.actorEmail === "ci-bot",
      ),
    ).toBe(true);
  });

  it("rejects an upload with no Access token", async () => {
    const form = new FormData();
    form.set("archive", new File(["x"], "App.zip"));
    form.set("short_version", "1.4.0");
    form.set("build_number", "1500");
    form.set("ed_signature", "s");
    const res = await adminWorker(access).request("/admin/builds/upload", {
      method: "POST",
      body: form,
    });
    expect(res.status).toBe(403);
  });

  it("register asserts the stored object's size matches the declared length", async () => {
    await putArchive(deps.r2, 1600, "App.zip", "TEN_BYTES!"); // 10 bytes

    const wrong = new URLSearchParams({
      object_key: "build/1600/App.zip",
      size: "999",
      short_version: "1.5.0",
      build_number: "1600",
      ed_signature: "s",
    });
    const bad = await adminWorker(access).request("/admin/builds/register", {
      method: "POST",
      headers: {
        ...tokenHeaders(await access.signValidService()),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: wrong.toString(),
    });
    expect(bad.status).toBe(400);
    expect(await getByBuildNumber(deps.db, 1600)).toBeNull(); // no row inserted

    const right = new URLSearchParams({
      object_key: "build/1600/App.zip",
      size: "10",
      short_version: "1.5.0",
      build_number: "1600",
      ed_signature: "s",
    });
    const ok = await adminWorker(access).request("/admin/builds/register", {
      method: "POST",
      headers: {
        ...tokenHeaders(await access.signValidService()),
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: right.toString(),
    });
    expect(ok.status).toBe(201);
    expect((await getByBuildNumber(deps.db, 1600))?.length).toBe(10);
  });

  it("a browser upload (human + Accept: text/html) lands on a confirmation page, not JSON", async () => {
    const form = new FormData();
    form.set("archive", new File(["ZIPBYTES!"], "App.zip", { type: "application/zip" }));
    form.set("short_version", "1.4.0");
    form.set("build_number", "1500");
    form.set("ed_signature", "ed-sig");

    const res = await adminWorker(access).request("/admin/builds/upload", {
      method: "POST",
      headers: { ...tokenHeaders(await access.signValidUser()), Accept: "text/html" },
      body: form,
    });
    expect(res.status).toBe(201);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Build published");
    expect(html).toContain("1500"); // the build number is shown
    expect(html).toContain("/admin/builds"); // a real way forward
    expect(html).not.toContain('{"ok"'); // not the raw JSON the browser used to render
    expect(await getByBuildNumber(deps.db, 1500)).not.toBeNull(); // and it really published
  });

  it("a browser upload with a bad field gets an HTML error page, not bare text", async () => {
    const form = new FormData();
    form.set("archive", new File(["x"], "App.zip"));
    form.set("short_version", "1.4.0"); // build_number missing
    form.set("ed_signature", "s");

    const res = await adminWorker(access).request("/admin/builds/upload", {
      method: "POST",
      headers: { ...tokenHeaders(await access.signValidUser()), Accept: "text/html" },
      body: form,
    });
    expect(res.status).toBe(400);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Upload failed");
    expect(html).toContain("build_number"); // the specific validation message
  });

  it("re-uploading an existing build_number is a clear 409, not a 500 — and leaves no orphan in R2", async () => {
    async function upload(name: string, accept = "text/html"): Promise<Response> {
      const form = new FormData();
      form.set("archive", new File(["ZIPBYTES!"], name, { type: "application/zip" }));
      form.set("short_version", "1.4.0");
      form.set("build_number", "1500");
      form.set("ed_signature", "ed-sig");
      return adminWorker(access).request("/admin/builds/upload", {
        method: "POST",
        headers: { ...tokenHeaders(await access.signValidUser()), Accept: accept },
        body: form,
      });
    }

    expect((await upload("App.zip")).status).toBe(201);

    // Second upload of the SAME build number, with a different archive name so an orphan would be visible.
    const dup = await upload("App-take-two.zip");
    expect(dup.status).toBe(409); // not a bare 500 "internal error"
    const html = await dup.text();
    expect(html).toContain("Upload failed");
    expect(html).toContain("already exists"); // actionable, names the conflict
    // The duplicate was rejected BEFORE the R2 PUT, so no second archive was written.
    expect(await getObject(deps.r2, "build/1500/App-take-two.zip")).toBeNull();
  });

  it("registering a duplicate build_number returns 409 text for CI (not a 500)", async () => {
    await putArchive(deps.r2, 1700, "App.zip", "TEN_BYTES!");
    const params = () =>
      new URLSearchParams({
        object_key: "build/1700/App.zip",
        size: "10",
        short_version: "1.7.0",
        build_number: "1700",
        ed_signature: "s",
      }).toString();
    const headers = async () => ({
      ...tokenHeaders(await access.signValidService()),
      "Content-Type": "application/x-www-form-urlencoded",
    });

    const first = await adminWorker(access).request("/admin/builds/register", {
      method: "POST",
      headers: await headers(),
      body: params(),
    });
    expect(first.status).toBe(201);

    const dup = await adminWorker(access).request("/admin/builds/register", {
      method: "POST",
      headers: await headers(),
      body: params(),
    });
    expect(dup.status).toBe(409);
    expect(await dup.text()).toContain("already exists"); // CI gets plain text, but still actionable
  });
});
