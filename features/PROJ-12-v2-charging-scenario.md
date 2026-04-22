# PROJ-12: Interactive Price Chart

## Status: Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 935–1317)

## Description

Core visualization: a Recharts ComposedChart showing day-ahead electricity prices with overlaid baseline (immediate) and optimized (cheapest-slot) charging schedules. This is THE graph that makes the concept click for a CEO.

## Modes

| Mode | X-axis span | Window |
|------|------------|--------|
| **Overnight** | Day1 14:00 → Day2 10:00 | Plug-in (14–22h) → Departure (4–10h) |
| **Full Day** | Day1 00:00 → Day2 23:59 | Plug-in (0–23h) → Departure (0–plugIn h), max 24h |

## Resolution Toggle

- **60 min**: Hourly SMARD prices (default)
- **15 min**: Quarter-hourly SMARD prices (with "hourly avg" badge when real QH data not yet published)

## Interactive Elements

- **Drag handles**: Plug-in time (red line) and departure time (blue line) are draggable directly on the chart
- **Grey overlays**: Areas outside the charging window are dimmed
- **Floating cost pills**: Positioned near their respective charging blocks, showing EUR cost + avg ct/kWh
- **Spread corridor**: Faint yellow band between arrival price and lowest window price

## Visual Elements

- Grey price curve with area gradient
- Red dots/line: baseline (immediate) charging hours
- Green dots/line: optimized charging hours
- Colored reference areas behind charging blocks
- Midnight boundary line
- Date labels above each day
- SMARD source link with exact week URL

## Chart Computation

- **Baseline**: first N chronological slots from plug-in time
- **Optimized**: cheapest N slots in window (sorted by price)
- N = ceil(energyPerSession / kwhPerSlot)
- Supports both hourly (1 slot/hr) and quarter-hourly (4 slots/hr) modes

## Acceptance Criteria (all met)

- [x] Plug-in time draggable (14–22h overnight, 0–23h full day)
- [x] Departure time draggable (4–10h overnight, 0–plugIn h full day)
- [x] Baseline (red) and optimized (green) overlays
- [x] Cost pills showing EUR and ct/kWh
- [x] Hourly and 15-min resolution toggle
- [x] Overnight and full day mode toggle
- [x] All changes update visualization instantly
- [x] SMARD data source link
