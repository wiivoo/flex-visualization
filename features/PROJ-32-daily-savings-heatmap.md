# PROJ-32: Daily Savings Heatmap

**Status:** Deployed
**Priority:** Medium

## Summary

Calendar-style heatmap showing daily savings potential across the full data range. Each cell represents one day, colored by savings magnitude. Clicking a cell selects that date in the main chart.

## Features
- Color scale from low (light) to high (dark green) savings
- Highlights the currently selected date
- Scrolls to show full year of data
- Integrates with the date picker — clicking a day updates the chart

## Key Files
- `src/components/v2/DailySavingsHeatmap.tsx`
- Data computed from `overnightWindows` in `Step2ChargingScenario.tsx`
