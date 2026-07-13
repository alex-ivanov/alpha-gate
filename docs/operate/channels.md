# Channels

Release channels group users and builds: this page covers creating a channel, linking builds, assigning users, pinning a user to one build, and the guard against leaving anyone with no servable build.

## The model

A channel serves its **highest available linked build** to every user assigned to it. Link order does not matter: the linked build with the largest build number that is not withdrawn is what the channel offers.

Users and builds can be on several channels at once. A user on more than one channel is offered the highest available build across all of them — the user page's Channels section says so next to the list.

Two states serve nothing. A build linked to no channel is offered to no one. A user assigned to no channel gets an empty feed, and their app reports up to date; the admin surfaces both with a "no channel" warning.

## Create a channel

On the Channels page, the Add channel section takes a name — `stable` and `beta` are typical — and the Create channel button creates it. Names are unique; a duplicate is rejected with a clear error.

The Channels list shows what each channel is serving, with a **"serving nothing"** warning when no available build is linked.

## Link builds

Open the channel. The "Builds in this channel" section lists linked builds, each with an Unlink button. Below it, the "Builds to link" picker is a type-to-filter multi-select (type a build number or version); Link builds links every selected one.

Linking is **additive** — it can only raise what the channel serves, so it never asks for confirmation. You can also put a build into a channel at publish time, with `--channel <name>` or the Upload page's Channel field; see [Publishing](publish.md).

## Assign users

On the same page, the "Users in this channel" section lists assigned users with their next-check verdict, each with an Unassign button. The "Users to assign" picker (type an email) is also multi-select; Assign users adds every selected one. Assigning is additive and needs no confirmation.

You can also pick the first channel when creating a user — the Add user form has a Channel field. See [Add users](add-users.md).

## Pinning

A pin holds one user to one exact build. It lives on the user's page, in the Pin section: pick a build in the "Build to pin" picker and press Pin to build. **A pin overrides channels entirely** — while pinned, the user's channels are ignored, and Unpin restores normal channel flow.

Sparkle cannot downgrade, which shapes two cases:

- A pin below the build the user runs does not take effect through the updater. The feed still offers the pinned item; Sparkle discards anything lower than the installed version and reports up to date. A fresh install through the user's download link does serve the pinned build.
- A pin to a withdrawn build serves nothing: the user gets an empty feed and does not fall back to their channels. The user page flags this ("Pinned to a build that no longer resolves") with an Unpin action.

## The stranding guard

Any change that could leave a user with no servable build — withdrawing a build, unlinking it from a channel, unassigning a user, pinning, unpinning — is never silently blocked. When someone would be stranded, you get a confirmation page first. It names the action in plain words and **lists exactly which users** would be left with no available build; their apps will report up to date and receive nothing until a higher build reaches them. Confirm to proceed, or Cancel to return to the page you acted from.

The remedy for a stranded user is one of: publish a higher build into their channel, assign a different channel, or adjust the pin.

## Delete a channel

The Delete channel action sits in the danger zone at the bottom of the channel's page and is **always confirmed**, even when nobody is stranded. Deleting unassigns every user and unlinks every build; the users and builds themselves are kept. When the deletion would strand anyone, the confirmation page includes that list.

## Rollback

Moving everyone off a bad build is not a channel operation. Sparkle cannot downgrade, so it is a roll-forward done at publish time: rebuild the previous good code with a higher build number, publish it into the affected channel, then withdraw the bad build. See [Rollback](publish.md#rollback).

Next: [Publishing](publish.md)
