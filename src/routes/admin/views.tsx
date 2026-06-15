import type { AccessEvent } from "../../core/types";
import { adminToAppOrigin } from "../../lib/hosts";
import { emailStatus } from "../../services/email";
import { CiPage } from "../../views/admin/ci-page";
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
  DashboardPage,
  PendingPage,
  StreamsPage,
  UsersPage,
} from "../../views/admin/read-pages";
import { SetupPage } from "../../views/admin/setup-page";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import { toId } from "./form";
import {
  loadActivity,
  loadAudit,
  loadBuildDetail,
  loadBuilds,
  loadChannels,
  loadDashboard,
  loadPending,
  loadSettings,
  loadStreamDetail,
  loadStreams,
  loadUser,
  loadUsersPage,
  selfUpdateView,
} from "./read-model";

// §13 — the admin GET pages. Each loads its read-model and renders the matching pure view.

export async function dashboardView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<DashboardPage data={await loadDashboard(c.get("deps"))} />));
}

export async function usersView(c: AdminContext): Promise<Response> {
  const { users, channels } = await loadUsersPage(c.get("deps"));
  const filter = {
    status: c.req.query("status") ?? "",
    stream: c.req.query("stream") ?? "",
    nobuild: c.req.query("nobuild") === "1",
    pinned: c.req.query("pinned") === "1",
  };
  let rows = users;
  if (filter.status) rows = rows.filter((u) => u.status === filter.status);
  if (filter.nobuild) rows = rows.filter((u) => u.noBuild !== "servable");
  if (filter.pinned) rows = rows.filter((u) => u.pinnedBuildId !== null);
  if (filter.stream) rows = rows.filter((u) => u.streams.includes(filter.stream));
  return c.html(renderPage(<UsersPage users={rows} channels={channels} filter={filter} />));
}

export async function userManageView(c: AdminContext): Promise<Response> {
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadUser(c.get("deps"), id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(renderPage(<UserManagePage detail={detail} />));
}

export async function buildsView(c: AdminContext): Promise<Response> {
  const deps = c.get("deps");
  const [builds, channels] = await Promise.all([loadBuilds(deps), loadChannels(deps)]);
  return c.html(renderPage(<BuildsPage builds={builds} channels={channels} />));
}

export async function buildManageView(c: AdminContext): Promise<Response> {
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadBuildDetail(c.get("deps"), id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(renderPage(<BuildManagePage detail={detail} />));
}

export async function streamsView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<StreamsPage streams={await loadStreams(c.get("deps"))} />));
}

export async function streamManageView(c: AdminContext): Promise<Response> {
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadStreamDetail(c.get("deps"), id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(renderPage(<StreamManagePage detail={detail} />));
}

export async function uploadView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<UploadPage channels={await loadChannels(c.get("deps"))} />));
}

export async function ciView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<CiPage adminOrigin={new URL(c.req.url).origin} />));
}

export async function setupView(c: AdminContext): Promise<Response> {
  const meta = await loadSettings(c.get("deps"));
  const info = {
    appName: meta.app_name || "Your App",
    activateScheme: meta.activate_scheme || "myapp",
    publicKey: meta.sparkle_public_key || null,
    appOrigin: adminToAppOrigin(new URL(c.req.url).origin) ?? "<your App Worker URL>",
  };
  return c.html(renderPage(<SetupPage info={info} />));
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
  };
  return c.html(renderPage(<SettingsPage settings={settings} info={info} />));
}

export async function pendingView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<PendingPage requests={await loadPending(c.get("deps"))} />));
}

export async function activityView(c: AdminContext): Promise<Response> {
  const filter = {
    email: c.req.query("email") ?? "",
    event: c.req.query("event") ?? "",
    build: c.req.query("build") ?? "",
  };
  const buildNumber = /^\d+$/.test(filter.build) ? Number.parseInt(filter.build, 10) : undefined;
  const events = await loadActivity(c.get("deps"), {
    email: filter.email || undefined,
    event: filter.event ? (filter.event as AccessEvent) : undefined,
    buildNumber,
  });
  return c.html(renderPage(<ActivityPage events={events} filter={filter} />));
}

export async function auditView(c: AdminContext): Promise<Response> {
  const filter = {
    actor: c.req.query("actor") ?? "",
    action: c.req.query("action") ?? "",
  };
  const rows = await loadAudit(c.get("deps"), {
    actor: filter.actor || undefined,
    action: filter.action || undefined,
  });
  return c.html(renderPage(<AuditPage rows={rows} filter={filter} />));
}
