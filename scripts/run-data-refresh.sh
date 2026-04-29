#!/bin/sh
set -eu

cd /app

log_step() {
  printf '\n[%s] %s\n' "refresh-data" "$1"
}

warn_step() {
  printf '\n[%s] WARNING: %s\n' "refresh-data" "$1" >&2
}

run_optional() {
  label="$1"
  shift
  if "$@"; then
    return 0
  fi
  warn_step "$label failed; continuing because this path is non-fatal."
}

log_step "Download latest SMARD data (DE)"
SMARD_USE_AWATTAR=0 node scripts/download-smard.mjs

log_step "Update NL prices (ENTSO-E)"
node scripts/update-nl.mjs

log_step "Smoke test refreshed DE/NL artifacts"
node scripts/smoke-refresh-data.mjs

log_step "Precompute management monthly aggregates"
node scripts/precompute-management-monthly.mjs
