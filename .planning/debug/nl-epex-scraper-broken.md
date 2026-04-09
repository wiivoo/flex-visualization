---
status: resolved
trigger: "NL price data not showing on the dashboard. User sees data for DE but not for NL for yesterday. Was working recently but broke."
created: 2026-04-08T00:00:00Z
updated: 2026-04-08T09:00:00Z
---

## Resolution

### Root Causes Found & Fixed

**1. EPEX Intraday Scraper — NL Column Count Mismatch**
CSS selectors assumed DE's 10-column layout. NL uses different column counts.
- Fix: 3 fallback CSS selectors, lenient `extractQH` (5+ cells), diagnostic logging
- File: `scripts/scrape-epex-intraday.mjs`

**2. Cron Script — No Retry on Transient Errors**
Timeouts and "no data rows" aborted immediately instead of retrying.
- Fix: 60s retry delay for timeout/no-rows errors (same loop as WAF)
- File: `scripts/cron-epex-intraday.sh`

**3. Corrupt NL Day-Ahead Cache — No Quality Validation**
Partial ENTSO-E data cached with infinite TTL, served corrupt data forever.
- Fix: Quality gates on read (skip <20 unique timestamps) and write (don't cache incomplete days)
- File: `src/app/api/prices/batch/route.ts`

**4. Cache Cleanup**
Deleted 6 corrupt `nl:day-ahead` entries (Mar 27, 30, 31, Apr 1, 2, 7).

### Verification
- NL day-ahead April 7: 96 entries, 96 unique timestamps, all 24 hours ✓
- NL ID3 intraday April 7: 96 entries, 96 valid prices ✓
- Previously corrupt dates (Mar 30-Apr 2): All returning 95-96 valid entries ✓
- Build passes ✓
