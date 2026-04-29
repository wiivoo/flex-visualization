/**
 * Excel export helpers.
 * Active exports in this module use ExcelJS only.
 */
import type { HourlyPrice, ChargingScenario, DayOfWeek } from '@/lib/v2-config'
import { deriveEnergyPerSession, VEHICLE_PRESETS, AVG_CONSUMPTION_KWH_PER_100KM, effectivePlugInDays, DOW_LABELS } from '@/lib/v2-config'

export interface EnrichedWindow {
  date: string
  month: string
  isWeekend: boolean
  dow: number
  prices: HourlyPrice[]
  sorted: HourlyPrice[]
  savingsEur: number
  bAvg: number
  oAvg: number
  spreadCt: number
  isProjected?: boolean
}

function r1(n: number): number { return Math.round(n * 10) / 10 }
function r2(n: number): number { return Math.round(n * 100) / 100 }
function r4(n: number): number { return Math.round(n * 10000) / 10000 }

/* ══════════════════════════════════════════════════════════════════════════
 * Enhanced Excel Export — with raw prices, formulas, and fleet support
 * ══════════════════════════════════════════════════════════════════════════ */

interface EnhancedExportOptions {
  scenario: ChargingScenario
  overnightWindows: EnrichedWindow[]
  hourlyPrices: HourlyPrice[]
  hourlyQH: HourlyPrice[]
  country: string
  dateRange: 30 | 90 | 365
  resolution: '60min' | '15min'
  showFleet: boolean
  fleetConfig: import('@/lib/v2-config').FleetConfig
  sheets: {
    prices: boolean
    profile: boolean
    daily: boolean
    monthly: boolean
  }
}

/**
 * Excel column letter from 0-based index (0=A, 25=Z, 26=AA, etc.)
 */
function colLetter(idx: number): string {
  let s = ''
  let n = idx
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s
    n = Math.floor(n / 26) - 1
  }
  return s
}

// ── Shared styles for ExcelJS ──
const COLORS = {
  headerBg: '1F2937',     // gray-800
  headerFg: 'FFFFFF',
  editableBg: 'FEF9C3',   // yellow-100 (editable cells)
  baselineBg: 'FEE2E2',   // red-100
  optimizedBg: 'D1FAE5',  // emerald-100
  selectedBg: 'F0FDF4',   // emerald-50
  altRow: 'F9FAFB',       // gray-50
  border: 'E5E7EB',       // gray-200
  emerald: '059669',       // emerald-600
  red: 'DC2626',
}

function styleHeader(row: any, colCount: number) {
  row.font = { bold: true, color: { argb: COLORS.headerFg }, size: 10 }
  row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.headerBg } }
  row.alignment = { vertical: 'middle' }
  row.height = 22
  for (let c = 1; c <= colCount; c++) {
    row.getCell(c).border = { bottom: { style: 'thin', color: { argb: COLORS.border } } }
  }
}

function styleAltRows(ws: any, startRow: number, endRow: number, colCount: number) {
  for (let r = startRow; r <= endRow; r++) {
    if (r % 2 === 0) {
      const row = ws.getRow(r)
      for (let c = 1; c <= colCount; c++) {
        row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.altRow } }
      }
    }
  }
}

