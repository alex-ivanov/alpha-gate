import { describe, expect, it } from "vitest";
import { DEFAULT_BRANDING, resolveBranding } from "../../../src/core/invite-template";
import { AccessPage, NotFoundPage } from "../../../src/views/access-page";
import { AdminLayout } from "../../../src/views/admin/layout";
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

describe("AdminLayout (design-system chrome)", () => {
  const render = () =>
    renderPage(
      <AdminLayout title="Users">
        <p>content</p>
      </AdminLayout>,
    );

  it("renders the accessible shell: lang, single h1, skip link, labelled nav, main landmark", () => {
    const html = render();
    expect(html).toContain('<html lang="en">');
    expect((html.match(/<h1>/g) ?? []).length).toBe(1);
    expect(html).toContain('href="#main"');
    expect(html).toContain('id="main"');
    expect(html).toContain('<nav class="primary" aria-label="Primary">');
  });

  it("ships the design-system tokens: light/dark, focus-visible, responsive, reduced-motion", () => {
    const html = render();
    expect(html).toContain("--accent:");
    expect(html).toMatch(/@media \(prefers-color-scheme:\s*dark\)/);
    expect(html).toContain(":focus-visible");
    expect(html).toMatch(/@media \(max-width:\s*48rem\)/);
    expect(html).toContain("prefers-reduced-motion");
  });

  it("includes the progressive-enhancement active-nav script (works without it)", () => {
    expect(render()).toContain("aria-current");
  });

  it("ships the quiet-instrument primitives: lockup, exception tags, sr-only, favicon", () => {
    const html = render();
    expect(html).toMatch(/\.lk\s*\{[^}]*var\(--mono\)/); // the canonical version lockup is mono
    expect(html).toMatch(/\.tag\.crit\s*\{[^}]*var\(--crit-bg\)/); // critical is the one filled tag
    expect(html).toContain(".sr-only"); // screen-reader utility exists
    expect(html).toContain('rel="icon"'); // per-tab identity (data-URI gate glyph)
    expect(html).toMatch(/\.actions\s*\{[^}]*display:\s*flex/); // action rows share a baseline
  });

  it("renders the grouped nav with a Requests chip and the instance slug", () => {
    const html = renderPage(
      <AdminLayout title="Users" chrome={{ instance: "corner-mac", pending: 2 }}>
        <p>content</p>
      </AdminLayout>,
    );
    expect(html).toContain("Operate");
    expect(html).toContain("Publish");
    expect(html).toContain("corner-mac");
    expect(html).toContain('class="chip"'); // pending-requests count on the nav item
  });

  it("renders the flash notice as a status callout when chrome carries one", () => {
    const html = renderPage(
      <AdminLayout title="Users" chrome={{ notice: "Revoked x@y." }}>
        <p>content</p>
      </AdminLayout>,
    );
    expect(html).toContain('role="status"');
    expect(html).toContain("Revoked x@y.");
  });

  it("ships the three-state theme toggle and honors a forced theme", () => {
    const system = render();
    expect(system).toContain('action="/admin/theme"'); // the toggle posts (works JS-off)
    for (const v of ["light", "system", "dark"]) expect(system).toContain(`value="${v}"`);
    expect(system).toContain('<html lang="en">'); // no data-theme attr → follow the OS
    // System is the active segment by default.
    expect(system).toMatch(/value="system"[^>]*aria-pressed="true"/);

    const dark = renderPage(
      <AdminLayout title="Users" chrome={{ theme: "dark", path: "/admin/users" }}>
        <p>content</p>
      </AdminLayout>,
    );
    expect(dark).toContain('<html lang="en" data-theme="dark">'); // server-rendered (JS-off safe)
    expect(dark).toMatch(/value="dark"[^>]*aria-pressed="true"/);
    expect(dark).toContain('name="return_to" value="/admin/users"'); // returns whence toggled
    // Forced-dark selector + forced-light color-scheme both exist in the sheet.
    expect(dark).toContain(":root[data-theme=dark]");
    expect(dark).toContain(":root[data-theme=light]{color-scheme:light}");
    // The pre-paint script covers chrome-less pages (confirmations, invite results).
    expect(dark).toContain("document.cookie.match");
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
