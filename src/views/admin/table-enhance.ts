// Progressive-enhancement for the admin list tables: click-to-sort columns and instant client-side
// filtering, with NO framework. The server always renders the complete table, so without JavaScript the
// page is a fully readable static table (graceful degradation) — the script below only reorders/hides
// rows already present. Tables opt in declaratively:
//
//   <table data-enhance>
//     <thead><tr>
//       <th data-key="email"  data-sort="text">Email</th>   ← sortable; data-sort = "text" | "num"
//       <th data-key="build"  data-sort="num">Build</th>
//       <th>Actions</th>                                    ← no data-sort → not sortable
//     </tr></thead>
//     <tbody>
//       <tr><td>a@x</td><td>1500</td><td>…</td></tr>
//     </tbody>
//   </table>
//
// A cell's sort/filter value is `data-value` when present, else its trimmed text — so badges and "—"
// placeholders can carry a canonical value (e.g. <td data-value="yes">). Filter controls live anywhere
// on the page and target a column by its header key:
//
//   <select data-filter-col="status">…</select>                 exact match (default)
//   <input  data-filter-col="email"  data-filter-match="contains">
//   <input type="checkbox" data-filter-col="nobuild" data-filter-value="nobuild">
//
// compareCells / cellPasses are PURE and unit-tested (no DOM); the script serialises them via toString()
// so the exact tested logic ships to the browser. Keep them self-contained (no external references).

/**
 * Comparator for one column's two cell values, direction included. Blank/"—" cells always sort LAST in
 * both directions (so empty rows never crowd the top of a descending sort). "num" compares numerically;
 * "text" is a case-insensitive, numeric-aware locale compare. Returns the usual negative/zero/positive.
 */
export function compareCells(
  a: string,
  b: string,
  type: "text" | "num",
  dir: "asc" | "desc",
): number {
  // No inner named functions here: those get wrapped in esbuild's `__name` keep-names helper, which is
  // absent in the browser and would throw when this is serialised via toString() (see TABLE_ENHANCE_SCRIPT).
  const ta = a.trim();
  const tb = b.trim();
  const ea = ta === "" || ta === "—";
  const eb = tb === "" || tb === "—";
  if (ea && eb) return 0;
  if (ea) return 1;
  if (eb) return -1;
  let base: number;
  if (type === "num") {
    const na = Number.parseFloat(a);
    const nb = Number.parseFloat(b);
    base = (Number.isNaN(na) ? 0 : na) - (Number.isNaN(nb) ? 0 : nb);
  } else {
    base = a.localeCompare(b, undefined, { numeric: true, sensitivity: "base" });
  }
  return dir === "asc" ? base : -base;
}

/**
 * Whether a cell value passes one filter control. An empty filter value is "no constraint" (passes).
 * "contains" is a case-insensitive substring; "exact" a case-insensitive equality. Both trim first.
 */
export function cellPasses(
  cellValue: string,
  filterValue: string,
  match: "exact" | "contains",
): boolean {
  if (filterValue === "") return true;
  const c = cellValue.trim().toLowerCase();
  const v = filterValue.trim().toLowerCase();
  return match === "contains" ? c.includes(v) : c === v;
}

