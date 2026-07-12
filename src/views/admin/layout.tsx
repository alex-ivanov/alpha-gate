import type { Child, FC } from "hono/jsx";
import { COMBOBOX_SCRIPT } from "./combobox";
import { TABLE_ENHANCE_SCRIPT } from "./table-enhance";

// The back-office chrome — "quiet instrument": one continuous sheet structured by hairlines and a
// strict type hierarchy, color spent almost exclusively on state, mono only where data is machine-ish
// (build numbers, tokens, channels, timestamps). No cards, no shadows; elevation is two hairline
// weights. The serving map (dashboard) is the one decorated object; everything else is restraint.
// Pure JSX over props; light + dark from one token set. Theme follows the OS by default, with a
// per-operator override (the sidebar toggle → a `theme` cookie → data-theme on <html>).

// The dark rules exist ONCE and apply two ways: under prefers-color-scheme when the operator hasn't
// forced light, and unconditionally under a forced data-theme="dark". `root` is the selector prefix.
const darkRules = (root: string) => `
${root}{color-scheme:dark;
  --paper:#202126; --pane:#1a1b1f; --inset:#27282e;
  --ink:#e9eaee; --ink2:#b1b3ba; --ink3:#8f9199;
  --line:#33343b; --line2:#4a4b53;
  --accent:#5cc6d8; --accent-ink:#0b262c; --accent-weak:#173237;
  --ok:#5dbd72; --ok-dot:#3fa85c; --ok-weak:#15251a;
  --warn:#d9a521; --warn-dot:#c69026; --warn-weak:#2b2310;
  --danger:#f38175; --danger-dot:#e05d51; --danger-weak:#331a17;
  --crit-bg:#f38175; --crit-ink:#33100b;
}
${root} pre{background:#141519;border:1px solid var(--line)}
${root} .btn-danger{color:#2a0f0b}
`;

