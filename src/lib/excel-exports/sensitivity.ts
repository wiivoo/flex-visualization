/**
 * Sensitivity export builder.
 *
 * Produces a workbook where each of the four insights levers (mileage,
 * plug-in time, window length, charge power) gets its own sheet. On each
 * axis sheet we write one row per calendar day and one column group per
 * x-value (literal). All cost math is expressed as Excel formulas that
 * reference `raw_prices` and the named parameters, so editing a pinned
 * parameter on the `parameters` sheet recomputes savings for the three
 * non-swept axes automatically.
 *
 * Formula layout (per day × x-value):
 *   start_qh   = <literal or named plugInTime> * 4
 *   end_qh     = start_qh + <literal or named windowLengthHours> * 4
 *   slots      = CEILING(<literal or named energyPerSessionKwh> / <literal or named chargePowerKw> / 0.25, 1)
 *   baseline   = AVERAGEIFS over the first `slots` qh of the window, then
 *                × slots × 0.25 × chargePowerKw converted to EUR/100.
 *                Implementation: use a SUMIFS over the first-N qh of the
 *                window (start_qh..start_qh+slots-1) divided by N.
 *   optimized  = Approximation: the average of the `slots` cheapest prices
 *                inside the window computed via
 *                SUMPRODUCT(SMALL(IF(date&qh-in-window, price), ROW(INDIRECT("1:"&slots)))).
 *                This SUMPRODUCT wraps the SMALL and a ROW array constant,
 *                so modern Excel / Numbers / LibreOffice evaluate it
 *                without requiring CSE array entry.
 *   daily_saving = baseline - optimized
 *
 * Overnight wrap: when start_qh + windowLengthHours*4 > 96 the window
 * straddles midnight. We handle this by writing two AVERAGEIFS / SUMIFS
 * segments stitched together with `+` (one for the tail of day D, one for
 * the head of day D+1). The extra complexity is kept JS-side so the cell
 * formulas remain compact.
 *
 * Yearly aggregation:
 *   yearly_saving = AVERAGE(daily_saving column) * plugInsPerWeek * 52
 *
 * Chart strategy: same as price-patterns — exceljs has no chart API, so we
 * produce a `chart_data` summary sheet (axis | x | yearly_saving_eur) that
 * references each axis's summary row, and apply a ColorScale CF to the
 * yearly_saving column so the file self-renders as a bar-ish visual.
 */
import type { HourlyPrice } from '@/lib/v2-config'
import type { ExportResult } from './types'
import { XLSX_MIME } from './types'
import type { PinnedDefaults } from '@/lib/insights-sweep'
import { writeRawPricesSheet } from './raw-prices-sheet'
import { writeParametersSheet, PARAM_NAMES } from './parameters-sheet'

const MILEAGE_XS = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
const PLUGIN_TIME_XS = [14, 15, 16, 17, 18, 19, 20, 21, 22]
const WINDOW_LENGTH_XS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
const CHARGE_POWER_XS = [3.7, 7, 11, 22]

type AxisKey = 'mileage' | 'plugInTime' | 'windowLength' | 'chargePower'

interface AxisDef {
  key: AxisKey
  label: string
  xs: number[]
  /** Resolve the literal OR the named reference for each param given the swept x. */
  param: (x: number) => {
    yearlyMileageKm: string
    plugInTime: string
    windowLengthHours: string
    chargePowerKw: string
  }
}

