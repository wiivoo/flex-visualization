# PROJ-43 - PV + Battery Dynamic Tariff Calculator

## Status: In Progress
**Last Updated:** 2026-05-07

## Dependencies
- None

## Audit Note

- Implementation and chart-audit note: `docs/battery/pv-battery-calculator-audit-and-model-notes.md`

## Goal

Add a dedicated calculator at `/battery/calculator` that estimates annual household electricity outcome for a PV + battery system under a German dynamic tariff, using a `/v2`-style settings rail and a selected-day replay view.

This update supersedes the earlier "self-sufficiency-first" requirement. The calculator must optimize for lowest modeled net household electricity cost, not for highest self-sufficiency.

## User Stories

1. As a homeowner or product user, I want the calculator to optimize against my electricity bill outcome so that the result reflects actual tariff economics rather than a self-sufficiency heuristic.
2. As a user, I want to explicitly allow or forbid specific energy flows so that the replay matches the operating mode, regulation, or inverter settings I care about.
3. As a user, I want to inspect one selected day on the price curve so that I can see why the optimizer charged, discharged, exported, imported, or curtailed energy.
4. As a user, I want the calculator to distinguish my own inputs from inferred defaults so that I understand which assumptions I control and which come from bundled profiles or market data.

## Scope

- Add or refine a dedicated route at `/battery/calculator`.
- Use a `/v2`-style two-column layout with sticky controls on the left and live results on the right.
- Reuse existing German market price history and bundled load / PV profile inputs already present in the repo.
- Show annual baseline-vs-optimized results plus a selected-day routing chart.
- Show an annual delivered-load allocation summary with:
  - delivered household kWh by bucket
  - effective ct/kWh by bucket
  - a baseline-to-delivered impact bridge with a `ct/kWh` / `EUR/year` toggle
- Expose explicit permissions for dispatch-relevant energy flows.

## Product Rules

### 1. Objective Function

The optimizer must minimize modeled net household electricity cost over the replay horizon, subject to the active flow permissions and physical constraints.

Net household electricity cost is defined as:

- Total import energy cost at the modeled import tariff
- Minus export revenue at the modeled export valuation
- Plus any modeled export-related deductions or fees that are part of the active market assumption

Rules:

- Self-sufficiency and self-consumption are reporting metrics only. They must not override a lower-cost feasible dispatch.
- If two feasible dispatches have the same modeled net household electricity cost within normal rounding tolerance, the product may choose either, but it must not claim that self-sufficiency is the primary objective.
- Fixed subscription fees that do not change between feasible dispatches are not part of dispatch optimization logic, though they may still appear in displayed baseline and optimized totals if shown consistently in both.

### 2. Baseline Comparison

The annual savings result must compare:

- A baseline household with the same tariff, year, and household demand assumptions but without PV and without battery dispatch value
- Against the optimized PV + battery case under the active permissions and constraints

Annual benefit must be presented as:

`Total annual benefit = Consumption/import savings + Export credit`

Where:

- `Consumption/import savings = baseline grid import cost - optimized gross import cost`
- `Export credit = export revenue`
- `Optimized net energy cost = optimized gross import cost - export revenue`

Rules:

- Grid-to-battery charging remains part of optimized gross import cost and carries the same retail import tariff basis as household grid import.
- Export credit must stay separate from consumption/import savings so grid-charged battery export cannot be double-counted.
- Do not label this value stream as peak shaving unless the model adds a demand-charge, capacity-tariff, import-cap, or contracted-power term.
- Use `Exported energy` and `Net grid import` labels instead of ambiguous `net export` wording.
- Curtailed PV is physical information only unless a modeled market rule creates an avoided negative export cost; any avoided cost must be calculated interval by interval from curtailed kWh and that interval's export price, then summed.

### 3. Allowed Energy Flow Controls

The calculator must expose explicit user controls for whether these flows are allowed:

- PV to household load
- PV to battery
- Grid to battery
- Battery to household load
- Direct PV export to grid
- Battery export to grid

Rules:

- Flow permissions must affect both the annual replay and the selected-day chart.
- When a flow is disabled, the optimizer must treat that path as unavailable rather than merely deprioritized.
- Default permissions may vary by market or product stance, but the UI must make the active permissions visible to the user.
- `Grid -> household` remains the always-available fallback path and is not user-disableable in this feature.
- If a source has no enabled destination in an interval:
  - PV must be curtailed.
  - Battery must remain idle for discharge.

### 4. Routing Constraints

