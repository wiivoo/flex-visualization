# PV Battery Calculator QA And Calculation Dependency Map

Date: 2026-05-08
Route: `/battery/calculator`
Scope: PROJ-43 / PROJ-45 calculation, summary, and UI-state dependencies.

## Calculation Dependency Map

The calculator has four distinct result layers. They must not be treated as interchangeable:

1. **Annual replay**
   - Source: `annualSource` in `PvBatteryCalculator.tsx`.
   - Current behavior: hourly prices only.
   - Used by: annual result, calendar-year result, last-365 base slots, annual flow cards.
   - Optimizer SoC step: default `0.5 kWh`.
   - Risk: summary values are lower-granularity than the quarter-hour selected-day view.

2. **Selected-day replay**
   - Source: `selectedDaySource` in `PvBatteryCalculator.tsx`.
   - Current behavior: quarter-hour prices when selected.
   - Used by: selected-day savings summary, consumption blocks, day chart, selected-day energy-flow card.
   - Optimizer SoC step: fine `0.1 kWh` for quarter-hour windows.
   - Risk: this is currently a separate replay, not a slice of the annual optimized path.

3. **Last-365 summary**
   - Source: union of `annualResult.slots` and `savingsSummaryCalendarResult?.slots`, filtered by selected date minus 364 days.
   - Used by: `Last 365 Days` savings summary.
   - Risk: the second year in the union currently depends on the user-selected calendar-year control, so a previous calendar selection can contaminate last-365 results.

4. **Accounting and display layer**
   - Source: `summarizeAnnualAccounting`, `aggregatePvBatteryAnnualResult`, `formatCurrencyAmount`, `formatKwh`.
   - Used by: summary rows, headline cards, breakdown subtotals.
   - Risk: all euro and kWh display values are rounded to whole units, which hides selected-day and low-volume effects.

## Test Commands Run

- `npx vitest run src/lib/__tests__/pv-battery-calculator.test.ts`
  - Result: pass, 19/19 tests.
- `npm run lint`
  - Result: pass.
- `npm run build`
  - Result: pass after the UI copy and styling edits in this session.
- Playwright targeted browser probes on Chrome/headless at `1440x1400`.
- Responsive smoke at `375`, `768`, and `1440` px widths.

## Browser Probe Results

### Battery-only annual / last-365 sanity

Scenario:

- `PV = 0`
- `Battery = 10 kWh`
- `Load = 5750 kWh`
- `Grid -> battery = on`
- `Battery -> household = on`
- `Battery -> grid = effectively blocked in battery-only mode`
- `Last 365 Days`

Observed:

- Baseline cost: `EUR 1,754`
- Optimized import cost: `EUR 1,548`
- Battery to household: `2,129 kWh`
- Grid to battery: `2,362 kWh`
- Total savings: `EUR 205`

Assessment: pass. This catches the earlier coarse quarter-hour annual replay failure where battery usage was near zero.

### Curtailment annual / last-365 sanity

Scenario:

- `PV = 8 kWp`
- `Battery = 10 kWh`
- `Last 365 Days`
- Compare `curtailneg=1` vs `curtailneg=0`

Observed:

- Curtailment enabled: `EUR 1,421` total savings.
- Curtailment disabled: `EUR 1,411` total savings.

Assessment: pass for annual/last-365 economics. Turning curtailment off decreases savings by about `EUR 10/year` in this scenario.

### Curtailment selected-day display

Scenario:

- Same as above, selected day `2026-05-07`.
- Compare `curtailneg=1` vs `curtailneg=0`.

Observed display for both states:

- Total savings: `EUR 5`
- Optimized import cost: `EUR 0`
- Export credit: `EUR 2`
- Optimized net cost: `-EUR 2`

Assessment: fail for user interpretability. The selected-day values are rounded to whole euros/kWh, so smaller curtailment effects can disappear from the displayed total even when the model changes.

### Calendar control contaminates last-365

Scenario:

1. Load `PV = 8 kWp`, `Battery = 10 kWh`, selected date `2026-05-07`.
2. Select `Calendar Year`.
3. Select `2024`.
4. Switch back to `Last 365 Days`.

Observed:

- Expected last-365 total savings should remain around the default last-365 result: `EUR 1,421`.
- Actual result after selecting calendar `2024`: `EUR 951`.
- The displayed baseline load drops from `5,752 kWh` to `3,847 kWh`.

Assessment: fail. The last-365 summary is no longer the last 365 days; it is missing the selected-date-year portion after a stale calendar-year selection.

### Browser warnings

Responsive smoke confirms the page renders and the `Savings Summary` is visible at `375`, `768`, and `1440` px widths.

Observed at every tested width:

- Recharts warning: `The width(-1) and height(-1) of chart should be greater than 0`.

Assessment: low-risk visual/runtime warning. It does not block rendering in the smoke test, but it indicates some chart containers render once before they have measurable dimensions.

## Bugs Found

### BUG-2026-05-08-1: Last-365 result depends on stale calendar-year selection

