# Architecture

**Analysis Date:** 2026-04-07

## Pattern Overview

**Overall:** Next.js App Router single-page application with static data preloading and incremental API hydration.

**Key Characteristics:**
- Client-rendered dashboard with URL-synced state (shareable deep links)
- Static JSON price data loaded at page load, incrementally updated via API routes
- Multi-source price fallback chain with Supabase caching layer
- Pure-function computation engine (optimizer, charging helpers, fleet optimizer) separated from UI
- Single main visualization component (`Step2ChargingScenario`, 3608 lines) orchestrating 15+ card/widget sub-components
- Two independent page families: `/v2` (EV charging dashboard) and `/dynamic` (dynamic tariff analysis)

## Layers

**Static Data Layer:**
- Purpose: Pre-downloaded price and generation data served as static JSON files
- Location: `public/data/`
- Contains: `smard-prices.json` (1.1MB hourly DE), `smard-prices-qh.json` (4.5MB quarter-hourly DE), `smard-generation.json` (1.7MB), `nl-prices.json` (1.1MB), `nl-prices-qh.json` (4.5MB), `smard-meta.json`, `projected-prices.json` (1.3MB), `epex-css.json`, `e1a-profile-2025.json`
- Updated by: GitHub Actions workflow (`.github/workflows/update-smard-data.yml`) daily at 13:30 UTC
- Used by: `usePrices` hook on initial page load

**API Layer (Server):**
- Purpose: Incremental data fetching, multi-source fallback, Supabase caching, auth, tariff lookups
- Location: `src/app/api/`
- Contains: 6 Next.js API route handlers (7 route files total)
- Depends on: External APIs (SMARD, ENTSO-E, aWATTar, Energy-Charts, EnergyForecast.de, Tibber), Supabase
- Used by: Client-side hooks (`usePrices`) and dynamic tariff pages

**Data Hook Layer (Client):**
- Purpose: Manage price data lifecycle -- load static, fetch incremental, derive summaries
- Location: `src/lib/use-prices.ts` (549 lines)
- Contains: `usePrices()` hook returning `PriceData` interface
- Depends on: Static JSON files, `/api/prices/batch`, `/api/generation`
- Used by: `V2Page` and `DynamicPage` components

**Computation Layer:**
- Purpose: Pure functions for optimization, savings calculation, fleet modeling, tariff computation
- Location: `src/lib/`
- Contains: `optimizer.ts` (315 lines), `charging-helpers.ts` (400 lines), `fleet-optimizer.ts` (397 lines), `grid-fees.ts` (178 lines), `dynamic-tariff.ts` (359 lines), `excel-export.ts` (832 lines)
- Depends on: Types from `v2-config.ts` and `config.ts`
- Used by: Components via `useMemo` calls

**Component Layer:**
- Purpose: Interactive visualization and UI
- Location: `src/components/v2/` (8068 lines total), `src/components/dynamic/` (946 lines)
- Contains: Chart components, card widgets, config panels, overlays
- Depends on: Computation layer, `PriceData` from hook layer, Recharts, shadcn/ui
- Used by: Page components

**Page Layer:**
- Purpose: Route entry points, state management, component orchestration
- Location: `src/app/v2/page.tsx` (265 lines), `src/app/dynamic/page.tsx` (1572 lines), `src/app/dynamic/analysis/page.tsx` (1822 lines), `src/app/dynamic/nl/page.tsx` (1191 lines)
- Contains: URL parsing, state initialization, optimization execution
- Depends on: All other layers

## App Router Structure

### Pages

| Route | File | Lines | Purpose |
|---|---|---|---|
| `/` | `src/app/page.tsx` | 6 | Redirect to `/v2` |
| `/v2` | `src/app/v2/page.tsx` | 265 | Main EV charging dashboard (wrapped in `<Suspense>`) |
| `/login` | `src/app/login/page.tsx` | -- | Login form (JWT cookie auth) |
| `/dynamic` | `src/app/dynamic/page.tsx` | 1572 | Dynamic tariff visualization (DE) with SLP profiles |
| `/dynamic/analysis` | `src/app/dynamic/analysis/page.tsx` | 1822 | Tariff analysis deep dive |
| `/dynamic/nl` | `src/app/dynamic/nl/page.tsx` | 1191 | Dutch dynamic tariff page |

