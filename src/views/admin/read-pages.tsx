import type { Child, FC } from "hono/jsx";
import type { AuditRow, ChainAssessment } from "../../core/audit-chain";
import type { Stream } from "../../core/types";
import { formatBytes } from "../../core/verdict";
import type { AccessLogEntry } from "../../db/access-log";
import type { AccessRequest } from "../../db/access-requests";
import type {
  BuildView,
  Dashboard,
  FaultedUser,
  RecentItem,
  StreamView,
  UserView,
} from "../../routes/admin/read-model";
import { Post } from "./forms";
import { AdminLayout, type Chrome } from "./layout";
import { BuildTags, Dot, Lk, Tag, VerdictCell, When } from "./ui";

// The back-office list pages, quiet-instrument style: one sheet, hairline slabs, exception-only
// state, and the resolver visible everywhere — the serving map on Overview, the Next-check column on
// Users, the Serving column on Channels. Rows link to detail pages; actions live there (no
// buttons-as-data). Detail pages live in manage.tsx.

// A header cell wired for the client-side table enhancer (table-enhance.ts): `sort` makes it
// click-to-sort ("text" | "num"); `col` is the key a filter control targets. Both are omitted from the
// markup when unset (a plain <th> stays unsortable), so the enhancer only touches columns we opt in.
const Th: FC<{ col?: string; sort?: "text" | "num"; right?: boolean; children?: Child }> = ({
  col,
  sort,
  right,
  children,
}) => {
  const attrs: Record<string, string> = {};
  if (col) attrs["data-key"] = col;
  if (sort) attrs["data-sort"] = sort;
  if (right) attrs.class = "r";
  return <th {...attrs}>{children}</th>;
};

// ————————————————————————————— Overview —————————————————————————————

/** One attention row: cause in prose, exactly one remedy link. */
interface AttentionItem {
  dot: "warn" | "req";
  title: Child;
  body: Child;
  fix: { href: string; label: string };
}

function faultAttention(fault: FaultedUser): AttentionItem | null {
  const userHref = `/admin/users/${fault.id}`;
  switch (fault.verdict.kind) {
    case "stranded":
      return {
        dot: "warn",
        title: (
          <>
            <a href={userHref}>{fault.email}</a> is stranded
          </>
        ),
        body: (
          <>
            Installed <b class="num">#{fault.verdict.installed}</b> is above everything{" "}
            {fault.streams.join(", ") || "their channels"} offer (top is{" "}
            <Lk build={fault.verdict.top} dim short />) — Sparkle can't downgrade.
          </>
        ),
        fix: { href: "/admin/upload", label: "Roll forward →" },
      };
    case "pin-unavailable":
      return {
        dot: "warn",
        title: (
          <>
            <a href={userHref}>{fault.email}</a>'s pin serves nothing
          </>
        ),
        body: <>The pinned build was withdrawn — their checks return an empty feed.</>,
        fix: { href: userHref, label: "Review pin →" },
      };
    case "pin-below-installed":
      return {
        dot: "warn",
        title: (
          <>
            <a href={userHref}>{fault.email}</a>'s pin serves nothing
          </>
        ),
        body: (
          <>
            Pinned <Lk build={fault.verdict.pinned} dim short /> sits below their installed{" "}
            <b class="num">#{fault.verdict.installed}</b> — Sparkle can't downgrade.
          </>
        ),
        fix: { href: userHref, label: "Review pin →" },
      };
    default:
      return null; // no-channel and empty-channel are covered by the map + channel rows
  }
}

