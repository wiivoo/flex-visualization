---
quick_id: 260415-c4z
description: Improve insights page — actionable sensitivity charts and price patterns heatmap
date: 2026-04-15
status: complete
commits:
  - 4bfc092
  - 94c271c
---

# Quick Task 260415-c4z — Summary

## Goal

1. Make the SensitivityCurves charts on `/v2/insights` more actionable — clarify what's pinned, what's varying, and what action the user should take.
2. Add a new "Price patterns" heatmap visualizing average ct/kWh by month × quarter-hour-of-day.

## Changes

### Task 1 — Sensitivity charts rework (`4bfc092`)

- `src/lib/insights-sweep.ts` — added `computeElasticity(points, pinnedX)` helper using central difference.
- `src/components/v2/insights/SensitivityCurves.tsx` — switched from `LineChart` to `ComposedChart`. Each sub-chart now shows:
  - Dashed gray baseline at the pinned y-value
  - Emerald-tinted "gain" area above baseline, red-tinted "loss" area below
  - Emerald optimum marker at curve max with `+€N/yr` label
  - Existing red pinned dot retained
  - Elasticity readout: `€X/yr per unit`
  - Dynamic takeaway sentence per chart
- Card description now lists all currently-pinned parameter values once.

### Task 2 — Price patterns heatmap (`94c271c`)

- `src/lib/price-patterns.ts` — new module. `computeMonthlyQhAverages(hourlyQH)` groups QH points by month × qh-of-day, averages ct/kWh, and computes p5/p95 for color clamping.
- `src/components/v2/insights/PricePatternsHeatmap.tsx` — new card. 12 × 96 cell grid, sequential emerald → amber → red color scale clamped to p5–p95, month Y labels, 3h X ticks, native title tooltips, legend gradient strip.
- `src/app/v2/insights/page.tsx` — wires `PricePatternsHeatmap` directly below `SensitivityCurves`, sourced from `usePrices().hourlyQH`.

## Verification

- `npm run build` passes (Next.js 16.1.1 / Turbopack, all 15 routes generated).
- No new lint errors.
- Files all under 500 lines.

## Deviations

None.
