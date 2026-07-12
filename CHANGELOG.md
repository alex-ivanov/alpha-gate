# Changelog

Notable changes to Alpha Gate (the tool). The deployed instance's daily self-update check compares
its `TOOL_VERSION` against `release.json`'s `latest`; the dashboard/Settings link here for notes.
Keep `latest` in `release.json` in sync with `VERSION` on every release.

## 0.1.0

- **Back office redesign** ("quiet instrument"): the serving map makes the resolver visible; the
  Users list answers "what does each tester get next?"; confirm-name-and-return feedback loop;
  reversible revoke (Reactivate); searchable comboboxes; light/system/dark theme toggle.
- **Publishing simplified to one command**: `./publish.sh <artifact>` handles `.dmg` and signed
  `.app.zip`, links channels by name, auto-picks the instance, pre-checks the build number, and
  handles the >90 MB register path itself. (`publish-dmg.sh` and `ci-publish.sh` removed.)
- **Storage lifecycle**: per-build size + bucket total on the Builds page; purge a withdrawn build's
  archive to reclaim R2 space (the record is kept).
- **Deploy**: remembers email/Access inputs across re-runs (no silent revert); derives the Access
  team domain from the enablement redirect; reason-bearing admin 403; real `--help`.
- **Security**: service tokens are scoped to the publish surface only (decision 0006 enforced).
