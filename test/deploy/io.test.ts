import { describe, expect, it } from "vitest";
import { createFakePrompt } from "../../src/deploy/seams/io";

describe("createFakePrompt", () => {
  it("confirm is true only for y/yes, and defaults to no", async () => {
    expect(await createFakePrompt(["y"]).confirm("?")).toBe(true);
    expect(await createFakePrompt(["yes"]).confirm("?")).toBe(true);
    expect(await createFakePrompt(["n"]).confirm("?")).toBe(false);
    expect(await createFakePrompt([]).confirm("?")).toBe(false);
  });

  it("ask returns the canned (trimmed at the real impl) answer and records the question", async () => {
    const p = createFakePrompt(["hello"]);
    expect(await p.ask("name?")).toBe("hello");
    expect(p.asked).toContain("name?");
  });

  it("waitForDone resolves — the manual-step gate — and records its prompt", async () => {
    const p = createFakePrompt([]);
    await expect(p.waitForDone("Done?")).resolves.toBeUndefined();
    expect(p.asked).toContain("Done?");
  });
});
