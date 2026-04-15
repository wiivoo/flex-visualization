---
phase: 260415-cjb-add-auditable-excel-exports-with-formula
verified: 2026-04-15T00:00:00Z
status: human_needed
score: 6/7 must-haves verified
overrides_applied: 1
overrides:
  - must_have: "Each downloaded workbook contains raw SMARD QH prices, named parameters, formula-driven derived cells, a clean chart_data range, and an embedded Excel chart"
    reason: "exceljs v4 has no chart-generation API. All three builders replace the embedded Excel chart object with a 3-stop ColorScale conditional formatting rule on the chart_data range, which renders the same visual as the in-app card when the file is opened. Documented in code comments and README sheets."
    accepted_by: "plan-author"
    accepted_at: "2026-04-15T00:00:00Z"
human_verification:
  - test: "Open /v2/insights in the browser and click the Export button on the Price Patterns card"
    expected: "A .xlsx file named flexmon-price-patterns-YYYY-MM-DD.xlsx downloads and opens in Excel/Numbers without repair prompts; raw_prices, parameters, derived, chart_data, README sheets present; chart_data renders as a color-scaled heatmap"
    why_human: "Requires running the dev server and a spreadsheet app; file fidelity cannot be verified by static analysis"
  - test: "Click the Export button on the Sensitivity Curves card and open the resulting workbook"
    expected: "File flexmon-sensitivity-YYYY-MM-DD.xlsx downloads; derived_mileage / derived_plugInTime / derived_windowLength / derived_chargePower sheets each show per-day rows with SUMIFS + SUMPRODUCT(SMALL(IF(...))) formulas in the formula bar; chart_data lists all axes with yearly_saving pulled via cross-sheet references"
    why_human: "Needs manual inspection of formula bar in a real spreadsheet app to confirm formulas are present (not values)"
  - test: "In the sensitivity workbook, change plugInTime on the parameters sheet from its pinned value to a different hour and observe chart_data"
    expected: "yearly_saving values for the three non-swept axes (mileage, windowLength, chargePower) recompute automatically; the plugInTime axis rows remain fixed because x-values are literals"
    why_human: "Requires interactive recalculation in Excel/Numbers"
  - test: "Click the Export button on the Ideal Parameters heatmap card and open the workbook"
    expected: "File flexmon-ideal-parameters-YYYY-MM-DD.xlsx downloads; derived sheet has one block per (mileage, windowLength) combo; chart_data is a 2D matrix with ColorScale CF matching the in-app heatmap; editing plugInTime / chargePowerKw on parameters recomputes all cells"
    why_human: "Requires spreadsheet app to verify formula recalculation and visual heatmap rendering"
  - test: "Run `npm run build` and inspect `.next/static/chunks/` for an exceljs-specific async chunk that is NOT referenced by the initial /v2/insights bundle"
    expected: "exceljs appears only in a lazy chunk loaded on Export click, not in the page's initial JS"
    why_human: "Static grep confirms dynamic imports are used, but verifying actual webpack/Next chunk splitting requires running the build and inspecting chunk manifests"
---

# Quick Task: Auditable Excel Exports — Verification Report

**Task Goal:** Add per-graph "Download Excel" buttons on /v2/insights for PricePatternsHeatmap, SensitivityCurves, and IdealParametersHeatmap. Each export must produce a fully auditable .xlsx workbook from raw SMARD QH price data, with native Excel formulas computing chart values — not precomputed numbers.

