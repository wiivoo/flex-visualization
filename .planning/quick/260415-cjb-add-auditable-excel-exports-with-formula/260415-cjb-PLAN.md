---
phase: 260415-cjb
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/lib/excel-exports/index.ts
  - src/lib/excel-exports/types.ts
  - src/lib/excel-exports/raw-prices-sheet.ts
  - src/lib/excel-exports/parameters-sheet.ts
  - src/lib/excel-exports/price-patterns.ts
  - src/lib/excel-exports/sensitivity.ts
  - src/lib/excel-exports/ideal-parameters.ts
  - src/components/v2/insights/PricePatternsHeatmap.tsx
  - src/components/v2/insights/SensitivityCurves.tsx
  - src/components/v2/insights/IdealParametersHeatmap.tsx
  - src/app/v2/insights/page.tsx
autonomous: true
requirements:
  - QUICK-260415-cjb
user_setup: []

must_haves:
  truths:
    - "User clicks an Export button on the Price Patterns card and a .xlsx file downloads"
    - "User clicks an Export button on the Sensitivity Curves card and a .xlsx file downloads"
    - "User clicks an Export button on the Ideal Parameters heatmap card and a .xlsx file downloads"
    - "Each downloaded workbook contains raw SMARD QH prices, named parameters, formula-driven derived cells, a clean chart_data range, and an embedded Excel chart"
    - "Opening the sensitivity and ideal-parameters workbooks and editing a parameter cell recomputes savings via Excel formulas (no precomputed values in derived/chart_data)"
    - "exceljs is loaded via dynamic import so it does not appear in the initial /v2/insights JS bundle"
    - "npm run build passes"
  artifacts:
    - path: "src/lib/excel-exports/types.ts"
      provides: "Shared types: RawPriceRow, ScenarioParams, ExportResult"
    - path: "src/lib/excel-exports/raw-prices-sheet.ts"
      provides: "writeRawPricesSheet(workbook, hourlyQH) helper"
    - path: "src/lib/excel-exports/parameters-sheet.ts"
      provides: "writeParametersSheet(workbook, params) helper with named cells"
    - path: "src/lib/excel-exports/price-patterns.ts"
      provides: "exportPricePatternsXlsx(hourlyQH): Promise<Blob>"
    - path: "src/lib/excel-exports/sensitivity.ts"
      provides: "exportSensitivityXlsx(hourlyQH, pinned): Promise<Blob>"
    - path: "src/lib/excel-exports/ideal-parameters.ts"
      provides: "exportIdealParametersXlsx(hourlyQH, pinned): Promise<Blob>"
    - path: "src/lib/excel-exports/index.ts"
      provides: "Barrel re-exports of the three export functions"
  key_links:
    - from: "src/components/v2/insights/PricePatternsHeatmap.tsx"
      to: "src/lib/excel-exports/price-patterns.ts"
      via: "dynamic import in click handler"
      pattern: "import\\('@/lib/excel-exports/price-patterns'\\)"
    - from: "src/components/v2/insights/SensitivityCurves.tsx"
      to: "src/lib/excel-exports/sensitivity.ts"
      via: "dynamic import in click handler"
      pattern: "import\\('@/lib/excel-exports/sensitivity'\\)"
    - from: "src/components/v2/insights/IdealParametersHeatmap.tsx"
      to: "src/lib/excel-exports/ideal-parameters.ts"
      via: "dynamic import in click handler"
      pattern: "import\\('@/lib/excel-exports/ideal-parameters'\\)"
    - from: "src/app/v2/insights/page.tsx"
      to: "PricePatternsHeatmap / SensitivityCurves / IdealParametersHeatmap"
      via: "pass hourlyQH and pinned scenario props so components can build exports"
      pattern: "hourlyQH=\\{prices.hourlyQH\\}"
---

<objective>
Add per-graph "Download Excel" buttons to each of the three cards on /v2/insights (PricePatternsHeatmap, SensitivityCurves, IdealParametersHeatmap). Each download produces a fully auditable .xlsx workbook that starts from raw SMARD QH prices, uses named parameters, and computes the chart values with native Excel formulas. Every workbook embeds an Excel chart that references the formula range.

Purpose: Let the user hand an analyst a single .xlsx and have them verify savings end-to-end without touching the dashboard code.

