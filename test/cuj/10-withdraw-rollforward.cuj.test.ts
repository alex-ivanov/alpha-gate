import { env } from "cloudflare:test";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listInOrder } from "../../src/db/admin-audit";
import { getById } from "../../src/db/builds";
import { buildDeps } from "../../src/deps";
import { adminWorker, setupTestAccess, type TestAccess, withTokenForm } from "../support/access";
import { resetAll } from "../support/db";
import { publishBuild, seedServableClient } from "../support/scenario";
import { appWorker } from "../support/worker";

// CUJ-10 (§9/§12.9) — Withdraw a bad version as roll-forward. A higher good build is published, the
// bad one is withdrawn; users move to the good build and the bad one is never offered again. Since a
// higher available build exists, the withdraw strands no one and proceeds without confirmation.
const deps = buildDeps(env);
let access: TestAccess;
beforeAll(async () => {
  access = await setupTestAccess();
});
beforeEach(resetAll);

function sparkleVersion(xml: string): string {
  return xml.match(/<sparkle:version>(\d+)<\/sparkle:version>/)?.[1] ?? "none";
}

describe("CUJ-10 withdraw (roll-forward)", () => {
  it("withdraws the bad build; clients resolve the roll-forward build, never the bad one", async () => {
    const { token, stream, build: bad } = await seedServableClient(deps, { buildNumber: 1500 });
    await publishBuild(deps, stream.id, { buildNumber: 1600, shortVersion: "1.4.0" }); // roll-forward

    const res = await adminWorker(access).request(
      `/admin/builds/${bad.id}/withdraw`,
      withTokenForm(await access.signValidUser(), {}),
    );
    expect(res.status).toBe(303); // no one stranded → no confirmation needed

    expect((await getById(deps.db, bad.id))?.status).toBe("withdrawn");
    expect((await listInOrder(deps.db)).some((r) => r.action === "build.withdraw")).toBe(true);

    const xml = await (await appWorker().request(`/appcast?token=${token}`)).text();
    expect(sparkleVersion(xml)).toBe("1600");
    expect(xml).not.toContain("<sparkle:version>1500</sparkle:version>");
  });
});
