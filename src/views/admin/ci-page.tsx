import type { FC } from "hono/jsx";
import { AdminLayout, type Chrome } from "./layout";

// §13/§20 — the CI-publishing help page. Pure: it documents the headless publish flow for this exact
// instance (the admin origin is interpolated into copy-paste-ready commands). The upload/register
// routes are the only ones that accept a Cloudflare Access service token (decision 0006).

export const CiPage: FC<{ adminOrigin: string; chrome?: Chrome }> = ({ adminOrigin, chrome }) => (
  <AdminLayout title="CI publishing" chrome={chrome}>
    <p class="sub" style="margin-top:6px">
      Publish builds headlessly from CI over a Cloudflare Access <strong>service token</strong> —
      the only credential accepted on the build upload/register routes.
    </p>

    <section>
      <div class="slab">
        <h2>1 · Create a service token</h2>
      </div>
      <p>
        In Cloudflare Zero Trust → Access → Service Auth, create a service token and add a Service
        Auth rule to this app's Access application. Store its Client ID and Secret as CI secrets:
      </p>
      <pre>
        <code>CF_ACCESS_CLIENT_ID{"\n"}CF_ACCESS_CLIENT_SECRET</code>
      </pre>
    </section>

    <section>
      <div class="slab">
        <h2>2 · Publish from CI</h2>
      </div>
      <p>
        On a macOS runner, build → sign Developer ID → notarize → staple → produce the signed
        artifact, then run the same publish command you use locally. It reads the version from the
        app, signs with <code>sign_update</code> (the Worker never signs), links the channel by
        name, and handles the {">"} 90 MB register path itself:
      </p>
      <pre>
        <code>{`export CF_ACCESS_CLIENT_ID=...  CF_ACCESS_CLIENT_SECRET=...

# from a clone:
./publish.sh dist/MyApp.zip --admin-url ${adminOrigin} --channel beta
# or from npm (no clone):
npx alpha-gate publish dist/MyApp.zip --admin-url ${adminOrigin} --channel beta`}</code>
      </pre>
      <p class="muted">
        A runner with no readable app bundle (a bare zip): pass <code>--build-number</code> /{" "}
        <code>--short-version</code> and set <code>ED_SIGNATURE</code> from your own{" "}
        <code>sign_update</code> step.
      </p>
    </section>

    <section>
      <div class="slab">
        <h2>Endpoints (service token accepted)</h2>
      </div>
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
    </section>
  </AdminLayout>
);
