# Codebase Concerns

**Analysis Date:** 2026-04-07

## Tech Debt

### [CRITICAL] Step2ChargingScenario — 3,608-line God Component

- Issue: Single component file handles chart rendering, drag interactions, edge-scroll navigation, V2G logic, fleet flex band, intraday ID3 overlays, renewable overlays, cost calculations, and all UI controls. At 3,608 lines it is 7x the project's own 500-line guideline. Contains 40 `useMemo`/`useCallback`/`useDeferredValue` calls.
- Files: `src/components/v2/steps/Step2ChargingScenario.tsx`
- Impact: Every feature addition (fleet, V2G, intraday, 3-day mode) increases cognitive load and merge conflict risk. The single `useMemo` that builds chart data (lines 251-475) is ~225 lines of dense logic with a 22-element dependency array. Any dependency change recomputes everything.
- Fix approach: Extract into focused modules:
  1. `src/lib/use-chart-data.ts` — the big useMemo building chart points, baseline/optimized keys, V2G slots, intraday re-optimization (lines 251-475)
  2. `src/lib/use-overnight-windows.ts` — overnight window computation + rolling savings (lines 500-770)
  3. `src/components/v2/ChartRenderer.tsx` — Recharts ComposedChart JSX, drag handles, edge-scroll (lines 900-1200)
  4. `src/components/v2/ScenarioControls.tsx` — sliders, toggles, mode selectors, customer profile sidebar (lines 1200-1600)
  5. `src/components/v2/FleetSection.tsx` — fleet flex band UI (lines 1600-1800)

### [HIGH] Duplicate Page Logic Across Dynamic Pages

- Issue: Three large page files contain duplicated price-fetching, chart rendering, and savings computation logic.
- Files: `src/app/dynamic/page.tsx` (1,572 lines), `src/app/dynamic/nl/page.tsx` (1,191 lines), `src/app/dynamic/analysis/page.tsx` (1,822 lines)
- Impact: Bug fixes must be applied in 3 places. Features diverge between pages silently.
- Fix approach: Extract shared hooks (`useDynamicPrices`, `useDynamicSavings`) and shared chart components. NL page should be a config variant of DE page, not a copy.

### [MEDIUM] Excel Export — Dual Library Dependency

- Issue: The export module uses both `xlsx` (SheetJS, 7.2MB) for the basic export and `exceljs` (22MB) for the enhanced export with styling/formulas. Two libraries serving the same purpose.
- Files: `src/lib/excel-export.ts` (832 lines)
- Impact: Bundle size inflation. Maintenance burden of two different APIs (`XLSX.utils.aoa_to_sheet` vs `wb.addWorksheet`). Multiple `eslint-disable @typescript-eslint/no-explicit-any` suppressions for ExcelJS typing gaps. `xlsx@0.18.5` is the last open-source version (2022) with no security patches.
- Fix approach: Migrate the basic export (`generateAndDownloadExcel`) to ExcelJS, then remove `xlsx` dependency entirely.

### [MEDIUM] Pervasive eslint-disable Comments (20+ instances)

- Issue: `react-hooks/exhaustive-deps` suppressed 12 times, `@typescript-eslint/no-explicit-any` suppressed 5 times across the codebase.
- Files: `src/components/v2/steps/Step2ChargingScenario.tsx` (5), `src/lib/use-prices.ts` (3), `src/lib/excel-export.ts` (3), `src/app/dynamic/*.tsx` (5), `src/app/v2/page.tsx` (2)
- Impact: Suppressed `exhaustive-deps` warnings may hide stale closure bugs. The `fetchIncremental`/`fetchIncrementalQH` callbacks in `use-prices.ts` disable exhaustive-deps to avoid re-fetch loops but closures may capture stale state.
- Fix approach: Refactor callbacks to use `useRef` for mutable state access (pattern already used for `selectedDateRef`/`sortedDatesRef`). Use `AbortController` per `loadData` invocation to cancel in-flight requests on re-trigger.

## Known Bugs

### [LOW] Date Math Edge Case in use-prices.ts

