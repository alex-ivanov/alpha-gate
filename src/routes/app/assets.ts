import { getObject } from "../../r2/builds-bucket";
import { BRANDING_HEADER_KEY, BRANDING_ICON_KEY } from "../../r2/keys";
import type { AppContext } from "./app-context";

// §6/§13 — public branding assets. Only the known names map to keys (no arbitrary R2 access), and
// responses set an explicit Content-Type plus X-Content-Type-Options:nosniff so user-uploaded bytes
// are never sniffed as HTML (branding attack-surface mitigation).
const ASSET_KEYS: Record<string, string> = {
  icon: BRANDING_ICON_KEY,
  header: BRANDING_HEADER_KEY,
};

export async function assetsRoute(c: AppContext): Promise<Response> {
  const deps = c.get("deps");
  const name = c.req.param("name");
  const key = name === undefined ? undefined : ASSET_KEYS[name];
  if (key === undefined) return c.text("Not found", 404);

  const object = await getObject(deps.r2, key);
  if (object === null) return c.text("Not found", 404);

  c.header("Content-Type", object.httpMetadata?.contentType ?? "application/octet-stream");
  c.header("X-Content-Type-Options", "nosniff");
  return c.body(object.body);
}
