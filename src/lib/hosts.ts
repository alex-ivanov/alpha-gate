// Derive the public App Worker origin from the admin Worker's own URL. deploy.sh names the pair
// `alpha-gate-<inst>` (app) and `alpha-gate-<inst>-admin` (admin), both on *.workers.dev — so the app
// origin is the admin origin with the `-admin` name suffix dropped. Returns null when it can't know
// (a custom admin domain), so callers show a placeholder rather than a wrong URL.

export function adminToAppOrigin(adminUrl: string): string | null {
  let url: URL;
  try {
    url = new URL(adminUrl);
  } catch {
    return null;
  }
  if (!url.hostname.endsWith(".workers.dev")) return null;
  const labels = url.hostname.split(".");
  const first = labels[0];
  if (first === undefined || !first.endsWith("-admin")) return null;
  labels[0] = first.slice(0, -"-admin".length);
  return `${url.protocol}//${labels.join(".")}`;
}
