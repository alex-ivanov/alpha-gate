import { deleteCookie, setCookie } from "hono/cookie";
import type { AdminContext } from "./admin-context";
import { field, returnTo } from "./form";
import { requireUser } from "./middleware";

// The theme toggle (sidebar foot): light / system / dark. A plain form POST that works with JS
// disabled — the choice lives in a `theme` cookie the GET pages read (and a pre-paint script
// applies on chrome-less pages). "system" clears the cookie: following the OS is the default,
// not a stored value. A UI preference, not a domain mutation — deliberately NOT audited.

const YEAR_SECONDS = 60 * 60 * 24 * 365;

export async function setTheme(c: AdminContext): Promise<Response> {
  if (requireUser(c) === null) return c.text("Forbidden", 403);
  const body = await c.req.parseBody();
  const value = field(body, "value");
  if (value !== "light" && value !== "dark" && value !== "system") {
    return c.text("Bad request", 400);
  }

  const secure = new URL(c.req.url).protocol === "https:";
  if (value === "system") {
    deleteCookie(c, "theme", { path: "/" });
  } else {
    // Not HttpOnly on purpose: the pre-paint script reads it. It holds nothing sensitive.
    setCookie(c, "theme", value, {
      path: "/",
      sameSite: "Lax",
      maxAge: YEAR_SECONDS,
      secure,
    });
  }
  return c.redirect(returnTo(body) ?? "/admin", 303);
}
