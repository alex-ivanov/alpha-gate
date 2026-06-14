import { gateToken } from "../../auth/token-gate";
import { renderAppcast, renderInformationalItem, renderUpdateItem } from "../../core/appcast";
import { insertEvent } from "../../db/access-log";
import { loadBranding } from "../../services/branding";
import type { AppContext } from "./app-context";
import { resolveServed } from "./resolve";

// §8/§15 — the per-user appcast. Gate → resolve → one of three feeds: a target item (a servable
// build), an EMPTY feed (active but no-build, §11 — Sparkle stays "up to date"), or the reactivation
// notice (revoked/unknown only). Active checks log a `check` with the installed build the app reports.
// Never a 403: an unknown token still gets the notice so background checks surface it (decision 0010).
export async function appcastRoute(c: AppContext): Promise<Response> {
  const deps = c.get("deps");
  const origin = new URL(c.req.url).origin;
  const accessUrl = `${origin}/access`;
  const title = (await loadBranding(deps)).appName;

  const gate = await gateToken(deps, c.req.query("token"));

  let items: readonly string[];
  if (gate.kind !== "active") {
    // Revoked AND unknown take the identical path — same item, same (no) resolve/log work — so the
    // response can't reveal whether a token exists (§6/§16): no DB write is gated on token existence.
    items = [renderInformationalItem(accessUrl)];
  } else {
    const client = gate.client;
    const result = await resolveServed(deps, client);
    // Active client: the resolved build, or an EMPTY feed when nothing is servable (the §11 no-build
    // state) so Sparkle reports "up to date" rather than prompting. The reactivation notice is for
    // revoked/unknown tokens only (§8/§15, decision 0010) — a valid user is never told to reactivate.
    items =
      result.kind === "target"
        ? [
            renderUpdateItem(
              result.build,
              `${origin}/download?token=${encodeURIComponent(client.token)}&via=update`,
            ),
          ]
        : [];

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

  return c.body(renderAppcast({ title, items }), 200, {
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
