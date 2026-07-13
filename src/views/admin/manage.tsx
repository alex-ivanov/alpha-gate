import type { FC } from "hono/jsx";
import type { Stream } from "../../core/types";
import { formatBytes } from "../../core/verdict";
import type {
  BuildDetail,
  SelfUpdateView,
  StreamDetail,
  UserDetail,
} from "../../routes/admin/read-model";
import type { EmailStatus } from "../../services/email";
import { Combobox } from "./combobox";
import { COPY_SCRIPT, Post } from "./forms";
import { AdminLayout, type Chrome } from "./layout";
import { ARCHIVE_AUTOFILL_SCRIPT } from "./plist-extract";
import { BuildTags, Dot, Lk, Tag, VerdictCell, When } from "./ui";

// The per-entity detail pages plus the Upload and Settings forms — quiet-instrument style: identity
// header, a verdict strip computed by the same resolver the runtime uses, slab-labeled relation
// sections with entity rows (never walls of buttons), and a quarantined danger zone. Every mutation
// form carries return_to so the operator lands back here with a flash.

const ret = (path: string) => ({ return_to: path });

// ————————————————————————————— User —————————————————————————————

export const UserManagePage: FC<{
  detail: UserDetail;
  inviteLink: string;
  /** False when the public App host can't be derived (local dev, custom domain) — the link then
      carries THIS admin host and won't work for the tester. */
  linkDerived: boolean;
  now: string;
  chrome: Chrome;
}> = ({ detail, inviteLink, linkDerived, now, chrome }) => {
  const { client, channels, assignedStreamIds, availableBuilds, currentBuild, verdict } = detail;
  const here = `/admin/users/${client.id}`;
  const assigned = new Set(assignedStreamIds);
  const assignedChannels = channels.filter((s) => assigned.has(s.id));
  const unassigned = channels.filter((s) => !assigned.has(s.id));
  const revoked = client.status === "revoked";

  return (
    <AdminLayout
      title={client.email}
      chrome={chrome}
      crumb={
        <>
          <a href="/admin/users">Users</a> / {client.email}
        </>
      }
      head={
        <p class="sub">
          {client.label ? <>{client.label} · </> : null}
          invited <When iso={client.createdAt} now={now} />
          {revoked ? (
            <>
              {" "}
              <Tag kind="mut" label="revoked" title="Not served; reactivate to restore" />
            </>
          ) : null}
          {client.hidden ? (
            <>
              {" "}
              <Tag kind="mut" label="hidden" title="Hidden from the Users list only" />
            </>
          ) : null}
        </p>
      }
    >
      <div class="verdict">
        <Dot
          kind={
            verdict.kind === "offered" || verdict.kind === "up-to-date"
              ? "ok"
              : verdict.kind === "revoked"
                ? "off"
                : "warn"
          }
        />
        <span>
          Next check → <VerdictCell verdict={verdict} />
        </span>
      </div>

      <section aria-label="Facts">
        <div class="slab">
          <h2>Facts</h2>
          <a href={`/admin/activity?email=${encodeURIComponent(client.email)}`}>activity →</a>
        </div>
        <dl class="facts">
          <div>
            <dt>Installed</dt>
            <dd>
              {currentBuild !== null ? (
                <b class="num">#{currentBuild}</b>
              ) : (
                <span class="mut">nothing reported yet</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Last check</dt>
            <dd>
              <When iso={detail.lastCheck} now={now} />
            </dd>
          </div>
          <div>
            <dt>Last install</dt>
            <dd>
              <When iso={detail.lastInstalled} now={now} />
            </dd>
          </div>
          <div>
            <dt>Last update</dt>
            <dd>
              <When iso={detail.lastUpdated} now={now} />
            </dd>
          </div>
        </dl>
      </section>

      <section aria-label="Channels">
        <div class="slab">
          <h2>Channels</h2>
          <span class="hint">the highest available build across these is what they're offered</span>
        </div>
        {assignedChannels.length === 0 ? (
          <p class="empty">No channels — this user is offered nothing (unless pinned).</p>
        ) : (
          <ul class="rows">
            {assignedChannels.map((s) => (
              <li>
                <span class="chs">
                  <a href={`/admin/streams/${s.id}`}>{s.name}</a>
                </span>
                <form method="post" action={`/admin/clients/${client.id}/streams/unassign`}>
                  <input type="hidden" name="streamId" value={s.id} />
                  <input type="hidden" name="return_to" value={here} />
                  <button type="submit">Remove</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {unassigned.length > 0 ? (
          <form method="post" action={`/admin/clients/${client.id}/streams/assign`} class="actions">
            <input type="hidden" name="return_to" value={here} />
            <label class="field">
              <span class="sr-only">Channel to assign</span>
              <select name="streamId">
                {unassigned.map((s) => (
                  <option value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <button type="submit">Assign channel</button>
          </form>
        ) : null}
      </section>

      <section aria-label="Pin">
        <div class="slab">
          <h2>Pin</h2>
          <span class="hint">
            a pin overrides channels entirely — remove it to resume normal flow
          </span>
        </div>
        {detail.pinnedBuild !== null ? (
          <ul class="rows">
            <li>
              <span>
                pinned to <Lk build={detail.pinnedBuild} />
              </span>
              <Post action={`/admin/clients/${client.id}/unpin`} label="Unpin" hidden={ret(here)} />
            </li>
          </ul>
        ) : client.pinnedBuildId !== null ? (
          <div class="callout warn">
            Pinned to a build that no longer resolves — unpin to restore channel flow.
            <Post action={`/admin/clients/${client.id}/unpin`} label="Unpin" hidden={ret(here)} />
          </div>
        ) : availableBuilds.length > 0 ? (
          <form method="post" action={`/admin/clients/${client.id}/pin`} class="actions">
            <input type="hidden" name="return_to" value={here} />
            <Combobox
              name="buildId"
              label="Build to pin"
              placeholder="Type a build number or version…"
              required
              options={availableBuilds.map((b) => ({
                value: String(b.id),
                label: `#${b.buildNumber} · v${b.shortVersion}`,
              }))}
            />
            <button type="submit">Pin to build</button>
          </form>
        ) : (
          <p class="empty">No available builds to pin to.</p>
        )}
      </section>

      <section aria-label="Invite link">
        <div class="slab">
          <h2>Invite link</h2>
          <span class="hint">viewing this never changes the token</span>
        </div>
        {revoked ? (
          <p class="callout warn">
            This user is revoked — the link below is dead until you reactivate them.
          </p>
        ) : null}
        {!linkDerived ? (
          <p class="callout warn">
            The public host can't be derived from this admin host (local dev or a custom domain), so
            the link below carries the <strong>admin</strong> host — testers can't open it. On a
            deployed workers.dev instance it carries the public host.
          </p>
        ) : null}
        <code class="token" id="invite-link">
          {inviteLink}
        </code>
        <div class="actions">
          <button type="button" class="btn" data-copy="#invite-link">
            Copy link
          </button>
        </div>
        <p class="fhint">
          The durable private link for this user — they revisit it to re-download or re-activate. If
          it leaked, use <strong>Reissue</strong> below to replace it.
        </p>
      </section>

      <section class="dangerzone" aria-label="Access">
        <div class="slab">
          <h2>Access</h2>
        </div>
        <p>
          {revoked
            ? "Reactivate restores access on the existing link. Reissue also mints a fresh link."
            : "Reissue replaces the link and the installed app's token. Revoke cuts access — reversible via Reactivate."}
        </p>
        <div class="actions">
          {revoked ? (
            <Post
              action={`/admin/clients/${client.id}/reactivate`}
              label="Reactivate"
              hidden={ret(here)}
            />
          ) : null}
          <Post
            action={`/admin/clients/${client.id}/reissue`}
            label={revoked ? "Reactivate with a fresh link…" : "Reissue link…"}
            hidden={ret(here)}
          />
          {!revoked ? (
            <Post
              action={`/admin/clients/${client.id}/revoke`}
              label="Revoke access…"
              hidden={ret(here)}
            />
          ) : null}
          <Post
            action={`/admin/clients/${client.id}/hidden`}
            label={client.hidden ? "Unhide from list" : "Hide from list"}
            hidden={{ hidden: client.hidden ? "false" : "true", ...ret(here) }}
          />
        </div>
      </section>
      <script dangerouslySetInnerHTML={{ __html: COPY_SCRIPT }} />
    </AdminLayout>
  );
};

// ————————————————————————————— Build —————————————————————————————

export const BuildManagePage: FC<{ detail: BuildDetail; now: string; chrome: Chrome }> = ({
  detail,
  now,
  chrome,
}) => {
  const { build, channels, linkedStreamIds, audience } = detail;
  const here = `/admin/builds/${build.id}`;
  const linked = new Set(linkedStreamIds);
  const linkedChannels = channels.filter((s) => linked.has(s.id));
  const unlinkedChannels = channels.filter((s) => !linked.has(s.id));
  const fileName = build.objectKey.split("/").at(-1) ?? build.objectKey;
  const reach = audience.offeredTo + audience.currentFor;

  return (
    <AdminLayout
      title={`#${build.buildNumber} · v${build.shortVersion}`}
      chrome={chrome}
      crumb={
        <>
          <a href="/admin/builds">Builds</a> / #{build.buildNumber}
        </>
      }
      head={
        <p class="sub">
          published <When iso={build.createdAt} now={now} /> <BuildTags build={build} />
        </p>
      }
    >
      <div class="verdict">
        <Dot kind={build.status === "available" ? (reach > 0 ? "ok" : "off") : "off"} />
        <span>
          {build.status === "withdrawn" ? (
            <>Withdrawn — offered to no one. Restore it to serve it again.</>
          ) : reach === 0 ? (
            <>Offered to no one right now — link a channel with assigned users.</>
          ) : (
            <>
              {audience.offeredTo > 0 ? (
                <>
                  offered to <b class="num">{audience.offeredTo}</b>{" "}
                  {audience.offeredTo === 1 ? "user" : "users"} on their next check
                </>
              ) : null}
              {audience.offeredTo > 0 && audience.currentFor > 0 ? " · " : null}
              {audience.currentFor > 0 ? (
                <>
                  current for <b class="num">{audience.currentFor}</b>{" "}
                  {audience.currentFor === 1 ? "user" : "users"}
                </>
              ) : null}
            </>
          )}
        </span>
      </div>

      <section aria-label="Artifact">
        <div class="slab">
          <h2>Artifact</h2>
          <a href={`/admin/activity?build=${build.buildNumber}`}>
            {detail.downloads} downloads · {detail.updates} updates →
          </a>
        </div>
        <dl class="facts">
          <div>
            <dt>File</dt>
            <dd>
              <code>{fileName}</code> ·{" "}
              <span title={`${build.length} bytes (the enclosure length)`}>
                {formatBytes(build.length)}
              </span>
            </dd>
          </div>
          <div>
            <dt>Minimum macOS</dt>
            <dd>{build.minOs ?? <span class="mut">any</span>}</dd>
          </div>
          <div>
            <dt>EdDSA signature</dt>
            <dd>
              <code>{build.edSignature}</code>
            </dd>
          </div>
          <div>
            <dt>Archive key</dt>
            <dd>
              <code>{build.objectKey}</code>
            </dd>
          </div>
          {build.dmgObjectKey ? (
            <div>
              <dt>First-install DMG</dt>
              <dd>
                <code>{build.dmgObjectKey}</code>
                {build.dmgLength !== null ? (
                  <>
                    {" "}
                    · <span title={`${build.dmgLength} bytes`}>{formatBytes(build.dmgLength)}</span>
                  </>
                ) : null}
              </dd>
            </div>
          ) : null}
        </dl>
      </section>

      <section aria-label="Channels">
        <div class="slab">
          <h2>Channels</h2>
          <span class="hint">
            users in these channels are offered this build when it's their highest
          </span>
        </div>
        {linkedChannels.length === 0 ? (
          <p class="empty">In no channel — offered to no one until you link one.</p>
        ) : (
          <ul class="rows">
            {linkedChannels.map((s) => (
              <li>
                <span class="chs">
                  <a href={`/admin/streams/${s.id}`}>{s.name}</a>
                </span>
                <form method="post" action={`/admin/builds/${build.id}/streams/unlink`}>
                  <input type="hidden" name="streamId" value={s.id} />
                  <input type="hidden" name="return_to" value={here} />
                  <button type="submit">Unlink</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {unlinkedChannels.length > 0 ? (
          <form method="post" action={`/admin/builds/${build.id}/streams/link`} class="actions">
            <input type="hidden" name="return_to" value={here} />
            <label class="field">
              <span class="sr-only">Channel to link</span>
              <select name="streamId">
                {unlinkedChannels.map((s) => (
                  <option value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <button type="submit">Link channel</button>
          </form>
        ) : null}
      </section>

      <section aria-label="State">
        <div class="slab">
          <h2>State</h2>
        </div>
        <div class="actions">
          {build.status === "withdrawn" ? (
            <Post action={`/admin/builds/${build.id}/restore`} label="Restore" hidden={ret(here)} />
          ) : null}
          <Post
            action={`/admin/builds/${build.id}/critical`}
            label={build.critical ? "Clear critical" : "Mark critical"}
            hidden={{ critical: build.critical ? "false" : "true", ...ret(here) }}
          />
          <Post
            action={`/admin/builds/${build.id}/rollback`}
            label={build.rollbackTarget ? "Clear rollback target" : "Designate rollback target"}
            hidden={{ rollback: build.rollbackTarget ? "false" : "true", ...ret(here) }}
          />
          <Post
            action={`/admin/builds/${build.id}/hidden`}
            label={build.hidden ? "Unhide from list" : "Hide from list"}
            hidden={{ hidden: build.hidden ? "false" : "true", ...ret(here) }}
          />
        </div>
        <p class="fhint">
          Critical makes Sparkle treat the update as required. The rollback-target mark is a label
          for the build you'd republish in an incident — it changes nothing by itself.
        </p>
      </section>

      {build.status === "available" ? (
        <section class="dangerzone" aria-label="Withdraw">
          <div class="slab">
            <h2>Withdraw</h2>
          </div>
          <p>
            Stops offering this build to anyone. Users already on it keep it — and if nothing higher
            serves them, they're stranded (you'll be asked to confirm in that case).
          </p>
          <div class="actions">
            <Post
              action={`/admin/builds/${build.id}/withdraw`}
              label="Withdraw build…"
              hidden={ret(here)}
            />
          </div>
        </section>
      ) : build.purgedAt === null ? (
        <section class="dangerzone" aria-label="Purge archive">
          <div class="slab">
            <h2>Purge archive</h2>
          </div>
          <p>
            Delete this withdrawn build's {formatBytes(build.length)} of archive bytes from R2 to
            reclaim free-tier space. The record stays (counts and audit intact), but it can't be
            restored afterwards — re-publish with a higher number if you need it back.
          </p>
          <div class="actions">
            <Post
              action={`/admin/builds/${build.id}/purge-archive`}
              label="Purge archive…"
              hidden={ret(here)}
            />
          </div>
        </section>
      ) : null}
    </AdminLayout>
  );
};

// ————————————————————————————— Channel —————————————————————————————

export const StreamManagePage: FC<{ detail: StreamDetail; now: string; chrome: Chrome }> = ({
  detail,
  now,
  chrome,
}) => {
  const {
    stream,
    linkedBuilds,
    unlinkedBuilds,
    topBuild,
    assignedUsers,
    unassignedUsers,
    serving,
  } = detail;
  const here = `/admin/streams/${stream.id}`;
  return (
    <AdminLayout
      title={stream.name}
      chrome={chrome}
      crumb={
        <>
          <a href="/admin/streams">Channels</a> / {stream.name}
        </>
      }
    >
      <div class="verdict">
        <Dot kind={topBuild === null ? "off" : serving.faulted > 0 ? "warn" : "ok"} />
        <span>
          {topBuild === null ? (
            <>
              Serving <strong>nothing</strong> — no available build is linked. Assigned users get an
              empty feed.
            </>
          ) : (
            <>
              Serving <Lk build={topBuild} href={`/admin/builds/${topBuild.id}`} /> →{" "}
              <b>{serving.users}</b> {serving.users === 1 ? "user" : "users"}
              {serving.faulted > 0 ? <span class="mut"> · {serving.faulted} faulted</span> : null}
              {serving.willUpdate > 0 ? (
                <span class="mut"> · {serving.willUpdate} will update</span>
              ) : null}
            </>
          )}
        </span>
      </div>

      <section aria-label="Builds">
        <div class="slab">
          <h2>Builds in this channel</h2>
          <span class="hint">the highest available one is what the channel serves</span>
        </div>
        {linkedBuilds.length === 0 ? (
          <p class="empty">None linked yet.</p>
        ) : (
          <ul class="rows">
            {linkedBuilds.map((b) => (
              <li>
                <span>
                  <Lk build={b} href={`/admin/builds/${b.id}`} /> <BuildTags build={b} />
                </span>
                <span class="t">
                  <When iso={b.createdAt} now={now} />
                </span>
                <form method="post" action={`/admin/builds/${b.id}/streams/unlink`}>
                  <input type="hidden" name="streamId" value={stream.id} />
                  <input type="hidden" name="return_to" value={here} />
                  <button type="submit">Unlink</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {unlinkedBuilds.length > 0 ? (
          <form method="post" action={`/admin/streams/${stream.id}/link`} class="actions">
            <input type="hidden" name="return_to" value={here} />
            <Combobox
              name="buildId"
              label="Builds to link"
              placeholder="Type a build number or version…"
              multiple
              required
              options={unlinkedBuilds.map((b) => ({
                value: String(b.id),
                label: `#${b.buildNumber} · v${b.shortVersion}`,
              }))}
            />
            <button type="submit">Link builds</button>
          </form>
        ) : null}
      </section>

      <section aria-label="Users">
        <div class="slab">
          <h2>Users in this channel</h2>
        </div>
        {assignedUsers.length === 0 ? (
          <p class="empty">No users assigned.</p>
        ) : (
          <ul class="rows">
            {assignedUsers.map((u) => (
              <li>
                <span>
                  <a class="who" href={`/admin/users/${u.id}`}>
                    {u.email}
                  </a>{" "}
                  {u.status === "revoked" ? <Tag kind="mut" label="revoked" /> : null}
                </span>
                <span class="vd">
                  <VerdictCell verdict={u.verdict} />
                </span>
                <form method="post" action={`/admin/clients/${u.id}/streams/unassign`}>
                  <input type="hidden" name="streamId" value={stream.id} />
                  <input type="hidden" name="return_to" value={here} />
                  <button type="submit">Unassign</button>
                </form>
              </li>
            ))}
          </ul>
        )}
        {unassignedUsers.length > 0 ? (
          <form method="post" action={`/admin/streams/${stream.id}/assign`} class="actions">
            <input type="hidden" name="return_to" value={here} />
            <Combobox
              name="clientId"
              label="Users to assign"
              placeholder="Type an email…"
              multiple
              required
              options={unassignedUsers.map((u) => ({ value: String(u.id), label: u.email }))}
            />
            <button type="submit">Assign users</button>
          </form>
        ) : null}
      </section>

      <section class="dangerzone" aria-label="Delete">
        <div class="slab">
          <h2>Delete channel</h2>
        </div>
        <p>
          Unassigns its {assignedUsers.length} {assignedUsers.length === 1 ? "user" : "users"} and
          unlinks its {linkedBuilds.length} {linkedBuilds.length === 1 ? "build" : "builds"} (the
          users and builds themselves are kept). You'll be asked to confirm.
        </p>
        <div class="actions">
          <Post
            action={`/admin/streams/${stream.id}/delete`}
            label="Delete channel…"
            hidden={ret("/admin/streams")}
          />
        </div>
      </section>
    </AdminLayout>
  );
};

// ————————————————————————————— Upload —————————————————————————————

export interface RecentBuild {
  buildNumber: number;
  shortVersion: string;
}

export const UploadPage: FC<{
  channels: Stream[];
  recentBuilds: RecentBuild[];
  chrome: Chrome;
}> = ({ channels, recentBuilds, chrome }) => {
  const topBuild = recentBuilds[0]?.buildNumber ?? null;
  return (
    <AdminLayout
      title="Upload build"
      chrome={chrome}
      head={
        <p class="sub">an already-signed, notarized archive — the Worker never signs anything</p>
      }
    >
      <form
        method="post"
        action="/admin/builds/upload"
        enctype="multipart/form-data"
        data-archive-autofill
      >
        {/* Two modes, toggled with no JS (CSS :has, see layout). Both publish via the same endpoint;
            rollback adds §9 guidance AND a server-side floor check (must exceed the highest build). */}
        <div class="modes">
          <label>
            <input type="radio" name="mode" value="normal" id="mode-normal" checked /> New release
          </label>
          <label>
            <input type="radio" name="mode" value="rollback" id="mode-rollback" /> Roll back
          </label>
        </div>

        <div class="rollback-only">
          <p class="callout warn">
            A rollback is a <strong>roll-forward</strong>: Sparkle can't downgrade, so rebuild the
            previous good code with a <strong>higher build number</strong> (keep its old version
            string), publish it here, then withdraw the bad build.
            {topBuild !== null ? (
              <>
                {" "}
                The current highest is <b class="num">#{topBuild}</b> — your build number must
                exceed it (enforced).
              </>
            ) : null}
          </p>
          {recentBuilds.length > 0 ? (
            <p class="fhint">
              Recent builds:{" "}
              {recentBuilds.map((b, i) => (
                <>
                  {i > 0 ? ", " : ""}
                  <code>
                    #{b.buildNumber} · v{b.shortVersion}
                  </code>
                </>
              ))}
              . Withdraw the bad one from its build page after publishing.
            </p>
          ) : null}
        </div>

        <fieldset>
          <legend>1 · Archive</legend>
          <label class="field">
            <span>Signed archive</span>
            <input type="file" name="archive" required />
          </label>
          <p class="fhint">
            Pick the signed <code>.app</code> <code>.zip</code> and the version + build fields fill
            themselves from its Info.plist (editable). A <code>.dmg</code>/<code>.tar</code> can't
            be read in the browser — type them in. Archives over ~90 MB use the CI register path
            (see docs/operate/publish.md).
          </p>
          <p data-autofill-status hidden />
        </fieldset>

        <fieldset>
          <legend>2 · Identity</legend>
          <div class="frow">
            <label class="field">
              <span>Version</span>
              <input name="short_version" placeholder="e.g. 1.4.0" required />
            </label>
            <label class="field">
              <span>Build number</span>
              <input name="build_number" class="mono" placeholder="e.g. 1500" required />
            </label>
            <label class="field">
              <span>
                Minimum macOS <i>· optional</i>
              </span>
              <input name="min_os" placeholder="e.g. 13.0" />
            </label>
          </div>
          <label class="field" style="margin-top:14px">
            <span>Sparkle EdDSA signature</span>
            <input
              name="ed_signature"
              class="mono"
              placeholder="the sign_update output for this exact file"
              required
              style="max-width:40rem"
            />
          </label>
          <p class="fhint">
            From Sparkle's <code>sign_update</code>, run against this exact file on your Mac. The
            build number must increase on every publish.
          </p>
        </fieldset>

        <fieldset>
          <legend>3 · Destination</legend>
          <div class="frow">
            <label class="field">
              <span>
                Channel <i>· optional</i>
              </span>
              <select name="stream_id">
                <option value="">— none yet —</option>
                {channels.map((s) => (
                  <option value={s.id}>{s.name}</option>
                ))}
              </select>
            </label>
            <label class="field">
              <span>Urgency</span>
              <label>
                <input type="checkbox" name="critical" value="true" /> mark critical (required
                update)
              </label>
            </label>
          </div>
          <p class="fhint">
            With no channel the build is published but offered to no one until you link it to a
            channel that users are assigned to.
          </p>
        </fieldset>

        <div class="actions">
          <button type="submit" class="btn-primary">
            Publish build
          </button>
        </div>
      </form>
      <script dangerouslySetInnerHTML={{ __html: ARCHIVE_AUTOFILL_SCRIPT }} />
    </AdminLayout>
  );
};

// ————————————————————————————— Settings —————————————————————————————

export interface SettingsInfo {
  instance: string;
  toolVersion: string;
  email: EmailStatus;
  accessTeam: string | null;
  accessAud: string | null;
  selfUpdate: SelfUpdateView;
  /** The public App Worker origin (derived), shown so the operator can find their tester-facing host. */
  appOrigin: string | null;
}

// The Email row of the instance panel: a status the admin can trust, because it's the same check that
// decides whether mail actually sends (services/email emailStatus). "incomplete" is the dangerous case —
// the provider says cloudflare but delivery silently falls back to copy-paste — so it's a warning.
const EmailStatusCell: FC<{ email: EmailStatus }> = ({ email }) =>
  email.mode === "active" ? (
    <>
      <Tag kind="acc" label="sending" /> via Cloudflare · <code>{email.from}</code>
    </>
  ) : email.mode === "incomplete" ? (
    <Tag kind="warn" label="misconfigured — falling back to copy-paste" />
  ) : (
    <span class="mut">copy-paste links (no email sent)</span>
  );

// Shown below the instance panel whenever email isn't actively sending: what's missing (if anything)
// and the exact deploy command to turn it on. Hidden once email is "active" — nothing to do.
const EmailSetupPanel: FC<{ instance: string; email: EmailStatus }> = ({ instance, email }) => {
  if (email.mode === "active") return null;
  const flags = `--instance ${instance} --email-provider cloudflare --email-from alpha@<your-sending-domain>`;
  const cmd = `./deploy/deploy.sh ${flags}       # from a clone\nnpx alpha-gate deploy ${flags}   # from npm`;
  return (
    <section aria-label="Email delivery">
      <div class="slab">
        <h2>Set up email delivery</h2>
      </div>
      {email.mode === "incomplete" ? (
        <p class="callout warn">
          Provider is set to Cloudflare but {email.missing.join(" and ")}{" "}
          {email.missing.length > 1 ? "are" : "is"} missing — invites silently fall back to
          copy-paste links until this is fixed.
        </p>
      ) : (
        <p class="fhint">
          Right now invites are <strong>copy-paste links</strong>: when you add a user (or invite a
          request), the back office shows the link and message for you to send manually — no email
          leaves the Worker. To send invites automatically:
        </p>
      )}
      <ol class="fhint" style="padding-left:1.2rem">
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
          Reload this page: the status above should read <Tag kind="acc" label="sending" />. Add a
          user with your own address to receive a test invite.
        </li>
      </ol>
    </section>
  );
};

export const SettingsPage: FC<{
  settings: Record<string, string>;
  info: SettingsInfo;
  now: string;
  chrome: Chrome;
}> = ({ settings, info, now, chrome }) => (
  <AdminLayout title="Settings" chrome={chrome}>
    <section aria-label="This instance">
      <div class="slab">
        <h2>This instance</h2>
        <a href="/admin/ci">publishing from CI →</a>
      </div>
      <dl class="facts">
        <div>
          <dt>Instance</dt>
          <dd>
            <code>{info.instance}</code>
          </dd>
        </div>
        <div>
          <dt>Tool version</dt>
          <dd>{info.toolVersion}</dd>
        </div>
        <div>
          <dt>Public host</dt>
          <dd>
            {info.appOrigin ? (
              <code>{info.appOrigin}</code>
            ) : (
              <span class="mut">not derivable from this host</span>
            )}
          </dd>
        </div>
        <div>
          <dt>Email</dt>
          <dd>
            <EmailStatusCell email={info.email} />
          </dd>
        </div>
        <div>
          <dt>Access team</dt>
          <dd>{info.accessTeam ?? <span class="mut">—</span>}</dd>
        </div>
        <div>
          <dt>Access AUD</dt>
          <dd class="mut">{info.accessAud ?? "—"}</dd>
        </div>
        <div>
          <dt>Self-update</dt>
          <dd>
            {info.selfUpdate.available ? (
              <>
                <Tag
                  kind="warn"
                  label={`${info.selfUpdate.latest} available${info.selfUpdate.breaking ? " (breaking)" : ""}`}
                />{" "}
                — update and re-deploy
                {info.selfUpdate.notesUrl ? (
                  <>
                    {" "}
                    · <a href={info.selfUpdate.notesUrl}>notes</a>
                  </>
                ) : null}
              </>
            ) : info.selfUpdate.checkedAt === null ? (
              <span class="mut">
                not checked yet — the daily cron reports here (fires within 24h of deploy)
              </span>
            ) : (
              <>
                <span class="mut">up to date</span>{" "}
                <span class="mut">
                  · checked <When iso={info.selfUpdate.checkedAt} now={now} />
                </span>
              </>
            )}
          </dd>
        </div>
      </dl>
    </section>

    <EmailSetupPanel instance={info.instance} email={info.email} />

    {info.email.mode === "active" ? (
      <section aria-label="Test email">
        <div class="slab">
          <h2>Test email delivery</h2>
        </div>
        <form method="post" action="/admin/settings/test-email" class="frow">
          <label class="field">
            <span>
              Recipient <i>· defaults to you</i>
            </span>
            <input type="email" name="to" placeholder="you@example.com" />
          </label>
          <button type="submit">Send test email</button>
        </form>
        <p class="fhint">
          Sends one email now and shows the exact result — the fastest way to debug delivery without
          creating a user. If it fails, run <code>wrangler tail</code> on the admin Worker for the
          full provider error.
        </p>
      </section>
    ) : null}

    <form method="post" action="/admin/branding" enctype="multipart/form-data">
      <fieldset>
        <legend>Download-page branding</legend>
        <div class="frow">
          <label class="field">
            <span>App name</span>
            <input name="app_name" value={settings.app_name ?? ""} placeholder="e.g. Acme" />
          </label>
          <label class="field">
            <span>
              Blurb <i>· optional</i>
            </span>
            <input
              name="blurb"
              value={settings.blurb ?? ""}
              placeholder="one line under the name"
            />
          </label>
          <label class="field">
            <span>Accent colour</span>
            <input name="accent" class="mono" value={settings.accent ?? ""} placeholder="#0A84FF" />
          </label>
        </div>
        <div class="frow">
          <label class="field">
            <span>
              Icon <i>· PNG/JPEG/WebP</i>
            </span>
            <input type="file" name="icon" accept="image/png,image/jpeg,image/webp" />
          </label>
          <label class="field">
            <span>
              Header image <i>· PNG/JPEG/WebP</i>
            </span>
            <input type="file" name="header" accept="image/png,image/jpeg,image/webp" />
          </label>
        </div>
      </fieldset>

      <fieldset>
        <legend>App activation</legend>
        <div class="frow">
          <label class="field">
            <span>Activate URL scheme</span>
            <input
              name="activate_scheme"
              class="mono"
              value={settings.activate_scheme ?? ""}
              placeholder="myapp"
            />
          </label>
          <label class="field">
            <span>Sparkle public key (SUPublicEDKey)</span>
            <input
              name="sparkle_public_key"
              class="mono"
              value={settings.sparkle_public_key ?? ""}
              placeholder="from generate_keys — not secret"
              style="min-width:24rem"
            />
          </label>
        </div>
        <p class="fhint">
          The Activate button on the download page links to{" "}
          <code>&lt;scheme&gt;://activate?token=…</code> — it must match the URL scheme your macOS
          app registers in its Info.plist. The public key feeds the ready-to-paste snippet on{" "}
          <a href="/admin/setup">Setup</a>.
        </p>
      </fieldset>

      <fieldset>
        <legend>Invite email template</legend>
        <label class="field">
          <span>
            Subject <i>· supports {"{app_name}"}</i>
          </span>
          <input
            name="invite_subject"
            value={settings.invite_subject ?? ""}
            placeholder="Your {app_name} alpha invite"
            style="max-width:40rem"
          />
        </label>
        <label class="field" style="margin-top:14px">
          <span>
            Body{" "}
            <i>
              · supports {"{app_name}"} {"{get_url}"} {"{token}"}
            </i>
          </span>
          <textarea
            name="invite_body"
            placeholder="Hi — here's your private download link: {get_url}"
          >
            {settings.invite_body ?? ""}
          </textarea>
        </label>
        <p class="fhint">
          Feeds both real email and the copy-paste message shown after you add a user.
        </p>
      </fieldset>

      <fieldset>
        <legend>Access notice (revoked or unknown tokens)</legend>
        <label class="field">
          <span>
            Title <i>· optional</i>
          </span>
          <input
            name="notice_title"
            value={settings.notice_title ?? ""}
            placeholder="Reactivate your access"
            style="max-width:40rem"
          />
        </label>
        <label class="field" style="margin-top:14px">
          <span>
            Message <i>· supports {"{app_name}"}</i>
          </span>
          <textarea name="notice_message" placeholder="Your access needs to be renewed.">
            {settings.notice_message ?? ""}
          </textarea>
        </label>
        <p class="fhint">
          Shown by Sparkle when a token is revoked or unknown — an informational notice (no install)
          linking to your access page. A valid user with no build sees nothing. Leave blank for the
          default.
        </p>
      </fieldset>

      <div class="actions">
        <button type="submit" class="btn-primary">
          Save settings
        </button>
      </div>
    </form>
  </AdminLayout>
);