const styles = `
*{margin:0;padding:0;box-sizing:border-box}
:root{
  color-scheme:light dark;
  --sans:-apple-system,BlinkMacSystemFont,"Segoe UI",system-ui,sans-serif;
  --mono:ui-monospace,"SF Mono",SFMono-Regular,Menlo,Consolas,monospace;
  --paper:#fcfcfd; --pane:#f4f4f6; --inset:#f1f1f4;
  --ink:#1b1c1e; --ink2:#4c4e54; --ink3:#6e7076;
  --line:#e7e8eb; --line2:#cfd0d6;
  --accent:#0e6e7e; --accent-ink:#ffffff; --accent-weak:#e3eff1;
  --ok:#1a7f37; --ok-dot:#2da44e; --ok-weak:#e9f4ec;
  --warn:#95650a; --warn-dot:#dba714; --warn-weak:#faf1d8;
  --danger:#b42318; --danger-dot:#d6493e; --danger-weak:#fdecec;
  --crit-bg:#b42318; --crit-ink:#ffffff;
}
:root[data-theme=light]{color-scheme:light}
@media (prefers-color-scheme:dark){${darkRules(":root:not([data-theme=light])")}}
${darkRules(":root[data-theme=dark]")}
body{display:flex;min-height:100vh;background:var(--paper);color:var(--ink);
  font:13px/1.5 var(--sans);-webkit-font-smoothing:antialiased;font-variant-numeric:tabular-nums}
::selection{background:var(--accent-weak)}
:focus-visible{outline:2px solid var(--accent);outline-offset:2px;border-radius:3px}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
a{color:inherit}
.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;
  clip:rect(0 0 0 0);white-space:nowrap;border:0}
.skip{position:absolute;left:8px;top:-48px;z-index:10;background:var(--paper);color:var(--ink);
  padding:8px 12px;border:1px solid var(--line2);border-radius:5px;text-decoration:none;transition:top .15s}
.skip:focus{top:8px}

/* ————— sidebar ————— */
aside{width:212px;flex:none;background:var(--pane);border-right:1px solid var(--line);
  padding:18px 14px;display:flex;flex-direction:column;gap:22px;
  position:sticky;top:0;height:100vh;overflow-y:auto}
.brand{display:flex;gap:9px;align-items:center;padding:2px 8px;text-decoration:none}
.brand svg{width:17px;height:17px;color:var(--ink3);flex:none}
.brand .dotmark{fill:var(--accent)}
.brand b{display:block;font-size:13px;font-weight:600;letter-spacing:-.01em}
.brand span{display:block;font:10.5px var(--mono);color:var(--ink3);margin-top:1px}
nav.primary{display:flex;flex-direction:column;gap:18px}
nav.primary h6{font:600 10px var(--sans);letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink3);padding:0 8px;margin-bottom:5px}
nav.primary a{display:flex;align-items:center;gap:6px;padding:4.5px 8px;border-radius:5px;
  color:var(--ink2);text-decoration:none;font-size:13px;position:relative;transition:background .1s}
nav.primary a:hover{color:var(--ink);background:var(--inset)}
nav.primary a[aria-current]{color:var(--ink);font-weight:600}
nav.primary a[aria-current]::before{content:"";position:absolute;left:-8px;top:6px;bottom:6px;
  width:2px;border-radius:2px;background:var(--accent)}
.chip{margin-left:auto;font:600 10.5px var(--mono);color:var(--warn);
  background:var(--warn-weak);padding:1px 6px;border-radius:999px}
.theme{margin-top:auto;display:flex;border:1px solid var(--line2);border-radius:5px;overflow:hidden}
.theme button{flex:1;font:500 10.5px var(--sans);padding:4px 0;border:none;border-radius:0;
  background:transparent;color:var(--ink3);cursor:pointer}
.theme button+button{border-left:1px solid var(--line2)}
.theme button:hover{color:var(--ink);background:var(--inset)}
.theme button[aria-pressed=true]{background:var(--inset);color:var(--ink);font-weight:600}

/* ————— main + page head ————— */
main{flex:1;min-width:0;max-width:1180px;padding:26px 36px 56px}
.pagehead{display:flex;align-items:baseline;gap:14px;flex-wrap:wrap}
h1{font-size:19px;font-weight:650;letter-spacing:-.013em}
.sub{color:var(--ink3);font-size:12.5px}
.inv{margin-left:auto;font-size:12px;color:var(--ink3)}
.inv a{color:inherit;text-decoration:none}
.inv a:hover{color:var(--accent)}
.crumb{font-size:12px;color:var(--ink3);margin-bottom:6px}
.crumb a{color:var(--ink3);text-decoration:none}
.crumb a:hover{color:var(--accent);text-decoration:underline}

/* ————— sections (slabs, not cards) ————— */
section{margin-top:36px}
.slab{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  border-bottom:1px solid var(--line2);padding-bottom:7px}
.slab h2{font:600 10.5px var(--sans);letter-spacing:.1em;text-transform:uppercase;color:var(--ink3)}
.slab .hint{font-size:11.5px;color:var(--ink3)}
.slab a{font-size:11.5px;color:var(--ink3);text-decoration:none}
.slab a:hover{color:var(--accent)}

/* ————— canonical version lockup ————— */
.lk{font-family:var(--mono);font-size:12px;white-space:nowrap;text-decoration:none;color:var(--ink)}
.lk b{font-weight:600}
.lk i{font-style:normal;font-weight:400;color:var(--ink3)}
.lk.dim,.lk.dim b{color:var(--ink3);font-weight:400}
a.lk:hover b{text-decoration:underline}
.num{font-family:var(--mono);font-weight:600}

/* ————— state tags (exceptions only) ————— */
.tag{display:inline-block;font:500 10.5px var(--mono);padding:1px 7px 2px;
  border:1px solid;border-radius:4px;white-space:nowrap;vertical-align:1px}
.tag.warn{color:var(--warn);border-color:color-mix(in srgb,var(--warn) 45%,transparent)}
.tag.mut{color:var(--ink3);border-color:var(--line2)}
.tag.acc{color:var(--accent);border-color:color-mix(in srgb,var(--accent) 45%,transparent)}
.tag.crit{color:var(--crit-ink);background:var(--crit-bg);border-color:var(--crit-bg);font-weight:600}

/* ————— state dots ————— */
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;flex:none}
.dot.ok{background:var(--ok-dot)}
.dot.warn{background:var(--warn-dot)}
.dot.off{background:transparent;box-shadow:inset 0 0 0 1.5px var(--warn-dot)}
.dot.req{background:var(--accent)}

/* ————— text roles ————— */
.mut{color:var(--ink3)}
.t{font:11.5px var(--mono);color:var(--ink3);white-space:nowrap}
.vd{font-size:12.5px}
.vd .lk{font-size:12.5px}
.vd .tag{margin-left:2px}

/* ————— notices + callouts ————— */
.notice{margin-top:14px;border:1px solid color-mix(in srgb,var(--ok) 30%,transparent);
  background:var(--ok-weak);color:var(--ok);border-radius:8px;padding:8px 12px;font-size:12.5px}
.callout{border-radius:8px;padding:10px 13px;margin:14px 0;font-size:12.5px;line-height:1.55}
.callout.warn{background:var(--warn-weak);color:var(--warn);
  border:1px solid color-mix(in srgb,var(--warn) 30%,transparent)}
.callout.ok{background:var(--ok-weak);color:var(--ok);
  border:1px solid color-mix(in srgb,var(--ok) 30%,transparent)}
.callout.danger{background:var(--danger-weak);color:var(--danger);
  border:1px solid color-mix(in srgb,var(--danger) 30%,transparent)}
.callout a{color:inherit}

/* ————— verdict strip (detail pages) ————— */
.verdict{display:flex;gap:10px;align-items:baseline;border-top:1px solid var(--line2);
  border-bottom:1px solid var(--line2);padding:12px 0;margin-top:18px;font-size:13px}
.verdict .dot{align-self:center}
.verdict .lk{font-size:13px}

/* ————— tables ————— */
.tbl{overflow-x:auto}
table{width:100%;border-collapse:collapse}
th{font:600 10px var(--sans);letter-spacing:.09em;text-transform:uppercase;color:var(--ink3);
  text-align:left;padding:7px 10px;border-bottom:1px solid var(--line2);white-space:nowrap}
td{padding:8px 10px;border-bottom:1px solid var(--line);font-size:12.5px;vertical-align:baseline}
tbody tr:hover{background:var(--inset)}
tr[hidden]{display:none}
td.r,th.r{text-align:right}
tr.dim td{color:var(--ink3)}
tr.dim td a{color:var(--ink3)}
td .who{font-weight:600;color:var(--ink);text-decoration:none}
td .who:hover{text-decoration:underline}
td .lbl{color:var(--ink3);margin-left:7px;font-size:12px}
td.chs{font-family:var(--mono);font-size:11.5px}
td.chs a{color:var(--ink2);text-decoration:none}
td.chs a:hover{color:var(--ink);text-decoration:underline}
th.th-sort{cursor:pointer;user-select:none}
th.th-sort::after{content:"↕";opacity:.35;margin-left:.35em;font-weight:400}
th.th-sort[aria-sort="ascending"]::after{content:"↑";opacity:.9}
th.th-sort[aria-sort="descending"]::after{content:"↓";opacity:.9}
.tfoot{display:flex;gap:8px;margin-top:10px;font-size:11.5px;color:var(--ink3)}
.tfoot a{color:inherit}
.tfoot a:hover{color:var(--accent)}
.empty{color:var(--ink3);padding:14px 0;font-size:12.5px}

/* ————— filter + inline forms ————— */
.filters{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:14px;font-size:12.5px}
.filters label{display:inline-flex;gap:5px;align-items:center;color:var(--ink2)}
.filters a{color:var(--ink3)}
form.inline{display:inline-flex;gap:6px;align-items:center}

/* ————— combobox (searchable entity picker; see combobox.tsx) ————— */
.cbx{position:relative;display:inline-flex;flex-direction:column;gap:6px;min-width:17rem}
.cbx.on select{display:none}
.cbx-input{font:12.5px var(--sans);color:var(--ink);background:var(--paper);
  border:1px solid var(--line2);border-radius:5px;padding:5px 8px}
.cbx-input::placeholder{color:var(--ink3)}
.cbx-list{position:absolute;top:100%;left:0;right:0;margin-top:4px;list-style:none;
  background:var(--paper);border:1px solid var(--line2);border-radius:5px;
  max-height:220px;overflow-y:auto;z-index:20;box-shadow:0 6px 20px rgba(0,0,0,.10)}
.cbx-list li{padding:6px 10px;font-size:12.5px;cursor:pointer;font-family:var(--mono)}
.cbx-list li:hover,.cbx-list li.act{background:var(--inset)}
.cbx-list li.none{color:var(--ink3);cursor:default;font-family:var(--sans)}
.cbx-chips{display:flex;flex-wrap:wrap;gap:6px;max-width:24rem}
.cbx-chip{font:500 11px var(--mono);border:1px solid var(--line2);border-radius:4px;
  background:var(--inset);color:var(--ink2);padding:2px 8px;cursor:pointer}
.cbx-chip:hover{color:var(--danger);border-color:color-mix(in srgb,var(--danger) 40%,var(--line2))}
.cbx.err .cbx-input{border-color:var(--danger);
  outline:2px solid color-mix(in srgb,var(--danger) 35%,transparent)}

/* ————— controls ————— */
input,select,textarea{font:12.5px var(--sans);color:var(--ink);background:var(--paper);
  border:1px solid var(--line2);border-radius:5px;padding:5px 8px}
input[type=file]{padding:4px}
input.mono,textarea.mono{font-family:var(--mono);font-size:12px}
textarea{width:100%;min-height:5rem;resize:vertical;line-height:1.5}
input::placeholder,textarea::placeholder{color:var(--ink3)}
button,.btn{font:500 12.5px var(--sans);padding:5px 11px;border-radius:5px;line-height:1.45;
  border:1px solid var(--line2);background:var(--paper);color:var(--ink);cursor:pointer;
  text-decoration:none;display:inline-block;white-space:nowrap}
button:hover,.btn:hover{background:var(--inset)}
.btn-primary{background:var(--accent);border-color:var(--accent);color:var(--accent-ink);font-weight:600}
.btn-primary:hover{background:var(--accent);filter:brightness(1.06)}
.btn-danger{background:var(--danger);border-color:var(--danger);color:#fff;font-weight:600}
.btn-danger:hover{background:var(--danger);filter:brightness(1.06)}
.actions{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:14px}

/* ————— labeled form fields ————— */
.field{display:flex;flex-direction:column;gap:4px;margin:0}
.field>span{font:600 11px var(--sans);letter-spacing:.02em;color:var(--ink2)}
.field>span i{font-style:normal;font-weight:400;color:var(--ink3)}
.field input,.field select{max-width:26rem}
.frow{display:flex;gap:14px;align-items:flex-end;flex-wrap:wrap;margin-top:14px}
fieldset{border:none;margin-top:22px}
fieldset legend{font:600 10.5px var(--sans);letter-spacing:.1em;text-transform:uppercase;
  color:var(--ink3);border-bottom:1px solid var(--line2);width:100%;padding-bottom:7px;margin-bottom:12px}
.fhint{font-size:12px;color:var(--ink3);margin-top:6px;max-width:64ch}

/* ————— facts (key-value) ————— */
.facts{margin-top:0}
.facts div{display:grid;grid-template-columns:150px 1fr;gap:14px;padding:9px 0;
  border-bottom:1px solid var(--line);font-size:12.5px;align-items:baseline}
.facts dt{color:var(--ink3)}
.facts dd{min-width:0;overflow-wrap:anywhere}
.facts code{font:12px var(--mono)}

/* ————— entity rows (channel/build membership lists) ————— */
.rows{list-style:none}
.rows li{display:flex;gap:12px;align-items:center;padding:9px 0;border-bottom:1px solid var(--line);
  font-size:12.5px}
.rows li form{margin-left:auto}
.rows li .t{margin-left:auto}
.rows li .t+form{margin-left:14px}

/* ————— danger zone ————— */
.dangerzone{margin-top:40px}
.dangerzone .slab{border-bottom-color:color-mix(in srgb,var(--danger) 35%,transparent)}
.dangerzone .slab h2{color:var(--danger)}
.dangerzone p{font-size:12.5px;color:var(--ink3);margin-top:10px;max-width:64ch}

/* ————— token / code blocks ————— */
.token{display:block;font:12px var(--mono);background:var(--inset);border:1px solid var(--line);
  border-radius:5px;padding:9px 11px;word-break:break-all;user-select:all;margin-top:8px}
code{font-family:var(--mono);font-size:.92em}
pre{background:#17181c;color:#e9eaee;padding:12px 14px;border-radius:8px;overflow-x:auto;
  font-size:11.5px;line-height:1.6;margin-top:10px}
pre code{font-size:inherit}

/* ————— serving map (signature) ————— */
.map{list-style:none}
.map li{display:grid;grid-template-columns:14px 84px minmax(36px,1fr) auto minmax(36px,1fr) auto;
  gap:0 14px;align-items:center;padding:16px 0;border-bottom:1px solid var(--line)}
.map .ch{font:500 13px var(--mono);color:var(--ink);text-decoration:none}
.map .ch:hover{text-decoration:underline}
.rail{height:1px;background:var(--line2);position:relative;min-width:36px}
.rail::after{content:"";position:absolute;right:0;top:-3px;
  border-left:6px solid var(--line2);border-top:3.5px solid transparent;border-bottom:3.5px solid transparent}
.rail.dash{background:repeating-linear-gradient(90deg,var(--line2) 0 5px,transparent 5px 10px)}
.rail.dash::after{opacity:.55}
.served{display:flex;align-items:center;gap:8px;min-width:272px}
.served .lk{font-size:13px;overflow:hidden;text-overflow:ellipsis}
.served .none{font-size:12.5px;color:var(--warn)}
.served .none i{font-style:normal;color:var(--ink3)}
.aud{text-align:right;text-decoration:none;font-size:12.5px;color:var(--ink);min-width:232px}
.aud b{font-weight:600}
.aud em{font-style:normal;color:var(--ink3);margin-left:6px;font-size:12px}
.aud em.w{color:var(--warn)}
a.aud:hover b{text-decoration:underline}
.map li.offrow{background:none}
.map li.offrow .ch{color:var(--warn);font-size:12px;white-space:nowrap}

/* ————— attention + recent (dashboard) ————— */
.cols{display:grid;grid-template-columns:1.55fr 1fr;gap:56px}
.attn{list-style:none}
.attn li{display:grid;grid-template-columns:14px 1fr auto;gap:0 12px;
  padding:12px 0;border-bottom:1px solid var(--line);align-items:start}
.attn .dot{margin-top:5.5px}
.attn b{font-weight:600;font-size:13px}
.attn b a{color:inherit;text-decoration:none}
.attn b a:hover{text-decoration:underline}
.attn p{color:var(--ink3);font-size:12.5px;margin-top:1px;max-width:54ch}
.attn p .lk{font-size:11.5px;color:var(--ink3)}
.attn p a{color:var(--ink2);text-decoration:underline;text-underline-offset:2px;
  text-decoration-color:var(--line2)}
.attn p a:hover{color:var(--ink)}
.fix{font-size:12.5px;font-weight:500;color:var(--accent);text-decoration:none;
  white-space:nowrap;margin-top:2px}
.fix:hover{text-decoration:underline}
.rec{list-style:none}
.rec li{display:grid;grid-template-columns:86px 1fr;gap:12px;padding:7px 0;
  font-size:12.5px;align-items:baseline;color:var(--ink2)}
.rec li a{color:var(--ink);text-decoration:none}
.rec li a:hover{text-decoration:underline}
.rec .lk{font-size:11.5px}
.allgood{display:flex;gap:10px;align-items:center;padding:14px 0;color:var(--ink3);font-size:12.5px}

/* ————— chain seal ————— */
.seal{display:flex;gap:8px;align-items:center;font-size:11.5px;color:var(--ink3)}
.seal .dot{width:7px;height:7px}
.seal.bad{color:var(--danger);font-weight:600}

/* ————— aliases + page-specific bits ————— */
.muted{color:var(--ink3)}
section p{margin-top:10px;font-size:12.5px}
.modes{display:flex;gap:1.25rem;margin:18px 0 0}
.modes label{display:inline-flex;align-items:center;gap:.4rem;font-weight:500}
.rollback-only{display:none}
form:has(#mode-rollback:checked) .rollback-only{display:block}

/* ————— small screens ————— */
@media (max-width: 48rem){
  body{flex-direction:column}
  aside{position:static;width:auto;height:auto;flex-direction:row;align-items:center;gap:16px;
    border-right:none;border-bottom:1px solid var(--line);overflow-x:auto}
  nav.primary{flex-direction:row;gap:14px}
  nav.primary h6{display:none}
  main{padding:20px 18px 40px}
  .cols{grid-template-columns:1fr}
  .map li{grid-template-columns:14px 76px minmax(20px,1fr) auto}
  .map li .rail:nth-of-type(2){display:none}
  .map li .aud{grid-column:2 / -1;text-align:left;margin-top:6px;min-width:0}
  .served{min-width:0}
}
`;

