/**
 * NL Dynamic Tariff Calculation Engine
 *
 * Dutch electricity market structure:
 *   endPrice = (EPEX_spot + energiebelasting + supplier_margin) × (1 + BTW)
 *
 * Key differences from Germany:
 *   - Only 1 surcharge (energiebelasting) vs. 6+ in DE
 *   - BTW is 21% (vs. 19% MwSt in DE)
 *   - Grid fees are capacity-based (monthly fixed), NOT per-kWh
 *   - Uses NEDU E1A load profile (verbruiksprofiel) for shaped consumption
 *
 * Verified against Frank Energie API data:
 *   allInPrice ≈ EPEX_spot × 1.21 + 13.41 ct/kWh (constant portion)
 *   where constant = energiebelasting × 1.21
 */
import type { HourlyPrice } from '@/lib/v2-config'
import { getNlDayType, getNlHourlyWeights, type NlLoadProfile } from '@/lib/nl-slp'

/** NL surcharge components in ct/kWh (before BTW) */
export interface NlSurcharges {
  energiebelasting: number   // Energiebelasting (incl. ODE since 2023)
  margin: number             // Supplier margin/markup
}

/** 2025 default values (ct/kWh, excl. BTW) */
export const NL_DEFAULT_SURCHARGES: NlSurcharges = {
  energiebelasting: 9.978,    // 2025
  margin: 0,                  // Most NL dynamic tariffs charge monthly fee, not margin
}

/** 2026 values */
export const NL_SURCHARGES_2026: NlSurcharges = {
  energiebelasting: 11.085,   // 2026
  margin: 0,
}

export function nlSurchargesForYear(year: number): NlSurcharges {
  if (year >= 2026) return { ...NL_SURCHARGES_2026 }
  return { ...NL_DEFAULT_SURCHARGES }
}

export const NL_BTW_RATE = 21 // percent

/** Total surcharges before BTW */
export function nlTotalSurchargesExBtw(s: NlSurcharges): number {
  return s.energiebelasting + s.margin
}

/** End-customer gross price for a given spot price (ct/kWh) */
export function nlEndCustomerPrice(spotCtKwh: number, surcharges: NlSurcharges): number {
  return (spotCtKwh + nlTotalSurchargesExBtw(surcharges)) * (1 + NL_BTW_RATE / 100)
}

/** NL DSO grid fee tariffs (capacity-based, monthly EUR, 2025 ACM-approved) */
export interface NlDsoTariff {
  name: string
  code: string
  provinces: string[]
  monthlyGridFee1x25A: number   // 1-phase 25A (small apartment)
  monthlyGridFee3x25A: number   // 3-phase 25A (typical household)
  monthlyGridFee3x35A: number   // 3-phase 35A (with EV/heat pump)
}

export const NL_DSO_TARIFFS: NlDsoTariff[] = [
  {
    name: 'Liander',
    code: 'LIANDER',
    provinces: ['Noord-Holland', 'Gelderland', 'Flevoland'],
    monthlyGridFee1x25A: 19.87,
    monthlyGridFee3x25A: 27.43,
    monthlyGridFee3x35A: 34.12,
  },
  {
    name: 'Stedin',
    code: 'STEDIN',
    provinces: ['Zuid-Holland', 'Utrecht', 'Zeeland'],
    monthlyGridFee1x25A: 18.54,
    monthlyGridFee3x25A: 25.89,
    monthlyGridFee3x35A: 32.45,
  },
  {
    name: 'Enexis',
    code: 'ENEXIS',
    provinces: ['Noord-Brabant', 'Limburg', 'Groningen', 'Drenthe', 'Overijssel'],
    monthlyGridFee1x25A: 17.95,
    monthlyGridFee3x25A: 24.67,
    monthlyGridFee3x35A: 30.89,
  },
]

/** Map province to DSO */
export function nlProvinceToDso(province: string): NlDsoTariff | null {
  const normalized = province.trim()
  return NL_DSO_TARIFFS.find(d =>
    d.provinces.some(p => p.toLowerCase() === normalized.toLowerCase())
  ) ?? null
}

