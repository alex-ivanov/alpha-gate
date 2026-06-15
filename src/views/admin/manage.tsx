import type { FC } from "hono/jsx";
import type { Stream } from "../../core/types";
import type {
  BuildDetail,
  SelfUpdateView,
  StreamDetail,
  UserDetail,
} from "../../routes/admin/read-model";
import type { EmailStatus } from "../../services/email";
import { Post } from "./forms";
import { AdminLayout } from "./layout";
import { ARCHIVE_AUTOFILL_SCRIPT } from "./plist-extract";

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
        Label: {client.label ?? "—"} · Status: {client.status} · Installed: {currentBuild ?? "—"} ·
        Pinned: {client.pinnedBuildId ?? "—"}
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
        {build.rollbackTarget ? " · rollback target" : ""}
      </p>

      <div class="panel">
        <h2>Artifact (§13 #7)</h2>
        <table class="kv">
          <tbody>
            <tr>
              <td>Build number</td>
              <td>{build.buildNumber}</td>
            </tr>
            <tr>
              <td>Short version</td>
              <td>{build.shortVersion}</td>
            </tr>
            <tr>
              <td>Minimum macOS</td>
              <td>{build.minOs ?? <span class="muted">—</span>}</td>
            </tr>
            <tr>
              <td>Enclosure length</td>
              <td>{build.length} bytes</td>
            </tr>
            <tr>
              <td>EdDSA signature</td>
              <td>
                <code>{build.edSignature}</code>
              </td>
            </tr>
            <tr>
              <td>Archive key</td>
              <td>
                <code>{build.objectKey}</code>
              </td>
            </tr>
            <tr>
              <td>First-install DMG</td>
              <td>
                {build.dmgObjectKey ? (
                  <code>
                    {build.dmgObjectKey} ({build.dmgLength ?? "?"} bytes)
                  </code>
                ) : (
                  <span class="muted">—</span>
                )}
              </td>
            </tr>
          </tbody>
        </table>
      </div>

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
        <Post
          action={`/admin/builds/${build.id}/rollback`}
          label={build.rollbackTarget ? "Clear rollback target" : "Designate rollback target"}
          hidden={{ rollback: build.rollbackTarget ? "false" : "true" }}
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

export const StreamManagePage: FC<{ detail: StreamDetail }> = ({ detail }) => {
  const { stream, linkedBuilds, unlinkedBuilds, topBuild, assignedUsers, unassignedUsers } = detail;
  return (
    <AdminLayout title={`Channel · ${stream.name}`}>
      <p class="muted">
        Currently serving:{" "}
        {topBuild ? `${topBuild.buildNumber} (${topBuild.shortVersion})` : "no available build"}
      </p>

      <div class="panel actions">
        <h2>Builds in this channel</h2>
        {linkedBuilds.length === 0 ? <span class="muted">None linked. </span> : null}
        {linkedBuilds.map((b) => (
          <Post
            action={`/admin/builds/${b.id}/streams/unlink`}
            label={`Unlink ${b.buildNumber} (${b.shortVersion})`}
            hidden={{ streamId: stream.id }}
          />
        ))}
      </div>

      <div class="panel actions">
        <h2>Link a build</h2>
        {unlinkedBuilds.length === 0 ? (
          <span class="muted">No other available builds to link.</span>
        ) : (
          unlinkedBuilds.map((b) => (
            <Post
              action={`/admin/builds/${b.id}/streams/link`}
              label={`Link ${b.buildNumber} (${b.shortVersion})`}
              hidden={{ streamId: stream.id }}
            />
          ))
        )}
      </div>

      <div class="panel actions">
        <h2>Users in this channel</h2>
        {assignedUsers.length === 0 ? <span class="muted">None assigned. </span> : null}
        {assignedUsers.map((u) => (
          <Post
            action={`/admin/clients/${u.id}/streams/unassign`}
            label={`Unassign ${u.email}`}
            hidden={{ streamId: stream.id }}
          />
        ))}
      </div>

      <div class="panel actions">
        <h2>Assign a user</h2>
        {unassignedUsers.length === 0 ? (
          <span class="muted">No active users to assign.</span>
        ) : (
          unassignedUsers.map((u) => (
            <Post
              action={`/admin/clients/${u.id}/streams/assign`}
              label={`Assign ${u.email}`}
              hidden={{ streamId: stream.id }}
            />
          ))
        )}
      </div>

      <div class="panel actions">
        <h2>Delete</h2>
        <Post action={`/admin/streams/${stream.id}/delete`} label="Delete channel" />
      </div>

      <p>
        <a href="/admin/streams">← Channels</a>
      </p>
    </AdminLayout>
  );
};

export interface RecentBuild {
  buildNumber: number;
  shortVersion: string;
}

export const UploadPage: FC<{ channels: Stream[]; recentBuilds: RecentBuild[] }> = ({
  channels,
  recentBuilds,
}) => {
  const topBuild = recentBuilds[0]?.buildNumber ?? null;
  return (
    <AdminLayout title="Upload build">
      <p class="muted">
        Upload an already-signed, notarized archive and paste its Sparkle EdDSA signature. Archives
        over ~90 MB use the CI register path (see docs/OPERATING.md).
      </p>
      <form
        method="post"
        action="/admin/builds/upload"
        enctype="multipart/form-data"
        class="panel"
        data-archive-autofill
      >
        {/* Two modes, toggled with no JS (CSS :has, see layout). Both publish via the same endpoint;
            rollback only adds §9 guidance, since a rollback IS a normal upload of a rebuilt artifact. */}
        <div class="modes">
          <label>
            <input type="radio" name="mode" value="normal" id="mode-normal" checked /> Normal
            release
          </label>
          <label>
            <input type="radio" name="mode" value="rollback" id="mode-rollback" /> Rollback
          </label>
        </div>

        <div class="rollback-only">
          <p class="callout callout-warn">
            Rollback = roll-forward (§9). Sparkle can't downgrade, so rebuild the previous good code
            with a <strong>higher build number</strong> while keeping its old short version, then
            upload it here.
            {topBuild !== null ? (
              <>
                {" "}
                The current highest is <strong>{topBuild}</strong> — your rollback build number must
                exceed it.
              </>
            ) : null}
          </p>
          {recentBuilds.length > 0 ? (
            <p class="muted">
              Recent builds:{" "}
              {recentBuilds.map((b, i) => (
                <>
                  {i > 0 ? ", " : ""}
                  <code>
                    {b.buildNumber} ({b.shortVersion})
                  </code>
                </>
              ))}
              . Withdraw the bad one on the <a href="/admin/builds">Builds</a> page after
              publishing.
            </p>
          ) : null}
        </div>

        <p>
          <input type="file" name="archive" required />
        </p>
        <p class="muted" data-autofill-note hidden>
          Version and build number filled from the archive's Info.plist — edit if you're rolling
          forward.
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
        <p class="muted hint">
          No channel: the build is published but offered to no one until you link it to a channel
          (Builds → Manage) that users are assigned to.
        </p>
        <button type="submit">Upload build</button>
      </form>
      <p>
        <a href="/admin/builds">← Builds</a>
      </p>
      <script dangerouslySetInnerHTML={{ __html: ARCHIVE_AUTOFILL_SCRIPT }} />
    </AdminLayout>
  );
};

export interface SettingsInfo {
  instance: string;
  toolVersion: string;
  email: EmailStatus;
  accessTeam: string | null;
  accessAud: string | null;
  selfUpdate: SelfUpdateView;
}

// The Email row of the instance panel: a status the admin can trust, because it's the same check that
// decides whether mail actually sends (services/email emailStatus). "incomplete" is the dangerous case —
// the provider says cloudflare but delivery silently falls back to copy-paste — so it's a warning.
const EmailStatusCell: FC<{ email: EmailStatus }> = ({ email }) =>
  email.mode === "active" ? (
    <>
      <span class="badge ok">sending</span> via Cloudflare · <code>{email.from}</code>
    </>
  ) : email.mode === "incomplete" ? (
    <span class="badge warn">misconfigured — falling back to copy-paste</span>
  ) : (
    <span class="muted">copy-paste links (no email sent)</span>
  );

// Shown below the instance panel whenever email isn't actively sending: what's missing (if anything) and
// the exact deploy command to turn it on. Hidden once email is "active" — nothing to do.
const EmailSetupPanel: FC<{ instance: string; email: EmailStatus }> = ({ instance, email }) => {
  if (email.mode === "active") return null;
  const cmd = `./deploy/deploy.sh --instance ${instance} --email-provider cloudflare --email-from alpha@<your-sending-domain>`;
  return (
    <div class="panel">
      <h2>Set up email delivery</h2>
      {email.mode === "incomplete" ? (
        <p class="badge warn">
          Provider is set to Cloudflare but {email.missing.join(" and ")}{" "}
          {email.missing.length > 1 ? "are" : "is"} missing — invites silently fall back to
          copy-paste links until this is fixed.
        </p>
      ) : (
        <p class="muted">
          Right now invites are <strong>copy-paste links</strong>: when you add a user (or invite a
          request), the back office shows the <code>/get</code> link for you to send manually — no
          email leaves the Worker. To send invites automatically:
        </p>
      )}
      <ol class="muted">
        <li>
          Cloudflare Email Service needs the <strong>Workers Paid plan</strong> and an{" "}
          <strong>onboarded sending domain</strong> (Cloudflare dashboard → Email → Email Routing →
          add and verify the DNS records).
        </li>
        <li>
          Re-run deploy with email turned on — this adds the <code>EMAIL</code> send_email binding
          to this admin Worker and sets the From address:
          <pre>
            <code>{cmd}</code>
          </pre>
        </li>
        <li>
          Reload this page: the status above should read <span class="badge ok">sending</span>. Add
          a user with your own address to receive a test invite.
        </li>
      </ol>
      <p class="muted">
        The invite wording is the template below ({"{app_name}"}, {"{get_url}"}, {"{token}"}); it
        feeds both copy-paste and real email.
      </p>
    </div>
  );
};

export const SettingsPage: FC<{ settings: Record<string, string>; info: SettingsInfo }> = ({
  settings,
  info,
}) => (
  <AdminLayout title="Settings">
    <div class="panel">
      <h2>This instance</h2>
      <table class="kv">
        <tbody>
          <tr>
            <td>Instance</td>
            <td>{info.instance}</td>
          </tr>
          <tr>
            <td>Tool version</td>
            <td>{info.toolVersion}</td>
          </tr>
          <tr>
            <td>Email</td>
            <td>
              <EmailStatusCell email={info.email} />
            </td>
          </tr>
          <tr>
            <td>Access team</td>
            <td>{info.accessTeam ?? <span class="muted">—</span>}</td>
          </tr>
          <tr>
            <td>Access AUD</td>
            <td class="muted">{info.accessAud ?? "—"}</td>
          </tr>
          <tr>
            <td>Self-update</td>
            <td>
              {info.selfUpdate.available ? (
                <>
                  <span class="badge warn">
                    {info.selfUpdate.latest} available
                    {info.selfUpdate.breaking ? " (breaking)" : ""} — re-run deploy.sh
                  </span>
                  {info.selfUpdate.notesUrl ? (
                    <>
                      {" "}
                      <a href={info.selfUpdate.notesUrl}>notes</a>
                    </>
                  ) : null}
                </>
              ) : (
                <span class="badge ok">up to date</span>
              )}
            </td>
          </tr>
        </tbody>
      </table>
      <p class="muted">
        Publishing from CI? See <a href="/admin/ci">CI publishing</a>.
      </p>
    </div>

    <EmailSetupPanel instance={info.instance} email={info.email} />

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
      <h2>App activation</h2>
      <p>
        <input
          name="activate_scheme"
          value={settings.activate_scheme ?? ""}
          placeholder="Activate URL scheme (default: myapp)"
        />
      </p>
      <p class="muted">
        The Activate button on the download page links to{" "}
        <code>&lt;scheme&gt;://activate?token=…</code>— set this to the URL scheme your macOS app
        registers in its Info.plist.
      </p>
      <p>
        <input
          name="sparkle_public_key"
          value={settings.sparkle_public_key ?? ""}
          placeholder="Sparkle EdDSA public key (SUPublicEDKey)"
        />
      </p>
      <p class="muted">
        The public key from Sparkle's <code>generate_keys</code> (not secret — it ships in the app).
        Stored for reference; see <a href="/admin/setup">Setup</a> for the ready-to-paste
        Info.plist.
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
      <h2>Access notice (revoked / expired tokens)</h2>
      <p>
        <input
          name="notice_title"
          value={settings.notice_title ?? ""}
          placeholder="Notice title (default: Reactivate your access)"
        />
      </p>
      <p>
        <textarea name="notice_message" placeholder="Message — supports {app_name}">
          {settings.notice_message ?? ""}
        </textarea>
      </p>
      <p class="muted">
        Shown by Sparkle when a token is revoked or unknown — an informational notice (no install)
        linking to your <code>/access</code> page. A valid user with no build sees nothing. Leave
        blank for the default.
      </p>
      <button type="submit">Save settings</button>
    </form>
  </AdminLayout>
);
