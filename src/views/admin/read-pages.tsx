import type { FC } from "hono/jsx";
import type { AuditRow } from "../../core/audit-chain";
import type { Stream } from "../../core/types";
import type { AccessLogEntry } from "../../db/access-log";
import type { AccessRequest } from "../../db/access-requests";
import type { BuildView, Dashboard, StreamView, UserView } from "../../routes/admin/read-model";
import { Post } from "./forms";
import { AdminLayout, NoBuildBadge } from "./layout";

// The §13 back-office list pages — tables over the read-model, now with the Add forms and per-row
// action buttons that POST to the (tested) mutation handlers. Per-entity detail pages live in manage.tsx.

export const DashboardPage: FC<{ data: Dashboard }> = ({ data }) => (
  <AdminLayout title="Dashboard">
    {data.selfUpdate.available ? (
      <p class="badge warn">
        Alpha Gate {data.selfUpdate.latest} is available — re-run deploy.sh to update.
      </p>
    ) : null}
    <div class="cards">
      <div class="card">
        <div class="n">{data.users}</div>
        <div class="l">users</div>
      </div>
      <div class="card">
        <div class="n">{data.builds}</div>
        <div class="l">builds</div>
      </div>
      <div class="card">
        <div class="n">{data.streams}</div>
        <div class="l">channels</div>
      </div>
      <div class="card">
        <div class="n">{data.noBuild}</div>
        <div class="l">no available build</div>
      </div>
      <div class="card">
        <div class="n">{data.pendingRequests}</div>
        <div class="l">
          <a href="/admin/pending">pending requests</a>
        </div>
      </div>
    </div>
  </AdminLayout>
);

