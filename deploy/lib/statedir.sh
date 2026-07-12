#!/usr/bin/env bash
# Resolve where per-instance deploy state lives — the bash mirror of src/deploy/core/paths.ts, so the
# publish/backup/dev scripts read the same `.deploy` the CLI wrote. Source it, then call
# alpha_gate_state_dir <package-root>. Order: $ALPHA_GATE_HOME > (<root>/.git present ? <root>/.deploy
# : ~/.alpha-gate).
alpha_gate_state_dir() {
  local root="$1"
  if [ -n "${ALPHA_GATE_HOME:-}" ]; then printf '%s' "${ALPHA_GATE_HOME}"; return; fi
  if [ -d "${root}/.git" ]; then printf '%s/.deploy' "${root}"; return; fi
  printf '%s/.alpha-gate' "${HOME:-.}"
}
