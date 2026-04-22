/**
 * Dynamic tariff calculation engine.
 *
 * Calculates end-customer electricity cost using spot prices + surcharges,
 * weighted by the BDEW H25 Standard Load Profile, and compares to a fixed tariff.
 */
import type { HourlyPrice } from '@/lib/v2-config'
import { getDayType, getHourlySlpWeights, getQHSlpWeights, getProfileHourlyWeights, getProfileQHWeights, type LoadProfile } from '@/lib/slp-h25'

/** All surcharge components in ct/kWh (netto, before VAT) */
export interface Surcharges {
  gridFee: number           // Netzentgelte
  stromsteuer: number       // Stromsteuer (fixed by law)
  konzessionsabgabe: number // Konzessionsabgabe
  kwkg: number              // KWKG-Umlage
  offshore: number          // Offshore-Netzumlage
  par19: number             // §19 StromNEV-Umlage
  margin: number            // Supplier margin
}

/**
 * 2025 default values (ct/kWh netto)
 *
 * Sources: BNetzA, netztransparenz.de, ISPEX
 * Margin: Tibber charges 2.15 ct "weitere Beschaffungskosten" (green certs + procurement)
 *
 * Note: NOT included in per-kWh surcharges (billed separately as monthly fixed fees):
 *   - Messstellenbetrieb (smart meter): ~2-3 EUR/mo, passed through by Tibber
 *   - Netzentgelt Grundpreis (grid fixed fee): ~5-9 EUR/mo, set by regional DSO
 *   These apply to both dynamic and fixed tariffs, so they cancel out in savings comparisons
 *   unless the fixed tariff embeds them differently in its Grundpreis.
 */
export const DEFAULT_SURCHARGES: Surcharges = {
  gridFee: 10.95,
  stromsteuer: 2.05,
  konzessionsabgabe: 1.66,
  kwkg: 0.277,
  offshore: 0.816,
  par19: 1.558,
  margin: 2.15,
}

/** 2026 values (ct/kWh netto) — grid fee reduced by govt subsidy */
export const SURCHARGES_2026: Surcharges = {
  gridFee: 9.26,
  stromsteuer: 2.05,
  konzessionsabgabe: 1.66,
  kwkg: 0.446,
  offshore: 0.941,
  par19: 1.559,
  margin: 2.15,
}

/** Get surcharges for a given year */
export function surchargesForYear(year: number): Surcharges {
  if (year >= 2026) return SURCHARGES_2026
  return DEFAULT_SURCHARGES
}

export const VAT_RATE = 19 // percent

/** Sum of all surcharge components (netto) */
export function totalSurchargesNetto(s: Surcharges): number {
  return s.gridFee + s.stromsteuer + s.konzessionsabgabe + s.kwkg + s.offshore + s.par19 + s.margin
}

/** End-customer gross price for a given spot price (ct/kWh) */
export function endCustomerPrice(spotCtKwh: number, surcharges: Surcharges): number {
  return (spotCtKwh + totalSurchargesNetto(surcharges)) * (1 + VAT_RATE / 100)
}

export interface DailyResult {
  date: string
  month: string // YYYY-MM
  dynamicCostEur: number
  fixedCostEur: number
  consumptionKwh: number
  avgSpotCtKwh: number        // simple hourly average (for display only)
  avgEndPriceCtKwh: number    // consumption-weighted effective price
  hoursWithData: number        // populated with data points: 24 hourly or 96 quarter-hourly
  hoursTotal: number           // expected data points: 24 hourly or 96 quarter-hourly
  // Peak (weekday 8-20) / off-peak splits
  peakDynamicCostEur: number
  peakConsumptionKwh: number
  peakSpotSum: number
  peakHours: number
  offPeakDynamicCostEur: number
  offPeakConsumptionKwh: number
  offPeakSpotSum: number
  offPeakHours: number
}

export interface MonthlyResult {
  month: string // YYYY-MM
  label: string // "Jan", "Feb", ...
  year: number
  dynamicCostEur: number
  fixedCostEur: number
  consumptionKwh: number
  avgSpotCtKwh: number
  avgEndPriceCtKwh: number
  daysWithData: number
}

