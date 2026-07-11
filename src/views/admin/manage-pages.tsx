import type { Child, FC } from "hono/jsx";
import { AdminLayout } from "./layout";

// Result/confirmation pages for admin mutations. InvitePage surfaces the copy-paste link (§13 add
// user); ConfirmPage is the §11 "this would strand these users — proceed?" gate; ResultPage is the
// generic success/error landing for a browser form post (the HTML half of content negotiation).

/** Generic outcome page for a browser form submit: a status pill, a message, and a way back. */
export const ResultPage: FC<{
  title: string;
  intent?: "success" | "error";
  back?: { href: string; label: string };
  children?: Child;
}> = ({ title, intent = "success", back, children }) => (
  <AdminLayout title={title}>
    <span class={`badge ${intent === "error" ? "warn" : "ok"}`}>
      {intent === "error" ? "Error" : "Done"}
    </span>
    {children}
    {back ? (
      <p>
        <a href={back.href}>{back.label}</a>
      </p>
    ) : null}
  </AdminLayout>
);

export const InvitePage: FC<{
  email: string;
  getUrl: string;
  delivery?: { sent: boolean; error?: string } | undefined;
  /** True when this invite also reactivated a previously revoked user. */
  restored?: boolean;
}> = ({ email, getUrl, delivery, restored }) => (
  <AdminLayout title="Invite created">
    {restored ? (
      <p class="callout callout-ok">
        {email} was revoked — their access is now restored with the fresh link below (the old link
        stays dead).
      </p>
    ) : null}
    {delivery?.sent ? (
      <p class="badge ok">Emailed to {email}.</p>
    ) : delivery && !delivery.sent ? (
      <p class="callout callout-warn">
        The user was created, but the invite email to <strong>{email}</strong> didn't send:{" "}
        {delivery.error || "delivery failed"}. Send the link below manually, or fix email under{" "}
        <a href="/admin/settings">Settings</a>.
      </p>
    ) : null}
    <p>
      Send this private link to <strong>{email}</strong>:
    </p>
    <p>
      <code class="token" id="invite-link">
        {getUrl}
      </code>
    </p>
    <p class="actions">
      <button type="button" class="btn btn-primary" data-copy="#invite-link">
        Copy link
      </button>
      <a class="btn" href="/admin/users">
        Back to users
      </a>
    </p>
    {/* Progressive enhancement: the link is selectable without JS; this just adds one-click copy. */}
    <script dangerouslySetInnerHTML={{ __html: COPY_SCRIPT }} />
  </AdminLayout>
);

const COPY_SCRIPT = `
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

/**
 * The §11 stranding confirm: names the exact action in operator language, lists who would be left
 * with no available build (their apps report "up to date" and receive nothing), and returns to the
 * page the operator came from on Cancel. `hidden` must carry everything the re-post needs.
 */
export const ConfirmPage: FC<{
  /** The action in operator words, e.g. "Withdraw build 1400 (1.3.1-beta)". */
  subject: string;
  affected: string[];
  postTo: string;
  hidden: Record<string, string>;
  cancelTo: string;
}> = ({ subject, affected, postTo, hidden, cancelTo }) => (
  <AdminLayout title="Are you sure?">
    <p>
      <strong>{subject}</strong> would leave {affected.length === 1 ? "this user" : "these users"}{" "}
      with no available build:
    </p>
    <ul>
      {affected.map((email) => (
        <li>{email}</li>
      ))}
    </ul>
    <p class="muted">
      Their apps will report “up to date” and receive nothing until a higher build reaches them
      (publish a newer build, reassign their channel, or adjust the pin).
    </p>
    <form method="post" action={postTo} class="actions">
      {Object.entries(hidden).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
      <button type="submit" class="btn-danger">
        {subject} anyway
      </button>
      <a class="btn" href={cancelTo}>
        Cancel
      </a>
    </form>
  </AdminLayout>
);

/** The §11 confirm for a bulk operation (§13 #3): re-posts the op and every selected id on confirm. */
export const BulkConfirmPage: FC<{
  op: string;
  ids: number[];
  affected: string[];
  postTo: string;
}> = ({ op, ids, affected, postTo }) => (
  <AdminLayout title="Are you sure?">
    <p>
      <strong>
        {op === "withdraw" ? "Withdraw" : op} {ids.length} {ids.length === 1 ? "build" : "builds"}
      </strong>{" "}
      would leave these users with no available build:
    </p>
    <ul>
      {affected.map((email) => (
        <li>{email}</li>
      ))}
    </ul>
    <p class="muted">
      Their apps will report “up to date” and receive nothing until a higher build reaches them.
    </p>
    <form method="post" action={postTo} class="actions">
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="confirm" value="true" />
      {ids.map((id) => (
        <input type="hidden" name="id" value={String(id)} />
      ))}
      <button type="submit" class="btn-danger">
        Confirm anyway
      </button>
      <a class="btn" href="/admin/builds">
        Cancel
      </a>
    </form>
  </AdminLayout>
);

/**
 * Confirmation for a destructive-but-not-stranding action (revoke, reissue, delete channel). States
 * the action and its consequence in operator words; Cancel returns whence the operator came. The §11
 * stranding list, when there is one, rides along via `affected`.
 */
export const ConfirmActionPage: FC<{
  /** The action in operator words, e.g. "Revoke alice@corner.studio". */
  subject: string;
  confirmLabel: string;
  postTo: string;
  hidden: Record<string, string>;
  cancelTo: string;
  affected?: string[];
  children?: Child;
}> = ({ subject, confirmLabel, postTo, hidden, cancelTo, affected = [], children }) => (
  <AdminLayout title="Are you sure?">
    <p>
      <strong>{subject}</strong>
    </p>
    {children}
    {affected.length > 0 ? (
      <>
        <p>
          This would also leave {affected.length === 1 ? "this user" : "these users"} with no
          available build:
        </p>
        <ul>
          {affected.map((email) => (
            <li>{email}</li>
          ))}
        </ul>
      </>
    ) : null}
    <form method="post" action={postTo} class="actions">
      {Object.entries(hidden).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
      <button type="submit" class="btn-danger">
        {confirmLabel}
      </button>
      <a class="btn" href={cancelTo}>
        Cancel
      </a>
    </form>
  </AdminLayout>
);