For every modeled interval, the dispatch must satisfy all of the following:

- Household load can only be served by direct PV when enabled, battery discharge when enabled, or grid import.
- PV generation can only be allocated to direct household load, battery charging, direct export, or curtailment.
- Battery energy can only come from allowed charging sources and can only leave through allowed discharge destinations.
- Battery state of charge may never go below zero or above usable capacity.
- Charge and discharge power limits must be respected.
- Export at the grid connection point must respect the configured export limit.
- If the export limit is shared by direct PV export and battery export, the combined exported energy in that interval must remain within the limit.
- The battery may not charge and discharge in the same interval.
- The optimizer must not create a deliberate same-interval import/export loop whose only purpose is to inflate revenue or exploit accounting artifacts.
- When no permitted destination exists for surplus PV, that energy must be curtailed.
- When no permitted source exists to cover residual household demand, that demand must be supplied by grid import.

### 5. User-Provided vs Inferred Inputs

The product must clearly distinguish between user-entered controls and inferred system assumptions.

User-provided inputs:

- Tariff
- Replay year
- Annual household demand
- Allowed household load profile from the supported list
- PV size
- Battery usable capacity
- Charge power limit
- Discharge power limit
- Round-trip efficiency
- Export limit
- Allowed energy flow permissions
- Selected day and visible time resolution

Inferred or bundled inputs:

- Import price time series derived from German market data and tariff mapping
- Export price time series derived from the German market rule
- Normalized annual household load shape for the selected supported profile
- Normalized PV generation shape and annual yield assumptions for Germany
- Interval duration and whether quarter-hour replay is available for the chosen day / year

Requirement:

- The UI must not imply that inferred profile shapes or export valuation mechanics were manually entered by the user when they were derived by the product.

### 6. Allowed Load Profiles

The requested restriction for load profiles remains ambiguous and must be called out before implementation is treated as finalized.

Requested but ambiguous set:

- `h25`
- `h25`
- `s25`

Most likely intended interpretation:

- `H25`
- `P25`
- `S25`

Requirement:

- The product must explicitly flag this ambiguity in the spec and implementation handoff rather than silently choosing a different list.
- If engineering must proceed before clarification, the temporary working assumption is `H25 / P25 / S25`, and that assumption must be documented.
- Once clarified, the calculator must restrict the selectable list to the confirmed profile set and use that same restricted set consistently in validation, UI copy, and any URL state handling.

### 7. Selected-Day Chart and Controls

The selected-day area must let the user inspect how the optimized routing behaved on one replay day from the active annual scenario.

The UI must provide:

- A day picker within the active replay year
- A visible resolution control when more than one replay resolution is available
- A routing chart that overlays price with the key energy flows active on that day

The selected-day chart must show, at minimum:

- Import price line
- Household load
- PV generation
- Battery charge
- Battery discharge to household load
- Grid import
- Direct PV export
- Battery export
- Curtailment when present
- State of charge or an equivalent battery-fill trace

Rules:

- Hidden or disallowed flows must not appear as active on the chart.
- The day view is explanatory only; changing the selected day must not alter the annual optimization result.
- If a finer resolution is unavailable for the selected date or year, the UI must clearly fall back to the available resolution instead of implying higher-granularity data exists.

### 8. Annual Delivered-Load Allocation Summary

The annual results area must include a delivered-load allocation view that explains how household load was served and how that affects the blended delivered-energy cost.

The view must use these delivered-load buckets:

- `Grid -> load`
- `PV -> load`
- `PV -> battery -> load`
- `Grid -> battery -> load` (user shorthand: battery spot optimized)

Rules:

- The upper part of the card remains the delivered-load cost summary:
  - volume panel in `kWh`, with `Household total` as a reference row and the delivered-load buckets shown underneath
  - unit-cost panel in `ct/kWh` for the same delivered-load buckets
  - waterfall / bridge from an artificial baseline where all household load is priced at the average spot price of the replay horizon
- The waterfall must support a toggle between `ct/kWh` and `EUR/year`.
- PV-delivered buckets use the confirmed `0.00 ct/kWh` marginal view in this summary.
- Export revenue must stay visually separate from the delivered-load bridge so users can distinguish `cost to serve household load` from `overall modeled net energy result`.
- The lower explanatory area of the card replaces the current legend-table treatment with an isometric flow allocation scene. This scene is explanatory only and does not replace the upper cost summary.
- The desktop node layout must read as one destination-led scene:
  - `Grid` at back-left
  - `PV` at front-left
  - `Battery` at mid-left
  - `Household load` as the front-right hero destination
  - `Export` as a smaller side dock on the far-right edge
