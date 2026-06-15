import { describe, expect, it } from "vitest";
import {
  ARCHIVE_AUTOFILL_SCRIPT,
  locateInfoPlist,
  parseInfoPlist,
} from "../../../src/views/admin/plist-extract";

// Fixtures generated on macOS from a real Info.plist (CFBundleVersion 1500, CFBundleShortVersionString
// 1.4.0, LSMinimumSystemVersion 12.0): `plutil -convert binary1` for the bplist, `zip -0` for a STORED
// archive at MyApp.app/Contents/Info.plist. So these exercise the exact byte layouts Xcode/Sparkle emit.
const BPLIST_B64 =
  "YnBsaXN0MDDUAQIDBAUGBwhfEA9DRkJ1bmRsZVZlcnNpb25fEBpDRkJ1bmRsZVNob3J0VmVyc2lvblN0cmluZ18QFkxTTWluaW11bVN5c3RlbVZlcnNpb25cQ0ZCdW5kbGVOYW1lVDE1MDBVMS40LjBUMTIuMFVNeUFwcAgRI0BZZmtxdgAAAAAAAAEBAAAAAAAAAAkAAAAAAAAAAAAAAAAAAAB8";
const STORED_ZIP_B64 =
  "UEsDBAoAAAAAADqrzlzy4AdFpQAAAKUAAAAdAAAATXlBcHAuYXBwL0NvbnRlbnRzL0luZm8ucGxpc3RicGxpc3QwMNQBAgMEBQYHCF8QD0NGQnVuZGxlVmVyc2lvbl8QGkNGQnVuZGxlU2hvcnRWZXJzaW9uU3RyaW5nXxAWTFNNaW5pbXVtU3lzdGVtVmVyc2lvblxDRkJ1bmRsZU5hbWVUMTUwMFUxLjQuMFQxMi4wVU15QXBwCBEjQFlma3F2AAAAAAAAAQEAAAAAAAAACQAAAAAAAAAAAAAAAAAAAHxQSwECHgMKAAAAAAA6q85c8uAHRaUAAAClAAAAHQAAAAAAAAAAAAAApIEAAAAATXlBcHAuYXBwL0NvbnRlbnRzL0luZm8ucGxpc3RQSwUGAAAAAAEAAQBLAAAA4AAAAAAA";

const XML_PLIST = `<?xml version="1.0" encoding="UTF-8"?>
<plist version="1.0"><dict>
  <key>CFBundleShortVersionString</key><string>2.0.1</string>
  <key>CFBundleVersion</key><string>2001</string>
  <key>LSMinimumSystemVersion</key><string>13.0</string>
</dict></plist>`;

const bytes = (b64: string) => Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));

describe("parseInfoPlist", () => {
  it("reads the version keys from a binary plist (bplist00, as Xcode ships)", () => {
    expect(parseInfoPlist(bytes(BPLIST_B64))).toEqual({
      shortVersion: "1.4.0",
      buildNumber: "1500",
      minOs: "12.0",
    });
  });

  it("reads the version keys from an XML plist", () => {
    expect(parseInfoPlist(new TextEncoder().encode(XML_PLIST))).toEqual({
      shortVersion: "2.0.1",
      buildNumber: "2001",
      minOs: "13.0",
    });
  });

  it("returns nulls for non-plist bytes rather than throwing", () => {
    expect(parseInfoPlist(new TextEncoder().encode("not a plist"))).toEqual({
      shortVersion: null,
      buildNumber: null,
      minOs: null,
    });
  });
});

describe("locateInfoPlist", () => {
  it("finds the stored Info.plist entry and points at its bytes", () => {
    const zip = bytes(STORED_ZIP_B64);
    const loc = locateInfoPlist(zip);
    expect(loc).not.toBeNull();
    expect(loc?.method).toBe(0); // STORED
    // End to end: slicing at the located offset and parsing yields the real versions (no inflate needed).
    const plist = zip.subarray(loc?.start, (loc?.start ?? 0) + (loc?.length ?? 0));
    expect(parseInfoPlist(plist)).toMatchObject({ buildNumber: "1500", shortVersion: "1.4.0" });
  });

  it("returns null when there is no app Info.plist (or it isn't a zip)", () => {
    expect(locateInfoPlist(new TextEncoder().encode("PK not really a zip"))).toBeNull();
  });
});

describe("ARCHIVE_AUTOFILL_SCRIPT", () => {
  it("ships the tested functions and is browser-self-contained", () => {
    expect(ARCHIVE_AUTOFILL_SCRIPT).toContain("var locateInfoPlist = function");
    expect(ARCHIVE_AUTOFILL_SCRIPT).toContain("var parseInfoPlist = function");
    expect(ARCHIVE_AUTOFILL_SCRIPT).toContain("var __name ="); // esbuild keep-names shim
    expect(ARCHIVE_AUTOFILL_SCRIPT).not.toContain("</script>");
    // The wanted keys must be inlined in the function body — a module-scope constant wouldn't survive
    // toString() and would throw "WANTED_KEYS is not defined" in the browser.
    expect(ARCHIVE_AUTOFILL_SCRIPT).toContain("CFBundleVersion");
    // async/spread runtime helpers can't be shimmed with identity — they must never leak in.
    for (const helper of ["__async(", "__await(", "__spreadValues(", "__pow("]) {
      expect(ARCHIVE_AUTOFILL_SCRIPT).not.toContain(helper);
    }
  });
});
