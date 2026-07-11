import type { Child, FC } from "hono/jsx";

// A small inline POST form: optional hidden fields, optional children (inputs/selects), a submit
// button. The shared building block for the back-office action buttons.
export const Post: FC<{
  action: string;
  label: string;
  hidden?: Record<string, string | number>;
  children?: Child;
}> = ({ action, label, hidden = {}, children }) => (
  <form method="post" action={action} class="inline">
    {Object.entries(hidden).map(([name, value]) => (
      <input type="hidden" name={name} value={String(value)} />
    ))}
    {children}
    <button type="submit">{label}</button>
  </form>
);

// Progressive enhancement for [data-copy] buttons: the target's text is selectable without JS; this
// only adds one-click copy with a brief "Copied" confirmation.
export const COPY_SCRIPT = `
(function () {
  document.querySelectorAll("[data-copy]").forEach(function (btn) {
    btn.addEventListener("click", function () {
      var el = document.querySelector(btn.getAttribute("data-copy"));
      var text = el ? el.textContent : "";
      if (!navigator.clipboard || !text) return;
      navigator.clipboard.writeText(text).then(function () {
        var prev = btn.textContent;
        btn.textContent = "Copied";
        setTimeout(function () { btn.textContent = prev; }, 1500);
      });
    });
  });
})();
`;
