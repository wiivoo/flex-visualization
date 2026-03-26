# FlexMon Dashboard — Architecture

## App Router Structure

### Pages
| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Redirect to `/v2` |
| `/v2` | `src/app/v2/page.tsx` | Main dashboard (wrapped in `<Suspense>`) |
| `/login` | `src/app/login/page.tsx` | Login page |

### API Routes
| Route | File | Purpose |
|---|---|---|
| `GET /api/prices/batch` | `src/app/api/prices/batch/route.ts` | Multi-source price fetcher with Supabase cache |
| `GET /api/generation` | `src/app/api/generation/route.ts` | Solar/wind/load data from SMARD |
| `POST /api/auth` | `src/app/api/auth/route.ts` | JWT auth (jose), checks `DASHBOARD_PASSWORD` |

### Middleware
`src/middleware.ts` — stub (matcher is empty, auth checks happen at page level via JWT cookie).

---

## Data Flow

### DE Path (default)

```
GitHub Actions → public/data/smard-prices.json     (static hourly prices)
              → public/data/smard-prices-qh.json   (static QH prices)
              → public/data/smard-generation.json  (static generation)

usePrices('DE'):
  1. Fetch /data/smard-prices.json      → setHourly()  (fast first paint)
  2. Fetch /data/smard-prices-qh.json   → setHourlyQH()
  3. Fetch /data/smard-generation.json  → allGeneration.current (ref, on-demand)
  4. Background: GET /api/prices/batch?startDate=<lastStatic+1>&endDate=<t+2>
       → fetchIncremental() merges new hourly into state
  5. Background: GET /api/prices/batch?...&resolution=quarterhour
       → fetchIncrementalQH() merges QH data
  6. Per-date: GET /api/prices/batch?...&type=intraday&index=id3
       → setIntradayId3() (EPEX ID3 intraday, from Supabase cache only)
  7. Per-date: GET /api/generation?date=YYYY-MM-DD
       → loadGenerationForDate() (live if <7 days old)
```

### Non-DE Path (e.g. NL)

```
usePrices('NL'):
  Single call: GET /api/prices/batch?country=NL&startDate=<-365d>&endDate=<t+2>
    → ENTSO-E API (domain 10YNL----------L)
    → No static files, no generation data
    → On error: auto-reverts to 'DE' (V2Page useEffect)
```

### Batch API Route (`/api/prices/batch`) — Hourly Fallback Chain (DE)

```
1. Supabase cache (price_cache table, TTL: past=24h, today=2h, future=1h)
2. aWATTar API          (fast, ~3 days history)
3. ENTSO-E API          (full historical)
4. SMARD API            (weekly chunks, parallel)
5. Energy-Charts API    (Fraunhofer ISE)
6. CSV files            (local offline fallback)
7. Demo data            (generated seasonal patterns, DE only)

QH path:
  SMARD QH → expand-hourly×4 (isHourlyAvg=true)

Forecast:
  EnergyForecast.de API appended for future dates (forecastStart boundary in response)
  isProjected=true flag set on HourlyPrice entries past forecastStart
```

---

## Component Hierarchy

```
src/app/v2/page.tsx  (V2Page → V2Inner)
│
│  State: scenario, country, copied, showTutorial
│  usePrices(country) → PriceData
│  useMemo: energyPerSession, effectiveStartLevel
│  useMemo: optimization = runOptimization(prices, scenario)
│
├── <Step2ChargingScenario prices scenario setScenario optimization country setCountry>
│   │  (src/components/v2/steps/Step2ChargingScenario.tsx, ~1270 lines)
│   │  State: isDragging, costDetailMode, resolution, plotArea, showRenewable, etc.
│   │
│   ├── <DateStrip>              — horizontal date selector
│   ├── <MiniCalendar>          — calendar picker with spread-colored cells
│   ├── Recharts ComposedChart  — main price + charging window chart
│   │     Line (day-ahead hourly), Area (QH), ReferenceArea (charging windows),
│   │     ReferenceLine (baseline), drag handles (SVG overlays)
│   ├── <SessionCostCard>       — baseline vs optimized cost for selected day
│   ├── <MonthlySavingsCard>    — 12-month savings bar chart
│   ├── <DailySavingsHeatmap>   — savings heatmap (new, untracked)
│   ├── <YearlySavingsCard>     — yearly savings summary
│   └── (disabled) SavingsHeatmap, FleetPortfolioCard, SpreadIndicatorsCard, FlexibilityDemoChart
│
└── <TutorialOverlay>           — modal guide overlay
```

---

## State Management

