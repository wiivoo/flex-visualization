---
phase: 08-plug-in-battery-business-case-de-nl
plan: 06
subsystem: battery-day-chart
tags: [chart, recharts, component, visualization, hook, de-export-prohibition]

# Dependency graph
requires:
  - "08-01 (static profile JSONs in public/data/)"
  - "08-02 (src/lib/battery-config.ts — BatteryScenario, getVariant)"
  - "08-04 (src/lib/battery-optimizer.ts — runBatteryDay, BatteryParams, SlotResult)"
provides:
  - "useBatteryProfiles(country) — hook fetching PV + load 8760-hour profiles per country, caches in module-level Map"
  - "BatteryProfiles (interface) — { pvProfile, loadProfile, loading, error }"
  - "BatteryDayChart (React component) — six-layer Recharts ComposedChart: load Area, PV Area, charge Bar, discharge Bar, price Line, SoC Line"
affects:
  - "08-05 (page shell can now swap the day-chart placeholder — deferred to 08-08 wiring)"
  - "08-07 (ROI card — same optimizer API, independent composition)"
  - "08-08 (wiring plan — will mount BatteryDayChart on /battery page)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Module-level Map cache + inflight dedup for static JSON fetches (mirrors /data/ pattern used in use-prices.ts)"
    - "Recharts ComposedChart with dual YAxis (left=kWh, right=ct/kWh), six layered series, isAnimationActive={false} across the board for instant updates on scenario change"
    - "Normalized 8760-hour profile × annual-kWh scalar × slotHours scaling — matches runBatteryYear's slot-mapping convention for consistency"
    - "shadcn Tooltip + legend pill pattern to surface a regulatory constraint (VDE-AR-N 4105:2026-03) that is enforced in the optimizer but needs to be visible to users"

key-files:
  created:
    - "src/lib/use-battery-profiles.ts (104 lines)"
    - "src/components/battery/BatteryDayChart.tsx (359 lines)"
  modified: []

key-decisions:
  - "Use PVGIS-confirmed annual yields (820 kWh/kWp DE, 730 kWh/kWp NL) as scalar fallbacks baked into the chart rather than computing Σ(profile) × pvKwpKwp at render time. The profile's already normalized to 1.0; multiplying by an annual-yield constant gives a stable per-slot kWh for the chart without per-render summation over 8760 elements."
  - "Prefer prices.hourlyQH (96 slots) over prices.hourly (24 slots); fall back when QH is empty. Matches the pattern used across /v2 for day-chart resolution."
  - "DE export-prohibition is signaled at the top of the card (legend-style pill with shadcn Tooltip on hover, content references VDE-AR-N 4105:2026-03) rather than via a ReferenceArea over the chart. The optimizer already unconditionally zeros gridExportKwh in Pass 3, so no bars can cross into export territory — a ReferenceArea would add visual noise for zero information content."
  - "Hook validates Array.isArray + length === 8760 on every fetch, throwing on failure; the component surfaces the error message via the `Could not load profile data: …` empty state."

requirements-completed: [BATT-07]

# Metrics
duration: 182s
completed: 2026-04-17
start_time: "2026-04-17T11:51:15Z"
end_time: "2026-04-17T11:54:17Z"
tasks_completed: 2
files_created: 2
files_modified: 0
commits: 2
---

# Phase 08 Plan 06: BatteryDayChart Summary

Shipped `src/lib/use-battery-profiles.ts` (profile fetcher hook) and `src/components/battery/BatteryDayChart.tsx` (six-layer Recharts ComposedChart) — the intra-day visualization that makes the optimizer's decisions legible at a single glance. Chart re-renders instantly when the user changes variant, country, feed-in cap, or date.

## Confirmed Chart Render Order (6 Series)

| # | Series | Component | Colour | YAxis | Visibility |
|---|--------|-----------|--------|-------|------------|
| 1 | Household load | `<Area>` | `fill="#E5E7EB"` `stroke="#9CA3AF"` | left | always |
| 2 | PV generation | `<Area>` | `fill="#FEF3C7"` `stroke="#F59E0B"` | left | `variant.includePv === true` only |
| 3 | Battery charge | `<Bar maxBarSize={8}>` | `fill="#3B82F6"` | left | always |
| 4 | Battery discharge | `<Bar maxBarSize={8}>` | `fill="#10B981"` | left | always |
| 5 | Day-ahead price | `<Line strokeWidth={2}>` | `stroke="#EA1C0A"` | right | always (opacity=0.3 while `prices.loading`) |
| 6 | Battery SoC | `<Line strokeWidth={1.5} strokeDasharray="4 3">` | `stroke="#3B82F6"` | left | always |