const RECENT_PHRASES: Record<string, (target: string | null) => string> = {
  "client.create": (t) => `you invited ${t}`,
  "client.revoke": (t) => `you revoked ${t}`,
  "client.reactivate": (t) => `you reactivated ${t}`,
  "client.reissue": (t) => `you reissued a link for ${t}`,
  "client.pin": (t) => `you pinned ${t}`,
  "client.unpin": (t) => `you unpinned ${t}`,
  "client.hide": (t) => `you hid ${t}`,
  "client.unhide": (t) => `you unhid ${t}`,
  "stream.create": (t) => `you created the ${t} channel`,
  "stream.delete": (t) => `you deleted the ${t} channel`,
  "stream.assign": (t) => `you assigned ${t}`,
  "stream.unassign": (t) => `you unassigned ${t}`,
  "build.upload": (t) => `you published build ${t}`,
  "build.register": (t) => `you published build ${t}`,
  "build.withdraw": (t) => `you withdrew build ${t}`,
  "build.restore": (t) => `you restored build ${t}`,
  "build.critical": (t) => `you changed the critical mark on build ${t}`,
  "build.rollback": (t) => `you changed the rollback target on build ${t}`,
  "build.link": (t) => `you linked build ${t}`,
  "build.unlink": (t) => `you unlinked build ${t}`,
  "build.hide": (t) => `you hid build ${t}`,
  "build.unhide": (t) => `you unhid build ${t}`,
  "request.invite": (t) => `you invited ${t}`,
  "request.dismiss": (t) => `you dismissed the request from ${t}`,
};

const RecentLine: FC<{ item: RecentItem }> = ({ item }) => {
  if (item.kind === "admin") {
    const phrase = RECENT_PHRASES[item.action ?? ""];
    return <span>{phrase ? phrase(item.target) : `${item.action} ${item.target ?? ""}`}</span>;
  }
  const who = item.clientId ? (
    <a href={`/admin/users/${item.clientId}`}>{item.email}</a>
  ) : (
    <span>{item.email ?? "someone"}</span>
  );
  const buildRef = item.buildNumber !== null ? <b class="num">#{item.buildNumber}</b> : null;
  if (item.kind === "check") {
    return (
      <span>
        {who} checked{buildRef ? <> — on {buildRef}</> : null}
      </span>
    );
  }
  if (item.kind === "download") {
    return (
      <span>
        {who} downloaded {buildRef}
      </span>
    );
  }
  return (
    <span>
      {who} updated to {buildRef}
    </span>
  );
};

