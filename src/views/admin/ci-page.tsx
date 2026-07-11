import type { FC } from "hono/jsx";
import { AdminLayout, type Chrome } from "./layout";

// §13/§20 — the CI-publishing help page. Pure: it documents the headless publish flow for this exact
// instance (the admin origin is interpolated into copy-paste-ready commands). The upload/register
// routes are the only ones that accept a Cloudflare Access service token (decision 0006).

export const CiPage: FC<{ adminOrigin: string; chrome?: Chrome }> = ({ adminOrigin, chrome }) => (
  <AdminLayout title="CI publishing" chrome={chrome}>
    <p class="muted">
      Publish builds headlessly from CI over a Cloudflare Access <strong>service token</strong> —
      the only credential accepted on the build upload/register routes.
    </p>

    <div class="panel">
      <h2>1 · Create a service token</h2>
      <p>
        In Cloudflare Zero Trust → Access → Service Auth, create a service token and add a Service
        Auth rule to this app's Access application. Store its Client ID and Secret as CI secrets:
      </p>
      <pre>
        <code>CF_ACCESS_CLIENT_ID{"\n"}CF_ACCESS_CLIENT_SECRET</code>
      </pre>
    </div>

    <div class="panel">
      <h2>2 · Publish from CI</h2>
      <p>
        Build, sign Developer ID, notarize, staple, and run <code>sign_update</code> on macOS for
        the Sparkle EdDSA signature (the Worker never signs), then:
      </p>
      <pre>
        <code>{`export CF_ACCESS_CLIENT_ID=...  CF_ACCESS_CLIENT_SECRET=...
./ci-publish.sh \\
  --admin-url ${adminOrigin} \\
  --archive dist/MyApp.zip --short-version 1.4.0 --build-number 1500 \\
  --ed-signature "<sparkle:edSignature>" --stream-id 1`}</code>
      </pre>
    </div>

    <div class="panel">
      <h2>Large archives (&gt; ~90 MB)</h2>
      <p>
        PUT the archive to R2 out of band (a Cloudflare API token with R2 write), then register
        metadata-only — the Worker HEADs the object and rejects a length mismatch:
      </p>
      <pre>
        <code>{`./ci-publish.sh --admin-url ${adminOrigin} \\
  --object-key build/1500/MyApp.zip --size 123456789 \\
  --short-version 1.4.0 --build-number 1500 --ed-signature "..." --stream-id 1`}</code>
      </pre>
    </div>

    <div class="panel">
      <h2>Endpoints (service token accepted)</h2>
      <table>
        <tbody>
          <tr>
            <td>
              <code>POST /admin/builds/upload</code>
            </td>
            <td class="muted">multipart archive + version fields</td>
          </tr>
          <tr>
            <td>
              <code>POST /admin/builds/register</code>
            </td>
            <td class="muted">metadata-only (object_key + size)</td>
          </tr>
        </tbody>
      </table>
      <p class="muted">Every other admin mutation requires a human Access session.</p>
    </div>
  </AdminLayout>
);