- Bucket-to-flow mapping in the lower scene must be:
  - `Residual grid`: `Grid -> Household`
  - `PV`: `PV -> Household`
  - `PV via battery`: `PV -> Battery -> Household`
  - `Spot battery`: `Grid -> Battery -> Household`
  - `Export`: outbound branch from the PV / battery side toward `Export`
- The scene must use a single encoding system:
  - lane width = annual `kWh` share
  - lane color family = source / path family
  - price = compact badge or caption value, not a second full-scene color encoding
- Labels must stay concise and attached to the flow end-state, using the existing product language:
  - short bucket label
  - `kWh`
  - `% of delivered load`
  - `ct/kWh` for paid delivered paths
  - `kWh` plus export revenue for `Export`
- Heavier explanatory details such as modeled cost, baseline-equivalent share, and impact delta belong in tooltip, hover, tap, or expandable detail treatment rather than being permanently embedded in the scene.
- The scene should feel like one explanatory routing diagram, not a legend, mini-table, or repeated metric grid.
- Responsive behavior:
  - `lg+`: full isometric scene
  - `md`: compressed isometric scene with fewer always-visible captions
  - `sm`: flattened stepped flow-rail fallback that preserves the same node order and bucket mapping rather than shrinking the desktop isometric drawing

## Out Of Scope

- Changing the existing `/battery` business-case workflow outside the dedicated calculator surface
- New backend APIs
- Hardware catalog or product comparison flows
- NL household-demand support or a country switcher in this calculator iteration
- Country-specific legal advice panels beyond the market assumptions already modeled
- Custom user-uploaded smart meter traces in this feature
- Commercial, industrial, EV, or heat-pump load shapes in this calculator

## Edge Cases

1. `PV size = 0`: the calculator degenerates to a battery-without-generation case; if grid-to-battery charging is disabled, the battery provides no value.
2. `Battery size = 0`: the calculator behaves as a PV-only replay; battery charge, discharge, and state-of-charge traces remain zero.
3. All export flows disabled: surplus PV may only go to load, battery, or curtailment.
4. Battery export disabled but direct PV export allowed: the optimizer may still export instantaneous PV surplus while forbidding delayed battery export.
5. Grid-to-battery charging disabled: the optimizer may not buy electricity solely to store it, even if import prices are negative or very low.
6. Battery-to-load disabled while charging remains allowed: the product must make clear that stored energy can only be exported or stranded under the remaining permissions.
7. PV-to-household disabled while direct export remains allowed: the model may export PV while the household imports from the grid if that is the permitted configuration.
8. Export limit lower than available PV surplus plus battery discharge: export must be capped and any excess routed to load, battery, or curtailment if feasible.
9. Negative or near-zero prices: the optimizer must still follow the same objective and permission rules without creating prohibited import/export loops.
10. Incomplete annual market data: the product must not present a full-year savings result as if the replay were complete.
11. Selected day outside available replay data: the UI must prevent selection or fall back to a valid day.

## Acceptance Criteria

