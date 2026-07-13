# Monitoring

This page explains how to read the back office: which build each user gets, what their apps have done, and whether the recorded history is intact.

## The Overview

The **Serving now** map draws one row per channel: the channel, the build it serves (its highest available linked build), and the audience. The audience cell summarizes the users on that channel — `all up to date`, or counts like `2 will update · 1 pinned`, or `1 faulted` when something is wrong. A channel with users but no available build shows `serving nothing — no build linked` and its users get an `empty feed`. Below the channels sits the **off the map** row: users routed nowhere — no channel, no pin — whose tokens work but whose checks resolve to nothing. **The map is computed by the same resolver the public Worker runs, so what you see here is exactly what Sparkle receives.**

**Needs attention** lists every current fault as a cause in prose plus exactly one remedy link:

- a stranded user (installed above everything their channels offer) → `Roll forward →`
- a pin that serves nothing (withdrawn, or below the installed build) → `Review pin →`
- a channel serving nothing to its users → `Link a build →`
- users with no channel → `Assign a channel →` (or `Review users →` for several)
- access requests waiting → `Review requests →`
- an audit chain mismatch → `Inspect audit →`
- a newer Alpha Gate release → update and re-deploy the instance

When nothing is wrong the section reads "Nothing needs attention — every active user is served."

**Recent** merges tester activity and your own actions into one feed, newest first: lines like "mira@studio.dev checked — on **#1499**" sit next to "you withdrew build #1500". Under the feed, the audit chain status line reports `audit chain intact · N entries` (or a mismatch warning); it is the same judgment the Audit page shows.

The page header carries the last-publish line: the newest build, the channels it went to (or "— in no channel"), and when. If that line does not match what you meant to ship, start there.

## The Users list

Each row answers the question you would otherwise have to reconstruct: what does this user's next update check do. The **Next check** column states it with its cause:

| Next check shows | Meaning |
| --- | --- |
| gets `#1500 · v1.3.0` | Offered this build. A `pinned` tag means the pin decides; `critical` means Sparkle treats it as required. |
| up to date · `#1500` | The served build is the one they already run. |
| — not served while revoked | Revoked; checks receive a renewal notice until you reactivate. |
| `no channel` | Assigned to no channel — resolves to nothing. |
| `no build` | Their channels carry no available build. |
| `pin serves nothing` | The pinned build was withdrawn; unpin or re-pin. |
| `pin below installed` | The pin sits under their installed build; Sparkle cannot downgrade. |
| `stranded` | Installed above everything their channels offer; roll forward. |

**Installed** is the build number the user's app last reported. **Last seen** is their most recent event of any kind. Filter the list by status, channel, `needs attention`, `pinned`, or `show hidden`.

## Activity

The Activity page lists every check, download, and update: when, which user, which event, which build. Filter by user (any part of the email), event, or build number; the page shows the latest 100 events, so narrow with the filters when you need older ones. Entries older than 90 days are pruned daily. **The Downloads and Updates counts on the Builds page are computed from this log, so they cover the last 90 days — they are not all-time totals.**

## Audit

The Audit page lists every admin action: when, the actor, the action slug (for example `client.revoke`), the target, the request IP, and the Cloudflare Ray ID. Targets are emails and build numbers, not database row ids, so rows stay readable on their own. Filter by actor or action; the page shows the latest 200 actions.

Each row is hash-chained to the one before it, and a daily job anchors the chain head to an append-only object in R2 (and emails it when email is configured). The status line above the table reports the live verdict: `chain intact · N entries · anchored`, `not yet anchored` before the first anchor has run, or `CHAIN MISMATCH — the log diverged from its last anchor`. **A mismatch means rows were edited, removed, or rebuilt.** Compare the log against the anchored copies in R2 and your Cloudflare account audit logs, which someone with admin access to this instance cannot rewrite.

## Activity vs Audit

Activity records what your testers' apps did; Audit records what you did.

Next: [Troubleshooting](../maintain/troubleshooting.md)