### API Routes

| Route | File | Lines | Purpose |
|---|---|---|---|
| `GET /api/prices/batch` | `src/app/api/prices/batch/route.ts` | 536 | Multi-source price fetcher with 7-source fallback chain + Supabase cache |
| `GET /api/generation` | `src/app/api/generation/route.ts` | 121 | Solar/wind/load from SMARD for a single date |
| `GET /api/generation/mix` | `src/app/api/generation/mix/route.ts` | 133 | Full generation mix (gas, coal, lignite, solar, wind, biomass) for date range |
| `POST /api/auth` | `src/app/api/auth/route.ts` | 112 | JWT password auth with in-memory rate limiting (5/min) |
| `DELETE /api/auth` | `src/app/api/auth/route.ts` | -- | Logout (clear session cookie) |
| `GET /api/tariff-components` | `src/app/api/tariff-components/route.ts` | 282 | Regional grid fees by German PLZ (via Tibber API + Supabase cache, 7-day TTL) |
| `GET /api/nl-tariff-components` | `src/app/api/nl-tariff-components/route.ts` | 185 | Dutch tariff component data |

### Middleware

- File: `src/middleware.ts` (10 lines)
- Currently a pass-through (`matcher: []`), auth enforced at API route level

## Data Flow

### Primary Data Flow (DE Day-Ahead Prices)

```
1. STATIC LOAD (fast first paint)

   Browser  --fetch-->  /data/smard-prices.json     (1.1MB, compact {t,p})
            --fetch-->  /data/smard-prices-qh.json  (4.5MB, compact {t,p})
            --fetch-->  /data/smard-generation.json  (1.7MB, compact {t,s,w,l})

   usePrices() converts compact format --> HourlyPrice[]
   deriveDailySummaries() --> DailySummary[]
   deriveMonthlyStats() --> MonthlyStats[]
   Sets selectedDate = yesterday
   Renders immediately

2. INCREMENTAL UPDATE (background, non-blocking)

   usePrices() detects gap: lastStaticDate --> dayAfterTomorrow
   Fetches /api/prices/batch?startDate=X&endDate=Y
   Fetches /api/prices/batch?...&resolution=quarterhour

   Batch API fallback chain (hourly DE):
     1. Supabase cache (price_cache table, resolution-aware)
     2. aWATTar API         (fast, ~3 days history)
     3. ENTSO-E API         (full historical, hourly)
     4. SMARD API           (weekly chunks, parallel fetch)
     5. Energy-Charts API   (Fraunhofer ISE)
     6. CSV files           (local offline fallback)
     7. Demo data           (generated seasonal patterns, DE only)

   QH chain:
     1. SMARD QH            (native 15-min, filter 4169)
     2. Hourly expanded x4  (isHourlyAvg=true, client shows badge)

   Forecast boundary: EnergyForecast.de API appended for future dates
     forecastStart in response marks EPEX actuals vs predictions
     isProjected=true set on HourlyPrice entries past forecastStart

   Merges into state, re-derives daily/monthly summaries

3. PER-DATE DATA (on selectedDate change)

   Generation: static data --> live /api/generation (if <7 days old or <20 hours)
   Intraday ID3: /api/prices/batch?type=intraday&index=id3 (4 days for 72h view)
   Both cached in React refs (generationCache, allGeneration)
```

### Non-DE Path (NL)

```
Browser  --fetch-->  /data/nl-prices.json      (static, if available)
                     /data/nl-prices-qh.json
         (no generation data for non-DE countries)

Incremental: /api/prices/batch?country=NL
  --> ENTSO-E only (domain 10YNL----------L)
  --> QH: hourly expanded x4 (isHourlyAvg=true)
  --> Cache prefix: 'nl:day-ahead'
  --> No demo fallback (better to show error than fake prices)

On ENTSO-E error: auto-revert to DE (V2Page useEffect)
```

### Supabase Cache Strategy

| Scenario | TTL |
|---|---|
| Past dates | Never expires (Infinity) |
| Today | 2 hours |
| Future dates | 1 hour |

Cache key: `(date, type)` where type encodes resolution: `day-ahead` (hourly), `day-ahead-qh` (quarter-hourly), with country prefix for non-DE (`nl:day-ahead`). Bulk query for date ranges, upsert on write.

