# PROJ-45 - PV + Battery Rolling Replay Planner

## Status: In Review
**Last Updated:** 2026-05-04

## Dependencies
- Requires: PROJ-43 - PV + Battery Dynamic Tariff Calculator
- Related audit note: `docs/battery/pv-battery-calculator-audit-and-model-notes.md`

## Goal

Add a target-state rolling replay planning model to `/battery/calculator` that reconstructs how a PV + battery system would be planned against newly published day-ahead prices, without claiming live control or full perfect foresight.

This feature is intentionally separate from the current full-horizon deterministic replay model. Until the rolling planner is implemented and validated, the product must continue to distinguish the current model from the target model in UI copy and audit output.

## User Stories

1. As a homeowner or product user, I want the calculator to replan when new day-ahead prices are published so that the replay better reflects operational planning under a dynamic tariff.
2. As a user, I want the model to use a given PV production forecast and an `H25` household load forecast so that the planning basis is explicit and reproducible.
3. As a user, I want the calculator to optimize my modeled household energy cost rather than self-sufficiency so that the dispatch reflects tariff economics.
4. As an analyst or product owner, I want every optimization run and every slot to include provenance fields so that the result can be traced back in Excel or another audit table.
5. As a user, I want the UI to explain how the rolling planner differs from the current full-horizon replay so that the product does not overclaim what the model knows.

## Scope

- Extend the PV + battery calculator with a rolling replay planning model.
- Replan only when a new day-ahead price horizon is published.
- Use provided or forecast PV production as the PV input for planning.
- Use `H25` as the household load forecast basis for planning.
- Preserve the existing tariff-based import settlement and spot-linked export valuation logic.
- Keep the optimizer state-based, where the controlled cross-slot decision is the battery state of charge path.
- Derive slot flows from the chosen state path and the active constraints, then expose them in an audit-friendly form.
- Add provenance and audit output for both optimization runs and resulting slots.
- Make the model basis and claim boundaries explicit in product copy.

## Product Rules

### 1. Objective Function

The rolling planner must minimize modeled net household electricity cost over the currently known planning horizon, subject to the active flow permissions and physical constraints.

Net household electricity cost is defined as:

- Total import energy cost at the modeled household import tariff
- Minus export revenue at the modeled export valuation
- Plus any modeled export-related deductions or fees that are part of the active market assumption

Rules:

- Self-sufficiency and self-consumption remain reporting metrics only.
- The planner must not describe self-sufficiency as the primary objective.
- Fixed subscription fees that do not change between feasible dispatches are not part of dispatch optimization logic.

### 2. Planning Cadence And Information Horizon

The target planner is not a full-year perfect-foresight replay and is not a live controller.

Rules:

- The planner must run when a new day-ahead price horizon becomes available.
- Each optimization run may only use information that is assumed to be known at that run time.
- The planner must not use future price slots beyond the known price horizon for that run.
- A run may produce a planned path for the full currently known horizon, but only the slots up to the next replan event are committed as realized replay output.
- When the next publication event arrives, the planner must solve again from the carried-forward battery state.

### 3. Forecast Inputs

The planner must use explicit forecast assumptions for the rolling horizon.

For the first version of this feature:

- PV production may be treated as a given or forecast time series.
- Household demand must be forecast from `H25`.

Rules:

- The UI must explicitly identify `PV forecast / given production` and `H25 household load forecast` as model assumptions.
- The product must not imply that the household load forecast is a measured smart-meter trace when it is a standard profile forecast.
- If quarter-hour replay is used, the product must define and apply a consistent quarter-hour allocation for the `H25` forecast.

### 4. Decision Model

The rolling planner must remain state-based.

Rules:

- The controlled cross-slot decision variable is the battery `SoC` path.
- Visible routing flows are not independent user-controlled knobs per slot.
- For each slot, the product must derive feasible flows from:
  - `SoC_start`
  - `SoC_end`
  - PV forecast
  - household load forecast
  - import price
  - export price
  - active flow permissions
  - power limits
  - export cap
- The planner must keep the slot math reconstructable in an audit table and in spreadsheet form.

### 5. Routing Trade-Offs

The planner must still optimize the economic trade-off between:

- `PV -> household load`
- `PV -> battery`
- `PV -> grid`
- `grid -> battery`
- `battery -> household load`
- `battery -> grid`

Rules:

- The trade-off must be solved inside each slot as part of the derived dispatch, not removed from the model.
- The planner must respect the same physical and permission constraints already defined for the calculator route.
- The battery may not charge and discharge in the same interval.
- The planner must not create a deliberate same-interval import/export loop whose only purpose is to exploit accounting artifacts.

### 6. Pricing And Settlement Basis

The rolling planner must keep the existing asymmetric settlement logic.

Rules:

- Import must settle at the modeled household retail tariff, not raw day-ahead spot alone.
- Export must settle at the active spot-linked export valuation rule.
- The UI must not claim that grid import is bought at raw day-ahead spot if the model uses tariff-adjusted import pricing.
- The UI must not claim symmetric import and export pricing when the model is asymmetric.

### 7. Terminal Rule

