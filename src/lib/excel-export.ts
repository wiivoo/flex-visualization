/**
 * Excel export for full-year session breakdown.
 * Generates a multi-sheet .xlsx with scenario, statistics, monthly summary, and daily breakdown.
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
  const windows = overnightWindows
    .filter(w => !w.isProjected && w.date >= cutoffStr)
    .sort((a, b) => b.date.localeCompare(a.date))
  const weekdayScale = scenario.weekdayPlugIns / 5
  const weekendScale = scenario.weekendPlugIns / 2

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
    ['Sessions per Year', sessionsPerYear],
    ['Charging Duration', `${chargingHours}h per session`],
    ['Charging Window', `${String(scenario.plugInTime).padStart(2, '0')}:00 — ${String(scenario.departureTime).padStart(2, '0')}:00`],
    ['Charging Mode', scenario.chargingMode],
    ['Start Level', `${scenario.startLevel}%`],
    ['Target Level', `${scenario.targetLevel}%`],
    [],
    ['Data Coverage'],
    ['Total Days', windows.length],
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

  // Compute scaled yearly savings
  let totalYearlySavings = 0
  const monthMap = new Map<string, { wdSum: number; wdN: number; weSum: number; weN: number; minSpread: number; maxSpread: number; spreadSum: number; count: number; bAvgSum: number; oAvgSum: number }>()
  for (const w of windows) {
    const e = monthMap.get(w.month) || { wdSum: 0, wdN: 0, weSum: 0, weN: 0, minSpread: Infinity, maxSpread: -Infinity, spreadSum: 0, count: 0, bAvgSum: 0, oAvgSum: 0 }
    if (w.isWeekend) { e.weSum += w.savingsEur; e.weN++ }
    else { e.wdSum += w.savingsEur; e.wdN++ }
    e.minSpread = Math.min(e.minSpread, w.spreadCt)
    e.maxSpread = Math.max(e.maxSpread, w.spreadCt)
    e.spreadSum += w.spreadCt
    e.bAvgSum += w.bAvg
    e.oAvgSum += w.oAvg
    e.count++
    monthMap.set(w.month, e)
  }
  for (const [, d] of monthMap) {
    const wdAvg = d.wdN > 0 ? d.wdSum / d.wdN : 0
    const weAvg = d.weN > 0 ? d.weSum / d.weN : 0
    totalYearlySavings += wdAvg * weekdayScale * 21.74 + weAvg * weekendScale * 8.70
  }

  const statsData = [
    ['Flex Visualization — Yearly Statistics'],
    [],
    ['Metric', 'Value', 'Unit'],
    ['Scaled Yearly Savings', r2(totalYearlySavings), 'EUR'],
    ['Avg Raw Daily Savings', r4(avgSavings), 'EUR'],
    ['Median Raw Daily Savings', r4(medianSavings), 'EUR'],
    ['Std Dev Daily Savings', r4(stdDev), 'EUR'],
    ['P10 Daily Savings', r4(p10), 'EUR'],
    ['P25 Daily Savings', r4(p25), 'EUR'],
    ['P75 Daily Savings', r4(p75), 'EUR'],
    ['P90 Daily Savings', r4(p90), 'EUR'],
    ['Min Daily Savings', r4(Math.min(...allSavings)), 'EUR'],
    ['Max Daily Savings', r4(Math.max(...allSavings)), 'EUR'],
    [],
    ['Avg Baseline Price', r2(allBAvg.reduce((s, v) => s + v, 0) / allBAvg.length), 'ct/kWh'],
    ['Avg Optimized Price', r2(allOAvg.reduce((s, v) => s + v, 0) / allOAvg.length), 'ct/kWh'],
    ['Avg Spread', r2(avgSpread), 'ct/kWh'],
    ['Min Spread', r2(Math.min(...allSpreads)), 'ct/kWh'],
    ['Max Spread', r2(Math.max(...allSpreads)), 'ct/kWh'],
    [],
    ['Days with Data', windows.length, ''],
    ['Days with Negative Savings', negativeDays, ''],
    ['Days with Zero Savings', zeroDays, ''],
    ['Date Range', `${windows[windows.length - 1].date} to ${windows[0].date}`, ''],
  ]
  const wsStats = XLSX.utils.aoa_to_sheet(statsData)
  wsStats['!cols'] = [{ wch: 28 }, { wch: 18 }, { wch: 10 }]
  XLSX.utils.book_append_sheet(wb, wsStats, 'Statistics')

  // ── Sheet 3: Monthly Summary ──
  const monthlyRows: (string | number)[][] = [
    ['Flex Visualization — Monthly Summary'],
    [],
    ['Month', 'Scaled Savings (EUR)', 'Avg Daily Savings (EUR)', 'Sessions/Month',
     'Avg Baseline (ct/kWh)', 'Avg Optimized (ct/kWh)',
     'Avg Spread (ct/kWh)', 'Min Spread (ct/kWh)', 'Max Spread (ct/kWh)',
     'Weekdays', 'Weekend Days', 'Total Days'],
  ]
  const sortedMonths = [...monthMap.entries()].sort(([a], [b]) => b.localeCompare(a))
  for (const [month, d] of sortedMonths) {
    const wdAvg = d.wdN > 0 ? d.wdSum / d.wdN : 0
    const weAvg = d.weN > 0 ? d.weSum / d.weN : 0
    const monthlySav = wdAvg * weekdayScale * 21.74 + weAvg * weekendScale * 8.70
    const avgDaily = d.count > 0 ? (d.wdSum + d.weSum) / d.count : 0
    const avgSpr = d.count > 0 ? d.spreadSum / d.count : 0
    const sessionsMonth = Math.round(weeklyPlugIns * 4.35)
    monthlyRows.push([
      month,
      r2(monthlySav),
      r4(avgDaily),
      sessionsMonth,
      r2(d.bAvgSum / d.count),
      r2(d.oAvgSum / d.count),
      r2(avgSpr),
      d.minSpread === Infinity ? '' : r2(d.minSpread),
      d.maxSpread === -Infinity ? '' : r2(d.maxSpread),
      d.wdN,
      d.weN,
      d.count,
    ])
  }
  // Totals row
  monthlyRows.push([])
  monthlyRows.push(['TOTAL', r2(totalYearlySavings), '', sessionsPerYear, '', '', '', '', '', '', '', windows.length])

  const wsMonthly = XLSX.utils.aoa_to_sheet(monthlyRows)
  wsMonthly['!cols'] = [
    { wch: 10 }, { wch: 20 }, { wch: 22 }, { wch: 15 },
    { wch: 20 }, { wch: 22 },
    { wch: 18 }, { wch: 18 }, { wch: 18 },
    { wch: 10 }, { wch: 14 }, { wch: 12 },
  ]
  XLSX.utils.book_append_sheet(wb, wsMonthly, 'Monthly')

  // ── Sheet 4: Daily Session Breakdown ──
  const windowHours: number[] = []
  if (scenario.plugInTime > scenario.departureTime) {
    for (let h = scenario.plugInTime; h < 24; h++) windowHours.push(h)
    for (let h = 0; h < scenario.departureTime; h++) windowHours.push(h)
  } else {
    for (let h = scenario.plugInTime; h < scenario.departureTime; h++) windowHours.push(h)
  }
  const hourHeaders = windowHours.map(h => `H${String(h).padStart(2, '0')} (ct/kWh)`)

  const dailyRows: (string | number)[][] = [
    ['Flex Visualization — Daily Session Breakdown'],
    [],
    [
      'Date', 'DOW', 'Weekend', 'Window Slots',
      'Baseline Avg (ct/kWh)', 'Optimized Avg (ct/kWh)', 'Spread (ct/kWh)',
      'Savings (EUR)', 'Min Price (ct/kWh)', 'Max Price (ct/kWh)',
      'Cheapest Hour', 'Most Expensive Hour',
      ...hourHeaders,
    ],
  ]
  const dowNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

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
      w.isWeekend ? 'Y' : 'N',
      w.prices.length,
      r2(w.bAvg),
      r2(w.oAvg),
      r2(w.spreadCt),
      r4(w.savingsEur),
      cheapest ? r2(cheapest.priceCtKwh) : '',
      expensive ? r2(expensive.priceCtKwh) : '',
      cheapest ? `${String(cheapest.hour).padStart(2, '0')}:00` : '',
      expensive ? `${String(expensive.hour).padStart(2, '0')}:00` : '',
      ...hourValues,
    ])
  }

  const wsDaily = XLSX.utils.aoa_to_sheet(dailyRows)
  const dailyCols = [
    { wch: 12 }, { wch: 5 }, { wch: 8 }, { wch: 12 },
    { wch: 20 }, { wch: 22 }, { wch: 16 },
    { wch: 14 }, { wch: 16 }, { wch: 16 },
    { wch: 14 }, { wch: 18 },
    ...windowHours.map(() => ({ wch: 14 })),
  ]
  wsDaily['!cols'] = dailyCols
  XLSX.utils.book_append_sheet(wb, wsDaily, 'Sessions')

  // ── Download ──
  XLSX.writeFile(wb, `flex-sessions-${country}-${new Date().toISOString().slice(0, 10)}.xlsx`)
}

function r2(n: number): number { return Math.round(n * 100) / 100 }
function r4(n: number): number { return Math.round(n * 10000) / 10000 }
