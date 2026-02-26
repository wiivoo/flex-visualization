# PROJ-9: Multi-Source Electricity Price Data

## Status: In Progress
## Created: 2026-02-22
## Dependencies: PROJ-1 (SMARD Data Integration)

## Description

Extension of the price data infrastructure to support multiple data sources for German electricity market prices. Instead of relying solely on SMARD, aWATTar (EPEX Spot) and Energy-Charts (Fraunhofer ISE) are now integrated as additional sources. The extended fallback chain ensures maximum data availability.

## Data Sources

| Source | Type | Auth | Details |
|--------|------|------|---------|
| aWATTar | Day-Ahead (EPEX) | None | Simple REST API, 100 queries/day |
| SMARD | Day-Ahead | None | Federal Network Agency, weekly chunks |
| Energy-Charts | Day-Ahead+ | None | Fraunhofer ISE, range support |
| CSV | DA + Intraday | Local | 2023-2030, hourly + 15-min |

### Extended Fallback Chain
```
Cache → aWATTar → SMARD → Energy-Charts → CSV → Demo
```

## User Stories

1. As a CEO, I want to see where the price data comes from (source badge)
2. As an analyst, I want to choose between day-ahead, intraday, and forward prices
3. As a system, data availability should be maximized through multiple sources

## Acceptance Criteria

- [ ] aWATTar API delivers day-ahead prices for current/historical days
- [ ] Energy-Charts API works as an additional fallback
- [ ] Source badge in the dashboard shows where data originates from
- [ ] Fallback chain triggers automatically on failures
- [ ] Batch endpoint uses range-capable APIs efficiently (one request instead of many)
- [ ] Price type selection (day-ahead/intraday/forward) in configuration

## Technical Details

### aWATTar API
```
GET https://api.awattar.de/v1/marketdata?start={unix_ms}&end={unix_ms}
Response: { data: [{ start_timestamp, end_timestamp, marketprice (EUR/MWh) }] }
```

### Energy-Charts API
```
GET https://api.energy-charts.info/price?bzn=DE-LU&start=YYYY-MM-DD&end=YYYY-MM-DD
Response: { unix_seconds: [...], price: [...] } (EUR/MWh)
```

### Files
| File | Action |
|------|--------|
| `src/lib/awattar.ts` | NEW |
| `src/lib/energy-charts.ts` | NEW |
| `src/app/api/prices/route.ts` | EDIT |
| `src/app/api/prices/batch/route.ts` | EDIT |
| `src/lib/price-cache.ts` | EDIT |
| `src/lib/config.ts` | EDIT |
| `src/app/page.tsx` | EDIT |

## QA Test Results

**Tested:** 2026-02-22
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)
**Build Status:** Production build succeeds without errors

### Acceptance Criteria Status

#### AC-1: aWATTar API delivers day-ahead prices for current/historical days
- [x] PASS -- `src/lib/awattar.ts` implements `fetchAwattarDayAhead()` and `fetchAwattarRange()`
- [x] PASS -- Live test: GET `/api/prices?type=day-ahead&date=2025-02-21` returned `"source":"awattar"` with 24 hourly data points
- [x] PASS -- EUR/MWh to ct/kWh conversion correct: `marketprice / 10` with 2-decimal rounding

#### AC-2: Energy-Charts API works as an additional fallback
- [x] PASS -- `src/lib/energy-charts.ts` implements `fetchEnergyChartsDayAhead()` and `fetchEnergyChartsRange()`
- [x] PASS -- Integrated in fallback chain position 3 (after aWATTar and SMARD)
- [x] PASS -- Handles null price values correctly (skips them)

#### AC-3: Source badge in the dashboard shows where data originates from
- [x] PASS -- `priceSource` state displayed as Badge component in chart header
- [x] PASS -- Shows "Quelle: awattar", "Quelle: smard", etc.

#### AC-4: Fallback chain triggers automatically on failures
- [x] PASS -- Fallback chain: aWATTar -> SMARD -> Energy-Charts -> CSV -> Demo
- [x] PASS -- Each source wrapped in try/catch, logs errors, returns null on failure
- [x] PASS -- Demo data generated as final fallback (tested by requesting future date)

#### AC-5: Batch endpoint uses range-capable APIs efficiently
- [x] PASS -- `src/app/api/prices/batch/route.ts` uses `fetchAwattarBatch()` with native range query
- [x] PASS -- Energy-Charts batch uses native range support
- [x] PASS -- SMARD batch loads weekly chunks in parallel via `Promise.allSettled`
- [x] PASS -- Zod validation on query parameters

#### AC-6: Price type selection (day-ahead/intraday/forward) in configuration
- [x] PASS -- `priceType` field exists in `ConfigState` interface
- [ ] PARTIAL -- QuickConfigPanel does not expose a price type selector in the UI (only in config type definition)

### Edge Cases Tested

#### EC-1: aWATTar rate limit (100/day)
- [x] Uses Next.js `revalidate: 3600` (1h cache) to reduce API calls
- [x] Batch uses single range request instead of per-day

#### EC-2: All external APIs down
- [x] Falls through to CSV, then demo data -- tested by code review

#### EC-3: XSS injection in date parameter
- [x] PASS -- Returns `{"error":"Invalid date format. Use YYYY-MM-DD"}` for `<script>alert(1)</script>`

#### EC-4: SQL injection in type parameter
- [x] PASS -- Returns `{"error":"Invalid type. Use day-ahead, intraday, or forward"}` for injected SQL

#### EC-5: Oversized batch range (>400 days)
- [x] PASS -- Returns `{"error":"Maximaler Zeitraum: 400 Tage"}` with 400 status

### Bugs Found

#### BUG-1: Price Type UI Selector Missing
- **Severity:** Low
- **Description:** The `ConfigState` includes `priceType` but no UI control exposes this in QuickConfigPanel or ConfigPanel
- **Location:** `src/components/config/QuickConfigPanel.tsx`
- **Impact:** Users cannot switch between day-ahead/intraday/forward from the UI
- **Steps to Reproduce:** Open config panel, look for price type selector -- it does not exist
- **Recommendation:** Add a price type dropdown to QuickConfigPanel
- **Priority:** Low (day-ahead is the primary use case)

#### BUG-2: No Input Size Limit on Price API Requests
- **Severity:** Medium
- **Description:** The `/api/optimize` endpoint accepts arbitrarily large `prices` arrays (tested with 10,000 entries, returned 200 OK)
- **Location:** `src/app/api/optimize/route.ts`
- **Impact:** Potential for resource exhaustion / DoS via large payloads
- **Steps to Reproduce:** POST to `/api/optimize` with 10,000 price entries
- **Recommendation:** Add Zod `.max(500)` constraint on the prices array
- **Priority:** Medium -- address before production

### Summary
- **Acceptance Criteria:** 5.5/6 passed (1 partial -- no price type UI selector)
- **Edge Cases:** 5/5 handled
- **Bugs Found:** 2 total (0 critical, 0 high, 1 medium, 1 low)
- **Security:** Input validation solid; DoS vector via large payloads
- **Production Ready:** YES (with medium bug addressed)
