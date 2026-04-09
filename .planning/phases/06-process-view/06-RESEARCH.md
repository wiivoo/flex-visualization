# Phase 6: Process View — Chronological Optimization Timeline - Research

**Researched:** 2026-04-09
**Domain:** React chart mode switching, staged optimization, waterfall visualization, uncertainty modeling
**Confidence:** HIGH (all findings verified against actual project source files)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Dedicated "process view" that replaces the normal chart temporarily. Not an overlay on the existing chart, not a full-screen takeover like TheoryOverlay.
- **D-02:** The view uses actual price data for the selected date (real DA prices, real intraday data when available).
- **D-03:** Time-axis scrubber or scroll-driven reveal — user progresses through chronological stages by scrubbing/scrolling, information is progressively revealed.
- **D-04:** Three chronological stages: (1) Forecast (D-2 to D-1 12:00), (2) DA Nomination (D-1 12:00), (3) Intraday Adjustment (D, continuous).
- **D-05:** Three uncertainty scenarios: Perfect foresight / Realistic forecast / Worst case.
- **D-06:** Selecting a scenario updates BOTH the chart visualization AND a waterfall value-drag card/chart.
- **D-07:** Waterfall shows: Perfect value → minus DA forecast error drag → minus car availability error drag → minus intraday correction spread = realized value.
- **D-08:** Key insight: DA price unknown at nomination time, car availability unknown → may lead to false position; intraday corrects at cost.
- **D-09:** Feature makes visible how much uncertainty costs (current dashboard is "perfect world").
- **D-10:** Use actual real-time data from the chart. When intraday unavailable, show only DA stages and indicate intraday is data-dependent.
- **D-11:** Process view works for BOTH single EV and fleet mode — fleet is first-class.
- **D-12:** Fleet √N portfolio effect visible in waterfall — smaller drag per car vs single EV.
- **D-13:** Fleet flex band (`computeFlexBand` greedy/lazy bounds) visualized to show intraday re-optimization degrees of freedom.
- **D-14:** Fleet arrival/departure distribution spread acts as natural hedge — errors partially cancel out.
- **D-15:** Waterfall contrast between single-EV and fleet clearly visible when toggling single↔fleet.

### Claude's Discretion

- Specific scrubber vs. scroll-driven UX — evaluate best approach given Recharts constraints.
- Exact uncertainty percentages for "realistic" and "worst case" scenarios — can be derived from historical DA forecast error distributions.
- Waterfall chart library choice (Recharts Bar with stacked segments, or custom SVG).
- Whether process view is accessed via button/toggle on existing chart, or from TheoryOverlay navigation.

### Deferred Ideas (OUT OF SCOPE)

None — discussion stayed within phase scope.
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROC-01 | Process view mode on chart — chronological reveal of 3 stages with scrubber/scroll mechanism | Covered: scrubber pattern from `FunnelTimeline`, mode toggle pattern from `showIntraday`/`showFleet`, real price data via `usePrices` hook |
| PROC-02 | Three uncertainty scenarios (perfect / realistic / worst) that update chart + waterfall card | Covered: `runOptimization()` with perturbed price inputs, waterfall as new Recharts Bar component; uncertainty math via √N and historical DA error |
| PROC-03 | Fleet mode support — √N portfolio effect in waterfall, flex band visualization, distribution hedge | Covered: `computeFlexBand`, `optimizeFleetSchedule`, `deriveFleetDistributions`, `generateDistribution` all ready for reuse; `showFleet` toggle already in Step2 |
</phase_requirements>

---

## Summary

Phase 6 builds a "process view" mode that replaces the normal price chart temporarily and walks the user through the three-stage optimization timeline chronologically: Forecast → DA Nomination → Intraday Adjustment. The view uses real price data (DA prices always, intraday when available) and supports three uncertainty scenarios. A new waterfall card decomposes where value is lost vs. perfect foresight.

The codebase is well-prepared for this phase. The core pattern — a boolean state flag (`showFleet`, `showIntraday`) gating a chart mode — is already established in Step2ChargingScenario. The scrubber/stage navigation pattern is proven in `FunnelTimeline`. The optimization engine `runOptimization()` is a pure function that takes any price array, making it trivial to call it with perturbed price inputs for scenario modeling. Fleet functions (`computeFlexBand`, `optimizeFleetSchedule`) are pure and reusable. The single/fleet toggle already exists in Step2.

