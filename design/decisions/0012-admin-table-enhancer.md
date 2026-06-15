# 0012 — Admin list tables: client-side sort + filter via a progressive-enhancement enhancer

**Status:** accepted · **Date:** 2026-06-14

## Context
The §13 back-office list tables (Users, Builds, Channels, Requests, Activity, Audit) had no column
sorting, and filtering existed only as server-side GET forms on Users/Activity/Audit (a page reload per
change). We wanted sorting on every table and richer per-table filtering, with a snappy feel.

The operator chose **client-side** interaction (instant, no reload) over the server-side or hybrid
options, accepting the trade-offs: the logic isn't exercised by the offline worker test suite, a no-JS
client gets a static table, and client-side filtering only sees the rows already on the page.

## Decision
A single reusable, framework-free enhancer (`src/views/admin/table-enhance.ts`), injected once by
`AdminLayout`, drives **click-to-sort on all six tables** and **instant filtering where every row is on
the page**. It is progressive enhancement: the server always renders the complete table, so with no JS
the page is a fully usable static table; the script only reorders/hides rows already present.

Tables opt in with a declarative `data-*` contract, so each table keeps its bespoke per-row rendering:
- `<table data-enhance>`; `<th data-sort="text|num">` makes a header click-to-sort; a plain `<th>`
  (Actions, selection) stays inert.
- A cell's sort/filter value is `data-value` when present, else its trimmed text — so badges and `—`
  placeholders can carry a canonical value (`<td data-value="yes">`).
- Filter controls carry `data-filter-col="<header data-key>"` and `data-filter-match="exact|contains"`.

Sort rules: blank/`—` cells always sort last (both directions); numbers numerically; ISO/`datetime`
timestamps chronologically as text (they're lexicographically ordered).

**Filtering split by data completeness, not by table:**
- **Builds** (all rows present) gets new instant client-side filters: status, critical, channel.
- **Users/Activity/Audit** keep their existing **server-side** filters. Activity/Audit load only the
  latest 100 rows, so client-side filtering would silently hide matches beyond the page — server-side is
  the correct, authoritative filter there. Sorting is layered on top of all of them.

**Testability (despite the client-JS choice, §23).** The two pieces of logic — `compareCells` and
`cellPasses` — are **pure functions, unit-tested with no DOM**, and the script serialises them into the
page via `Function.prototype.toString()` so the browser runs the exact tested code. Integration tests
assert the rendered markup contract; the DOM glue was verified end-to-end in a headless-browser harness.

**esbuild `__name` gotcha (the bug that cost the most here).** With keep-names on, esbuild wraps *named
inner functions* in a `__name(fn, "name")` helper that exists in the Node/worker bundle but **not** in
the browser — so a `toString()`-serialised function throws `ReferenceError: __name` the moment it runs,
which manifested as "sorting silently does nothing" (the click handler set `aria-sort` then threw before
reordering). Fix: keep the pure functions free of inner named functions **and** prepend a `var __name =
(t) => t;` identity shim to the injected script. A unit test guards the helper-leak class (`__name`
defined; `__pow`/`__spreadValues`/`__async`/… never appear).

## Consequences
- New UX: instant column sort everywhere; instant Builds filters; Users/Activity/Audit filters unchanged.
- Client-side sort/filter operate only on rows present on the page. For the capped tables that's why
  filtering stays server-side; if Users grows past comfort it can adopt a server-side cap + filter too.
- The enhancer is generic: a new list table opts in by adding `data-enhance` + `data-sort`/`data-key`,
  no per-table JS. Keep pure helpers inner-function-free so the `toString()` injection stays browser-safe.
- Not covered by the worker suite at runtime (workerd blocks `new Function`/`eval`); covered instead by
  pure-logic unit tests + markup-contract integration tests + manual headless-browser verification.
