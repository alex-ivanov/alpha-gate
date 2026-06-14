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