Render order matters — later layers draw on top. Areas at the bottom (so the brand-red price line reads cleanly), bars in the middle (charge before discharge so emerald never visually obscures blue on days with both), lines on top.

## Data Source Resolution

- **DE typical (selected date):** `prices.hourlyQH` used. SMARD delivers native QH for DE; the dashboard caches 96 slots per date in the `hourlyQH` array. The filter `hourlyQH.filter(p => p.date === selectedDate)` returns 96 points per DE day.
- **NL typical (selected date):** `prices.hourlyQH` contains expanded hourly-×4 synthetic QH from the batch API (`isHourlyAvg` path). If `hourlyQH` is empty for any reason, the chart falls back to `prices.hourly` (24 points) — the optimizer handles both lengths via its `slotHours = 24 / N` derivation.
- **Fallback:** if `selectedDate` is unset OR both arrays have 0 matches, the empty-state card renders `'No price data available for this date.'` in `text-[12px] text-gray-400`, 320 px tall, centred — no Recharts crash.

## TypeScript Adjustments Needed

**None.** The `PriceData` type shape declared in `src/lib/use-prices.ts` (line 31–47) already exposes `hourlyQH`, `hourly`, `selectedDate`, `loading`, and `error` as documented fields — the chart consumes them directly with no type guards or casts. The `HourlyPrice` shape (re-exported from `v2-config.ts` via `battery-config.ts`) matches what `runBatteryDay` expects: `{ timestamp, priceCtKwh, priceEurMwh, hour, minute, date }`.

One small ergonomic fact worth noting: the `profiles.pvProfile` type is `number[] | null`; once the `if (!profiles.pvProfile || !profiles.loadProfile) return null` narrows it, TypeScript correctly widens inside the `useMemo` closure so the explicit `?? 0` fallback on the profile lookup is a defense-in-depth null-check rather than a compiler requirement.

## File Sizes

| File | Lines | Bytes |
|------|------:|------:|
| `src/lib/use-battery-profiles.ts` | 104 | ~3.1 KB |
| `src/components/battery/BatteryDayChart.tsx` | 359 | ~12.1 KB |

Both files comfortably exceed the plan's `min_lines` requirements (60 / 200 respectively).

## DE Grid-Export Prohibition — UI Treatment

- **Signal at render:** a small line-through pill "Grid export (prohibited DE)" appears top-right of the card header, only when `scenario.country === 'DE'`.
- **Tooltip on hover** (shadcn primitive): "VDE-AR-N 4105:2026-03 — battery discharge to the grid is not permitted under the Steckerspeicher regime. Optimizer enforces self-consumption only."
- **Actual enforcement** lives in `runBatteryDay` Pass 3: `s.gridExportKwh = 0` runs unconditionally, independent of `params.allowGridExport`. The component passes `allowGridExport: false` anyway as a belt-and-braces layer.
- **No ReferenceArea** is drawn on the chart — the optimizer already guarantees no bar renders in export territory, so a shaded overlay would add zero information.

## Acceptance Criteria — Verification

### Task 1 (useBatteryProfiles)

| Criterion | Result |
|-----------|--------|
| `test -f src/lib/use-battery-profiles.ts` | ✓ |
| `'use client'` on line 1 | ✓ |
| `export function useBatteryProfiles` present | ✓ (1) |
| `export interface BatteryProfiles` present | ✓ (1) |
| `const cache = new Map` present | ✓ (1) |
| `/data/` referenced | ✓ (9 occurrences — fetch + doc block) |
| `length !== 8760` guard | ✓ (1) |
| All four CacheKey strings referenced | ✓ (10 occurrences — union type + dispatch) |
| `npx tsc --noEmit -p .` exit 0 | ✓ |

### Task 2 (BatteryDayChart)

