# Codebase Concerns & Tech Debt

> Generated: 2026-03-26. Based on analysis of all active source files.

---

## 1. Large Files Needing Refactoring

### Step2ChargingScenario.tsx — CRITICAL (2,924 lines)

The single most urgent structural problem in the codebase. This file contains six distinct responsibilities that have accumulated across PROJ-12, 17, 19, 22, 27, 28:

- **Customer Profile sidebar** (sliders, V1G/V2G toggle, vehicle presets) — lines ~1160–1700
- **Chart rendering** (Recharts ComposedChart, custom x-tick renderer, drag handles, ReferenceAreas) — lines ~700–1160
- **Core optimization logic** (chart data build, baseline/optimized key sets, V2G slot assignment, intraday ID3 re-optimization) — lines ~235–460
- **Rolling statistics** (365-day scan, per-mode savings, weekday/weekend split) — lines ~466–670
- **Heatmap data derivation** (prefix-sum O(1) lookups, mileage×plugIns grid) — lines ~970–1011
- **Yearly/monthly/quarterly rollups** — lines ~905–968, 1013–1063

Suggested split (all are already `useMemo`/computation blocks that can be extracted):
- `src/lib/use-rolling-savings.ts` — the 365-day rolling scan hook (~200 lines)
- `src/lib/use-chart-data.ts` — chart data builder + intraday ID3 re-optimization
- `src/components/v2/CustomerProfileSidebar.tsx` — the left sidebar Card
- `src/components/v2/ChargingChart.tsx` — Recharts chart + drag logic

The `useMemo` dependency arrays are already very long (17–20 deps) which is a signal that these blocks belong in dedicated hooks.

### Other Large Files

- `src/components/v2/SpreadIndicatorsCard.tsx` — 539 lines; no immediate risk but approaching limit
- `src/components/v2/TheoryOverlay.tsx` — 511 lines; pure JSX, low risk
- `src/components/v2/TutorialOverlay.tsx` — 371 lines; acceptable
- `src/lib/use-prices.ts` — 587 lines; well-structured but the incremental fetch and generation logic could be separated hooks

---

## 2. Complex Data Flows That Could Break

### Incremental Price Fetch Race Condition (`use-prices.ts`)

`loadData()` fires `fetchIncremental` and `fetchIncrementalQH` as fire-and-forget calls (no `await`). Both callbacks close over `existingPrices`/`existingQH` from the time `loadData` runs. If `loadData` is re-triggered (country switch), the closures from the previous run still hold stale array references and can write to state after the reset. The `fetchedCountry` ref guard prevents duplicate triggers for the same country but does not cancel in-flight requests from a prior `loadData`.

**Fix needed:** Use an `AbortController` per `loadData` invocation, pass the signal to fetch calls inside `fetchIncremental` and `fetchIncrementalQH`, and abort on the next `loadData`.

### Intraday ID3 Fetch (`use-prices.ts` lines 520–553)

This `useEffect` does use an `AbortController`, which is correct. However, it silently swallows all errors (`catch(() => setIntradayId3([]))`), including network timeouts. A SMARD scraper outage will silently disable the intraday overlay with no user-visible indication.

### `forecastStart` Determination (`batch/route.ts` lines 476–506)

Every request with `endDate` in the future makes two calls to `fetchEnergyForecast` — one for HOURLY and one for QUARTER_HOURLY resolution. These are separate HTTP requests with no shared result, and the 50 req/day rate limit from EnergyForecast.de can be hit quickly during development or if caching fails. The `next: { revalidate: 3600 }` is on the fetch inside `fetchEnergyForecast`, but Next.js route handlers running in Vercel serverless functions do not use the Data Cache by default for internal `fetch` calls — this needs verification.

### Fallback Chain Sequential Failures (`fetchHourlyChain`)

The fallback chain in `batch/route.ts` is sequential: aWATTar → ENTSO-E → SMARD → Energy-Charts → CSV → demo. If aWATTar is slow but eventually succeeds, all subsequent sources are skipped even if aWATTar returned incomplete data. There is no minimum-record validation between fallback steps — a 404 that returns an empty but valid JSON array would satisfy `prices?.length` as falsy and fall through, but a malformed response would throw and be caught, also falling through. This is acceptable behavior but should be noted.

### SMARD Source Mislabeled as ENTSO-E (`batch/route.ts` line 322)

When ENTSO-E is the data source, the result is tagged `source: 'smard' as const`. This mislabeling propagates to the Supabase cache and the response `source` field. It is cosmetic but can confuse debugging.

---

## 3. Missing Error Handling

### `use-prices.ts` — Generation API

`fetchLiveGeneration` swallows all errors silently (`catch(() => {/* keep existing data */})`). If the generation API is down for an extended period, users see no message and may think generation data is simply not available.

### `batch/route.ts` — Cache Write Failure

