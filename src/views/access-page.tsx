import type { FC } from "hono/jsx";
import { DEFAULT_BRANDING } from "../core/invite-template";
import { Layout } from "./layout";

// §13 — the public "request access" page (target of the revoked-user notice link) and the generic
// 404 surface returned for an invalid/revoked token on /get, which must NOT confirm token existence.

export const AccessPage: FC<{ appName: string; accent: string }> = ({ appName, accent }) => (
  <Layout title={appName} accent={accent}>
    <h1>Request access</h1>
    <p class="blurb">Enter your email to request access to the {appName} alpha.</p>
    <form method="post" action="/access">
      <input class="input" type="email" name="email" placeholder="you@example.com" required />
      <button class="btn primary" type="submit">
        Request access
      </button>
    </form>
  </Layout>
);

export const RequestReceivedPage: FC<{ appName: string; accent: string }> = ({
  appName,
  accent,
}) => (
  <Layout title={appName} accent={accent}>
    <h1>Request received</h1>
    <p class="blurb">
      Thanks — your request for {appName} access has been recorded. The admin will follow up by
      email.
    </p>
  </Layout>
);

export const NotFoundPage: FC<{ accent?: string }> = ({ accent = DEFAULT_BRANDING.accent }) => (
  <Layout title="Not found" accent={accent}>
    <h1>Not found</h1>
    <p class="muted">This page isn’t available.</p>
  </Layout>
);
