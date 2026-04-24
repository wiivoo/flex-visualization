# PROJ-43 QA Audit - /battery/calculator

Date: 2026-04-25
Audited area: `src/app/battery/calculator`, `src/components/battery/calculator`, `src/lib/pv-battery-calculator.ts`
Spec reference: `features/PROJ-43-pv-battery-dynamic-calculator.md`

## What Is Happening Here

The `/battery/calculator` route renders a client-side calculator UI (`PvBatteryCalculator`) that:
- Loads market prices via `usePrices('DE')`.
- Loads normalized PV/load profiles via `useBatteryProfiles`.
- Builds optimization inputs with tariff-adjusted import prices and spot-based export prices (`buildPvBatteryInputs`).
- Runs a dynamic-programming optimizer (`optimizePvBattery`) over discrete battery SOC states (0.5 kWh steps).
- Produces annual KPIs and a day-level chart.

Dispatch objective in solver code is net-cost minimization under routing permissions and battery/grid constraints.

## QA Methods Used

- Source audit against acceptance criteria in PROJ-43.
- Static constraint and edge-case review of optimizer logic.
- Test run: `npx vitest run src/lib/__tests__/pv-battery-calculator.test.ts`.
- Result: 1 test file passed, 11/11 tests passed.

## Findings (Ordered By Severity)

### High

1. Selected-day visualization is not replaying the annual optimized path.
- Impact: The day chart can show behavior that differs from the annual scenario the KPIs are based on.
- Evidence: Day data is re-optimized in isolation from annual context (`dayResult` built from `dayPrices` + fresh `optimizePvBattery` call), instead of slicing the day from annual slots.
- References:
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:1121`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:1143`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:1520`
- Spec mismatch: PROJ-43 requires selected day to inspect routing from the active annual scenario.

2. Annual baseline/import reporting uses spot reference instead of tariff import curve.
- Impact: Displayed baseline cost, residual import cost, net cost, and savings can be economically inconsistent with tariff assumptions shown in UI text.
- Evidence:
  - `slotBaselineCostEur` and `slotImportCostEur` are computed using `slot.price.priceCtKwh` (spot) instead of `slot.importPriceCtKwh`.
  - UI claims baseline/import follow tariff-adjusted import curve.
- References:
  - `src/lib/pv-battery-calculator.ts:1061`
  - `src/lib/pv-battery-calculator.ts:1062`
  - `src/lib/pv-battery-calculator.ts:1063`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:832`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:888`

### Medium

3. Incomplete years are treated as available annual replay years.
- Impact: Partial-year data can be presented as annual estimate despite spec requiring explicit limitation handling.
- Evidence: Year availability only checks year presence in data, not full-year completeness.
- References:
  - `src/lib/pv-battery-calculator.ts:852`
  - `src/lib/pv-battery-calculator.ts:861`

4. Load-profile control is effectively fixed to `H25` and query `profile` is ignored.
- Impact: Acceptance criterion for changing allowed load profile is not met; ambiguity callout (`H25/P25/S25`) is not surfaced in UI.
- Evidence:
  - `parseState` hardcodes default load profile and does not parse `profile` query.
  - No load-profile selector rendered in calculator controls.
- References:
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:304`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:306`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:1070`

5. Export-limit control is not user-configurable beyond plug-in toggle behavior.
- Impact: Acceptance criterion for live update on export limit changes is only partially satisfied.
- Evidence: No general export-limit slider/input in UI; only plug-in switch toggles between `0.8` and `5` kW.
- References:
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:1472`
  - `src/components/battery/calculator/PvBatteryCalculator.tsx:1483`

### Low

6. Test coverage does not currently protect key product-rule regressions above.
- Impact: Regressions on annual-vs-day consistency and tariff-based baseline math can pass CI.
- Evidence: Existing tests validate many flow constraints and provenance splits, but not annual/day consistency or tariff-vs-spot accounting in displayed annual KPIs.
- Reference:
  - `src/lib/__tests__/pv-battery-calculator.test.ts:64`

## Security Audit Notes

- No direct critical client-side injection vectors found in this slice.
- ZIP input is constrained to digits and length (`maxLength=5`, `replace(/\D/g, '')`).
- Primary risk is model/output correctness (financial interpretation), not classic auth/data-exposure in this route.

## Acceptance-Criteria Snapshot

- Likely pass:
  - Cost-minimizing objective in solver dispatch.
  - Flow-permission controls for six modeled routes.
  - Core routing constraints (SOC bounds, charge/discharge exclusivity, export cap coupling).
- Likely fail or partial:
  - Selected-day should reflect annual replay (currently re-optimized per day).
  - Baseline/optimized comparison accounting consistency with tariff import pricing.
  - Allowed load-profile selection behavior and ambiguity callout.
  - Clear prevention of misleading annual result for incomplete year data.
  - Explicit export-limit live control in UI.

## Production-Readiness Recommendation

NOT READY for spec-complete release of PROJ-43 due High findings (annual/day mismatch and tariff-accounting inconsistency).

## Suggested Fix Order

1. Fix annual-vs-day consistency by deriving day chart from annual slots for selected date.
2. Align annual financial reporting with tariff import price assumptions.
3. Add full-year completeness gating and explicit partial-data messaging.
4. Implement/load-profile selector behavior per confirmed profile set and document ambiguity handling.
5. Add explicit export-limit control (or update spec/AC if intentionally constrained).
