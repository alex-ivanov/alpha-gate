# Adding users

How to create a user in the back office and get their private download link to them.

## Add a user

Open the **Users** page. The *Add user* form takes three fields:

- Email — required.
- Label — optional, a short note shown next to the email in the user list (e.g. "design partner").
- Channel — optional, the channel the user is assigned to on creation. The default is "— none —".

**A user with no channel receives no updates until you assign one.** The form warns about this, and the Overview page lists such users as routed nowhere. Leave the channel empty only if you mean to.

Press *Create invite*.

## The invite page

Creating the user lands you on a page titled "Invite ready". It shows the private link and, when the invite was not emailed, a ready-to-send message:

- *Private link* — the user's `https://<app-host>/get?token=<token>` URL, with a one-click *Copy link* button.
- *Message to send* — your invite template filled in with the link, with a *Copy message* button. Edit the template under Settings in the *Invite email template* fieldset; it supports `{app_name}`, `{get_url}`, and `{token}`, and feeds both the copy-paste message and real email.

The link is durable while the token is active: the user revisits it to re-download or re-activate. You can retrieve it any time from the *Invite link* section of the user's page — viewing it never changes the token. Replacing the link is a separate, explicit action (*Reissue* on the user's page).

On a deployed workers.dev instance the link carries the public host. On local dev or a custom domain the admin cannot derive the public host, and On a deployed workers.dev instance the link carries the public host. On local dev or a custom domain the admin cannot derive the public host, so the link carries the admin host instead — a user cannot open that one. The *Invite link* section of the user's page warns when this is the case; the invite page shows no warning, so check the host before sending. — a user cannot open that one.

## What the user sees

The link opens the branded download page (`/get`) on the public host. It carries three things, in order:

1. A *Download* button for the build their channel currently serves.
2. An *Activate* button — a deep link of the form `<scheme>://activate?token=…` that hands the token to the installed app. The scheme comes from the *Activate URL scheme* setting and must match the URL scheme your app registers.
3. The access key — the raw token, with the instruction to paste it in the app if Activate doesn't open it.

Below that, the page lists the steps: download and install the app, launch it, click Activate (or paste the key) to connect updates. Wiring the app side of this is covered in [Activation](../integrate/activation.md).

## Access requests

The public host also serves a request page at `/access`: an email field and a *Request access* button. The page is public — any visitor can submit an email address; nothing is granted automatically.

Submissions appear under **Requests** in the admin nav — a count chip shows when any are waiting, and the Overview lists them under *Needs attention*. Each request offers two actions:

- *Invite* creates the user and shows the same invite page as *Add user*. If the email belongs to an existing user, Invite issues a fresh token — the old link and any activated install stop working until re-activated — and reactivates them if they were revoked. There is no confirmation step, unlike Reissue on the user's page.
- *Dismiss* clears the request without creating a user.

A user created from a request has no channel — open their page and assign one. Duplicate requests from the same email are grouped ("asked N times"); the requester sees a confirmation page but receives no email, so repeats are normal. Inviting or dismissing resolves every request from that email at once.

## Sending the invite

Copy-paste is the default and needs no setup: copy the link or the filled message from the invite page and send it however you already talk to the user — chat, email, anything..

With email delivery configured, adding a user or inviting a request sends the invite automatically, and the invite page confirms it was emailed — the link shown is the same one they received. A failed send never blocks user creation; the page shows the failure reason and falls back to the copy-paste link. See [Email](email.md) to set it up.

Next: [Publish a build](publish.md)