/** Known NL dynamic tariff providers (hardcoded reference prices) */
export interface NlCompetitorTariff {
  name: string
  type: 'dynamic' | 'fixed'
  monthlyFeeEur: number       // Monthly subscription/standing charge
  marginCtKwh: number         // Per-kWh markup over spot (before BTW)
  fixedCtKwh: number | null   // Only for fixed tariffs
  isGreen: boolean
  source: string
}

export const NL_DYNAMIC_COMPETITORS: NlCompetitorTariff[] = [
  { name: 'Tibber', type: 'dynamic', monthlyFeeEur: 5.99, marginCtKwh: 0, fixedCtKwh: null, isGreen: true, source: 'website' },
  { name: 'Frank Energie', type: 'dynamic', monthlyFeeEur: 4.95, marginCtKwh: 0, fixedCtKwh: null, isGreen: true, source: 'api' },
  { name: 'EasyEnergy', type: 'dynamic', monthlyFeeEur: 0, marginCtKwh: 0.45, fixedCtKwh: null, isGreen: false, source: 'api' },
  { name: 'ANWB Energie', type: 'dynamic', monthlyFeeEur: 4.95, marginCtKwh: 0, fixedCtKwh: null, isGreen: true, source: 'website' },
  { name: 'Eneco Dynamisch', type: 'dynamic', monthlyFeeEur: 0, marginCtKwh: 3.5, fixedCtKwh: null, isGreen: true, source: 'estimate' },
]

/** Reference fixed tariffs for comparison */
export const NL_FIXED_COMPETITORS: NlCompetitorTariff[] = [
  { name: 'Essent Stroom Vast', type: 'fixed', monthlyFeeEur: 7.99, marginCtKwh: 0, fixedCtKwh: 32, isGreen: false, source: 'estimate' },
  { name: 'Vattenfall Vast', type: 'fixed', monthlyFeeEur: 6.99, marginCtKwh: 0, fixedCtKwh: 30, isGreen: false, source: 'estimate' },
  { name: 'Budget Energie Vast', type: 'fixed', monthlyFeeEur: 5.49, marginCtKwh: 0, fixedCtKwh: 29, isGreen: false, source: 'estimate' },
]

// ──────── Yearly cost calculation (flat profile for NL) ────────

export interface NlDailyResult {
  date: string
  month: string
  dynamicCostEur: number
  fixedCostEur: number
  consumptionKwh: number
  avgSpotCtKwh: number
  avgEndPriceCtKwh: number
  hoursWithData: number
  hoursTotal: number
}

export interface NlMonthlyResult {
  month: string
  label: string
  year: number
  dynamicCostEur: number
  fixedCostEur: number
  consumptionKwh: number
  avgSpotCtKwh: number
  avgEndPriceCtKwh: number
  daysWithData: number
}