Output:
- New `src/lib/excel-exports/` module with shared helpers + three builder files
- Dynamic-import-only usage of `exceljs` so the main bundle stays slim
- Export button in each of the three insights card headers
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@CLAUDE.md
@.planning/STATE.md

@src/app/v2/insights/page.tsx
@src/components/v2/insights/PricePatternsHeatmap.tsx
@src/components/v2/insights/SensitivityCurves.tsx
@src/components/v2/insights/IdealParametersHeatmap.tsx
@src/lib/insights-sweep.ts
@src/lib/price-patterns.ts
@src/lib/v2-config.ts

<interfaces>
<!-- Key contracts the executor needs. Extracted from codebase. -->

From src/lib/v2-config.ts:
```typescript
export interface HourlyPrice {
  timestamp: number
  priceEurMwh: number
  priceCtKwh: number
  hour: number       // 0-23
  minute: number     // 0, 15, 30, 45 for QH
  date: string       // YYYY-MM-DD
  isProjected?: boolean
}

export const AVG_CONSUMPTION_KWH_PER_100KM = 19
export function deriveEnergyPerSession(
  yearlyMileageKm: number,
  weekdayPlugIns: number,
  weekendPlugIns?: number,
): number
```

From src/lib/insights-sweep.ts:
```typescript
export interface PinnedDefaults {
  yearlyMileageKm: number
  plugInTime: number      // hour 14-22
  windowLengthHours: number
  chargePowerKw: number
  plugInsPerWeek: number
}

export interface SweepPoint {
  x: number
  yearlySavingsEur: number
  energyPerSessionKwh: number
}

export interface SensitivitySeries {
  mileage: SweepPoint[]
  plugInTime: SweepPoint[]
  windowLength: SweepPoint[]
  chargePower: SweepPoint[]
  pinned: PinnedDefaults
  rangeLabel: string
}

export interface MileageWindowGrid {
  mileages: number[]
  windowLengths: number[]
  cells: SweepCell[][]
  pinnedPlugInTime: number
  pinnedPlugInsPerWeek: number
  pinnedChargePowerKw: number
  rangeLabel: string
}
```

Relevant dependency (already installed):
- `exceljs: ^4.4.0` — pure JS workbook builder with formula + embedded chart support
- `sonner: ^2.0.7` — toast notifications
- UI button: `@/components/ui/button` (shadcn)
- Icon: `lucide-react` → `Download` icon
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Scaffold excel-exports module (types, raw_prices + parameters helpers, price-patterns builder)</name>
  <files>
    src/lib/excel-exports/types.ts,
    src/lib/excel-exports/raw-prices-sheet.ts,
    src/lib/excel-exports/parameters-sheet.ts,
    src/lib/excel-exports/price-patterns.ts,
    src/lib/excel-exports/index.ts
  </files>
  <action>
Create the `src/lib/excel-exports/` directory. Do NOT add a static `import ExcelJS from 'exceljs'` in any file under `src/lib/excel-exports/` — builder files must dynamically import exceljs inside their exported function:
```ts
const ExcelJS = (await import('exceljs')).default
```
This keeps exceljs out of the main /v2/insights route bundle.

1. `src/lib/excel-exports/types.ts` — export pure type-only declarations (no runtime):
   - `RawPriceRow { date: string; month: number; day: number; qh: number; hour: number; minute: number; ctKwh: number }`
   - `ScenarioParams { yearlyMileageKm: number; plugInTime: number; windowLengthHours: number; chargePowerKw: number; plugInsPerWeek: number }` (plus derived `energyPerSessionKwh`, `slotsNeeded`)
   - `ExportResult = { blob: Blob; filename: string }`

2. `src/lib/excel-exports/raw-prices-sheet.ts` — export `writeRawPricesSheet(workbook, hourlyQH)`:
   - Param type: `(workbook: import('exceljs').Workbook, hourlyQH: HourlyPrice[]) => import('exceljs').Worksheet`
   - Add sheet named `raw_prices` with columns: `date`, `month`, `day`, `qh` (0-95), `hour`, `minute`, `ct_kWh`
   - Iterate `hourlyQH`, SKIP rows where `isProjected === true`, compute `qh = hour * 4 + Math.floor(minute / 15)`, `ctKwh = priceEurMwh / 10`
   - Set column widths, freeze header row, make header bold
   - Return the worksheet so callers can reference its range

