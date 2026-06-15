import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import * as builds from "../../../src/db/builds";
import { insert as insertClient } from "../../../src/db/clients";
import * as streams from "../../../src/db/streams";
import { buildDeps } from "../../../src/deps";
import { putArchive } from "../../../src/r2/builds-bucket";
import { resetAll } from "../../support/db";
import { appWorker } from "../../support/worker";

// §20 / decision 0003 — the Sparkle update enclosure is FORMAT-AGNOSTIC: a signed .dmg can be the update
// artifact, not only a .zip. The resolver/appcast/download never assume a format; /download names the
// file from its object key so Sparkle recognizes the .dmg and uses the disk-image installer. This is the
// path publish-dmg.sh feeds (mount → read version → sign_update the dmg → upload it as the enclosure).
const deps = buildDeps(env);
beforeEach(resetAll);

describe("DMG as the Sparkle update enclosure", () => {
  it("serves a .dmg build with its filename and a working appcast enclosure", async () => {
    const token = "T".repeat(32);
    const client = await insertClient(deps.db, { email: "dmg@example.test", token });
    const stream = await streams.create(deps.db, "stable");
    await streams.assignUser(deps.db, client.id, stream.id);

    // Upload the DMG as the enclosure — note the .dmg name is preserved in the object key.
    const objectKey = await putArchive(deps.r2, 4560, "MyApp.dmg", "DMG-BYTES");
    expect(objectKey).toBe("build/4560/MyApp.dmg");
    const build = await builds.insert(deps.db, {
      shortVersion: "4.5.6",
      buildNumber: 4560,
      objectKey,
      edSignature: "ed-dmg-sig",
      length: 9,
      minOs: null,
      critical: false,
    });
    await builds.linkStream(deps.db, build.id, stream.id);

    // The appcast item carries the dmg's EdDSA + the via=update enclosure URL (format doesn't matter).
    const appcast = await (await appWorker().request(`/appcast?token=${token}&installed=1`)).text();
    expect(appcast).toContain("<sparkle:version>4560</sparkle:version>");
    expect(appcast).toContain('sparkle:edSignature="ed-dmg-sig"');
    expect(appcast).toContain("via=update");

    // /download streams the dmg bytes AND names the file .dmg, so Sparkle picks the disk-image installer.
    const dl = await appWorker().request(`/download?token=${token}&via=update`);
    expect(await dl.text()).toBe("DMG-BYTES");
    expect(dl.headers.get("content-disposition")).toContain('filename="MyApp.dmg"');
  });
});
