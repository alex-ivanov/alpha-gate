import type { FC } from "hono/jsx";

// A searchable entity picker (users, builds) that keeps the form contract of a plain <select>.
// Without JavaScript the native select IS the control (single or multiple) and the form posts
// exactly what a select posts. With JavaScript, COMBOBOX_SCRIPT (injected once by AdminLayout)
// hides the select and drives it from a type-to-filter combobox: the select stays in the DOM as
// the value carrier, so the server never sees a difference. Multi-select renders removable chips
// and posts the name once per selection (handlers read repeated fields via idList).

export interface ComboOption {
  value: string;
  label: string;
}

export const Combobox: FC<{
  /** The form field name the (hidden) select posts — e.g. buildId, clientId. */
  name: string;
  options: ComboOption[];
  /** Accessible name for the picker; rendered sr-only. */
  label: string;
  /** Combobox placeholder, e.g. "Type a build number…". */
  placeholder: string;
  /** Allow several selections (chips). The no-JS fallback is a native multi-select. */
  multiple?: boolean;
  /**
   * Required pickers get no empty option (the no-JS select then defaults to its first option,
   * matching the old behavior); the enhancer refuses to submit with nothing picked instead.
   */
  required?: boolean;
}> = ({ name, options, label, placeholder, multiple, required }) => (
  <span
    class="cbx"
    data-combobox
    data-placeholder={placeholder}
    data-required={required ? "1" : undefined}
  >
    <label>
      <span class="sr-only">{label}</span>
      <select
        name={name}
        multiple={multiple}
        size={multiple ? Math.min(options.length, 4) : undefined}
      >
        {required || multiple ? null : <option value="">— none —</option>}
        {options.map((o) => (
          <option value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  </span>
);

// The enhancer. Self-contained by design (a hand-written string — nothing serialized, no module
// references; see the PRINCIPLES client-side-scripts gotcha). Injected once per page by AdminLayout;
// no-ops when the page has no [data-combobox].
export const COMBOBOX_SCRIPT = `
(function () {
  var uid = 0;
  document.querySelectorAll("[data-combobox]").forEach(function (box) {
    var select = box.querySelector("select");
    if (!select) return;
    var multiple = select.multiple;
    var required = box.getAttribute("data-required") === "1";
    var options = Array.prototype.slice.call(select.options).filter(function (o) { return o.value !== ""; });
    var listId = "cbx-" + (++uid);

    // A required single select natively preselects its first option; the combobox starts EMPTY and
    // refuses to submit until a real pick, so nothing is chosen by accident.
    if (!multiple) select.selectedIndex = required ? -1 : 0;

    var input = document.createElement("input");
    input.type = "text";
    input.className = "cbx-input";
    input.setAttribute("role", "combobox");
    input.setAttribute("aria-expanded", "false");
    input.setAttribute("aria-controls", listId);
    input.setAttribute("aria-autocomplete", "list");
    input.setAttribute("autocomplete", "off");
    input.placeholder = box.getAttribute("data-placeholder") || "Type to search…";

    var list = document.createElement("ul");
    list.className = "cbx-list";
    list.id = listId;
    list.setAttribute("role", "listbox");
    list.hidden = true;

    var chips = null;
    if (multiple) {
      chips = document.createElement("span");
      chips.className = "cbx-chips";
      box.appendChild(chips);
    }
    box.appendChild(input);
    box.appendChild(list);
    box.classList.add("on");

    var shown = [];
    var active = -1;

    function renderChips() {
      if (!chips) return;
      chips.textContent = "";
      options.forEach(function (o) {
        if (!o.selected) return;
        var b = document.createElement("button");
        b.type = "button";
        b.className = "cbx-chip";
        b.textContent = o.textContent.trim() + " ✕";
        b.setAttribute("aria-label", "Remove " + o.textContent.trim());
        b.addEventListener("click", function () { o.selected = false; renderChips(); });
        chips.appendChild(b);
      });
    }

    function close() {
      list.hidden = true;
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
      active = -1;
    }

    function pick(option) {
      if (multiple) {
        option.selected = true;
        input.value = "";
        renderChips();
        render("");
        input.focus();
      } else {
        select.value = option.value;
        input.value = option.textContent.trim();
        close();
      }
    }

    function render(query) {
      var q = query.trim().toLowerCase();
      shown = options.filter(function (o) {
        if (multiple && o.selected) return false;
        return o.textContent.toLowerCase().indexOf(q) !== -1;
      });
      list.textContent = "";
      shown.forEach(function (o, i) {
        var li = document.createElement("li");
        li.id = listId + "-" + i;
        li.setAttribute("role", "option");
        li.textContent = o.textContent.trim();
        if (i === active) { li.setAttribute("aria-selected", "true"); li.className = "act"; }
        li.addEventListener("mousedown", function (e) { e.preventDefault(); pick(o); });
        list.appendChild(li);
      });
      if (shown.length === 0) {
        var none = document.createElement("li");
        none.className = "none";
        none.textContent = "No matches";
        list.appendChild(none);
      }
      list.hidden = false;
      input.setAttribute("aria-expanded", "true");
      if (active >= 0 && shown[active]) input.setAttribute("aria-activedescendant", listId + "-" + active);
      else input.removeAttribute("aria-activedescendant");
    }

    input.addEventListener("input", function () {
      active = -1;
      if (!multiple) select.selectedIndex = -1; // typed text invalidates the previous pick
      render(input.value);
    });
    input.addEventListener("focus", function () { render(input.value); });
    input.addEventListener("blur", function () { close(); });
    input.addEventListener("keydown", function (e) {
      if (e.key === "ArrowDown") { e.preventDefault(); if (list.hidden) render(input.value); active = Math.min(active + 1, shown.length - 1); render(input.value); }
      else if (e.key === "ArrowUp") { e.preventDefault(); active = Math.max(active - 1, 0); render(input.value); }
      else if (e.key === "Enter") {
        if (!list.hidden && shown.length > 0) { e.preventDefault(); pick(shown[active >= 0 ? active : 0]); }
      }
      else if (e.key === "Escape") { close(); }
    });

    // A required picker refuses to submit with nothing chosen (the server would 400 anyway;
    // this keeps the operator in place with focus on the field).
    var form = box.closest("form");
    if (form && required) {
      form.addEventListener("submit", function (e) {
        var any = options.some(function (o) { return o.selected; });
        if (!any) { e.preventDefault(); input.focus(); box.classList.add("err"); setTimeout(function () { box.classList.remove("err"); }, 900); }
      });
    }
  });
})();
`;
