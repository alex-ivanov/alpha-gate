import type { FC } from "hono/jsx";
import { AdminLayout, type Chrome } from "./layout";

// §6/§7/§14 — the admin "App setup" page: a personalized, copy-paste guide for wiring a macOS app to
// THIS instance (its activate scheme + saved Sparkle public key + its per-user feed URL). Pure: the
// route loads the values from `meta` and derives the App Worker origin. The public key is non-secret
// (it ships in the app); the private key never reaches the Worker.

export interface SetupInfo {
  appName: string;
  activateScheme: string;
  publicKey: string | null;
  /** The public App Worker origin, or a placeholder when it can't be derived (custom domain). */
  appOrigin: string;
}

export const SetupPage: FC<{ info: SetupInfo; chrome?: Chrome }> = ({ info, chrome }) => {
  const key = info.publicKey ?? "PASTE_SUPublicEDKey_FROM_generate_keys";
  const plist = `<key>SUPublicEDKey</key>
<string>${key}</string>

<key>CFBundleURLTypes</key>
<array><dict>
  <key>CFBundleURLSchemes</key>
  <array><string>${info.activateScheme}</string></array>
</dict></array>`;
  const feed = `${info.appOrigin}/appcast?token=<TOKEN>&installed=<CFBundleVersion>`;

  return (
    <AdminLayout title="App setup" chrome={chrome}>
      <p class="muted">
        How to wire <strong>{info.appName}</strong> to this instance. To publish builds see{" "}
        <a href="/admin/ci">CI publishing</a>; full runbook in <code>docs/UPLOADING.md</code>.
      </p>

      {info.publicKey === null ? (
        <p class="badge warn">
          No Sparkle public key saved yet — run <code>generate_keys</code> and paste{" "}
          <code>SUPublicEDKey</code> on the <a href="/admin/settings">Settings</a> page; it then
          fills in below.
        </p>
      ) : null}

      <div class="panel">
        <h2>1 · Sparkle EdDSA key (once)</h2>
        <pre>
          <code>./bin/generate_keys</code>
        </pre>
        <p class="muted">
          Prints the public key (save it in Settings). The private key stays in your Keychain —
          <code>sign_update</code> uses it at publish time; the Worker never holds it.
        </p>
      </div>

      <div class="panel">
        <h2>2 · Info.plist</h2>
        <pre>
          <code>{plist}</code>
        </pre>
        <p class="muted">
          Leave <code>SUFeedURL</code> unset and <code>SURequireSignedFeed</code> off — the feed is
          per-user (step 3). The scheme above must match the Activate URL scheme in Settings.
        </p>
      </div>

      <div class="panel">
        <h2>3 · Per-user feed (runtime)</h2>
        <p class="muted">
          Your SPUUpdaterDelegate builds the feed from the token stored on activation:
        </p>
        <pre>
          <code>{feed}</code>
        </pre>
        <p class="muted">
          The token reaches the app via <code>{`${info.activateScheme}://activate?token=…`}</code>{" "}
          or by pasting the key from the user's <code>/get</code> page.
        </p>
      </div>

      <div class="panel">
        <h2>4 · Publish</h2>
        <p class="muted">
          Build → sign → notarize → staple → <code>sign_update</code> on macOS, then upload via{" "}
          <a href="/admin/upload">Upload</a> or <a href="/admin/ci">CI</a>. Each build's{" "}
          <code>build_number</code> must increase.
        </p>
      </div>
    </AdminLayout>
  );
};