The main new work is: (1) a `ProcessView` component containing the chart-mode chart with the 3-stage scrubber and progressive reveal overlays, (2) a `useProcessView` hook that computes the three optimization results (one per stage, one per scenario), and (3) a `WaterfallCard` component that displays the value-drag decomposition.

**Primary recommendation:** Add `showProcessView: boolean` state in Step2, render `ProcessViewChart` in place of the normal chart when active, and create `WaterfallCard` as a sibling to `SessionCostCard`. Keep all new computation in pure lib functions, not inside components.

---

## Standard Stack

### Core (all already installed)
| Library | Version | Purpose | Status |
|---------|---------|---------|--------|
| recharts | ^3.7.0 | Chart — ComposedChart, Bar, ReferenceArea for waterfall and overlays | Already used |
| react | ^19.0.0 | State, hooks, memoization | Already used |
| tailwindcss | ^3.4.1 | All styling | Already used |

### Supporting (already installed)
| Library | Version | Purpose | Notes |
|---------|---------|---------|-------|
| lucide-react | ^0.562.0 | Icons for stage nav, scenario selector | Already used |
| @/components/ui/card | local | Card wrapper for WaterfallCard | Already used |

**No new packages required.** [VERIFIED: package.json and existing imports]

---

## Architecture Patterns

### Recommended New File Structure

```
src/
├── lib/
│   └── process-view.ts              # Pure computation: staged optimization, uncertainty, waterfall math
├── components/v2/
│   ├── ProcessViewChart.tsx         # Chart-mode component with stage scrubber
│   └── WaterfallCard.tsx            # Waterfall value-drag visualization
```

Step2ChargingScenario.tsx gains `showProcessView` state and conditionally renders `ProcessViewChart` in place of the normal ComposedChart.

### Pattern 1: Chart Mode Toggle (existing pattern, replicated)

**What:** A boolean state in Step2 gates which chart to render.
**When to use:** Always — this is how `showFleet`/`showIntraday` work today.

```typescript
// In Step2ChargingScenario.tsx — existing pattern [VERIFIED: lines 108-114]
const [showRenewable, setShowRenewable] = useState(false)
const [showIntraday, setShowIntraday] = useState(false)
const [showFleet, setShowFleet] = useState(false)

// New state to add:
const [showProcessView, setShowProcessView] = useState(false)

// In JSX: conditional render in chart area
{showProcessView ? (
  <ProcessViewChart
    prices={prices}
    scenario={scenario}
    showFleet={showFleet}
    fleetConfig={fleetConfig}
    isQH={isQH}
  />
) : (
  // existing ComposedChart...
)}
```

### Pattern 2: Stage Scrubber (reuse FunnelTimeline pattern)

**What:** Horizontal stage nav with dots + prev/next buttons. Already implemented as `FunnelTimeline` in IntradayFunnel.tsx.
**When to use:** ProcessViewChart needs its own 3-stage scrubber for Forecast → DA → Intraday.

```typescript
// Existing FunnelTimeline pattern [VERIFIED: IntradayFunnel.tsx lines 288-361]
// Process view stages (new, analogous to FUNNEL_STAGES):
export type ProcessStage = 'forecast' | 'da_nomination' | 'intraday_adjustment'

export const PROCESS_STAGES: { key: ProcessStage; label: string; description: string }[] = [
  { key: 'forecast', label: 'Forecast', description: 'D-2 to D-1 12:00 — estimate availability and need' },
  { key: 'da_nomination', label: 'DA Nom.', description: 'D-1 12:00 — auction prices revealed, nominate slots' },
  { key: 'intraday_adjustment', label: 'Intraday', description: 'Day D — actual car data revealed, re-optimize' },
]
```

### Pattern 3: Staged Optimization with Perturbed Inputs

**What:** Call `runOptimization()` with modified price arrays to model scenario-dependent savings.
**When to use:** Computing the three scenario values (perfect / realistic / worst) for the waterfall.

