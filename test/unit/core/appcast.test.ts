import { describe, expect, it } from "vitest";
import {
  INFORMATIONAL_SENTINEL_VERSION,
  renderAppcast,
  renderInformationalItem,
  renderUpdateItem,
  xmlEscape,
} from "../../../src/core/appcast";
import { aBuild } from "../../support/factories";

// §8/§14/§15 appcast generation. The out-of-scope Sparkle client parses this, so the output is
// asserted byte-exact (golden) and every interpolated value is XML-escaped (injection guard).

const ENCLOSURE = "https://app.example/download?token=ABC&via=update";

describe("xmlEscape", () => {
  it("escapes the five XML metacharacters, ampersand first", () => {
    expect(xmlEscape(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&apos;");
  });
});

describe("renderUpdateItem", () => {
  it("renders a normal update item (golden)", () => {
    const build = aBuild({
      buildNumber: 1500,
      shortVersion: "1.4.0",
      length: 5242880,
      edSignature: "EdSigBase64==",
      minOs: null,
      critical: false,
    });

    expect(renderUpdateItem(build, ENCLOSURE)).toBe(
      [
        "    <item>",
        "      <title>1.4.0</title>",
        "      <sparkle:version>1500</sparkle:version>",
        "      <sparkle:shortVersionString>1.4.0</sparkle:shortVersionString>",
        '      <enclosure url="https://app.example/download?token=ABC&amp;via=update" length="5242880" type="application/octet-stream" sparkle:edSignature="EdSigBase64==" />',
        "    </item>",
      ].join("\n"),
    );
  });

  it("includes minimumSystemVersion and an empty criticalUpdate element when set (golden)", () => {
    const build = aBuild({
      buildNumber: 1600,
      shortVersion: "1.5.0",
      length: 100,
      edSignature: "Sig",
      minOs: "12.0",
      critical: true,
    });

    expect(renderUpdateItem(build, ENCLOSURE)).toBe(
      [
        "    <item>",
        "      <title>1.5.0</title>",
        "      <sparkle:version>1600</sparkle:version>",
        "      <sparkle:shortVersionString>1.5.0</sparkle:shortVersionString>",
        "      <sparkle:minimumSystemVersion>12.0</sparkle:minimumSystemVersion>",
        "      <sparkle:criticalUpdate></sparkle:criticalUpdate>",
        '      <enclosure url="https://app.example/download?token=ABC&amp;via=update" length="100" type="application/octet-stream" sparkle:edSignature="Sig" />',
        "    </item>",
      ].join("\n"),
    );
  });

  it("omits criticalUpdate entirely for a non-critical build", () => {
    const xml = renderUpdateItem(aBuild({ critical: false }), ENCLOSURE);
    expect(xml).not.toContain("criticalUpdate");
  });

  it("XML-escapes hostile version/signature/URL values rather than emitting them raw", () => {
    const build = aBuild({ shortVersion: `1 <b>&"'`, edSignature: `a&b"c` });
    const xml = renderUpdateItem(build, "https://x/d?token=A&via=update");

    expect(xml).toContain("<title>1 &lt;b&gt;&amp;&quot;&apos;</title>");
    expect(xml).not.toContain("<b>");
    expect(xml).toContain('sparkle:edSignature="a&amp;b&quot;c"');
    expect(xml).toContain('url="https://x/d?token=A&amp;via=update"');
  });
});

describe("renderInformationalItem", () => {
  const NOTICE = {
    accessUrl: "https://app.example/access",
    title: "Reactivate your access",
    message: "Your access to Acme has expired. Open your access page.",
  };

  it("renders the §15 notice: title, description, sentinel + display version, info marker, link (golden)", () => {
    expect(renderInformationalItem(NOTICE)).toBe(
      [
        "    <item>",
        "      <title>Reactivate your access</title>",
        "      <description><![CDATA[<p>Your access to Acme has expired. Open your access page.</p>]]></description>",
        "      <sparkle:version>999000000</sparkle:version>",
        "      <sparkle:shortVersionString>Access renewal</sparkle:shortVersionString>",
        "      <sparkle:informationalUpdate></sparkle:informationalUpdate>",
        "      <link>https://app.example/access</link>",
        "    </item>",
      ].join("\n"),
    );
  });

  it("never contains an enclosure (so Sparkle shows a notice with no Install button)", () => {
    expect(renderInformationalItem(NOTICE)).not.toContain("<enclosure");
  });

  it("escapes a hostile title/message: no markup reaches the WebView, the CDATA can't be broken", () => {
    const xml = renderInformationalItem({
      ...NOTICE,
      title: "<b>hi</b>",
      message: `</p><script>alert(1)</script> ]]> & "x"`,
    });
    expect(xml).toContain("<title>&lt;b&gt;hi&lt;/b&gt;</title>");
    expect(xml).not.toContain("<script>");
    // the message's "]]>" is neutralized to "]]&gt;"; the only real "]]>" is the CDATA terminator.
    expect(xml).toContain("]]&gt;");
    expect(xml.split("]]>").length - 1).toBe(1);
    expect(xml).toContain(
      "&lt;/p&gt;&lt;script&gt;alert(1)&lt;/script&gt; ]]&gt; &amp; &quot;x&quot;",
    );
  });

  it("uses a fixed sentinel comfortably below INT32 max", () => {
    expect(INFORMATIONAL_SENTINEL_VERSION).toBe(999000000);
    expect(INFORMATIONAL_SENTINEL_VERSION).toBeLessThan(2 ** 31 - 1);
  });
});

describe("renderAppcast", () => {
  it("with no items renders an empty channel — Sparkle reads it as 'up to date' (golden, §11)", () => {
    expect(renderAppcast({ title: "MyApp", items: [] })).toBe(
      `${[
        '<?xml version="1.0" encoding="utf-8"?>',
        '<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">',
        "  <channel>",
        "    <title>MyApp</title>",
        "  </channel>",
        "</rss>",
      ].join("\n")}\n`,
    );
  });

  it("wraps items in an rss/channel with the sparkle namespace declared (golden)", () => {
    const build = aBuild({
      buildNumber: 1500,
      shortVersion: "1.4.0",
      length: 5242880,
      edSignature: "EdSigBase64==",
    });

    expect(renderAppcast({ title: "MyApp", items: [renderUpdateItem(build, ENCLOSURE)] })).toBe(
      `${[
        '<?xml version="1.0" encoding="utf-8"?>',
        '<rss version="2.0" xmlns:sparkle="http://www.andymatuschak.org/xml-namespaces/sparkle">',
        "  <channel>",
        "    <title>MyApp</title>",
        "    <item>",
        "      <title>1.4.0</title>",
        "      <sparkle:version>1500</sparkle:version>",
        "      <sparkle:shortVersionString>1.4.0</sparkle:shortVersionString>",
        '      <enclosure url="https://app.example/download?token=ABC&amp;via=update" length="5242880" type="application/octet-stream" sparkle:edSignature="EdSigBase64==" />',
        "    </item>",
        "  </channel>",
        "</rss>",
      ].join("\n")}\n`,
    );
  });
});
