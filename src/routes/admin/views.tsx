import {
  ActivityPage,
  AuditPage,
  BuildsPage,
  DashboardPage,
  StreamsPage,
  UsersPage,
} from "../../views/admin/read-pages";
import { renderPage } from "../../views/layout";
import type { AdminContext } from "./admin-context";
import {
  loadActivity,
  loadAudit,
  loadBuilds,
  loadDashboard,
  loadStreams,
  loadUsers,
} from "./read-model";

// §13 — the read-only admin pages. Each loads its read-model and renders the matching pure view.
// (All behind the auth middleware mounted in index.ts.)

export async function dashboardView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<DashboardPage data={await loadDashboard(c.get("deps"))} />));
}

export async function usersView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<UsersPage users={await loadUsers(c.get("deps"))} />));
}

export async function buildsView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<BuildsPage builds={await loadBuilds(c.get("deps"))} />));
}

export async function streamsView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<StreamsPage streams={await loadStreams(c.get("deps"))} />));
}

export async function activityView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<ActivityPage events={await loadActivity(c.get("deps"))} />));
}

export async function auditView(c: AdminContext): Promise<Response> {
  return c.html(renderPage(<AuditPage rows={await loadAudit(c.get("deps"))} />));
}
