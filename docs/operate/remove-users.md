# Removing users

How to take access away — and how to give it back — using the actions on a user's page.

All four actions live in the **Access** section at the bottom of the user's page (Users → click the email). Every one records an audit entry.

## Revoke

**Revoke access…** cuts the user off. What actually happens:

- Their private download link stops working immediately. Every download routes through the gate, so there is no cached or pre-signed URL that keeps serving.
- Their installed app stops receiving updates. On the next update check, Sparkle shows a reactivation notice instead of an update — an informational item, never an error. You can customize its title and message under Settings → "Access notice (revoked or unknown tokens)".

Revoke is always confirmed before it runs, and it is **reversible**: the token is kept, not deleted. The user's page shows a `revoked` tag and warns that the invite link is dead until you reactivate.

Revoking an already-revoked user does nothing and says so.

## Reactivate

**Reactivate** is the inverse of revoke. The stored token becomes valid again, so the same invite link starts working and the installed app resumes receiving updates on its next check. Nothing needs to be re-sent — the link the user already has is the one that revives.

## Reissue

**Reissue link…** rotates the token. Use it when a link leaked or was lost.

- The old link stops working immediately.
- The installed app's session dies with it — the app asks the user to re-activate.
- A new invite link is minted. It must reach the user: it is emailed when email delivery is configured, otherwise the back office shows the link and message for you to copy and send.

Reissue is always confirmed, because it kills a working setup even when nothing was wrong with it.

For a revoked user the button reads **Reactivate with a fresh link…** and does both at once: it restores access and mints a new link, while the old link and any installed app token stay dead. (Reissue alone on a revoked user would mint a link that does not work — the flow prevents that.)

## Hide

**Hide from list** declutters the Users list. It does not touch access: a hidden user keeps downloading and updating exactly as before. The user's page shows a quiet `hidden` tag.

The Users list has a "show hidden" checkbox that brings hidden users back into view; when some are hidden, the list also links to them ("N hidden not shown — show them"). **Unhide from list** reverses it.

## Which one when

- Pausing someone temporarily → **Revoke**.
- They came back → **Reactivate** (same link keeps working).
- Their link leaked or was lost → **Reissue**.
- They left for good → **Revoke**, then **Hide** to keep the list clean.

Next: [Channels](channels.md)
