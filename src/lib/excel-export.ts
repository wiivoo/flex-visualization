/**
 * Excel export for full-year session breakdown.
 * Generates a multi-sheet .xlsx with scenario, statistics, monthly summary, and daily breakdown.
 * Only includes days the user would actually charge on (based on plug-in frequency).
 */
import type { HourlyPrice, ChargingScenario } from '@/lib/v2-config'
import { deriveEnergyPerSession, VEHICLE_PRESETS, AVG_CONSUMPTION_KWH_PER_100KM } from '@/lib/v2-config'
import * as XLSX from 'xlsx'

export interface EnrichedWindow {
  date: string
  month: string
  isWeekend: boolean
  prices: HourlyPrice[]
  sorted: HourlyPrice[]
  savingsEur: number
  bAvg: number
  oAvg: number
  spreadCt: number
  isProjected?: boolean
}

interface ExportOptions {
  scenario: ChargingScenario
  overnightWindows: EnrichedWindow[]
  country: string
}

/**
 * Select which days of the week to charge on, evenly spaced.
 * Returns day-of-week indices (0=Sun..6=Sat) for weekdays and weekends.
 *
 * Weekday patterns (Mon=1..Fri=5):
 *   1×: Wed (mid-week)
 *   2×: Mon, Thu
 *   3×: Mon, Wed, Fri
 *   4×: Mon, Tue, Thu, Fri
 *   5×: Mon–Fri
 *
 * Weekend patterns (Sat=6, Sun=0):
 *   1×: Sat
 *   2×: Sat, Sun
 */
function selectChargingDows(weekdayPlugIns: number, weekendPlugIns: number): Set<number> {
  const dows = new Set<number>()

  // Weekday selection
  const wdPatterns: Record<number, number[]> = {
    0: [],
    1: [3],           // Wed
    2: [1, 4],        // Mon, Thu
    3: [1, 3, 5],     // Mon, Wed, Fri
    4: [1, 2, 4, 5],  // Mon, Tue, Thu, Fri
    5: [1, 2, 3, 4, 5], // Mon–Fri
  }
  for (const d of (wdPatterns[weekdayPlugIns] || wdPatterns[5])) dows.add(d)

  // Weekend selection
  if (weekendPlugIns >= 2) { dows.add(6); dows.add(0) }
  else if (weekendPlugIns === 1) { dows.add(6) } // Sat

  return dows
}