## Component Hierarchy

### V2 Dashboard (`/v2`)

```
V2Page (src/app/v2/page.tsx, 265 lines)
  State: scenario, country, copied, showTutorial, exportDialogOpen, exportData
  usePrices(country) --> PriceData
  useMemo: energyPerSession, effectiveStartLevel, optimization
  |
  +-- Step2ChargingScenario (src/components/v2/steps/Step2ChargingScenario.tsx, 3608 lines)
  |     State: isDragging, costDetailMode, resolution, plotArea, showRenewable,
  |            showIntraday, showFleet, fleetView, fleetConfig (deferred), renewableData
  |     |
  |     +-- DateStrip (312 lines) -- horizontal date selector with edge-scroll
  |     +-- MiniCalendar (246 lines) -- monthly calendar with spread-colored cells
  |     +-- Scenario controls (inline) -- mileage slider, plug-in days, time drag handles
  |     +-- Recharts ComposedChart -- main price chart
  |     |     Line (day-ahead), Area (QH), ReferenceArea (charging windows),
  |     |     ReferenceLine (baseline end), drag handles (SVG overlays)
  |     +-- SessionCostCard (160 lines) -- baseline vs optimized cost
  |     +-- SpreadIndicatorsCard (539 lines) -- market spread metrics [disabled]
  |     +-- FleetConfigPanel (232 lines) -- fleet size/distribution config
  |     +-- FleetPortfolioCard (453 lines) -- fleet portfolio analysis [disabled]
  |     +-- MonthlySavingsCard (279 lines) -- 12-month savings bar chart
  |     +-- DailySavingsHeatmap (477 lines) -- calendar-style savings heatmap
  |     +-- YearlySavingsCard (200 lines) -- annual savings with quarterly drill-down
  |     +-- FlexibilityDemoChart (291 lines) -- flexibility demo [disabled]
  |     +-- AnimatedNumber (54 lines) -- animated counter
  |
  +-- ExportDialog (182 lines) -- Excel export with formulas
  +-- TutorialOverlay (389 lines) -- modal step-by-step guide
  +-- TheoryOverlay (511 lines) -- theory/explanation modal [unconnected]
```

### Dynamic Tariff Pages (`/dynamic`)

```
DynamicPage (src/app/dynamic/page.tsx, 1572 lines)
  usePrices('DE'), dynamic-tariff.ts, slp-h25.ts
  |
  +-- DateStrip (shared from v2)
  +-- DynamicDailySavings (389 lines) -- daily savings chart
  +-- MonthlyPriceTrend (557 lines) -- monthly price trend

DynamicAnalysisPage (src/app/dynamic/analysis/page.tsx, 1822 lines)
DynamicNLPage (src/app/dynamic/nl/page.tsx, 1191 lines)
```

## State Management

### URL <-> State Sync (`src/app/v2/page.tsx`)

State is bidirectionally synced with URL search params via `router.replace()` (no history pollution):

| URL param | State field | Default | Omitted when |
|---|---|---|---|
| `date` | `prices.selectedDate` | yesterday | -- |
| `mileage` | `scenario.yearlyMileageKm` | 12000 | -- |
| `plugins_wd` | `scenario.weekdayPlugIns` | 2 | -- |
| `plugins_we` | `scenario.weekendPlugIns` | 0 | -- |
| `plugin_time` | `scenario.plugInTime` | 18 | -- |
| `departure` | `scenario.departureTime` | 7 | -- |
| `power` | `scenario.chargePowerKw` | 7 | default (7) |
| `mode` | `scenario.chargingMode` | 'overnight' | default ('overnight') |
| `days` | `scenario.plugInDays` | derived from wd/we | when not explicitly set |

Backward compatibility: old `plugins` param (single number) is split into `plugins_wd`/`plugins_we`.

### React State Layers

**V2Page** (`src/app/v2/page.tsx`):
- `scenario: ChargingScenario` -- full user charging configuration (15+ fields)
- `country: 'DE' | 'NL'` -- market selection
- `copied: boolean` -- share button feedback
- `showTutorial: boolean` -- tutorial overlay visibility
- `exportDialogOpen: boolean` -- export dialog visibility
- `exportData` -- data payload for Excel export (set by Step2 via `onExportReady` callback)

