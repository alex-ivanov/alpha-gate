import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import {
  getObject,
  headObject,
  putArchive,
  putAuditAnchor,
  putBranding,
} from "../../../src/r2/builds-bucket";
import { BRANDING_ICON_KEY } from "../../../src/r2/keys";

const r2 = env.BUILDS;

beforeEach(async () => {
  for (const obj of (await r2.list()).objects) {
    await r2.delete(obj.key);
  }
});

describe("builds-bucket", () => {
  it("stores an archive under its key and reads the bytes back", async () => {
    const key = await putArchive(r2, 1500, "App.zip", "ZIP-BYTES");

    expect(key).toBe("build/1500/App.zip");
    expect(await (await getObject(r2, key))?.text()).toBe("ZIP-BYTES");
  });

  it("exposes object size via head (for the §20 register length check)", async () => {
    await putArchive(r2, 1500, "App.zip", "12345");
    const head = await headObject(r2, "build/1500/App.zip");
    expect(head?.size).toBe(5);
  });

  it("missing object reads as null", async () => {
    expect(await getObject(r2, "build/9999/none.zip")).toBeNull();
  });

  it("stores branding with an explicit content type", async () => {
    await putBranding(r2, BRANDING_ICON_KEY, "PNGDATA", "image/png");
    const object = await getObject(r2, BRANDING_ICON_KEY);
    expect(object?.httpMetadata?.contentType).toBe("image/png");
  });

  it("writes an audit anchor as JSON", async () => {
    await putAuditAnchor(r2, "audit/anchor/x.json", '{"hash":"abc","count":1}');
    expect(await (await getObject(r2, "audit/anchor/x.json"))?.text()).toBe(
      '{"hash":"abc","count":1}',
    );
  });
});
