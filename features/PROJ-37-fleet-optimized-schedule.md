# PROJ-37: Fleet Optimized Schedule

## Status: In Review
**Created:** 2026-04-02
**Last Updated:** 2026-04-02

## Dependencies
- Requires: PROJ-35 (Fleet Designer) — `FleetConfig` type and fleet state
- Requires: PROJ-36 (Flex Band Overlay) — `computeFlexBand` function, band data, chart integration

## Overview

A solid line within the flex band showing the **actual optimized aggregate charging schedule** — the fleet's total kW draw at each time slot, placed to minimize total energy cost against the price curve. The optimizer operates directly on the flex band constraints: at each slot, it must draw at least `lazyKw` (mandatory) and at most `greedyKw` (maximum), and must deliver enough total energy to satisfy all vehicles' SoC targets.

The optimized line visually proves it stays within the band, and a KPI summary shows fleet-level savings compared to greedy (charge-ASAP) baseline.

## User Stories

1. **As a** fleet manager, **I want to** see the price-optimal charging schedule within the flex band **so that** I can understand exactly when and how much the fleet should charge to minimize cost.

2. **As a** business development user, **I want to** see fleet savings compared to greedy charging **so that** I can quantify the business case for smart fleet charging to stakeholders.

3. **As a** analyst, **I want to** see the optimized line track cheap price hours **so that** I can verify the optimizer is correctly exploiting price volatility.

4. **As a** user, **I want to** see a KPI summary with fleet baseline cost, optimized cost, and savings **so that** I have concrete EUR figures for the selected day.

5. **As a** fleet manager, **I want to** see which hours are constrained (optimized line = lazy bound) **so that** I understand where the fleet has no choice but to charge, regardless of price.

## Acceptance Criteria

### Optimizer Algorithm (`fleet-optimizer.ts`)
- [ ] New function `optimizeFleetSchedule(band: FlexBandSlot[], prices: HourlyPrice[], totalEnergyKwh: number): FleetScheduleSlot[]`
- [ ] Algorithm (greedy on aggregate flex band):
  1. For each slot, `mandatoryKw = lazyKw` (must charge this much, no choice)
  2. `flexibleKw = greedyKw - lazyKw` (additional capacity available if price is good)
  3. Allocate all mandatory kW first → compute remaining energy needed
  4. Sort remaining flexible capacity by price (ascending)
  5. Fill cheapest flexible slots up to `greedyKw` until total energy target is met
  6. Result: `optimizedKw` at each slot, where `lazyKw ≤ optimizedKw ≤ greedyKw`
- [ ] Total energy delivered by the schedule equals the fleet's total energy requirement (sum of all cohorts' charge needs)
- [ ] The schedule is feasible: never below lazy bound, never above greedy bound