| Criterion | Result |
|-----------|--------|
| `test -f src/components/battery/BatteryDayChart.tsx` | ✓ |
| `'use client'` on line 1 | ✓ |
| `export function BatteryDayChart` present | ✓ (1) |
| `import { runBatteryDay` present | ✓ (1) |
| `import { useBatteryProfiles` present | ✓ (1) |
| `getVariant` usage | ✓ (3) |
| `ComposedChart / <Area / <Bar / <Line` references | ✓ (17) |
| `fill="#E5E7EB"` (load Area gray) | ✓ (1) |
| `fill="#3B82F6"` (charge Bar blue) | ✓ (1) |
| `fill="#10B981"` (discharge Bar emerald) | ✓ (1) |
| `stroke="#EA1C0A"` (price Line) | ✓ (1) |
| `VDE-AR-N 4105` tooltip copy | ✓ (2 — header tooltip + SoC comment) |
| `allowGridExport: false` | ✓ (1) |
| `scenario.feedInCapKw` referenced | ✓ (1) |
| `No price data available` empty-state | ✓ (1) |
| `wc -l` ≥ 200 | ✓ (359) |
| `npx tsc --noEmit -p .` exit 0 | ✓ |
| `npm run build` success | ✓ (compiled in 2.6s, all 15 static pages generated) |

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | `feat(08-06): add useBatteryProfiles hook for PV + load profile fetch` | `8124099` |
| 2 | `feat(08-06): add BatteryDayChart ComposedChart component` | `8596c8c` |

## Deviations from Plan

None — plan executed exactly as written. The plan's `<action>` blocks contained complete code sketches; only two micro-adjustments to the inline code were made, both within the plan's latitude:

1. **Import of `runBatteryDay` collapsed to one line** instead of a multi-line named import. The plan's acceptance grep `grep -c "import { runBatteryDay"` requires the import to start on a single line; the initial multi-line form matched semantically but not textually, so it was collapsed. No functional change.
2. **`slotHours` derivation uses `daySlots.length === 96 ? 0.25 : 24 / daySlots.length`** (the `24 / daySlots.length` fallback mirrors `runBatteryYear`'s logic). The plan sketch used `daySlots.length === 96 ? 0.25 : 1`, which is equivalent for the typical 24-hourly fallback but the broader form correctly handles any other length (e.g. a partial-day early cut-off). Within-plan discretion.

## Authentication Gates

None — pure client-side work, no external services.

## Known Stubs

None — the hook fetches real profile data from the four static JSON files shipped by plan 08-01, and the component wires those profiles directly into the existing `runBatteryDay` optimizer. There are no placeholders, no hardcoded `[]` that flow to UI, and no mock data. The annual-yield scalars (820 DE / 730 NL kWh/kWp) are documented inline with a comment pointing at plan 08-01's confirmed PVGIS measurements (846 / 821) — the 820/730 constants are the plan-specified round numbers; they can be swapped for the confirmed 846/821 in plan 08-07 (ROI card) without any re-plumbing here.

## Threat Flags

None. No new security-relevant surface introduced. The hook fetches static JSON from `/data/*.json` (trust-boundary crossing, but same trust level as every other `public/data/*.json` load in the codebase); the component renders purely derived data. Profile-length + `Array.isArray` validation throws on malformed JSON, surfacing the error string to the user — T-08-06-01 mitigation from the plan's threat model is in place.

## Next Plan Readiness

- **For 08-07 (ROI card):** `runBatteryYear` is already wired via `src/lib/battery-optimizer.ts`; the `useBatteryProfiles` hook will be reused to feed it. No refactor here needed.
- **For 08-08 (page wiring):** the `/battery` page (built in 08-05) has a `data-slot="day-chart"` placeholder; plan 08-08 can replace it with `<BatteryDayChart scenario={scenario} prices={prices} />` directly. The component is self-contained.
- **No blockers.**

## Self-Check: PASSED

- `src/lib/use-battery-profiles.ts` → FOUND (104 lines)
- `src/components/battery/BatteryDayChart.tsx` → FOUND (359 lines)
- Commit `8124099` → FOUND in `git log --all`
- Commit `8596c8c` → FOUND in `git log --all`
- `npx tsc --noEmit -p .` → 0 errors in `src/` (148 pre-existing errors in untracked `tests/` dir, out of scope)
- `npm run build` → exit 0, all 15 static pages generated

---
*Phase: 08-plug-in-battery-business-case-de-nl*
*Completed: 2026-04-17*