- [ ] The calculator updates live when the user changes tariff, replay year, annual demand, allowed load profile, PV size, battery size, power limits, export limit, or flow permissions.
- [ ] The annual optimization minimizes modeled net household electricity cost rather than maximizing self-sufficiency.
- [ ] Self-sufficiency and self-consumption remain visible as KPIs but are described as outcome metrics, not as the optimization target.
- [ ] The result compares a no-PV / no-battery baseline against the optimized case using the same tariff, year, and household-demand assumptions.
- [ ] The annual summary presents total annual benefit as consumption/import savings plus export credit, with grid-to-battery charging included in optimized gross import cost.
- [ ] The baseline-vs-optimized bill view separates imported-kWh retail add-ons from export credit and makes clear that add-ons apply to grid-to-battery charging.
- [ ] The export credit view separates direct PV export, PV battery export, grid battery export gross/net, and curtailed PV as informational only.
- [ ] The UI exposes explicit controls for `PV -> load`, `PV -> battery`, `grid -> battery`, `battery -> load`, `PV -> grid`, and `battery -> grid`.
- [ ] Disabling any allowed flow changes the feasible routing set in both the annual replay and the selected-day chart.
- [ ] `Grid -> household` remains available regardless of the other flow-permission settings.
- [ ] The product enforces routing constraints so that energy is conserved, battery state of charge stays within bounds, power limits are respected, same-interval battery charge/discharge is not allowed, and shared export caps are not exceeded.
- [ ] The spec and implementation handoff explicitly call out the unresolved load-profile restriction ambiguity instead of silently resolving it.
- [ ] The selected-day chart shows price plus routed energy flows, including battery charge, battery discharge to load, direct export, battery export, grid import, and curtailment when present.
- [ ] The annual results include a three-part delivered-load allocation summary covering `kWh`, bucket-level `ct/kWh`, and a baseline-to-delivered impact bridge.
- [ ] The impact bridge starts from an artificial all-spot household baseline, uses the delivered-load buckets consistently, and supports a `ct/kWh` / `EUR/year` toggle.
- [ ] Export revenue is shown separately from the delivered-load bridge rather than blended into the same waterfall.
- [ ] The lower part of the delivered allocation card replaces the legend-table presentation with a source-to-load explanatory scene that uses the defined `Grid / PV / Battery / Household / Export` layout and bucket-to-flow mapping.
- [ ] The scene encodes `kWh` share by lane width and source/path by lane color family, while price remains a badge/caption value rather than a second scene-wide heatmap.
- [ ] The upper delivered-load waterfall remains in place as the cost summary, while the lower scene acts as a separate explanatory layer for routing.
- [ ] The selected-day controls let the user inspect any valid replay day without changing the annual optimization result.
- [ ] If the requested replay year or selected day lacks sufficient data, the UI states that limitation clearly instead of showing a misleading annual result or unsupported fine-grain replay.

## Tech Design (Solution Architect)

### 1) Component Structure (PM-friendly visual tree)

`/battery/calculator` page
+-- `CalculatorLayoutShell` (two-column `/v2`-style frame)  
+-- Left Rail: `CalculatorControlsRail` (sticky)
  - Tariff and replay-year controls
  - Household demand and load-profile controls
  - PV and battery sizing controls
  - Operational limits controls (charge/discharge/export)
  - Permission matrix toggles for allowed energy flows
  - Selected-day picker and resolution selector
  - Input provenance hints (user-entered vs inferred)
+-- Right Panel: `CalculatorResultsPanel`
  - `AnnualKpiStrip` (baseline vs optimized totals, savings, self-sufficiency, self-consumption)
  - `AnnualDeliveryAllocationCard`
    - upper delivered-cost summary
      - volume panel for delivered household `kWh`
      - unit-cost panel for delivered household `ct/kWh`
      - impact bridge from artificial all-spot baseline to gross delivered household cost
      - separate export-credit / net-result callouts
    - lower `DeliveredAllocationIsometricScene`
      - destination-led node layout: `Grid`, `PV`, `Battery`, `Household load`, `Export`
      - routed lanes for `Residual grid`, `PV`, `PV via battery`, `Spot battery`, and `Export`
      - compact pinned captions for flow label, `kWh`, share, and price/revenue badge
    - mobile fallback: `DeliveredAllocationFlowRail`
  - `FlowPermissionSummaryCard` (active operational mode summary)
  - `SelectedDayReplayCard`
  - `SelectedDayRoutingChart` (price + flows + SoC trace)
  - `DataQualityStateCard` (full-year, partial-year, or unsupported replay states)

Notes:
- Existing components under `src/components/battery/calculator/` remain the implementation anchor.
- This feature adds or refines responsibilities, not a second competing calculator architecture.
- The top delivered-load waterfall remains unchanged in role; the lower legend-table area is the part replaced by the new explanatory scene.

### 2) Data Model (plain-language domain entities)

`ScenarioInput` (user-provided)
- Tariff identifier
- Replay year
- Annual household demand
- Load profile choice (temporary assumption set `H25/P25/S25` until ambiguity is resolved)
- PV size
- Battery usable capacity
- Charge power limit
- Discharge power limit
- Round-trip efficiency
- Export limit
- Flow permission toggles
- Selected day
- Requested replay resolution

`InferredMarketData` (system-derived)
- Import price time series for selected tariff/year
- Export valuation time series for selected tariff/year
- Interval calendar and resolution availability

`InferredProfiles` (system-derived)
- Normalized annual household load shape for selected profile
- Normalized PV generation shape for Germany
- Annual PV yield assumptions used for scaling

`DispatchIntervalResult` (optimizer output per interval)
- Household load served by PV
- Household load served by battery
- Household load served by grid
- PV to battery charging
- Grid to battery charging
- Direct PV export
- Battery export
- PV curtailment
- Battery state of charge (start/end interval)
- Interval objective contribution (cost/revenue components)