// Sets aria-current on the active nav link (progressive enhancement: the server renders no active
// state, so the nav is fully usable without JS; this only adds the highlight). Longest-prefix match,
// with /admin matched only exactly so the Overview link doesn't claim every sub-page.
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

// The gate glyph: two posts and the accent dot passing between them. Doubles as the favicon.
const FAVICON =
  "data:image/svg+xml,%3Csvg%20xmlns='http://www.w3.org/2000/svg'%20viewBox='0%200%2016%2016'%3E%3Cpath%20d='M4.5%202.5v11M11.5%202.5v11'%20stroke='%236e7076'%20stroke-width='1.8'%20stroke-linecap='round'/%3E%3Ccircle%20cx='8'%20cy='8'%20r='2.4'%20fill='%230e6e7e'/%3E%3C/svg%3E";

const NAV: readonly { label: string; items: readonly [string, string][] }[] = [
  {
    label: "Operate",
    items: [
      ["/admin", "Overview"],
      ["/admin/users", "Users"],
      ["/admin/builds", "Builds"],
      ["/admin/streams", "Channels"],
      ["/admin/pending", "Requests"],
    ],
  },
  {
    label: "Publish",
    items: [
      ["/admin/upload", "Upload"],
      ["/admin/ci", "CI publish"],
    ],
  },
  {
    label: "Logs",
    items: [
      ["/admin/activity", "Activity"],
      ["/admin/audit", "Audit"],
    ],
  },
  {
    label: "Configure",
    items: [
      ["/admin/setup", "Setup"],
      ["/admin/settings", "Settings"],
    ],
  },
];