export function generateAndDownloadExcel({ scenario, overnightWindows, country }: ExportOptions): void {
  const vehicle = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId)
  const batteryKwh = vehicle?.battery_kwh ?? 60
  const energyPerSession = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weekdayPlugIns, scenario.weekendPlugIns)
  const weeklyPlugIns = scenario.weekdayPlugIns + scenario.weekendPlugIns
  const sessionsPerYear = weeklyPlugIns * 52
  const chargingHours = Math.ceil(energyPerSession / scenario.chargePowerKw)

  // Filter to last 365 days, sorted recent-first
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - 365)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  // Select which days-of-week to include based on plug-in frequency
  const chargingDows = selectChargingDows(scenario.weekdayPlugIns, scenario.weekendPlugIns)
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  const selectedDowLabels = [...chargingDows].sort((a, b) => a - b).map(d => dowNames[d]).join(', ')

  const windows = overnightWindows
    .filter(w => {
      if (w.isProjected || w.date < cutoffStr) return false
      const dow = new Date(w.date + 'T12:00:00Z').getUTCDay()
      return chargingDows.has(dow)
    })
    .sort((a, b) => b.date.localeCompare(a.date))

  const wb = XLSX.utils.book_new()

  // ── Sheet 1: Scenario Parameters ──
  const scenarioData = [
    ['Flex Visualization — Session Export'],
    [],
    ['Parameter', 'Value'],
    ['Generated', new Date().toISOString().slice(0, 19)],
    ['Country', country],
    ['Vehicle', `${vehicle?.label ?? scenario.vehicleId} (${batteryKwh} kWh)`],
    ['Vehicle Examples', vehicle?.examples ?? ''],
    ['Charge Power', `${scenario.chargePowerKw} kW`],
    ['Yearly Mileage', `${scenario.yearlyMileageKm} km`],
    ['Consumption', `${AVG_CONSUMPTION_KWH_PER_100KM} kWh/100km`],
    ['Energy per Session', `${energyPerSession} kWh`],
    ['Weekly Plug-ins', `${weeklyPlugIns} (${scenario.weekdayPlugIns} weekday + ${scenario.weekendPlugIns} weekend)`],
    ['Charging Days', selectedDowLabels],
    ['Sessions per Year', sessionsPerYear],
    ['Charging Duration', `${chargingHours}h per session`],
    ['Charging Window', `${String(scenario.plugInTime).padStart(2, '0')}:00 — ${String(scenario.departureTime).padStart(2, '0')}:00`],
    ['Charging Mode', scenario.chargingMode],
    ['Start Level', `${scenario.startLevel}%`],
    ['Target Level', `${scenario.targetLevel}%`],
    [],
    ['Data Coverage'],
    ['Sessions in Export', windows.length],
    ['Date Range', windows.length > 0 ? `${windows[windows.length - 1].date} to ${windows[0].date}` : 'N/A'],
  ]
  const wsScenario = XLSX.utils.aoa_to_sheet(scenarioData)
  wsScenario['!cols'] = [{ wch: 22 }, { wch: 50 }]
  XLSX.utils.book_append_sheet(wb, wsScenario, 'Scenario')

  if (windows.length === 0) {
    XLSX.writeFile(wb, `flex-sessions-${country}-${new Date().toISOString().slice(0, 10)}.xlsx`)
    return
  }

  // ── Sheet 2: Yearly Statistics ──
  const allSavings = windows.map(w => w.savingsEur)
  const allSpreads = windows.map(w => w.spreadCt)
  const allBAvg = windows.map(w => w.bAvg)
  const allOAvg = windows.map(w => w.oAvg)
  const sorted = [...allSavings].sort((a, b) => a - b)
  const avgSavings = allSavings.reduce((s, v) => s + v, 0) / allSavings.length
  const avgSpread = allSpreads.reduce((s, v) => s + v, 0) / allSpreads.length
  const medianSavings = sorted[Math.floor(sorted.length / 2)]
  const p10 = sorted[Math.floor(sorted.length * 0.1)]
  const p25 = sorted[Math.floor(sorted.length * 0.25)]
  const p75 = sorted[Math.floor(sorted.length * 0.75)]
  const p90 = sorted[Math.floor(sorted.length * 0.9)]
  const stdDev = Math.sqrt(allSavings.reduce((s, v) => s + (v - avgSavings) ** 2, 0) / allSavings.length)
  const negativeDays = allSavings.filter(s => s < 0).length
  const zeroDays = allSavings.filter(s => s === 0).length
  const totalYearlySavings = allSavings.reduce((s, v) => s + v, 0)
  const totalYearlyEnergy = windows.length * energyPerSession
  const totalBaselineCost = windows.reduce((s, w) => s + w.bAvg * energyPerSession / 100, 0)
  const totalOptimizedCost = windows.reduce((s, w) => s + w.oAvg * energyPerSession / 100, 0)

  // Monthly aggregation (from selected days only)
  const monthMap = new Map<string, { sum: number; count: number; minSpread: number; maxSpread: number; spreadSum: number; bAvgSum: number; oAvgSum: number }>()
  for (const w of windows) {
    const e = monthMap.get(w.month) || { sum: 0, count: 0, minSpread: Infinity, maxSpread: -Infinity, spreadSum: 0, bAvgSum: 0, oAvgSum: 0 }
    e.sum += w.savingsEur
    e.minSpread = Math.min(e.minSpread, w.spreadCt)
    e.maxSpread = Math.max(e.maxSpread, w.spreadCt)
    e.spreadSum += w.spreadCt
    e.bAvgSum += w.bAvg
    e.oAvgSum += w.oAvg
    e.count++
    monthMap.set(w.month, e)
  }

  const statsData = [
    ['Flex Visualization — Yearly Statistics'],
    [],
    ['Metric', 'Value', 'Unit'],
    ['Total Yearly Savings', r2(totalYearlySavings), 'EUR'],
    ['Total Yearly Energy', r1(totalYearlyEnergy), 'kWh'],
    ['Total Baseline Cost', r2(totalBaselineCost), 'EUR'],
    ['Total Optimized Cost', r2(totalOptimizedCost), 'EUR'],
    ['Sessions in Year', windows.length, ''],
    [],
    ['Avg Session Savings', r4(avgSavings), 'EUR'],
    ['Median Session Savings', r4(medianSavings), 'EUR'],
    ['Std Dev Session Savings', r4(stdDev), 'EUR'],
    ['P10 Session Savings', r4(p10), 'EUR'],
    ['P25 Session Savings', r4(p25), 'EUR'],
    ['P75 Session Savings', r4(p75), 'EUR'],
    ['P90 Session Savings', r4(p90), 'EUR'],
    ['Min Session Savings', r4(Math.min(...allSavings)), 'EUR'],
    ['Max Session Savings', r4(Math.max(...allSavings)), 'EUR'],
    [],
    ['Avg Baseline Price', r2(allBAvg.reduce((s, v) => s + v, 0) / allBAvg.length), 'ct/kWh'],
    ['Avg Optimized Price', r2(allOAvg.reduce((s, v) => s + v, 0) / allOAvg.length), 'ct/kWh'],
    ['Avg Spread', r2(avgSpread), 'ct/kWh'],
    ['Min Spread', r2(Math.min(...allSpreads)), 'ct/kWh'],
    ['Max Spread', r2(Math.max(...allSpreads)), 'ct/kWh'],
    [],
    ['Sessions with Negative Savings', negativeDays, ''],
    ['Sessions with Zero Savings', zeroDays, ''],
    ['Charging Days', selectedDowLabels, ''],
    ['Date Range', `${windows[windows.length - 1].date} to ${windows[0].date}`, ''],
  ]
  const wsStats = XLSX.utils.aoa_to_sheet(statsData)
  wsStats['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, wsStats, 'Statistics')

  // ── Sheet 3: Monthly Summary ──
  const monthlyRows: (string | number)[][] = [
    ['Flex Visualization — Monthly Summary'],
    [],
    ['Month', 'Total Savings (EUR)', 'Sessions', 'Avg Session Savings (EUR)',
     'Avg Baseline (ct/kWh)', 'Avg Optimized (ct/kWh)',
     'Avg Spread (ct/kWh)', 'Min Spread (ct/kWh)', 'Max Spread (ct/kWh)'],
  ]
  const sortedMonths = [...monthMap.entries()].sort(([a], [b]) => b.localeCompare(a))
  for (const [month, d] of sortedMonths) {
    const avgSession = d.count > 0 ? d.sum / d.count : 0
    const avgSpr = d.count > 0 ? d.spreadSum / d.count : 0
    monthlyRows.push([
      month,
      r2(d.sum),
      d.count,
      r4(avgSession),
      r2(d.bAvgSum / d.count),
      r2(d.oAvgSum / d.count),
      r2(avgSpr),
      d.minSpread === Infinity ? '' : r2(d.minSpread),
      d.maxSpread === -Infinity ? '' : r2(d.maxSpread),
    ])
  }
  monthlyRows.push([])
  monthlyRows.push(['TOTAL', r2(totalYearlySavings), windows.length, r4(avgSavings), '', '', '', '', ''])

  const wsMonthly = XLSX.utils.aoa_to_sheet(monthlyRows)
  wsMonthly['!cols'] = [
    { wch: 10 }, { wch: 20 }, { wch: 10 }, { wch: 24 },
    { wch: 20 }, { wch: 22 },
    { wch: 18 }, { wch: 18 }, { wch: 18 },
  ]
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly')

  // ── Sheet 4: Session Breakdown ──
  const windowHours: number[] = []
  if (scenario.plugInTime > scenario.departureTime) {
    for (let h = scenario.plugInTime; h < 24; h++) windowHours.push(h)
    for (let h = 0; h < scenario.departureTime; h++) windowHours.push(h)
  } else {
    for (let h = scenario.plugInTime; h < scenario.departureTime; h++) windowHours.push(h)
  }
  const hourHeaders = windowHours.map(h => `H${String(h).padStart(2, '0')} (ct/kWh)`)

  const dailyRows: (string | number)[][] = [
    ['Flex Visualization — Session Breakdown'],
    [],
    [
      'Date', 'DOW', 'Window Slots',
      'Baseline Avg (ct/kWh)', 'Optimized Avg (ct/kWh)', 'Spread (ct/kWh)',
      'Savings (EUR)', 'Baseline Cost (EUR)', 'Optimized Cost (EUR)',
      'Min Price (ct/kWh)', 'Max Price (ct/kWh)',
      'Cheapest Hour', 'Most Expensive Hour',
      ...hourHeaders,
    ],
  ]

  for (const w of windows) {
    const d = new Date(w.date + 'T12:00:00Z')
    const dow = d.getUTCDay()
    const priceByHour = new Map<number, number>()
    for (const p of w.prices) priceByHour.set(p.hour, p.priceCtKwh)

    const cheapest = w.sorted[0]
    const expensive = w.sorted[w.sorted.length - 1]
    const hourValues = windowHours.map(h => {
      const price = priceByHour.get(h)
      return price !== undefined ? r2(price) : ''
    })

    dailyRows.push([
      w.date,
      dowNames[dow],
      w.prices.length,
      r2(w.bAvg),
      r2(w.oAvg),
      r2(w.spreadCt),
      r4(w.savingsEur),
      r4(w.bAvg * energyPerSession / 100),
      r4(w.oAvg * energyPerSession / 100),
      cheapest ? r2(cheapest.priceCtKwh) : '',
      expensive ? r2(expensive.priceCtKwh) : '',
      cheapest ? `${String(cheapest.hour).padStart(2, '0')}:00` : '',
      expensive ? `${String(expensive.hour).padStart(2, '0')}:00` : '',
      ...hourValues,
    ])
  }

  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows)
  const dailyCols = [
    { wch: 12 }, { wch: 5 }, { wch: 12 },
    { wch: 20 }, { wch: 22 }, { wch: 16 },
    { wch: 14 }, { wch: 18 }, { wch: 20 },
    { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 18 },
    ...windowHours.map(() => ({ wch: 14 })),
  ]
  wsDaily['!cols'] = dailyCols
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Sessions')

  // ── Download ──
  XLSX.writeFile(wb, `flex-sessions-${country}-${new Date().toISOString().slice(0, 10)}.xlsx`)
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