const AXES: AxisDef[] = [
  {
    key: 'mileage',
    label: 'Mileage',
    xs: MILEAGE_XS,
    param: (x) => ({
      yearlyMileageKm: String(x),
      plugInTime: PARAM_NAMES.plugInTime,
      windowLengthHours: PARAM_NAMES.windowLengthHours,
      chargePowerKw: PARAM_NAMES.chargePowerKw,
    }),
  },
  {
    key: 'plugInTime',
    label: 'Plug-in time',
    xs: PLUGIN_TIME_XS,
    param: (x) => ({
      yearlyMileageKm: PARAM_NAMES.yearlyMileageKm,
      plugInTime: String(x),
      windowLengthHours: PARAM_NAMES.windowLengthHours,
      chargePowerKw: PARAM_NAMES.chargePowerKw,
    }),
  },
  {
    key: 'windowLength',
    label: 'Window length',
    xs: WINDOW_LENGTH_XS,
    param: (x) => ({
      yearlyMileageKm: PARAM_NAMES.yearlyMileageKm,
      plugInTime: PARAM_NAMES.plugInTime,
      windowLengthHours: String(x),
      chargePowerKw: PARAM_NAMES.chargePowerKw,
    }),
  },
  {
    key: 'chargePower',
    label: 'Charge power',
    xs: CHARGE_POWER_XS,
    param: (x) => ({
      yearlyMileageKm: PARAM_NAMES.yearlyMileageKm,
      plugInTime: PARAM_NAMES.plugInTime,
      windowLengthHours: PARAM_NAMES.windowLengthHours,
      chargePowerKw: String(x),
    }),
  },
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** List of unique non-projected dates in chronological order. */
function uniqueDates(hourlyQH: HourlyPrice[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const p of hourlyQH) {
    if (p.isProjected) continue
    if (!seen.has(p.date)) {
      seen.add(p.date)
      out.push(p.date)
    }
  }
  return out
}

/**
 * Build the per-day formulas for one (axis, x) column group.
 *
 * Returns formula strings for baseline, optimized, and daily_saving.
 * `par` holds the resolved literal-or-named strings for every parameter.
 */
function buildDayFormulas(
  date: string,
  par: {
    yearlyMileageKm: string
    plugInTime: string
    windowLengthHours: string
    chargePowerKw: string
  },
): { baseline: string; optimized: string } {
  // Derived: energy per session (kWh), slots needed (0.25h slots).
  // These reference the pinned parameters where available OR use the literal.
  // For simplicity we recompute them inline per column group so the swept
  // axis's literal flows through.
  const energyPerSession = `(${par.yearlyMileageKm}/(${PARAM_NAMES.plugInsPerWeek}*52)/100*${PARAM_NAMES.kwhPer100km})`
  const slots = `CEILING(${energyPerSession}/${par.chargePowerKw}/0.25,1)`
  const startQh = `(${par.plugInTime}*4)`
  const endQhRaw = `(${startQh}+${par.windowLengthHours}*4)`

  // Energy per slot (kWh) = chargePower * 0.25.
  // Cost conversion: ct → EUR via /100.
  const perSlotKwh = `(${par.chargePowerKw}*0.25)`
  const energyCostFactor = `(${perSlotKwh}/100)` // multiply ct/kWh by this to get EUR per slot

  // Baseline (charge ASAP at start of window) — SUMIFS over the first `slots`
  // qh positions starting at startQh. When the window wraps midnight we split.
  //
  // Single-day case: baseline_avg_ct =
  //   SUMIFS(G:G, A:A, <date>, D:D, ">="&startQh, D:D, "<"&MIN(endQh, startQh+slots*1))
  //   / slots
  // and multiply by slots * energyCostFactor to get EUR.
  //
  // (slots * avg * energyCostFactor) reduces to SUM * energyCostFactor when
  // all N slots are filled. We use SUMIFS directly so the division cancels.
  //
  // Wrap-aware form: if endQhRaw > 96, add a SUMIFS over next-day qh 0..(endQhRaw-96).

  const dateStr = `"${date}"`
  // We express "first `slots` qh of the window, with wrap" as:
  //   baseline_sum = SUMIFS(G:G, A:A, date, D:D, ">="&startQh, D:D, "<"&(startQh+slots))
  //     (clipped by JS to never exceed 96 — but we keep the formula general
  //     and rely on SUMIFS returning 0 for out-of-range qh; a trailing term
  //     handles wrap.)
  const baselineSameDay =
    `SUMIFS(raw_prices!G:G,raw_prices!A:A,${dateStr},raw_prices!D:D,">="&${startQh},raw_prices!D:D,"<"&MIN(96,${startQh}+${slots}))`
  const baselineOverflow =
    `IF(${startQh}+${slots}>96,SUMIFS(raw_prices!G:G,raw_prices!A:A,${dateStr},raw_prices!D:D,">="&0,raw_prices!D:D,"<"&(${startQh}+${slots}-96)),0)`
  const baselineSumCt = `(${baselineSameDay}+${baselineOverflow})`
  const baseline = `${baselineSumCt}*${energyCostFactor}`

  // Optimized (cheapest `slots` qh inside the window) — SUMPRODUCT-of-SMALL
  // over a conditional array. Window membership condition:
  //   (date matches) * ((qh >= startQh AND qh < endQh) OR wrap segment)
  //
  // For exceljs/Excel we express the condition with nested IF inside SMALL.
  // ROW(INDIRECT("1:"&slots)) produces the 1..slots index array.
  //
  // Non-wrap case (endQhRaw <= 96):
  //   SUM_OPT = SUMPRODUCT(SMALL(IF(
  //     (raw_prices!A:A=date)*(raw_prices!D:D>=startQh)*(raw_prices!D:D<endQh),
  //     raw_prices!G:G), ROW(INDIRECT("1:"&slots))))
  //
  // Wrap case (endQhRaw > 96): the condition becomes
  //   (A=date AND D>=startQh) OR (A=nextDate AND D<endQh-96)
  // We keep both segments OR'd inside the same IF via `+` and max-clamp to 1.
  //
  // Because we don't know at build-time whether endQhRaw exceeds 96, we use
  // a formula-level IF on endQhRaw and emit both branches. To keep cell
  // formula length manageable we pick the branch JS-side: if the pinned-
  // at-build-time values would ALWAYS keep the window on one day we emit
  // the simple form. Otherwise we emit the wrap form. This is a safe
  // simplification because overnight wrap depends only on plugInTime and
  // windowLengthHours which are either literal or fixed named refs.
  //
  // Simpler: always emit the wrap-safe form unconditionally. The extra OR
  // condition returns 0 when there's no wrap.
  const nextDate = nextDateString(date)
  const nextDateStr = `"${nextDate}"`
  const inWindowSameDay =
    `((raw_prices!A:A=${dateStr})*(raw_prices!D:D>=${startQh})*(raw_prices!D:D<MIN(96,${endQhRaw})))`
  const inWindowNextDay =
    `((raw_prices!A:A=${nextDateStr})*(raw_prices!D:D<MAX(0,${endQhRaw}-96)))`
  const membership = `(${inWindowSameDay}+${inWindowNextDay})`
  // SUMPRODUCT(SMALL(IF(membership, price, ""), ROW(INDIRECT("1:"&slots))))
  // Because SMALL needs a numeric array and IF inside SMALL inside SUMPRODUCT
  // is a well-known pattern supported by Excel 2021/365, Numbers and
  // LibreOffice. Note that ROW(INDIRECT("1:"&N)) is the idiomatic 1..N array.
  const optimizedSumCt =
    `SUMPRODUCT(SMALL(IF(${membership},raw_prices!G:G,""),ROW(INDIRECT("1:"&${slots}))))`
  const optimized = `IFERROR(${optimizedSumCt}*${energyCostFactor},NA())`

  return { baseline, optimized }
}

/** Compute YYYY-MM-DD for date+1 using UTC noon anchor. */
function nextDateString(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export async function exportSensitivityXlsx(
  hourlyQH: HourlyPrice[],
  pinned: PinnedDefaults,
): Promise<ExportResult> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FlexMon'
  workbook.created = new Date()

  writeRawPricesSheet(workbook, hourlyQH)
  writeParametersSheet(workbook, pinned)

  const dates = uniqueDates(hourlyQH)
  // Cap to last 365 days of real data to keep file size reasonable.
  const sliced = dates.slice(Math.max(0, dates.length - 365))

  // chart_data summary — axis | x | yearly_saving_eur
  const chartData = workbook.addWorksheet('chart_data')
  chartData.columns = [
    { header: 'axis', key: 'axis', width: 16 },
    { header: 'x', key: 'x', width: 10 },
    { header: 'yearly_saving_eur', key: 'saving', width: 20 },
  ]
  chartData.getRow(1).font = { bold: true }

  for (const axis of AXES) {
    writeAxisSheet(workbook, axis, sliced, chartData)
  }

  // ColorScale over yearly_saving column to make chart_data self-render.
  const lastRow = chartData.lastRow?.number ?? 1
  if (lastRow > 1) {
    chartData.addConditionalFormatting({
      ref: `C2:C${lastRow}`,
      rules: [
        {
          type: 'colorScale',
          priority: 1,
          cfvo: [
            { type: 'min' },
            { type: 'percentile', value: 50 },
            { type: 'max' },
          ],
          color: [
            { argb: 'FFFEE2E2' }, // red-100
            { argb: 'FFFEF3C7' }, // amber-100
            { argb: 'FFD1FAE5' }, // emerald-100
          ],
        },
      ],
    })
  }

  // README
  const readme = workbook.addWorksheet('README')
  readme.columns = [{ width: 110 }]
  readme.addRow(['FlexMon — Sensitivity export'])
  readme.getRow(1).font = { bold: true, size: 14 }
  readme.addRow([''])
  readme.addRow(['Each axis sheet (derived_<axis>) has one row per day and one column group per x-value.'])
  readme.addRow(['All cost cells are Excel formulas referencing raw_prices + named parameters.'])
  readme.addRow(['Edit plugInTime / windowLengthHours / chargePowerKw / yearlyMileageKm on the `parameters` sheet;'])
  readme.addRow(['the three non-swept axes will recompute automatically. The swept axis uses literal x-values.'])
  readme.addRow([''])
  readme.addRow(['chart_data — summary of yearly_saving per axis × x, referencing the axis sheets.'])

  const buf = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: XLSX_MIME })
  return { blob, filename: `flexmon-sensitivity-${todayIso()}.xlsx` }
}