/** Per-request chrome data every page threads through: flash notice, instance slug, requests chip. */
export interface Chrome {
  notice?: string | null | undefined;
  instance?: string | undefined;
  /** Pending access requests → the amber chip on the Requests nav item. */
  pending?: number | undefined;
  /** The operator's theme override (the `theme` cookie); undefined = follow the OS. */
  theme?: "light" | "dark" | undefined;
  /** The current path — where the theme toggle returns to after its POST. */
  path?: string | undefined;
}

// Applies the theme cookie before first paint, so pages rendered WITHOUT chrome (confirmations,
// invite results) still honor the override. The server-rendered data-theme covers the JS-off case
// on every page that threads chrome. Hand-written string — keep it free of outer references.
const THEME_SCRIPT = `(function(){var m=document.cookie.match(/(?:^|; )theme=(dark|light)(?:;|$)/);if(m)document.documentElement.setAttribute("data-theme",m[1]);})();`;

export const AdminLayout: FC<{
  title: string;
  chrome?: Chrome | undefined;
  /** Extra page-head content rendered beside the h1 (subtitle, inventory line). */
  head?: Child;
  /** Breadcrumb line rendered above the h1 (e.g. Users / alice@…). */
  crumb?: Child;
  children?: Child;
}> = ({ title, chrome, head, crumb, children }) => (
  <html lang="en" data-theme={chrome?.theme}>
    <head>
      <meta charset="utf-8" />
      <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      <meta name="viewport" content="width=device-width, initial-scale=1" />
      <title>{title} · Alpha Gate</title>
      <link rel="icon" href={FAVICON} />
      <style dangerouslySetInnerHTML={{ __html: styles }} />
    </head>
    <body>
      <a href="#main" class="skip">
        Skip to content
      </a>
      <aside>
        <a class="brand" href="/admin">
          <svg viewBox="0 0 16 16" aria-hidden="true">
            <path
              d="M4.5 2.5v11M11.5 2.5v11"
              stroke="currentColor"
              stroke-width="1.8"
              stroke-linecap="round"
            />
            <circle class="dotmark" cx="8" cy="8" r="2.4" />
          </svg>
          <div>
            <b>Alpha Gate</b>
            {chrome?.instance ? <span>{chrome.instance}</span> : null}
          </div>
        </a>
        <nav class="primary" aria-label="Primary">
          {NAV.map((group) => (
            <div>
              <h6>{group.label}</h6>
              {group.items.map(([href, label]) => (
                <a href={href}>
                  {label}
                  {label === "Requests" && (chrome?.pending ?? 0) > 0 ? (
                    <span class="chip">{chrome?.pending}</span>
                  ) : null}
                </a>
              ))}
            </div>
          ))}
        </nav>
        <form method="post" action="/admin/theme" class="theme" aria-label="Theme">
          <input type="hidden" name="return_to" value={chrome?.path ?? "/admin"} />
          {(["light", "system", "dark"] as const).map((value) => (
            <button
              type="submit"
              name="value"
              value={value}
              aria-pressed={(chrome?.theme ?? "system") === value ? "true" : "false"}
            >
              {value === "light" ? "Light" : value === "dark" ? "Dark" : "System"}
            </button>
          ))}
        </form>
      </aside>
      <main id="main">
        {crumb ? <p class="crumb">{crumb}</p> : null}
        <header class="pagehead">
          <h1>{title}</h1>
          {head}
        </header>
        {chrome?.notice ? (
          <p class="notice" role="status">
            {chrome.notice}
          </p>
        ) : null}
        {children}
      </main>
      <script dangerouslySetInnerHTML={{ __html: activeNavScript }} />
      <script dangerouslySetInnerHTML={{ __html: TABLE_ENHANCE_SCRIPT }} />
      <script dangerouslySetInnerHTML={{ __html: COMBOBOX_SCRIPT }} />
    </body>
  </html>
);
