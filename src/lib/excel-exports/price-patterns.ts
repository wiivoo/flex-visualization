/**
 * Price patterns export builder.
 *
 * Produces a workbook answering "when are day-ahead prices cheapest?"
 * entirely from raw QH prices via Excel formulas:
 *
 *   raw_prices  — untouched SMARD QH data (ct/kWh), non-projected only
 *   parameters  — constants (currently just kwhPer100km)
 *   derived     — 12 x 96 matrix of AVERAGEIFS(month, qh) formulas
 *   chart_data  — clean labelled grid that references derived
 *
 * Chart strategy: exceljs (v4) has no native Chart generation API, so
 * embedding a real Excel chart object is not feasible here. Instead we
 * make `chart_data` self-render as a heatmap via a 3-stop ColorScale
 * conditional-formatting rule (green -> amber -> red). Opening the file
 * in Excel / Numbers / LibreOffice shows the exact same visual as the
 * in-app PricePatternsHeatmap, driven entirely by the formulas.
 */
import type { HourlyPrice } from '@/lib/v2-config'
import type { ExportResult } from './types'
import { XLSX_MIME } from './types'
import { writeRawPricesSheet } from './raw-prices-sheet'

const MONTH_LABELS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
]

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

/** Convert a 0-indexed column index to A1 letters (0 -> A, 25 -> Z, 26 -> AA). */
function colLetter(idx: number): string {
  let n = idx
  let out = ''
  do {
    out = String.fromCharCode(65 + (n % 26)) + out
    n = Math.floor(n / 26) - 1
  } while (n >= 0)
  return out
}

export async function exportPricePatternsXlsx(
  hourlyQH: HourlyPrice[],
): Promise<ExportResult> {
  const ExcelJS = (await import('exceljs')).default
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'FlexMon'
  workbook.created = new Date()

  // 1. Raw prices
  writeRawPricesSheet(workbook, hourlyQH)

  // 2. Parameters (tiny, just one constant)
  const params = workbook.addWorksheet('parameters')
  params.columns = [
    { header: 'name', key: 'name', width: 22 },
    { header: 'value', key: 'value', width: 10 },
    { header: 'note', key: 'note', width: 50 },
  ]
  params.getRow(1).font = { bold: true }
  params.addRow({ name: 'kwhPer100km', value: 19, note: 'Average EV consumption (kWh per 100 km)' })
  workbook.definedNames.add('parameters!$B$2', 'kwhPer100km')

  // 3. Derived sheet: 12 months x 96 qh slots, AVERAGEIFS formulas.
  //    raw_prices columns: A date | B month | C day | D qh | E hour | F minute | G ct_kWh
  //    Header row: A1 = 'month', B1..CS1 = qh 0..95
  //    Data rows : A2..A13 = 1..12, cells = AVERAGEIFS(raw_prices!G:G, B:B, month, D:D, qh)
  const derived = workbook.addWorksheet('derived')
  derived.getCell(1, 1).value = 'month'
  derived.getCell(1, 1).font = { bold: true }
  for (let q = 0; q < 96; q++) {
    derived.getCell(1, 2 + q).value = q
    derived.getCell(1, 2 + q).font = { bold: true }
  }
  for (let m = 1; m <= 12; m++) {
    derived.getCell(1 + m, 1).value = m
    derived.getCell(1 + m, 1).font = { bold: true }
    for (let q = 0; q < 96; q++) {
      const col = 2 + q
      derived.getCell(1 + m, col).value = {
        formula: `IFERROR(AVERAGEIFS(raw_prices!G:G,raw_prices!B:B,${m},raw_prices!D:D,${q}),NA())`,
      }
      derived.getCell(1 + m, col).numFmt = '0.00'
    }
  }
  derived.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
  derived.getColumn(1).width = 8

  // 4. chart_data — clean labelled grid of references to derived.
  //    Row 1 = hh:mm labels (top axis), Col A = month names.
  const chart = workbook.addWorksheet('chart_data')
  chart.getCell(1, 1).value = 'month \\ time'
  chart.getCell(1, 1).font = { bold: true }
  for (let q = 0; q < 96; q++) {
    const hh = Math.floor(q / 4)
    const mm = (q % 4) * 15
    chart.getCell(1, 2 + q).value = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`
    chart.getCell(1, 2 + q).font = { bold: true }
    chart.getColumn(2 + q).width = 6
  }
  for (let m = 1; m <= 12; m++) {
    chart.getCell(1 + m, 1).value = MONTH_LABELS[m - 1]
    chart.getCell(1 + m, 1).font = { bold: true }
    for (let q = 0; q < 96; q++) {
      const derivedAddr = `${colLetter(1 + q)}${1 + m}` // B2..CS13 area
      chart.getCell(1 + m, 2 + q).value = { formula: `derived!${derivedAddr}` }
      chart.getCell(1 + m, 2 + q).numFmt = '0.0'
    }
  }
  chart.views = [{ state: 'frozen', xSplit: 1, ySplit: 1 }]
  chart.getColumn(1).width = 10

  // 5. 3-stop ColorScale conditional format on the chart_data matrix.
  //    This is what makes the sheet render as a heatmap when opened.
  //    Matrix lives at B2..<last>13 where columns are B..CS (96 qh slots).
  const endCol = colLetter(1 + 95) // last qh column (CS)
  const ref = `B2:${endCol}13`
  chart.addConditionalFormatting({
    ref,
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
          { argb: 'FFECFDF5' }, // emerald-50
          { argb: 'FFFCD34D' }, // amber-300
          { argb: 'FFEF4444' }, // red-500
        ],
      },
    ],
  })

  // 6. README sheet explaining the workbook layout.
  const readme = workbook.addWorksheet('README')
  readme.columns = [{ width: 110 }]
  readme.addRow(['FlexMon — Price Patterns export'])
  readme.getRow(1).font = { bold: true, size: 14 }
  readme.addRow([''])
  readme.addRow(['Sheets:'])
  readme.addRow(['  raw_prices  — Non-projected SMARD QH prices (ct/kWh).'])
  readme.addRow(['  parameters  — Constants used by formulas.'])
  readme.addRow(['  derived     — 12 x 96 matrix of AVERAGEIFS formulas (month x qh) → avg price.'])
  readme.addRow(['  chart_data  — Labelled grid of references to `derived`; color-scaled green→red.'])
  readme.addRow([''])
  readme.addRow(['Verify: click any cell on `derived` to see the AVERAGEIFS formula over raw_prices.'])

  const buf = await workbook.xlsx.writeBuffer()
  const blob = new Blob([buf], { type: XLSX_MIME })
  return { blob, filename: `flexmon-price-patterns-${todayIso()}.xlsx` }
}
