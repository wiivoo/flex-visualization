# PROJ-43 - PV + Battery Dynamic Tariff Calculator

## Status: In Progress
**Last Updated:** 2026-04-24

## Dependencies
- None

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
- [ ] The selected-day controls let the user inspect any valid replay day without changing the annual optimization result.
- [ ] If the requested replay year or selected day lacks sufficient data, the UI states that limitation clearly instead of showing a misleading annual result or unsupported fine-grain replay.
