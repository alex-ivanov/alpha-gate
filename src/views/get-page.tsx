import type { FC } from "hono/jsx";
import type { Branding } from "../core/invite-template";
import { Layout } from "./layout";

// §6 — the one token-gated page each user receives. Carries every action in order: download,
// activate (deep link), the token as a paste fallback, and short instructions. The route computes the
// URLs (download with via=install; the myapp:// activate link) and the branding model; this is view.

export const GetPage: FC<{
  branding: Branding;
  token: string;
  downloadUrl: string;
  activateUrl: string;
}> = ({ branding, token, downloadUrl, activateUrl }) => (
  <Layout title={branding.appName} accent={branding.accent}>
    {branding.headerUrl ? <img class="header" src={branding.headerUrl} alt="" /> : null}
    {branding.iconUrl ? <img class="icon" src={branding.iconUrl} alt="" /> : null}
    <h1>{branding.appName}</h1>
    {branding.blurb ? <p class="blurb">{branding.blurb}</p> : null}

    <a class="btn primary" href={downloadUrl}>
      Download
    </a>
    <a class="btn" href={activateUrl}>
      Activate
    </a>

    <p class="hint">Access key — paste it in the app if Activate doesn’t open it:</p>
    <code class="token">{token}</code>

    <ol class="steps">
      <li>Download and install the app.</li>
      <li>Launch it.</li>
      <li>
        Click <strong>Activate</strong> (or paste the key) to connect updates.
      </li>
    </ol>
  </Layout>
);
