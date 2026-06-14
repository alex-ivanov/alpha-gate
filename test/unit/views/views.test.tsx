import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, resolveBranding } from "../../../src/core/invite-template";
import { AccessPage, NotFoundPage } from "../../../src/views/access-page";
import { GetPage } from "../../../src/views/get-page";
import { renderPage } from "../../../src/views/layout";

// §6/§13 public views — pure hono/jsx, props in / HTML out. The route layer supplies the URLs and the
// branding model; these tests assert the markup and that every interpolated value is HTML-escaped.

describe("GetPage", () => {
  const base = {
    branding: resolveBranding({ appName: "Acme", accent: "#FF5500" }),
    token: "TOKEN123",
    downloadUrl: "/download?token=TOKEN123&via=install",
    activateUrl: "myapp://activate?token=TOKEN123",
  };

  it("renders the download link, activate deep link, paste token, and instructions", () => {
    const html = renderPage(<GetPage {...base} />);

    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("/download?token=TOKEN123");
    expect(html).toContain("via=install");
    expect(html).toContain('href="myapp://activate?token=TOKEN123"');
    expect(html).toContain("TOKEN123");
    expect(html).toContain("Acme");
    expect(html).toContain("--accent: #FF5500");
  });

  it("omits the icon for the unbranded default", () => {
    const html = renderPage(<GetPage {...base} branding={DEFAULT_BRANDING} />);
    expect(html).not.toContain("<img");
    expect(html).toContain("Your App");
  });

  it("renders the icon when branding provides one", () => {
    const branding = resolveBranding({ appName: "Acme", iconUrl: "/assets/icon" });
    const html = renderPage(<GetPage {...base} branding={branding} />);
    expect(html).toContain("<img");
    expect(html).toContain('src="/assets/icon"');
  });

  it("renders the header banner when branding provides one", () => {
    const branding = resolveBranding({ appName: "Acme", headerUrl: "/assets/header" });
    const html = renderPage(<GetPage {...base} branding={branding} />);
    expect(html).toContain('class="header"');
    expect(html).toContain('src="/assets/header"');
  });

  it("HTML-escapes hostile branding and token values (no markup injection)", () => {
    const branding = resolveBranding({ appName: "<script>x</script>" });
    const html = renderPage(<GetPage {...base} branding={branding} token={'a"<b>'} />);
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});

describe("AccessPage", () => {
  it("renders an email request form posting to /access", () => {
    const html = renderPage(<AccessPage appName="Acme" accent="#0A84FF" />);
    expect(html).toContain('action="/access"');
    expect(html).toContain('method="post"');
    expect(html).toContain('type="email"');
  });
});

describe("NotFoundPage", () => {
  it("is generic — renders none of the get-page affordances, so it can't confirm a token", () => {
    const html = renderPage(<NotFoundPage />);
    expect(html.toLowerCase()).toContain("not found");
    expect(html).not.toContain("Download");
    expect(html).not.toContain("Activate");
    expect(html).not.toContain("Access key");
  });
});