### URL ↔ State Sync (`src/app/v2/page.tsx`)

All user-configurable scenario params are reflected in the URL via `router.replace()`:

| URL param | State field |
|---|---|
| `date` | `prices.selectedDate` |
| `mileage` | `scenario.yearlyMileageKm` |
| `plugins_wd` | `scenario.weekdayPlugIns` |
| `plugins_we` | `scenario.weekendPlugIns` |
| `plugin_time` | `scenario.plugInTime` |
| `departure` | `scenario.departureTime` |
| `power` | `scenario.chargePowerKw` (omitted if default 7) |
| `mode` | `scenario.chargingMode` (omitted if 'overnight') |

On mount: `parseScenario(searchParams)` initializes state from URL (backward compat with old `plugins` param).

### React State Layers

- **V2Page**: `scenario` (ChargingScenario), `country` ('DE'|'NL'), `copied`, `showTutorial`
- **usePrices hook**: `hourly`, `hourlyQH`, `daily`, `monthly`, `selectedDate`, `generation`, `intradayId3`, `lastRealDate`, `loading`, `error`
- **Step2ChargingScenario**: local UI state (drag handles, resolution, cost detail mode, renewable overlay toggle, plot area measurements)

---

## Optimization Engine (`src/lib/optimizer.ts` + `src/lib/charging-helpers.ts`)

### `runOptimization()` (optimizer.ts)
Called in `useMemo` in V2Page for the selected day.

**Input (`OptimizeInput`):**
- `prices[]` — hourly price points for the day
- `battery_kwh`, `charge_power_kw`
- `start_level_percent`, `target_level_percent`
- `window_start` / `window_end` (HH:MM) — plug-in to departure
- `base_price_ct_kwh`, `margin_ct_kwh`, `customer_discount_ct_kwh`
- `dso?` — optional DSO for §14a Module 3 grid fees

**Algorithm:**
1. Filter prices to the charging window
2. **Baseline**: charge immediately at plug-in time (first N slots chronologically)
3. **Optimized**: sort window by price, pick cheapest N slots to cover `energy_needed_kwh`
4. Compute `cost_without_flex_eur` vs `cost_with_flex_eur`, savings split between customer and operator margin
5. If `dso` set: apply §14a Module 3 time-variable grid fees (`src/lib/grid-fees.ts`) to both schedules

**Output (`OptimizeResult`):**
- `charging_schedule[]` / `baseline_schedule[]` — `ChargingBlock` arrays
- `savings_eur`, `customer_benefit_eur`, `our_margin_eur`
- `avg_price_without_flex`, `avg_price_with_flex`
- `mod3_active`, `savings_from_mod3_eur` (Module 3 fields, optional)

### `computeV2gWindowSavings()` (charging-helpers.ts)
V2G (bidirectional) optimizer — disabled in UI (`ENABLE_V2G = false`).

**Algorithm:**
1. Compute V1G-equivalent load-shifting benefit for net energy (startSoC → targetSoC)
2. Reserve cheapest slots for mandatory net charge
3. Greedily pair cheapest buy + most expensive sell for arbitrage
4. Chronological SoC validation walk (enforces min SoC floor)
5. Returns `profitEur = loadShiftingBenefitEur + arbitrageUpliftEur`

### `computeWindowSavings()` / `computeSpread()` (charging-helpers.ts)
Used in `Step2ChargingScenario` for per-day and per-month spread calculations. Supports hourly (slotsPerHour=1) and QH (slotsPerHour=4 legacy, or actual QH data).

---

## Country-Aware Data Separation

| Aspect | DE | NL (or other) |
|---|---|---|
| Price source | Static JSON + SMARD incremental | ENTSO-E via `/api/prices/batch?country=NL` |
| Generation data | SMARD (solar, wind, load) | Not available |
| Intraday ID3 | Available (EPEX scraper → Supabase) | Not available |
| QH resolution | SMARD native QH | Hourly expanded ×4 (`isHourlyAvg=true`) |
| Cache prefix | `day-ahead` | `nl:day-ahead` |
| Fallback on error | — | Auto-revert to DE (V2Page `useEffect`) |
| ENTSOE domain | `10Y1001A1001A82H` (DE-LU) | `10YNL----------L` |

---

## §14a Module 3 Grid Fees (`src/lib/grid-fees.ts`)

10 DSOs supported with three time zones: HT (peak), ST (standard), NT (off-peak).
`getGridFee(dso, hour)` returns the applicable ct/kWh for a given hour.
`isModul3Active(dso, quarter)` — some DSOs only apply Module 3 in certain quarters.
Integrated into optimizer via `dso?` param.
