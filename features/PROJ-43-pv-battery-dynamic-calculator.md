# PROJ-43 - PV + Battery Dynamic Tariff Calculator

## Status: In Progress
**Last Updated:** 2026-04-27

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

- The first panel is a volume panel in `kWh`, with `Household total` as a reference row and the delivered-load buckets shown underneath.
- The second panel is a unit-cost panel in `ct/kWh` for the same delivered-load buckets.
- PV-delivered buckets use the confirmed `0.00 ct/kWh` marginal view in this summary.
- The third panel is a waterfall / bridge from an artificial baseline where all household load is priced at the average spot price of the replay horizon.
- The waterfall must support a toggle between `ct/kWh` and `EUR/year`.
- Export revenue must stay visually separate from the delivered-load bridge so users can distinguish `cost to serve household load` from `overall modeled net energy result`.

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
- [ ] The UI exposes explicit controls for `PV -> load`, `PV -> battery`, `grid -> battery`, `battery -> load`, `PV -> grid`, and `battery -> grid`.
- [ ] Disabling any allowed flow changes the feasible routing set in both the annual replay and the selected-day chart.
- [ ] `Grid -> household` remains available regardless of the other flow-permission settings.
- [ ] The product enforces routing constraints so that energy is conserved, battery state of charge stays within bounds, power limits are respected, same-interval battery charge/discharge is not allowed, and shared export caps are not exceeded.
- [ ] The spec and implementation handoff explicitly call out the unresolved load-profile restriction ambiguity instead of silently resolving it.
- [ ] The selected-day chart shows price plus routed energy flows, including battery charge, battery discharge to load, direct export, battery export, grid import, and curtailment when present.
- [ ] The annual results include a three-part delivered-load allocation summary covering `kWh`, bucket-level `ct/kWh`, and a baseline-to-delivered impact bridge.
- [ ] The impact bridge starts from an artificial all-spot household baseline, uses the delivered-load buckets consistently, and supports a `ct/kWh` / `EUR/year` toggle.
- [ ] Export revenue is shown separately from the delivered-load bridge rather than blended into the same waterfall.
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
    - volume panel for delivered household `kWh`
    - unit-cost panel for delivered household `ct/kWh`
    - impact bridge from artificial all-spot baseline to gross delivered household cost
    - separate export-credit / net-result callouts
  - `FlowPermissionSummaryCard` (active operational mode summary)
  - `SelectedDayReplayCard`
  - `SelectedDayRoutingChart` (price + flows + SoC trace)
  - `DataQualityStateCard` (full-year, partial-year, or unsupported replay states)

Notes:
- Existing components under `src/components/battery/calculator/` remain the implementation anchor.
- This feature adds or refines responsibilities, not a second competing calculator architecture.

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
