import { describe, expect, it } from "vitest";
import {
  cellPasses,
  compareCells,
  TABLE_ENHANCE_SCRIPT,
} from "../../../src/views/admin/table-enhance";

// The admin tables' sort/filter logic is pure (no DOM) so it can be tested offline; the browser glue
// ships these exact functions via toString(). DOM wiring is verified manually (see the PR notes).

describe("compareCells", () => {
  const sort = (xs: string[], type: "text" | "num", dir: "asc" | "desc") =>
    [...xs].sort((a, b) => compareCells(a, b, type, dir));

  it("orders text case-insensitively, ascending and descending", () => {
    expect(sort(["beta", "Alpha", "gamma"], "text", "asc")).toEqual(["Alpha", "beta", "gamma"]);
    expect(sort(["beta", "Alpha", "gamma"], "text", "desc")).toEqual(["gamma", "beta", "Alpha"]);
  });

  it("orders numbers numerically, not lexically (10 after 9)", () => {
    expect(sort(["10", "9", "100", "2"], "num", "asc")).toEqual(["2", "9", "10", "100"]);
  });

  it("sorts ISO-ish timestamps chronologically as text", () => {
    const a = "2026-06-14T08:00:00Z";
    const b = "2026-06-14T20:00:00Z";
    expect(sort([b, a], "text", "asc")).toEqual([a, b]);
  });

  it("keeps blank and em-dash cells LAST in both directions", () => {
    expect(sort(["b", "—", "a", ""], "text", "asc")).toEqual(["a", "b", "—", ""]);
    // descending flips a/b but the empties still sink to the bottom
    const desc = sort(["b", "—", "a", ""], "text", "desc");
    expect(desc.slice(0, 2)).toEqual(["b", "a"]);
    expect(desc.slice(2).every((s) => s.trim() === "" || s.trim() === "—")).toBe(true);
  });
});

describe("cellPasses", () => {
  it("treats an empty filter value as no constraint", () => {
    expect(cellPasses("anything", "", "exact")).toBe(true);
  });

  it("exact match is case-insensitive equality", () => {
    expect(cellPasses("Available", "available", "exact")).toBe(true);
    expect(cellPasses("withdrawn", "available", "exact")).toBe(false);
  });

  it("contains match is a case-insensitive substring (for joined channel lists)", () => {
    expect(cellPasses("beta, stable", "STABLE", "contains")).toBe(true);
    expect(cellPasses("beta, stable", "canary", "contains")).toBe(false);
  });
});

describe("TABLE_ENHANCE_SCRIPT", () => {
  it("inlines the pure functions verbatim so the browser runs the tested logic", () => {
    expect(TABLE_ENHANCE_SCRIPT).toContain("var compareCells = function");
    expect(TABLE_ENHANCE_SCRIPT).toContain("var cellPasses = function");
    expect(TABLE_ENHANCE_SCRIPT).toContain("table[data-enhance]");
    // must not contain a closing script tag that would break out of the <script> element
    expect(TABLE_ENHANCE_SCRIPT).not.toContain("</script>");
  });

  it("is browser-self-contained: no unshimmed bundler helper leaks via toString()", () => {
    // esbuild's keep-names wraps named inner functions in __name(...); since we serialise the functions
    // with toString(), any such helper must be defined in the script or it throws a ReferenceError in the
    // browser mid-sort. __name is shimmed; the others must simply never appear (we avoid **, spread, async).
    expect(TABLE_ENHANCE_SCRIPT).toContain("var __name =");
    // General guard: NO esbuild runtime helper other than the shimmed __name may appear. Catches any
    // future helper (__pow/__spreadValues/__async/…) introduced by a target/syntax change before it
    // breaks in the admin's browser.
    expect(TABLE_ENHANCE_SCRIPT).not.toMatch(/\b__(?!name\b)[A-Za-z]\w*/);
  });
});
