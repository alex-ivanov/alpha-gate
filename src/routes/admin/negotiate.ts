import type { AdminContext } from "./admin-context";

// Content negotiation for the dual-audience admin POSTs. Build upload/register accept BOTH a human
// admin and a CI service token (decision 0006), so a single response shape can't serve both: a browser
// form submit should land on a real page, while a CI client must keep getting machine JSON.
//
// Rule: HTML only for a human actor whose request accepts text/html. So a service token (CI) always
// gets JSON, and a human hitting the API with `Accept: application/json` still gets JSON — only an
// actual browser form post (user JWT + `Accept: text/html`) is rendered as a page.
export function wantsHtml(c: AdminContext): boolean {
  if (c.get("actor").kind !== "user") return false;
  return (c.req.header("accept") ?? "").includes("text/html");
}