`AnnualSummaryResult` (aggregated output)
- Baseline total modeled electricity cost
- Optimized total modeled electricity cost
- Absolute savings and relative savings
- Total import energy and cost
- Total export energy and revenue
- Total curtailment
- Self-sufficiency and self-consumption as outcome metrics only
- Data completeness status and confidence label

`CalculationMeta`
- Versioned assumption bundle ID
- Completeness flags and missing-interval counts
- Constraint status (feasible/infeasible)
- User-vs-inferred provenance map for display copy

### 3) Optimization Model (objective, constraints, routing/permissions)

Objective:
- Minimize annual net household electricity cost.
- Net cost equals import costs minus export revenues plus modeled export-related deductions.

Primary constraints:
- Energy balance holds each interval.
- Battery state of charge stays within 0 and usable capacity.
- Charge and discharge power limits are enforced.
- Shared export connection cap is enforced for combined PV export and battery export.
- Battery cannot charge and discharge in the same interval.
- No deliberate same-interval import/export arbitrage loop.

Routing and permissions model:
- Permission toggles define which directed flow edges are available.
- Disabled flow edges are removed from feasible routing, not deprioritized.
- `Grid -> household` is always enabled fallback and not user-disableable.
- Surplus PV with no enabled destination is curtailed.
- Residual household demand with no enabled non-grid supply is imported from grid.

Feasibility handling:
- If a scenario is physically feasible, return least-cost dispatch.
- If controls create a structurally constrained but still feasible system, return higher-cost result with explanatory notes.
- If an input set is infeasible, block final KPI claim and return explicit constraint-error state.

### 4) Calculation Flow (end-to-end)

1. Capture current `ScenarioInput` from left rail.
2. Resolve inferred market data and profile shapes for tariff/year/profile.
3. Validate input bounds and permission coherence.
4. Build annual interval replay dataset at available resolution.
5. Run baseline replay with same tariff/year/demand but without PV and battery value.
6. Run optimized replay with PV+battery and active permissions.
7. Aggregate annual KPIs and cost breakdown.
8. Slice selected-day data from the annual optimized replay result.
9. Render right-panel cards and selected-day chart from the same annual run.
10. Attach completeness and provenance messages before displaying final outcome labels.

Design rule for day view:
- The selected-day chart is always an explanatory slice of annual optimization output, never a separate day-only re-optimization.

### 5) Assumptions

- This feature is Germany-only in this iteration.
- Market price and export valuation logic follows existing repo market assumptions.
- Household profile normalization and PV normalization are treated as stable inferred models for this release.
- Interval replay granularity is bounded by available historical data.
- Fixed tariff fees are excluded from dispatch optimization and may be shown in totals only if consistently applied to baseline and optimized cases.

### 6) Edge Case Strategy

- `PV = 0`: run as non-generating scenario; battery value depends on grid-charging permission.
- `Battery = 0`: run as PV-only scenario with all battery flows fixed to zero.
- All export disabled: enforce load, battery, or curtailment only.
- `PV -> load` disabled while export enabled: allow export plus simultaneous grid supply to household when dictated by permissions.
- Negative prices: allow economically rational charging/import while preserving no-loop rule.
- Export-cap saturation: cap exports and reroute remaining feasible energy or curtail.
- Selected day unavailable: prevent invalid selection and auto-fallback to valid day with visible notice.

### 7) Data Completeness Handling

Completeness states:
- `Complete`: full replay coverage for requested annual horizon.
- `Partial`: missing intervals or reduced temporal granularity for part of year.
- `Insufficient`: replay horizon too incomplete for trustworthy annual claim.

Display policy:
- `Complete`: show annual savings and KPI labels normally.
- `Partial`: show annual numbers with explicit partial-data badge and quantified coverage.
- `Insufficient`: suppress definitive annual savings claim and show limitation state with next valid actions.

Guardrail:
- Never label a result as full-year annual optimization when the underlying replay is partial.

### 8) Dependencies

Internal dependencies:
- `src/lib/pv-battery-calculator.ts` for optimization and aggregation logic.
- `src/app/battery/calculator/` route composition.
- `src/components/battery/calculator/` rendering and interaction components.
- Existing market/time-series utilities already used in battery and dynamic tariff flows.

External package dependencies:
- No mandatory new package dependency is required for this design.
- Recharts (already used in-app) remains sufficient for selected-day visualization needs.

### 9) QA Acceptance Mapping

