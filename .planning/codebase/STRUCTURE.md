# FlexMon Dashboard — File Structure

## Directory Tree (active source, excluding `src/_archive/`)

```
src/
├── app/
│   ├── layout.tsx                         Root layout, metadata, globals.css
│   ├── page.tsx                           Root page → redirect('/v2')
│   ├── login/
│   │   └── page.tsx                       Login form (JWT cookie auth)
│   ├── v2/
│   │   └── page.tsx                       Main dashboard entry point
│   └── api/
│       ├── auth/
│       │   └── route.ts                   POST: password check → JWT cookie
│       ├── generation/
│       │   └── route.ts                   GET: solar/wind/load from SMARD
│       └── prices/
│           └── batch/
│               └── route.ts               GET: multi-source price fetcher + cache
│
├── components/
│   ├── ui/                                shadcn/ui primitives (6 kept)
│   │   ├── alert.tsx
│   │   ├── button.tsx
│   │   ├── card.tsx
│   │   ├── input.tsx
│   │   ├── label.tsx
│   │   └── tooltip.tsx
│   └── v2/                                Dashboard-specific components
│       ├── steps/
│       │   └── Step2ChargingScenario.tsx  Core visualization (~1270 lines)
│       ├── AnimatedNumber.tsx             Animated counter for KPI values
│       ├── DailySavingsHeatmap.tsx        Daily savings heatmap (new, untracked)
│       ├── DateStrip.tsx                  Horizontal scrollable date selector
│       ├── FleetPortfolioCard.tsx         Fleet portfolio view (disabled in Step2)
│       ├── FlexibilityDemoChart.tsx       Demo chart (disabled in Step2)
│       ├── MiniCalendar.tsx               Monthly calendar with spread color coding
│       ├── MonthlySavingsCard.tsx         12-month savings bar chart
│       ├── SavingsHeatmap.tsx             Mileage × frequency savings matrix (disabled)
│       ├── SessionCostCard.tsx            Baseline vs optimized session cost
│       ├── SpreadIndicatorsCard.tsx       Price spread indicators (disabled)
│       ├── TheoryOverlay.tsx              Theory/explanation modal
│       ├── TutorialOverlay.tsx            Step-by-step guide overlay
│       └── YearlySavingsCard.tsx          Annual savings summary card
│
├── lib/
│   ├── auth.ts                            JWT verify/sign helpers (jose)
│   ├── awattar.ts                         aWATTar API client (DE/AT spot prices)
│   ├── charging-helpers.ts                Shared computation: spread, savings, V2G optimizer
│   ├── config.ts                          Legacy shared types: VehicleProfile, ChargingBlock, ConfigState
│   ├── csv-prices.ts                      CSV file price reader (local fallback)
│   ├── energy-charts.ts                   Fraunhofer ISE Energy-Charts API client
│   ├── energy-forecast.ts                 EnergyForecast.de API client (48h forecast)
│   ├── entsoe.ts                          ENTSO-E Transparency Platform API client
│   ├── grid-fees.ts                       §14a Module 3 time-variable grid fees (10 DSOs)
│   ├── optimizer.ts                       Optimization engine (greedy cheapest-slot)
│   ├── price-cache.ts                     Supabase price_cache read/write with TTL logic
│   ├── smard.ts                           SMARD API client (filter 4169 = DE-LU prices)
│   ├── supabase.ts                        Supabase client singleton
│   ├── use-prices.ts                      React hook: load + merge + derive price data
│   ├── utils.ts                           shadcn cn() helper
│   └── v2-config.ts                       V2 types, constants, defaults, interfaces
│
└── middleware.ts                          Stub (empty matcher, auth at page level)
```

---

## Purpose of Each Major File

### Entry Points
- `src/app/page.tsx` — Immediate redirect to `/v2`; no rendering
- `src/app/v2/page.tsx` — Dashboard shell: URL↔state sync, `usePrices`, `runOptimization`, share button, tutorial toggle; renders `<Step2ChargingScenario>`

### Core Visualization
- `src/components/v2/steps/Step2ChargingScenario.tsx` — All scenario controls (mileage slider, plug-in time, departure drag handles), Recharts price chart, charging window overlays, renewable toggle; renders all child cards