export const PendingPage: FC<{ requests: AccessRequest[] }> = ({ requests }) => (
  <AdminLayout title="Pending requests">
    {requests.length === 0 ? (
      <p class="empty">No pending access requests.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>When</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {requests.map((r) => (
            <tr>
              <td>{r.email}</td>
              <td class="muted">{r.createdAt}</td>
              <td class="actions">
                <Post action={`/admin/pending/${r.id}/invite`} label="Invite" />
                <Post action={`/admin/pending/${r.id}/dismiss`} label="Dismiss" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);

export interface UsersFilter {
  status: string;
  stream: string;
  nobuild: boolean;
  pinned: boolean;
}

export const UsersPage: FC<{ users: UserView[]; channels: Stream[]; filter: UsersFilter }> = ({
  users,
  channels,
  filter,
}) => (
  <AdminLayout title="Users">
    <form method="post" action="/admin/clients" class="addform">
      <input type="email" name="email" placeholder="email" required />
      <input type="text" name="label" placeholder="label (optional)" />
      <select name="streamId">
        <option value="">— channel (optional) —</option>
        {channels.map((s) => (
          <option value={s.id}>{s.name}</option>
        ))}
      </select>
      <button type="submit">Add user</button>
    </form>

    <form method="get" action="/admin/users" class="addform">
      <select name="status">
        <option value="">any status</option>
        <option value="active" selected={filter.status === "active"}>
          active
        </option>
        <option value="revoked" selected={filter.status === "revoked"}>
          revoked
        </option>
      </select>
      <select name="stream">
        <option value="">any channel</option>
        {channels.map((s) => (
          <option value={s.name} selected={filter.stream === s.name}>
            {s.name}
          </option>
        ))}
      </select>
      <label>
        <input type="checkbox" name="nobuild" value="1" checked={filter.nobuild} /> no available
        build
      </label>
      <label>
        <input type="checkbox" name="pinned" value="1" checked={filter.pinned} /> pinned
      </label>
      <button type="submit">Filter</button>
      <a href="/admin/users">clear</a>
    </form>

    {users.length === 0 ? (
      <p class="empty">No users match.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Status</th>
            <th>Channels</th>
            <th>Installed</th>
            <th>Last install</th>
            <th>Last update</th>
            <th>Pinned</th>
            <th>State</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr>
              <td>{u.email}</td>
              <td>{u.status}</td>
              <td>{u.streams.join(", ") || <span class="muted">—</span>}</td>
              <td>{u.currentBuild ?? <span class="muted">—</span>}</td>
              <td class="muted">{u.lastInstalled ?? "—"}</td>
              <td class="muted">{u.lastUpdated ?? "—"}</td>
              <td>{u.pinnedBuildId ?? <span class="muted">—</span>}</td>
              <td>
                <NoBuildBadge state={u.noBuild} />
              </td>
              <td class="actions">
                <a href={`/admin/users/${u.id}`}>Manage</a>
                {u.status === "active" ? (
                  <Post action={`/admin/clients/${u.id}/revoke`} label="Revoke" />
                ) : null}
                <Post action={`/admin/clients/${u.id}/reissue`} label="Reissue" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);

export const BuildsPage: FC<{ builds: BuildView[] }> = ({ builds }) => (
  <AdminLayout title="Builds">
    {builds.length === 0 ? (
      <p class="empty">No builds published yet. Use Upload (or CI) to publish one.</p>
    ) : (
      <div>
        {/* Bulk-action bar (§13 #3). The row checkboxes live in the table but bind here via the HTML
            `form` attribute — HTML forbids nesting the per-row action <form>s inside this one. */}
        <form method="post" action="/admin/builds/bulk" id="bulk" class="addform">
          <span class="muted">With checked builds:</span>
          <button type="submit" name="op" value="withdraw">
            Withdraw
          </button>
          <button type="submit" name="op" value="critical">
            Mark critical
          </button>
          <button type="submit" name="op" value="uncritical">
            Clear critical
          </button>
        </form>

        <table>
          <thead>
            <tr>
              <th />
              <th>Build</th>
              <th>Version</th>
              <th>Status</th>
              <th>Critical</th>
              <th>Rollback</th>
              <th>Channels</th>
              <th>DL</th>
              <th>Upd</th>
              <th>Last activity</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {builds.map((b) => (
              <tr>
                <td>
                  <input type="checkbox" name="id" value={b.build.id} form="bulk" />
                </td>
                <td>{b.build.buildNumber}</td>
                <td>{b.build.shortVersion}</td>
                <td>{b.build.status}</td>
                <td>{b.build.critical ? "yes" : <span class="muted">—</span>}</td>
                <td>{b.build.rollbackTarget ? "target" : <span class="muted">—</span>}</td>
                <td>{b.streams.join(", ") || <span class="muted">—</span>}</td>
                <td>{b.downloads}</td>
                <td>{b.updates}</td>
                <td class="muted">{b.lastActivity ?? "—"}</td>
                <td class="actions">
                  <a href={`/admin/builds/${b.build.id}`}>Manage</a>
                  {b.build.status === "available" ? (
                    <Post action={`/admin/builds/${b.build.id}/withdraw`} label="Withdraw" />
                  ) : (
                    <Post action={`/admin/builds/${b.build.id}/restore`} label="Restore" />
                  )}
                  <Post
                    action={`/admin/builds/${b.build.id}/critical`}
                    label={b.build.critical ? "Clear critical" : "Mark critical"}
                    hidden={{ critical: b.build.critical ? "false" : "true" }}
                  />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )}
  </AdminLayout>
);

export const StreamsPage: FC<{ streams: StreamView[] }> = ({ streams }) => (
  <AdminLayout title="Channels">
    <form method="post" action="/admin/streams" class="addform">
      <input type="text" name="name" placeholder="channel name (e.g. stable)" required />
      <button type="submit">Add channel</button>
    </form>

    {streams.length === 0 ? (
      <p class="empty">No channels yet.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Builds</th>
            <th>Users</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => (
            <tr>
              <td>{s.name}</td>
              <td>{s.buildCount}</td>
              <td>{s.userCount}</td>
              <td class="actions">
                <a href={`/admin/streams/${s.id}`}>Manage</a>
                <Post action={`/admin/streams/${s.id}/delete`} label="Delete" />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);

export interface ActivityFilterView {
  email: string;
  event: string;
  build: string;
}

export const ActivityPage: FC<{ events: AccessLogEntry[]; filter: ActivityFilterView }> = ({
  events,
  filter,
}) => (
  <AdminLayout title="Activity">
    <form method="get" action="/admin/activity" class="addform">
      <input type="text" name="email" placeholder="email" value={filter.email} />
      <select name="event">
        <option value="">any event</option>
        {["check", "download", "update"].map((e) => (
          <option value={e} selected={filter.event === e}>
            {e}
          </option>
        ))}
      </select>
      <input type="text" name="build" placeholder="build #" value={filter.build} />
      <button type="submit">Filter</button>
      <a href="/admin/activity">clear</a>
    </form>

    {events.length === 0 ? (
      <p class="empty">No activity matches.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Email</th>
            <th>Event</th>
            <th>Build</th>
          </tr>
        </thead>
        <tbody>
          {events.map((e) => (
            <tr>
              <td class="muted">{e.createdAt}</td>
              <td>{e.email ?? <span class="muted">—</span>}</td>
              <td>{e.event}</td>
              <td>{e.buildNumber ?? <span class="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);

export interface AuditFilterView {
  actor: string;
  action: string;
}

export const AuditPage: FC<{ rows: AuditRow[]; filter: AuditFilterView }> = ({ rows, filter }) => (
  <AdminLayout title="Audit">
    <form method="get" action="/admin/audit" class="addform">
      <input type="text" name="actor" placeholder="actor email" value={filter.actor} />
      <input
        type="text"
        name="action"
        placeholder="action (e.g. client.revoke)"
        value={filter.action}
      />
      <button type="submit">Filter</button>
      <a href="/admin/audit">clear</a>
    </form>

    {rows.length === 0 ? (
      <p class="empty">No admin actions match.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
            <th>IP</th>
            <th>Ray ID</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="muted">{r.createdAt}</td>
              <td>{r.actorEmail}</td>
              <td>{r.action}</td>
              <td>{r.target ?? <span class="muted">—</span>}</td>
              <td class="muted">{r.ip ?? "—"}</td>
              <td class="muted">{r.rayId ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);