**Verified:** 2026-04-15
**Status:** human_needed (automated checks pass; file-fidelity and chunk-split checks require running the app)

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | User clicks Export button on Price Patterns card and .xlsx downloads | VERIFIED | `PricePatternsHeatmap.tsx:51-63` handleExport calls `exportPricePatternsXlsx`, pipes result through `triggerDownload`; button rendered at `:95-103` |
| 2 | User clicks Export button on Sensitivity Curves card and .xlsx downloads | VERIFIED | `SensitivityCurves.tsx:237-243` handleExport dynamically imports sensitivity builder; button rendered at `:260-268` |
| 3 | User clicks Export button on Ideal Parameters card and .xlsx downloads | VERIFIED | `IdealParametersHeatmap.tsx:37-49` handleExport dynamically imports ideal-parameters builder; button at `:67-75` |
| 4 | Each workbook contains raw_prices, parameters, formula-driven derived cells, chart_data range, and chart visual | PASSED (override) | Override: Embedded Excel chart replaced with ColorScale conditional formatting on chart_data. All 3 builders emit raw_prices + parameters + derived(formulas) + chart_data + README; price-patterns + ideal-parameters apply ColorScale CF; sensitivity applies ColorScale CF on the chart_data summary column. Accepted: exceljs v4 has no chart API. |
| 5 | Sensitivity + ideal-parameters workbooks recompute savings via Excel formulas when a parameter cell is edited | VERIFIED | `sensitivity.ts:140-231` builds baseline via `SUMIFS(raw_prices!G:G, raw_prices!A:A, date, raw_prices!D:D, ">="&startQh, ...)` and optimized via `SUMPRODUCT(SMALL(IF(membership, raw_prices!G:G, ""), ROW(INDIRECT("1:"&slots))))`; references named parameters `plugInTime`, `windowLengthHours`, `chargePowerKw`, `plugInsPerWeek`, `kwhPer100km` from `parameters-sheet.ts:84` defined names. `ideal-parameters.ts:77-109` uses the same formula shape with mileage+windowLength as literals and plugInTime/chargePowerKw as named refs. No precomputed numbers written to derived cells. |
| 6 | exceljs loaded via dynamic import only (not in initial /v2/insights bundle) | VERIFIED | Grep shows only type-only imports (`import type { Workbook, Worksheet } from 'exceljs'` in raw-prices-sheet.ts:15 and parameters-sheet.ts:11) and runtime dynamic imports in the 3 builders (`price-patterns.ts:47`, `sensitivity.ts:244`, `ideal-parameters.ts:117`). The 3 UI components also dynamically import each builder (`await import('@/lib/excel-exports/<builder>')`) inside the click handler. Webpack/Next will split these automatically. Final chunk-manifest check routed to human verification. |
| 7 | npm run build passes | VERIFIED | Stated in task prompt as already verified. |

