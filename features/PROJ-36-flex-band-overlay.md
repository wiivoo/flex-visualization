# PROJ-36: Flex Band Overlay

## Status: In Review
**Created:** 2026-04-02
**Last Updated:** 2026-04-02

## Dependencies
- Requires: PROJ-35 (Fleet Designer) — `FleetConfig` type and fleet state
- Requires: PROJ-12 (Interactive Price Chart) — Recharts ComposedChart, secondary Y-axis pattern

## Overview

Two area curves rendered as a shaded band on the existing price chart, showing the fleet's aggregate flexibility. The **upper bound** (greedy/ASAP) shows cumulative kW demand if every EV charges immediately upon arrival at max power. The **lower bound** (lazy/ALAP) shows demand if every EV delays charging to the latest possible moment. The area between them — the flex band — represents the degrees of freedom available for price optimization.

The band uses a secondary right Y-axis (kW), following the same dual-axis pattern already used by the renewable generation overlay. It reacts live as fleet parameters change.

## User Stories

1. **As a** fleet manager, **I want to** see the flex band overlaid on the price curve **so that** I can visually understand how much charging flexibility exists at each hour and how it relates to price volatility.

2. **As a** business development user, **I want to** see the band widen as I add more vehicles **so that** I can demonstrate the portfolio diversification effect to stakeholders.

3. **As a** analyst, **I want to** see the ASAP and ALAP bounds as distinct lines **so that** I can identify hours where charging is mandatory (bounds converge) vs. hours with maximum freedom.

4. **As a** user, **I want to** toggle the flex band on/off independently **so that** I can compare the raw price curve with and without the fleet context.

5. **As a** analyst, **I want to** see the flex band update as I change the selected date **so that** I can compare flexibility across different price days.

## Acceptance Criteria

### Band Computation (`fleet-optimizer.ts`)
- [ ] For each time slot in the overnight window (14:00 day1 → 09:00 day2):
  - **Greedy (upper bound)**: simulate all cohorts charging at maximum power immediately upon arrival, respecting cable capacity and battery limits. Sum kW across all cohorts.
  - **Lazy (lower bound)**: simulate all cohorts delaying charging to the latest possible slot that still achieves their target SoC by their departure time. Sum kW across all cohorts.
- [ ] Each cohort is defined by: arrival hour × departure hour × battery size × charge power × arrival SoC
- [ ] Cohort weights come from the fleet distributions (PROJ-35): e.g., 27% arrive at 18:00 × 50% have 60kWh battery × 80% charge at 7kW = specific cohort fraction
- [ ] Band values are in aggregate kW (fleet size × per-vehicle kW draw at that slot)
- [ ] Band updates reactively when any fleet parameter or the selected date changes