- Symptoms: Line 334 calculates yesterday using `getDate() - 1` which produces day 0 (invalid) on the 1st of any month.
- Files: `src/lib/use-prices.ts` (line 334)
- Trigger: User visits the dashboard on the 1st of any month.
- Workaround: The `todayStr()` helper and other date functions use the safe `T12:00:00Z` anchor pattern but this one instance does not. The fallback `dailySummaries.filter(d => d.date <= yest).pop()` likely catches invalid dates.

## Security Considerations

### [MEDIUM] Middleware is a No-Op — No Route Protection

- Risk: `src/middleware.ts` passes all requests through with `matcher: []`. Auth is enforced only at the `/api/auth` route level. Any new API route added without explicit auth checking is unprotected by default.
- Files: `src/middleware.ts`
- Current mitigation: Single shared password with JWT session cookie (`flexmon-session`, 24h expiry, HS256 via `jose`).
- Recommendations: Add middleware matching for `/api/*` routes that need auth. Add rate limiting on `/api/auth`. The batch API (`/api/prices/batch`) is fully unauthenticated — any user can trigger external API calls consuming rate-limited quotas (aWATTar 100 req/day, EnergyForecast.de 50 req/day).

### [MEDIUM] EPEX Scraper Uses Anon Key for Writes

- Risk: `scripts/scrape-epex-intraday.mjs` loads `NEXT_PUBLIC_SUPABASE_ANON_KEY` and uses it to upsert into `price_cache`. If RLS write policies are missing, the anon key could allow unintended data modification.
- Files: `scripts/scrape-epex-intraday.mjs` (lines 38-43)
- Current mitigation: Unknown — no RLS policies visible in repository.
- Recommendations: Use a Supabase service role key for server-side write operations. Verify RLS policies on `price_cache` table in Supabase dashboard.

### [LOW] Supabase Anon Key in Client Bundle

- Risk: `NEXT_PUBLIC_SUPABASE_ANON_KEY` is embedded in the client bundle (by design). This is standard Supabase architecture but RLS must be properly configured.
- Files: Client-side Supabase initialization
- Recommendations: Verify RLS policies exist for all tables. Document expected RLS configuration.

## Performance Bottlenecks

### [HIGH] Heavy useMemo Chains in Step2

- Problem: The primary chart data memo (lines 251-475) rebuilds ~200+ chart points with V2G, intraday, fleet, and renewable overlays on any of 22 dependency changes. Three additional memos (overnight windows, yearly savings, fleet optimization) cascade from this. `useDeferredValue` is used for scenario params during drag but deferred values still trigger full recomputation when they settle.
- Files: `src/components/v2/steps/Step2ChargingScenario.tsx`
- Cause: All computation is co-located in one component with no separation between chart-critical and background calculations.
- Improvement path:
  1. Extract yearly/monthly aggregation to Web Workers (these are pure functions operating on arrays of 365+ windows)
  2. Split chart data memo into: window prices (changes on date nav) + slot assignments (changes on scenario edit)
  3. Move overnight window building into `use-prices.ts` where the raw data lives

### [MEDIUM] plugInDays Array Identity Workaround