export interface YearlyCostResult {
  totalDynamicCostEur: number
  totalFixedCostEur: number
  savingsEur: number
  avgEffectivePriceCtKwh: number
  totalKwhConsumed: number
  monthlyBreakdown: MonthlyResult[]
  dailyBreakdown: DailyResult[]
  daysWithData: number
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * Calculate yearly cost using dynamic (spot-based) tariff vs. fixed tariff.
 *
 * For each day with price data:
 *   1. Determine month + day type (WT/SA/FT)
 *   2. Get hourly SLP weights
 *   3. For each hour: consumption = weight × (yearlyKwh / 1_000_000)
 *   4. Dynamic cost = consumption × endCustomerPrice(spotPrice) / 100
 *   5. Fixed cost = consumption × fixedPriceCtKwh / 100
 */
export function calculateYearlyCost(
  yearlyKwh: number,
  hourlyPrices: HourlyPrice[],
  surcharges: Surcharges,
  fixedPriceCtKwh: number,
  year: number,
  profile: LoadProfile = 'H25',
  isQuarterHourly: boolean = false,
): YearlyCostResult {
  const scale = yearlyKwh / 1_000_000

  // Group prices by date
  const byDate = new Map<string, HourlyPrice[]>()
  for (const p of hourlyPrices) {
    if (!p.date.startsWith(String(year))) continue
    const existing = byDate.get(p.date)
    if (existing) existing.push(p)
    else byDate.set(p.date, [p])
  }

  const dailyResults: DailyResult[] = []
  const monthlyMap = new Map<string, {
    dynamicCostEur: number; fixedCostEur: number; consumptionKwh: number
    spotSum: number; endPriceSum: number; hoursTotal: number; days: number
  }>()

  for (const [dateStr, prices] of byDate) {
    const month = dateStr.slice(0, 7)
    const monthNum = parseInt(dateStr.slice(5, 7))
    const dayType = getDayType(dateStr)
    const hourlyWeights = isQuarterHourly ? null : getProfileHourlyWeights(monthNum, dayType, profile)
    const qhWeights = isQuarterHourly ? getProfileQHWeights(monthNum, dayType, profile) : null
    const priceByHour = new Map<number, number>()
    const priceBySlot = new Map<string, number>()
    for (const p of prices) {
      if (!priceByHour.has(p.hour)) priceByHour.set(p.hour, p.priceCtKwh)
      if (isQuarterHourly) {
        const key = `${p.hour}:${p.minute ?? 0}`
        if (!priceBySlot.has(key)) priceBySlot.set(key, p.priceCtKwh)
      }
    }

    let dayCostDynamic = 0
    let dayCostFixed = 0
    let dayConsumption = 0
    let daySpotSum = 0
    let dayEndPriceSum = 0
    let dayHours = 0
    // Peak (weekday 8-20) / off-peak
    const isWeekday = dayType === 'WT'
    let peakCost = 0, peakKwh = 0, peakSpotSum = 0, peakHrs = 0
    let offPeakCost = 0, offPeakKwh = 0, offPeakSpotSum = 0, offPeakHrs = 0

    if (isQuarterHourly && qhWeights) {
      for (let q = 0; q < 96; q++) {
        const h = Math.floor(q / 4)
        const m = (q % 4) * 15
        const spotPrice = priceBySlot.get(`${h}:${m}`) ?? priceByHour.get(h)
        if (spotPrice === undefined) continue

        const consumptionKwh = qhWeights[q] * scale
        const grossPrice = endCustomerPrice(spotPrice, surcharges)

        dayCostDynamic += consumptionKwh * grossPrice / 100
        dayCostFixed += consumptionKwh * fixedPriceCtKwh / 100
        dayConsumption += consumptionKwh
        daySpotSum += spotPrice
        dayEndPriceSum += grossPrice
        dayHours++

        const isPeak = isWeekday && h >= 8 && h < 20
        if (isPeak) {
          peakCost += consumptionKwh * grossPrice / 100
          peakKwh += consumptionKwh
          peakSpotSum += spotPrice
          peakHrs++
        } else {
          offPeakCost += consumptionKwh * grossPrice / 100
          offPeakKwh += consumptionKwh
          offPeakSpotSum += spotPrice
          offPeakHrs++
        }
      }
    } else if (hourlyWeights) {
      for (let h = 0; h < 24; h++) {
        const spotPrice = priceByHour.get(h)
        if (spotPrice === undefined) continue

        const consumptionKwh = hourlyWeights[h] * scale
        const grossPrice = endCustomerPrice(spotPrice, surcharges)

        dayCostDynamic += consumptionKwh * grossPrice / 100
        dayCostFixed += consumptionKwh * fixedPriceCtKwh / 100
        dayConsumption += consumptionKwh
        daySpotSum += spotPrice
        dayEndPriceSum += grossPrice
        dayHours++

        const isPeak = isWeekday && h >= 8 && h < 20
        if (isPeak) {
          peakCost += consumptionKwh * grossPrice / 100
          peakKwh += consumptionKwh
          peakSpotSum += spotPrice
          peakHrs++
        } else {
          offPeakCost += consumptionKwh * grossPrice / 100
          offPeakKwh += consumptionKwh
          offPeakSpotSum += spotPrice
          offPeakHrs++
        }
      }
    }

    const daily: DailyResult = {
      date: dateStr,
      month,
      dynamicCostEur: dayCostDynamic,
      fixedCostEur: dayCostFixed,
      consumptionKwh: dayConsumption,
      avgSpotCtKwh: dayHours > 0 ? daySpotSum / dayHours : 0,
      avgEndPriceCtKwh: dayConsumption > 0 ? (dayCostDynamic / dayConsumption) * 100 : 0,
      hoursWithData: dayHours,
      hoursTotal: isQuarterHourly ? 96 : 24,
      peakDynamicCostEur: peakCost,
      peakConsumptionKwh: peakKwh,
      peakSpotSum,
      peakHours: peakHrs,
      offPeakDynamicCostEur: offPeakCost,
      offPeakConsumptionKwh: offPeakKwh,
      offPeakSpotSum,
      offPeakHours: offPeakHrs,
    }
    dailyResults.push(daily)

    // Accumulate monthly
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

  // Build monthly breakdown
  const monthlyBreakdown: MonthlyResult[] = [...monthlyMap.entries()]
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

  // Totals
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

export interface ChartDataPoint {
  hour: number
  minute: number
  label: string
  spotCtKwh: number
  endPriceCtKwh: number
  consumptionKwh: number
  costCent: number
  renewableShare?: number
  isProjected?: boolean
}

/** Get end-customer prices for a specific date (for chart display).
 *  Supports both hourly and quarter-hourly resolution. */
export function getDailyEndPrices(
  prices: HourlyPrice[],
  dateStr: string,
  surcharges: Surcharges,
  yearlyKwh: number,
  isQH: boolean = false,
  generation?: { hour: number; renewableShare: number }[],
  profile: LoadProfile = 'H25',
): ChartDataPoint[] {
  const scale = yearlyKwh / 1_000_000
  const monthNum = parseInt(dateStr.slice(5, 7))
  const dayType = getDayType(dateStr)

  const dayPrices = prices.filter(p => p.date === dateStr)

  // Build projected lookup from source prices
  const projectedSlots = new Set<string>()
  for (const p of dayPrices) {
    if (p.isProjected) projectedSlots.add(`${p.hour}:${p.minute ?? 0}`)
  }

  if (isQH) {
    // Quarter-hourly: match by hour+minute
    const qhWeights = getProfileQHWeights(monthNum, dayType, profile)
    const priceBySlot = new Map<string, number>()
    for (const p of dayPrices) {
      const key = `${p.hour}:${p.minute ?? 0}`
      if (!priceBySlot.has(key)) priceBySlot.set(key, p.priceCtKwh)
    }

    const renewMap = new Map<number, number>()
    if (generation) for (const g of generation) renewMap.set(g.hour, g.renewableShare)

    const result: ChartDataPoint[] = []
    for (let q = 0; q < 96; q++) {
      const h = Math.floor(q / 4)
      const m = (q % 4) * 15
      const key = `${h}:${m}`
      const spotPrice = priceBySlot.get(key) ?? priceBySlot.get(`${h}:0`) // fallback to hourly
      if (spotPrice === undefined) continue
      const endPrice = endCustomerPrice(spotPrice, surcharges)
      const consumption = qhWeights[q] * scale
      result.push({
        hour: h, minute: m,
        label: `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`,
        spotCtKwh: Math.round(spotPrice * 100) / 100,
        endPriceCtKwh: Math.round(endPrice * 100) / 100,
        consumptionKwh: Math.round(consumption * 10000) / 10000,
        costCent: Math.round(consumption * endPrice * 100) / 100,
        renewableShare: renewMap.get(h),
        isProjected: projectedSlots.has(key) || projectedSlots.has(`${h}:0`),
      })
    }
    return result
  }

  // Hourly
  const slpWeights = getProfileHourlyWeights(monthNum, dayType, profile)
  const priceByHour = new Map<number, number>()
  for (const p of dayPrices) {
    if (!priceByHour.has(p.hour)) priceByHour.set(p.hour, p.priceCtKwh)
  }

  const renewMap = new Map<number, number>()
  if (generation) for (const g of generation) renewMap.set(g.hour, g.renewableShare)

  const result: ChartDataPoint[] = []
  for (let h = 0; h < 24; h++) {
    const spotPrice = priceByHour.get(h)
    if (spotPrice === undefined) continue
    const endPrice = endCustomerPrice(spotPrice, surcharges)
    const consumption = slpWeights[h] * scale
    result.push({
      hour: h, minute: 0,
      label: `${String(h).padStart(2, '0')}:00`,
      spotCtKwh: Math.round(spotPrice * 100) / 100,
      endPriceCtKwh: Math.round(endPrice * 100) / 100,
      consumptionKwh: Math.round(consumption * 10000) / 10000,
      costCent: Math.round(consumption * endPrice * 100) / 100,
      renewableShare: renewMap.get(h),
      isProjected: projectedSlots.has(`${h}:0`),
    })
  }
  return result
}
