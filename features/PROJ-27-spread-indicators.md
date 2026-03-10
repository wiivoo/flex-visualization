# PROJ-27: Spread Indicators & Scenario Cards

## Status: Deployed
**Created:** 2026-02-27
**Last Updated:** 2026-03-10

## Dependencies
- PROJ-1 (SMARD Data Integration) — price data required
- PROJ-12 (Interactive Price Chart) — host component
- PROJ-18 (Mini Calendar) — selected date drives spreads
- PROJ-2 (Price Optimization Engine) — plugInTime/departureTime from ChargingScenario

---

## Overview

Three scenario cards (Overnight, Full Day, 3-Day) showing market spread and capturable savings per charging mode. Each card displays:
- **Selected day** savings (ct/kWh and EUR)
- **Last 4 weeks** backward-looking average savings
- **Last 52 weeks** backward-looking average savings
- **Market spread** (max − min in ct/kWh)
- **Time window** label showing the applied hours
- **Clickable** — clicking a card switches the active charging mode

An expandable **Session Cost Detail Panel** below the cards shows the hour-by-hour (or quarter-hourly) breakdown for the active mode: baseline (first N slots) vs. optimized (cheapest N slots), with averages and EUR costs.

---

## Implementation

### Files
- `src/components/v2/steps/Step2ChargingScenario.tsx` — scenario cards, detail panel, spread computation
- `src/lib/charging-helpers.ts` — `computeSpread()`, `computeWindowSavings()`, `buildMultiDayWindow()`

### Scenario Card Windows
| Mode | Window Definition |
|------|-------------------|
| Overnight | plugInTime → departureTime next morning |
| Full Day | plugInTime → plugInTime next day (24h) |
| 3-Day | plugInTime → plugInTime day+3 (72h) |

### Per-Mode Calculations
Each card computes its own window independently using:
- **Active mode**: uses the user's actual `departureTime`
- **Inactive modes**: use canonical departure (overnight: `(plugInTime+12)%24`, fullday/threeday: `plugInTime`)

This ensures card values remain stable when switching between modes.

### Backward-Looking Savings
- **Last 4 weeks**: averages savings across the trailing 28 days
- **Last 52 weeks**: averages savings across the trailing 365 days
- Each mode builds its own window per historical day

### Session Cost Detail Panel
- Toggles open/closed via "Details" button on each card
- Shows hour-by-hour (or 15-min in QH mode) prices for both baseline and optimized
- Computes averages, EUR costs, and savings
- Adapts to quarter-hourly resolution when 15-min toggle is active

---

## Acceptance Criteria

- [x] Three scenario cards displayed horizontally below the chart
- [x] Each card shows selected day, 4-week, and 52-week savings
- [x] Cards are clickable and switch the active charging mode
- [x] Active card has emerald highlight, inactive cards are muted
- [x] Time window label shown on each card
- [x] Session cost detail panel with hour-by-hour breakdown
- [x] Detail panel supports both hourly and 15-min resolution
- [x] Calculations remain stable when switching between modes
- [x] Departure time changes update the active mode's calculations
- [x] Market spread (max − min) shown on each card