### Data Hook
- `src/lib/use-prices.ts` — Central data store for the dashboard; manages static JSON load, incremental API fetch, generation data, intraday ID3; exposes `PriceData` interface

### API Routes
- `src/app/api/prices/batch/route.ts` — Multi-source price fetcher: checks Supabase cache, then falls through aWATTar → ENTSO-E → SMARD → Energy-Charts → CSV → demo; handles QH expansion and forecast appending
- `src/app/api/generation/route.ts` — Fetches solar (4068), wind onshore (4067) + offshore (1225), grid load (410) from SMARD by date; aggregates into hourly generation data

### Computation Libraries
- `src/lib/optimizer.ts` — `runOptimization()`: greedy cheapest-slot algorithm, baseline vs optimized cost, Module 3 grid fees integration; `OptimizeInput` / `OptimizeResult` interfaces
- `src/lib/charging-helpers.ts` — `computeWindowSavings()`, `computeSpread()`, `buildOvernightWindows()`, `buildMultiDayWindow()`, `computeV2gWindowSavings()` (V2G bidirectional optimizer)
- `src/lib/grid-fees.ts` — DSO tariff tables, `getGridFee(dso, hour)`, `isModul3Active(dso, quarter)`

### Configuration & Types
- `src/lib/v2-config.ts` — Authoritative V2 types: `ChargingScenario`, `HourlyPrice`, `DailySummary`, `MonthlyStats`, `GenerationData`, `VehiclePreset`; constants `DEFAULT_SCENARIO`, `DEFAULT_BATTERY_KWH`, `DEFAULT_CHARGE_POWER_KW`; helpers `deriveEnergyPerSession()`, `totalWeeklyPlugIns()`; feature flag `ENABLE_V2G`
- `src/lib/config.ts` — Legacy types (still used by optimizer): `PricePoint`, `ChargingBlock`, `OptimizationResult`, `VehicleProfile`, `ConfigState`; DSO profiles for v1 config

### External API Clients
- `src/lib/smard.ts` — SMARD weekly chunk fetcher (`filter 4169`), `convertSmardPrice()`
- `src/lib/entsoe.ts` — ENTSO-E XML parser, `fetchEntsoeRange()`, `ENTSOE_DOMAINS` map
- `src/lib/awattar.ts` — aWATTar REST API, `fetchAwattarRange()`
- `src/lib/energy-charts.ts` — Fraunhofer ISE Energy-Charts, `fetchEnergyChartsRange()`
- `src/lib/energy-forecast.ts` — EnergyForecast.de, `fetchEnergyForecast('HOURLY'|'QUARTER_HOURLY')`, returns `forecastStart` boundary
- `src/lib/csv-prices.ts` — Local CSV file reader, `fetchCsvPrices(type, day)`