export async function generateEnhancedExcel(opts: EnhancedExportOptions): Promise<void> {
  const ExcelJS = await import('exceljs')
  const {
    scenario, overnightWindows, hourlyPrices, hourlyQH, country,
    dateRange, resolution, showFleet, fleetConfig, sheets,
  } = opts

  const energyPerSession = deriveEnergyPerSession(
    showFleet ? (fleetConfig.yearlyMileageKm ?? 12000) : scenario.yearlyMileageKm,
    showFleet ? (fleetConfig.plugInsPerWeek ?? 3) : scenario.weekdayPlugIns,
    showFleet ? 0 : scenario.weekendPlugIns,
  )
  const chargePowerKw = scenario.chargePowerKw ?? 7
  const plugInDays = showFleet ? null : effectivePlugInDays(scenario)
  const plugInDaysLabel = plugInDays ? plugInDays.map(d => DOW_LABELS[d as DayOfWeek]).join(', ') : 'All (fleet)'

  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - dateRange)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const allWindows = overnightWindows
    .filter(w => !w.isProjected && w.date >= cutoffStr)
    .sort((a, b) => a.date.localeCompare(b.date))

  // Handle both ESM default and namespace imports
  const EJ = (ExcelJS as any).default ?? ExcelJS
  const wb = new EJ.Workbook()
  wb.creator = 'EV Flex Charging Dashboard'
  wb.created = new Date()
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  const PROFILE_POWER_ROW = 4
  const PROFILE_ENERGY_ROW = 5
  const PROFILE_SLOTS_ROW = 6

  // ═══════════════════════════════════════════════════════════════
  // Sheet 1: Profile — editable inputs + explanation (styled)
  // ═══════════════════════════════════════════════════════════════
  if (sheets.profile) {
    const ws = wb.addWorksheet('Profile', { properties: { tabColor: { argb: '059669' } } })
    ws.columns = [{ width: 32 }, { width: 72 }]

    // Title
    ws.mergeCells('A1:B1')
    const titleCell = ws.getCell('A1')
    titleCell.value = 'EV Flex Charging — Dynamic Export'
    titleCell.font = { bold: true, size: 14, color: { argb: '1F2937' } }
    ws.getCell('A2').value = 'Change the yellow cells below to recalculate all sheets'
    ws.getCell('A2').font = { italic: true, size: 10, color: { argb: '6B7280' } }

    // Row 3: Section header
    ws.getCell('A3').value = 'EDITABLE INPUTS'
    ws.getCell('A3').font = { bold: true, size: 9, color: { argb: '059669' } }

    // Editable cells (yellow background)
    const editFill = { type: 'pattern' as const, pattern: 'solid' as const, fgColor: { argb: COLORS.editableBg } }
    const editBorder = {
      top: { style: 'thin', color: { argb: 'D97706' } },
      bottom: { style: 'thin', color: { argb: 'D97706' } },
      left: { style: 'thin', color: { argb: 'D97706' } },
      right: { style: 'thin', color: { argb: 'D97706' } },
    }

    // B4: Power
    ws.getCell('A4').value = 'Charge Power (kW)'
    ws.getCell('A4').font = { bold: true }
    ws.getCell('B4').value = chargePowerKw
    ws.getCell('B4').fill = editFill
    ws.getCell('B4').border = editBorder
    ws.getCell('B4').numFmt = '0.0'
    // B5: Energy
    ws.getCell('A5').value = 'Energy per Session (kWh)'
    ws.getCell('A5').font = { bold: true }
    ws.getCell('B5').value = r1(energyPerSession)
    ws.getCell('B5').fill = editFill
    ws.getCell('B5').border = editBorder
    ws.getCell('B5').numFmt = '0.0'
    // B6: Slots Needed (formula)
    ws.getCell('A6').value = 'Slots Needed (auto)'
    ws.getCell('A6').font = { bold: true, color: { argb: '6B7280' } }
    ws.getCell('B6').value = { formula: `CEILING(B${PROFILE_ENERGY_ROW}/B${PROFILE_POWER_ROW},1)` }
    ws.getCell('B6').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } }
    ws.getCell('B6').numFmt = '0'

    // Info section
    let row = 8
    const vehicle = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId)
    const info: [string, string | number][] = [
      ['Generated', new Date().toISOString().slice(0, 19)],
      ['Country', country],
      ['Date Range', `Last ${dateRange} days`],
      ['Resolution', resolution === '15min' ? '15 min' : '60 min'],
      ['Vehicle', `${vehicle?.label ?? scenario.vehicleId} (${vehicle?.battery_kwh ?? 60} kWh)`],
      ['Plug-in Days', plugInDaysLabel],
      ['Plug-in Time', `${String(scenario.plugInTime).padStart(2, '0')}:00`],
      ['Departure Time', `${String(scenario.departureTime).padStart(2, '0')}:00`],
      ['Charging Mode', scenario.chargingMode],
    ]
    for (const [label, val] of info) {
      ws.getCell(`A${row}`).value = label
      ws.getCell(`A${row}`).font = { size: 10, color: { argb: '6B7280' } }
      ws.getCell(`B${row}`).value = val
      ws.getCell(`B${row}`).font = { size: 10 }
      row++
    }

    // How it works
    row += 1
    ws.getCell(`A${row}`).value = 'HOW THE OPTIMIZATION WORKS'
    ws.getCell(`A${row}`).font = { bold: true, size: 11, color: { argb: '1F2937' } }
    row += 1
    const steps: [string, string][] = [
      ['1. Charging Window', `All price slots from ${String(scenario.plugInTime).padStart(2, '0')}:00 to ${String(scenario.departureTime).padStart(2, '0')}:00 next day`],
      ['2. Slots Needed', '= CEILING(Energy / Power) — how many hours to charge'],
      ['3. Baseline (ASAP)', 'Charge in the first N slots after plug-in (immediate charging)'],
      ['4. Optimized (Smart)', 'Charge in the cheapest N slots within the window'],
      ['5. Savings', '= (Baseline avg - Optimized avg) x Energy / 100 EUR'],
    ]
    for (const [label, desc] of steps) {
      ws.getCell(`A${row}`).value = label
      ws.getCell(`A${row}`).font = { bold: true, size: 10 }
      ws.getCell(`B${row}`).value = desc
      ws.getCell(`B${row}`).font = { size: 10, color: { argb: '374151' } }
      row++
    }

    row += 1
    ws.getCell(`A${row}`).value = 'SHEET GUIDE'
    ws.getCell(`A${row}`).font = { bold: true, size: 11, color: { argb: '1F2937' } }
    row++
    const guide: [string, string][] = [
      ['Prices', 'Source day-ahead prices (SMARD/ENTSO-E). Key column enables lookups.'],
      ['Window Prices', 'Every slot per session. Price = INDEX+MATCH from Prices. Baseline/Optimized = formulas.'],
      ['Daily Sessions', 'Per-day AVERAGEIFS on Window Prices. Savings = formula chain to Profile.'],
      ['Monthly Summary', 'SUMIFS on Daily Sessions. Change Power/Energy above to see updates.'],
    ]
    for (const [label, desc] of guide) {
      ws.getCell(`A${row}`).value = label
      ws.getCell(`A${row}`).font = { bold: true, size: 10, color: { argb: '059669' } }
      ws.getCell(`B${row}`).value = desc
      ws.getCell(`B${row}`).font = { size: 9, color: { argb: '6B7280' } }
      row++
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Sheet 2: Prices — source data with lookup key (styled)
  // ═══════════════════════════════════════════════════════════════
  let priceRowCount = 0
  if (sheets.prices) {
    const ws = wb.addWorksheet('Prices', { properties: { tabColor: { argb: '3B82F6' } } })
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Hour', key: 'hour', width: 6 },
      { header: 'Minute', key: 'minute', width: 8 },
      { header: 'Price (ct/kWh)', key: 'priceCt', width: 16 },
      { header: 'Price (EUR/MWh)', key: 'priceEur', width: 16 },
      { header: 'Key', key: 'key', width: 22 },
    ]
    styleHeader(ws.getRow(1), 6)
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    const priceSource = resolution === '15min' && hourlyQH.length > 0 ? hourlyQH : hourlyPrices
    const filteredPrices = priceSource
      .filter(p => p.date >= cutoffStr && !p.isProjected)
      .sort((a, b) => a.timestamp - b.timestamp)
    priceRowCount = filteredPrices.length

    for (let i = 0; i < filteredPrices.length; i++) {
      const p = filteredPrices[i]
      const r = i + 2
      const row = ws.getRow(r)
      row.values = [p.date, p.hour, p.minute ?? 0, r2(p.priceCtKwh), r2(p.priceEurMwh), '']
      row.getCell(4).numFmt = '0.00'
      row.getCell(5).numFmt = '0.00'
      // Key formula
      ws.getCell(`F${r}`).value = { formula: `A${r}&"-"&TEXT(B${r},"00")&"-"&TEXT(C${r},"00")` }
    }
    styleAltRows(ws, 2, filteredPrices.length + 1, 6)

    // Conditional formatting: color scale on prices (green=cheap, red=expensive)
    if (filteredPrices.length > 0) {
      ws.addConditionalFormatting({
        ref: `D2:D${filteredPrices.length + 1}`,
        rules: [{
          type: 'colorScale',
          priority: 1,
          cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
          color: [{ argb: 'D1FAE5' }, { argb: 'FFFDE7' }, { argb: 'FEE2E2' }],
        }],
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Sheet 3: Window Prices — per-slot with formula columns (styled)
  // ═══════════════════════════════════════════════════════════════
  let wpRowCount = 0
  if (sheets.daily) {
    const ws = wb.addWorksheet('Window Prices', { properties: { tabColor: { argb: 'F59E0B' } } })
    ws.columns = [
      { header: 'Session Date', key: 'session', width: 12 },
      { header: 'Slot Date', key: 'slotDate', width: 12 },
      { header: 'Hour', key: 'hour', width: 6 },
      { header: 'Minute', key: 'minute', width: 7 },
      { header: 'Key', key: 'key', width: 20 },
      { header: 'Price (ct/kWh)', key: 'price', width: 16 },
      { header: 'Chron#', key: 'chron', width: 8 },
      { header: 'Price Rank', key: 'rank', width: 10 },
      { header: 'Baseline?', key: 'baseline', width: 10 },
      { header: 'Optimized?', key: 'optimized', width: 12 },
    ]
    styleHeader(ws.getRow(1), 10)
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    let rowIdx = 2
    for (const w of allWindows) {
      for (const p of w.prices) {
        const row = ws.getRow(rowIdx)
        row.values = [w.date, p.date, p.hour, p.minute ?? 0, '', 0, 0, 0, '', '']
        rowIdx++
      }
    }
    wpRowCount = rowIdx - 2
    const lastR = wpRowCount + 1

    // Inject formulas
    for (let i = 0; i < wpRowCount; i++) {
      const r = i + 2
      ws.getCell(`E${r}`).value = { formula: `B${r}&"-"&TEXT(C${r},"00")&"-"&TEXT(D${r},"00")` }
      if (sheets.prices && priceRowCount > 0) {
        ws.getCell(`F${r}`).value = { formula: `INDEX(Prices!D$2:D$${priceRowCount + 1},MATCH(E${r},Prices!F$2:F$${priceRowCount + 1},0))` }
      }
      ws.getCell(`F${r}`).numFmt = '0.00'
      ws.getCell(`G${r}`).value = { formula: `COUNTIFS($A$2:A${r},A${r})` }
      ws.getCell(`H${r}`).value = { formula:
        `COUNTIFS($A$2:$A$${lastR},A${r},$F$2:$F$${lastR},"<"&F${r})`
        + `+COUNTIFS($A$2:$A$${lastR},A${r},$F$2:$F$${lastR},F${r},$C$2:$C$${lastR},"<"&C${r})`
        + `+COUNTIFS($A$2:$A$${lastR},A${r},$F$2:$F$${lastR},F${r},$C$2:$C$${lastR},C${r},$D$2:$D$${lastR},"<"&D${r})`
        + `+1`
      }
      ws.getCell(`I${r}`).value = { formula: `IF(G${r}<=Profile!$B$${PROFILE_SLOTS_ROW},"YES","")` }
      ws.getCell(`J${r}`).value = { formula: `IF(H${r}<=Profile!$B$${PROFILE_SLOTS_ROW},"YES","")` }
    }

    // Color scale on price column (green=cheap, red=expensive)
    if (wpRowCount > 0) {
      ws.addConditionalFormatting({
        ref: `F2:F${lastR}`,
        rules: [{
          type: 'colorScale',
          priority: 2,
          cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
          color: [{ argb: 'D1FAE5' }, { argb: 'FFFDE7' }, { argb: 'FEE2E2' }],
        }],
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Sheet 4: Daily Sessions — formula-driven summaries (styled)
  // ═══════════════════════════════════════════════════════════════
  if (sheets.daily) {
    const ws = wb.addWorksheet('Daily Sessions', { properties: { tabColor: { argb: '10B981' } } })
    ws.columns = [
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Day', key: 'day', width: 5 },
      { header: 'Selected?', key: 'selected', width: 10 },
      { header: 'Baseline Avg (ct/kWh)', key: 'bAvg', width: 22 },
      { header: 'Optimized Avg (ct/kWh)', key: 'oAvg', width: 22 },
      { header: 'Savings (ct/kWh)', key: 'savCt', width: 16 },
      { header: 'Savings (EUR)', key: 'savEur', width: 14 },
      { header: 'Energy (kWh)', key: 'energy', width: 12 },
      { header: 'Spread (ct)', key: 'spread', width: 14 },
      { header: 'Slots', key: 'slots', width: 8 },
    ]
    styleHeader(ws.getRow(1), 10)
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    const wpLast = wpRowCount + 1

    for (let i = 0; i < allWindows.length; i++) {
      const w = allWindows[i]
      const r = i + 2
      const dow = new Date(w.date + 'T12:00:00Z').getUTCDay()
      const isSelected = !plugInDays || plugInDays.includes(dow as DayOfWeek)

      const row = ws.getRow(r)
      row.values = [w.date, dowNames[dow], isSelected ? 'YES' : '', 0, 0, 0, 0, 0, 0, 0]

      ws.getCell(`D${r}`).value = { formula: `AVERAGEIFS('Window Prices'!F$2:F$${wpLast},'Window Prices'!A$2:A$${wpLast},A${r},'Window Prices'!I$2:I$${wpLast},"YES")` }
      ws.getCell(`D${r}`).numFmt = '0.00'
      ws.getCell(`E${r}`).value = { formula: `AVERAGEIFS('Window Prices'!F$2:F$${wpLast},'Window Prices'!A$2:A$${wpLast},A${r},'Window Prices'!J$2:J$${wpLast},"YES")` }
      ws.getCell(`E${r}`).numFmt = '0.00'
      ws.getCell(`F${r}`).value = { formula: `D${r}-E${r}` }
      ws.getCell(`F${r}`).numFmt = '0.00'
      ws.getCell(`G${r}`).value = { formula: `F${r}*Profile!$B$${PROFILE_ENERGY_ROW}/100` }
      ws.getCell(`G${r}`).numFmt = '0.0000'
      ws.getCell(`H${r}`).value = { formula: `Profile!$B$${PROFILE_ENERGY_ROW}` }
      ws.getCell(`H${r}`).numFmt = '0.0'
      // Spread + slots: pre-computed (spread doesn't depend on user inputs, and avoids MAXIFS which requires Excel 2019+)
      ws.getCell(`I${r}`).value = r2(w.spreadCt)
      ws.getCell(`I${r}`).numFmt = '0.00'
      ws.getCell(`J${r}`).value = w.prices.length

      // Green bg for selected days
      if (isSelected) {
        for (let c = 1; c <= 10; c++) {
          row.getCell(c).fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: COLORS.selectedBg } }
        }
      }
    }

    // Color scale on Savings EUR column (green gradient — darker = more savings)
    if (allWindows.length > 0) {
      const dLast = allWindows.length + 1
      ws.addConditionalFormatting({
        ref: `G2:G${dLast}`,
        rules: [{
          type: 'colorScale',
          priority: 5,
          cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
          color: [{ argb: 'FFFFFF' }, { argb: 'D1FAE5' }, { argb: '059669' }],
        }],
      })
    }
  }

  // ═══════════════════════════════════════════════════════════════
  // Sheet 5: Monthly Summary — with chart-like data bars (styled)
  // ═══════════════════════════════════════════════════════════════
  if (sheets.monthly && sheets.daily) {
    const ws = wb.addWorksheet('Monthly Summary', { properties: { tabColor: { argb: '8B5CF6' } } })
    ws.columns = [
      { header: 'Month', key: 'month', width: 10 },
      { header: 'Total Days', key: 'totalDays', width: 10 },
      { header: 'Sessions', key: 'sessions', width: 10 },
      { header: 'Avg Spread (ct)', key: 'spread', width: 16 },
      { header: 'Avg Savings (ct/kWh)', key: 'savCt', width: 20 },
      { header: 'Monthly Savings (EUR)', key: 'savEur', width: 20 },
      { header: 'Cumulative (EUR)', key: 'cumul', width: 18 },
    ]
    styleHeader(ws.getRow(1), 7)
    ws.views = [{ state: 'frozen', ySplit: 1 }]

    const monthSet = new Set<string>()
    for (const w of allWindows) monthSet.add(w.month)
    const months = [...monthSet].sort()
    const dLast = allWindows.length + 1

    const dDateR = `'Daily Sessions'!A$2:A$${dLast}`
    const dSelR = `'Daily Sessions'!C$2:C$${dLast}`
    const dFR = `'Daily Sessions'!F$2:F$${dLast}`
    const dGR = `'Daily Sessions'!G$2:G$${dLast}`
    const dIR = `'Daily Sessions'!I$2:I$${dLast}`

    for (let i = 0; i < months.length; i++) {
      const r = i + 2
      const crit = `A${r}&"*"`
      ws.getRow(r).values = [months[i], 0, 0, 0, 0, 0, 0]
      ws.getCell(`B${r}`).value = { formula: `COUNTIF(${dDateR},${crit})` }
      ws.getCell(`C${r}`).value = { formula: `COUNTIFS(${dDateR},${crit},${dSelR},"YES")` }
      ws.getCell(`D${r}`).value = { formula: `AVERAGEIFS(${dIR},${dDateR},${crit},${dSelR},"YES")` }
      ws.getCell(`D${r}`).numFmt = '0.00'
      ws.getCell(`E${r}`).value = { formula: `AVERAGEIFS(${dFR},${dDateR},${crit},${dSelR},"YES")` }
      ws.getCell(`E${r}`).numFmt = '0.00'
      ws.getCell(`F${r}`).value = { formula: `SUMIFS(${dGR},${dDateR},${crit},${dSelR},"YES")` }
      ws.getCell(`F${r}`).numFmt = '0.00'
      ws.getCell(`G${r}`).value = { formula: `SUM(F$2:F${r})` }
      ws.getCell(`G${r}`).numFmt = '0.00'
    }

    styleAltRows(ws, 2, months.length + 1, 7)

    // Total row
    const tRow = months.length + 2
    const totalRow = ws.getRow(tRow)
    totalRow.values = ['TOTAL', 0, 0, '', 0, 0, '']
    totalRow.font = { bold: true, size: 11 }
    totalRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'F3F4F6' } }
    ws.getCell(`B${tRow}`).value = { formula: `SUM(B2:B${tRow - 1})` }
    ws.getCell(`C${tRow}`).value = { formula: `SUM(C2:C${tRow - 1})` }
    ws.getCell(`E${tRow}`).value = { formula: `AVERAGE(E2:E${tRow - 1})` }
    ws.getCell(`E${tRow}`).numFmt = '0.00'
    ws.getCell(`F${tRow}`).value = { formula: `SUM(F2:F${tRow - 1})` }
    ws.getCell(`F${tRow}`).numFmt = '0.00'

    // Color scales on savings columns (visual chart alternative)
    if (months.length > 0) {
      // Monthly Savings: white → green gradient
      ws.addConditionalFormatting({
        ref: `F2:F${months.length + 1}`,
        rules: [{
          type: 'colorScale',
          priority: 6,
          cfvo: [{ type: 'min' }, { type: 'percentile', value: 50 }, { type: 'max' }],
          color: [{ argb: 'FFFFFF' }, { argb: 'D1FAE5' }, { argb: '059669' }],
        }],
      })
      // Cumulative: white → blue gradient
      ws.addConditionalFormatting({
        ref: `G2:G${months.length + 1}`,
        rules: [{
          type: 'colorScale',
          priority: 7,
          cfvo: [{ type: 'min' }, { type: 'max' }],
          color: [{ argb: 'EFF6FF' }, { argb: '3B82F6' }],
        }],
      })
    }
  } else if (sheets.monthly && !sheets.daily) {
    // Static fallback (no Window Prices)
    const ws = wb.addWorksheet('Monthly Summary', { properties: { tabColor: { argb: '8B5CF6' } } })
    ws.columns = [
      { header: 'Month', width: 10 }, { header: 'Sessions', width: 10 },
      { header: 'Avg Spread (ct)', width: 16 }, { header: 'Avg Savings (ct/kWh)', width: 22 },
      { header: 'Monthly Savings (EUR)', width: 22 }, { header: 'Cumulative (EUR)', width: 18 },
    ]
    styleHeader(ws.getRow(1), 6)
    const chargingWindows = plugInDays ? allWindows.filter(w => plugInDays.includes(w.dow as DayOfWeek)) : allWindows
    const monthMap = new Map<string, { sum: number; count: number; spreadSum: number; savingsCtSum: number }>()
    for (const w of chargingWindows) {
      const e = monthMap.get(w.month) || { sum: 0, count: 0, spreadSum: 0, savingsCtSum: 0 }
      e.sum += (w.bAvg - w.oAvg) * energyPerSession / 100
      e.spreadSum += w.spreadCt
      e.savingsCtSum += (w.bAvg - w.oAvg)
      e.count++
      monthMap.set(w.month, e)
    }
    let cumulative = 0
    let r = 2
    for (const [month, d] of [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      cumulative += d.sum
      ws.getRow(r).values = [month, d.count, r2(d.spreadSum / d.count), r2(d.savingsCtSum / d.count), r2(d.sum), r2(cumulative)]
      r++
    }
    styleAltRows(ws, 2, r - 1, 6)
  }

  // ═══════════════════════════════════════════════════════════════
  // Download
  // ═══════════════════════════════════════════════════════════════
  const buffer = await wb.xlsx.writeBuffer()
  const blob = new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  const mode = showFleet ? 'fleet' : 'single'
  a.href = url
  a.download = `flex-export-${mode}-${country}-${dateRange}d-${new Date().toISOString().slice(0, 10)}.xlsx`
  a.click()
  URL.revokeObjectURL(url)
}
