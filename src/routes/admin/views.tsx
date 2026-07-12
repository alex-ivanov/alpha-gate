import { getCookie } from "hono/cookie";
import type { AccessEvent } from "../../core/types";
import { totalArchiveBytes } from "../../db/builds";
import { adminToAppOrigin, inviteUrl } from "../../lib/hosts";
import { emailStatus } from "../../services/email";
import { CiPage } from "../../views/admin/ci-page";
import type { Chrome } from "../../views/admin/layout";
import {
  BuildManagePage,
  SettingsPage,
  StreamManagePage,
  UploadPage,
  UserManagePage,
} from "../../views/admin/manage";
import {
  ActivityPage,
  AuditPage,
  BuildsPage,
  OverviewPage,
  PendingPage,
  StreamsPage,
  UsersPage,
} from "../../views/admin/read-pages";
import { SetupPage } from "../../views/admin/setup-page";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { flashMessage } from "./flash";
import { toId } from "./form";
import {
  loadActivity,
  loadAudit,
  loadBuildDetail,
  loadBuilds,
  loadChainStatus,
  loadChannels,
  loadDashboard,
  loadPending,
  loadPendingCount,
  loadSettings,
  loadStreamDetail,
  loadStreams,
  loadUser,
  loadUsersPage,
  selfUpdateView,
} from "./read-model";

// §13 — the admin GET pages. Each loads its read-model and renders the matching pure view, threading
// the shared chrome (flash notice, instance slug, pending-requests chip) and the clock's now.

async function chromeFor(c: AdminContext): Promise<Chrome> {
  const theme = getCookie(c, "theme");
  return {
    notice: flashMessage(c),
    instance: c.env?.INSTANCE,
    pending: await loadPendingCount(c.get("deps")),
    theme: theme === "light" || theme === "dark" ? theme : undefined,
    path: c.req.path,
  };
}

export async function dashboardView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  return c.html(
    renderPage(
      <OverviewPage
        data={await loadDashboard(deps)}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}

export async function usersView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const { users, channels } = await loadUsersPage(deps);
  const filter = {
    status: c.req.query("status") ?? "",
    stream: c.req.query("stream") ?? "",
    nobuild: c.req.query("nobuild") === "1",
    pinned: c.req.query("pinned") === "1",
    hidden: c.req.query("hidden") === "1", // show hidden too (default: visible only)
  };
  const hiddenCount = users.filter((u) => u.hidden).length;
  let rows = users;
  if (!filter.hidden) rows = rows.filter((u) => !u.hidden);
  if (filter.status) rows = rows.filter((u) => u.status === filter.status);
  if (filter.nobuild) rows = rows.filter((u) => u.noBuild !== "servable");
  if (filter.pinned) rows = rows.filter((u) => u.pinnedBuildId !== null);
  if (filter.stream) rows = rows.filter((u) => u.streams.includes(filter.stream));
  return c.html(
    renderPage(
      <UsersPage
        users={rows}
        channels={channels}
        filter={filter}
        hiddenCount={hiddenCount}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}

export async function userManageView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadUser(deps, id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(
    renderPage(
      <UserManagePage
        detail={detail}
        inviteLink={inviteUrl(c.req.url, detail.client.token)}
        linkDerived={adminToAppOrigin(new URL(c.req.url).origin) !== null}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}

export async function buildsView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const [builds, channels, storageBytes] = await Promise.all([
    loadBuilds(deps),
    loadChannels(deps),
    totalArchiveBytes(deps.db),
  ]);
  const showHidden = c.req.query("hidden") === "1"; // default: visible only
  const hiddenCount = builds.filter((b) => b.build.hidden).length;
  const rows = showHidden ? builds : builds.filter((b) => !b.build.hidden);
  return c.html(
    renderPage(
      <BuildsPage
        builds={rows}
        channels={channels}
        showHidden={showHidden}
        hiddenCount={hiddenCount}
        storageBytes={storageBytes}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}

export async function buildManageView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadBuildDetail(deps, id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(
    renderPage(<BuildManagePage detail={detail} now={deps.clock()} chrome={await chromeFor(c)} />),
  );
}

export async function streamsView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  return c.html(
    renderPage(<StreamsPage streams={await loadStreams(deps)} chrome={await chromeFor(c)} />),
  );
}

export async function streamManageView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadStreamDetail(deps, id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(
    renderPage(<StreamManagePage detail={detail} now={deps.clock()} chrome={await chromeFor(c)} />),
  );
}

export async function uploadView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const [channels, builds] = await Promise.all([loadChannels(deps), loadBuilds(deps)]);
  // The rollback guidance needs the floor (current highest build number) + a few recents for reference.
  const recentBuilds = builds
    .map((b) => ({ buildNumber: b.build.buildNumber, shortVersion: b.build.shortVersion }))
    .sort((a, b) => b.buildNumber - a.buildNumber)
    .slice(0, 5);
  return c.html(
    renderPage(
      <UploadPage channels={channels} recentBuilds={recentBuilds} chrome={await chromeFor(c)} />,
    ),
  );
}

export async function ciView(c: AdminContext): Promise<Response> {
  return c.html(
    renderPage(<CiPage adminOrigin={new URL(c.req.url).origin} chrome={await chromeFor(c)} />),
  );
}

export async function setupView(c: AdminContext): Promise<Response> {
  const meta = await loadSettings(c.get("deps"));
  const info = {
    appName: meta.app_name || "Your App",
    activateScheme: meta.activate_scheme || "myapp",
    publicKey: meta.sparkle_public_key || null,
    appOrigin: adminToAppOrigin(new URL(c.req.url).origin) ?? "<your App Worker URL>",
  };
  return c.html(renderPage(<SetupPage info={info} chrome={await chromeFor(c)} />));
}

export async function settingsView(c: AdminContext): Promise<Response> {
  const settings = await loadSettings(c.get("deps"));
  const env = c.env;
  const info = {
    instance: env.INSTANCE,
    toolVersion: env.TOOL_VERSION,
    email: emailStatus(env),
    accessTeam: env.ACCESS_TEAM_DOMAIN ?? null,
    accessAud: env.ACCESS_AUD ?? null,
    selfUpdate: selfUpdateView(settings),
    appOrigin: adminToAppOrigin(new URL(c.req.url).origin),
  };
  return c.html(
    renderPage(<SettingsPage settings={settings} info={info} chrome={await chromeFor(c)} />),
  );
}

export async function pendingView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  return c.html(
    renderPage(
      <PendingPage
        requests={await loadPending(deps)}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}

export async function activityView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const filter = {
    email: c.req.query("email") ?? "",
    event: c.req.query("event") ?? "",
    build: c.req.query("build") ?? "",
  };
  const buildNumber = /^\d+$/.test(filter.build) ? Number.parseInt(filter.build, 10) : undefined;
  const events = await loadActivity(deps, {
    email: filter.email || undefined,
    event: filter.event ? (filter.event as AccessEvent) : undefined,
    buildNumber,
  });
  return c.html(
    renderPage(
      <ActivityPage
        events={events}
        filter={filter}
        truncated={events.length >= 100}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}

export async function auditView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const filter = {
    actor: c.req.query("actor") ?? "",
    action: c.req.query("action") ?? "",
  };
  const rows = await loadAudit(deps, {
    actor: filter.actor || undefined,
    action: filter.action || undefined,
  });
  return c.html(
    renderPage(
      <AuditPage
        rows={rows}
        filter={filter}
        chain={await loadChainStatus(deps)}
        truncated={rows.length >= 200}
        now={deps.clock()}
        chrome={await chromeFor(c)}
      />,
    ),
  );
}
