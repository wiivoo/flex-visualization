#!/bin/bash
#
# EPEX Intraday Scraper — Cron Wrapper with Retries
#
# Runs the scraper for yesterday + day before yesterday.
# Retries up to 3 times with increasing delays (2min, 5min, 10min)
# to handle EPEX WAF rate limiting.
#
# Crontab entry (run daily at 08:00 CET). The script self-manages its log file,
# so the `>>` redirect in the crontab line is optional (it is still harmless).
#   0 8 * * * /Users/lars/claude/projects/mmm/scripts/cron-epex-intraday.sh
#

set -euo pipefail

PROJECT_DIR="/Users/lars/claude/projects/mmm"
LOG_DIR="$PROJECT_DIR/logs"
LOG_FILE="$LOG_DIR/epex-scraper.log"
SCRIPT="$PROJECT_DIR/scripts/scrape-epex-intraday.mjs"
NODE="/opt/homebrew/bin/node"
MAX_RETRIES=3
DELAYS=(120 300 600) # seconds: 2min, 5min, 10min
LOG_MAX_BYTES=10485760 # rotate at 10 MB
LOG_KEEP=30            # keep up to 30 rotated files

# Ensure log directory exists
mkdir -p "$LOG_DIR"

# Rotate log before redirect so rotation isn't defeated by an open fd
if [ -f "$LOG_FILE" ] && [ "$(wc -c < "$LOG_FILE")" -gt "$LOG_MAX_BYTES" ]; then
  mv "$LOG_FILE" "$LOG_FILE.$(date +%Y%m%d-%H%M%S)"
fi
# Prune old rotations
ls -1t "$LOG_FILE".* 2>/dev/null | tail -n +$((LOG_KEEP + 1)) | xargs -I{} rm -f {} 2>/dev/null || true

# Redirect all subsequent output to the log file so cron doesn't need to
exec >> "$LOG_FILE" 2>&1

echo ""
echo "===== EPEX Intraday Scraper — $(date '+%Y-%m-%d %H:%M:%S') ====="

# Check node is available
if [ ! -x "$NODE" ]; then
  NODE=$(which node 2>/dev/null || true)
  if [ -z "$NODE" ]; then
    echo "ERROR: node not found"
    exit 1
  fi
fi

# Change to project dir so .env.local is found by process.cwd()
cd "$PROJECT_DIR"

# Load .env.local into shell environment as fallback
if [ -f "$PROJECT_DIR/.env.local" ]; then
  set -a
  . "$PROJECT_DIR/.env.local"
  set +a
fi

run_scraper() {
  local area="${1:-}"
  local label="${area:-DE}"
  local area_flag=""
  [ -n "$area" ] && area_flag="--area $area"

  echo ""
  echo "--- $label intraday ---"

  attempt=0
  while [ $attempt -lt $MAX_RETRIES ]; do
    attempt=$((attempt + 1))
    echo "Attempt $attempt/$MAX_RETRIES..."

    output=$("$NODE" "$SCRIPT" $area_flag 2>&1) || true
    echo "$output"

    if echo "$output" | grep -qE "(saved to Supabase|already cached|Nothing to scrape)"; then
      echo "$label SUCCESS at $(date '+%H:%M:%S')"
      return 0
    fi

    if echo "$output" | grep -q "WAF CAPTCHA"; then
      if [ $attempt -lt $MAX_RETRIES ]; then
        delay=${DELAYS[$((attempt - 1))]}
        echo "WAF blocked. Waiting ${delay}s before retry..."
        sleep "$delay"
      fi
    elif echo "$output" | grep -qE "(page load (timeout|failed)|Timeout [0-9]+ms exceeded|no data rows found)"; then
      # Transient failures (network timeout, EPEX page not ready) — retry with short delay
      if [ $attempt -lt $MAX_RETRIES ]; then
        delay=60
        echo "Transient error (timeout/no rows). Waiting ${delay}s before retry..."
        sleep "$delay"
      fi
    else
      echo "Non-retryable error, stopping"
      break
    fi
  done

  echo "$label FAILED after $MAX_RETRIES attempts at $(date '+%H:%M:%S')"
  return 1
}

# Scrape DE then NL (with gap to avoid WAF)
run_scraper "" || true
sleep 10
run_scraper "NL" || true

echo ""
echo "===== Done at $(date '+%H:%M:%S') ====="
