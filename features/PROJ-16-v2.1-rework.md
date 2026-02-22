# PROJ-16: V2.1 Dashboard Rework

**Status:** In Progress
**Priority:** P0
**Created:** 2026-02-22

## Overview
Major UX rework of the v2 storytelling flow based on stakeholder feedback. Focus on clarity, interactivity, and data-backed visualizations.

## New Step Structure (5 steps)
1. **Price Explorer** — Enhanced with PV/wind generation overlay, day/night icons, day vs night spread (not negative hours)
2. **Smart Charging** — Draggable time range on chart, mileage-based charge estimation, clearer baseline vs optimized
3. **Customer Behavior** (NEW) — Heatmap: mileage × frequency → annual value
4. **Value Waterfall** — Data-backed models for forward purchasing, intraday optimization, portfolio effect
5. **Market Context** — Enhanced with night spread metric

**Removed:** Portfolio Scale step (was Step 4)

## Detailed Changes

### Step 1: Price Explorer
- [x] Fix calendar: cannot navigate forward (only backward works)
- [x] Add sun/moon icons for day (6-22h) and night (22-6h) periods
- [x] Add PV/wind generation data as renewable share overlay on price chart
- [x] Replace "negative hours" KPI with day vs night price spread
- [x] Show daytime avg vs nighttime avg price — the spread is the night charging opportunity

### Step 2: Smart Charging (Complete Rewrite)
- [x] Remove vehicle presets (compact/mid/SUV selector)
- [x] Remove start level / target level sliders
- [x] Add draggable arrival/departure time range directly linked to chart
- [x] Add yearly mileage input (5,000 - 40,000 km)
- [x] Add weekly plug-in frequency (2-7 times/week)
- [x] Auto-derive energy per session from mileage + frequency
- [x] Assumption: 18 kWh/100km avg consumption, 11kW wallbox
- [x] Clearer baseline vs optimized: show price curve with highlighted charging windows
- [x] Show explicit cost comparison

### Step 3: Customer Behavior (NEW)
- [x] Heatmap: X = sessions/week, Y = yearly mileage
- [x] Cell color = annual savings (EUR)
- [x] Based on selected day's price data
- [x] Shows "what behavior creates what value"

### Step 4: Value Waterfall (Enhanced)
- [x] Forward purchasing: EEX base vs peak delivery spread model
- [x] Intraday optimization: forecast error re-optimization model
- [x] Portfolio effect: forecasting accuracy by fleet size (sqrt(N))
- [x] Each layer gets a mini-visualization, not just text explanation

### Step 5: Market Context (Enhanced)
- [x] Add "night spread" = avg night price - cheapest night hour
- [x] Show night price band (22:00-06:00) specifically
- [x] Keep seasonal heatmap and regulatory timeline

## Technical Changes
- New API: `/api/generation?date=YYYY-MM-DD` — SMARD solar+wind+load data
- Updated types in `v2-config.ts`
- Enhanced `use-prices.ts` with generation data and day/night metrics
- Deleted: `Step4PortfolioScale.tsx`
- Added: `Step3CustomerBehavior.tsx`
- Updated middleware for new API route

## Data Sources
- SMARD filter 4068: Solar PV (MW)
- SMARD filter 4067: Wind Onshore (MW)
- SMARD filter 1225: Wind Offshore (MW)
- SMARD filter 410: Total Grid Load (MW)
