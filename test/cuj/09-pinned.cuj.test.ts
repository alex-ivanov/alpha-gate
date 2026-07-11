import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import * as builds from "../../src/db/builds";
import { getById } from "../../src/db/clients";
import { buildDeps } from "../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../support/access";
import { resetAll } from "../support/db";
import { publishBuild, seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-9 (§12.8) — Pinned version. A pin overrides newer stream builds; unpin resumes stream
// resolution. Pinning a user onto an unavailable build would strand them → §11 confirm gate.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

function sparkleVersion(xml: string): string {
  return xml.match(/<sparkle:version>(\d+)<\/sparkle:version>/)?.[1] ?? "none";
}

describe("CUJ-9 pinned version", () => {
  it("pin overrides the newer stream build; unpin resumes resolution", async () => {
    const { token, client, stream, build } = await seedServableClient(deps, { buildNumber: 1500 });
    await publishBuild(deps, stream.id, { buildNumber: 1600 });
    const app = appWorker();
    const userToken = await access.signValidUser();

    // Baseline: resolves the newest (#1600).
    expect(sparkleVersion(await (await app.request(`/appcast?token=${token}`)).text())).toBe(
      "1600",
    );

    // Pin to #1500 → resolves #1500.
    await adminWorker(access).request(
      `/admin/clients/${client.id}/pin`,
      withTokenForm(userToken, { buildId: String(build.id) }),
    );
    expect((await getById(deps.db, client.id))?.pinnedBuildId).toBe(build.id);
    expect(sparkleVersion(await (await app.request(`/appcast?token=${token}`)).text())).toBe(
      "1500",
    );

    // Unpin → resolves #1600 again.
    await adminWorker(access).request(
      `/admin/clients/${client.id}/unpin`,
      withTokenForm(userToken, {}),
    );
    expect((await getById(deps.db, client.id))?.pinnedBuildId).toBeNull();
    expect(sparkleVersion(await (await app.request(`/appcast?token=${token}`)).text())).toBe(
      "1600",
    );
  });

  it("pinning onto a withdrawn build is gated by the §11 confirmation", async () => {
    const { client, stream, build } = await seedServableClient(deps, { buildNumber: 1500 });
    const newer = await publishBuild(deps, stream.id, { buildNumber: 1600 });
    await builds.setStatus(deps.db, newer.id, "withdrawn"); // pinning here would strand the user
    const userToken = await access.signValidUser();

    // Without confirm: the confirmation page, and NO mutation.
    const confirm = await adminWorker(access).request(
      `/admin/clients/${client.id}/pin`,
      withTokenForm(userToken, { buildId: String(newer.id) }),
    );
    expect(confirm.status).toBe(200);
    const confirmHtml = await confirm.text();
    expect(confirmHtml).toContain("no available build"); // the §11 consequence, spelled out
    expect(confirmHtml).toContain("Pin"); // the page names the action it is confirming
    expect((await getById(deps.db, client.id))?.pinnedBuildId).toBeNull();

    // With confirm: the pin is applied (the user is knowingly left no-build).
    await adminWorker(access).request(
      `/admin/clients/${client.id}/pin`,
      withTokenForm(userToken, { buildId: String(newer.id), confirm: "true" }),
    );
    expect((await getById(deps.db, client.id))?.pinnedBuildId).toBe(newer.id);
    // sanity: the original build still exists and is available
    expect((await builds.getById(deps.db, build.id))?.status).toBe("available");
  });
});