AC mapping to verifiable behavior:
- Live input reactivity: every controlled input invalidates prior scenario result and re-runs deterministic replay.
- Objective correctness: optimized outcome never chosen by self-sufficiency priority over lower net cost.
- Baseline parity: baseline and optimized runs share tariff/year/demand assumptions.
- Permission enforcement: toggling any flow changes feasible edge set in both annual and day outputs.
- Constraint integrity: SoC bounds, power caps, export cap, and no simultaneous charge/discharge are always respected.
- Day-view consistency: selected day always reflects annual run interval slice.
- Data completeness honesty: annual-result labels follow completeness state and never over-claim.
- Ambiguous profile list handling: temporary assumption and unresolved ambiguity remain explicit until product clarification.

### 10) Rollout Risks and Mitigations

Risk: annual vs selected-day mismatch creates user distrust.  
Mitigation: enforce day-slice-from-annual rule and cross-check daily energy totals against annual interval subset.

Risk: tariff cost component inconsistencies between baseline and optimized paths.  
Mitigation: single shared cost component ledger used by both replay paths with QA parity checks.

Risk: permission toggles appear cosmetic if not fully wired into optimizer constraints.  
Mitigation: permission matrix is modeled as hard feasibility gates, not UI-only switches.

Risk: partial-year data interpreted as complete annual economics.  
Mitigation: strict completeness state machine and blocked full-claim labels when insufficient.

Risk: unresolved load-profile ambiguity causes downstream inconsistency.  
Mitigation: freeze temporary `H25/P25/S25` assumption with explicit product sign-off checkpoint.

### 11) Decisions and Tradeoffs

Decision: optimize for net cost, not self-sufficiency.  
Tradeoff: some user-intuitive “autarky” behavior may be reduced when it is economically suboptimal.

Decision: use hard permission gating for energy flows.  
Tradeoff: users can create counterintuitive but valid operating modes that raise modeled cost.

Decision: keep no new backend API for this iteration.  
Tradeoff: limited flexibility for custom user-uploaded traces and broader market expansion in this phase.

Decision: selected-day view is explanatory only.  
Tradeoff: less interactive experimentation at day level, but strong consistency with annual KPI claims.

Decision: completeness-aware result labeling.  
Tradeoff: reduced apparent coverage in sparse data years, but materially stronger trust and auditability.

---

## QA Test Results

**Tested:** 2026-05-06
**App URL:** http://localhost:3000/battery/calculator
**Tester:** QA Engineer (AI)

### Acceptance Criteria Status

#### Calculation And Optimization Logic
- [x] Existing optimizer regression suite passes for net-cost objective, tariff-based settlement, disabled flow permissions, provenance fields, terminal SoC, complete-year filtering, and rolling replay stitching.
- [x] Added invariant matrix coverage for mixed prices, negative export prices, tariff/import asymmetry, shared export cap, charge/discharge power limits, SoC bounds, no same-interval battery charge/discharge, hard permission gates, and aggregate ledger consistency.
- [x] Negative export-price behavior is covered: export prices remain signed, and the active curtailment flag blocks direct PV export during negative-price slots.
- [x] Browser smoke confirms `/battery/calculator` renders without console/page errors at 375px, 768px, and 1440px viewports.
- [x] Export chart cleanup verified: the `SoC path` overlay label is absent after switching chart views.

### Edge Cases Status

- [x] `PV -> load`, `PV -> battery`, `grid -> battery`, `battery -> load`, `PV -> grid`, and `battery -> grid` disabled states are enforced in tested dispatch outputs.
- [x] Shared export cap is enforced for combined direct PV export and battery export in the invariant matrix.
- [x] Negative and near-zero price periods preserve objective and routing constraints without same-slot battery charge/discharge.
- [x] Rolling replay carries committed SoC and inventory into the next run and stamps committed slots with run provenance.

### Security Audit Results

- [x] No authentication or authorization surface applies to this local calculator route.
- [x] Browser smoke reported no runtime console errors or exposed exception traces.
- [x] No new backend mutation or user-data access path was introduced by this QA pass.

### Bugs Found

#### BUG-1: Repository lint gate fails on synchronous state updates in effects
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Run `npm run lint`.
  2. Observe `react-hooks/set-state-in-effect` errors in `src/components/battery/calculator/PvBatteryCalculator.tsx`.
- **Expected:** Lint passes cleanly.
- **Actual:** Lint fails at `setZipInput(state.pvZipCode)` and `setTariffComponents(null)`.
- **Priority:** Fix before deployment if lint is a required CI gate.

### Summary

