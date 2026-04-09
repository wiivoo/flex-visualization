---
phase: 06-process-view
verified: 2026-04-09T09:30:00Z
status: human_needed
score: 8/8 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Toggle Process button and verify chart replacement"
    expected: "Normal chart disappears, ProcessViewChart with stage scrubber and scenario selector appears"
    why_human: "Visual layout, correct chart rendering, no overlap artifacts"
  - test: "Navigate all 3 stages and verify progressive overlays"
    expected: "Forecast: dimmed bars + yellow corridor + dashed forecast line. DA Nom.: full bars + emerald blocks. Intraday: blue price line + red correction zones (or disabled dot if no intraday data)."
    why_human: "Visual overlay correctness, opacity differences, color accuracy"
  - test: "Switch between Perfect / Realistic / Worst case scenarios"
    expected: "Charging blocks shift positions. Waterfall drag bars change size. Perfect scenario shows zero drag bars."
    why_human: "Visual confirmation that perturbation produces visible differences, waterfall animation"
  - test: "Toggle Fleet mode while in process view"
    expected: "Waterfall shows dual bar series (gray single-EV vs blue fleet/car). Fleet drag bars visibly shorter. Blue flex band overlay appears on chart."
    why_human: "Visual comparison of bar sizes, portfolio effect legibility"
  - test: "Toggle Process off to return to normal chart"
    expected: "Normal chart reappears with all previous overlays intact"
    why_human: "State preservation after toggle cycle"
---

# Phase 6: Process View Verification Report

**Phase Goal:** Add a dedicated "process view" mode to the price chart that walks the user through the optimization timeline chronologically (forecast -> DA nomination -> intraday adjustment), with uncertainty modeling and a waterfall value-drag visualization. Works for both single EV and fleet mode -- fleet mode demonstrates the portfolio effect on uncertainty reduction.
**Verified:** 2026-04-09T09:30:00Z
**Status:** human_needed
**Re-verification:** No -- initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Process view mode accessible from chart controls, replaces normal chart temporarily | VERIFIED | Toggle button at Step2 line 2201 (`"Process"`), conditional render at line 2229 (`showProcessView && processResult ? <ProcessViewChart .../>`) |
| 2 | Three chronological stages revealed progressively via scrubber: Forecast / DA Nom. / Intraday | VERIFIED | `PROCESS_STAGES` constant with 3 entries in process-view.ts; stage scrubber UI in ProcessViewChart lines 179-224 with dots, connector lines, keyboard nav |
| 3 | Three uncertainty scenarios selectable: Perfect / Realistic / Worst case | VERIFIED | `UNCERTAINTY_SCENARIOS` constant; segmented control in ProcessViewChart lines 227-241; `uncertaintyScenario` state in Step2 line 117 |
| 4 | Waterfall card decomposes value drag per uncertainty factor, updates per scenario | VERIFIED | WaterfallCard.tsx (227 lines) renders 5 bars: Perfect, DA Error, Avail. Error, ID Cost, Realized. Props receive `uncertaintyScenario`; data recomputed via `processResult` useMemo in Step2 |
| 5 | Chart shows re-optimized charging blocks at each stage with real price data | VERIFIED | `computeProcessViewResults` calls `runOptimization()` 3-4 times with stage-appropriate inputs. ProcessViewChart renders `ReferenceArea` overlays from `charging_schedule` at each stage |
| 6 | Uses actual DA and intraday prices, graceful fallback when intraday unavailable | VERIFIED | DA prices passed directly from `chartPrices`; intraday via `prices.intradayId3`; null-check in `computeProcessViewResults` (line 266); intraday stage dot disabled with `opacity-40 cursor-not-allowed` and tooltip "Intraday data not available for this date" |
| 7 | Fleet mode: waterfall shows reduced uncertainty drag from sqrt(N) portfolio effect; flex band visualizes re-optimization corridor | VERIFIED | `fleetWaterfall` computed with `sqrtN = Math.sqrt(effectiveFleetSize)` dividing drag bars in process-view.ts lines 304-339; flex band overlay via `computeFlexBand` + `fill="#DBEAFE"` in ProcessViewChart lines 358-383 |
| 8 | Switching single/fleet visibly changes the waterfall -- fleet shows smaller drag bars per car | VERIFIED | WaterfallCard dual bar series (`stackId="stack"` for single, `stackId="fleetStack"` for fleet). Fleet bars use blue fills. Portfolio effect note: "sqrt(N) portfolio effect reduces uncertainty per car" |