```typescript
// In src/lib/process-view.ts
// runOptimization() signature [VERIFIED: optimizer.ts lines 12-49]
import { runOptimization, type OptimizeInput, type OptimizeResult } from '@/lib/optimizer'

export type UncertaintyScenario = 'perfect' | 'realistic' | 'worst'

/**
 * Apply forecast error to DA prices.
 * Realistic: ±8 EUR/MWh Gaussian noise (historical DE DA error ~8 EUR/MWh RMSE)
 * Worst: ±20 EUR/MWh, biased toward higher prices (Murphy's law)
 */
export function perturbPrices(
  prices: HourlyPrice[],
  scenario: UncertaintyScenario,
  seed: number = 42,
): HourlyPrice[] { ... }

/**
 * Apply plug-in time variance: car arrives late or early by N hours.
 * Realistic: ±1h variance. Worst: +2h (car arrives 2h late → misses cheap slots).
 */
export function perturbWindow(
  windowStart: string,
  scenario: UncertaintyScenario,
): string { ... }

/**
 * Compute all three stage results for the waterfall.
 * Returns perfect/realistic/worst optimization results.
 */
export interface ProcessViewResult {
  perfect: OptimizeResult
  realistic: OptimizeResult
  worst: OptimizeResult
  daForecastDragEur: number   // perfect.savings - realistic.savings
  availabilityDragEur: number  // realistic.savings - (savings with correct prices but wrong window)
  intradayCorrectionEur: number // residual gap
}
```

### Pattern 4: Waterfall Chart (Recharts stacked Bar)

**What:** Recharts Bar chart with stacked positive/negative segments to show value decomposition.
**When to use:** WaterfallCard renders this for single EV and optionally for fleet side-by-side.

Waterfall bars can be built with Recharts `ComposedChart` + `Bar` using the standard "invisible offset bar + visible delta bar" technique. No additional library needed. [ASSUMED: this is the standard Recharts waterfall pattern, not verified against docs in this session]

```typescript
// WaterfallCard data shape:
interface WaterfallBar {
  label: string         // 'Perfect' | 'DA Error' | 'Availability' | 'ID Cost' | 'Realized'
  base: number          // invisible offset (EUR)
  value: number         // visible bar height (EUR), negative for drag bars
  color: string         // emerald for positive, red for drag, blue for realized
  isTotal?: boolean
}
```

### Pattern 5: Fleet √N Uncertainty Scaling

**What:** Scale forecast error by 1/√N where N is fleet size. Existing `TheoryOverlay` computes this synthetically (lines 48-54). For process view, apply it to actual perturbation magnitude.
**When to use:** When `showFleet === true`, reduce the `perturbPrices` noise magnitude by 1/√fleetSize.

```typescript
// Existing formula in TheoryOverlay [VERIFIED: lines 48-54]
const relUncertainty = Math.sqrt(n) * 3 // absolute kW, grows √N
const relUncertaintPct = (uncertainty / total) * 100 // relative drops 1/√N

// In process-view.ts — for fleet mode:
const scaleFactor = isFleet ? 1 / Math.sqrt(fleetConfig.fleetSize * plugInFraction) : 1
const effectiveNoiseMagnitude = baseDaNoiseMagnitude * scaleFactor
```

### Pattern 6: Progressive Reveal via ReferenceArea

**What:** Use `ReferenceArea` to visually "reveal" price bars stage by stage, identical to how Step2 overlays charging blocks today.
**When to use:** ProcessViewChart uses `ReferenceArea` overlays to progressively dim or reveal hourly slots as stages advance.

```typescript
// Existing ReferenceArea pattern [VERIFIED: Step2ChargingScenario.tsx line 24 import, TheoryOverlay.tsx lines 235-236]
<ReferenceArea x1="18:00" x2="21:00" fill="#FEE2E2" fillOpacity={0.5} />
<ReferenceArea x1="01:00" x2="04:00" fill="#D1FAE5" fillOpacity={0.5} />
```

### Anti-Patterns to Avoid

