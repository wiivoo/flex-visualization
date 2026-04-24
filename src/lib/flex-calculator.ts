import { addDaysStr, buildMultiDayWindow, computeSpread, computeWindowSavings } from '@/lib/charging-helpers'
import { deriveEnergyPerSession, type ChargingScenario, type HourlyPrice } from '@/lib/v2-config'

export type CalculatorMode = ChargingScenario['chargingMode']

export interface FlexCalculatorScenario {
  yearlyMileageKm: number
  plugInsPerWeek: number
  plugInTime: number
  departureTime: number
  chargePowerKw: number
  chargingMode: CalculatorMode
}

export interface FlexCalculatorResult {
  annualSavingsEur: number
  baselineAnnualCostEur: number
  optimizedAnnualCostEur: number
  savingsPct: number
  avgSavingsPerSessionEur: number
  energyPerSessionKwh: number
  sessionsPerYear: number
  shiftedEnergyPerYearKwh: number
  avgBaselinePriceCtKwh: number
  avgOptimizedPriceCtKwh: number
  avgMarketSpreadCtKwh: number
  avgCapturedSpreadCtKwh: number
  sampleDays: number
  sampleStart: string
  sampleEnd: string
  selectedYear: number
  bestMonth: { month: string; avgSavingsPerSessionEur: number } | null
  slotMinutes: number
}

export interface FlexSessionValueResult {
  savingsPerSessionEur: number
  baselineCostEur: number
  optimizedCostEur: number
  baselineAvgCtKwh: number
  optimizedAvgCtKwh: number
  marketSpreadCtKwh: number
  capturedSpreadCtKwh: number
  energyPerSessionKwh: number
  slotMinutes: number
  startDate: string
  endDate: string
}

function round(value: number, digits = 2): number {
  const factor = 10 ** digits
  return Math.round(value * factor) / factor
}

function modeWindowDays(mode: CalculatorMode): number {
  if (mode === 'threeday') return 3
  if (mode === 'fullday') return 1
  return 1
}

function resolveSlotMinutes(hourlyPrices: HourlyPrice[], slotMinutes?: number): number {
  if (slotMinutes) return slotMinutes
  const uniqueMinutes = [...new Set(hourlyPrices.map((point) => point.minute))].sort((a, b) => a - b)
  if (uniqueMinutes.length <= 1) return 60
  const deltas: number[] = []
  for (let index = 1; index < uniqueMinutes.length; index += 1) {
    deltas.push(uniqueMinutes[index] - uniqueMinutes[index - 1])
  }
  return deltas[0] || 60
}

function relevantHourlyPrices(hourlyPrices: HourlyPrice[], selectedYear: number, lastRealDate?: string): HourlyPrice[] {
  return hourlyPrices.filter((point) => {
    if (point.date.slice(0, 4) !== String(selectedYear)) return false
    if (lastRealDate && point.date > lastRealDate) return false
    if (point.isProjected) return false
    return true
  })
}

export function getAvailableCalculatorYears(hourlyPrices: HourlyPrice[], lastRealDate?: string): number[] {
  const years = new Set<number>()
  for (const point of hourlyPrices) {
    if (point.isProjected) continue
    if (lastRealDate && point.date > lastRealDate) continue
    years.add(Number(point.date.slice(0, 4)))
  }
  return [...years].sort((a, b) => b - a)
}