- **Calculation/optimization checks:** Passed
- **Automated tests:** 37/37 passed
- **Browser smoke:** Passed at mobile, tablet, and desktop widths
- **Bugs Found:** 1 total (0 critical, 0 high, 1 medium, 0 low)
- **Security:** Pass for applicable local-route scope
- **Production Ready:** NO if lint is required; YES for calculation/optimization logic after resolving the lint gate.

## QA Test Results Addendum - 2026-05-08

Detailed calculation QA and dependency map: `docs/battery/pv-battery-calculation-qa-2026-05-08.md`

### Scope

- Re-tested `/battery/calculator` after the calculation-summary and UI indicator changes.
- Focused on calculation interdependencies between annual replay, selected-day replay, last-365 summaries, curtailment behavior, formatting, and responsive chart rendering.

### Commands And Results

- `npx vitest run src/lib/__tests__/pv-battery-calculator.test.ts`: PASS, 19/19 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- Playwright browser probes: PASS for basic render and targeted scenario extraction; FAIL for the bugs listed below.

### Calculation Findings

- Battery-only last-365 sanity now passes: `PV = 0`, `10 kWh` battery, `5750 kWh` load produced about `2,129 kWh` battery-to-household discharge and `EUR 205` savings.
- Curtailment annual/last-365 sanity passes: `8 kWp PV`, `10 kWh` battery produced `EUR 1,421` savings with curtailment on vs `EUR 1,411` with curtailment off.
- Selected-day curtailment display remains ambiguous: selected-day values can render identically after whole-euro and whole-kWh rounding.

### Bugs Found

#### BUG-2026-05-08-1: Last-365 result depends on stale calendar-year selection
- **Severity:** High
- **Steps to Reproduce:**
  1. Open `/battery/calculator` with `PV = 8 kWp`, `Battery = 10 kWh`, selected date `2026-05-07`.
  2. Select `Calendar Year`.
  3. Select `2024`.
  4. Select `Last 365 Days`.
- **Expected:** Last-365 result remains based only on selected date minus 364 days, independent of the calendar-year segment.
- **Actual:** Last-365 savings drops to about `EUR 951` with `3,847 kWh` baseline load, versus the normal approximately `EUR 1,421` / `5,752 kWh` result.
- **Likely Cause:** `trailingSavingsResult` merges `annualResult.slots` with `savingsSummaryCalendarResult?.slots`; the latter follows `savingsSummaryCalendarYear`.

#### BUG-2026-05-08-2: Selected-day quarter-hour view is a separate optimization replay
- **Severity:** High
- **Steps to Reproduce:**
  1. Use quarter-hour resolution.
  2. Inspect `dayResult` in `PvBatteryCalculator.tsx`.
- **Expected:** PROJ-43 says selected-day chart should be an explanatory slice of the annual optimized replay.
- **Actual:** Quarter-hour selected-day mode calls `optimizePvBatteryWithOptions` over the selected window with a fine SoC step, so selected-day values can diverge from annual / last-365 replay semantics.
- **Impact:** Selected-day charts may be physically more granular but are not a faithful slice of the annual result.

#### BUG-2026-05-08-3: Whole-unit formatting hides selected-day calculation changes
- **Severity:** Medium
- **Steps to Reproduce:**
  1. Use `PV = 8 kWp`, `Battery = 10 kWh`, selected day `2026-05-07`.
  2. Toggle `Curtail PV at negative prices` on and off.
- **Expected:** If the underlying economics change, day-level values show enough precision for the user to see it.
- **Actual:** Selected-day headline values can remain visually identical, e.g. `EUR 5`, `0 kWh import`, `13 kWh export`.
- **Likely Cause:** `formatCurrencyAmount` and `formatKwh` round every displayed value to whole units.

#### BUG-2026-05-08-4: Chart container warnings at all tested widths
- **Severity:** Low
- **Steps to Reproduce:**
  1. Browser-smoke `/battery/calculator` at `375`, `768`, and `1440` px widths.
- **Expected:** No chart sizing warnings.
- **Actual:** Recharts warns that `width(-1)` and `height(-1)` should be greater than zero.
- **Impact:** Page renders, but repeated warnings reduce signal in QA logs.

#### BUG-2026-05-08-5: Local price-fetch fallback logs noisy stack traces
- **Severity:** Low
- **Steps to Reproduce:**
  1. Run local dev server without `ENTSOE_API_TOKEN`.
  2. Open `/battery/calculator`.