/**
 * Emit one sheet per axis with per-day rows × per-x column groups.
 * Column layout:
 *   A: date
 *   for each x in axis.xs, 3 cols: baseline, optimized, daily_saving
 * Footer row: yearly_saving_eur per x block.
 */
function writeAxisSheet(
  workbook: import('exceljs').Workbook,
  axis: AxisDef,
  dates: string[],
  chartData: import('exceljs').Worksheet,
): void {
  const ws = workbook.addWorksheet(`derived_${axis.key}`)

  // Header rows.
  ws.getCell(1, 1).value = 'date'
  ws.getCell(1, 1).font = { bold: true }
  axis.xs.forEach((x, xi) => {
    const col = 2 + xi * 3
    ws.getCell(1, col).value = `x=${x}`
    ws.getCell(1, col).font = { bold: true }
    ws.mergeCells(1, col, 1, col + 2)
    ws.getCell(2, col).value = 'baseline_eur'
    ws.getCell(2, col + 1).value = 'optimized_eur'
    ws.getCell(2, col + 2).value = 'daily_saving_eur'
    ws.getCell(2, col).font = { bold: true }
    ws.getCell(2, col + 1).font = { bold: true }
    ws.getCell(2, col + 2).font = { bold: true }
  })

  // Body rows — one per date.
  dates.forEach((date, di) => {
    const row = 3 + di
    ws.getCell(row, 1).value = date
    axis.xs.forEach((x, xi) => {
      const col = 2 + xi * 3
      const par = axis.param(x)
      const { baseline, optimized } = buildDayFormulas(date, par)
      const baselineAddr = `${colLetter(col - 1)}${row}`
      const optimizedAddr = `${colLetter(col)}${row}`
      ws.getCell(row, col).value = { formula: baseline }
      ws.getCell(row, col).numFmt = '0.0000'
      ws.getCell(row, col + 1).value = { formula: optimized }
      ws.getCell(row, col + 1).numFmt = '0.0000'
      ws.getCell(row, col + 2).value = {
        formula: `IFERROR(${baselineAddr}-${optimizedAddr},NA())`,
      }
      ws.getCell(row, col + 2).numFmt = '0.0000'
    })
  })

  // Footer: yearly_saving_eur per x.
  const footerRow = 3 + dates.length + 1
  ws.getCell(footerRow, 1).value = 'yearly_saving_eur'
  ws.getCell(footerRow, 1).font = { bold: true }
  axis.xs.forEach((x, xi) => {
    const col = 2 + xi * 3
    const savingCol = colLetter(col + 1) // daily_saving column
    const savingRange = `${savingCol}3:${savingCol}${3 + dates.length - 1}`
    ws.getCell(footerRow, col + 2).value = {
      formula: `IFERROR(AVERAGE(${savingRange})*${PARAM_NAMES.plugInsPerWeek}*52,NA())`,
    }
    ws.getCell(footerRow, col + 2).numFmt = '0.00'
    ws.getCell(footerRow, col + 2).font = { bold: true }

    // Append to chart_data.
    const yearlyAddr = `derived_${axis.key}!${colLetter(col + 1)}${footerRow}`
    chartData.addRow({ axis: axis.label, x, saving: { formula: yearlyAddr } })
  })

  ws.views = [{ state: 'frozen', xSplit: 1, ySplit: 2 }]
  ws.getColumn(1).width = 12
}

/** Convert a 1-indexed column index to A1 letters (1 -> A, 26 -> Z, 27 -> AA). */
function colLetter(idx: number): string {
  let n = idx - 1
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}