// The browser glue. Reads the declarative markup, wires sort + filter, and calls the pure functions
// above (injected verbatim). No-ops cleanly on pages with no [data-enhance] table.
const GLUE = `
(function () {
  function val(tr, i) {
    var td = tr.cells[i];
    if (!td) return "";
    return td.getAttribute("data-value") != null ? td.getAttribute("data-value") : td.textContent.trim();
  }
  document.querySelectorAll("table[data-enhance]").forEach(function (table) {
    var head = table.tHead && table.tHead.rows[0];
    var body = table.tBodies[0];
    if (!head || !body) return;
    var heads = Array.prototype.slice.call(head.cells);
    var keyIndex = {};
    heads.forEach(function (th, i) { var k = th.getAttribute("data-key"); if (k) keyIndex[k] = i; });
    function rows() { return Array.prototype.slice.call(body.rows); }

    heads.forEach(function (th, i) {
      var type = th.getAttribute("data-sort");
      if (type == null) return;
      th.classList.add("th-sort");
      // No role override: a <th> is an implicit columnheader, which is what makes aria-sort meaningful
      // and keeps the cells associated with it. tabindex + keydown make it keyboard-operable.
      th.setAttribute("tabindex", "0");
      function sort() {
        var dir = th.getAttribute("aria-sort") === "ascending" ? "desc" : "asc";
        heads.forEach(function (h) { h.removeAttribute("aria-sort"); });
        th.setAttribute("aria-sort", dir === "asc" ? "ascending" : "descending");
        rows()
          .sort(function (a, b) { return compareCells(val(a, i), val(b, i), type || "text", dir); })
          .forEach(function (tr) { body.appendChild(tr); });
      }
      th.addEventListener("click", sort);
      th.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); sort(); }
      });
    });

    var controls = Array.prototype.slice
      .call(document.querySelectorAll("[data-filter-col]"))
      .filter(function (c) { return keyIndex[c.getAttribute("data-filter-col")] != null; });
    if (!controls.length) return;
    // Scope the status/empty nodes to THIS table's container, not document-wide, so two enhanced tables
    // with filters on one page don't write each other's count.
    var scope = table.parentElement || document;
    var status = scope.querySelector("[data-table-status]");
    var empty = scope.querySelector("[data-table-empty]");
    function apply() {
      var specs = controls.map(function (c) {
        var v = c.type === "checkbox" ? (c.checked ? (c.getAttribute("data-filter-value") || "on") : "") : c.value;
        return { i: keyIndex[c.getAttribute("data-filter-col")], value: v, match: c.getAttribute("data-filter-match") || "exact" };
      });
      var all = rows(), shown = 0;
      all.forEach(function (tr) {
        var ok = specs.every(function (s) { return cellPasses(val(tr, s.i), s.value, s.match); });
        tr.hidden = !ok;
        if (ok) shown++;
      });
      if (status) status.textContent = shown === all.length ? "" : "Showing " + shown + " of " + all.length;
      if (empty) empty.hidden = shown !== 0;
    }
    controls.forEach(function (c) { c.addEventListener("input", apply); c.addEventListener("change", apply); });
    apply();
  });

  // Bulk-selection enhancement: a [data-check-all] header checkbox toggles every row checkbox in the
  // same table (respecting filtered-out rows), and [data-selected-count] mirrors the live count.
  // Without JS the header checkbox does nothing and the count stays blank — the bulk form still works.
  document.querySelectorAll("[data-check-all]").forEach(function (all) {
    var table = all.closest("table");
    if (!table) return;
    function boxes() {
      return Array.prototype.slice
        .call(table.querySelectorAll('tbody input[type="checkbox"]'))
        .filter(function (b) { var tr = b.closest("tr"); return !(tr && tr.hidden); });
    }
    function counts() {
      var n = boxes().filter(function (b) { return b.checked; }).length;
      document.querySelectorAll("[data-selected-count]").forEach(function (el) {
        el.textContent = n > 0 ? " " + n + " " + (n === 1 ? "build" : "builds") : " builds";
      });
    }
    all.addEventListener("change", function () {
      boxes().forEach(function (b) { b.checked = all.checked; });
      counts();
    });
    table.addEventListener("change", function (e) {
      if (e.target !== all) counts();
    });
    counts();
  });
})();
`;

// The full inline script: the pure functions (tested) plus the DOM glue. Injected once by AdminLayout.
// `__name` is an identity shim for esbuild's keep-names helper: when the bundler wraps a named function
// with __name(fn, "name"), the serialised source below would reference a helper the browser doesn't have.
// Shimming it to return its first argument makes the toString()-injected functions self-contained.
export const TABLE_ENHANCE_SCRIPT = `var __name = function (t) { return t; };
var compareCells = ${compareCells.toString()};
var cellPasses = ${cellPasses.toString()};
${GLUE}`;