export interface NlYearlyCostResult {
  totalDynamicCostEur: number
  totalFixedCostEur: number
  savingsEur: number
  avgEffectivePriceCtKwh: number
  totalKwhConsumed: number
  monthlyBreakdown: NlMonthlyResult[]
  dailyBreakdown: NlDailyResult[]
  daysWithData: number
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Calculate yearly cost using NL dynamic tariff vs. fixed tariff.
 *
 * When useProfile is true, uses NEDU E1A load profile weights.
 * Otherwise uses flat consumption (equal across all hours).
 */
export function nlCalculateYearlyCost(
  yearlyKwh: number,
  hourlyPrices: HourlyPrice[],
  surcharges: NlSurcharges,
  fixedPriceCtKwh: number,
  year: number,
  useProfile: boolean = true,
  profile: NlLoadProfile = 'E1A',
): NlYearlyCostResult {
  const flatHourlyKwh = yearlyKwh / 8760 // flat profile fallback

  // Group prices by date
  const byDate = new Map<string, HourlyPrice[]>()
  for (const p of hourlyPrices) {
    if (!p.date.startsWith(String(year))) continue
    const existing = byDate.get(p.date)
    if (existing) existing.push(p)
    else byDate.set(p.date, [p])
  }

  const dailyResults: NlDailyResult[] = []
  const monthlyMap = new Map<string, {
    dynamicCostEur: number; fixedCostEur: number; consumptionKwh: number
    spotSum: number; endPriceSum: number; hoursTotal: number; days: number
  }>()

  for (const [dateStr, prices] of byDate) {
    const month = dateStr.slice(0, 7)
    const monthNum = parseInt(dateStr.slice(5, 7))
    const dayType = getNlDayType(dateStr)
    const profileWeights = useProfile ? getNlHourlyWeights(monthNum, dayType, profile) : null

    const priceByHour = new Map<number, number>()
    for (const p of prices) {
      if (!priceByHour.has(p.hour)) priceByHour.set(p.hour, p.priceCtKwh)
    }

    let dayCostDynamic = 0
    let dayCostFixed = 0
    let dayConsumption = 0
    let daySpotSum = 0
    let dayEndPriceSum = 0
    let dayHours = 0

    for (let h = 0; h < 24; h++) {
      const spotPrice = priceByHour.get(h)
      if (spotPrice === undefined) continue

      const hourlyKwh = profileWeights
        ? flatHourlyKwh * profileWeights[h]
        : flatHourlyKwh
      const grossPrice = nlEndCustomerPrice(spotPrice, surcharges)
      dayCostDynamic += hourlyKwh * grossPrice / 100
      dayCostFixed += hourlyKwh * fixedPriceCtKwh / 100
      dayConsumption += hourlyKwh
      daySpotSum += spotPrice
      dayEndPriceSum += grossPrice
      dayHours++
    }

    dailyResults.push({
      date: dateStr,
      month,
      dynamicCostEur: dayCostDynamic,
      fixedCostEur: dayCostFixed,
      consumptionKwh: dayConsumption,
      avgSpotCtKwh: dayHours > 0 ? daySpotSum / dayHours : 0,
      avgEndPriceCtKwh: dayConsumption > 0 ? (dayCostDynamic / dayConsumption) * 100 : 0,
      hoursWithData: dayHours,
      hoursTotal: 24,
    })

    const me = monthlyMap.get(month) || {
      dynamicCostEur: 0, fixedCostEur: 0, consumptionKwh: 0,
      spotSum: 0, endPriceSum: 0, hoursTotal: 0, days: 0,
    }
    me.dynamicCostEur += dayCostDynamic
    me.fixedCostEur += dayCostFixed
    me.consumptionKwh += dayConsumption
    me.spotSum += daySpotSum
    me.endPriceSum += dayEndPriceSum
    me.hoursTotal += dayHours
    me.days++
    monthlyMap.set(month, me)
  }

  const monthlyBreakdown: NlMonthlyResult[] = [...monthlyMap.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, d]) => ({
      month,
      label: MONTH_LABELS[parseInt(month.slice(5)) - 1],
      year: parseInt(month.slice(0, 4)),
      dynamicCostEur: d.dynamicCostEur,
      fixedCostEur: d.fixedCostEur,
      consumptionKwh: d.consumptionKwh,
      avgSpotCtKwh: d.hoursTotal > 0 ? d.spotSum / d.hoursTotal : 0,
      avgEndPriceCtKwh: d.consumptionKwh > 0 ? (d.dynamicCostEur / d.consumptionKwh) * 100 : 0,
      daysWithData: d.days,
    }))

  const totalDynamic = dailyResults.reduce((s, d) => s + d.dynamicCostEur, 0)
  const totalFixed = dailyResults.reduce((s, d) => s + d.fixedCostEur, 0)
  const totalKwh = dailyResults.reduce((s, d) => s + d.consumptionKwh, 0)

  return {
    totalDynamicCostEur: totalDynamic,
    totalFixedCostEur: totalFixed,
    savingsEur: totalFixed - totalDynamic,
    avgEffectivePriceCtKwh: totalKwh > 0 ? (totalDynamic / totalKwh) * 100 : 0,
    totalKwhConsumed: totalKwh,
    monthlyBreakdown,
    dailyBreakdown: dailyResults.sort((a, b) => b.date.localeCompare(a.date)),
    daysWithData: dailyResults.length,
  }
}