- **Put optimization math in component render:** All `runOptimization()` calls must be in `useMemo` or in `src/lib/process-view.ts` pure functions. Components render only derived data.
- **Reinvent the scrubber:** Do not build a custom scrubber from scratch — replicate `FunnelTimeline` exactly (dots, prev/next, keyboard support).
- **Create a new price hook:** ProcessViewChart takes prices as props from the parent Step2; do not add a second `usePrices` call.
- **Global state for process view:** Use local `useState` in Step2 for `showProcessView`; do not add context or global store.
- **Full-screen takeover like TheoryOverlay:** ProcessViewChart must render inside the existing chart card area (replacing the ComposedChart div), not as a fixed overlay.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Stage navigation dots + arrows | Custom stepper | Clone FunnelTimeline pattern | Proven, keyboard-accessible, consistent UX |
| Charging slot optimization | Custom price-sorting | `runOptimization()` from optimizer.ts | Already handles QH, DSO, overnight windows, module 3 |
| Fleet band computation | Custom bounds loop | `computeFlexBand()` from fleet-optimizer.ts | Handles cohorts, QH granularity, lazy/greedy correctly |
| Fleet distribution spread | Custom bell curve | `generateDistribution()` + `deriveFleetDistributions()` | Already parameterized with narrow/normal/wide/off |
| Fleet schedule optimization | Custom slot picker | `optimizeFleetSchedule()` from fleet-optimizer.ts | Handles mandatory kW floor, greedy fill, shortfall |
| Waterfall chart | Custom SVG | Recharts ComposedChart + stacked Bar (offset technique) | Consistent with existing chart codebase |

**Key insight:** The optimization engine is entirely pure functions — calling them with different price inputs (perturbed vs. real) is trivially safe and is exactly the right approach for scenario modeling.

---

## Common Pitfalls

### Pitfall 1: ProcessView re-optimizing on every render
**What goes wrong:** `runOptimization()` is called on every render because price perturbation uses `Math.random()` without a seed, producing unstable results.
**Why it happens:** Random noise without seeding makes `useMemo` dependencies unpredictable.
**How to avoid:** Seed the perturbation function deterministically (e.g., using the selected date string as seed). Wrap all three `runOptimization()` calls in a single `useMemo` keyed on `[date, scenario, uncertaintyScenario, showFleet, fleetConfig]`.
**Warning signs:** Waterfall values flickering on every re-render.

### Pitfall 2: Intraday stage appearing when intraday data is unavailable
**What goes wrong:** The intraday stage tab is clickable but shows empty or broken chart when `intradayFull.length === 0`.
**Why it happens:** Stage scrubber renders regardless of data availability.
**How to avoid:** Per D-10, disable/grey out the intraday stage button when `!hasIntraday`. Show "Intraday data not available for this date" label. The `hasIntraday` boolean is already computed in Step2 (line 254 in the useMemo).
**Warning signs:** Empty chart area with no error message.

### Pitfall 3: Fleet √N perturbation applied incorrectly
**What goes wrong:** For a fleet of 1000 cars, perturbation is reduced by `1/√1000 ≈ 3%` — but `plugInFraction` is not applied, overstating fleet size.
**Why it happens:** `fleetSize = 1000` but only `plugInsPerWeek/7 * 1000` cars are connected per night.
**How to avoid:** Use effective fleet size: `fleetConfig.fleetSize * Math.min(1, fleetConfig.plugInsPerWeek / 7)`. Same formula used in `computeFlexBand` (fleet-optimizer.ts line 152).
**Warning signs:** Waterfall shows essentially zero drag for fleet even with small fleet sizes.

### Pitfall 4: Step2 file growing beyond 3000 lines
**What goes wrong:** Adding ProcessView state, JSX, and waterfall logic directly into Step2ChargingScenario.tsx pushes the already ~2900-line file further.
**Why it happens:** It's tempting to add the toggle button and chart inline.
**How to avoid:** Isolate all process-view logic in `ProcessViewChart.tsx` and `WaterfallCard.tsx`. Step2 only adds: `showProcessView` state, toggle button in chart header, and the conditional render.
**Warning signs:** Step2 approaching or exceeding 500 lines of new code (project rule: flag files > 500 lines for refactoring).

### Pitfall 5: Waterfall bars summing incorrectly
**What goes wrong:** Waterfall offset bars show wrong base positions because the "invisible base" pattern in Recharts requires the base to be the cumulative sum of prior bars.
**Why it happens:** Recharts stacked Bar uses absolute values, not relative. The waterfall pattern requires computing running totals manually.
**How to avoid:** Pre-compute `base` values in the data array before passing to Recharts. Negative drag bars need `base = previousTotal + drag` (bar displays from base to base+value, where value is negative).
**Warning signs:** Bars overlap or start from 0 rather than from the prior bar's end.

---

## Code Examples

### How runOptimization is called today
```typescript
// Source: src/lib/optimizer.ts lines 152-168
export function runOptimization(input: OptimizeInput): OptimizeResult {
  const {
    prices,          // ← swap this for perturbed prices for scenario modeling
    battery_kwh,
    charge_power_kw,
    start_level_percent,
    window_start,    // ← swap this for perturbed window for availability error
    window_end,
    target_level_percent,
    base_price_ct_kwh,
    margin_ct_kwh,
    customer_discount_ct_kwh,
    dso
  } = input
```

