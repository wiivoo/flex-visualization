---
phase: 06-process-view
fixed_at: 2026-04-09T12:15:00Z
review_path: .planning/phases/06-process-view/06-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 6: Code Review Fix Report

**Fixed at:** 2026-04-09T12:15:00Z
**Source review:** .planning/phases/06-process-view/06-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5
- Fixed: 5
- Skipped: 0

## Fixed Issues

### WR-01: Waterfall only shows drag bars when positive, hides negative corrections

**Files modified:** `src/lib/process-view.ts`
**Commit:** 2eefe59
**Applied fix:** Added `Math.max(0, ...)` clamp to `daErrorCtKwh` and `availErrorCtKwh` in `buildWaterfall()` so that if perturbation noise accidentally produces a better-than-perfect result, the drag values are clamped to zero instead of going negative and breaking the waterfall visual.

### WR-05: Division by zero guard uses fallback of 1 instead of actual energy

**Files modified:** `src/lib/process-view.ts`
**Commit:** 2eefe59
**Applied fix:** Added early return in `computeProcessViewResults()` when `perfectResult.energy_charged_kwh === 0`. Returns all-zero waterfall data instead of dividing by a fallback value of 1 kWh. Removed the `|| 1` fallback since the zero case is now handled before reaching it.

### WR-03: Charging block hour comparison does not handle overnight windows

**Files modified:** `src/components/v2/ProcessViewChart.tsx`
**Commit:** 18b8064
**Applied fix:** Added overnight wrap detection (`endH <= startH`) in `buildChartData()` charging block overlap check. When a block wraps midnight, uses `hour >= startH || hour < endH` instead of the non-wrapping `hour >= startH && hour < endH`.

### WR-04: Same overnight bug in ReferenceArea block rendering

**Files modified:** `src/components/v2/ProcessViewChart.tsx`
**Commit:** 18b8064
**Applied fix:** Changed DA Nomination and Intraday ReferenceArea rendering from `.map()` to `.flatMap()` with overnight wrap handling. When `endH <= startH`, splits into two ReferenceAreas: one from `startIdx` to end of chart, and one from chart start to `endIdx`. Applied identically to both DA and Intraday stage blocks.

### WR-02: useMemo dependency array missing fleetConfig toggle guard

**Files modified:** `src/components/v2/steps/Step2ChargingScenario.tsx`
**Commit:** b7c8342
**Applied fix:** Changed `processResult` useMemo to use `deferredFleetConfig` instead of `fleetConfig` in both the computation body (`showFleet ? deferredFleetConfig : null`) and the dependency array. This is consistent with how fleet config is used elsewhere in the component and avoids unnecessary recomputation during slider drag.

---

_Fixed: 2026-04-09T12:15:00Z_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