export const OverviewPage: FC<{ data: Dashboard; now: string; chrome: Chrome }> = ({
  data,
  now,
  chrome,
}) => {
  const attention: AttentionItem[] = [];
  if (data.chain !== null && !data.chain.intact) {
    attention.push({
      dot: "warn",
      title: <>Audit chain mismatch</>,
      body: <>The admin audit log no longer matches its last anchor — inspect it now.</>,
      fix: { href: "/admin/audit", label: "Inspect audit →" },
    });
  }
  if (data.selfUpdate.available) {
    attention.push({
      dot: "warn",
      title: <>Alpha Gate {data.selfUpdate.latest} is available</>,
      body: (
        <>
          {data.selfUpdate.breaking ? "Includes breaking changes. " : ""}Re-run deploy.sh to update
          this instance.
          {data.selfUpdate.notesUrl ? (
            <>
              {" "}
              <a href={data.selfUpdate.notesUrl}>Release notes</a>.
            </>
          ) : null}
        </>
      ),
      fix: { href: data.selfUpdate.notesUrl ?? "/admin/settings", label: "Details →" },
    });
  }
  for (const fault of data.faults) {
    const item = faultAttention(fault);
    if (item) attention.push(item);
  }
  for (const s of data.servings) {
    if (s.top === null && s.users > 0) {
      attention.push({
        dot: "warn",
        title: <>{s.name} serves nothing</>,
        body: (
          <>
            No available build is linked, so {s.users} {s.users === 1 ? "user gets" : "users get"}{" "}
            an empty feed and their apps report “up to date”.
          </>
        ),
        fix: { href: `/admin/streams/${s.streamId}`, label: "Link a build →" },
      });
    }
  }
  const firstOff = data.offMap[0];
  if (data.offMap.length === 1 && firstOff) {
    attention.push({
      dot: "warn",
      title: (
        <>
          <a href={`/admin/users/${firstOff.id}`}>{firstOff.email}</a> has no channel
        </>
      ),
      body: <>Their token works but resolves to nothing — they have never received a build.</>,
      fix: { href: `/admin/users/${firstOff.id}`, label: "Assign a channel →" },
    });
  } else if (data.offMap.length > 1) {
    attention.push({
      dot: "warn",
      title: <>{data.offMap.length} users have no channel</>,
      body: <>{data.offMap.map((u) => u.email).join(", ")} — their checks resolve to nothing.</>,
      fix: { href: "/admin/users?nobuild=1", label: "Review users →" },
    });
  }
  if (data.pendingRequests > 0) {
    attention.push({
      dot: "req",
      title: (
        <>
          {data.pendingRequests} access {data.pendingRequests === 1 ? "request" : "requests"}{" "}
          waiting
        </>
      ),
      body: (
        <>
          {data.pendingSample.emails.join(", ")}
          {data.pendingRequests > data.pendingSample.emails.length ? " and more" : ""}
          {data.pendingSample.oldest ? (
            <>
              {" "}
              — oldest from <When iso={data.pendingSample.oldest} now={now} />
            </>
          ) : null}
          .
        </>
      ),
      fix: { href: "/admin/pending", label: "Review requests →" },
    });
  }

  return (
    <AdminLayout
      title="Overview"
      chrome={chrome}
      head={
        <>
          {data.lastPublish ? (
            <p class="sub">
              Last publish{" "}
              <Lk
                build={data.lastPublish.build}
                href={`/admin/builds/${data.lastPublish.build.id}`}
              />
              {data.lastPublish.streams.length > 0 ? (
                <> → {data.lastPublish.streams.join(", ")}</>
              ) : (
                <> — in no channel</>
              )}
              , <When iso={data.lastPublish.build.createdAt} now={now} />
            </p>
          ) : (
            <p class="sub">Nothing published yet</p>
          )}
          <p class="inv">
            <a href="/admin/users">
              {data.users} users{data.hiddenUsers > 0 ? ` (+${data.hiddenUsers} hidden)` : ""}
            </a>{" "}
            · <a href="/admin/builds">{data.builds} builds</a> ·{" "}
            <a href="/admin/streams">{data.streams} channels</a>
          </p>
        </>
      }
    >
      <section aria-label="Serving map">
        <div class="slab">
          <h2>Serving now</h2>
          <span class="hint">what each channel offers on the next update check</span>
        </div>
        <ul class="map">
          {data.servings.map((s) => (
            <li>
              <Dot
                kind={s.top === null ? "off" : s.faulted > 0 ? "warn" : "ok"}
                title={
                  s.top === null
                    ? "Serving nothing"
                    : s.faulted > 0
                      ? "Serving, with faults"
                      : "Serving"
                }
              />
              <a class="ch" href={`/admin/streams/${s.streamId}`}>
                {s.name}
              </a>
              <span class={s.top === null ? "rail dash" : "rail"} />
              <span class="served">
                {s.top === null ? (
                  <span class="none">
                    serving nothing <i>— no build linked</i>
                  </span>
                ) : (
                  <>
                    <Lk build={s.top} href={`/admin/builds/${s.top.id}`} />
                    <BuildTags build={s.top} />
                  </>
                )}
              </span>
              <span class={s.top === null ? "rail dash" : "rail"} />
              <a class="aud" href={`/admin/users?stream=${encodeURIComponent(s.name)}`}>
                <b>
                  {s.users} {s.users === 1 ? "user" : "users"}
                </b>
                {s.users === 0 ? null : s.top === null ? (
                  <em class="w">empty feed</em>
                ) : (
                  <em class={s.faulted > 0 ? "w" : ""}>
                    {[
                      s.faulted > 0 ? `${s.faulted} faulted` : null,
                      s.willUpdate > 0 ? `${s.willUpdate} will update` : null,
                      s.pinned > 0 ? `${s.pinned} pinned` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ") || "all up to date"}
                  </em>
                )}
              </a>
            </li>
          ))}
          {data.offMap.length > 0 ? (
            <li class="offrow">
              <Dot kind="off" title="Routed nowhere" />
              <span class="ch">off the map</span>
              <span class="rail dash" />
              <span class="served">
                <span class="none">
                  routed nowhere <i>— no channel, no pin</i>
                </span>
              </span>
              <span class="rail dash" />
              <a class="aud" href="/admin/users?nobuild=1">
                <b>
                  {data.offMap.length} {data.offMap.length === 1 ? "user" : "users"}
                </b>
                <em class="w">never served</em>
              </a>
            </li>
          ) : null}
        </ul>
      </section>

      <div class="cols">
        <section aria-label="Needs attention">
          <div class="slab">
            <h2>Needs attention</h2>
          </div>
          {attention.length === 0 ? (
            <p class="allgood">
              <Dot kind="ok" /> Nothing needs attention — every active user is served.
            </p>
          ) : (
            <ul class="attn">
              {attention.map((item) => (
                <li>
                  <span class={`dot ${item.dot}`} />
                  <div>
                    <b>{item.title}</b>
                    <p>{item.body}</p>
                  </div>
                  <a class="fix" href={item.fix.href}>
                    {item.fix.label}
                  </a>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section aria-label="Recent">
          <div class="slab">
            <h2>Recent</h2>
            <a href="/admin/activity">activity →</a>
          </div>
          {data.recent.length === 0 ? (
            <p class="empty">No activity yet — invite a user and publish a build.</p>
          ) : (
            <ol class="rec">
              {data.recent.map((item) => (
                <li>
                  <When iso={item.at} now={now} />
                  <RecentLine item={item} />
                </li>
              ))}
            </ol>
          )}
          {data.chain !== null ? (
            <p class={data.chain.intact ? "seal" : "seal bad"} style="margin-top:14px">
              <Dot kind={data.chain.intact ? "ok" : "warn"} />
              {data.chain.intact
                ? `audit chain intact · ${data.chain.count} entries${data.chain.anchored ? "" : " · not yet anchored"}`
                : "AUDIT CHAIN MISMATCH — inspect the audit log"}
            </p>
          ) : null}
        </section>
      </div>
    </AdminLayout>
  );
};

// ————————————————————————————— Requests —————————————————————————————

export const PendingPage: FC<{ requests: AccessRequest[]; now: string; chrome: Chrome }> = ({
  requests,
  now,
  chrome,
}) => {
  // Duplicates are the norm (copy-paste mode sends no confirmation) — group by email, act once.
  const byEmail = new Map<string, AccessRequest[]>();
  for (const r of requests) {
    byEmail.set(r.email, [...(byEmail.get(r.email) ?? []), r]);
  }
  const grouped = [...byEmail.entries()];
  return (
    <AdminLayout title="Requests" chrome={chrome}>
      {grouped.length === 0 ? (
        <p class="empty">No pending access requests. The public request page feeds this list.</p>
      ) : (
        <section>
          <div class="slab">
            <h2>Waiting for a decision</h2>
            <span class="hint">Invite creates the user and shows the link to send</span>
          </div>
          <ul class="rows">
            {grouped.map(([email, rows]) => (
              <li>
                <span>
                  <span class="who">{email}</span>
                  {rows.length > 1 ? <span class="lbl">asked {rows.length} times</span> : null}
                </span>
                <span class="t">
                  <When iso={rows[0]?.createdAt ?? null} now={now} />
                </span>
                <Post action={`/admin/pending/${rows[0]?.id}/invite`} label="Invite" />
                <Post
                  action={`/admin/pending/${rows[0]?.id}/dismiss`}
                  label="Dismiss"
                  hidden={{ return_to: "/admin/pending" }}
                />
              </li>
            ))}
          </ul>
        </section>
      )}
    </AdminLayout>
  );
};

// ————————————————————————————— Users —————————————————————————————

export interface UsersFilter {
  status: string;
  stream: string;
  nobuild: boolean;
  pinned: boolean;
  hidden: boolean;
}

export const UsersPage: FC<{
  users: UserView[];
  channels: Stream[];
  filter: UsersFilter;
  hiddenCount: number;
  now: string;
  chrome: Chrome;
}> = ({ users, channels, filter, hiddenCount, now, chrome }) => {
  const channelId = new Map(channels.map((s) => [s.name, s.id]));
  const revoked = users.filter((u) => u.status === "revoked").length;
  return (
    <AdminLayout
      title="Users"
      chrome={chrome}
      head={
        <p class="sub">
          {users.length} shown{revoked > 0 ? ` · ${revoked} revoked` : ""}
        </p>
      }
    >
      <form method="get" action="/admin/users" class="filters">
        <label>
          status
          <select name="status">
            <option value="">any</option>
            <option value="active" selected={filter.status === "active"}>
              active
            </option>
            <option value="revoked" selected={filter.status === "revoked"}>
              revoked
            </option>
          </select>
        </label>
        <label>
          channel
          <select name="stream">
            <option value="">any</option>
            {channels.map((s) => (
              <option value={s.name} selected={filter.stream === s.name}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input type="checkbox" name="nobuild" value="1" checked={filter.nobuild} /> needs
          attention
        </label>
        <label>
          <input type="checkbox" name="pinned" value="1" checked={filter.pinned} /> pinned
        </label>
        <label>
          <input type="checkbox" name="hidden" value="1" checked={filter.hidden} /> show hidden
        </label>
        <button type="submit">Filter</button>
        <a href="/admin/users">clear</a>
      </form>

      {users.length === 0 ? (
        <p class="empty">No users match.</p>
      ) : (
        <section>
          <div class="tbl">
            <table data-enhance>
              <thead>
                <tr>
                  <Th sort="text">User</Th>
                  <Th col="channels" sort="text">
                    Channels
                  </Th>
                  <th>Next check</th>
                  <Th sort="num" right>
                    Installed
                  </Th>
                  <Th sort="text">Last seen</Th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr class={u.status === "revoked" || u.hidden ? "dim" : ""}>
                    <td>
                      <a class="who" href={`/admin/users/${u.id}`}>
                        {u.email}
                      </a>
                      {u.label ? <span class="lbl">{u.label}</span> : null}{" "}
                      {u.status === "revoked" ? (
                        <Tag kind="mut" label="revoked" title="Not served; reactivate to restore" />
                      ) : null}
                      {u.hidden ? <Tag kind="mut" label="hidden" /> : null}
                    </td>
                    <td class="chs" data-value={u.streams.join(",")}>
                      {u.streams.length > 0 ? (
                        u.streams.map((name, i) => (
                          <>
                            {i > 0 ? " · " : ""}
                            <a href={`/admin/streams/${channelId.get(name) ?? ""}`}>{name}</a>
                          </>
                        ))
                      ) : (
                        <span class="mut">—</span>
                      )}
                    </td>
                    <td>
                      <VerdictCell verdict={u.verdict} />
                    </td>
                    <td class="r" data-value={String(u.currentBuild ?? "")}>
                      {u.currentBuild !== null ? (
                        <b class="num">#{u.currentBuild}</b>
                      ) : (
                        <span class="mut">—</span>
                      )}
                    </td>
                    <td data-value={u.lastSeen ?? ""}>
                      <When iso={u.lastSeen} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="tfoot">
            <span data-table-status />
            {hiddenCount > 0 && !filter.hidden ? (
              <a href="/admin/users?hidden=1">{hiddenCount} hidden not shown — show them</a>
            ) : null}
          </p>
          <p class="empty" data-table-empty hidden>
            No users match the filters.
          </p>
        </section>
      )}

      <section aria-label="Add user">
        <div class="slab">
          <h2>Add user</h2>
          <span class="hint">the invite link appears on the next page, ready to copy</span>
        </div>
        <form method="post" action="/admin/clients" class="frow">
          <label class="field">
            <span>Email</span>
            <input type="email" name="email" required placeholder="e.g. mira@studio.dev" />
          </label>
          <label class="field">
            <span>
              Label <i>· optional</i>
            </span>
            <input type="text" name="label" placeholder="e.g. design partner" />
          </label>
          <label class="field">
            <span>Channel</span>
            <select name="streamId">
              <option value="">— none —</option>
              {channels.map((s) => (
                <option value={s.id}>{s.name}</option>
              ))}
            </select>
          </label>
          <button type="submit" class="btn-primary">
            Create invite
          </button>
        </form>
        <p class="fhint">
          A user with no channel receives no updates until you assign one — leave it empty only if
          you mean to.
        </p>
      </section>
    </AdminLayout>
  );
};

// ————————————————————————————— Builds —————————————————————————————

const FREE_TIER_BYTES = 10 * 1024 * 1024 * 1024; // R2 free tier = 10 GB

export const BuildsPage: FC<{
  builds: BuildView[];
  channels: Stream[];
  showHidden: boolean;
  hiddenCount: number;
  storageBytes: number;
  now: string;
  chrome: Chrome;
}> = ({ builds, channels, showHidden, hiddenCount, storageBytes, now, chrome }) => {
  const channelId = new Map(channels.map((s) => [s.name, s.id]));
  const nearCap = storageBytes > FREE_TIER_BYTES * 0.8;
  return (
    <AdminLayout
      title="Builds"
      chrome={chrome}
      head={
        <>
          <p class="sub" title={`${storageBytes} bytes stored in R2`}>
            {nearCap ? <Tag kind="warn" label="storage" /> : null} {formatBytes(storageBytes)} of
            archives{nearCap ? " — near the 10 GB free tier; purge withdrawn builds" : ""}
          </p>
          <p class="inv">
            <a href="/admin/upload">Upload a build →</a>
          </p>
        </>
      }
    >
      {builds.length === 0 ? (
        <p class="empty">
          {showHidden
            ? "No builds published yet. Use Upload (or CI) to publish one."
            : "No visible builds. Use Upload (or CI) to publish one, or show hidden builds."}
        </p>
      ) : (
        <section>
          {/* Client-side instant filters (table-enhance.ts) narrow without a reload; the show-hidden
              toggle is a server round-trip because hidden rows aren't in the page at all. */}
          <div class="filters">
            <label>
              state
              <select data-filter-col="state" aria-label="Filter by state">
                <option value="">any</option>
                <option value="available">available</option>
                <option value="withdrawn">withdrawn</option>
              </select>
            </label>
            <label>
              <input type="checkbox" data-filter-col="crit" data-filter-value="yes" /> critical only
            </label>
            <label>
              channel
              <select
                data-filter-col="channels"
                data-filter-match="contains"
                aria-label="Filter by channel"
              >
                <option value="">any</option>
                {channels.map((s) => (
                  <option value={s.name}>{s.name}</option>
                ))}
              </select>
            </label>
            <form method="get" action="/admin/builds" class="inline">
              <label>
                <input type="checkbox" name="hidden" value="1" checked={showHidden} /> show hidden
              </label>
              <button type="submit">Apply</button>
            </form>
          </div>

          {/* Bulk bar (§13 #3). Row checkboxes bind via the HTML `form` attribute; the header
              select-all checkbox + live count are progressive enhancement (table-enhance.ts). */}
          <form method="post" action="/admin/builds/bulk" id="bulk" class="filters">
            <span class="mut">
              With selected
              <span data-selected-count />:
            </span>
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

          <div class="tbl">
            <table data-enhance>
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" data-check-all aria-label="Select all builds" />
                  </th>
                  <Th sort="num">Build</Th>
                  <Th col="state" sort="text">
                    State
                  </Th>
                  <Th col="crit">
                    <span class="sr-only">Critical</span>
                  </Th>
                  <Th col="channels" sort="text">
                    Channels
                  </Th>
                  <Th sort="num" right>
                    Downloads
                  </Th>
                  <Th sort="num" right>
                    Updates
                  </Th>
                  <Th sort="num" right>
                    Size
                  </Th>
                  <Th sort="text">Published</Th>
                </tr>
              </thead>
              <tbody>
                {builds.map((b) => (
                  <tr class={b.build.status === "withdrawn" ? "dim" : ""}>
                    <td>
                      <input
                        type="checkbox"
                        name="id"
                        value={b.build.id}
                        form="bulk"
                        aria-label={`Select build ${b.build.buildNumber}`}
                      />
                    </td>
                    <td>
                      <Lk build={b.build} href={`/admin/builds/${b.build.id}`} />
                    </td>
                    <td data-value={b.build.status}>
                      <BuildTags build={b.build} />
                    </td>
                    <td data-value={b.build.critical ? "yes" : "no"}>
                      <span class="sr-only">{b.build.critical ? "critical" : "not critical"}</span>
                    </td>
                    <td class="chs" data-value={b.streams.join(",")}>
                      {b.streams.length > 0 ? (
                        b.streams.map((name, i) => (
                          <>
                            {i > 0 ? " · " : ""}
                            <a href={`/admin/streams/${channelId.get(name) ?? ""}`}>{name}</a>
                          </>
                        ))
                      ) : (
                        <span class="mut" title="In no channel — offered to no one">
                          —
                        </span>
                      )}
                    </td>
                    <td class="r">{b.downloads}</td>
                    <td class="r">{b.updates}</td>
                    <td
                      class="r"
                      data-value={String(b.build.purgedAt !== null ? 0 : b.build.length)}
                    >
                      {b.build.purgedAt !== null ? (
                        <Tag kind="mut" label="purged" title="Archive bytes deleted; record kept" />
                      ) : (
                        <span title={`${b.build.length} bytes`}>{formatBytes(b.build.length)}</span>
                      )}
                    </td>
                    <td data-value={b.build.createdAt}>
                      <When iso={b.build.createdAt} now={now} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p class="tfoot">
            <span data-table-status />
            {hiddenCount > 0 && !showHidden ? (
              <a href="/admin/builds?hidden=1">{hiddenCount} hidden not shown — show them</a>
            ) : null}
          </p>
          <p class="empty" data-table-empty hidden>
            No builds match the filters.
          </p>
        </section>
      )}
    </AdminLayout>
  );
};

// ————————————————————————————— Channels —————————————————————————————

export const StreamsPage: FC<{ streams: StreamView[]; chrome: Chrome }> = ({ streams, chrome }) => (
  <AdminLayout title="Channels" chrome={chrome}>
    {streams.length === 0 ? (
      <p class="empty">
        No channels yet. Users and builds attach to channels — create one (e.g. “stable”) to start
        serving updates.
      </p>
    ) : (
      <section>
        <div class="tbl">
          <table data-enhance>
            <thead>
              <tr>
                <Th sort="text">Channel</Th>
                <th>Serving</th>
                <Th sort="num" right>
                  Builds
                </Th>
                <Th sort="num" right>
                  Users
                </Th>
              </tr>
            </thead>
            <tbody>
              {streams.map((s) => (
                <tr>
                  <td class="chs">
                    <a class="who" href={`/admin/streams/${s.id}`}>
                      {s.name}
                    </a>
                  </td>
                  <td>
                    {s.topBuild ? (
                      <Lk build={s.topBuild} />
                    ) : (
                      <span class="vd">
                        <Tag
                          kind="warn"
                          label="serving nothing"
                          title="No available build linked"
                        />
                      </span>
                    )}
                  </td>
                  <td class="r">{s.buildCount}</td>
                  <td class="r">{s.userCount}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    )}

    <section aria-label="Add channel">
      <div class="slab">
        <h2>Add channel</h2>
      </div>
      <form method="post" action="/admin/streams" class="frow">
        <label class="field">
          <span>Name</span>
          <input type="text" name="name" required placeholder="e.g. stable" />
        </label>
        <button type="submit" class="btn-primary">
          Create channel
        </button>
      </form>
      <p class="fhint">
        A channel serves its highest available linked build to every assigned user. Deleting one is
        confirmed on its page.
      </p>
    </section>
  </AdminLayout>
);

// ————————————————————————————— Activity —————————————————————————————

export interface ActivityFilterView {
  email: string;
  event: string;
  build: string;
}

export const ActivityPage: FC<{
  events: AccessLogEntry[];
  filter: ActivityFilterView;
  truncated: boolean;
  now: string;
  chrome: Chrome;
}> = ({ events, filter, truncated, now, chrome }) => (
  <AdminLayout title="Activity" chrome={chrome}>
    <form method="get" action="/admin/activity" class="filters">
      <label>
        user
        <input type="text" name="email" placeholder="any part of the email" value={filter.email} />
      </label>
      <label>
        event
        <select name="event">
          <option value="">any</option>
          {["check", "download", "update"].map((e) => (
            <option value={e} selected={filter.event === e}>
              {e}
            </option>
          ))}
        </select>
      </label>
      <label>
        build
        <input type="text" name="build" placeholder="e.g. 1500" value={filter.build} />
      </label>
      <button type="submit">Filter</button>
      <a href="/admin/activity">clear</a>
    </form>

    {events.length === 0 ? (
      <p class="empty">No activity matches.</p>
    ) : (
      <section>
        <div class="tbl">
          <table data-enhance>
            <thead>
              <tr>
                <Th sort="text">When</Th>
                <Th sort="text">User</Th>
                <Th sort="text">Event</Th>
                <Th sort="num" right>
                  Build
                </Th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr>
                  <td data-value={e.createdAt}>
                    <When iso={e.createdAt} now={now} />
                  </td>
                  <td>{e.email ?? <span class="mut">—</span>}</td>
                  <td>{e.event}</td>
                  <td class="r">
                    {e.buildNumber !== null ? (
                      <b class="num">#{e.buildNumber}</b>
                    ) : (
                      <span class="mut">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated ? (
          <p class="tfoot">Showing the latest 100 events — narrow with the filters above.</p>
        ) : null}
      </section>
    )}
  </AdminLayout>
);

// ————————————————————————————— Audit —————————————————————————————

export interface AuditFilterView {
  actor: string;
  action: string;
}

export const AuditPage: FC<{
  rows: AuditRow[];
  filter: AuditFilterView;
  chain: ChainAssessment | null;
  truncated: boolean;
  now: string;
  chrome: Chrome;
}> = ({ rows, filter, chain, truncated, now, chrome }) => (
  <AdminLayout
    title="Audit"
    chrome={chrome}
    head={
      chain !== null ? (
        <p class={chain.intact ? "seal" : "seal bad"}>
          <Dot kind={chain.intact ? "ok" : "warn"} />
          {chain.intact
            ? `chain intact · ${chain.count} entries${chain.anchored ? " · anchored" : " · not yet anchored"}`
            : "CHAIN MISMATCH — the log diverged from its last anchor"}
        </p>
      ) : undefined
    }
  >
    {chain !== null && !chain.intact ? (
      <p class="callout danger">
        The audit log no longer verifies against its last anchor — rows were edited, removed, or
        rebuilt. Compare with the anchored copies in R2 and your Cloudflare account audit logs.
      </p>
    ) : null}
    <form method="get" action="/admin/audit" class="filters">
      <label>
        actor
        <input type="text" name="actor" placeholder="any part of the email" value={filter.actor} />
      </label>
      <label>
        action
        <input type="text" name="action" placeholder="e.g. client.revoke" value={filter.action} />
      </label>
      <button type="submit">Filter</button>
      <a href="/admin/audit">clear</a>
    </form>

    {rows.length === 0 ? (
      <p class="empty">No admin actions match.</p>
    ) : (
      <section>
        <div class="tbl">
          <table data-enhance>
            <thead>
              <tr>
                <Th sort="text">When</Th>
                <Th sort="text">Actor</Th>
                <Th sort="text">Action</Th>
                <Th sort="text">Target</Th>
                <Th sort="text">IP</Th>
                <Th sort="text">Ray ID</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr>
                  <td data-value={r.createdAt}>
                    <When iso={r.createdAt} now={now} />
                  </td>
                  <td>{r.actorEmail}</td>
                  <td>
                    <code>{r.action}</code>
                  </td>
                  <td>{r.target ?? <span class="mut">—</span>}</td>
                  <td class="mut">{r.ip ?? "—"}</td>
                  <td class="mut">
                    <code>{r.rayId ?? "—"}</code>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {truncated ? (
          <p class="tfoot">Showing the latest 200 actions — narrow with the filters above.</p>
        ) : null}
      </section>
    )}
  </AdminLayout>
);
