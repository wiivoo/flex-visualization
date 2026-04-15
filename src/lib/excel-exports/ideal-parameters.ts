/**
 * Ideal-parameters export builder.
 *
 * 2D sweep of yearly savings over (mileage × window length) with all cost
 * math expressed as Excel formulas referencing raw_prices and the named
 * parameters.
 *
 * Sheet layout:
 *   raw_prices, parameters  — shared helpers
 *   derived                 — per (mileage, windowLength) block, per-day
 *                             baseline/optimized/daily_saving formulas and
 *                             a yearly_saving cell
 *   chart_data              — 2D matrix mileages (rows) × windowLengths
 *                             (columns) of references to the yearly_saving
 *                             cells, with a ColorScale CF rendering it as
 *                             a heatmap identical to the in-app card
 *
 * Formula strategy matches sensitivity.ts — see that file for the
 * SUMPRODUCT(SMALL(IF(...))) optimizer formula rationale. The only
 * difference is that here mileage AND windowLength are literals per
 * block, so editing the parameters sheet does not affect this workbook's
 * values (it varies by design). plug-in time and charge power remain
 * named references and DO recompute on edit.
 *
 * Chart strategy: exceljs has no native chart API, so we rely on the
 * ColorScale conditional formatting over chart_data for the visual.
 */
import type { HourlyPrice } from '@/lib/v2-config'
import type { ExportResult } from './types'
import { XLSX_MIME } from './types'
import type { PinnedDefaults } from '@/lib/insights-sweep'
import { writeRawPricesSheet } from './raw-prices-sheet'
import { writeParametersSheet, PARAM_NAMES } from './parameters-sheet'

const DEFAULT_MILEAGES = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
const DEFAULT_WINDOWS = [4, 6, 8, 10, 12, 14]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

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