export function estimateFlexValue(
  hourlyPrices: HourlyPrice[],
  scenario: FlexCalculatorScenario,
  selectedYear: number,
  lastRealDate?: string,
  slotMinutes?: number,
): FlexCalculatorResult | null {
  const yearPrices = relevantHourlyPrices(hourlyPrices, selectedYear, lastRealDate)
  if (yearPrices.length === 0) return null

  const priceByDate = new Map<string, HourlyPrice[]>()
  for (const point of yearPrices) {
    const existing = priceByDate.get(point.date)
    if (existing) existing.push(point)
    else priceByDate.set(point.date, [point])
  }

  const availableDates = [...priceByDate.keys()].sort()
  if (availableDates.length === 0) return null

  const energyPerSessionKwh = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.plugInsPerWeek, 0)
  const sessionsPerYear = scenario.plugInsPerWeek * 52
  const shiftedEnergyPerYearKwh = round(energyPerSessionKwh * sessionsPerYear, 1)
  const resolvedSlotMinutes = resolveSlotMinutes(yearPrices, slotMinutes)
  const slotHours = resolvedSlotMinutes / 60
  const kwhPerSlot = scenario.chargePowerKw * slotHours
  const minSlotsNeeded = Math.ceil(energyPerSessionKwh / kwhPerSlot)
  const daysForward = modeWindowDays(scenario.chargingMode)

  let totalSavings = 0
  let totalBaselinePrice = 0
  let totalOptimizedPrice = 0
  let totalMarketSpread = 0
  let totalCapturedSpread = 0
  let sampleDays = 0
  const monthly = new Map<string, { total: number; count: number }>()

  for (const date of availableDates) {
    const endDate = addDaysStr(date, daysForward)
    const windowPrices = buildMultiDayWindow(
      yearPrices,
      date,
      endDate,
      scenario.plugInTime,
      scenario.departureTime,
    ).sort((a, b) => a.timestamp - b.timestamp)

    if (windowPrices.length < minSlotsNeeded) continue

    const window = computeWindowSavings(windowPrices, energyPerSessionKwh, kwhPerSlot, 1)
    const spread = computeSpread(windowPrices, energyPerSessionKwh, scenario.chargePowerKw, 1, kwhPerSlot)
    if (!spread) continue

    sampleDays += 1
    totalSavings += window.savingsEur
    totalBaselinePrice += window.bAvg
    totalOptimizedPrice += window.oAvg
    totalMarketSpread += spread.marketSpreadCtKwh
    totalCapturedSpread += spread.capturableSavingsCtKwh

    const month = date.slice(0, 7)
    const existing = monthly.get(month) ?? { total: 0, count: 0 }
    existing.total += window.savingsEur
    existing.count += 1
    monthly.set(month, existing)
  }

  if (sampleDays === 0) return null

  const avgSavingsPerSessionEur = totalSavings / sampleDays
  const avgBaselinePriceCtKwh = totalBaselinePrice / sampleDays
  const avgOptimizedPriceCtKwh = totalOptimizedPrice / sampleDays
  const baselineAnnualCostEur = avgBaselinePriceCtKwh * shiftedEnergyPerYearKwh / 100
  const optimizedAnnualCostEur = avgOptimizedPriceCtKwh * shiftedEnergyPerYearKwh / 100
  const annualSavingsEur = avgSavingsPerSessionEur * sessionsPerYear
  const savingsPct = baselineAnnualCostEur > 0
    ? ((baselineAnnualCostEur - optimizedAnnualCostEur) / baselineAnnualCostEur) * 100
    : 0

  let bestMonth: FlexCalculatorResult['bestMonth'] = null
  for (const [month, stats] of monthly) {
    const avg = stats.total / stats.count
    if (!bestMonth || avg > bestMonth.avgSavingsPerSessionEur) {
      bestMonth = { month, avgSavingsPerSessionEur: round(avg) }
    }
  }

  return {
    annualSavingsEur: round(annualSavingsEur),
    baselineAnnualCostEur: round(baselineAnnualCostEur),
    optimizedAnnualCostEur: round(optimizedAnnualCostEur),
    savingsPct: round(savingsPct, 1),
    avgSavingsPerSessionEur: round(avgSavingsPerSessionEur),
    energyPerSessionKwh: round(energyPerSessionKwh, 1),
    sessionsPerYear,
    shiftedEnergyPerYearKwh,
    avgBaselinePriceCtKwh: round(avgBaselinePriceCtKwh),
    avgOptimizedPriceCtKwh: round(avgOptimizedPriceCtKwh),
    avgMarketSpreadCtKwh: round(totalMarketSpread / sampleDays),
    avgCapturedSpreadCtKwh: round(totalCapturedSpread / sampleDays),
    sampleDays,
    sampleStart: availableDates[0],
    sampleEnd: availableDates[availableDates.length - 1],
    selectedYear,
    bestMonth,
    slotMinutes: resolvedSlotMinutes,
  }
}

export function estimateFlexSessionValue(
  hourlyPrices: HourlyPrice[],
  scenario: FlexCalculatorScenario,
  startDate: string,
  slotMinutes?: number,
): FlexSessionValueResult | null {
  if (!startDate) return null
  const resolvedSlotMinutes = resolveSlotMinutes(hourlyPrices, slotMinutes)
  const slotHours = resolvedSlotMinutes / 60
  const energyPerSessionKwh = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.plugInsPerWeek, 0)
  const kwhPerSlot = scenario.chargePowerKw * slotHours
  const minSlotsNeeded = Math.ceil(energyPerSessionKwh / kwhPerSlot)
  const endDate = addDaysStr(startDate, modeWindowDays(scenario.chargingMode))
  const windowPrices = buildMultiDayWindow(
    hourlyPrices,
    startDate,
    endDate,
    scenario.plugInTime,
    scenario.departureTime,
  ).sort((a, b) => a.timestamp - b.timestamp)

  if (windowPrices.length < minSlotsNeeded) return null

  const window = computeWindowSavings(windowPrices, energyPerSessionKwh, kwhPerSlot, 1)
  const spread = computeSpread(windowPrices, energyPerSessionKwh, scenario.chargePowerKw, 1, kwhPerSlot)
  if (!spread) return null

  return {
    savingsPerSessionEur: round(window.savingsEur),
    baselineCostEur: round(window.bAvg * energyPerSessionKwh / 100),
    optimizedCostEur: round(window.oAvg * energyPerSessionKwh / 100),
    baselineAvgCtKwh: round(window.bAvg),
    optimizedAvgCtKwh: round(window.oAvg),
    marketSpreadCtKwh: round(spread.marketSpreadCtKwh),
    capturedSpreadCtKwh: round(spread.capturableSavingsCtKwh),
    energyPerSessionKwh: round(energyPerSessionKwh, 1),
    slotMinutes: resolvedSlotMinutes,
    startDate,
    endDate,
  }
}
