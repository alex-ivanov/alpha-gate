import { gateToken } from "../../auth/token-gate";
import { renderAppcast, renderInformationalItem, renderUpdateItem } from "../../core/appcast";
import { insertEvent } from "../../db/access-log";
import { loadBranding } from "../../services/branding";
import type { AppContext } from "./app-context";
import { resolveServed } from "./resolve";

// §8/§15 — the per-user appcast. Gate → resolve → emit a target item or the informational notice
// (revoked/unknown), and log a `check` recording the installed build the app reports. Never a 403:
// an unknown token gets the informational item so background checks still surface a notice.
export async function appcastRoute(c: AppContext): Promise<Response> {
  const deps = c.get("deps");
  const origin = new URL(c.req.url).origin;
  const accessUrl = `${origin}/access`;
  const title = (await loadBranding(deps)).appName;

  const gate = await gateToken(deps, c.req.query("token"));

  let item: string;
  if (gate.kind === "unknown") {
    item = renderInformationalItem(accessUrl);
  } else {
    const client = gate.client;
    const result = await resolveServed(deps, client); // resolve maps revoked → informational
    item =
      result.kind === "target"
        ? renderUpdateItem(
            result.build,
            `${origin}/download?token=${encodeURIComponent(client.token)}&via=update`,
          )
        : renderInformationalItem(accessUrl);

    await insertEvent(deps.db, {
      clientId: client.id,
      email: client.email,
      event: "check",
      buildNumber: parseInstalled(c.req.query("installed"), c.req.query("appVersion")),
      ip: c.req.header("cf-connecting-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
      createdAt: deps.clock(),
    });
  }

  return c.body(renderAppcast({ title, items: [item] }), 200, {
    "Content-Type": "application/rss+xml; charset=utf-8",
  });
}

// decision 0004: the app sends &installed=<build_number>; Sparkle's appVersion is an opportunistic
// fallback. Parse defensively — only an all-digit value counts, else NULL (never throws).
function parseInstalled(...candidates: (string | undefined)[]): number | null {
  for (const raw of candidates) {
    if (raw !== undefined && /^\d+$/.test(raw.trim())) {
      return Number.parseInt(raw.trim(), 10);
    }
  }
  return null;
}