### Chart Rendering
- [ ] Optimized schedule renders as a solid emerald line (#10B981), 2.5px width, within the flex band — matches TheoryOverlay's "Price-optimal" line style
- [ ] Line connects `optimizedKw` values across all slots in the overnight window
- [ ] At constrained slots (optimizedKw ≈ lazyKw, within 1%), the line visually hugs the lower bound — no special styling needed, the proximity makes it obvious
- [ ] At slots where the optimizer chose NOT to charge (optimizedKw = lazyKw and lazyKw = 0), the line sits at zero

### KPI Summary
- [ ] When fleet mode is active and "Fleet" sub-toggle is selected, a compact KPI row appears below the fleet config panel (or replaces the single-EV session cost area)
- [ ] KPIs shown:
  - **Fleet size**: "100 EVs" 
  - **Total energy**: "XXX kWh" (sum of all vehicles' charge needs for this session)
  - **Baseline cost**: "XX.XX EUR" (greedy charging — charge at arrival prices)
  - **Optimized cost**: "XX.XX EUR" (price-optimal schedule)
  - **Savings**: "XX.XX EUR (XX%)" with emerald color
  - **Avg price**: "XX.X ct/kWh" baseline vs. "XX.X ct/kWh" optimized
- [ ] KPIs use the same compact card style as existing SessionCostCard

### Tooltip Extension
- [ ] When hovering a slot in fleet mode, the tooltip shows:
  - Price (ct/kWh) — existing
  - Fleet optimized: XXX kW
  - Band range: XXX–XXX kW
  - Slot type: "Mandatory" (at lazy bound), "Flexible" (between bounds), "Max charge" (at greedy bound)

### Integration with Sub-Toggle
- [ ] The optimized line is only visible when fleet mode AND "Fleet" sub-toggle are active
- [ ] Switching to "Single EV" sub-toggle hides the fleet band + optimized line and shows the existing single-EV baseline/optimized dots

## Edge Cases

1. **Total energy exceeds band capacity**: If the fleet needs more kWh than the band can deliver at maximum (all slots at greedy), show a warning: "Insufficient charging capacity — X kWh shortfall." This can happen with very short windows or very large fleets.
2. **Total energy fits entirely in mandatory slots**: If lazy charging alone provides enough energy, the optimized line equals the lazy line everywhere. Savings = 0 (no flexibility to exploit).
3. **All prices identical**: Optimizer has no price signal — line equals lazy bound (default to minimum charging). Savings ≈ 0.
4. **Negative prices**: The optimizer should maximize charging during negative price hours (earning money). The optimized line should jump to greedy bound during negative price slots.
5. **Fleet size = 1**: KPIs should show single-vehicle figures. The optimized line should approximately match the single-EV optimizer result.
6. **Zero flexible capacity at all slots**: Band is fully constrained (greedy ≈ lazy everywhere). Optimized line = lazy line. KPIs show 0 savings with explanatory note.
7. **QH resolution**: When in 15-min mode, the optimizer operates per-QH slot. Energy per slot = kW × 0.25h. Prices per QH slot come from the chart data.

## Technical Requirements

- **Performance**: Optimizer runs on ~20 hourly slots (or ~80 QH slots). Sorting + allocation is O(n log n). Must complete in < 10ms.
- **Extends**: `src/lib/fleet-optimizer.ts` (same file as PROJ-36)
- **Type**: `FleetScheduleSlot = FlexBandSlot & { optimizedKw: number; mandatoryKw: number; flexibleKw: number; slotCostEur: number }`
- **KPI type**: `FleetOptimizationResult = { totalEnergyKwh: number; baselineCostEur: number; optimizedCostEur: number; savingsEur: number; savingsPct: number; baselineAvgCtKwh: number; optimizedAvgCtKwh: number; schedule: FleetScheduleSlot[] }`

---

## Tech Design (Solution Architect)

### Component Structure

```
Step2ChargingScenario (existing)
├── ComposedChart (existing — adds optimized line)
│   ├── flex band layers (from PROJ-36)
│   └── <Line dataKey="optimizedKw">          ← NEW solid emerald line
├── FleetConfigPanel (from PROJ-35)
│   └── FleetKpiRow                            ← NEW: compact KPI summary below config
│       ├── Fleet size + total energy
│       ├── Baseline cost vs optimized cost
│       ├── Savings (EUR + %)
│       └── Avg price comparison
└── Tooltip (existing — extended with optimized kW + slot type)
```

### Data Model

**FleetScheduleSlot** (extends FlexBandSlot):
```
Each schedule slot has:
- everything from FlexBandSlot (hour, minute, date, greedyKw, lazyKw)
- optimizedKw: actual charging power chosen by optimizer
- mandatoryKw: minimum that must be charged (= lazyKw)
- flexibleKw: available extra capacity (= greedyKw - lazyKw)
- slotCostEur: cost of energy charged in this slot
```

**FleetOptimizationResult** (aggregate KPIs):
```
- totalEnergyKwh: sum of all vehicles' charge needs
- baselineCostEur: cost if all vehicles charge immediately (greedy schedule × prices)
- optimizedCostEur: cost of the price-optimal schedule
- savingsEur: baseline - optimized
- savingsPct: savings as percentage of baseline
- baselineAvgCtKwh: weighted average price of greedy schedule
- optimizedAvgCtKwh: weighted average price of optimized schedule
- schedule: the per-slot schedule array
```

### Computation Logic (plain language)

The optimizer operates on the flex band constraints, not individual vehicles:

**Step 1 — Mandatory allocation:**
For each slot, the lazy bound represents energy that MUST be charged. Allocate this first. Sum the energy delivered by all mandatory slots.

**Step 2 — Remaining energy:**
Calculate: `totalEnergyNeeded - mandatoryEnergyDelivered = remainingKwh`

**Step 3 — Price-optimal flexible allocation:**
For each slot, `flexibleKw = greedyKw - lazyKw` represents optional capacity.
Sort all slots by price (cheapest first).
Starting from the cheapest slot, increase charging from `lazyKw` toward `greedyKw` until all remaining energy is allocated.

**Step 4 — Result:**
Each slot now has `optimizedKw` between `lazyKw` and `greedyKw`. Multiply `optimizedKw × slotDuration × price` for cost.

**Baseline cost** is computed separately: sum of `greedyKw × slotDuration × price` for all slots (what happens if everyone charges ASAP).

### Tech Decisions

1. **Extends `fleet-optimizer.ts`** — the `optimizeFleetSchedule` function lives in the same file as `computeFlexBand`. It takes the band output + prices as input, keeping a clean pipeline: `FleetConfig → computeFlexBand → optimizeFleetSchedule`.

2. **`optimizedKw` merged into chartData** — same approach as the band: a new field on each chart data point, joined by `date-hour-minute` key. Null when fleet view is inactive.

3. **KPI row as part of FleetConfigPanel** — not a separate component. The config panel already sits below the chart; the KPI summary renders at the bottom of that panel when optimization results are available. Uses the same visual language as SessionCostCard (emerald for savings, red for baseline, compact tabular-nums layout).

4. **No separate "run optimization" button** — optimization runs automatically via `useMemo` when band data or prices change, same reactive pattern as the existing single-EV optimizer. Performance target (< 10ms) is easily met for ~20–80 slots.

5. **Tooltip extension** — the existing custom tooltip render function in Step2ChargingScenario gets a conditional block: when fleet view is active, append fleet-specific lines (optimized kW, band range, slot type label).

### Dependencies
- None (no new packages)

## QA Test Results

**Tested by:** QA Engineer (code review + build verification)
**Date:** 2026-04-02
**Build status:** PASS (production build succeeds, 0 TypeScript errors)

### Acceptance Criteria Results

#### Optimizer Algorithm (fleet-optimizer.ts)
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | `optimizeFleetSchedule` function exists | PASS | Lines 194-276 |
| 2a | Mandatory kW = lazyKw allocated first | PASS | Lines 210-221 |
| 2b | Flexible kW = greedyKw - lazyKw computed | PASS | Line 213 |
| 2c | Remaining energy calculated | PASS | Line 225 |
| 2d | Flexible slots sorted by price ascending | PASS | Line 231 |
| 2e | Cheapest filled first to greedy bound | PASS | Lines 233-239 |
| 2f | Result: lazyKw <= optimizedKw <= greedyKw | PASS | By construction: starts at lazyKw, adds up to flexibleKw |
| 3 | Total energy equals fleet requirement | **FAIL** | See BUG-37-1 below |
| 4 | Schedule feasible (never below lazy, never above greedy) | PASS | By construction |

#### Chart Rendering
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Solid emerald line (#10B981), 2.5px | PASS | Line at lines 1985-1987 |
| 2 | Line connects optimizedKw values across overnight | PASS | stepAfter interpolation matches band style |
| 3 | Constrained slots hug lower bound | PASS | Natural behavior when optimizedKw = lazyKw |
| 4 | Zero-demand slots: line at zero | PASS | optimizedKw = lazyKw = 0 at those slots |

#### KPI Summary
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | KPI row shown when fleet active + "Fleet" sub-toggle | PASS | Gated by `isFleetActive ? fleetOptResult : null` at line 2504 |
| 2a | Fleet size shown | **FAIL** | KPI row does not include "Fleet size: XX EVs" as specified. Fleet size only visible in slider above. |
| 2b | Total energy shown | PASS | "Fleet energy: XXX kWh" at lines 308-310 |
| 2c | Baseline cost shown | PASS | Red text, EUR value + avg ct/kWh at lines 312-317 |
| 2d | Optimized cost shown | PASS | Emerald text, EUR value + avg ct/kWh at lines 319-324 |
| 2e | Savings shown (EUR + %) | PASS | Emerald text with percentage at lines 326-331 |
| 2f | Avg price comparison | PASS | Both baseline and optimized avg ct/kWh shown |
| 3 | Same compact card style as SessionCostCard | PASS | Uses same text sizes, tabular-nums, color scheme |

#### Tooltip Extension
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Fleet optimized kW shown | PASS | Line 1896 |
| 2 | Band range shown | PASS | Line 1897 |
| 3 | Slot type label (Mandatory/Flexible/Max charge) | PASS | Lines 1900-1903, plus "Idle" for lazyKw=0 slots |

#### Integration with Sub-Toggle
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Optimized line only visible in fleet mode + "Fleet" sub-toggle | PASS | All fleet chart elements gated by `isFleetActive` |
| 2 | "Single EV" hides fleet, shows single-EV dots | PASS | Single-EV dots gated by `!isFleetActive` at line 2018 |

### Edge Cases Tested (Code Review)

| # | Case | Result | Notes |
|---|------|--------|-------|
| 1 | Total energy exceeds band capacity | **FAIL** | No warning shown. `remainingKwh` would simply stay positive after filling all flexible slots. The optimizer silently underdelivers energy. Spec requires a warning: "Insufficient charging capacity -- X kWh shortfall." |
| 2 | Lazy alone provides enough energy | PASS | `remainingKwh` would be 0 or negative after mandatory allocation. No flexible slots filled. Savings = 0. |
| 3 | All prices identical | PASS | Sort is stable; all flexible slots have same price. Fills from first to last. Savings ~ 0. |
| 4 | Negative prices | PASS | Negative prices sort lowest (cheapest), so optimizer correctly fills those slots first. |
| 5 | Fleet size = 1 | PASS | Min is 10 (slider), but at 10 EVs the values scale down proportionally. |
| 6 | Zero flexible capacity | PASS | `flexIndices` array is empty, no flexible allocation. Savings = 0. |

### Bugs Found

**BUG-37-1: Baseline cost calculation uses pro-rata normalization instead of greedy-capped schedule**
- Severity: High
- Description: The baseline cost is computed as the total greedy energy cost, then proportionally scaled down when greedy energy exceeds `totalEnergyKwh` (lines 258-259). This is mathematically incorrect. Greedy charging front-loads energy into the first hours after arrival, which may be expensive or cheap depending on the price curve. Pro-rata scaling assumes uniform price distribution across greedy slots, which is wrong. The correct approach would be to simulate greedy charging that stops after delivering exactly `totalEnergyKwh`, respecting the arrival-first ordering.
- Location: `src/lib/fleet-optimizer.ts` lines 248-259
- Steps to reproduce: Use a fleet with high arrival concentration at expensive hours. Compare baseline cost with manually calculated "charge ASAP for exactly needed kWh."
- Expected: Baseline cost reflects actual ASAP charging cost for the required energy
- Actual: Baseline cost is scaled proportionally, which overestimates savings when greedy hours are cheap and underestimates when they are expensive
- Impact: KPI savings figures (EUR and %) may be inaccurate by potentially significant margins
- Priority: P1 (core metric accuracy)

**BUG-37-2: Missing capacity shortfall warning**
- Severity: Medium
- Description: When total energy needed exceeds the maximum deliverable energy (all slots at greedy kW for full duration), no warning is shown. The optimizer silently underdelivers energy, and the KPI row shows `totalEnergyKwh` as the optimized delivery amount rather than highlighting the shortfall.
- Location: `src/lib/fleet-optimizer.ts` lines 225-239
- Steps to reproduce: Set fleet size to 1000, battery mix to 100% SUV (100 kWh), SoC range 10-15% (very low arrival SoC = lots of energy needed), narrow departure window. The band capacity may be insufficient.
- Expected: Warning message: "Insufficient charging capacity -- X kWh shortfall"
- Actual: Silent underdelivery; KPIs show incorrect totals
- Priority: P2 (edge case but misleading when triggered)

**BUG-37-3: Fleet size missing from KPI row**
- Severity: Low
- Description: Spec explicitly requires "Fleet size: '100 EVs'" as a KPI. The KPI row shows 4 items (energy, baseline, optimized, savings) but not fleet size. Fleet size is visible in the slider row above but not in the summary KPI context.
- Location: `src/components/v2/FleetConfigPanel.tsx` lines 305-334
- Priority: P4 (cosmetic; information available elsewhere)

**BUG-37-4: optimizedEnergyKwh may not equal totalEnergyKwh in result**
- Severity: Medium
- Description: The result's `totalEnergyKwh` is set to `optimizedEnergyKwh` (line 267), which is the sum of actual scheduled energy. If there's a capacity shortfall (BUG-37-2), this value will be less than the requested `totalEnergyKwh`. The field name suggests it should represent the fleet's need, but it actually represents what was delivered. This could mislead users comparing "fleet energy need" with "what was charged."
- Location: `src/lib/fleet-optimizer.ts` line 267
- Expected: Either (a) report requested vs delivered separately, or (b) keep totalEnergyKwh as the requested amount
- Actual: Reports delivered amount under the "total energy" label
- Priority: P3 (data clarity)

### Security Audit
- All computation is client-side, no server interaction
- No user input reaches dangerous sinks
- Rounding operations prevent floating-point display issues
- **PASS** -- no security concerns

### Regression Testing
- Existing 48 savings-math tests: PASS
- Single-EV chart rendering: PASS (gated by `!isFleetActive`)
- Build: PASS (no TypeScript errors)
- Renewable overlay: Not conflicting (separate yAxisId)

### Cross-Browser / Responsive
- Requires manual visual verification on Chrome, Firefox, Safari
- KPI row uses `grid-cols-4` which may overflow on 375px mobile width
- Fleet config panel stacks via flex-wrap, should work at 768px

### Production Ready: NOT READY
- 1 High bug (BUG-37-1): Baseline cost calculation is algorithmically incorrect, leading to inaccurate savings KPIs
- 2 Medium bugs (BUG-37-2, BUG-37-4): Capacity shortfall handling and energy reporting
- Must fix BUG-37-1 before deployment; BUG-37-2 should also be addressed

## Deployment
_To be added by /deploy_
