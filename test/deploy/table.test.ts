import { describe, expect, it } from "vitest";
import { colorPalette, plainPalette } from "../../src/deploy/core/colors";
import { type Cell, renderTable } from "../../src/deploy/core/table";

const ESC = String.fromCharCode(27);
const stripAnsi = (s: string): string => s.replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

describe("renderTable", () => {
  const rows: Cell[][] = [
    [{ text: "a" }, { text: "short" }],
    [{ text: "bb" }, { text: "a longer value" }],
  ];

  it("draws borders and a header row", () => {
    const out = renderTable(rows, plainPalette, { head: ["K", "V"] });
    expect(out).toContain("┌");
    expect(out).toContain("┐");
    expect(out).toContain("└");
    expect(out).toContain("│ K");
    expect(out).toContain("a longer value");
  });

  it("pads columns so every line is the same width (alignment holds)", () => {
    const lines = renderTable(rows, plainPalette, { head: ["K", "V"] }).split("\n");
    expect(new Set(lines.map((l) => l.length)).size).toBe(1);
  });

  it("measures width on plain text, so colored cells don't drift the columns", () => {
    const plainLens = renderTable(rows, plainPalette, { head: ["K", "V"] })
      .split("\n")
      .map((l) => l.length);
    const colored: Cell[][] = [
      [{ text: "a", style: colorPalette.green }, { text: "short" }],
      [{ text: "bb", style: colorPalette.red }, { text: "a longer value" }],
    ];
    const visibleLens = renderTable(colored, colorPalette, { head: ["K", "V"] })
      .split("\n")
      .map((l) => stripAnsi(l).length);
    expect(visibleLens).toEqual(plainLens);
  });
});