- Problem: `effectivePlugInDays(scenario)` returns a new array reference on every call. The component stabilizes via `useMemo` + `plugInDaysKey = deferredPlugInDays.join(',')` for downstream dependencies.
- Files: `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 209-212)
- Cause: Array identity instability; stringification workaround is fragile and non-obvious.
- Improvement path: Return a stable reference from `effectivePlugInDays` using module-level memoization, or use a custom `useStableArray` hook.

### [MEDIUM] Bundle Size — Recharts + ExcelJS

- Problem: Recharts (8MB node_modules), ExcelJS (22MB), xlsx (7.2MB). ExcelJS is dynamically imported but Recharts is statically imported in Step2 and other chart components. No evidence of bundle analysis tooling.
- Files: `package.json`, `src/components/v2/steps/Step2ChargingScenario.tsx`
- Improvement path: Run `@next/bundle-analyzer` to measure actual client impact. Consider `next/dynamic` with `ssr: false` for chart components. Verify ExcelJS dynamic import does not leak into initial bundle.

### [LOW] No Lazy Loading for Chart Components

- Problem: No `dynamic()` or `React.lazy()` usage detected anywhere in the codebase. All components are eagerly loaded.
- Files: All component imports in page files
- Improvement path: Wrap `Step2ChargingScenario` and other heavy chart components in `next/dynamic({ ssr: false })`.

## Fragile Areas

### [CRITICAL] EPEX Intraday Scraper

- Files: `scripts/scrape-epex-intraday.mjs` (317 lines)
- Why fragile:
  1. **WAF blocking**: EPEX detects Playwright automation and shows CAPTCHA ("Human Verification" page). The scraper detects this (line 81) but cannot bypass it. Has broken in production.
  2. **CSS selector dependency**: Relies on `table.table-01 tr[class^="child-"]` for data extraction (line 105). Any EPEX website redesign breaks extraction silently. Fallback selector `tr` with 10 `td` cells (line 110) is equally fragile.
  3. **Fixed table structure**: Assumes exactly 7 rows per hour (168 rows/day) with QH data at offsets `[2, 3, 5, 6]` (line 59). If EPEX changes row layout, extracted data is silently corrupt.
  4. **Hard-coded waits**: Uses `page.waitForTimeout(10000)` (line 77) instead of element-based waits. Too short = empty data; too long = timeout.
  5. **Playwright as production dep**: Listed in `dependencies` (not `devDependencies`), inflating production install by ~150MB+.
- Safe modification: Always run with `--dry-run` first. Do not change selector patterns without testing against live EPEX site.
- Test coverage: Zero automated tests.

### [HIGH] SMARD Data Pipeline

- Files: `.github/workflows/update-smard-data.yml`, `src/lib/smard.ts`, `src/lib/use-prices.ts`
- Why fragile:
  1. **~2 day publication delay**: SMARD publishes with lag. App bridges via incremental API fetch but gap can cause missing data for recent dates.
  2. **Forecast blending**: Future prices from EnergyForecast.de are marked `isProjected` but visually similar to real data. Users may not notice the distinction.
  3. **Silent CI failure**: GitHub Actions cron (13:30 UTC daily) commits updated JSON. If it fails silently, static data goes stale with no alerting.
  4. **Incremental fetch race condition**: `fetchIncremental` and `fetchIncrementalQH` are fire-and-forget from `loadData()`. On rapid country switches, stale closures can write wrong data to state.
- Safe modification: Test with dates near the static/incremental boundary. Verify `fetchedCountry` guard works for rapid switches.
- Test coverage: `tests/savings-math.test.ts` uses synthetic data only — no integration tests for SMARD API responses.

### [MEDIUM] Supabase Cache Layer

- Files: `src/app/api/prices/batch/route.ts` (536 lines)
- Why fragile: Cache TTL logic is embedded in application code with varying durations by date age. Cache key format `(date, type)` with country prefix (e.g., `nl:day-ahead`). If Supabase is unreachable, the fallback chain activates but with potential data gaps. The CSV fallback step uses `process.cwd()/CSVs/` which is unlikely to exist on Vercel, making it effectively non-functional in production.
- Test coverage: None.

## Dependencies at Risk

### [MEDIUM] xlsx (SheetJS) — Abandoned Open Source Version

- Risk: `xlsx@0.18.5` is the last open-source version (2022). Newer versions are proprietary (SheetJS Pro). No security patches or updates.
- Impact: Potential compatibility issues with future Node.js/bundler versions.
- Migration plan: Already partially migrated to ExcelJS for enhanced export. Complete migration and remove `xlsx`.

### [LOW] Playwright in Production Dependencies

- Risk: `playwright@^1.58.2` in `dependencies` rather than `devDependencies`. Only used by EPEX scraper script, not the web app.
- Impact: Inflates production `npm install` by ~150MB+ (Chromium binaries).
- Migration plan: Move to `devDependencies` or separate `scripts/package.json`.

## Missing Critical Features

### [MEDIUM] No Error Monitoring

- Problem: No error tracking (Sentry, LogRocket, etc.). Client errors, API failures, and scraper breakdowns are only visible via console logs.
- Blocks: Cannot detect when EPEX scraper breaks, SMARD API changes format, or EnergyForecast.de rate limit is hit.

### [MEDIUM] No Data Staleness Detection

- Problem: No mechanism to detect or alert when static JSON data (`public/data/smard-*.json`) is more than N days old. No health check endpoint.
- Blocks: Cannot set up uptime monitoring. If GitHub Actions cron fails, the app silently serves stale data.

### [LOW] No Demo Data Indicator

- Problem: When all price sources fail, the batch API serves fabricated demo data (`source: 'demo'`). The UI shows no banner or warning that displayed prices are synthetic.
- Blocks: Users may make decisions based on demo data without realizing it.

## Test Coverage Gaps

### [CRITICAL] Near-Zero Test Coverage

- What's not tested: Only one test file exists (`tests/savings-math.test.ts`) covering core math functions (`computeWindowSavings`, `computeV2gWindowSavings`, `computeSpread`, `runOptimization`, `deriveEnergyPerSession`). No tests for:
  - **API routes**: `/api/prices/batch` (536 lines), `/api/generation`, `/api/auth` — zero route tests
  - **React components**: No component/integration tests for 15+ components in `src/components/v2/`
  - **use-prices hook**: Complex data fetching, merging, incremental update, and generation fallback logic — untested
  - **Excel export**: Both `generateAndDownloadExcel` and `generateEnhancedExcel` (832 lines combined) — untested. Formula generation references specific cell positions; structural changes produce silently wrong spreadsheets
  - **EPEX scraper**: No automated tests for HTML parsing or data validation
  - **Fleet optimizer**: `src/lib/fleet-optimizer.ts` (397 lines) — no dedicated tests
  - **Grid fees**: `src/lib/grid-fees.ts` — no tests for DSO tariff lookups
- Files: `tests/savings-math.test.ts` (single test file, ~500 lines), `vitest.config.ts` (config present)
- Risk: Regression bugs in savings calculations, price conversions (EUR/MWh to ct/kWh), overnight window construction, or V2G arbitrage logic would go undetected. The savings math is the core value proposition.
- Priority: High — expand existing test file with edge cases: negative prices, DST transitions, missing data gaps, zero-energy sessions, single-slot windows.

### [HIGH] No E2E or Smoke Tests

- What's not tested: No Playwright/Cypress tests verify dashboard loads, displays prices, or responds to user interaction.
- Files: None exist (Playwright is installed but only used for EPEX scraping)
- Risk: UI regressions from Recharts updates, Tailwind changes, or React 19 behavior differences are invisible until manual testing.
- Priority: High — a single smoke test loading `/v2` and verifying chart render would catch most catastrophic failures.

## Scaling Limits

### [LOW] Static JSON Price Files Growing Linearly

- Current capacity: ~2 years of hourly data in `public/data/smard-prices.json`. File grows at ~8,760 entries/year.
- Limit: At ~10 years, JSON file reaches ~5MB, causing slow initial page load on mobile.
- Scaling path: Paginate by year or switch to API-only loading. The incremental fetch pattern already exists and could replace static files.

## Accessibility Gaps

### [MEDIUM] Chart Interactions Inaccessible

- Problem: Chart drag handles (`div` elements with `onMouseDown`/`onTouchStart`) have no `role`, `tabIndex`, or keyboard event handlers. The Recharts chart area has no `aria-label`. Baseline vs. optimized slots are distinguished only by color (no pattern/label for color vision deficiency).
- Files: `src/components/v2/steps/Step2ChargingScenario.tsx` (drag handle JSX)
- Fix approach: Add `role="slider"`, `tabIndex={0}`, `aria-label`, and keyboard handlers (ArrowLeft/ArrowRight) to drag handles. Add `role="img"` with `aria-label` describing the chart summary.

## Dead Code

### [LOW] Unused Exports in Library Files

| Symbol | File | Status |
|---|---|---|
| `fetchForecastOnly` | `src/lib/energy-forecast.ts` | Never imported |
| `fetchEnergyChartsDayAhead` | `src/lib/energy-charts.ts` | Never imported |
| `fetchAwattarDayAhead` | `src/lib/awattar.ts` | Never imported |
| `fetchSmardDayAhead` | `src/lib/smard.ts` | Never imported |
| `hasCsvData` | `src/lib/csv-prices.ts` | Never imported |

These are v1-era single-day fetch APIs replaced by `*Range` variants. Safe to remove.

---

*Concerns audit: 2026-04-07*
