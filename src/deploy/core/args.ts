import { err, ok, type Result } from "./result";
import type { Role } from "./types";

// Pure flag parsing + validation for the `deploy` command — the same rules the bash deploy.sh enforced
// (slug charset, email pairing, Access pairing), now typed and unit-tested instead of scattered shell
// checks. Returns a Result; the command layer renders an error like the preflight (reason + hint).

export type EmailProvider = "none" | "cloudflare";

export interface DeployArgs {
  instance: string;
  appName: string | null;
  activateScheme: string | null;
  blurb: string | null;
  accent: string | null;
  accessTeamDomain: string | null;
  accessAud: string | null;
  emailProvider: EmailProvider;
  emailFrom: string | null;
  dryRun: boolean;
  yes: boolean;
}

// Lowercase letters, digits and hyphens; no leading/trailing hyphen (doubles allowed, as in deploy.sh).
const SLUG = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

const VALUE_FLAGS = new Set([
  "--instance",
  "--app-name",
  "--activate-scheme",
  "--blurb",
  "--accent",
  "--access-team-domain",
  "--access-aud",
  "--email-provider",
  "--email-from",
]);

/** Strip a pasted scheme/trailing slash so the in-app issuer check can't silently fail on a URL form. */
export function normalizeTeamDomain(raw: string): string {
  return raw.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

export function parseDeployArgs(argv: readonly string[]): Result<DeployArgs> {
  const values: Record<string, string> = {};
  let dryRun = false;
  let yes = false;

  for (let i = 0; i < argv.length; i++) {
    const flag = argv[i];
    if (flag === undefined) continue;
    if (flag === "--dry-run") {
      dryRun = true;
    } else if (flag === "--yes") {
      yes = true;
    } else if (VALUE_FLAGS.has(flag)) {
      const value = argv[i + 1];
      if (value === undefined) return err(`${flag} needs a value`);
      values[flag] = value;
      i++;
    } else {
      return err(`unknown flag: ${flag}`, "run `deploy --help` for the supported flags");
    }
  }

  const instance = values["--instance"];
  if (instance === undefined || instance === "") {
    return err("--instance is required", "e.g. --instance myalpha");
  }
  if (!SLUG.test(instance)) {
    return err(
      `invalid --instance '${instance}'`,
      "lowercase letters, digits and hyphens only (no leading/trailing hyphen)",
    );
  }

  const emailProvider = values["--email-provider"] ?? "none";
  if (emailProvider !== "none" && emailProvider !== "cloudflare") {
    return err(`invalid --email-provider '${emailProvider}'`, "expected 'none' or 'cloudflare'");
  }
  const emailFrom = values["--email-from"] ?? null;
  if (emailProvider === "cloudflare" && (emailFrom === null || emailFrom === "")) {
    return err(
      "--email-from is required when --email-provider is cloudflare",
      "pass --email-from alpha@<your-sending-domain>",
    );
  }

  const rawTeam = values["--access-team-domain"] ?? null;
  const accessAud = values["--access-aud"] ?? null;
  if ((rawTeam === null) !== (accessAud === null)) {
    return err(
      "--access-team-domain and --access-aud must be provided together",
      "both are on the Access app's Overview page in Cloudflare Zero Trust",
    );
  }

  return ok({
    instance,
    appName: values["--app-name"] ?? null,
    activateScheme: values["--activate-scheme"] ?? null,
    blurb: values["--blurb"] ?? null,
    accent: values["--accent"] ?? null,
    accessTeamDomain: rawTeam === null ? null : normalizeTeamDomain(rawTeam),
    accessAud,
    emailProvider,
    emailFrom,
    dryRun,
    yes,
  });
}

export type { Role };