3. `src/lib/excel-exports/parameters-sheet.ts` — export `writeParametersSheet(workbook, params)`:
   - Creates a `parameters` sheet with two columns (`name`, `value`) and rows for each scenario param
   - For each row, set a **defined name** using `workbook.definedNames.add("parameters!$B$<row>", "<paramName>")` so formulas on other sheets can reference `yearlyMileageKm`, `plugInTime`, `windowLengthHours`, `chargePowerKw`, `plugInsPerWeek`, `energyPerSessionKwh`, `slotsNeeded` by name
   - Also add a constant row for `AVG_CONSUMPTION_KWH_PER_100KM = 19` (defined name `kwhPer100km`)
   - Energy per session formula cell: `=yearlyMileageKm/(plugInsPerWeek*52)/100*kwhPer100km` so editing mileage propagates
   - Slots-needed formula cell: `=CEILING(energyPerSessionKwh/chargePowerKw/0.25, 1)`

4. `src/lib/excel-exports/price-patterns.ts` — export `async function exportPricePatternsXlsx(hourlyQH: HourlyPrice[]): Promise<ExportResult>`:
   - Dynamic `import('exceljs')`
   - Create workbook, call `writeRawPricesSheet`
   - Add a `parameters` sheet with just one labelled constant row (no scenario params for this workbook) — still use a single helper call with an empty scenario is fine; simpler: inline a 2-row parameters sheet here
   - Add a `derived` sheet: 12 rows × 96 cols matrix of `AVERAGEIFS` formulas:
     - Row label = month number (1..12), column headers = qh index 0..95
     - Cell formula: `=IFERROR(AVERAGEIFS(raw_prices!G:G, raw_prices!B:B, <month>, raw_prices!D:D, <qh>), NA())`
     - (Column G = ct_kWh, B = month, D = qh — confirm during implementation and adjust letters)
   - Add `chart_data` sheet that references the derived matrix directly (`=derived!B2` etc.) with clean month labels in column A and qh/hour labels in row 1 — this is the chart's data source
   - Apply ColorScale conditional formatting (green→amber→red) across the `chart_data` cell matrix so the file itself renders as a heatmap when opened
   - Add a `chart` sheet and embed a line chart: 12 series (one per month), x-axis = qh-of-day → use exceljs `worksheet.addImage` / chart API (exceljs chart support is limited — see note below)
   - **exceljs chart fallback:** if exceljs's chart API for line charts proves too limited for 12 series, instead (a) rely on the ColorScale CF heatmap on `chart_data` as the visual, AND (b) add a simple column chart of the "average daily shape" (row = average across months, 96 columns) which exceljs handles well. Document the chosen approach in a comment at the top of the file.
   - Return `{ blob, filename: \`flexmon-price-patterns-\${todayISO}.xlsx\` }` where blob is built from `workbook.xlsx.writeBuffer()` wrapped in `new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })`

5. `src/lib/excel-exports/index.ts` — barrel, re-export the three `exportXxxXlsx` functions and types from `types.ts`. Leave placeholders for sensitivity and ideal-parameters (comment: "added in task 2/3"). Actually, since index.ts is a barrel, add the re-exports for sensitivity and ideal-parameters now as `// eslint-disable-next-line` TODO lines — cleanest: write the barrel to only re-export price-patterns for now and extend in tasks 2/3. Use the latter.
  </action>
  <verify>
    <automated>npx tsc --noEmit -p tsconfig.json 2>&amp;1 | grep -E "excel-exports|error" | head -30 || true; npm run build 2>&amp;1 | tail -40</automated>
  </verify>
  <done>
    - `src/lib/excel-exports/` exists with 5 files listed above
    - `import('exceljs')` appears ONLY inside async function bodies, never at top level
    - `npm run build` succeeds
    - Manually triggering `exportPricePatternsXlsx(pricesArray)` in browser console produces a .xlsx file that opens in Excel/Numbers with raw_prices populated, derived formulas visible, and a chart_data sheet with conditional formatting
  </done>
</task>

