# PV + Battery Calculator Audit And Model Notes

Date: 2026-04-27
Route: `/battery/calculator`
Feature: `PROJ-43`

## Purpose

This note records the chart and model corrections applied after a logic audit of the PV + battery calculator. It is intended as a management-safe reference for how annual values and chart layers are now derived.

## Corrections Applied

### 1. Annual household economics now settle on the retail import tariff

The calculator already modeled a separate household import price via `householdImportPriceCtKwh`. The annual settlement layer previously reported baseline cost, import cost, stored grid-energy input cost, net cost, and savings on raw spot price instead of the tariff-adjusted household import price.

Correct behavior now:

- Baseline household cost uses `importPriceCtKwh`
- Residual household import cost uses `importPriceCtKwh`
- Grid-to-battery charging cost uses `importPriceCtKwh`
- Export revenue uses `exportPriceCtKwh`
- Net cost is `grid import cost - export revenue`
- Savings are `baseline cost - net cost`

This aligns the reported economics with the dispatch objective and with the UI wording.

### 2. Partial years are no longer presented as annual replay years

The calculator now only offers years with a complete non-projected replay window.

A year is considered selectable only when:

- all calendar days of that year are present
- `YYYY-01-01` is present
- `YYYY-12-31` is present
- the year is fully before the projected-data boundary

This prevents a year-to-date slice from being labeled and interpreted as a full-year result.

### 3. Delivered waterfall export adjustment now uses consistent units

The delivered waterfall has three modes:

- `Volume`
- `Cost`
- `Impact`

`Cost` and `Impact` are both plotted in `ct/kWh`. The export adjustment now also uses `ct/kWh` on those views, via the normalized export-credit equivalent, instead of subtracting `EUR/year` from a `ct/kWh` axis.

### 4. Delivered-load buckets are now shown separately in the waterfall

The waterfall no longer collapses solar delivery into one combined bar.

The chart now preserves the four management-relevant buckets:

- `Grid -> Load`
- `PV -> Load`
- `PV -> Battery -> Load`
- `Grid -> Battery -> Load`

This makes direct PV value and stored PV value independently visible.

### 5. Monthly bars now support negative months correctly

The monthly savings view now renders around a zero center line.

Correct behavior now:

- positive savings extend right of center
- negative savings extend left of center
- export value remains a separate positive overlay
- no minimum-width positive bar is forced for negative or zero values

### 6. Day-chart support labels now follow the selected price view

The day chart has a `Spot` / `End` price toggle.

Correct behavior now:

- the selected line changes
- the supporting charge/discharge price labels use the same selected reference
- the helper labels no longer stay on spot while the chart is switched to end-customer view

## Interpretation Rules

### Annual hero

- `Baseline annual import cost` means all household load bought at the active household import tariff
- `Residual grid import cost` means remaining direct import plus grid-charging energy bought at the same tariff basis
- `Spot-priced export revenue` is shown separately
- `Net annual energy cost` is import cost minus export revenue

### Delivered waterfall

- `Volume` explains how household demand was served
- `Cost` shows gross delivered household price before export credit, then the export-credit reduction
- `Impact` starts from the all-household baseline and shows how each delivery bucket changes the average household price
- export is intentionally kept separate from household delivery buckets

### Monthly chart

- green is signed monthly savings
- blue is export revenue inside that month
- a negative green bar means the modeled optimized case was worse than the baseline in that month

## Remaining Modeling Assumptions

The fixes above correct accounting and chart consistency. They do not change the current product assumptions below:

- PV-delivered household buckets still use a `0.00 ct/kWh` marginal view in the allocation summary
- export valuation still follows the active export-price rule
- the calculator remains Germany-only in this route state
- the dispatch objective remains minimum modeled net household energy cost, not self-sufficiency

## Regression Coverage Added

Regression tests now cover:

- tariff-based baseline and import settlement
- tariff-based grid-to-battery input cost attribution
- full-year replay-year selection