- Severity: High
- Area: `PvBatteryCalculator.tsx`, `trailingSavingsResult`.
- Evidence: after selecting `Calendar Year -> 2024`, switching to `Last 365 Days` reports `EUR 951` and `3,847 kWh` baseline load instead of the expected approximately `EUR 1,421` and `5,752 kWh`.
- Expected: `Last 365 Days` should be derived from the selected date and should not depend on which calendar year segment was last selected.
- Actual: `trailingSavingsResult` merges `annualResult.slots` with `savingsSummaryCalendarResult?.slots`, and `savingsSummaryCalendarResult` follows `savingsSummaryCalendarYear`.
- Suggested fix direction: build the last-365 union from the selected date's year plus the prior year, independent of the calendar-year UI state.

### BUG-2026-05-08-2: Selected-day quarter-hour view is a separate optimization replay

- Severity: High
- Area: `PvBatteryCalculator.tsx`, `dayResult`.
- Evidence: when quarter-hour mode is active, `dayResult` bypasses slicing `annualResult` and calls `optimizePvBatteryWithOptions` over the selected window with `FINE_SOC_STEP_KWH`.
- Expected per PROJ-43: selected-day chart should be an explanatory slice of the annual optimized replay result.
- Actual: selected-day summary and flow views can diverge from annual / last-365 accounting because they are solved as a separate local horizon with different resolution and SoC step.
- Suggested fix direction: either provide an annual quarter-hour/fine replay source that can be sliced, or explicitly label selected-day as a local high-resolution replay and keep it out of annual-accounting claims.

### BUG-2026-05-08-3: Whole-unit formatting hides selected-day effects

- Severity: Medium
- Area: `formatCurrencyAmount`, `formatKwh`.
- Evidence: selected-day curtailment on/off displayed identical headline values (`EUR 5`, `0 kWh import`, `13 kWh export`) even though the underlying economics may change below one euro or one kWh.
- Expected: selected-day and small values should show enough precision for users to see small but real effects.
- Actual: all euro and kWh values are rounded to whole units.
- Suggested fix direction: add precision-aware formatting, for example show one or two decimals for absolute euro values below `EUR 10` and kWh values below `10 kWh`.

### BUG-2026-05-08-4: Chart container warnings at all tested responsive widths

- Severity: Low
- Area: chart containers / Recharts responsive wrappers.
- Evidence: repeated browser warnings at `375`, `768`, and `1440` px widths: `width(-1) and height(-1) of chart should be greater than 0`.
- Expected: charts should mount only when their container dimensions are valid, or containers should have stable minimum dimensions.
- Actual: the page renders, but warnings are noisy and can mask more meaningful console issues.
- Suggested fix direction: add stable `minWidth` / `minHeight` or defer chart render until container layout is measurable.

### BUG-2026-05-08-5: Local data-fetch logs are noisy without ENTSO-E token

- Severity: Low
- Area: `/api/prices/batch` fallback path.
- Evidence: dev server logs repeated `ENTSOE_API_TOKEN environment variable not set` and Energy-Charts `404` errors while the UI still receives `200` responses.
- Expected: known optional-source fallbacks should be logged as controlled fallback states, not repeated stack traces during normal local QA.
- Actual: fallback succeeds, but the logs make it harder to identify real failures.
- Suggested fix direction: downgrade expected missing-token fallback to structured warning or one-time diagnostic.

## Production Readiness Recommendation

Not ready for calculation sign-off until BUG-2026-05-08-1 and BUG-2026-05-08-2 are resolved or explicitly accepted as product limitations.

The core optimizer unit tests pass, but the current UI/result composition has high-risk state and horizon interdependencies that can make displayed summaries inconsistent with the selected period or with the intended annual replay semantics.

## Fix Verification Addendum - 2026-05-08

Follow-up fixes were applied after the findings above.

- BUG-2026-05-08-1: resolved. `Last 365 Days` now builds its slot union from the selected date year and trailing-start year, independent of the calendar-year picker state.
- BUG-2026-05-08-2: resolved for current PROJ-43 semantics. Selected-day views now slice the yearly replay instead of running a separate selected-day quarter-hour optimization.
- BUG-2026-05-08-3: resolved. Currency and kWh formatting now keeps decimal precision for small values.
- BUG-2026-05-08-4: resolved in the targeted browser probe. Calculator chart containers now have stable minimum dimensions and Recharts initial dimensions.
- BUG-2026-05-08-5: resolved. Expected ENTSO-E / Energy-Charts fallback failures now log as concise one-time fallback warnings rather than repeated stack traces.

Verification after fixes:

- `npx vitest run src/lib/__tests__/pv-battery-calculator.test.ts`: PASS, 19/19 tests.
- `npm run lint`: PASS.
- `npm run build`: PASS.
- Browser probe for `PV = 8 kWp`, `Battery = 10 kWh`, selected date `2026-05-07`: `Last 365 Days` remained `EUR 1,418`, `EUR 1,754` baseline, and `5,752 kWh` load before and after selecting `Calendar Year -> 2024`.
- Browser probe for selected-day display: small day-level values rendered with decimals, for example `EUR 5.38`, `EUR 8.17`, and `15.1 kWh`.
- Browser probe chart warning count: `0` Recharts `width(-1)` / `height(-1)` warnings.

Production readiness recommendation after fixes: ready for calculation review for the scoped PROJ-43 / PROJ-45 issues above, with selected-day detail intentionally treated as a slice of the yearly replay until an annual quarter-hour replay is added.