**Score:** 6/7 truths VERIFIED + 1 PASSED (override) = 7/7 effective

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/lib/excel-exports/types.ts` | Shared types: RawPriceRow, ScenarioParams, ExportResult | VERIFIED | All 3 types exported + `XLSX_MIME` constant |
| `src/lib/excel-exports/raw-prices-sheet.ts` | writeRawPricesSheet helper | VERIFIED | Named worksheet `raw_prices`, 7-column layout A-G matching formula references, skips projected rows, ct/kWh = EUR/MWh / 10 |
| `src/lib/excel-exports/parameters-sheet.ts` | writeParametersSheet with named cells | VERIFIED | Registers defined names via `workbook.definedNames.add('parameters!$B$<row>', name)` for all 8 params incl. derived `energyPerSessionKwh` and `slotsNeeded` formulas |
| `src/lib/excel-exports/price-patterns.ts` | exportPricePatternsXlsx | VERIFIED | Dynamic import, 12×96 AVERAGEIFS matrix on derived, chart_data references, 3-stop ColorScale CF |
| `src/lib/excel-exports/sensitivity.ts` | exportSensitivityXlsx | VERIFIED | 4 axis sheets with per-day SUMIFS baseline + SUMPRODUCT(SMALL(IF(...))) optimizer, yearly aggregation footer, chart_data summary |
| `src/lib/excel-exports/ideal-parameters.ts` | exportIdealParametersXlsx | VERIFIED | 2D mileage × windowLength sweep, same formula shape, 2D chart_data matrix with ColorScale CF |
| `src/lib/excel-exports/index.ts` | Barrel re-exports | VERIFIED | Re-exports all 3 functions + types |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|----|--------|---------|
| PricePatternsHeatmap.tsx | excel-exports/price-patterns | dynamic import in click handler | WIRED | Line 54: `await import('@/lib/excel-exports/price-patterns')` |
| SensitivityCurves.tsx | excel-exports/sensitivity | dynamic import in click handler | WIRED | Line 240: `await import('@/lib/excel-exports/sensitivity')` |
| IdealParametersHeatmap.tsx | excel-exports/ideal-parameters | dynamic import in click handler | WIRED | Line 40: `await import('@/lib/excel-exports/ideal-parameters')` |
| page.tsx | 3 insights components | pass hourlyQH and pinned | WIRED | Lines 225-243: `hourlyQH={prices.hourlyQH}` passed to all three; `pinned={deferredPinned}` passed to IdealParameters + Sensitivity |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| PricePatternsHeatmap | hourlyQH | `prices.hourlyQH` from `usePrices('DE')` hook in page.tsx | Yes — real SMARD QH prices | FLOWING |
| SensitivityCurves | hourlyQH, pinned | `prices.hourlyQH` + `deferredPinned` | Yes | FLOWING |
| IdealParametersHeatmap | hourlyQH, pinned, grid | `prices.hourlyQH` + `deferredPinned` + computed grid | Yes | FLOWING |
| Export builder output | workbook formulas | Raw hourlyQH written to raw_prices sheet; formulas reference raw_prices + named parameters | Yes — formulas resolve against real data on open | FLOWING |

### Anti-Patterns Found

None. Scanned all 7 new excel-exports files + 3 component files + page.tsx for:
- TODO/FIXME/PLACEHOLDER comments → none in new code
- Precomputed numbers in derived cells → none found; every derived/chart_data cell is either a formula or a literal label/axis value
- Hardcoded empty data in component props → none
- Empty handlers → none (all wired to builders)
- Static `import ... from 'exceljs'` (non-type) → none; only type-only imports in the 2 helper files + dynamic `await import('exceljs')` in the 3 builders

### Deviation Note (Accepted)

**exceljs chart API limitation:** exceljs v4.4.0 has no chart-generation API. The plan originally required an embedded Excel chart object; the executor replaced this with a 3-stop ColorScale conditional-formatting rule on the `chart_data` range in all three builders. This renders the same visual when the workbook is opened (heatmap / color-scaled bar), keeps all data formula-driven, and is documented in code comments (`price-patterns.ts:13-18`, `sensitivity.ts:39-41`, `ideal-parameters.ts:25-27`) and in the per-workbook README sheets. The formula auditability requirement — the primary goal — is fully satisfied. Accepted as an override.

### Human Verification Required

1. **Export button click-through (3 cards)** — run the dev server, click each Export button, confirm all three .xlsx files download and open without repair prompts in Excel/Numbers.

2. **Formula visibility in formula bar** — open each workbook, click cells in `derived` (price-patterns) and `derived_<axis>` (sensitivity) and `derived` (ideal-parameters) sheets; confirm the formula bar shows AVERAGEIFS / SUMIFS / SUMPRODUCT(SMALL(IF(...))) formulas, not raw numbers.

3. **Parameter edit propagation** — edit `plugInTime` on the parameters sheet of the sensitivity and ideal-parameters workbooks; confirm the three non-swept axes (sensitivity) and the full matrix (ideal-parameters) recompute. The price-patterns workbook has no scenario params so does not need this test.

4. **Chunk split verification** — run `npm run build`; inspect `.next/static/chunks/` and confirm exceljs lives in a lazy-loaded chunk, not in the initial /v2/insights route bundle.

### Gaps Summary

No blocking gaps. All automated checks (artifact existence, substantive implementation, wiring, data-flow, anti-pattern scan, formula auditability) pass. One intentional deviation (ColorScale CF in place of embedded Excel chart) is accepted via override and documented in-code. Remaining uncertainty is behavioural (does the workbook open cleanly? do formulas recompute on edit? does webpack actually split the chunk?) — routed to human verification.

---

_Verified: 2026-04-15_
_Verifier: Claude (gsd-verifier)_
