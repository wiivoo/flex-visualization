# PROJ-30: NL (Netherlands) Country Support

**Status:** Deployed
**Priority:** High

## Summary

Full parity for Netherlands day-ahead prices alongside Germany. Users can switch between DE and NL via a country toggle in the dashboard header.

## Data Pipeline

### Static Files (instant paint)
- `public/data/nl-prices.json` — hourly prices (EUR/MWh), ~37k points from 2022-01-01
- `public/data/nl-prices-qh.json` — quarter-hourly prices, ~148k points

### Incremental Fetch (bridge to today)
- `use-prices.ts` passes `country` param to `fetchIncremental` / `fetchIncrementalQH`
- Batch API route detects `country=NL` → uses ENTSO-E Transparency Platform instead of SMARD/aWATTar

### ENTSO-E Integration
- Domain: `10YNL----------L` (NL bidding zone)
- Document type: A44 (day-ahead prices)
- Handles both PT60M (hourly) and PT15M (quarter-hourly) resolutions
- NL transitioned to QH around Oct 2025

### Scripts
- `scripts/download-nl.mjs` — full historical download (20-day chunks, retry logic)
- `scripts/update-nl.mjs` — daily incremental update (2-day overlap for late ENTSO-E updates)

### GitHub Actions
- `.github/workflows/update-smard-data.yml` — runs NL update alongside DE daily at 13:30 UTC
- Requires `ENTSOE_API_TOKEN` GitHub secret

## Fallback Behavior
- If NL data fails to load, dashboard auto-reverts to DE (`V2Page useEffect`)
- Non-DE countries do not get demo/fallback data

## Key Files
- `src/lib/use-prices.ts` — country-aware incremental fetch
- `src/app/api/prices/batch/route.ts` — ENTSO-E fetch for non-DE countries
- `scripts/download-nl.mjs`, `scripts/update-nl.mjs`
- `public/data/nl-prices.json`, `public/data/nl-prices-qh.json`