<task type="auto">
  <name>Task 2: Sensitivity export builder (pure-formula optimizer for 4 sub-charts)</name>
  <files>
    src/lib/excel-exports/sensitivity.ts,
    src/lib/excel-exports/index.ts
  </files>
  <action>
Create `src/lib/excel-exports/sensitivity.ts` exporting:
```ts
export async function exportSensitivityXlsx(
  hourlyQH: HourlyPrice[],
  pinned: PinnedDefaults,
): Promise<ExportResult>
```

Implementation:
1. Dynamic `import('exceljs')`, create workbook.
2. Call `writeRawPricesSheet(workbook, hourlyQH)` → reference it as `raw_prices`.
3. Call `writeParametersSheet(workbook, pinned)` with all 5 pinned values. Include derived formula cells for `energyPerSessionKwh` and `slotsNeeded` as specified in task 1.
4. Build **one `derived_<axis>` sheet per sweep axis** (4 sheets total: `derived_mileage`, `derived_plugInTime`, `derived_windowLength`, `derived_chargePower`). Each sheet has:
   - Row 1 header: `date | window_start_qh | window_end_qh | slots_needed | baseline_cost_eur | optimized_cost_eur | daily_saving_eur`
   - One row per unique date in raw_prices (compute the list once in JS, write dates as constants — this is the one concession to precompute; price values remain formulas)
   - Formulas (illustrative — validate column letters during implementation):
     - `window_start_qh = plugInTime * 4` (reference the axis-specific parameter for that x-value; for the swept axis use a constant per sheet-section, for pinned axes use the named parameter)
     - `window_end_qh = MOD(window_start_qh + windowLengthHours * 4, 96)` — use `IF(..., ..., ...)` to handle overnight wrap when computing the average range
     - `baseline_cost_eur`: SUMPRODUCT of the first `slots_needed` prices in the window (baseline = charge ASAP = first slots of the window chronologically) × 0.25 × chargePowerKw / 100
     - `optimized_cost_eur`: `{=SUM(SMALL( IF( (raw_prices!A:A=<date>) * (raw_prices!D:D>=window_start_qh) * (raw_prices!D:D<window_end_qh), raw_prices!G:G ), ROW(INDIRECT("1:"&slots_needed)) )) * 0.25 * chargePowerKw / 100}` — array formula (set `formulaType: 'array'` or use `{ formula: ..., sharedFormula: false }` depending on exceljs API). Must handle overnight wrap by ORing two range predicates.
     - `daily_saving_eur = baseline_cost_eur - optimized_cost_eur`
   - Below the per-day rows, a `yearly_saving` summary row: `=SUM(daily_saving_eur range)/COUNT(daily_saving_eur range) * plugInsPerWeek * 52` (ensures yearly scales to 52 weeks)

5. **Per-axis sweep**: for each of the 4 axes (mileage, plugInTime, windowLength, chargePower):
   - Create multiple sub-blocks within the sheet (one column block per x-value) OR stack them vertically — recommend **one sheet per axis, with one column-group per x-value** side by side. Each column group = 3 columns: `baseline, optimized, daily_saving` and at the bottom a single `yearly_saving` cell.
   - The swept parameter is a literal per column group; all others reference named cells on `parameters` sheet.
   - x-value ranges must match `insights-sweep.ts`:
     - mileage: `[5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]`
     - plugInTime: `[14..22]`
     - windowLength: `[4..14]`
     - chargePower: `[3.7, 7, 11, 22]`

6. `chart_data` sheet: single table with columns `axis | x | yearly_saving_eur`, 4 axes stacked. Each yearly_saving cell is a reference to the corresponding per-axis sheet's yearly_saving cell — so the chart pulls from formulas.

7. Add one `chart_<axis>` sheet per axis (or put 4 charts on one `charts` sheet): embed line charts with x = parameter value, y = yearly savings. Use exceljs chart API. If exceljs can only embed one chart per sheet, use 4 sheets named `chart_mileage`, `chart_plugInTime`, `chart_windowLength`, `chart_chargePower`.

8. Filename: `flexmon-sensitivity-<YYYY-MM-DD>.xlsx`. Return `{ blob, filename }`.

9. Update `src/lib/excel-exports/index.ts` barrel to re-export `exportSensitivityXlsx`.