### How FunnelTimeline stage dots work (replicate this pattern)
```typescript
// Source: src/components/v2/IntradayFunnel.tsx lines 316-341
{stages.map((stage, idx) => (
  <button onClick={() => goToStage(idx)}
    className={`... ${idx === stageIndex ? 'bg-sky-100 text-sky-700' : ...}`}
  >
    <div className={`w-2.5 h-2.5 rounded-full border-2 ... ${
      idx === stageIndex ? 'bg-sky-500 border-sky-500 scale-125' : ...
    }`} />
    <span className="text-[9px] font-semibold tabular-nums">{stage.label}</span>
  </button>
))}
```

### How showFleet gates chart rendering (replicate for showProcessView)
```typescript
// Source: src/components/v2/steps/Step2ChargingScenario.tsx lines 1612-1621
<button onClick={() => setShowFleet(false)}
  className={`... ${!showFleet ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
  Single EV
</button>
<button onClick={() => { setShowFleet(true); setFleetView('fleet') }}
  className={`... ${showFleet ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
  Fleet
</button>
```

### How computeFlexBand is called
```typescript
// Source: src/components/v2/steps/Step2ChargingScenario.tsx lines 543-570 (approx)
const band = computeFlexBand(
  fleetConfig,      // FleetConfig with distributions
  windowSlots,      // HourlyPrice[] for the overnight window
  isQH,             // boolean
  scenario.chargingMode, // 'overnight' | 'fullday' | 'threeday'
)
```

---

## Integration Map

### What Step2ChargingScenario.tsx gains (minimal)
```
+ showProcessView: boolean state
+ setShowProcessView setter
+ "Process" toggle button in chart header (alongside Single/Fleet toggle)
+ Conditional render: {showProcessView ? <ProcessViewChart ...> : <existing chart>}
```

### What ProcessViewChart.tsx contains
```
- Stage scrubber (3 stages: Forecast / DA / Intraday) — clone of FunnelTimeline
- Scenario selector (Perfect / Realistic / Worst) — 3 tabs or segmented control
- ComposedChart with:
  - DA price line (always visible)
  - Stage-appropriate charging block overlays (ReferenceArea)
  - Uncertainty corridor at Forecast stage (ReferenceArea with low opacity)
  - Intraday price line when stage === 'intraday_adjustment' and intradayFull available
- useProcessView hook call (see below)
```

### What useProcessView hook (in process-view.ts) computes
```
Given: prices (DA), intradayFull, scenario, uncertaintyScenario, showFleet, fleetConfig

Returns:
  stageResults: {
    forecast: { optimizeResult, windowStart, windowEnd }  // perturbed
    da: { optimizeResult }                                 // real DA, possibly perturbed window
    intraday: { optimizeResult } | null                    // intraday prices if available
  }
  waterfallData: WaterfallBar[]   // for WaterfallCard
  fleetWaterfallData: WaterfallBar[] | null  // when showFleet
```

### What WaterfallCard.tsx contains
```
- Recharts ComposedChart with stacked Bar (waterfall pattern)
- Labels: Perfect → DA Forecast Error → Availability Error → Intraday Cost → Realized
- Single EV and Fleet columns when showFleet
- Color: emerald for value bars, red for drag bars
```

---

## Uncertainty Scenario Calibration

[ASSUMED] — Historical DA forecast error data not verified in this session. The following numbers are based on training knowledge of German EPEX DA markets:

| Scenario | DA Price Error | Plug-in Variance | Intraday Correction |
|----------|---------------|-----------------|---------------------|
| Perfect foresight | 0 EUR/MWh | 0h | 0 EUR/MWh |
| Realistic | ±8 EUR/MWh RMSE | ±1h | 2-5 EUR/MWh spread |
| Worst case | ±20 EUR/MWh, biased high | +2h late arrival | 8-15 EUR/MWh |

**Risk if wrong:** Waterfall drag bars may be too large or too small. Should be confirmed with Lars who has domain expertise. These values are inputs, not hard-coded — they can be tuned easily.

For fleet mode, divide DA price error by `√(effectiveFleetSize)`:
- 10 cars: divide by ~3.2 → realistic error ~2.5 EUR/MWh
- 100 cars: divide by ~10 → realistic error ~0.8 EUR/MWh

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Recharts stacked Bar with invisible-offset technique works cleanly for waterfall | Don't Hand-Roll | May need custom SVG fallback; medium effort |
| A2 | Historical DE DA forecast error is ~8 EUR/MWh RMSE (realistic scenario baseline) | Uncertainty Calibration | Wrong drag magnitudes in waterfall; easy to retune |
| A3 | Worst-case plug-in delay of +2h is a reasonable upper bound | Uncertainty Calibration | Wrong availability-drag bar size; easy to retune |
| A4 | Seeded deterministic perturbation (using date string as seed) will produce stable `useMemo` behavior | Common Pitfalls | Flickering waterfall if wrong; straightforward to fix |

**All other claims in this document are VERIFIED against source files read in this session.**

---

## Open Questions

1. **Scrubber vs. scroll-driven reveal** (Claude's Discretion)
   - What we know: FunnelTimeline scrubber is proven and keyboard-accessible. TheoryOverlay uses click-through navigation. Scroll-driven would require intersection observers or scroll event handlers on the chart container.
   - What's unclear: Does Lars prefer the scrubber-click model (more explicit, same as funnel) or a scroll-peel model (more cinematic but harder to implement in Recharts)?
   - Recommendation: Use scrubber-click (clone FunnelTimeline). Scroll-driven adds significant complexity for minimal gain; the chart container does not have a natural vertical scroll.

2. **Entry point for process view**
   - What we know: D-01 says it "replaces the chart temporarily" — a toggle button in the chart header is the most natural fit, consistent with Single/Fleet and DA/Intraday toggles.
   - What's unclear: Should the "Process" button appear in the same pill group as Single EV / Fleet? Or be a separate button in the chart header row?
   - Recommendation: Separate button/badge in the chart header (not inside the Single/Fleet pill group, since process view works for both modes).

3. **Uncertainty percentage calibration confirmation**
   - What we know: A1-A3 are assumed values. Lars has domain expertise.
   - Recommendation: Expose as constants in `process-view.ts` so Lars can tune them without touching logic.

---

## Environment Availability

Step 2.6: SKIPPED — no external dependencies identified. Phase is purely code/config changes using existing stack (Recharts, React, existing lib functions).

---

## Validation Architecture

Step 2.4: SKIPPED — `workflow.nyquist_validation` is explicitly `false` in `.planning/config.json`.

---

## Security Domain

No new API routes, authentication flows, or data storage. Phase adds client-side computation only. Security domain: not applicable.

---

## Sources

### Primary (HIGH confidence — verified by reading source files)
- `src/components/v2/IntradayFunnel.tsx` — FunnelTimeline scrubber pattern, FunnelStage types, useIntradayFunnel hook
- `src/components/v2/TheoryOverlay.tsx` — Step navigation pattern, √N fleet visualization, synthetic flex band data
- `src/components/v2/steps/Step2ChargingScenario.tsx` — showFleet/showIntraday toggle patterns, chart mode architecture, integration points
- `src/lib/optimizer.ts` — runOptimization() signature and semantics; pure function, takes any PricePoint[]
- `src/lib/fleet-optimizer.ts` — computeFlexBand, optimizeFleetSchedule, deriveFleetDistributions, generateDistribution signatures
- `src/lib/charging-helpers.ts` — computeWindowSavings, computeSpread, buildOvernightWindows
- `src/lib/v2-config.ts` — FleetConfig, FleetOptimizationResult, FlexBandSlot, FleetScheduleSlot types
- `src/lib/use-prices.ts` — PriceData shape, intradayFull/intradayId3 availability
- `.planning/config.json` — nyquist_validation: false, commit_docs: true

### Tertiary (LOW confidence — assumed from training knowledge)
- Recharts waterfall Bar pattern (invisible offset + visible delta) — not verified against Recharts v3.7 docs
- German DA forecast error magnitude (~8 EUR/MWh RMSE) — energy market knowledge, not verified from current sources

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — no new packages, all existing
- Architecture patterns: HIGH — verified against actual source files
- Integration points: HIGH — exact line numbers confirmed
- Uncertainty calibration: LOW — assumed from training knowledge, needs user confirmation
- Pitfalls: HIGH — derived from codebase analysis, not speculation

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (stable stack, no external APIs involved)
