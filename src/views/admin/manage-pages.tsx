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
}> = ({ email, getUrl, delivery }) => (
  <AdminLayout title="Invite created">
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
      <code class="token">{getUrl}</code>
    </p>
    <p>
      <a href="/admin/users">Back to users</a>
    </p>
  </AdminLayout>
);

export const ConfirmPage: FC<{
  action: string;
  affected: string[];
  postTo: string;
  hidden: Record<string, string>;
}> = ({ action, affected, postTo, hidden }) => (
  <AdminLayout title="Confirm">
    <p>
      <strong>{action}</strong> would leave these users with no available build:
    </p>
    <ul>
      {affected.map((email) => (
        <li>{email}</li>
      ))}
    </ul>
    <form method="post" action={postTo}>
      {Object.entries(hidden).map(([name, value]) => (
        <input type="hidden" name={name} value={value} />
      ))}
      <button type="submit">Confirm anyway</button>
    </form>
    <p>
      <a href="/admin/users">Cancel</a>
    </p>
  </AdminLayout>
);

/** The §11 confirm for a bulk operation (§13 #3): re-posts the op and every selected id on confirm. */
export const BulkConfirmPage: FC<{
  op: string;
  ids: number[];
  affected: string[];
  postTo: string;
}> = ({ op, ids, affected, postTo }) => (
  <AdminLayout title="Confirm">
    <p>
      Bulk <strong>{op}</strong> of {ids.length} build(s) would leave these users with no available
      build:
    </p>
    <ul>
      {affected.map((email) => (
        <li>{email}</li>
      ))}
    </ul>
    <form method="post" action={postTo}>
      <input type="hidden" name="op" value={op} />
      <input type="hidden" name="confirm" value="true" />
      {ids.map((id) => (
        <input type="hidden" name="id" value={String(id)} />
      ))}
      <button type="submit">Confirm anyway</button>
    </form>
    <p>
      <a href="/admin/builds">Cancel</a>
    </p>
  </AdminLayout>
);