Notes:
- The per-day date list is the only non-formula data injected. All cost/saving math is pure Excel.
- Do NOT call any helper from `insights-sweep.ts` or `charging-helpers.ts` to compute expected values — the goal is that Excel itself is the single source of truth for the output.
- Keep the workbook size reasonable: a year of daily rows × 4 axes × ~10 x-values ≈ 14,600 formula rows. That's fine for exceljs but may be slow to write; acceptable for a one-shot download.
- Add a code comment documenting the formula shape so future maintainers can follow the math.
  </action>
  <verify>
    <automated>npm run build 2>&amp;1 | tail -40</automated>
  </verify>
  <done>
    - `exportSensitivityXlsx` function exported
    - Barrel re-exports it
    - Downloaded workbook opens in Excel and recomputes without errors
    - Changing `plugInTime` in the parameters sheet causes `chart_data` yearly_saving values on the 3 non-swept axes to update (the swept axis uses literal x-values)
    - `npm run build` passes
  </done>
</task>

<task type="auto">
  <name>Task 3: Ideal-parameters export builder + UI buttons on all three insights cards</name>
  <files>
    src/lib/excel-exports/ideal-parameters.ts,
    src/lib/excel-exports/index.ts,
    src/components/v2/insights/PricePatternsHeatmap.tsx,
    src/components/v2/insights/SensitivityCurves.tsx,
    src/components/v2/insights/IdealParametersHeatmap.tsx,
    src/app/v2/insights/page.tsx
  </files>
  <action>
Part A — `src/lib/excel-exports/ideal-parameters.ts`:

Export:
```ts
export async function exportIdealParametersXlsx(
  hourlyQH: HourlyPrice[],
  pinned: PinnedDefaults,
  mileages?: number[],            // default [5000,10000,15000,20000,25000,30000,35000,40000]
  windowLengths?: number[],       // default [4,6,8,10,12,14]
): Promise<ExportResult>
```

Implementation:
1. Dynamic import exceljs, write raw_prices + parameters sheets (reuse helpers).
2. Add a `derived` sheet: for each (mileage, windowLength) combination, emit a small formula block computing daily savings per day over the pinned time range, then a single aggregate cell for `yearly_saving_eur` using the same array-formula approach as Task 2. This is a 2D sweep so the total row count is mileages.length × windowLengths.length × days-per-period. Keep days-per-period = last 365 rows of raw_prices (use JS to determine the cutoff date and inject as a literal in formulas).
3. Add a `chart_data` sheet: a 2D matrix mileages (rows) × windowLengths (columns), each cell = reference to the corresponding yearly_saving cell in `derived`.
4. Apply 3-color ColorScale conditional formatting to the chart_data matrix (green→amber→red by value) so the file itself renders as a heatmap.
5. Embed a column chart on a `chart` sheet: x = windowLength, series = one per mileage, y = yearly_saving_eur (acceptable approximation of a 2D heatmap in Excel chart form). Alternative: a scatter plot. Use whichever exceljs supports reliably.
6. Filename: `flexmon-ideal-parameters-<YYYY-MM-DD>.xlsx`. Return blob + filename.
7. Update `src/lib/excel-exports/index.ts` to re-export `exportIdealParametersXlsx`.

Part B — UI buttons in the 3 insights card headers:

Shared download helper — inline in each component (tiny, no new file):
```tsx
async function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}
```

In each component:

1. **`PricePatternsHeatmap.tsx`** — already receives `hourlyQH`. Add state `const [busy, setBusy] = useState(false)` and an `onClick` that:
   ```tsx
   setBusy(true)
   try {
     const { exportPricePatternsXlsx } = await import('@/lib/excel-exports/price-patterns')
     const { blob, filename } = await exportPricePatternsXlsx(hourlyQH)
     await triggerDownload(blob, filename)
     toast.success('Excel exported')
   } catch (e) {
     toast.error('Export failed: ' + (e as Error).message)
   } finally {
     setBusy(false)
   }
   ```
   Button JSX in the CardHeader right-side slot (next to the existing title row or overline):
   ```tsx
   <Button variant="ghost" size="sm" disabled={busy} onClick={handleExport} className="h-7 px-2 text-[11px] text-gray-500 hover:text-[#313131]">
     <Download className="w-3.5 h-3.5 mr-1" />
     {busy ? 'Exporting…' : 'Export'}
   </Button>
   ```
   Import `Download` from `lucide-react`, `Button` from `@/components/ui/button`, `toast` from `sonner`.

