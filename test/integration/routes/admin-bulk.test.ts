import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../../src/db/admin-audit";
import * as builds from "../../../src/db/builds";
import { buildDeps } from "../../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../../support/access";
import { resetAll } from "../../support/db";
import { publishBuild, seedServableClient } from "../../support/scenario";

// §13 #3 (bulk withdraw / mark critical, with the §11 confirm over the combined effect) and §13 #7
// (the rollback-target marker). Both go through the real Admin Worker + Access verifier.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

const userToken = () => access.signValidUser();

/** A bulk POST carrying repeated `id` fields (the checkbox selection) + op (+ optional confirm). */
function bulkForm(token: string, op: string, ids: number[], confirm = false): RequestInit {
  const params = new URLSearchParams();
  params.set("op", op);
  for (const id of ids) params.append("id", String(id));
  if (confirm) params.set("confirm", "true");
  return {
    method: "POST",
    headers: {
      "Cf-Access-Jwt-Assertion": token,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  };
}

describe("bulk build mutations", () => {
  it("marks several builds critical at once and audits each", async () => {
    const { stream, build } = await seedServableClient(deps, { buildNumber: 1500 });
    const second = await publishBuild(deps, stream.id, { buildNumber: 1600 });

    const res = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "critical", [build.id, second.id]),
    );
    expect(res.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.critical).toBe(true);
    expect((await builds.getById(deps.db, second.id))?.critical).toBe(true);
    const criticalAudits = (await listInOrder(deps.db)).filter(
      (r) => r.action === "build.critical",
    );
    expect(criticalAudits).toHaveLength(2);
  });

  it("clears critical on a selection (op=uncritical)", async () => {
    const { stream } = await seedServableClient(deps, { buildNumber: 1500 });
    const a = await publishBuild(deps, stream.id, { buildNumber: 1600, critical: true });
    const b = await publishBuild(deps, stream.id, { buildNumber: 1700, critical: true });

    const res = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "uncritical", [a.id, b.id]),
    );
    expect(res.status).toBe(303);
    expect((await builds.getById(deps.db, a.id))?.critical).toBe(false);
    expect((await builds.getById(deps.db, b.id))?.critical).toBe(false);
  });

  it("bulk withdraw that strands users is confirmed (combined), then proceeds", async () => {
    // One user, one servable build → withdrawing it strands them: needs confirmation.
    const { build } = await seedServableClient(deps, { email: "alice@example.test" });

    const confirm = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "withdraw", [build.id]),
    );
    expect(confirm.status).toBe(200);
    expect(await confirm.text()).toContain("alice@example.test");
    expect((await builds.getById(deps.db, build.id))?.status).toBe("available"); // not withdrawn yet

    const done = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "withdraw", [build.id], true),
    );
    expect(done.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.status).toBe("withdrawn");
  });

  it("bulk withdraw proceeds without confirmation when no one is stranded", async () => {
    // Two builds in the stream; withdrawing the lower leaves the higher serving the user.
    const { stream, build } = await seedServableClient(deps, { buildNumber: 1500 });
    await publishBuild(deps, stream.id, { buildNumber: 1600 });

    const res = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "withdraw", [build.id]),
    );
    expect(res.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.status).toBe("withdrawn");
  });

  it("an empty selection is a no-op redirect (nothing withdrawn)", async () => {
    const { build } = await seedServableClient(deps);
    const res = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "withdraw", []),
    );
    expect(res.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.status).toBe("available");
  });

  it("rejects an unknown bulk operation with 400", async () => {
    const { build } = await seedServableClient(deps);
    const res = await adminWorker(access).request(
      "/admin/builds/bulk",
      bulkForm(await userToken(), "explode", [build.id]),
    );
    expect(res.status).toBe(400);
  });
});

describe("rollback-target marker (§13 #7)", () => {
  it("toggles the marker on, then off, and audits each change", async () => {
    const { build } = await seedServableClient(deps);
    expect((await builds.getById(deps.db, build.id))?.rollbackTarget).toBe(false);

    const on = await adminWorker(access).request(
      `/admin/builds/${build.id}/rollback`,
      withTokenForm(await userToken(), { rollback: "true" }),
    );
    expect(on.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.rollbackTarget).toBe(true);

    const off = await adminWorker(access).request(
      `/admin/builds/${build.id}/rollback`,
      withTokenForm(await userToken(), { rollback: "false" }),
    );
    expect(off.status).toBe(303);
    expect((await builds.getById(deps.db, build.id))?.rollbackTarget).toBe(false);

    expect((await listInOrder(deps.db)).filter((r) => r.action === "build.rollback")).toHaveLength(
      2,
    );
  });

  it("404s for an unknown build", async () => {
    const res = await adminWorker(access).request(
      "/admin/builds/99999/rollback",
      withTokenForm(await userToken(), { rollback: "true" }),
    );
    expect(res.status).toBe(404);
  });
});
