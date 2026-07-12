# site/

The marketing page: one static HTML file plus its screenshots. No build step, no external
requests — system fonts, inline CSS/JS, images from `shots/`.

**Canonical URL is `https://alphagate.dev/`** (301 `alpha-gate.dev` → `alphagate.dev`). SEO lives
next to the page: `robots.txt`, `sitemap.xml` (bump `lastmod` on content changes), `llms.txt`
(the summary AI agents read), `og.png` (the 1200×630 social card — regenerate in the site's
palette if the headline changes), `favicon.svg`, and `_headers` (image caching). The JSON-LD
and OG tags are in `index.html`'s head.

**Serve it** with any static host pointed at this directory:

- **Cloudflare Pages**: connect the repo, set the output directory to `site/`. Deploys on push.
- **GitHub Pages**: use the Actions route (`upload-pages-artifact` on `site/` + `deploy-pages`);
  branch-based Pages only serves `/` or `/docs`.

**The screenshots** in `shots/` are real captures of the back office running locally, both
themes, taken from a demo world (5 testers, 3 builds, channels `beta`/`stable`, one pin, one
revocation). To refresh them after a UI change:

1. `./deploy/dev.sh --no-seed` (wipe `.wrangler/state` first for a clean start), then rebuild
   the world through the admin endpoints — channels via `POST /admin/streams`, builds via
   `POST /admin/builds/upload`, testers via `POST /admin/clients`, plus a pin, a revoke, and a
   few real `/appcast?token=…&installed=…` checks against the app Worker so Activity has data.
2. Capture at 1300×780 with `--force-device-scale-factor=2`; dark theme by injecting
   `data-theme="dark"` on `<html>` in a saved copy of the page.
3. Quantize to 256-colour PNGs (Pillow: `quantize(colors=256, dither=NONE)`) — flat UI
   compresses to ~50–110 KB per shot.

Keep the demo world consistent with the copy in `index.html` (the live feed demo and the
slide texts describe the same testers and builds).
