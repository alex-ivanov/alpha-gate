import type { Child, FC } from "hono/jsx";

// Shared chrome for the gated back office: top nav + table styling. Pure JSX over props; rendered to
// a string by renderPage (views/layout). Kept separate from the public layout (different audience).

const styles = `
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #1d1d1f; background: #f5f5f7; }
  nav { display: flex; gap: 1rem; padding: 1rem 1.5rem; background: #1d1d1f; }
  nav a { color: #f5f5f7; text-decoration: none; font-size: .9rem; font-weight: 500; }
  nav a:hover { color: #fff; text-decoration: underline; }
  main { max-width: 70rem; margin: 0 auto; padding: 1.5rem; }
  h1 { font-size: 1.4rem; }
  table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 10px; overflow: hidden;
    box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  th, td { text-align: left; padding: .6rem .8rem; border-bottom: 1px solid #eee; font-size: .9rem; }
  th { background: #fafafa; font-weight: 600; }
  .cards { display: flex; gap: 1rem; flex-wrap: wrap; }
  .card { background: #fff; border-radius: 10px; padding: 1.25rem 1.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.06); }
  .card .n { font-size: 2rem; font-weight: 700; }
  .card .l { color: #6e6e73; font-size: .85rem; }
  .badge { display: inline-block; padding: .1rem .5rem; border-radius: 6px; font-size: .75rem; font-weight: 600; }
  .ok { background: #e3f6e8; color: #1a7f37; }
  .warn { background: #fdecea; color: #b42318; }
  .muted { color: #6e6e73; }
  form.inline { display: inline; }
  button, .btn { font-size: .8rem; padding: .3rem .6rem; border-radius: 6px; border: 1px solid #d2d2d7;
    background: #fff; cursor: pointer; }
  .empty { color: #6e6e73; padding: 1rem 0; }
`;

const NAV = [
  ["/admin", "Dashboard"],
  ["/admin/users", "Users"],
  ["/admin/builds", "Builds"],
  ["/admin/streams", "Channels"],
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
      <nav>
        {NAV.map(([href, label]) => (
          <a href={href}>{label}</a>
        ))}
      </nav>
      <main>
        <h1>{title}</h1>
        {children}
      </main>
    </body>
  </html>
);

export const NoBuildBadge: FC<{ state: string }> = ({ state }) =>
  state === "servable" ? <span class="badge ok">ok</span> : <span class="badge warn">{state}</span>;
