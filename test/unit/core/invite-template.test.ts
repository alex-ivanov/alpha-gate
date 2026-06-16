import { describe, expect, it } from "vitest";
import {
  DEFAULT_ACTIVATE_SCHEME,
  DEFAULT_BRANDING,
  DEFAULT_INVITE_TEMPLATE,
  fillTemplate,
  isValidAccent,
  renderInvite,
  resolveActivateScheme,
  resolveBranding,
  safeAccent,
} from "../../../src/core/invite-template";

// §13/§6 — invite text and the branded /get page model. Pure: placeholder fill + default merge.
// (HTML rendering lives in the views; this only resolves the data/text.)

const VARS = {
  appName: "Acme",
  getUrl: "https://app.example/get?token=ABC",
  token: "ABC",
};

describe("fillTemplate", () => {
  it("replaces every placeholder", () => {
    expect(fillTemplate("Hi {app_name}, open {get_url} — key {token}", VARS)).toBe(
      "Hi Acme, open https://app.example/get?token=ABC — key ABC",
    );
  });

  it("does not re-expand a value that happens to look like a placeholder", () => {
    expect(fillTemplate("{app_name}", { ...VARS, appName: "{token}" })).toBe("{token}");
  });
});

describe("renderInvite", () => {
  it("fills the default §13 template for a recipient", () => {
    const { subject, body } = renderInvite(DEFAULT_INVITE_TEMPLATE, VARS);
    expect(subject).toBe("You're invited to test Acme");
    expect(body).toContain("https://app.example/get?token=ABC");
    expect(body).toContain("Acme alpha");
    expect(body).not.toContain("{app_name}");
  });
});

describe("resolveActivateScheme", () => {
  it("defaults to 'myapp' when unset or empty", () => {
    expect(resolveActivateScheme(null)).toBe(DEFAULT_ACTIVATE_SCHEME);
    expect(resolveActivateScheme(undefined)).toBe(DEFAULT_ACTIVATE_SCHEME);
    expect(resolveActivateScheme("")).toBe(DEFAULT_ACTIVATE_SCHEME);
    expect(DEFAULT_ACTIVATE_SCHEME).toBe("myapp");
  });

  it("accepts well-formed RFC 3986 schemes", () => {
    expect(resolveActivateScheme("acme")).toBe("acme");
    expect(resolveActivateScheme("com.acme.app")).toBe("com.acme.app");
    expect(resolveActivateScheme("my-app+x")).toBe("my-app+x");
  });

  it("rejects schemes that could break out of the href, falling back to the default", () => {
    for (const bad of ["javascript:alert(1)", "1myapp", "my app", 'a"onclick', "a://b", "a/b"]) {
      expect(resolveActivateScheme(bad)).toBe(DEFAULT_ACTIVATE_SCHEME);
    }
  });
});

describe("accent colour (raw CSS sink — must stay injection-proof)", () => {
  it("accepts hex colours", () => {
    for (const v of ["#0A84FF", "#fff", "#FFFF", "#0a84ffcc"]) expect(isValidAccent(v)).toBe(true);
  });

  it("rejects anything that isn't a plain hex colour (CSS/markup-breakout attempts)", () => {
    for (const v of [
      "red",
      "#0A84FF;}</style><script>alert(1)</script>",
      "url(x)",
      "rgb(0,0,0)",
      "#xyz",
      "",
    ]) {
      expect(isValidAccent(v)).toBe(false);
    }
  });

  it("safeAccent coerces an invalid/missing stored value to the default", () => {
    expect(safeAccent("#1a2b3c")).toBe("#1a2b3c");
    expect(safeAccent("evil}</style>")).toBe(DEFAULT_BRANDING.accent);
    expect(safeAccent(null)).toBe(DEFAULT_BRANDING.accent);
    expect(safeAccent(undefined)).toBe(DEFAULT_BRANDING.accent);
  });
});

describe("resolveBranding", () => {
  it("falls back to clean defaults when nothing is set", () => {
    expect(resolveBranding({})).toEqual(DEFAULT_BRANDING);
    expect(DEFAULT_BRANDING.accent).toBe("#0A84FF");
    expect(DEFAULT_BRANDING.iconUrl).toBeNull();
    expect(DEFAULT_BRANDING.headerUrl).toBeNull();
  });

  it("applies overrides over the defaults", () => {
    expect(
      resolveBranding({ appName: "Acme", iconUrl: "/assets/icon", headerUrl: "/assets/header" }),
    ).toEqual({
      appName: "Acme",
      blurb: null,
      accent: "#0A84FF",
      iconUrl: "/assets/icon",
      headerUrl: "/assets/header",
    });
  });
});
