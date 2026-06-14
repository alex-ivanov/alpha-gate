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

// The public `/get?token=` invite link a user follows. It must resolve on the *App* host — `/get` only
// exists there — so derive it from the admin URL. When the app host can't be known (custom domain, local
// dev), fall back to the admin request origin: no worse than before, and the only option without it.
export function inviteUrl(adminUrl: string, token: string): string {
  const origin = adminToAppOrigin(adminUrl) ?? new URL(adminUrl).origin;
  return `${origin}/get?token=${encodeURIComponent(token)}`;
}