function nextDateString(date: string): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Convert a 1-indexed column index to A1 letters. */
function colLetter(idx: number): string {
  let n = idx - 1
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

/**
 * Build baseline and optimized formulas for a single (date, mileage,
 * windowLength) combination. plugInTime and chargePowerKw are always
 * referenced by name so editing parameters propagates.
 */
function buildDayFormulas(
  date: string,
  mileageLiteral: number,
  windowLengthLiteral: number,
): { baseline: string; optimized: string } {
  const energyPerSession =
    `(${mileageLiteral}/(${PARAM_NAMES.plugInsPerWeek}*52)/100*${PARAM_NAMES.kwhPer100km})`
  const slots = `CEILING(${energyPerSession}/${PARAM_NAMES.chargePowerKw}/0.25,1)`
  const startQh = `(${PARAM_NAMES.plugInTime}*4)`
  const endQhRaw = `(${startQh}+${windowLengthLiteral}*4)`
  const perSlotKwh = `(${PARAM_NAMES.chargePowerKw}*0.25)`
  const energyCostFactor = `(${perSlotKwh}/100)`

  const dateStr = `"${date}"`
  const nextDateStr = `"${nextDateString(date)}"`

  const baselineSameDay =
    `SUMIFS(raw_prices!G:G,raw_prices!A:A,${dateStr},raw_prices!D:D,">="&${startQh},raw_prices!D:D,"<"&MIN(96,${startQh}+${slots}))`
  const baselineOverflow =
    `IF(${startQh}+${slots}>96,SUMIFS(raw_prices!G:G,raw_prices!A:A,${nextDateStr},raw_prices!D:D,">="&0,raw_prices!D:D,"<"&(${startQh}+${slots}-96)),0)`
  const baseline = `(${baselineSameDay}+${baselineOverflow})*${energyCostFactor}`

  const inSameDay =
    `((raw_prices!A:A=${dateStr})*(raw_prices!D:D>=${startQh})*(raw_prices!D:D<MIN(96,${endQhRaw})))`
  const inNextDay =
    `((raw_prices!A:A=${nextDateStr})*(raw_prices!D:D<MAX(0,${endQhRaw}-96)))`
  const membership = `(${inSameDay}+${inNextDay})`
  const optimizedSum =
    `SUMPRODUCT(SMALL(IF(${membership},raw_prices!G:G,""),ROW(INDIRECT("1:"&${slots}))))`
  const optimized = `IFERROR(${optimizedSum}*${energyCostFactor},NA())`

  return { baseline, optimized }
}

export async function exportIdealParametersXlsx(
  hourlyQH: HourlyPrice[],
  pinned: PinnedDefaults,
  mileages: number[] = DEFAULT_MILEAGES,
  windowLengths: number[] = DEFAULT_WINDOWS,
): Promise<ExportResult> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FlexMon'
  workbook.created = new Date()

  writeRawPricesSheet(workbook, hourlyQH)
  writeParametersSheet(workbook, pinned)

  const dates = uniqueDates(hourlyQH)
  const sliced = dates.slice(Math.max(0, dates.length - 365))

  // derived sheet — one block per (mileage, windowLength) combo, stacked.
  const derived = workbook.addWorksheet('derived')
  derived.getCell(1, 1).value = 'mileage'
  derived.getCell(1, 2).value = 'windowLength'
  derived.getCell(1, 3).value = 'date'
  derived.getCell(1, 4).value = 'baseline_eur'
  derived.getCell(1, 5).value = 'optimized_eur'
  derived.getCell(1, 6).value = 'daily_saving_eur'
  derived.getCell(1, 7).value = 'yearly_saving_eur'
  derived.getRow(1).font = { bold: true }

  // Map of (m,w) -> yearly_saving cell address for chart_data references.
  const yearlyAddrByCell: Record<string, string> = {}
  let nextRow = 2

  for (const mileage of mileages) {
    for (const windowLen of windowLengths) {
      const blockStart = nextRow
      sliced.forEach((date, di) => {
        const row = blockStart + di
        const { baseline, optimized } = buildDayFormulas(date, mileage, windowLen)
        derived.getCell(row, 1).value = mileage
        derived.getCell(row, 2).value = windowLen
        derived.getCell(row, 3).value = date
        derived.getCell(row, 4).value = { formula: baseline }
        derived.getCell(row, 4).numFmt = '0.0000'
        derived.getCell(row, 5).value = { formula: optimized }
        derived.getCell(row, 5).numFmt = '0.0000'
        const baselineAddr = `D${row}`
        const optimizedAddr = `E${row}`
        derived.getCell(row, 6).value = {
          formula: `IFERROR(${baselineAddr}-${optimizedAddr},NA())`,
        }
        derived.getCell(row, 6).numFmt = '0.0000'
      })
      const blockEnd = blockStart + sliced.length - 1
      // Yearly aggregation row (reuse the first row of the block for the summary cell in col G).
      const savingRange = `F${blockStart}:F${blockEnd}`
      derived.getCell(blockStart, 7).value = {
        formula: `IFERROR(AVERAGE(${savingRange})*${PARAM_NAMES.plugInsPerWeek}*52,NA())`,
      }
      derived.getCell(blockStart, 7).numFmt = '0.00'
      derived.getCell(blockStart, 7).font = { bold: true }
      yearlyAddrByCell[`${mileage}|${windowLen}`] = `derived!G${blockStart}`
      nextRow = blockEnd + 1
    }
  }
  derived.views = [{ state: 'frozen', ySplit: 1 }]
  derived.getColumn(1).width = 10
  derived.getColumn(2).width = 14
  derived.getColumn(3).width = 12
  derived.getColumn(7).width = 18

  // chart_data — 2D matrix mileages × windowLengths.
  const chartData = workbook.addWorksheet('chart_data')
  chartData.getCell(1, 1).value = 'mileage \\ window_hours'
  chartData.getCell(1, 1).font = { bold: true }
  windowLengths.forEach((w, wi) => {
    chartData.getCell(1, 2 + wi).value = w
    chartData.getCell(1, 2 + wi).font = { bold: true }
  })
  mileages.forEach((m, mi) => {
    const row = 2 + mi
    chartData.getCell(row, 1).value = m
    chartData.getCell(row, 1).font = { bold: true }
    windowLengths.forEach((w, wi) => {
      const addr = yearlyAddrByCell[`${m}|${w}`]
      chartData.getCell(row, 2 + wi).value = { formula: addr }
      chartData.getCell(row, 2 + wi).numFmt = '0'
    })
  })

  // ColorScale CF over the matrix.
  const endCol = colLetter(1 + windowLengths.length)
  const endRow = 1 + mileages.length
  chartData.addConditionalFormatting({
    ref: `B2:${endCol}${endRow}`,
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
          { argb: 'FFFEE2E2' }, // red-100 (low saving)
          { argb: 'FFFEF3C7' }, // amber-100
          { argb: 'FFD1FAE5' }, // emerald-100 (high saving)
        ],
      },
    ],
  })
  chartData.getColumn(1).width = 18
  for (let c = 0; c < windowLengths.length; c++) chartData.getColumn(2 + c).width = 10
  chartData.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]

  // README
  const readme = workbook.addWorksheet('README')
  readme.columns = [{ width: 110 }]
  readme.addRow(['FlexMon — Ideal Parameters export'])
  readme.getRow(1).font = { bold: true, size: 14 }
  readme.addRow([''])
  readme.addRow(['2D sweep over mileage × plug-in window length. Mileage and window length are literal per block;'])
  readme.addRow(['plugInTime, chargePowerKw, plugInsPerWeek are named references on the `parameters` sheet.'])
  readme.addRow(['Edit plugInTime on `parameters` to re-optimize every cell on `chart_data` via `derived`.'])
  readme.addRow([''])
  readme.addRow(['chart_data — 2D matrix with 3-stop ColorScale CF.'])

  const buf = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: XLSX_MIME })
  return { blob, filename: `flexmon-ideal-parameters-${todayIso()}.xlsx` }
}