export function generateEnhancedExcel(opts: EnhancedExportOptions): void {
  const {
    scenario, overnightWindows, hourlyPrices, hourlyQH, country,
    dateRange, resolution, showFleet, fleetConfig, sheets,
  } = opts

  const energyPerSession = deriveEnergyPerSession(
    showFleet ? (fleetConfig.yearlyMileageKm ?? 12000) : scenario.yearlyMileageKm,
    showFleet ? (fleetConfig.plugInsPerWeek ?? 3) : scenario.weekdayPlugIns,
    showFleet ? 0 : scenario.weekendPlugIns,
  )

  // Date cutoff
  const cutoff = new Date()
  cutoff.setUTCDate(cutoff.getUTCDate() - dateRange)
  const cutoffStr = cutoff.toISOString().slice(0, 10)

  const wb = XLSX.utils.book_new()
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

  // ── Sheet 1: Raw Prices ──
  let priceDataRowCount = 0
  if (sheets.prices) {
    const priceSource = resolution === '15min' && hourlyQH.length > 0 ? hourlyQH : hourlyPrices
    const filteredPrices = priceSource
      .filter(p => p.date >= cutoffStr && !p.isProjected)
      .sort((a, b) => a.timestamp - b.timestamp)

    const priceRows: (string | number)[][] = [
      ['Date', 'Hour', 'Minute', 'Price (ct/kWh)', 'Price (EUR/MWh)'],
    ]
    for (const p of filteredPrices) {
      priceRows.push([
        p.date,
        p.hour,
        p.minute,
        r2(p.priceCtKwh),
        r2(p.priceEurMwh),
      ])
    }
    priceDataRowCount = priceRows.length - 1 // excluding header
    const wsPrices = XLSX.utils.aoa_to_sheet(priceRows)
    wsPrices['!cols'] = [{ wch: 12 }, { wch: 6 }, { wch: 8 }, { wch: 16 }, { wch: 16 }]
    XLSX.utils.book_append_sheet(wb, wsPrices, 'Prices')
  }

  // ── Sheet 2: Profile Settings ──
  if (sheets.profile) {
    const profileRows: (string | number | string[])[][] = [
      ['Parameter', 'Value'],
      ['Generated', new Date().toISOString().slice(0, 19)],
      ['Country', country],
      ['Date Range', `Last ${dateRange} days`],
      ['Resolution', resolution === '15min' ? '15 minutes' : '60 minutes'],
      ['Mode', showFleet ? 'Fleet' : 'Single EV'],
      [],
    ]

    if (showFleet) {
      profileRows.push(
        ['Fleet Configuration', ''],
        ['Fleet Size', fleetConfig.fleetSize],
        ['Arrival Avg Hour', fleetConfig.arrivalAvg],
        ['Arrival Min Hour', fleetConfig.arrivalMin],
        ['Arrival Max Hour', fleetConfig.arrivalMax],
        ['Departure Avg Hour', fleetConfig.departureAvg],
        ['Departure Min Hour', fleetConfig.departureMin],
        ['Departure Max Hour', fleetConfig.departureMax],
        ['Yearly Mileage (km)', fleetConfig.yearlyMileageKm ?? 12000],
        ['Plug-ins per Week', fleetConfig.plugInsPerWeek ?? 3],
        ['Charge Power (kW)', fleetConfig.chargePowerKw],
        ['Spread Mode', fleetConfig.spreadMode],
        ['Energy per Session (kWh)', r1(energyPerSession)],
      )
    } else {
      const vehicle = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId)
      profileRows.push(
        ['Single EV Configuration', ''],
        ['Vehicle', `${vehicle?.label ?? scenario.vehicleId} (${vehicle?.battery_kwh ?? 60} kWh)`],
        ['Charge Power (kW)', scenario.chargePowerKw],
        ['Yearly Mileage (km)', scenario.yearlyMileageKm],
        ['Consumption (kWh/100km)', AVG_CONSUMPTION_KWH_PER_100KM],
        ['Energy per Session (kWh)', r1(energyPerSession)],
        ['Weekday Plug-ins', scenario.weekdayPlugIns],
        ['Weekend Plug-ins', scenario.weekendPlugIns],
        ['Plug-in Time', `${String(scenario.plugInTime).padStart(2, '0')}:00`],
        ['Departure Time', `${String(scenario.departureTime).padStart(2, '0')}:00`],
        ['Charging Mode', scenario.chargingMode],
        ['Start Level (%)', scenario.startLevel],
        ['Target Level (%)', scenario.targetLevel],
      )
    }

    const wsProfile = XLSX.utils.aoa_to_sheet(profileRows as (string | number)[][])
    wsProfile['!cols'] = [{ wch: 26 }, { wch: 40 }]
    XLSX.utils.book_append_sheet(wb, wsProfile, 'Profile')
  }

  // ── Sheet 3: Daily Sessions (with Excel formulas) ──
  // Energy per session cell reference in Profile sheet
  const energyCellRef = showFleet ? 'Profile!B20' : 'Profile!B13'

  if (sheets.daily) {
    const windows = overnightWindows
      .filter(w => !w.isProjected && w.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    // Header row (row 1)
    const dailyHeader = [
      'Date',           // A
      'Day',            // B
      'Window Start',   // C
      'Window End',     // D
      'Baseline Avg (ct/kWh)',   // E
      'Optimized Avg (ct/kWh)',  // F
      'Savings (ct/kWh)',        // G — formula
      'Savings (EUR)',           // H — formula
      'Energy (kWh)',            // I — from Profile
      'Window Spread (ct)',      // J
    ]

    const dailyRows: (string | number)[][] = [dailyHeader]

    for (let i = 0; i < windows.length; i++) {
      const w = windows[i]
      const d = new Date(w.date + 'T12:00:00Z')
      const dow = d.getUTCDay()
      const row = i + 2 // Excel row (1-indexed, header is row 1)

      dailyRows.push([
        w.date,
        dowNames[dow],
        `${String(scenario.plugInTime).padStart(2, '0')}:00`,
        `${String(scenario.departureTime).padStart(2, '0')}:00`,
        r2(w.bAvg),
        r2(w.oAvg),
        0, // placeholder — will be replaced by formula
        0, // placeholder — will be replaced by formula
        r1(energyPerSession),
        r2(w.spreadCt),
      ])
    }

    const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows)

    // Inject formulas for Savings columns
    for (let i = 0; i < windows.length; i++) {
      const row = i + 2
      // G: Savings (ct/kWh) = Baseline - Optimized
      wsDaily[`G${row}`] = { t: 'n', f: `E${row}-F${row}` }
      // H: Savings (EUR) = (Baseline - Optimized) * Energy / 100
      if (sheets.profile) {
        wsDaily[`H${row}`] = { t: 'n', f: `G${row}*${energyCellRef}/100` }
      } else {
        wsDaily[`H${row}`] = { t: 'n', f: `G${row}*I${row}/100` }
      }
    }

    wsDaily['!cols'] = [
      { wch: 12 }, { wch: 5 }, { wch: 14 }, { wch: 12 },
      { wch: 22 }, { wch: 24 }, { wch: 18 },
      { wch: 14 }, { wch: 12 }, { wch: 18 },
    ]
    XLSX.utils.book_append_sheet(wb, wsDaily, 'Daily Sessions')
  }

  // ── Sheet 4: Monthly Summary (with SUMIF/AVERAGEIF formulas) ──
  if (sheets.monthly && sheets.daily) {
    const windows = overnightWindows
      .filter(w => !w.isProjected && w.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    // Collect unique months
    const monthSet = new Set<string>()
    for (const w of windows) monthSet.add(w.month)
    const months = [...monthSet].sort()

    const dailyDataRows = windows.length
    const dailyDateRange = `'Daily Sessions'!A2:A${dailyDataRows + 1}`
    const dailyGRange = `'Daily Sessions'!G2:G${dailyDataRows + 1}`
    const dailyHRange = `'Daily Sessions'!H2:H${dailyDataRows + 1}`
    const dailyJRange = `'Daily Sessions'!J2:J${dailyDataRows + 1}`

    const monthlyHeader = [
      'Month',                    // A
      'Sessions',                 // B
      'Avg Spread (ct)',          // C
      'Avg Savings (ct/kWh)',     // D
      'Monthly Savings (EUR)',    // E
      'Cumulative (EUR)',         // F
    ]

    const monthlyRows: (string | number)[][] = [monthlyHeader]

    for (let i = 0; i < months.length; i++) {
      const month = months[i]
      const row = i + 2
      // Use month prefix match: "2025-01*"
      const criteria = `"${month}*"`

      monthlyRows.push([
        month,
        0, // placeholder for COUNTIF
        0, // placeholder for AVERAGEIF spread
        0, // placeholder for AVERAGEIF savings ct
        0, // placeholder for SUMIF savings EUR
        0, // placeholder for cumulative SUM
      ])
    }

    const wsMonthly = XLSX.utils.aoa_to_sheet(monthlyRows)

    // Inject formulas
    for (let i = 0; i < months.length; i++) {
      const row = i + 2
      const criteria = `A${row}&"*"`

      // B: Sessions count
      wsMonthly[`B${row}`] = { t: 'n', f: `COUNTIF(${dailyDateRange},${criteria})` }
      // C: Avg Spread
      wsMonthly[`C${row}`] = { t: 'n', f: `AVERAGEIF(${dailyDateRange},${criteria},${dailyJRange})` }
      // D: Avg Savings ct/kWh
      wsMonthly[`D${row}`] = { t: 'n', f: `AVERAGEIF(${dailyDateRange},${criteria},${dailyGRange})` }
      // E: Monthly Savings EUR
      wsMonthly[`E${row}`] = { t: 'n', f: `SUMIF(${dailyDateRange},${criteria},${dailyHRange})` }
      // F: Cumulative EUR — SUM of E2:E(current row)
      wsMonthly[`F${row}`] = { t: 'n', f: `SUM(E2:E${row})` }
    }

    // Total row
    const totalRow = months.length + 2
    monthlyRows.push(['TOTAL', 0, 0, 0, 0, 0])
    wsMonthly[`A${totalRow}`] = { t: 's', v: 'TOTAL' }
    wsMonthly[`B${totalRow}`] = { t: 'n', f: `SUM(B2:B${totalRow - 1})` }
    wsMonthly[`D${totalRow}`] = { t: 'n', f: `AVERAGE(D2:D${totalRow - 1})` }
    wsMonthly[`E${totalRow}`] = { t: 'n', f: `SUM(E2:E${totalRow - 1})` }

    wsMonthly['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 16 },
      { wch: 22 }, { wch: 22 }, { wch: 18 },
    ]
    XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly Summary')
  } else if (sheets.monthly && !sheets.daily) {
    // Fallback: monthly without formulas (no Daily Sessions to reference)
    const windows = overnightWindows
      .filter(w => !w.isProjected && w.date >= cutoffStr)
      .sort((a, b) => a.date.localeCompare(b.date))

    const monthMap = new Map<string, { sum: number; count: number; spreadSum: number; savingsCtSum: number }>()
    for (const w of windows) {
      const e = monthMap.get(w.month) || { sum: 0, count: 0, spreadSum: 0, savingsCtSum: 0 }
      e.sum += (w.bAvg - w.oAvg) * energyPerSession / 100
      e.spreadSum += w.spreadCt
      e.savingsCtSum += (w.bAvg - w.oAvg)
      e.count++
      monthMap.set(w.month, e)
    }

    const monthlyRows: (string | number)[][] = [
      ['Month', 'Sessions', 'Avg Spread (ct)', 'Avg Savings (ct/kWh)', 'Monthly Savings (EUR)', 'Cumulative (EUR)'],
    ]
    let cumulative = 0
    for (const [month, d] of [...monthMap.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      cumulative += d.sum
      monthlyRows.push([
        month, d.count,
        r2(d.spreadSum / d.count),
        r2(d.savingsCtSum / d.count),
        r2(d.sum),
        r2(cumulative),
      ])
    }

    const wsMonthly = XLSX.utils.aoa_to_sheet(monthlyRows)
    wsMonthly['!cols'] = [
      { wch: 10 }, { wch: 10 }, { wch: 16 },
      { wch: 22 }, { wch: 22 }, { wch: 18 },
    ]
    XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly Summary')
  }

  // ── Download ──
  const mode = showFleet ? 'fleet' : 'single'
  XLSX.writeFile(wb, `flex-export-${mode}-${country}-${dateRange}d-${new Date().toISOString().slice(0, 10)}.xlsx`)
}