2. **`SensitivityCurves.tsx`** — currently receives `{ series, mode, fleetSize }` only. Add a new prop `hourlyQH: HourlyPrice[]` and `pinned: PinnedDefaults` passed from `page.tsx`. Add ONE top-level Export button in the outer card header (not per sub-chart), since all 4 sub-charts live in one workbook. Same onClick pattern calling `exportSensitivityXlsx(hourlyQH, pinned)`.

3. **`IdealParametersHeatmap.tsx`** — currently receives `{ grid, mode, fleetSize }`. Add props `hourlyQH: HourlyPrice[]` and `pinned: PinnedDefaults`. Add Export button in CardHeader right slot, onClick calls `exportIdealParametersXlsx(hourlyQH, pinned, grid.mileages, grid.windowLengths)`.

4. **`src/app/v2/insights/page.tsx`** — update the three component usages:
   ```tsx
   <IdealParametersHeatmap grid={grid} mode={mode} fleetSize={fleet.fleetSize} hourlyQH={prices.hourlyQH} pinned={deferredPinned} />
   <SensitivityCurves series={series} mode={mode} fleetSize={fleet.fleetSize} hourlyQH={prices.hourlyQH} pinned={deferredPinned} />
   <PricePatternsHeatmap hourlyQH={prices.hourlyQH} />
   ```
   Only `single` mode passes a meaningful `pinned`; in `fleet` mode pass `deferredPinned` constructed from the fleet defaults (use the existing `defaultPinned()` logic's shape) — for v1 of the export, fleet mode can disable the button or export single-vehicle math with a note in the parameters sheet. Simplest: always export single-vehicle math and add a `mode_note` row in parameters. Document this choice in a comment in `page.tsx`.

5. Verify exceljs stays out of the main bundle: run `npm run build` and inspect the route bundle size for `/v2/insights`. The exceljs chunk should appear as a separate async chunk (webpack/next will split on dynamic imports automatically).
  </action>
  <verify>
    <automated>npm run build 2>&amp;1 | tail -60 &amp;&amp; npm run lint 2>&amp;1 | tail -30</automated>
  </verify>
  <done>
    - `exportIdealParametersXlsx` exists and is re-exported from the barrel
    - All three insights cards have an "Export" button in the header
    - Clicking each button downloads the correct .xlsx
    - Each workbook opens in Excel without repair prompts and contains raw_prices, parameters, derived, chart_data, and chart sheets
    - Main route bundle does NOT include exceljs (dynamic chunk only loads on click)
    - `npm run build` and `npm run lint` pass
  </done>
</task>

</tasks>

<verification>
- `npm run build` passes with no errors
- `npm run lint` passes
- Manual: open /v2/insights in the browser, click each of the 3 Export buttons, verify 3 .xlsx files download
- Manual: open each .xlsx in Excel or Numbers:
  - All sheets render without errors
  - `raw_prices` has thousands of rows and correct ct/kWh values
  - `parameters` has named cells and editable values
  - `derived` formulas visible in formula bar (not hardcoded numbers)
  - `chart_data` cells reference `derived` cells
  - Embedded chart renders and pulls from `chart_data`
  - Editing `plugInTime` in the parameters sheet of the sensitivity / ideal-params workbooks updates the chart
- Bundle check: `.next/static/chunks/` shows a separate exceljs chunk that is NOT loaded on initial page render
</verification>

<success_criteria>
- All three cards on /v2/insights show an Export button
- Each button downloads a fully auditable .xlsx with raw_prices → parameters → derived (formulas) → chart_data → embedded chart
- Sensitivity and ideal-parameters workbooks express the cheapest-N-slots optimizer as pure Excel formulas (SMALL + SUMPRODUCT array formulas)
- exceljs loaded only via dynamic import
- `npm run build` and `npm run lint` pass
</success_criteria>

<output>
After completion, create `.planning/quick/260415-cjb-add-auditable-excel-exports-with-formula/260415-cjb-01-SUMMARY.md`
</output>
