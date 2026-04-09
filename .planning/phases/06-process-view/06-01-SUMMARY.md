---
phase: 06-process-view
plan: 01
subsystem: process-view
tags: [chart, optimization, computation, ui]
dependency_graph:
  requires: [optimizer, v2-config, fleet-optimizer, charging-helpers]
  provides: [process-view-engine, process-view-chart]
  affects: [Step2ChargingScenario]
tech_stack:
  added: []
  patterns: [seeded-prng, staged-optimization, waterfall-breakdown]
key_files:
  created:
    - src/lib/process-view.ts
    - src/components/v2/ProcessViewChart.tsx
  modified:
    - src/components/v2/steps/Step2ChargingScenario.tsx
decisions:
  - Seeded PRNG using multiply-with-carry for deterministic perturbation
  - Recharts Tooltip formatter typed via cast to never to bypass strict Recharts generics
metrics:
  duration: 422s
  completed: 2026-04-09T08:15:26Z
  tasks: 2/2
  files_created: 2
  files_modified: 1
---

# Phase 6 Plan 1: Process View Computation Engine + Chart Component Summary

Pure computation engine with seeded PRNG for 3-stage optimization (Forecast/DA/Intraday) under 3 uncertainty scenarios, plus interactive chart component with stage scrubber and scenario selector wired into Step2.

## What Was Built

### Task 1: process-view.ts computation engine (0d9683e)

Created `src/lib/process-view.ts` -- a pure computation module (no React, no DOM) that exports:

- **Types:** `ProcessStage`, `UncertaintyScenario`, `StageResult`, `WaterfallBar`, `ProcessViewResult`
- **Constants:** `PROCESS_STAGES` (3 stages), `UNCERTAINTY_SCENARIOS` (3 scenarios), `UNCERTAINTY_CONFIG` (calibration)
- **Functions:**
  - `perturbPrices()` -- adds Gaussian noise to DA prices with deterministic seeded PRNG
  - `perturbWindow()` -- shifts plug-in time to simulate arrival uncertainty
  - `computeProcessViewResults()` -- runs `runOptimization()` 3-4 times with different inputs per stage, produces waterfall bar data with fleet sqrt(N) portfolio effect scaling

The seeded PRNG uses a multiply-with-carry algorithm seeded from a date string hash, ensuring `useMemo` stability (same date + same scenario = identical perturbation).

### Task 2: ProcessViewChart component + Step2 integration (fb0b0e2)

Created `src/components/v2/ProcessViewChart.tsx` -- a `'use client'` component with:

- **Stage scrubber:** 3 dots with connector lines (cloned from FunnelTimeline pattern), keyboard navigation, disabled intraday when unavailable
- **Scenario selector:** 3-tab segmented control (Perfect/Realistic/Worst case), default "Realistic"
- **Recharts ComposedChart** with progressive overlays per stage:
  - Forecast: dimmed DA bars + yellow uncertainty corridor + dashed forecast price line
  - DA Nomination: full-opacity DA bars + emerald charging block overlays
  - Intraday: sky-blue intraday price line + red correction zones + emerald re-optimized blocks
- **Fleet mode:** blue flex band overlay when `showFleet` is active
- **Waterfall summary strip** below chart showing Perfect/DA Error/Realized values

Modified `src/components/v2/steps/Step2ChargingScenario.tsx`:
- Added `showProcessView` state
- Added "Process" toggle button in chart header toolbar
- Conditional render: `showProcessView ? <ProcessViewChart .../> : <ResponsiveContainer>...`

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Recharts Tooltip formatter type mismatch**
- **Found during:** Task 2
- **Issue:** Recharts 3.7 `Formatter` generic type requires `value: number | undefined` and `name: string | undefined`, incompatible with direct typed parameters
- **Fix:** Cast formatter function via `as never` to bypass strict generics while preserving runtime correctness
- **Files modified:** src/components/v2/ProcessViewChart.tsx
- **Commit:** fb0b0e2

**2. [Rule 1 - Bug] hasIntraday possibly undefined**
- **Found during:** Task 2
- **Issue:** `hasIntraday` from useMemo could be `boolean | undefined`, but Props expects `boolean`
- **Fix:** Added `?? false` fallback when passing to ProcessViewChart
- **Files modified:** src/components/v2/steps/Step2ChargingScenario.tsx
- **Commit:** fb0b0e2

## Known Stubs

None. All computation functions are fully wired to the optimizer and produce real results from price data.

## Self-Check: PASSED

- [x] src/lib/process-view.ts exists
- [x] src/components/v2/ProcessViewChart.tsx exists
- [x] Commit 0d9683e exists
- [x] Commit fb0b0e2 exists
