# Phase 6: Process View — Chronological Optimization Timeline — Context

**Gathered:** 2026-04-09
**Status:** Ready for planning

<domain>
## Phase Boundary

Dedicated "process view" mode on the price chart that walks the user through the chronological optimization timeline: forecast → DA nomination → intraday adjustment. Uses real price data (not synthetic). Includes uncertainty modeling with a waterfall value-drag visualization.

This replaces the normal chart temporarily (not an overlay on top of it). The existing TheoryOverlay uses synthetic data in a full-screen view — this is different: it uses real data integrated into the chart area.

</domain>

<decisions>
## Implementation Decisions

### Presentation Mode
- **D-01:** Dedicated "process view" that replaces the normal chart temporarily. Not an overlay on the existing chart, not a full-screen takeover like TheoryOverlay.
- **D-02:** The view should use the actual price data for the selected date (real DA prices, real intraday data when available).

### Timeline Mechanism
- **D-03:** Time-axis scrubber or scroll-driven reveal — user progresses through the chronological stages by scrubbing/scrolling, information is progressively revealed.
- **D-04:** Three chronological stages to reveal:
  1. **Forecast** (D-2 to D-1 12:00): Estimate when car plugs in, kWh needed, duration → derive baseline charging schedule
  2. **DA Nomination** (D-1 12:00): DA auction prices revealed → nominate cheapest slots in overnight window (with forecast uncertainty)
  3. **Intraday Adjustment** (D, continuous): Actual car availability revealed, intraday prices available → re-optimize position, forced trades when forecast was wrong

### Uncertainty & Value Drag
- **D-05:** Three uncertainty scenarios the user can select:
  1. **Perfect foresight** — current dashboard behavior, know DA prices and car behavior exactly
  2. **Realistic forecast** — DA prices have forecast error, car plug-in time/SoC has variance → degraded savings
  3. **Worst case** — large forecast errors, late/early plug-in, forced intraday trades at wider spreads
- **D-06:** Selecting a scenario updates BOTH the chart visualization AND a waterfall value-drag card/chart
- **D-07:** Waterfall shows: Perfect value → minus DA forecast error drag → minus car availability error drag → minus intraday correction spread = realized value
- **D-08:** Key insight to communicate: DA price is unknown at nomination time, car availability is unknown → may lead to false position. In intraday, actual car availability is revealed and may force additional optimization trades at cost.
- **D-09:** Currently the dashboard shows the "perfect world" — this feature makes visible how much uncertainty costs.

### Data Source
- **D-10:** Use actual real-time data from the chart (requires intraday data for selected date). When intraday data is unavailable, show only the DA stages and indicate intraday stage is data-dependent.

### Claude's Discretion
- Specific scrubber vs. scroll-driven UX — researcher/planner can evaluate best approach given Recharts constraints
- Exact uncertainty percentages for "realistic" and "worst case" scenarios — can be derived from historical DA forecast error distributions
- Waterfall chart library choice (Recharts Bar with stacked segments, or custom SVG)
- Whether the process view is accessed via a button/toggle on the existing chart, or from the TheoryOverlay navigation

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Existing Process Visualization
- `src/components/v2/TheoryOverlay.tsx` — Existing 5-step theory walkthrough with synthetic data. Steps: Shape → DA Optimization → Intraday → Portfolio → Flex Band. Reuse navigation pattern (progress dots, prev/next).
- `src/components/v2/IntradayFunnel.tsx` — Convergence funnel (DA → ID3 → ID1 → ID Full → Last) with price corridors. Provides `FunnelPoint`, `FunnelState` types and `useIntradayFunnel` hook.

### Chart Integration
- `src/components/v2/steps/Step2ChargingScenario.tsx` — Main chart component (~2900 lines). Contains the ComposedChart, all overlay logic, and the funnel timeline scrubber integration.

### Optimization Engine
- `src/lib/optimizer.ts` — `runOptimization()` — currently runs once on DA prices. Process view needs to show re-optimization at different stages.
- `src/lib/charging-helpers.ts` — `computeWindowSavings`, `computeSpread`, `buildOvernightWindows` — baseline/optimized cost computations.

### Price Data
- `src/lib/use-prices.ts` — Price data hook providing `intradayId3`, `intradayFull`, `hourly`, `hourlyQH` data.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **TheoryOverlay navigation pattern**: Progress dots + stepper (prev/next) — proven UX, reuse for stage navigation
- **IntradayFunnel data model**: `FunnelPoint` with `corridorLow`/`corridorHigh`/`corridorWidth` — captures uncertainty narrowing
- **ReferenceArea overlays**: Step2 already renders 10+ overlay types — established pattern for adding process-view overlays
- **`useIntradayFunnel` hook**: Computes funnel state per stage — can be extended for process view stages

### Established Patterns
- Chart overlays use `<ReferenceArea>` with `fillOpacity` and color-coding (green=optimized, red=baseline, blue=intraday)
- Toggle controls rendered in the chart header area (renewable toggle, QH/H resolution toggle)
- Session cost computations flow through `computeWindowSavings` → `SessionCostCard`

### Integration Points
- Process view toggle would sit alongside existing chart mode controls
- Needs access to same price data (`usePrices` hook output)
- Waterfall card would be a new component alongside SessionCostCard/MonthlySavingsCard
- Re-optimization calls would use existing `runOptimization()` with modified price inputs (forecast vs. actual)

</code_context>

<specifics>
## Specific Ideas

- User wants the timeline to feel like "walking along and it is revealed" — progressive disclosure, not all-at-once
- The waterfall should clearly decompose where value is lost: DA forecast error, car availability error, intraday correction cost
- The three scenarios (perfect/realistic/worst) are user-selectable, and each updates the waterfall
- Current dashboard = "perfect world" — this feature is the reality check

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope

</deferred>

---

*Phase: 06-process-view*
*Context gathered: 2026-04-09*
