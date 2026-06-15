// Browser-side autofill for the §13 upload form: when the admin picks the signed .app zip, read the
// app's version straight out of the archive so they don't retype what the binary already declares.
//
// The two values map exactly onto the bundle's Info.plist (and onto Sparkle, see core/appcast.ts):
//   CFBundleVersion            → build_number → sparkle:version            (the monotonic compare key)
//   CFBundleShortVersionString → short_version → sparkle:shortVersionString (the human display string)
//   LSMinimumSystemVersion     → min_os (optional)
//
// The fields stay editable: the register path (large/CI uploads) never reaches this code, and a §9
// rollback deliberately uses a build_number that differs from the binary — so this is a convenience that
// prefills, never the source of truth.
//
// locateInfoPlist + parseInfoPlist are PURE (Uint8Array in, plain data out) and unit-tested with real
// fixtures. The script serialises them via toString() so the browser runs the tested code; the thin
// async glue (file read + DEFLATE inflate + field fill) is hand-written and verified in a headless harness.

export interface ZipEntry {
  /** Compression method: 0 = stored, 8 = raw DEFLATE. */
  method: number;
  /** Byte offset of the entry's (possibly compressed) data within the zip. */
  start: number;
  /** Compressed byte length. */
  length: number;
}

export interface InfoPlist {
  shortVersion: string | null;
  buildNumber: string | null;
  minOs: string | null;
}

/**
 * Locate the top-level app's `Info.plist` inside a zip (random-access over the central directory, so a
 * ~90 MB archive isn't walked linearly). Returns where its bytes live + how they're compressed, or null
 * when the zip has no such entry. Pure: a plain function over the whole-file byte array.
 */
export function locateInfoPlist(zip: Uint8Array): ZipEntry | null {
  // Read through a DataView so byte access is a definite number (zip is little-endian throughout).
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength);
  const u16 = (p: number): number => dv.getUint16(p, true);
  const u32 = (p: number): number => dv.getUint32(p, true);

  // End Of Central Directory: scan backwards for its signature (a trailing comment may follow it).
  let eocd = -1;
  const minPos = Math.max(0, zip.length - 22 - 0xffff);
  for (let p = zip.length - 22; p >= minPos; p--) {
    if (u32(p) === 0x06054b50) {
      eocd = p;
      break;
    }
  }
  if (eocd < 0) return null;

  const cdOffset = u32(eocd + 16);
  const cdEnd = cdOffset + u32(eocd + 12);
  const isInfoPlist = (name: string): boolean =>
    /(^|\/)[^/]+\.app\/Contents\/Info\.plist$/.test(name);

  const matches: { name: string; method: number; comp: number; lho: number }[] = [];
  let p = cdOffset;
  while (p + 46 <= cdEnd && u32(p) === 0x02014b50) {
    const method = u16(p + 10);
    const comp = u32(p + 20);
    const nameLen = u16(p + 28);
    const extraLen = u16(p + 30);
    const commentLen = u16(p + 32);
    const lho = u32(p + 42);
    const name = new TextDecoder().decode(zip.subarray(p + 46, p + 46 + nameLen));
    if (isInfoPlist(name)) matches.push({ name, method, comp, lho });
    p += 46 + nameLen + extraLen + commentLen;
  }

  // Prefer the outermost app (a notarized bundle can nest helper .apps with their own Info.plist).
  matches.sort((a, b) => a.name.split("/").length - b.name.split("/").length);
  const m = matches[0];
  if (!m) return null;

  // The local header repeats name/extra lengths and may differ from the central record — read it here.
  if (u32(m.lho) !== 0x04034b50) return null;
  const start = m.lho + 30 + u16(m.lho + 26) + u16(m.lho + 28);
  return { method: m.method, start, length: m.comp };
}

/**
 * Parse the three version keys from an `Info.plist` — binary (`bplist00`, what Xcode ships) or XML.
 * Pure; returns nulls for anything missing or unparseable rather than throwing. Only the top-level dict
 * and string values are read (versions are always strings); other plist types are ignored.
 */
