import type { Child, FC } from "hono/jsx";
import { TABLE_ENHANCE_SCRIPT } from "./table-enhance";

// Shared chrome for the gated back office: a left sidebar + content area, built on a CSS custom-property
// design system (one token set, light/dark via prefers-color-scheme). Pure JSX over props; rendered to a
// string by renderPage. Class names are kept stable so the per-page views need no changes here.

const styles = `
  :root {
    color-scheme: light dark;
    --bg: #f6f7f9; --surface: #ffffff; --surface-2: #f3f4f6;
    --text: #1d2127; --text-muted: #5b6573; --border: #e5e8ec;
    --accent: #2f5cff; --accent-text: #ffffff; --accent-weak: #eef2ff;
    --ok-text: #137a3a; --ok-weak: #e6f6ec;
    --warn-text: #b42318; --warn-weak: #fdecea;
    --danger: #c0362c; --danger-text: #ffffff; --danger-weak: #fdecea;
    --radius: 10px; --radius-sm: 7px;
    --shadow: 0 1px 2px rgba(16,24,40,.05), 0 1px 3px rgba(16,24,40,.07);
    --font: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    --mono: ui-monospace, SFMono-Regular, Menlo, monospace;
    --sidebar-w: 15rem;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #0d1014; --surface: #161a20; --surface-2: #1d222a;
      --text: #e6e9ee; --text-muted: #9aa4b2; --border: #2a313b;
      --accent: #6b8bff; --accent-text: #0d1014; --accent-weak: #1a2236;
      --ok-text: #5ad17e; --ok-weak: #13251a;
      --warn-text: #f6b06a; --warn-weak: #2a1f12;
      --danger: #ff6b5e; --danger-text: #0d1014; --danger-weak: #2a1614;
      --shadow: 0 1px 2px rgba(0,0,0,.4);
    }
  }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: var(--font); color: var(--text); background: var(--bg);
    display: grid; grid-template-columns: var(--sidebar-w) 1fr; min-height: 100vh; -webkit-font-smoothing: antialiased; }
  a { color: var(--accent); }
  :focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

  .skip { position: absolute; left: .5rem; top: -3rem; z-index: 10; background: var(--surface);
    color: var(--text); padding: .5rem .75rem; border-radius: var(--radius-sm); box-shadow: var(--shadow);
    text-decoration: none; transition: top .15s ease; }
  .skip:focus { top: .5rem; }

  .sidebar { background: var(--surface); border-right: 1px solid var(--border); padding: 1rem .6rem;
    position: sticky; top: 0; align-self: start; height: 100vh; overflow-y: auto; }
  .brand { display: flex; align-items: center; gap: .5rem; font-weight: 700; font-size: .95rem;
    padding: .4rem .7rem 1rem; color: var(--text); }
  .brand .dot { width: 12px; height: 12px; border-radius: 4px; background: var(--accent); }
  nav.primary { display: flex; flex-direction: column; gap: 2px; }
  nav.primary a { display: block; padding: .45rem .7rem; border-radius: var(--radius-sm);
    color: var(--text-muted); text-decoration: none; font-size: .875rem; font-weight: 500; }
  nav.primary a:hover { background: var(--surface-2); color: var(--text); }
  nav.primary a[aria-current="page"] { background: var(--accent-weak); color: var(--accent); }

  main { padding: 1.75rem 2rem 3rem; max-width: 74rem; }
  h1 { font-size: 1.35rem; font-weight: 650; margin: 0 0 1.25rem; letter-spacing: -.01em; }

  table { width: 100%; border-collapse: collapse; background: var(--surface); border: 1px solid var(--border);
    border-radius: var(--radius); overflow: hidden; box-shadow: var(--shadow); }
  th, td { text-align: left; padding: .6rem .8rem; border-bottom: 1px solid var(--border); font-size: .875rem; }
  tr:last-child td { border-bottom: none; }
  th { background: var(--surface-2); font-weight: 600; color: var(--text-muted); font-size: .8rem;
    text-transform: uppercase; letter-spacing: .03em; }
  tbody tr:hover { background: var(--surface-2); }
  tr[hidden] { display: none; }

  /* Click-to-sort headers (progressive enhancement: the JS adds .th-sort + aria-sort; without it these
     are plain headers). The glyph shows sort state — neutral ↕, then ↑/↓ on the active column. */
  th.th-sort { cursor: pointer; user-select: none; white-space: nowrap; }
  th.th-sort::after { content: "↕"; opacity: .3; margin-left: .35em; font-weight: 400; }
  th.th-sort[aria-sort="ascending"]::after { content: "↑"; opacity: .9; }
  th.th-sort[aria-sort="descending"]::after { content: "↓"; opacity: .9; }
  .table-status { margin: .6rem 0 0; font-size: .8rem; }

  .cards { display: flex; gap: 1rem; flex-wrap: wrap; }
  .card { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 1.1rem 1.35rem; box-shadow: var(--shadow); min-width: 9rem; }
  .card .n { font-size: 1.9rem; font-weight: 700; letter-spacing: -.02em; }
  .card .l { color: var(--text-muted); font-size: .8rem; }

  .badge { display: inline-flex; align-items: center; gap: .3rem; padding: .12rem .55rem; border-radius: 999px;
    font-size: .75rem; font-weight: 600; line-height: 1.5; }
  .ok { background: var(--ok-weak); color: var(--ok-text); }
  .warn { background: var(--warn-weak); color: var(--warn-text); }
  .muted { color: var(--text-muted); }

  form.inline { display: inline; }
  button, .btn { font: inherit; font-size: .82rem; font-weight: 500; padding: .4rem .75rem;
    border-radius: var(--radius-sm); border: 1px solid var(--border); background: var(--surface);
    color: var(--text); cursor: pointer; text-decoration: none; display: inline-block; line-height: 1.4; }
  button:hover, .btn:hover { background: var(--surface-2); }
  .btn-primary { background: var(--accent); border-color: var(--accent); color: var(--accent-text); }
  .btn-primary:hover { filter: brightness(1.05); background: var(--accent); }
  .btn-danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
  .btn-danger:hover { background: var(--danger-weak); }

  .empty { color: var(--text-muted); padding: 1rem 0; }
  .hint { margin: -.4rem 0 1rem; font-size: .82rem; }
  .callout { border-radius: var(--radius-sm); padding: .7rem .9rem; margin: 0 0 .85rem;
    font-size: .85rem; line-height: 1.5; }
  .callout-warn { background: var(--warn-weak); color: var(--warn-text);
    border: 1px solid color-mix(in srgb, var(--warn-text) 30%, transparent); }
  .addform { display: flex; gap: .5rem; flex-wrap: wrap; align-items: center; margin: 0 0 1rem; }

  /* Upload mode toggle (Normal release / Rollback) — pure CSS so it works with no JS: the radio reveals
     the rollback-only guidance via :has(). */
  .modes { display: flex; gap: 1.25rem; margin: 0 0 1.1rem; }
  .modes label { display: inline-flex; align-items: center; gap: .4rem; font-weight: 500; }
  .rollback-only { display: none; }
  form:has(#mode-rollback:checked) .rollback-only { display: block; }
  .panel { background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
    padding: 1.25rem 1.35rem; margin: 1rem 0; box-shadow: var(--shadow); }
  .panel h2 { font-size: .95rem; margin: 0 0 .85rem; font-weight: 650; }

  /* Row actions: a single baseline-aligned row that wraps as a unit. The Manage link carries .btn so it
     matches the POST buttons beside it instead of reading as bare underlined text on a stray baseline. */
  td.actions { white-space: nowrap; }
  .actions { display: flex; flex-wrap: wrap; gap: .4rem; align-items: center; }
  .actions form.inline { display: inline-flex; }

  input, select, textarea { font: inherit; font-size: .875rem; padding: .4rem .55rem; color: var(--text);
    background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius-sm); }
  textarea { width: 100%; min-height: 5rem; resize: vertical; }
  /* Stacked panel forms (Upload, Branding) wrap each field in a <p>; without a width the field shrinks to
     its content and clips long placeholders. File/checkbox inputs stay inline. */
  .panel p > input:not([type=checkbox]):not([type=file]),
  .panel p > select { display: block; width: 100%; max-width: 26rem; }
  input::placeholder, textarea::placeholder { color: var(--text-muted); }
  label { font-size: .875rem; }

  code { font-family: var(--mono); font-size: .85em; }
  .token, code.token { display: block; font-family: var(--mono); background: var(--surface-2);
    border: 1px solid var(--border); border-radius: var(--radius-sm); padding: .6rem; word-break: break-all; user-select: all; }
  pre { background: #0d1014; color: #e6e9ee; padding: .9rem 1rem; border-radius: var(--radius-sm);
    overflow-x: auto; font-size: .78rem; line-height: 1.55; }
  pre code { font-size: inherit; }
  .kv td:first-child { color: var(--text-muted); width: 12rem; }

  @media (max-width: 48rem) {
    body { grid-template-columns: 1fr; }
    .sidebar { position: static; height: auto; border-right: none; border-bottom: 1px solid var(--border); }
    nav.primary { flex-direction: row; flex-wrap: wrap; }
    main { padding: 1.25rem; }
  }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }
`;

