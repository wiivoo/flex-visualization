---
phase: 08-plug-in-battery-business-case-de-nl
plan: 07
subsystem: battery-roi-regulation
tags: [roi, regulation, component, hook, annual-rollup]
requires:
  - src/lib/battery-config.ts (08-02)
  - src/lib/battery-optimizer.ts (08-04)
  - src/lib/use-battery-profiles.ts (08-06)
  - src/components/battery/BatteryDayChart.tsx (08-06)
provides:
  - src/lib/use-battery-year.ts
  - src/components/battery/BatteryRoiCard.tsx
  - src/components/battery/RegulationPanel.tsx
  - /battery page wiring for BatteryDayChart + BatteryRoiCard + RegulationPanel
affects:
  - src/app/battery/page.tsx
requirements:
  - BATT-08
  - BATT-09
metrics:
  completed_date: "2026-04-17"
  files_created: 3
  files_modified: 1
---

# Phase 08 Plan 07: ROI Card + Regulation Panel Summary

Shipped the annual-economics layer for `/battery`: `useBatteryYear` rolls a full year of price data into `AnnualBatteryResult`, `BatteryRoiCard` turns that into annual savings / payback / break-even / NPV plus a 12-month chart, and `RegulationPanel` exposes the DE and NL regulation controls. The `/battery` page now renders the real day chart and the real ROI/regulation row instead of placeholders.

## What Changed

- `src/lib/use-battery-year.ts`
  - Added a pure client hook that combines `usePrices`, `useBatteryProfiles`, `getVariant`, and `runBatteryYear`.
  - Prefers quarter-hour prices, falls back to hourly data, and returns `null` while dependencies are missing.
  - Uses scalar scenario dependencies, not the whole scenario object.
- `src/components/battery/BatteryRoiCard.tsx`
  - Added four hero metrics: annual savings, simple payback, break-even year, and 10-year NPV.
  - Added a 12-month stacked revenue chart with cumulative-savings line.
  - Added VAT footnote logic and a collapsible formula breakdown.
- `src/components/battery/RegulationPanel.tsx`
  - Added DE controls for 800W vs 2000W feed-in cap, export-prohibited tooltip, and §14a status.
  - Added NL controls for post-2027 regime, terugleverkosten toggle, export-compensation input, and BTW footnote.
- `src/app/battery/page.tsx`
  - Replaced the `day-chart` placeholder with `BatteryDayChart`.
  - Replaced the `roi-regulation` placeholders with `BatteryRoiCard` and `RegulationPanel`.

## Verification

| Check | Result |
|---|---|
| `npx tsc --noEmit -p .` | PASS |
| `npx vitest run src/lib/__tests__/battery-optimizer.test.ts` | PASS (16/16) |
| `npm run build` | PARTIAL: app compiled successfully, then failed during page-data collection for `/api/prices/batch` because `NEXT_PUBLIC_SUPABASE_URL` / Supabase env is missing |

## Notes

- The build failure is not caused by the new ROI / regulation work. Turbopack compiled the app successfully before failing on the existing Supabase configuration requirement in the batch API route.
- `RegulationPanel.tsx` was the only remaining uncommitted work in the Phase 8 executor worktree; this summary closes that gap and makes 08-07 merge-ready.

## Self-Check

- `src/lib/use-battery-year.ts` exists and exports `useBatteryYear`.
- `src/components/battery/BatteryRoiCard.tsx` exists and exports `BatteryRoiCard`.
- `src/components/battery/RegulationPanel.tsx` exists and exports `RegulationPanel`.
- `/battery` now renders the real day-chart and ROI/regulation components from `src/app/battery/page.tsx`.