Cache write failures are caught and logged (`console.error`) but the response still returns 200. This is correct behavior (non-fatal). However, a persistent Supabase connection failure will cause every future request to re-fetch from external sources, potentially hitting rate limits on aWATTar (100 req/day) and EnergyForecast.de (50 req/day).

### `csv-prices.ts` — Silent Throw

`fetchCsvPrices` logs and re-throws. The caller in `fetchCsvBatch` catches and skips silently. No log is emitted when CSV files are absent in production (Vercel). If CSV files are the only fallback for historical gaps and were never deployed, the app falls silently to demo data. This is acceptable but not observable.

### `energy-forecast.ts` — `fetchForecastOnly` is Dead Code

`fetchForecastOnly` is exported but never called anywhere in the codebase. It is not imported by any file other than its own module. It should be removed.

---

## 4. Security Considerations

### `ENERGY_FORECAST_TOKEN` Exposed in Query String

In `energy-forecast.ts` (lines 36 and 79):
```
const url = `...?token=${token}&market_zone=DE-LU...`
```
The API token is placed in the URL query string. This is only ever called server-side (in API route handlers), so it does not reach the browser — the risk is limited to server logs, proxy access logs, and Vercel function logs. The EnergyForecast.de API may not support Authorization header authentication. Regardless, this should be documented as a known risk.

### `NEXT_PUBLIC_SUPABASE_ANON_KEY` Is Browser-Visible

The Supabase anon key is prefixed `NEXT_PUBLIC_` and is therefore embedded in the client-side bundle. This is normal for Supabase — the anon key is intentionally public and Row Level Security is the actual access control layer. No RLS policies are visible in this repository audit; their presence should be verified in the Supabase dashboard.

### Batch API Has No Authentication

`GET /api/prices/batch` is unauthenticated. Any internet user who knows the URL can trigger external API calls (aWATTar, ENTSO-E, EnergyForecast.de) that consume rate-limited quotas. The password protection middleware likely covers `/v2` page routes but not API routes — verify `middleware.ts` matcher config.

### Date Range Limit

The 400-day maximum (`differenceInDays > 400`) guards against runaway SMARD chunk fetches. The country schema only allows `DE | NL` — this correctly constrains ENTSO-E domain lookup.

---

## 5. Performance Concerns

### Initial Bundle Size