// Sets aria-current on the active nav link (progressive enhancement: the server renders no active state,
// so the nav is fully usable without JS; this only adds the highlight). Longest-prefix match, with
// /admin matched only exactly so the Dashboard link doesn't claim every sub-page.
const activeNavScript = `
  (function () {
    var path = location.pathname, best = null, len = -1;
    document.querySelectorAll('nav.primary a').forEach(function (a) {
      var h = a.getAttribute('href');
      var match = h === path || (h !== '/admin' && path.indexOf(h + '/') === 0);
      if (match && h.length > len) { best = a; len = h.length; }
    });
    if (best) best.setAttribute('aria-current', 'page');
  })();
`;

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/users", "Users"],
  ["/admin/builds", "Builds"],
  ["/admin/streams", "Channels"],
  ["/admin/pending", "Requests"],
  ["/admin/upload", "Upload"],
  ["/admin/ci", "CI"],
  ["/admin/setup", "Setup"],
  ["/admin/settings", "Settings"],
  ["/admin/activity", "Activity"],
  ["/admin/audit", "Audit"],
] as const;

export const AdminLayout: FC<{ title: string; children?: Child }> = ({ title, children }) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Alpha Gate</title>
      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </head>
    <body>
      <a href="#main" class="skip">
        Skip to content
      </a>
      <aside class="sidebar">
        <div class="brand">
          <span class="dot" aria-hidden="true" />
          Alpha Gate
        </div>
        <nav class="primary" aria-label="Primary">
          {NAV.map(([href, label]) => (
            <a href={href}>{label}</a>
          ))}
        </nav>
      </aside>
      <main id="main">
        <h1>{title}</h1>
        {children}
      </main>
      <script dangerouslySetInnerHTML={{ __html: activeNavScript }} />
      <script dangerouslySetInnerHTML={{ __html: TABLE_ENHANCE_SCRIPT }} />
    </body>
  </html>
);

export const NoBuildBadge: FC<{ state: string }> = ({ state }) =>
  state === "servable" ? <span class="badge ok">ok</span> : <span class="badge warn">{state}</span>;
