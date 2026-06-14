// Pure parsers/validators for wrangler's output. Centralizing them (vs. inline grep/jq in bash) means
// every value pulled from a command is validated before use — an empty/garbled result becomes null/[]
// here and the command layer fails loudly rather than writing poison into the state file.

/** The D1 uuid for `dbName` from `wrangler d1 list --json`, or null if absent/garbled. */
export function parseD1Id(listJson: string, dbName: string): string | null {
  try {
    const list: unknown = JSON.parse(listJson);
    if (!Array.isArray(list)) return null;
    for (const item of list) {
      if (
        item !== null &&
        typeof item === "object" &&
        (item as { name?: unknown }).name === dbName
      ) {
        const id = (item as { uuid?: unknown }).uuid;
        return typeof id === "string" && id.length > 0 ? id : null;
      }
    }
    return null;
  } catch {
    return null;
  }
}

/** Secret names from `wrangler secret list --format json` (e.g. to check ACCESS_TEAM_DOMAIN is set). */
export function secretNames(listJson: string): string[] {
  try {
    const list: unknown = JSON.parse(listJson);
    if (!Array.isArray(list)) return [];
    const names: string[] = [];
    for (const item of list) {
      const name =
        item !== null && typeof item === "object" ? (item as { name?: unknown }).name : undefined;
      if (typeof name === "string") names.push(name);
    }
    return names;
  } catch {
    return [];
  }
}

export function accessConfigured(secretListJson: string): boolean {
  return secretNames(secretListJson).includes("ACCESS_TEAM_DOMAIN");
}

/** The one unavoidable scrape: the workers.dev URL from `wrangler deploy` stdout (no --json for it). */
export function extractDeployUrl(stdout: string): string | null {
  const match = stdout.match(/https:\/\/[a-z0-9.-]+\.workers\.dev/i);
  return match ? match[0] : null;
}