**Score:** 8/8 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/process-view.ts` | Pure computation: perturbation, staged optimization, waterfall math | VERIFIED (351 lines) | Exports: ProcessStage, UncertaintyScenario, PROCESS_STAGES, UNCERTAINTY_SCENARIOS, UNCERTAINTY_CONFIG, perturbPrices, perturbWindow, computeProcessViewResults, ProcessViewResult, WaterfallBar, StageResult. No React, no DOM. Seeded PRNG (multiply-with-carry), no Math.random(). |
| `src/components/v2/ProcessViewChart.tsx` | Chart-mode component with stage scrubber, scenario selector, progressive overlays | VERIFIED (448 lines) | `'use client'` component. Imports from process-view.ts and fleet-optimizer.ts. Stage scrubber with keyboard nav. Scenario selector. ComposedChart with stage-dependent ReferenceArea overlays. Fleet flex band. |
| `src/components/v2/WaterfallCard.tsx` | Waterfall value-drag visualization with single-EV and fleet dual series | VERIFIED (227 lines) | `'use client'` component. Uses Card/CardContent from shadcn. ComposedChart with invisible-offset stacked bars. Dual series for fleet. Bar labels, portfolio effect note, animation. |
| `src/components/v2/steps/Step2ChargingScenario.tsx` | showProcessView state + toggle + conditional render + WaterfallCard placement | VERIFIED | `showProcessView` state (line 116), toggle button (line 2201), ProcessViewChart conditional render (line 2229), WaterfallCard conditional render (line 3715), processResult useMemo (line 512), uncertaintyScenario/processStage state (lines 117-118) |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| ProcessViewChart.tsx | process-view.ts | imports PROCESS_STAGES, UNCERTAINTY_SCENARIOS, types | WIRED | Line 10-12: imports types and constants |
| Step2ChargingScenario.tsx | ProcessViewChart.tsx | conditional render `showProcessView && processResult` | WIRED | Line 2229-2246: full prop passing |
| Step2ChargingScenario.tsx | WaterfallCard.tsx | conditional render below chart | WIRED | Line 3715-3724: WaterfallCard with all props |
| Step2ChargingScenario.tsx | process-view.ts | computeProcessViewResults in useMemo | WIRED | Lines 512-523: computation guarded by showProcessView |
| process-view.ts | optimizer.ts | runOptimization calls | WIRED | Lines 250, 258, 262, 268: 4 calls for perfect + 3 stages |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| ProcessViewChart.tsx | processResult | Step2 useMemo -> computeProcessViewResults | Yes: calls runOptimization with actual price data from usePrices hook | FLOWING |
| WaterfallCard.tsx | waterfall, fleetWaterfall | processResult.waterfall / processResult.fleetWaterfall | Yes: derived from real optimization savings_eur values | FLOWING |
| ProcessViewChart.tsx | flexBand | computeFlexBand(fleetConfig, prices, ...) | Yes: fleet-optimizer computes from real price data | FLOWING |

### Behavioral Spot-Checks

Step 7b: SKIPPED (no runnable entry points without dev server)

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-----------|-------------|--------|----------|
| PROC-01 | 06-01, 06-02 | Process view mode on chart -- chronological reveal of 3 stages with scrubber | SATISFIED | ProcessViewChart with stage scrubber, toggle in Step2, conditional render |
| PROC-02 | 06-01, 06-02 | Three uncertainty scenarios that update chart + waterfall card | SATISFIED | UNCERTAINTY_SCENARIOS, scenario selector, perturbation functions, WaterfallCard |
| PROC-03 | 06-02 | Fleet mode support -- sqrt(N) portfolio effect in waterfall, flex band | SATISFIED | fleetWaterfall with sqrtN scaling, computeFlexBand overlay, dual bar series |

**Note:** PROC-01, PROC-02, PROC-03 are defined in ROADMAP.md and RESEARCH.md but are missing from REQUIREMENTS.md. This is an administrative gap -- requirements should be added to REQUIREMENTS.md for traceability.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | -- | No TODOs, FIXMEs, placeholders, or stub patterns found in phase 6 files | -- | -- |

### Human Verification Required

### 1. Process View Toggle

**Test:** Click the "Process" button in the chart header toolbar
**Expected:** Normal chart disappears, replaced by ProcessViewChart with stage scrubber (3 dots), scenario selector (3 tabs), and Recharts ComposedChart with DA price bars
**Why human:** Visual layout correctness, element positioning, no overlap artifacts

### 2. Stage Navigation

**Test:** Click through all 3 stage dots. Use ArrowLeft/ArrowRight keys. Try clicking disabled Intraday dot on a date without intraday data.
**Expected:** Forecast: dimmed bars (opacity 0.4) + yellow corridor (#FEF9C3). DA Nom.: full bars + emerald blocks (#D1FAE5). Intraday: blue price line + red correction zones (#FEE2E2) or disabled dot.
**Why human:** Visual overlay correctness, opacity differences, color accuracy, keyboard navigation feel

### 3. Scenario Switching + Waterfall Updates

**Test:** Switch between Perfect / Realistic / Worst case scenarios
**Expected:** Charging block positions change on chart. Waterfall drag bars change size. Perfect scenario: drag bars should be zero (Perfect == Realized). Worst case: largest drag bars.
**Why human:** Visual confirmation that perturbation produces meaningfully different results, waterfall bar animation

### 4. Fleet Mode Portfolio Effect

**Test:** Toggle to Fleet mode while in process view
**Expected:** Waterfall shows dual bar series (single-EV and fleet/car). Fleet drag bars visibly shorter than single-EV. Blue flex band overlay on chart. "sqrt(N) portfolio effect" note visible.
**Why human:** Visual comparison of bar sizes, portfolio effect legibility, dual-series chart readability

### 5. Toggle Return to Normal Chart

**Test:** Click Process button again to return to normal chart
**Expected:** Normal chart reappears with all previous overlays (renewable, intraday funnel if active) intact
**Why human:** State preservation after toggle cycle

### Gaps Summary

No code gaps found. All 8 roadmap success criteria are satisfied at the code level. All 3 artifacts exist, are substantive (351, 448, 227 lines), are fully wired into Step2, and data flows through real optimizer calls.

Administrative note: PROC-01, PROC-02, PROC-03 requirement IDs should be added to `.planning/REQUIREMENTS.md` for full traceability.

5 items require human visual verification to confirm the interactive experience works as intended.

---

_Verified: 2026-04-09T09:30:00Z_
_Verifier: Claude (gsd-verifier)_