**usePrices hook** (`src/lib/use-prices.ts`):
- `hourly: HourlyPrice[]` -- all hourly price points (grows with incremental updates)
- `hourlyQH: HourlyPrice[]` -- quarter-hourly price points
- `daily: DailySummary[]` -- derived daily summaries (sorted chronologically)
- `monthly: MonthlyStats[]` -- derived monthly statistics
- `selectedDate: string` -- currently viewed date (YYYY-MM-DD)
- `generation: GenerationData[]` -- solar/wind/load for selected date
- `intradayId3: HourlyPrice[]` -- EPEX ID3 intraday prices (4-day window)
- `lastRealDate: string` -- boundary between real SMARD/EPEX and projected data
- `loading / error` -- fetch state
- Internal refs: `fetchedCountry`, `generationCache`, `allGeneration`

**Step2ChargingScenario** (`src/components/v2/steps/Step2ChargingScenario.tsx`):
- `isDragging: 'arrival' | 'departure' | 'fleetArrival' | 'fleetDeparture' | null` -- chart drag handle state
- `resolution: 'hour' | 'quarterhour'` -- chart resolution toggle
- `plotArea: { left, width, top, height }` -- measured Recharts plot area (from DOM ref)
- `showRenewable: boolean` -- renewable generation overlay
- `showIntraday: boolean` -- intraday ID3 price overlay
- `showFleet: boolean` -- fleet mode toggle
- `fleetView: 'single' | 'fleet'` -- single EV vs fleet aggregate view
- `fleetConfig: FleetConfig` -- fleet configuration (wrapped in `useDeferredValue`)
- `costDetailMode: string | null` -- cost card expansion state
- `renewableData: Map<string, number>` -- per-hour renewable share keyed by `date-hour`

### Deferred Values

`fleetConfig` uses `useDeferredValue` to prevent expensive fleet band recalculation from blocking user input on fleet config sliders. The deferred value (`deferredFleetConfig`) is used for all heavy computations while the immediate value drives the slider UI.

## Optimization Engine

### Single-EV Optimizer (`src/lib/optimizer.ts`, 315 lines)

**Input:** `OptimizeInput` -- prices, battery specs, time window, tariff parameters, optional DSO
**Output:** `OptimizeResult` -- charging schedule, baseline schedule, costs, savings breakdown
**Called from:** `V2Page` in a `useMemo` on `[prices.selectedDayPrices, scenario.plugInTime, scenario.departureTime, effectiveStartLevel]`

**Algorithm:**
1. Calculate energy needed: `battery_kwh * (target% - start%) / 100`
2. Divide into 15-minute intervals: `intervals_needed = ceil(energy / charge_power) * 4`
3. Filter prices to time window (handles overnight wrap: startHour > endHour)
4. **Optimized:** Sort by total cost (price + grid fee if Module 3), take cheapest N intervals
5. **Baseline:** Take first N intervals chronologically from window start ("charge immediately")
6. Build contiguous charging blocks via `buildChargingBlocks()` (merges consecutive 15-min intervals)
7. Calculate economics: savings = cost_without_flex - cost_with_flex; customer_benefit capped at min(discount_savings, 50% of savings)

### V2G Bidirectional Optimizer (`src/lib/charging-helpers.ts`, `computeV2gWindowSavings()`)

Feature-flagged off (`ENABLE_V2G = false` in `src/lib/v2-config.ts`).

**Algorithm (PROJ-29):**
1. Compute V1G-equivalent load shifting benefit for net energy (startSoC to targetSoC)
2. Reserve cheapest slots for mandatory net charge to reach target
3. Greedily pair cheapest buy + most expensive sell for arbitrage (profit > 0 check includes roundTripEfficiency and degradationCtKwh)
4. Chronological validation: walk all slots in time order, enforce SoC floor (minKwh), skip infeasible
5. Post-processing: if targetSoc not reached, add cheapest unused charge slots
6. `profitEur = loadShiftingBenefitEur + arbitrageUpliftEur`

### Fleet Optimizer (`src/lib/fleet-optimizer.ts`, 397 lines)