`Step2ChargingScenario.tsx` is a single `'use client'` component importing Recharts (`ComposedChart`, `Line`, `Area`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`, `ResponsiveContainer`, `ReferenceLine`, `ReferenceArea`). Recharts is ~300 KB minified. The component is not lazy-loaded. If the v2 page is the app entry point, this adds to initial load. A `dynamic(() => import(...), { ssr: false })` wrapper would defer it.

### Three Overlapping 365-Day Scans

`Step2ChargingScenario.tsx` contains three separate `useMemo` blocks that each iterate over up to 365 days of hourly prices (~8,760 points):

1. `rollingAvgSavings / dailySavingsMap` (line 469) — one pass per date
2. `perModeSavings` (line 556) — three mode passes per date
3. `overnightWindows` (line 821) — one pass per date with prefix sums

These three memos have partially overlapping dependency arrays, so they do not share computation. Extracting them into a single shared hook that builds the `byDate` map once and runs all three rollups in a single pass would reduce work by roughly 5×. The `overnightWindows` memo is then reused downstream by `monthlySavingsData`, `heatmapData`, and `yearlySavingsData` — this part is already well-optimized.

### `Math.min(...allPrices)` Spread on Large Arrays

`priceRange` useMemo (line 1065) calls `Math.min(...allPrices)` and `Math.max(...allPrices)` using spread syntax on an array that can be ~100 items (chart window). Not a problem at current sizes, but worth noting for future multi-day chart windows.

### Public Static JSON Files

`/public/data/smard-prices.json` and `smard-prices-qh.json` are fetched on every page load. No `ETag` or `If-None-Match` handling is present in `use-prices.ts`. If the files are large (months of historical data), repeat visits will re-download the full JSON even if unchanged. Next.js's static file serving adds `Cache-Control: public, max-age=0` by default — increasing this or using `Last-Modified` would help on repeat visits.

---

## 6. Tech Debt — Archived Code

`src/_archive/` contains: `app/`, `components/`, `docs/`, `hooks/`, `lib/`, `scripts/`. The archive is excluded from builds via tsconfig `paths` (verify this is a path alias exclusion and not just a folder convention). The presence of old hooks and lib files in `_archive/lib/` creates risk if a new developer imports from them accidentally. The archive has grown to a full mirror of the `src/` structure.

**Recommendation:** Delete the archive entirely or move it outside `src/` to a top-level `_archive/` directory. Document in `features/INDEX.md` that the old v1 code is preserved in git history (tag `v1-archive`).

---

## 7. Missing Tests

There are zero test files in the repository (no `tests/`, `__tests__/`, or `*.test.ts` files anywhere). The following units have enough pure logic to be tested with no mocking:

| Function | File | Priority |
|---|---|---|
| `runOptimization` | `lib/optimizer.ts` | HIGH — financial calculations |
| `computeV2gWindowSavings` | `lib/charging-helpers.ts` | HIGH — complex V2G logic |
| `computeWindowSavings` | `lib/charging-helpers.ts` | HIGH — baseline savings |
| `deriveDailySummaries` | `lib/use-prices.ts` | MEDIUM |
| `deriveMonthlyStats` | `lib/use-prices.ts` | MEDIUM |
| `buildOvernightWindows` | `lib/charging-helpers.ts` | MEDIUM |
| `generateDemoBatchPrices` | `batch/route.ts` | LOW — deterministic seeded output |

A regression in `runOptimization` (e.g., dividing by zero when `energy_needed_kwh = 0`) would silently return wrong financial figures to the UI. The existing `energy_needed_kwh <= 0` guard is correct, but edge cases like `intervals_needed > pricesWithTime.length` (insufficient price data for full charge) could produce `NaN` savings.

---

## 8. Accessibility Gaps

- **Chart drag handles** (`div` elements with `onMouseDown`/`onTouchStart`) have no `role`, `tabIndex`, or keyboard event handlers. Users navigating by keyboard cannot move the arrival/departure handles.
- **The Recharts chart area** has no `aria-label` or `role="img"` fallback for screen readers.
- **Color-only encoding:** The baseline (gray fill) vs. optimized (green fill) charging slots are distinguished only by color. No pattern, label, or `aria-describedby` text is provided for users with color vision deficiency.
- **Sliders in the sidebar** do have `aria-label` attributes (lines 1205, 1250, 1277, 1304) — this is good.
- **The MiniCalendar date cells** are rendered as `div` elements with `onClick` rather than `button` elements, missing keyboard focus/activation behavior.
- **V1G/V2G toggle buttons** at the top of the Customer Profile card use `button` elements correctly.

---

## 9. Dead Code / Unused Exports

| Symbol | File | Status |
|---|---|---|
| `fetchForecastOnly` | `lib/energy-forecast.ts` | Never imported. Dead export. |
| `fetchEnergyChartsDayAhead` | `lib/energy-charts.ts` | Never imported (only `fetchEnergyChartsRange` is used). |
| `fetchAwattarDayAhead` | `lib/awattar.ts` | Never imported (only `fetchAwattarRange` is used). |
| `fetchSmardDayAhead` | `lib/smard.ts` | Never imported in batch route or anywhere. |
| `hasCsvData` | `lib/csv-prices.ts` | Never imported. |
| `SMARD_RESOLUTION` const | `lib/smard.ts` | Not used by any caller (batch route uses string literals). |
| `projected-prices.json` | `public/data/` | File exists but no reference found in source code. |

The four `*DayAhead` functions are v1-era single-day fetch APIs replaced by the `*Range` variants used in the batch route.

---

## 10. Data Fallback Chain Reliability

The fallback chain for DE hourly prices is: aWATTar → ENTSO-E → SMARD → Energy-Charts → CSV → demo.

**Reliability risks:**

- **aWATTar (~3 days history):** Only covers the very recent window. For historical date ranges it will return empty data and fall through immediately. This is expected but adds latency because the fetch still runs.
- **ENTSO-E (full historical):** Requires `ENTSOE_API_TOKEN` env var. If the token is missing or expired, `fetchEntsoeRange` throws, is caught, and falls through to SMARD silently. No alert is raised.
- **EnergyForecast.de (50 req/day limit):** Called on every request that touches a future date. If the limit is hit, `fetchEnergyForecast` throws `"EnergyForecast API failed: 429"`, is caught with `console.error`, and `forecastStart` stays `null`. The response is returned without forecast extension. Users see a chart that stops at the last real price with no explanation.
- **SMARD (weekly chunks):** Stable and well-tested. The main risk is delayed publication — SMARD sometimes publishes D+1 prices hours after EPEX closes (~12:15 CET). During this window the batch route returns today's prices as demo data.
- **CSV fallback:** The `CSVs/` directory is at `process.cwd()/CSVs/` which resolves correctly in local dev but is unlikely to be deployed to Vercel. If CSV files are absent, the step silently returns empty and falls to demo. This means the CSV fallback is effectively non-functional in production.
- **Demo data:** Always available. Clearly seeded and deterministic, but prices are fabricated. There is no visual indicator in the UI that a chart is showing demo data vs. real prices. Adding a banner when `source === 'demo'` would prevent user confusion.

**Static JSON as primary DE source:** The actual primary path for the DE dashboard is the pre-downloaded `smard-prices.json` served as a static file, not the batch API fallback chain. The batch API is only used for incremental updates (last few days). This is the correct and reliable design — the fallback chain only fires for the delta.