Each optimization run must include an explicit terminal condition for the end of the currently known horizon.

Requirement:

- The planner must not leave the end of the optimization horizon unconstrained in a way that encourages artificial battery emptying or filling solely because the model stops there.

Rules:

- The terminal rule must be explicit and documented.
- The implementation may choose one confirmed terminal strategy for the first version, such as:
  - final `SoC` equals starting `SoC`
  - final `SoC` equals a fixed reserve target
  - final `SoC` is penalized by a documented terminal value function
- The chosen terminal rule must appear in provenance metadata and implementation notes.

### 8. Stitching Across The Year

The annual replay for this feature must be built by stitching together many rolling optimization runs.

Rules:

- Each run starts from the carried-forward `SoC` of the previously committed slot sequence.
- The annual result must aggregate committed slots from the stitched rolling replay, not from a single perfect-foresight solution.
- Selected-day views must be slices of the stitched rolling replay for the active model.

### 9. Provenance And Audit Output

This feature must make the rolling replay fully auditable.

The product must provide run-level provenance fields including:

- `run_id`
- `run_timestamp`
- `known_horizon_start`
- `known_horizon_end`
- `committed_until`
- `initial_soc_kwh`
- `terminal_rule`
- `pv_forecast_source`
- `load_forecast_source`
- `price_source`
- `tariff_basis`

The product must provide slot-level audit fields including:

- `run_id`
- `slot_timestamp`
- `soc_start_kwh`
- `soc_end_kwh`
- `pv_forecast_kwh`
- `load_forecast_kwh`
- `retail_import_price_ct_kwh`
- `export_price_ct_kwh`
- `pv_to_load_kwh`
- `pv_to_battery_kwh`
- `grid_to_battery_kwh`
- `battery_to_load_kwh`
- `pv_to_grid_kwh`
- `battery_to_grid_kwh`
- `grid_to_load_kwh`
- `curtailed_kwh`
- `slot_import_cost_eur`
- `slot_export_revenue_eur`
- `slot_net_cost_eur`

Rules:

- The audit output must allow a user to reconstruct the reported result outside the UI.
- The product may expose the audit output as a table, export, or both.

### 10. Product Copy And Claim Boundaries

The product must clearly distinguish the current model from the target rolling planner.

Rules:

- The UI must not say that the current deterministic replay already behaves as a rolling planner.
- The UI must not say that the solver reruns every 15 minutes unless that is the actual modeled planning cadence.
- The UI must not describe the rolling planner as a live controller.
- The UI must state the forecast basis for PV and household load.
- The selected-day view must identify which rolling run produced the shown slots.

## Out Of Scope

- Live inverter control or smart-home actuation
- Household-specific machine-learning load forecasts
- Smart-meter ingestion as a required input
- Intraday re-optimization beyond the defined day-ahead publication cadence in the first version
- New country support beyond the current calculator scope
- Changing the existing import/export accounting basis for the calculator

## Edge Cases

1. Missing or incomplete published price window: the planner must not pretend to know a full horizon that is not available.
2. Unknown initial `SoC`: the product must either require a documented starting `SoC` assumption or use a clearly labeled default.
3. Terminal rule creates infeasibility: the product must fall back to a documented feasible rule rather than silently dropping the constraint.
4. Export cap binds during a high-PV slot: the planner must route remaining PV to load, battery, or curtailment according to permissions and feasibility.
5. `PV -> grid` disabled with strong PV surplus: the planner must curtail or store surplus PV rather than inventing an export path.
6. `grid -> battery` disabled during low-price hours: the planner must still operate without synthetic grid charging.
7. Negative or near-zero price periods: the planner must still honor all routing and anti-loop rules.
8. Year boundary or partial replay window: the annual stitched result must remain explicit about the covered committed horizon.
9. Quarter-hour replay with hourly H25 source data: the quarter-hour allocation method must be documented and applied consistently.

## Acceptance Criteria

- [ ] A separate feature spec exists for the rolling replay planner without rewriting the current PROJ-43 feature definition.
- [ ] The target model replans on day-ahead publication events rather than using full-year perfect foresight.
- [ ] Each optimization run is limited to the information horizon that is assumed to be known at that run time.
- [ ] The rolling planner uses given or forecast PV production and `H25` as the household load forecast basis.
- [ ] The rolling planner continues to optimize modeled net household energy cost rather than self-sufficiency.
- [ ] Import settlement remains tariff-adjusted retail import pricing and export settlement remains spot-linked export valuation.
- [ ] The planner remains state-based, with battery `SoC` as the cross-slot decision variable and visible slot flows derived afterward.
- [ ] The product defines and enforces an explicit terminal rule for each optimization run.
- [ ] Annual rolling results are stitched from committed segments across multiple optimization runs rather than taken from one full-horizon solve.
- [ ] The selected-day view for the rolling planner comes from the stitched rolling replay and includes run provenance.
- [ ] The product exposes run-level provenance fields and slot-level audit fields sufficient for spreadsheet reconstruction.
- [ ] UI copy distinguishes the current deterministic replay from the target rolling replay planner and does not overclaim live or quarter-hour replanning behavior.