**Functions:**
- `generateDistribution(min, max, avg, mode, hours)` -- bell-curve distribution (sigma varies by mode: narrow=0.8, normal=1.5, wide=2.5)
- `deriveFleetDistributions(config, mode)` -- compute arrival/departure distributions for fleet; handles overnight/fullday/threeday modes
- `computeFlexBand()` -- compute greedy (ASAP) and lazy (ALAP) bounds per time slot
- `optimizeFleetSchedule()` -- price-optimal aggregate schedule within band constraints
- `computeFleetEnergyKwh()` -- total fleet energy demand from mileage and plug-in frequency

### Charging Helpers (`src/lib/charging-helpers.ts`, 400 lines)

- `computeWindowSavings(windowPrices, energyPerSession, kwhPerSlot, slotsPerHour)` -- baseline vs optimized average price
- `computeSpread(windowPrices, energyPerSession, chargePowerKw, ...)` -- market spread + capturable savings metrics
- `buildOvernightWindows(hourlyPrices, plugInTime, departureTime)` -- construct overnight price windows across all dates (returns `OvernightWindow[]` with sorted prices, weekend flag, DOW)
- `buildMultiDayWindow(hourlyPrices, startDate, endDate, plugInTime, departureTime)` -- price window for fullday/3-day modes

## Module 3 Grid Fees (`src/lib/grid-fees.ts`, 178 lines)

Implements section 14a of the German Energy Industry Act (EnWG) -- variable grid fees by time of day for controllable loads (EVs, heat pumps). 10 DSOs with per-quarter activation schedules and three hourly fee zones: HT (peak), ST (standard), NT (off-peak).

- `getGridFee(hour, dso)` -- returns applicable ct/kWh for a given hour and DSO
- `isModul3Active(dso, month)` -- checks if Module 3 applies in the given quarter
- `getAverageGridFee(dso)` -- flat average fee for comparison
- `getAvailableDSOs()` -- list of supported DSO identifiers
- Integrated into optimizer via optional `dso` param on `OptimizeInput`

## Country-Aware Data Separation

| Aspect | DE | NL (or other) |
|---|---|---|
| Price source | Static JSON + SMARD incremental | ENTSO-E via `/api/prices/batch?country=NL` |
| Static files | `smard-prices.json`, `smard-prices-qh.json` | `nl-prices.json`, `nl-prices-qh.json` |
| Generation data | SMARD (solar, wind, load) | Not available |
| Intraday ID3 | Available (EPEX scraper via Supabase) | Not available |
| QH resolution | SMARD native QH (filter 4169) | Hourly expanded x4 (`isHourlyAvg=true`) |
| Cache prefix | `day-ahead` | `nl:day-ahead` |
| Fallback on error | 7-source chain to demo data | No demo fallback, auto-revert to DE |
| ENTSOE domain | `10Y1001A1001A82H` (DE-LU) | `10YNL----------L` |

## Cross-Cutting Concerns

**Error Handling:**
- API routes return HTTP status codes with JSON error messages; Zod validation returns 400 with issue details
- `usePrices`: static data load failure is fatal (sets `error`), incremental fetches are non-fatal (`console.warn`, data kept as-is)
- Non-DE country load failure auto-reverts to DE via `useEffect` watching `prices.error`
- Optimizer returns `null` on failure; components check and render fallback UI
- Rate limiting on auth: 5 attempts per minute, in-memory Map, returns 429 with `Retry-After` header
- Generation API: per-filter `catch(() => new Map())` -- partial data is acceptable

**Validation:**
- API routes use Zod schemas: `batchQuerySchema` validates `startDate`, `endDate`, `type`, `resolution`, `index`, `country`
- URL param parsing uses safe `Number()` with `isNaN` guards and fallback to `DEFAULT_SCENARIO` values
- Date range limit: max 1600 days per batch request

**Authentication:**
- JWT-based session via `jose` library (HS256 algorithm)
- Single shared password stored in `DASHBOARD_PASSWORD` env var
- Secret key: `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` env var
- Session cookie: `flexmon-session`, 24h maxAge, httpOnly, secure in production, sameSite strict
- Middleware is a no-op (empty matcher); auth enforced at API route level only

**Logging:**
- `console.log` for informational messages (incremental update counts, data point merges)
- `console.warn` for non-fatal failures (incremental fetch errors, country revert, unknown DSO lookup)
- `console.error` for API-level errors (source fetch failures, cache write errors)
- No structured logging framework

---

*Architecture analysis: 2026-04-07*