### Chart Rendering
- [ ] Flex band renders as a semi-transparent filled area between upper (greedy) and lower (lazy) bounds using Recharts `<Area>` elements
- [ ] Fill color: blue-100 at ~15% opacity (subtle, doesn't obscure the price curve)
- [ ] Upper bound line: dashed red (#EF4444), 1.5px — matches TheoryOverlay's greedy line style
- [ ] Lower bound line: dashed purple (#8B5CF6), 1.5px — matches TheoryOverlay's lazy line style
- [ ] Uses a secondary Y-axis on the right side, labeled "kW" — same pattern as the renewable overlay's right Y-axis
- [ ] Y-axis domain auto-scales to the max greedy value + 10% headroom
- [ ] Band is only rendered when fleet mode is active AND the "Fleet" sub-toggle is selected (not "Single EV")

### Visual Integration
- [ ] The price curve (left Y-axis, ct/kWh) remains unchanged and fully visible through the band
- [ ] Band gradient definition added to `<defs>` block alongside existing `priceGrad`, `renewGrad`, `forecastGrad`
- [ ] When both renewable overlay AND fleet band are active, both render simultaneously without visual conflict (fleet uses blue, renewable uses green)
- [ ] Chart tooltip extends to show fleet data when hovering: "Fleet: 245 kW (range: 120–380 kW)" alongside price data

### Overnight Window Scope
- [ ] Band only renders within the overnight charging window (14:00–09:00)
- [ ] Slots outside the window show zero kW (no fleet demand)
- [ ] Band correctly handles the midnight crossover (day1 evening → day2 morning)

### State Management
- [ ] New boolean state `showFleetBand` in Step2ChargingScenario, gated behind fleet mode being active
- [ ] Band computation results are memoized (`useMemo`) and only recompute when fleet config or price data changes

## Edge Cases

1. **Greedy = Lazy at a slot**: The band collapses to a line at slots where charging is mandatory (all vehicles must charge at that moment). This happens when vehicles arrive late with low SoC and depart early.
2. **Zero kW at a slot**: Before any vehicles arrive (14:00 with no arrivals yet) or after all depart. Band shows zero — valid.
3. **Negative greedy-lazy difference**: Should never happen algorithmically, but clamp `lazy ≤ greedy` as a safety measure.
4. **Very large fleets (1,000 EVs × 11kW)**: Max kW could be 11,000 kW = 11 MW. Y-axis should auto-format (kW → MW) for readability.
5. **Date without next-day prices**: If the overnight window extends into a date without price data, truncate the band to available data (same behavior as the existing chart padding logic).
6. **QH resolution**: When the chart is in 15-min mode, the flex band should also compute per-QH slot (each 15-min block has its own kW value). Charge power per QH slot = chargePowerKw × 0.25 for energy, but kW draw stays the same.

## Technical Requirements

- **Performance**: Band computation for 1,000 EVs × 9 cohort hours × 3 battery sizes × 2 power levels = ~54 cohorts × 20 slots = ~1,080 calculations. Must complete in < 50ms.
- **New file**: `src/lib/fleet-optimizer.ts` — pure functions, no React dependencies. Exports `computeFlexBand(config: FleetConfig, windowPrices: HourlyPrice[]): FlexBandSlot[]`
- **Type**: `FlexBandSlot = { hour: number; minute: number; date: string; greedyKw: number; lazyKw: number }`

---

## Tech Design (Solution Architect)

### Component Structure

```
Step2ChargingScenario (existing)
├── ComposedChart (existing — adds fleet layers)
│   ├── <defs>
│   │   └── linearGradient id="fleetBandGrad"  ← NEW (blue, 15% opacity)
│   ├── <YAxis yAxisId="fleet"> (right side)   ← NEW (kW axis, hidden when inactive)
│   ├── <Area dataKey="greedyKw">              ← NEW upper bound fill
│   ├── <Area dataKey="lazyKw">                ← NEW lower bound (white fill to "cut out" band)
│   ├── <Line dataKey="greedyKw">              ← NEW dashed red upper line
│   ├── <Line dataKey="lazyKw">                ← NEW dashed purple lower line
│   └── existing price/baseline/optimized layers (unchanged)
└── Tooltip (existing — extended with fleet data)
```

No new visible components — all rendering happens inside the existing ComposedChart via additional Recharts elements, gated behind `showFleet && fleetView === 'fleet'`.

### Data Model

**FlexBandSlot** (computed per time slot):
```
Each band slot has:
- hour, minute, date: identifies the time slot (matches chart data grid)
- greedyKw: maximum aggregate kW if all available EVs charge at full power
- lazyKw: minimum aggregate kW that must happen to meet all departure targets
```

**Cohort model** (internal to computation, not stored):
```
A cohort is one combination of:
- arrival hour (from arrivalDist)
- departure hour (from departureDist)
- battery size (40/60/100 kWh from batteryMix)
- charge power (7/11 kW from chargePowerMix)
- arrival SoC (interpolated from socMin–socMax range)
- weight = product of all distribution percentages × fleet size

The computation iterates all cohorts (typically ~54 combinations)
and sums their greedy/lazy kW contributions per slot.
```

**Chart data extension** — the existing `chartData` array (built in the large `useMemo`) gets two new fields per point: `greedyKw` and `lazyKw`. These are joined from the band computation using the `date-hour-minute` key.

### Computation Logic (plain language)

**Greedy bound** (per cohort, per slot):
- Before arrival: 0 kW
- After arrival until battery full: charge at max power (7 or 11 kW)
- After battery full: 0 kW

**Lazy bound** (per cohort, per slot):
- Calculate how many slots needed: `energyNeeded / kwhPerSlot`
- Count backwards from departure: charge in the last N slots before departure
- Before those last N slots: 0 kW
- During those last N slots: charge at max power

Sum across all cohorts → aggregate greedy/lazy kW per slot.

### Tech Decisions

1. **New file `src/lib/fleet-optimizer.ts`** — pure functions with zero React or DOM dependencies. This is the computation engine for all fleet features. Importable by Step2ChargingScenario and by tests.

2. **Band rendered as two stacked Areas** — Recharts doesn't natively support "area between two lines". The proven technique (already used in TheoryOverlay's StepFlexBand): render `greedyKw` as a filled area, then render `lazyKw` as a white-filled area on top, creating the visual "band" between them. Upper/lower bound lines drawn separately.

3. **Secondary Y-axis reuse** — follows the exact same `yAxisId="right"` pattern as the renewable overlay. When both fleet AND renewable are active, they share the right axis idea but use separate `yAxisId` values (`"fleet"` for kW, `"right"` for renewable %). Both can render simultaneously.

4. **Band data merged into chartData** — rather than a separate data array (which Recharts doesn't support well on a single ComposedChart), the band values are merged into each chart data point. Points outside the overnight window get `greedyKw: null` / `lazyKw: null`.

5. **Y-axis auto-format** — when max kW > 1,000, display as "X.X MW" using a custom tick formatter. Below 1,000: "XXX kW".

### Dependencies
- None (no new packages — all within existing Recharts)

## QA Test Results

**Tested by:** QA Engineer (code review + build verification)
**Date:** 2026-04-02
**Build status:** PASS (production build succeeds, 0 TypeScript errors)

### Acceptance Criteria Results

#### Band Computation (fleet-optimizer.ts)
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Greedy: all cohorts charge at max power upon arrival | PASS | Lines 126-129, charges from arrIdx for actualSlotsNeeded slots |
| 2 | Lazy: all cohorts delay to latest possible slot | PASS | Lines 132-135, charges in last N slots before departure |
| 3 | Cohorts defined by arrival x departure x battery x power x SoC | PASS | buildCohorts() at lines 30-73 expands all combinations |
| 4 | Cohort weights from fleet distributions | PASS | Weight = product of all distribution percentages x socWeight |
| 5 | Band values in aggregate kW | PASS | Multiplied by `cohort.weight * fleetSize` |
| 6 | Band updates reactively | PASS | `useMemo` at lines 472-491 depends on `fleetConfig` |

#### Chart Rendering
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Semi-transparent filled area between upper/lower bounds | PASS | Two stacked Areas: greedyKw with fleetBandGrad fill, lazyKw with white fill |
| 2 | Fill color blue-100 ~15% opacity | PASS | Gradient: `#3B82F6` at 15% to 3% opacity |
| 3 | Upper bound line: dashed red (#EF4444), 1.5px | PASS | Line at 1979-1980 matches spec |
| 4 | Lower bound line: dashed purple (#8B5CF6), 1.5px | PASS | Line at 1982-1983 matches spec |
| 5 | Secondary Y-axis "kW" on right side | PASS | YAxis yAxisId="fleet" at line 1838 |
| 6 | Y-axis auto-scales to max greedy + 10% headroom | PASS | `fleetYMax` computed at lines 516-519 |
| 7 | Band only rendered when fleet mode active + "Fleet" sub-toggle | PASS | Gated by `isFleetActive` |

#### Visual Integration
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Price curve remains visible through band | PASS | Band rendered before price curve in DOM order (lines 1970-1989 before price at 1998) |
| 2 | Band gradient in defs block | PASS | `fleetBandGrad` at lines 1820-1823, alongside other gradients |
| 3 | Renewable + fleet render simultaneously | PASS | Different yAxisIds ("right" vs "fleet"), separate color schemes |
| 4 | Tooltip shows fleet data | PASS | Lines 1893-1906: shows optimized kW, range, and slot type |

#### Overnight Window Scope
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Band only in overnight window | PASS | Data merged with null for non-matching slots (line 511) |
| 2 | Zero kW outside window | PASS | Non-matching slots get `greedyKw: null, lazyKw: null` |
| 3 | Midnight crossover handled | **NEEDS VERIFICATION** | `findDepartureIndex` uses day2 date detection (line 162-163), should handle crossover but edge cases with single-date windows are possible |

#### State Management
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | showFleetBand state | PASS | Controlled by `isFleetActive` derived state |
| 2 | Band memoized | PASS | `useMemo` at line 472, recomputes only on config/data change |

### Edge Cases Tested (Code Review)

| # | Case | Result | Notes |
|---|------|--------|-------|
| 1 | Greedy = Lazy (band collapse) | PASS | `Math.min(lazyKw, greedyKw)` clamping at line 143 |
| 2 | Zero kW slots | PASS | Before arrival / after departure = 0 |
| 3 | Negative greedy-lazy difference | PASS | Clamped via `Math.min` at line 143 |
| 4 | Large fleets (1000 EVs x 11kW) | PASS | Y-axis auto-formats kW/MW at line 1840 |
| 5 | Date without next-day prices | **FAIL** | `findDepartureIndex` returns `slots.length` when departure hour not found. If day2 data is missing entirely, all departure indices will be `slots.length`, causing the band to extend to the last available slot rather than truncating. The `depIdx <= arrIdx` check at line 120 may silently skip valid cohorts. |
| 6 | QH resolution | **FAIL** | `findSlotIndex` at line 147 searches for exact hour+minute match. For arrival hours (called with minute=0), it falls through to the `minute === 0` fallback which works. But the function signature and logic are fragile: if called with a non-zero minute for an hourly slot, it would fail to match. More critically, in QH mode, arrival hour 18 should match slot 18:00 (minute=0), which works, but the code does not handle sub-hour arrival/departure distributions. |

### Bugs Found

**BUG-36-1: findSlotIndex fragile for QH mode edge cases**
- Severity: Medium
- Description: `findSlotIndex` does exact hour+minute matching. In QH mode, slots have minutes 0/15/30/45. The function works for whole-hour arrivals (minute=0) because the fallback matches. But if a future feature adds sub-hour arrival distributions, this function will silently fail to find slots.
- Location: `src/lib/fleet-optimizer.ts` lines 147-156
- Steps to reproduce: Currently masked because arrivals are always at whole hours. Would manifest if arrival distributions included half-hour entries.
- Priority: P3 (latent bug, not triggered by current data)

**BUG-36-2: Missing next-day price data causes silent band miscalculation**
- Severity: Medium
- Description: When overnight window extends into a date without price data (e.g., today is the last date with data), `findDepartureIndex` returns `slots.length` for all departure cohorts. This means departure is set to "end of available data" rather than the actual departure time. The band will render but may be inaccurate -- greedy and lazy bounds won't reflect the correct time constraints.
- Location: `src/lib/fleet-optimizer.ts` lines 159-170
- Steps to reproduce: Select the last available date in the calendar where next-day prices are not yet available. Enable fleet mode.
- Expected: Band truncates at last available data point with a visual indicator
- Actual: Band renders with incorrect departure indices, potentially showing too much or too little flexibility
- Priority: P2 (data accuracy issue on edge dates)

**BUG-36-3: Tooltip format inconsistent with spec**
- Severity: Low
- Description: Spec says tooltip should show "Fleet: 245 kW (range: 120-380 kW)". Actual tooltip shows "Fleet: 245 kW (120-380 kW)" without the word "range:". Minor text deviation.
- Location: `src/components/v2/steps/Step2ChargingScenario.tsx` lines 1895-1897
- Priority: P4 (cosmetic)

### Security Audit
- Pure computation functions in fleet-optimizer.ts, no network I/O
- No user input reaches any dangerous sinks
- Float64Array usage is safe (bounded by cohort count)
- **PASS** -- no security concerns

### Production Ready: CONDITIONAL
- 1 P2 bug (BUG-36-2) should be addressed: add guard for missing next-day data
- 1 P3 bug (BUG-36-1) acceptable for initial release but should be noted for future work

## Deployment
_To be added by /deploy_
