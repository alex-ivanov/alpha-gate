# Email

How invites reach your users: copy-paste links by default, automated email through Cloudflare Email Service as the paid option.

## The default: copy-paste

Out of the box there is nothing to set up and **nothing leaves the Worker**. When you [add a user](add-users.md) or invite a request, the back office shows an invite page with two blocks, each with a one-click copy button:

- **Private link** — the user's `/get` URL, with a Copy link button. The link is durable while the token is active; the user can revisit it.
- **Message to send** — your invite template filled in for this user, with a Copy message button. Paste it into whatever you already use to reach them.

The message body comes from the "Invite email template" on the Settings page; the same template feeds automated email once you enable it. In this mode the Email row on Settings reads "copy-paste links (no email sent)".

## What automated email requires

Automated delivery uses Cloudflare Email Service through a `send_email` binding on the admin Worker. It needs two things:

1. The **Workers Paid** plan.
2. A real, onboarded sending domain: in the Cloudflare dashboard, under Email → Email Routing, you add and verify SPF/DKIM DNS records for a zone you control.

A `*.workers.dev` hostname cannot be the sending domain — you do not control its DNS. An account with no domain of its own stays on copy-paste. The sending domain does not need to serve the Workers — the instance can stay on `*.workers.dev`; the domain only needs to be onboarded for email in the same account.

## Enable it

Re-run deploy with the email flags:

```bash
./deploy/deploy.sh --instance <slug> --email-provider cloudflare --email-from alpha@<your-sending-domain>
# from npm:
npx alpha-gate deploy --instance <slug> --email-provider cloudflare --email-from alpha@<your-sending-domain>
```

`--email-from` is required when `--email-provider` is `cloudflare`. The deploy adds the `EMAIL` send_email binding to the admin Worker and sets the From address. The flags are remembered: a later bare re-run (`--instance <slug>` alone) keeps them, so you pass them again only when the address or provider changes. One asymmetry: there is currently no flag that turns email back off — `--email-provider none` reads as "not passed" and the remembered provider wins..

After the deploy, reload Settings. The Email row should read "sending via Cloudflare" with your From address.

## Test it

Once email is active, Settings shows a "Test email delivery" section. Enter a recipient (it defaults to you) and press **Send test email**. It sends one email immediately and shows the exact result, so you can debug delivery without creating a user. If the send fails, run `wrangler tail` on the admin Worker to see the full provider error.

## When a send fails

A failed or misconfigured send **never blocks creating the user**. The user is written first; delivery is attempted after. If the email does not send, the invite page says so, names the reason, and still shows the link and message for you to send manually — the copy-paste path is always available.

Misconfiguration behaves the same way. If the provider is set to Cloudflare but the `EMAIL` binding or the From address is missing, invites fall back to copy-paste instead of erroring. Settings flags this state as "misconfigured — falling back to copy-paste" and lists exactly what is missing.

## The state-directory caveat

The email flags live only in the local deploy state directory (`.deploy/` in a clone, `~/.alpha-gate` from npm), not in the database. If you lose that directory, a bare re-run of deploy regenerates everything else but quietly reverts invites to copy-paste. Pass `--email-provider cloudflare --email-from <address>` once more to restore delivery. The Email row on Settings is where you would notice the reversion.

Next: [Backup](../maintain/backup.md)
