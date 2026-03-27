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
