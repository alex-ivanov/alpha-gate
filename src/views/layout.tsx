import type { Child, FC } from "hono/jsx";

// Shared HTML shell for the public pages. Pure: props in, markup out. The accent color is the one
// branding knob that reaches the chrome (§6); everything else is page content. renderPage prepends
// the doctype so route handlers don't hand-concatenate strings.

const baseStyles = (accent: string) => `
  :root { --accent: ${accent}; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #f5f5f7; color: #1d1d1f; padding: 2rem; }
  .card { width: 100%; max-width: 28rem; background: #fff; border-radius: 16px;
    padding: 2.5rem; box-shadow: 0 1px 3px rgba(0,0,0,.08); text-align: center; }
  .icon { width: 72px; height: 72px; border-radius: 16px; }
  h1 { font-size: 1.5rem; margin: 1rem 0 .25rem; }
  .blurb { color: #6e6e73; margin: 0 0 1.5rem; }
  .btn { display: block; width: 100%; padding: .75rem 1rem; margin: .5rem 0; border-radius: 10px;
    border: 1px solid #d2d2d7; background: #fff; color: #1d1d1f; font-size: 1rem; font-weight: 500;
    text-decoration: none; cursor: pointer; }
  .btn.primary { background: var(--accent); border-color: var(--accent); color: #fff; }
  .input { display: block; width: 100%; padding: .75rem 1rem; margin: .5rem 0; border-radius: 10px;
    border: 1px solid #d2d2d7; font-size: 1rem; }
  .hint { color: #6e6e73; font-size: .85rem; margin: 1.5rem 0 .25rem; }
  .token { display: block; font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    background: #f5f5f7; border-radius: 8px; padding: .6rem; word-break: break-all; user-select: all; }
  .steps { text-align: left; color: #424245; font-size: .9rem; margin-top: 1.5rem; padding-left: 1.25rem; }
  .muted { color: #6e6e73; }
`;

export const Layout: FC<{ title: string; accent: string; children?: Child }> = ({
  title,
  accent,
  children,
}) => (
  <html lang="en">
    <head>
      <meta charset="utf-8" />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title}</title>
      {/* CSS is raw, not escaped */}
      <style dangerouslySetInnerHTML={{ __html: baseStyles(accent) }} />
    </head>
    <body>
      <main class="card">{children}</main>
    </body>
  </html>
);

/**
 * Renders a full page element to an HTML string with the doctype prepended. Our pages are synchronous
 * hono/jsx components, so the element stringifies directly (a hono JSX.Element is a string subtype).
 */
export function renderPage(element: string | Promise<string>): string {
  return `<!DOCTYPE html>\n${String(element)}`;
}