/** Chart data for a specific date */
export interface NlChartDataPoint {
  hour: number
  minute: number
  label: string
  spotCtKwh: number
  endPriceCtKwh: number
  consumptionKwh: number
  costCent: number
  isProjected?: boolean
}

/** Get end-customer prices for a specific date (for chart display) */
export function nlGetDailyEndPrices(
  prices: HourlyPrice[],
  dateStr: string,
  surcharges: NlSurcharges,
  yearlyKwh: number,
  isQH: boolean = false,
  useProfile: boolean = true,
  profile: NlLoadProfile = 'E1A',
): NlChartDataPoint[] {
  const flatHourlyKwh = yearlyKwh / 8760
  const monthNum = parseInt(dateStr.slice(5, 7))
  const dayType = getNlDayType(dateStr)
  const profileWeights = useProfile ? getNlHourlyWeights(monthNum, dayType, profile) : null

  const dayPrices = prices.filter(p => p.date === dateStr)

  const projectedSlots = new Set<string>()
  for (const p of dayPrices) {
    if (p.isProjected) projectedSlots.add(`${p.hour}:${p.minute ?? 0}`)
  }

  if (isQH) {
    const priceBySlot = new Map<string, number>()
    for (const p of dayPrices) {
      const key = `${p.hour}:${p.minute ?? 0}`
      if (!priceBySlot.has(key)) priceBySlot.set(key, p.priceCtKwh)
    }

    const result: NlChartDataPoint[] = []
    for (let q = 0; q < 96; q++) {
      const h = Math.floor(q / 4)
      const m = (q % 4) * 15
      const key = `${h}:${m}`
      const spotPrice = priceBySlot.get(key) ?? priceBySlot.get(`${h}:0`)
      if (spotPrice === undefined) continue
      const endPrice = nlEndCustomerPrice(spotPrice, surcharges)
      const qhKwh = profileWeights
        ? flatHourlyKwh * profileWeights[h] / 4
        : flatHourlyKwh / 4
      result.push({
        hour: h, minute: m,
        label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        spotCtKwh: Math.round(spotPrice * 100) / 100,
        endPriceCtKwh: Math.round(endPrice * 100) / 100,
        consumptionKwh: Math.round(qhKwh * 10000) / 10000,
        costCent: Math.round(qhKwh * endPrice * 100) / 100,
        isProjected: projectedSlots.has(key) || projectedSlots.has(`${h}:0`),
      })
    }
    return result
  }

  // Hourly
  const priceByHour = new Map<number, number>()
  for (const p of dayPrices) {
    if (!priceByHour.has(p.hour)) priceByHour.set(p.hour, p.priceCtKwh)
  }

  const result: NlChartDataPoint[] = []
  for (let h = 0; h < 24; h++) {
    const spotPrice = priceByHour.get(h)
    if (spotPrice === undefined) continue
    const endPrice = nlEndCustomerPrice(spotPrice, surcharges)
    const hourlyKwh = profileWeights
      ? flatHourlyKwh * profileWeights[h]
      : flatHourlyKwh
    result.push({
      hour: h, minute: 0,
      label: `${String(h).padStart(2, '0')}:00`,
      spotCtKwh: Math.round(spotPrice * 100) / 100,
      endPriceCtKwh: Math.round(endPrice * 100) / 100,
      consumptionKwh: Math.round(hourlyKwh * 10000) / 10000,
      costCent: Math.round(hourlyKwh * endPrice * 100) / 100,
      isProjected: projectedSlots.has(`${h}:0`),
    })
  }
  return result
}
