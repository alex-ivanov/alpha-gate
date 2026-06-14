import type { FC } from "hono/jsx";
import type { Stream } from "../../core/types";
import type { BuildDetail, UserDetail } from "../../routes/admin/read-model";
import { Post } from "./forms";
import { AdminLayout } from "./layout";

// §13 per-entity management pages, plus the upload and branding/settings forms. Each posts to the
// existing (tested) mutation handlers; the §11 confirm flow handles any stranding action server-side.

export const UserManagePage: FC<{ detail: UserDetail }> = ({ detail }) => {
  const { client, channels, assignedStreamIds, availableBuilds, currentBuild } = detail;
  const assigned = new Set(assignedStreamIds);
  const unassigned = channels.filter((s) => !assigned.has(s.id));
  const assignedChannels = channels.filter((s) => assigned.has(s.id));
  return (
    <AdminLayout title={`User · ${client.email}`}>
      <p class="muted">
        Status: {client.status} · Installed: {currentBuild ?? "—"} · Pinned:{" "}
        {client.pinnedBuildId ?? "—"}
      </p>

      <div class="panel actions">
        <h2>Access</h2>
        <Post action={`/admin/clients/${client.id}/reissue`} label="Reissue token" />
        {client.status === "active" ? (
          <Post action={`/admin/clients/${client.id}/revoke`} label="Revoke" />
        ) : null}
      </div>

      <div class="panel actions">
        <h2>Channels</h2>
        {assignedChannels.length === 0 ? <span class="muted">None assigned. </span> : null}
        {assignedChannels.map((s) => (
          <Post
            action={`/admin/clients/${client.id}/streams/unassign`}
            label={`Unassign ${s.name}`}
            hidden={{ streamId: s.id }}
          />
        ))}
        {unassigned.length > 0 ? (
          <form method="post" action={`/admin/clients/${client.id}/streams/assign`} class="inline">
            <select name="streamId">
              {unassigned.map((s) => (
                <option value={s.id}>{s.name}</option>
              ))}
            </select>
            <button type="submit">Assign</button>
          </form>
        ) : null}
      </div>

      <div class="panel actions">
        <h2>Pin</h2>
        {client.pinnedBuildId !== null ? (
          <Post action={`/admin/clients/${client.id}/unpin`} label="Unpin" />
        ) : null}
        {availableBuilds.length > 0 ? (
          <form method="post" action={`/admin/clients/${client.id}/pin`} class="inline">
            <select name="buildId">
              {availableBuilds.map((b) => (
                <option value={b.id}>
                  {b.buildNumber} ({b.shortVersion})
                </option>
              ))}
            </select>
            <button type="submit">Pin</button>
          </form>
        ) : (
          <span class="muted">No available builds to pin.</span>
        )}
      </div>

      <p>
        <a href="/admin/users">← Users</a>
      </p>
    </AdminLayout>
  );
};

export const BuildManagePage: FC<{ detail: BuildDetail }> = ({ detail }) => {
  const { build, channels, linkedStreamIds } = detail;
  const linked = new Set(linkedStreamIds);
  return (
    <AdminLayout title={`Build · ${build.buildNumber}`}>
      <p class="muted">
        {build.shortVersion} · {build.status} · {build.critical ? "critical" : "not critical"}
      </p>

      <div class="panel actions">
        <h2>State</h2>
        {build.status === "available" ? (
          <Post action={`/admin/builds/${build.id}/withdraw`} label="Withdraw" />
        ) : (
          <Post action={`/admin/builds/${build.id}/restore`} label="Restore" />
        )}
        <Post
          action={`/admin/builds/${build.id}/critical`}
          label={build.critical ? "Clear critical" : "Mark critical"}
          hidden={{ critical: build.critical ? "false" : "true" }}
        />
      </div>

      <div class="panel actions">
        <h2>Channels</h2>
        {channels.length === 0 ? <span class="muted">No channels yet.</span> : null}
        {channels.map((s) =>
          linked.has(s.id) ? (
            <Post
              action={`/admin/builds/${build.id}/streams/unlink`}
              label={`Unlink ${s.name}`}
              hidden={{ streamId: s.id }}
            />
          ) : (
            <Post
              action={`/admin/builds/${build.id}/streams/link`}
              label={`Link ${s.name}`}
              hidden={{ streamId: s.id }}
            />
          ),
        )}
      </div>

      <p>
        <a href="/admin/builds">← Builds</a>
      </p>
    </AdminLayout>
  );
};

export const UploadPage: FC<{ channels: Stream[] }> = ({ channels }) => (
  <AdminLayout title="Upload build">
    <p class="muted">
      Upload an already-signed, notarized archive and paste its Sparkle EdDSA signature. Archives
      over ~90 MB use the CI register path (see docs/OPERATING.md).
    </p>
    <form method="post" action="/admin/builds/upload" enctype="multipart/form-data" class="panel">
      <p>
        <input type="file" name="archive" required />
      </p>
      <p>
        <input name="short_version" placeholder="short version (e.g. 1.4.0)" required />
      </p>
      <p>
        <input name="build_number" placeholder="build number (e.g. 1500)" required />
      </p>
      <p>
        <input name="ed_signature" placeholder="sparkle:edSignature" required />
      </p>
      <p>
        <input name="min_os" placeholder="minimum macOS (optional)" />
      </p>
      <p>
        <label>
          <input type="checkbox" name="critical" value="true" /> mark critical
        </label>
      </p>
      <p>
        <select name="stream_id">
          <option value="">— channel (optional) —</option>
          {channels.map((s) => (
            <option value={s.id}>{s.name}</option>
          ))}
        </select>
      </p>
      <button type="submit">Upload build</button>
    </form>
    <p>
      <a href="/admin/builds">← Builds</a>
    </p>
  </AdminLayout>
);

export const SettingsPage: FC<{ settings: Record<string, string> }> = ({ settings }) => (
  <AdminLayout title="Settings">
    <form method="post" action="/admin/branding" enctype="multipart/form-data" class="panel">
      <h2>Download-page branding</h2>
      <p>
        <input name="app_name" value={settings.app_name ?? ""} placeholder="App name" />
      </p>
      <p>
        <input name="blurb" value={settings.blurb ?? ""} placeholder="Short blurb" />
      </p>
      <p>
        <input name="accent" value={settings.accent ?? ""} placeholder="Accent colour (#0A84FF)" />
      </p>
      <p>
        Icon: <input type="file" name="icon" accept="image/png,image/jpeg,image/webp" />
      </p>
      <p>
        Header: <input type="file" name="header" accept="image/png,image/jpeg,image/webp" />
      </p>
      <h2>Invite email template</h2>
      <p>
        <input
          name="invite_subject"
          value={settings.invite_subject ?? ""}
          placeholder="Subject — supports {app_name}"
        />
      </p>
      <p>
        <textarea name="invite_body" placeholder="Body — supports {app_name} {get_url} {token}">
          {settings.invite_body ?? ""}
        </textarea>
      </p>
      <button type="submit">Save settings</button>
    </form>
  </AdminLayout>
);
