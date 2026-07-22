import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

// Which EdDSA key publish.sh hands to sign_update. Signing with the wrong key is invisible until the
// update ships and every installed app rejects it, so these tests pin the exact argv — the contract
// with Sparkle's sign_update (`--account <name>`, `-f/--ed-key-file <path>`, `-` = key on stdin).
//
// The setup: a stub `sign_update` that records its argv and stdin instead of signing, an artifact with
// an extension publish.sh can't read a plist from (so the version comes from flags), and --dry-run so
// nothing is uploaded. Signing happens BEFORE the dry-run exit, which is exactly what we want to see.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const PUBLISH = path.join(ROOT, "publish.sh");

let dir: string;
let stub: string;
let record: string;
let artifact: string;

beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "alpha-gate-signing-"));
  record = path.join(dir, "record.txt");
  stub = path.join(dir, "sign_update");
  writeFileSync(
    stub,
    [
      "#!/usr/bin/env bash",
      // One line per argument, then the stdin the tool was given, so the assertions read literally.
      `printf 'arg:%s\\n' "$@" >> "${record}"`,
      `printf 'stdin:%s\\n' "$(cat)" >> "${record}"`,
      'echo \'sparkle:edSignature="STUB-SIGNATURE" length="123"\'',
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  artifact = path.join(dir, "MyApp.tar");
  writeFileSync(artifact, "not really an archive");
});

function publish(extraArgs: string[], env: Record<string, string> = {}): string {
  execFileSync(
    "bash",
    [
      PUBLISH,
      artifact,
      "--admin-url",
      "http://localhost:1",
      "--build-number",
      "42",
      "--short-version",
      "1.2",
      "--sign-update",
      stub,
      "--dry-run",
      ...extraArgs,
    ],
    {
      // Start from a clean slate: whatever the developer's own shell exports must not decide the
      // argv under test.
      env: {
        ...process.env,
        SPARKLE_ED_KEY: "",
        SPARKLE_ED_KEY_FILE: "",
        SPARKLE_ED_KEY_ACCOUNT: "",
        ...env,
      },
      encoding: "utf8",
    },
  );
  return readFileSync(record, "utf8");
}

describe("publish.sh: choosing the signing key", () => {
  it("passes no key flags by default, leaving sign_update on its own 'ed25519' Keychain account", () => {
    const seen = publish([]);
    expect(seen).toBe(`arg:${artifact}\nstdin:\n`);
  });

  it("names a Keychain account with --account", () => {
    const seen = publish(["--ed-key-account", "myapp-alpha"]);
    expect(seen).toBe(`arg:--account\narg:myapp-alpha\narg:${artifact}\nstdin:\n`);
  });

  it("points at an exported key file with --ed-key-file", () => {
    const key = path.join(dir, "sparkle_private.pem");
    writeFileSync(key, "base64key");
    const seen = publish(["--ed-key-file", key]);
    expect(seen).toBe(`arg:--ed-key-file\narg:${key}\narg:${artifact}\nstdin:\n`);
  });

  it("feeds $SPARKLE_ED_KEY through stdin, never argv — CI keeps the key out of `ps`", () => {
    const seen = publish([], { SPARKLE_ED_KEY: "SECRET-KEY-MATERIAL" });
    expect(seen).toBe(`arg:--ed-key-file\narg:-\narg:${artifact}\nstdin:SECRET-KEY-MATERIAL\n`);
    expect(seen).not.toContain("arg:SECRET-KEY-MATERIAL");
  });

  it("accepts the same choices from the environment", () => {
    expect(publish([], { SPARKLE_ED_KEY_ACCOUNT: "from-env" })).toContain("arg:from-env");
  });

  it("lets a flag override the environment", () => {
    const seen = publish(["--ed-key-account", "from-flag"], { SPARKLE_ED_KEY_ACCOUNT: "from-env" });
    expect(seen).toContain("arg:from-flag");
    expect(seen).not.toContain("from-env");
  });

  it("refuses two key sources at once rather than silently preferring one", () => {
    expect(() => publish(["--ed-key-account", "acct"], { SPARKLE_ED_KEY: "key" })).toThrow(
      /name the signing key exactly once/,
    );
  });

  it("refuses a key file that isn't there — before the multi-minute upload, not after", () => {
    expect(() => publish(["--ed-key-file", path.join(dir, "absent.pem")])).toThrow(/no such file/);
  });
});