### Infrastructure
- `src/lib/supabase.ts` — `createClient()` singleton using `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `src/lib/price-cache.ts` — `getCachedPrices()`, `setCachedPrices()`, `cacheTypeKey()` — Supabase `price_cache` table with TTL logic; resolution encoded as type suffix (`day-ahead-qh`)
- `src/lib/auth.ts` — JWT sign/verify with `jose`; checks `DASHBOARD_PASSWORD` env var

---

## Key Exports and Interfaces

### `src/lib/v2-config.ts`
```ts
export interface ChargingScenario { vehicleId, plugInTime, departureTime, startLevel, targetLevel, yearlyMileageKm, weekdayPlugIns, weekendPlugIns, chargePowerKw, chargingMode, gridMode, v2g* }
export interface HourlyPrice { timestamp, priceEurMwh, priceCtKwh, hour, minute, date, isProjected? }
export interface DailySummary { date, avgPrice, minPrice, maxPrice, spread, negativeHours, dayAvgPrice, nightAvgPrice, ... }
export interface MonthlyStats { month, avgSpread, avgPrice, ... }
export interface GenerationData { timestamp, hour, solarMw, windMw, loadMw, renewableMw, renewableShare }
export const DEFAULT_SCENARIO: ChargingScenario
export const ENABLE_V2G: boolean  // false
export function deriveEnergyPerSession(yearlyMileageKm, weekdayPlugIns, weekendPlugIns?): number
```

### `src/lib/use-prices.ts`
```ts
export interface PriceData { hourly, hourlyQH, daily, monthly, loading, error, selectedDate, setSelectedDate, selectedDayPrices, yearRange, generation, generationLoading, lastRealDate, intradayId3 }
export function usePrices(country?: string): PriceData
```

### `src/lib/optimizer.ts`
```ts
export interface OptimizeInput { prices, battery_kwh, charge_power_kw, start_level_percent, window_start, window_end, target_level_percent, base_price_ct_kwh, margin_ct_kwh, customer_discount_ct_kwh, dso? }
export interface OptimizeResult { charging_schedule, baseline_schedule, cost_without_flex_eur, cost_with_flex_eur, savings_eur, customer_benefit_eur, our_margin_eur, avg_price_*, mod3_* }
export function runOptimization(input: OptimizeInput): OptimizeResult
```

### `src/lib/charging-helpers.ts`
```ts
export function computeWindowSavings(windowPrices, energyPerSession, kwhPerSlot, slotsPerHour): { bAvg, oAvg, savingsEur }
export function computeSpread(windowPrices, energyPerSession, chargePowerKw, slotsPerHour?, kwhPerSlotOverride?): SpreadResult | null
export function buildOvernightWindows(hourlyPrices, plugInTime, departureTime): OvernightWindow[]
export function buildMultiDayWindow(hourlyPrices, startDate, endDate, plugInTime, departureTime): HourlyPrice[]
export function computeV2gWindowSavings(...): V2gResult
export interface V2gResult { chargeSlots, dischargeSlots, profitEur, loadShiftingBenefitEur, arbitrageUpliftEur, ... }
```

### `src/lib/config.ts`
```ts
export interface PricePoint { timestamp: string; price_ct_kwh: number }
export interface ChargingBlock { start, end, price_ct_kwh, kwh }
export interface ConfigState { vehicle, base_price_ct_kwh, margin_ct_kwh, customer_discount_ct_kwh, start_level_percent, window_start, window_end, dso? }
```

---

## Import Dependency Graph

```
src/app/v2/page.tsx
  ← src/lib/use-prices.ts
  ← src/lib/optimizer.ts
  ← src/lib/v2-config.ts
  ← src/components/v2/steps/Step2ChargingScenario.tsx
  ← src/components/v2/TutorialOverlay.tsx

src/components/v2/steps/Step2ChargingScenario.tsx
  ← src/lib/v2-config.ts
  ← src/lib/charging-helpers.ts
  ← src/lib/optimizer.ts (type only)
  ← src/components/v2/AnimatedNumber.tsx
  ← src/components/v2/DateStrip.tsx
  ← src/components/v2/SessionCostCard.tsx
  ← src/components/v2/MonthlySavingsCard.tsx
  ← src/components/v2/DailySavingsHeatmap.tsx
  ← src/components/v2/YearlySavingsCard.tsx
  ← src/components/ui/{card, tooltip}

src/lib/optimizer.ts
  ← src/lib/config.ts         (PricePoint, ChargingBlock)
  ← src/lib/grid-fees.ts

src/lib/use-prices.ts
  ← src/lib/v2-config.ts     (HourlyPrice, DailySummary, MonthlyStats, GenerationData)

src/lib/charging-helpers.ts
  ← src/lib/v2-config.ts     (HourlyPrice)

src/lib/price-cache.ts
  ← src/lib/supabase.ts

src/lib/entsoe.ts
  ← src/lib/config.ts         (PricePoint)

src/app/api/prices/batch/route.ts
  ← src/lib/smard.ts
  ← src/lib/awattar.ts
  ← src/lib/entsoe.ts
  ← src/lib/energy-charts.ts
  ← src/lib/energy-forecast.ts
  ← src/lib/csv-prices.ts
  ← src/lib/price-cache.ts

src/app/api/generation/route.ts
  ← (no local lib imports; raw SMARD HTTP calls)
```

---

## Static Data Files (public/)

```
public/data/
  smard-prices.json       Compact hourly prices: [{t, p}] (EUR/MWh)
  smard-prices-qh.json    Compact QH prices: [{t, p}]
  smard-generation.json   Compact generation: [{t, s, w, l}] (solar, wind, load MW)
```

Updated daily by GitHub Actions (`.github/workflows/update-smard-data.yml`).
