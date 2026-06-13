import { env } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";

// M0 gate: proves the offline toolchain is wired — Hono runs in workerd, the D1/R2 bindings load, and
// the real §5 + 0006 migrations apply to an isolated database. No business logic is exercised here.
describe("M0 scaffold", () => {
  it("runs a trivial Hono app inside the Workers runtime", async () => {
    const app = new Hono();
    app.get("/", (c) => c.text("ok"));

    const res = await app.request("/");

    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("applies the §5 migrations to an isolated D1", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type = 'table'",
    ).all<{ name: string }>();
    const tables = results.map((r) => r.name);

    expect(tables).toEqual(
      expect.arrayContaining([
        "clients",
        "builds",
        "streams",
        "build_streams",
        "user_streams",
        "access_log",
        "meta",
        "admin_audit",
      ]),
    );
  });

  it("includes the 0006 DMG columns on builds", async () => {
    const { results } = await env.DB.prepare("PRAGMA table_info(builds)").all<{ name: string }>();
    const columns = results.map((r) => r.name);

    expect(columns).toEqual(expect.arrayContaining(["object_key", "dmg_object_key", "dmg_length"]));
  });

  it("exposes the R2 bucket binding", async () => {
    await env.BUILDS.put("smoke/probe.txt", "hello");
    const object = await env.BUILDS.get("smoke/probe.txt");

    expect(await object?.text()).toBe("hello");
  });
});
