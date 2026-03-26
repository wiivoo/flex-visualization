#!/bin/bash
#
# EPEX Intraday Scraper — Cron Wrapper with Retries
#
# Runs the scraper for yesterday + day before yesterday.
# Retries up to 3 times with increasing delays (2min, 5min, 10min)
# to handle EPEX WAF rate limiting.
#
# Crontab entry (run daily at 08:00 CET):
#   0 8 * * * /Users/lars/claude/projects/mmm/scripts/cron-epex-intraday.sh >> /Users/lars/claude/projects/mmm/logs/epex-scraper.log 2>&1
#

set -euo pipefail

PROJECT_DIR="/Users/lars/claude/projects/mmm"
LOG_DIR="$PROJECT_DIR/logs"
SCRIPT="$PROJECT_DIR/scripts/scrape-epex-intraday.mjs"
NODE="/opt/homebrew/bin/node"
MAX_RETRIES=3
DELAYS=(120 300 600) # seconds: 2min, 5min, 10min

# Ensure log directory exists
mkdir -p "$LOG_DIR"

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

# Run scraper with retries
attempt=0
while [ $attempt -lt $MAX_RETRIES ]; do
  attempt=$((attempt + 1))
  echo "Attempt $attempt/$MAX_RETRIES..."

  # Run the scraper (default: yesterday + day before)
  # cd into project dir so .env.local is found by process.cwd()
  output=$(cd "$PROJECT_DIR" && "$NODE" "$SCRIPT" 2>&1) || true
  echo "$output"

  # Check if it succeeded (look for "saved to Supabase" or "already cached")
  if echo "$output" | grep -qE "(saved to Supabase|already cached|Nothing to scrape)"; then
    echo "SUCCESS at $(date '+%H:%M:%S')"
    exit 0
  fi

  # Check if WAF blocked us
  if echo "$output" | grep -q "WAF CAPTCHA"; then
    if [ $attempt -lt $MAX_RETRIES ]; then
      delay=${DELAYS[$((attempt - 1))]}
      echo "WAF blocked. Waiting ${delay}s before retry..."
      sleep "$delay"
    fi
  else
    # Non-WAF error, don't retry
    echo "Non-WAF error, not retrying"
    break
  fi
done

echo "FAILED after $MAX_RETRIES attempts at $(date '+%H:%M:%S')"
exit 1
