# PROJ-34: Excel Session Export

**Status:** Deployed
**Priority:** Medium

## Summary

Export button in the dashboard header (next to Share) that generates a multi-sheet Excel file with the full session breakdown for the last 365 days.

## Excel Sheets

### 1. Scenario
All input parameters: vehicle, battery, charge power, mileage, consumption, energy per session, weekly plug-ins, sessions/year, charging window, mode.

### 2. Statistics
Yearly aggregates: total scaled savings, avg/median/P10/P25/P75/P90 daily savings, standard deviation, avg baseline/optimized prices, spread statistics, negative/zero savings day counts.

### 3. Monthly
Per-month breakdown: scaled savings, avg daily savings, sessions/month, avg baseline/optimized prices, spread min/max/avg, weekday/weekend day counts. Sorted recent-first.

### 4. Sessions
One row per day with: date, day-of-week, weekend flag, window slots, baseline avg, optimized avg, spread, savings, min/max price, cheapest/most expensive hour, and hour-by-hour prices for every slot in the charging window. Sorted recent-first.

## Technical Details
- Uses SheetJS (`xlsx` npm package) for browser-side Excel generation
- Filtered to last 365 days only (no multi-year data dump)
- Excludes projected/forecast data
- Export button only appears when session data is loaded
- File naming: `flex-sessions-{country}-{date}.xlsx`

## Data Flow
- `Step2ChargingScenario` exposes export handler to `V2Page` via `onExportReady` callback
- Page renders the Export button in the header when handler is available
- Export function reads pre-computed `overnightWindows` (no redundant calculation)

## Key Files
- `src/lib/excel-export.ts` — Excel generation + download
- `src/app/v2/page.tsx` — Export button in header
- `src/components/v2/steps/Step2ChargingScenario.tsx` — `onExportReady` callback