- **Expected:** Controlled fallback warning.
- **Actual:** Repeated stack traces for missing ENTSO-E token and Energy-Charts 404, even though the API returns `200` via fallback.

### Production Readiness

- **Production Ready:** NO for calculation sign-off.
- **Blockers:** BUG-2026-05-08-1 and BUG-2026-05-08-2.
- **Reason:** The optimizer itself passes unit-level invariants, but UI result composition can show a wrong last-365 period and selected-day results that are not slices of the annual replay.

## Fix Verification Addendum - 2026-05-08

The bugs from the QA addendum above were fixed and re-tested.

### Fixes

- BUG-2026-05-08-1 fixed: `Last 365 Days` now uses selected-date-year and trailing-start-year replay results, not the stale calendar-year selection.
- BUG-2026-05-08-2 fixed: selected-day views now slice the yearly replay result instead of running an independent selected-day optimization.
- BUG-2026-05-08-3 fixed: small currency and kWh values now retain decimal precision.
- BUG-2026-05-08-4 fixed: chart wrappers now provide stable minimum and initial dimensions; targeted browser probe reported `0` Recharts sizing warnings.
- BUG-2026-05-08-5 fixed: expected price-source fallback failures now log concise one-time fallback warnings rather than repeated stack traces.

### Verification

- `npx vitest run src/lib/__tests__/pv-battery-calculator.test.ts`: PASS, 19/19 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- Browser stale-calendar probe: `Last 365 Days` stayed at `EUR 1,418`, `EUR 1,754` baseline, and `5,752 kWh` load before and after selecting `Calendar Year -> 2024`.
- Browser selected-day precision probe: day-level values rendered with decimals, including `EUR 5.38`, `EUR 8.17`, and `15.1 kWh`.
- Browser chart warning probe: PASS, `0` Recharts `width(-1)` / `height(-1)` warnings.

### Updated Production Readiness

- **Production Ready:** YES for the scoped calculation-review blockers above.
- **Remaining semantic note:** selected-day detail is now a yearly-replay slice. Annual quarter-hour replay remains a future enhancement if the product needs high-resolution selected-day charts without changing accounting semantics.

## Balcony PV Constraint Addendum - 2026-05-08

Balcony PV mode models Balkon-PV as a shared AC output envelope:

- PV-to-household, PV-to-grid, battery-to-household, and battery-to-grid share the same `800 W` output cap.
- PV may still charge the battery while the plug-in AC output is serving household load.
- Battery charge and discharge in the same interval remains disallowed.
- In balcony PV mode, grid export routes are forced off; surplus PV after household use, battery charging, and the 800 W output cap is treated as spillover rather than a remunerated export route.
- The negative-price curtailment switch is hidden in balcony PV mode because surplus handling is governed by the balcony output cap and spillover behavior.

Verification:

- `npx vitest run src/lib/__tests__/pv-battery-calculator.test.ts`: PASS, 22/22 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.

## Balcony PV Selector Addendum - 2026-05-08

Balcony PV behavior is now controlled by an explicit PV installation selector:

- Rooftop PV is the default and has no balcony AC output restriction.
- Balcony PV applies the shared `800 W` AC output cap and disables grid export routes; surplus becomes spillover after household use and battery charging.
- The PV installation selector uses the same segmented style as the battery connection selector, with Rooftop / Wired as the default left-side choices.
- The balcony AC limit explanation is shown as a tooltip rather than a persistent note.
- ZIP-derived regional tariff add-ons are shown under the Dynamic tariff header; PVGIS yield is shown under PV capacity in the PV System card.
- PV installation mode synchronizes the default battery connection: Rooftop PV selects Wired, Balcony PV selects Plug-in, and battery-only starts as Plug-in.
- Savings summary section rows split avoided-cost value from export value and use quieter neutral row backgrounds to reduce color load.
- Compact PV installation and battery connection selectors are one-line rows.
- Optimized household accounting separates cost and value columns: optimized/import costs remain dark, avoided costs are muted, and export credits render as negative green value.
- Optimized household section rows now use real table cells for Energy / Cost / Value / Avg Value so numbers align with column headers.
- Total Savings detail uses the same table headers and tighter row padding for a more compact first scan.
- Savings summary cards and nested category rows are collapsed by default.
- Baseline and optimized detail labels use `Household consumption` and `Grid export`; optimized and total headings use `Avg price` for consistency.
- Expandable summary table rows toggle from the full row area and support Enter / Space keyboard activation.
- `15 min` selected-day detail is disabled until quarter-hour dispatch can share the same annual replay accounting as the savings summary.
