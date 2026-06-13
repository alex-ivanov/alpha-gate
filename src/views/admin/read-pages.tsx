import type { FC } from "hono/jsx";
import type { AuditRow } from "../../core/audit-chain";
import type { AccessLogEntry } from "../../db/access-log";
import type { BuildView, Dashboard, StreamView, UserView } from "../../routes/admin/read-model";
import { AdminLayout, NoBuildBadge } from "./layout";

// The §13 read-only back-office pages — pure tables over the read-model. Mutation forms (manage,
// upload, branding) land with their handlers in M13+.

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
    </div>
  </AdminLayout>
);

export const UsersPage: FC<{ users: UserView[] }> = ({ users }) => (
  <AdminLayout title="Users">
    {users.length === 0 ? (
      <p class="empty">No users yet.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Email</th>
            <th>Status</th>
            <th>Channels</th>
            <th>Installed</th>
            <th>Pinned</th>
            <th>State</th>
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr>
              <td>{u.email}</td>
              <td>{u.status}</td>
              <td>{u.streams.join(", ") || <span class="muted">—</span>}</td>
              <td>{u.currentBuild ?? <span class="muted">—</span>}</td>
              <td>{u.pinnedBuildId ?? <span class="muted">—</span>}</td>
              <td>
                <NoBuildBadge state={u.noBuild} />
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
      <p class="empty">No builds published yet.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Build</th>
            <th>Version</th>
            <th>Status</th>
            <th>Critical</th>
            <th>Channels</th>
            <th>Downloads</th>
            <th>Updates</th>
          </tr>
        </thead>
        <tbody>
          {builds.map((b) => (
            <tr>
              <td>{b.build.buildNumber}</td>
              <td>{b.build.shortVersion}</td>
              <td>{b.build.status}</td>
              <td>{b.build.critical ? "yes" : <span class="muted">—</span>}</td>
              <td>{b.streams.join(", ") || <span class="muted">—</span>}</td>
              <td>{b.downloads}</td>
              <td>{b.updates}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);

export const StreamsPage: FC<{ streams: StreamView[] }> = ({ streams }) => (
  <AdminLayout title="Channels">
    {streams.length === 0 ? (
      <p class="empty">No channels yet.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>Channel</th>
            <th>Builds</th>
            <th>Users</th>
          </tr>
        </thead>
        <tbody>
          {streams.map((s) => (
            <tr>
              <td>{s.name}</td>
              <td>{s.buildCount}</td>
              <td>{s.userCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);

export const ActivityPage: FC<{ events: AccessLogEntry[] }> = ({ events }) => (
  <AdminLayout title="Activity">
    {events.length === 0 ? (
      <p class="empty">No activity yet.</p>
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

export const AuditPage: FC<{ rows: AuditRow[] }> = ({ rows }) => (
  <AdminLayout title="Audit">
    {rows.length === 0 ? (
      <p class="empty">No admin actions recorded yet.</p>
    ) : (
      <table>
        <thead>
          <tr>
            <th>When</th>
            <th>Actor</th>
            <th>Action</th>
            <th>Target</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr>
              <td class="muted">{r.createdAt}</td>
              <td>{r.actorEmail}</td>
              <td>{r.action}</td>
              <td>{r.target ?? <span class="muted">—</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    )}
  </AdminLayout>
);