export function parseInfoPlist(bytes: Uint8Array): InfoPlist {
  // Declared inside the function: it is serialised by toString() into the browser, where a module-scope
  // constant wouldn't exist (the same self-containment rule as the inner helpers — see decision 0012).
  const WANTED_KEYS = ["CFBundleShortVersionString", "CFBundleVersion", "LSMinimumSystemVersion"];
  const found: Record<string, string> = {};
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const decode = (start: number, len: number, enc?: string): string =>
    new TextDecoder(enc).decode(bytes.subarray(start, start + len));

  if (bytes.length >= 8 && decode(0, 8) === "bplist00") {
    const n = bytes.length;
    const readBE = (pos: number, size: number): number => {
      let v = 0;
      for (let i = 0; i < size; i++) v = v * 256 + dv.getUint8(pos + i);
      return v;
    };
    const offsetIntSize = dv.getUint8(n - 26);
    const objectRefSize = dv.getUint8(n - 25);
    const topObject = readBE(n - 16, 8);
    const offsetTableOffset = readBE(n - 8, 8);
    const objOffset = (idx: number): number =>
      readBE(offsetTableOffset + idx * offsetIntSize, offsetIntSize);

    // A length nibble of 0xF means "an int object holds the real count"; advance past it.
    const sizedHeader = (pos: number, nibble: number): { count: number; pos: number } => {
      if (nibble !== 0x0f) return { count: nibble, pos };
      const intSize = 1 << (dv.getUint8(pos) & 0x0f);
      return { count: readBE(pos + 1, intSize), pos: pos + 1 + intSize };
    };

    const readString = (idx: number): string | null => {
      const off = objOffset(idx);
      const marker = dv.getUint8(off);
      const h = sizedHeader(off + 1, marker & 0x0f);
      if ((marker & 0xf0) === 0x50) return decode(h.pos, h.count); // ASCII
      if ((marker & 0xf0) === 0x60) return decode(h.pos, h.count * 2, "utf-16be"); // UTF-16BE
      return null;
    };

    let p = objOffset(topObject);
    const marker = dv.getUint8(p++);
    if ((marker & 0xf0) === 0xd0) {
      const h = sizedHeader(p, marker & 0x0f);
      const count = h.count;
      p = h.pos;
      const keyRefs: number[] = [];
      const valRefs: number[] = [];
      for (let i = 0; i < count; i++) {
        keyRefs.push(readBE(p, objectRefSize));
        p += objectRefSize;
      }
      for (let i = 0; i < count; i++) {
        valRefs.push(readBE(p, objectRefSize));
        p += objectRefSize;
      }
      for (let i = 0; i < count; i++) {
        const kr = keyRefs[i];
        const vr = valRefs[i];
        if (kr === undefined || vr === undefined) continue;
        const key = readString(kr);
        if (key !== null && WANTED_KEYS.indexOf(key) >= 0) {
          const val = readString(vr);
          if (val !== null) found[key] = val;
        }
      }
    }
  } else {
    const text = new TextDecoder().decode(bytes);
    for (const key of WANTED_KEYS) {
      const g = new RegExp(`<key>\\s*${key}\\s*</key>\\s*<string>([^<]*)</string>`).exec(text)?.[1];
      if (g !== undefined) found[key] = g.trim();
    }
  }

  return {
    shortVersion: found.CFBundleShortVersionString ?? null,
    buildNumber: found.CFBundleVersion ?? null,
    minOs: found.LSMinimumSystemVersion ?? null,
  };
}

// Hand-written async glue: read the picked file, locate + inflate Info.plist, prefill the form, and
// ALWAYS report the outcome (success or "couldn't read this — type it") so a failed autofill is never
// silent. Fills only empty or still-auto-filled fields, so a value the admin typed (e.g. a rollback
// build_number) is never clobbered when they pick the file.
const GLUE = `
(function () {
  var form = document.querySelector("[data-archive-autofill]");
  if (!form) return;
  var file = form.querySelector('input[type="file"]');
  var status = form.querySelector("[data-autofill-status]");
  if (!file) return;

  function say(msg, ok) {
    if (!status) return;
    status.textContent = msg;
    status.className = ok ? "hint muted" : "callout callout-warn";
    status.hidden = false;
  }
  form.addEventListener("input", function (e) {
    if (e.target && e.target !== file && e.target.dataset) e.target.dataset.autofilled = "";
  });
  function set(name, value) {
    var el = form.querySelector('[name="' + name + '"]');
    if (!el || !value) return;
    if (el.value && el.dataset.autofilled !== "1") return; // keep what the admin typed
    el.value = value;
    el.dataset.autofilled = "1";
  }

  file.addEventListener("change", function () {
    if (status) status.hidden = true;
    var f = file.files && file.files[0];
    if (!f) return;
    if (typeof DecompressionStream === "undefined") return; // ancient browser; stay silent
    f.arrayBuffer().then(function (buf) {
      var zip = new Uint8Array(buf);
      var loc = locateInfoPlist(zip);
      if (!loc) throw new Error("not-an-app-zip");
      var slice = zip.subarray(loc.start, loc.start + loc.length);
      if (loc.method === 0) return slice;
      var stream = new Blob([slice]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
      return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
    }).then(function (plist) {
      var info = parseInfoPlist(plist);
      if (!info.shortVersion && !info.buildNumber) throw new Error("no-version-keys");
      set("short_version", info.shortVersion);
      set("build_number", info.buildNumber);
      set("min_os", info.minOs);
      say("Filled version " + (info.shortVersion || "?") + " / build " + (info.buildNumber || "?") +
        " from the archive — edit if you're rolling forward.", true);
    }).catch(function () {
      say("Couldn't read the version from this archive. Autofill needs the signed .app .zip " +
        "(a .dmg or .tar can't be read) — enter version and build below.", false);
    });
  });
})();
`;

// Injected once by the upload page. `__name` is an identity shim for esbuild's keep-names helper, which
// wraps named inner functions and would otherwise be undefined in the browser (see decision 0012).
export const ARCHIVE_AUTOFILL_SCRIPT = `var __name = function (t) { return t; };
var locateInfoPlist = ${locateInfoPlist.toString()};
var parseInfoPlist = ${parseInfoPlist.toString()};
${GLUE}`;
