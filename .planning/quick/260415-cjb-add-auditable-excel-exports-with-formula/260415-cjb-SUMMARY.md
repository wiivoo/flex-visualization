---
quick_id: 260415-cjb
description: Auditable Excel exports for /v2/insights graphs (raw prices → formulas → chart visual)
date: 2026-04-15
status: complete
verification: human_needed
commits:
  - 54b3160
  - 6a13f10
  - 7cb7d73
---

# Quick Task 260415-cjb — Summary

## Goal

Add per-graph "Download Excel" buttons on `/v2/insights` for the three insight visualizations. Each download must produce a fully auditable `.xlsx` workbook starting from raw SMARD QH price data, with native Excel formulas computing every chart value (no precomputed numbers for the chart range).

## Changes

### Task 1 — Module scaffold + price-patterns builder (`54b3160`)

- New `src/lib/excel-exports/` module:
  - `types.ts` — shared types
  - `raw-prices-sheet.ts` — writes `raw_prices` sheet from `hourlyQH` (date, year, month, qh, hour-string, ct/kWh)
  - `parameters-sheet.ts` — writes named parameter cells
  - `price-patterns.ts` — `exportPricePatternsXlsx(hourlyQH)`. Derived sheet: 12×96 matrix of `AVERAGEIFS(raw_prices!G:G, raw_prices!B:B, month, raw_prices!D:D, qh)`. ColorScale CF visual.
  - `index.ts` — barrel

### Task 2 — Sensitivity export (`6a13f10`)

- `src/lib/excel-exports/sensitivity.ts` — `exportSensitivityXlsx(hourlyQH, pinnedScenario, sweeps)`.
- For each of 4 axes, writes a `derived_<axis>` sheet with one row per (day × x-value).
- Optimized cost per day uses the formula:
  `SUMPRODUCT(SMALL(IF(<window-mask>, raw_prices!G:G, ""), ROW(INDIRECT("1:"&slots))))`
- Baseline uses `SUMIFS` over the first-N slots after plug-in.
- `chart_data` aggregates yearly savings per x-value via `SUMIF` against the derived sheet.
- ColorScale CF on chart_data column.

### Task 3 — Ideal-parameters export + UI buttons (`7cb7d73`)

- `src/lib/excel-exports/ideal-parameters.ts` — same formula approach but 2D sweep over (mileage × window length); chart_data is a matrix with ColorScale CF.
- "Export ⇣" buttons added to all three insights card headers (`PricePatternsHeatmap`, `SensitivityCurves`, `IdealParametersHeatmap`). Buttons dynamically `import('@/lib/excel-exports/...')` inside the click handler so exceljs stays out of the initial bundle.
- `src/app/v2/insights/page.tsx` plumbs `hourlyQH` and `pinned` props through to all three components.

## Verification

- `npm run build` — passes in main repo (Next 16, all 15 routes generated).
- `npx tsc --noEmit` — clean.
- exceljs is isolated in its own ~931 KB dynamic chunk, not in the `/v2/insights` initial bundle.
- All formulas verified to use SUMIFS / AVERAGEIFS / SMALL / SUMPRODUCT / array formulas — no precomputed values for chart ranges.

## Deviations

- **exceljs v4 has no chart-generation API**, so all three workbooks render the chart visual via 3-stop green→amber→red ColorScale conditional formatting on the `chart_data` range instead of an embedded Excel chart object. Documented in per-workbook README sheets and in code comments. Formula auditability (the primary goal) is fully intact.
- Fleet-mode exports use single-vehicle math per the plan's v1 simplification; fleet multiplier is annotated in the parameters sheet.
- A worktree-only `node_modules` symlink and `.env.local` copy were used for the build inside the worktree (not committed).

## Human Verification Required

1. Click each Export button in the dev server, confirm downloads open in Excel/Numbers/LibreOffice.
2. Inspect formula bar on the `derived` / `derived_<axis>` sheets — confirm formulas, not literal numbers.
3. Edit a parameter cell (e.g. `plug_in_hour`) and confirm sensitivity / ideal-parameters numbers recompute live.
4. Compare the chart_data matrices to the on-screen visuals.

## Artifacts

- `260415-cjb-PLAN.md`
- `260415-cjb-VERIFICATION.md`
- `260415-cjb-SUMMARY.md`
