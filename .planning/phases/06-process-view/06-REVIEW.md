---
phase: 06-process-view
reviewed: 2026-04-09T12:00:00Z
depth: standard
files_reviewed: 4
files_reviewed_list:
  - src/lib/process-view.ts
  - src/components/v2/ProcessViewChart.tsx
  - src/components/v2/WaterfallCard.tsx
  - src/components/v2/steps/Step2ChargingScenario.tsx
findings:
  critical: 0
  warning: 5
  info: 3
  total: 8
status: issues_found
---

# Phase 6: Code Review Report

**Reviewed:** 2026-04-09T12:00:00Z
**Depth:** standard
**Files Reviewed:** 4
**Status:** issues_found

## Summary

The Process View feature introduces a 3-stage optimization timeline (Forecast, DA Nomination, Intraday) with uncertainty modeling and waterfall value breakdown. The pure computation engine (`process-view.ts`) is well-structured with deterministic seeded PRNG and clean separation of concerns. The chart components follow project conventions. No critical issues found. Five warnings relate to potential logic bugs (waterfall asymmetry, missing useMemo dependency, charging block overlap detection) and three info items cover minor quality concerns.

## Warnings

### WR-01: Waterfall only shows drag bars when positive, hides negative corrections

**File:** `src/lib/process-view.ts:202-216`
**Issue:** The waterfall builder only pushes DA Error, Avail. Error, and ID Cost bars when the respective values are `> 0`. If the perturbed optimization accidentally finds a *better* solution than the "perfect" one (which can happen because Gaussian noise could shift prices favorably), these values become negative. The result is a "Realized" bar taller than "Perfect" with no intermediate bars explaining the gain. This creates a confusing waterfall where the pieces do not visually add up.
**Fix:** Handle negative drag values as "gain" bars (green instead of red), or clamp the minimum to zero with a comment explaining the edge case:
```ts
// If perturbation accidentally improves on perfect, clamp to zero
const daErrorCtKwh = Math.max(0, toCtKwh(perfectSavingsEur - daSavingsEur))
const availErrorCtKwh = Math.max(0, toCtKwh(daSavingsEur - forecastSavingsEur))
```

### WR-02: useMemo dependency array missing `fleetConfig` toggle guard

**File:** `src/components/v2/steps/Step2ChargingScenario.tsx:523`
**Issue:** The `processResult` useMemo includes `fleetConfig` in its dependency array but passes `showFleet ? fleetConfig : null` to the computation. When `showFleet` is false, changes to `fleetConfig` will still trigger a recomputation of `processResult` even though the fleet config is not used (passed as null). This is a wasted recompute, but more importantly, the dependency array lists `fleetConfig` (the raw object) rather than `deferredFleetConfig` which is used elsewhere for fleet computations.
**Fix:** Use `deferredFleetConfig` consistently, or guard:
```ts
const fleetConfigForProcess = showFleet ? deferredFleetConfig : null
// Then use fleetConfigForProcess in both the useMemo body and dependency array
```

### WR-03: Charging block hour comparison does not handle overnight windows

**File:** `src/components/v2/ProcessViewChart.tsx:61-66`
**Issue:** The charging block overlap check (`p.hour >= startH && p.hour < endH`) fails when a charging block wraps midnight (e.g., `start: "23:00"`, `end: "02:00"`). In that case `endH < startH` and the condition is never true, so no charging bars are rendered for overnight blocks. Given that the default scenario is overnight charging (18:00 to 06:00), some charging blocks from the optimizer may wrap midnight.
**Fix:**
```ts
const wraps = endH <= startH
if (wraps ? (p.hour >= startH || p.hour < endH) : (p.hour >= startH && p.hour < endH)) {
  chargingKw = ...
}
```

### WR-04: Same overnight bug in ReferenceArea block rendering

**File:** `src/components/v2/ProcessViewChart.tsx:291-307`
**Issue:** The DA Nomination and Intraday ReferenceArea rendering also parses `block.start`/`block.end` hours and finds chart indices by matching hours. When a charging block wraps midnight, `endIdx` will be less than `startIdx`, and the fallback `endIdx > startIdx ? endIdx : startIdx + 1` only covers a single slot instead of the full overnight range. This affects visual correctness of the green charging overlays.
**Fix:** Split overnight blocks into two ReferenceAreas (before midnight + after midnight), or handle the wrap explicitly.

### WR-05: Division by zero guard uses fallback of 1 instead of actual energy

**File:** `src/lib/process-view.ts:293`
**Issue:** `const energyKwh = perfectResult.energy_charged_kwh || 1` uses a logical OR, which means if `energy_charged_kwh` is `0` (no charging needed, battery already at target), the waterfall normalizes by 1 kWh. This produces misleading ct/kWh values instead of showing 0. A scenario where start_level >= target_level would trigger this.
**Fix:** If energy is 0, skip waterfall computation and return all-zero bars:
```ts
if (perfectResult.energy_charged_kwh === 0) {
  return { stages, waterfall: [], fleetWaterfall: null, perfectSavingsCtKwh: 0, ... }
}
```

## Info

### IN-01: Unused props in ProcessViewChart

**File:** `src/components/v2/ProcessViewChart.tsx:95-108`
**Issue:** Props `intradayPrices`, `chartWidth`, and `dateSeed` are destructured but never used in the component body. `intradayPrices` is already accessed via `processResult.stages.intraday_adjustment.pricesUsed`, `chartWidth` is unused (ResponsiveContainer handles width), and `dateSeed` is not referenced.
**Fix:** Remove unused props from the interface and destructuring to reduce coupling.

### IN-02: `as never` type casts for Recharts callbacks

**File:** `src/components/v2/ProcessViewChart.tsx:273`, `src/components/v2/WaterfallCard.tsx:154,182`
**Issue:** Multiple `as never` casts are used to work around Recharts typing limitations. While pragmatic, this suppresses all type checking on these callbacks. Already has eslint-disable comments which is acceptable.
**Fix:** Consider creating a typed wrapper or utility for Recharts formatter/label callbacks to centralize the type workaround.

### IN-03: Magic numbers in perturbWindow clamp range

**File:** `src/lib/process-view.ts:144`
**Issue:** The clamp range `Math.max(14, Math.min(23, ...))` uses magic numbers. The 14-23 range implicitly assumes evening plug-in times but is not derived from any constant or the scenario's actual valid range.
**Fix:** Extract to named constants or derive from the scenario:
```ts
const MIN_PLUGIN_HOUR = 14
const MAX_PLUGIN_HOUR = 23
const newHour = Math.max(MIN_PLUGIN_HOUR, Math.min(MAX_PLUGIN_HOUR, hour + shiftHours))
```

---

_Reviewed: 2026-04-09T12:00:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
