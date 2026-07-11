import type { AdminContext } from "./admin-context";
import { returnTo } from "./form";

// Post-action feedback with no JavaScript and no session state: a mutation 303s back to the page the
// operator acted from with `?done=<slug>&s=<subject>`, and the GET view resolves the slug here into a
// sentence rendered as a notice. Slugs are a fixed registry — the query string is user-visible input,
// and free-text messages in it would let a crafted link put arbitrary words in the admin's mouth.

const MESSAGES: Record<string, (subject: string | null) => string> = {
  "user.revoked": (s) => `Revoked ${s ?? "the user"} — their app now sees the reactivation notice.`,
  "user.reactivated": (s) => `Reactivated ${s ?? "the user"} — their existing link works again.`,
  "user.hidden": (s) => `Hid ${s ?? "the user"} from this list. Access is unchanged.`,
  "user.unhidden": (s) => `${s ?? "The user"} is visible in this list again.`,
  "user.assigned": (s) => `Assigned ${s ?? "the user"} to the channel.`,
  "user.unassigned": (s) => `Removed ${s ?? "the user"} from the channel.`,
  "user.pinned": (s) =>
    `Pinned ${s ?? "the user"} — channels are ignored while the pin is in place.`,
  "user.unpinned": (s) => `Unpinned ${s ?? "the user"} — channel resolution applies again.`,
  "build.withdrawn": (s) => `Withdrew ${s ?? "the build"} — it is no longer offered to anyone.`,
  "build.restored": (s) => `Restored ${s ?? "the build"} — it can be offered again.`,
  "build.critical": (s) => `Marked ${s ?? "the build"} critical — updates to it are mandatory.`,
  "build.uncritical": (s) => `Cleared the critical mark on ${s ?? "the build"}.`,
  "build.rollback": (s) => `${s ?? "The build"} is now the designated rollback target.`,
  "build.unrollback": (s) => `${s ?? "The build"} is no longer the rollback target.`,
  "build.hidden": (s) => `Hid ${s ?? "the build"} from this list. Serving is unchanged.`,
  "build.unhidden": (s) => `${s ?? "The build"} is visible in this list again.`,
  "build.linked": (s) => `Linked ${s ?? "the build"} to the channel.`,
  "build.unlinked": (s) => `Unlinked ${s ?? "the build"} from the channel.`,
  "channel.created": (s) => `Created the ${s ?? "new"} channel.`,
  "channel.deleted": (s) => `Deleted the ${s ?? ""} channel and its assignments.`,
  "request.dismissed": (s) => `Dismissed the request from ${s ?? "the requester"}.`,
  "bulk.withdrawn": (s) => `Withdrew ${s ?? "the selected builds"}.`,
  "bulk.critical": (s) => `Marked ${s ?? "the selected builds"} critical.`,
  "bulk.uncritical": (s) => `Cleared the critical mark on ${s ?? "the selected builds"}.`,
  "bulk.none": () => "Nothing was selected — tick some builds first.",
  "settings.saved": () => "Settings saved.",
  noop: (s) => s ?? "Nothing to change.",
};

/** The notice for the current GET, or null when the page wasn't reached via a done-redirect. */
export function flashMessage(c: AdminContext): string | null {
  const slug = c.req.query("done");
  if (!slug) return null;
  const render = MESSAGES[slug];
  return render ? render(c.req.query("s") ?? null) : "Done.";
}

/**
 * The mutation-success redirect: back to the validated `return_to` (the page the operator acted
 * from) or the section fallback, carrying the flash slug + subject for the target view to render.
 */
export function doneRedirect(
  c: AdminContext,
  body: Record<string, unknown>,
  fallback: string,
  slug: string,
  subject?: string,
): Response {
  const target = returnTo(body) ?? fallback;
  const url = new URL(target, "http://internal");
  url.searchParams.set("done", slug);
  if (subject !== undefined) url.searchParams.set("s", subject);
  return c.redirect(url.pathname + url.search, 303);
}

/** The canonical human name for a build in copy: its number plus the human version string. */
export function buildSubject(build: { buildNumber: number; shortVersion: string }): string {
  return `build ${build.buildNumber} (${build.shortVersion})`;
}
