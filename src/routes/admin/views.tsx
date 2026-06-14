import {
  BuildManagePage,
  SettingsPage,
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
  loadStreams,
  loadUser,
  loadUsersPage,
} from "./read-model";

// §13 — the admin GET pages. Each loads its read-model and renders the matching pure view.

export async function dashboardView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<DashboardPage data={await loadDashboard(c.get("deps"))} />));
}

export async function usersView(c: AdminContext): Promise<Response> {
  const { users, channels } = await loadUsersPage(c.get("deps"));
  return c.html(renderPage(<UsersPage users={users} channels={channels} />));
}

export async function userManageView(c: AdminContext): Promise<Response> {
  const id = toId(c.req.param("id"));
  const detail = id === null ? null : await loadUser(c.get("deps"), id);
  if (detail === null) return c.text("Not found", 404);
  return c.html(renderPage(<UserManagePage detail={detail} />));
}

export async function buildsView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<BuildsPage builds={await loadBuilds(c.get("deps"))} />));
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

export async function uploadView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<UploadPage channels={await loadChannels(c.get("deps"))} />));
}

export async function settingsView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<SettingsPage settings={await loadSettings(c.get("deps"))} />));
}

export async function pendingView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<PendingPage requests={await loadPending(c.get("deps"))} />));
}

export async function activityView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<ActivityPage events={await loadActivity(c.get("deps"))} />));
}

export async function auditView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<AuditPage rows={await loadAudit(c.get("deps"))} />));
}
