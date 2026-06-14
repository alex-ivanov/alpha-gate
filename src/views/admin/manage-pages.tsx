import type { FC } from "hono/jsx";
import { AdminLayout } from "./layout";

// Result/confirmation pages for admin mutations. InvitePage surfaces the copy-paste link (§13 add
// user); ConfirmPage is the §11 "this would strand these users — proceed?" gate.

export const InvitePage: FC<{ email: string; getUrl: string }> = ({ email, getUrl }) => (
  <AdminLayout title="Invite created">
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
