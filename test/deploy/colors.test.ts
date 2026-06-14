import { describe, expect, it } from "vitest";
import {
  colorPalette,
  plainPalette,
  selectPalette,
  shouldColor,
} from "../../src/deploy/core/colors";

const ESC = String.fromCharCode(27);

describe("palette", () => {
  it("colorPalette wraps with ANSI; plainPalette is identity", () => {
    expect(colorPalette.green("x")).toContain(ESC);
    expect(plainPalette.green("x")).toBe("x");
  });

  it("selectPalette switches by the flag", () => {
    expect(selectPalette(false)).toBe(plainPalette);
    expect(selectPalette(true)).toBe(colorPalette);
  });
});

describe("shouldColor", () => {
  it("off when NO_COLOR is set (even on a tty)", () => {
    expect(shouldColor({ NO_COLOR: "1" }, true)).toBe(false);
  });

  it("on when FORCE_COLOR is set, even without a tty", () => {
    expect(shouldColor({ FORCE_COLOR: "1" }, false)).toBe(true);
  });

  it("otherwise follows the tty flag", () => {
    expect(shouldColor({}, true)).toBe(true);
    expect(shouldColor({}, false)).toBe(false);
  });
});
