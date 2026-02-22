/**
 * Optimization engine for charging schedule planning
 *
 * Extracted core logic from the optimize API route.
 * Calculates optimal charging windows based on exchange prices
 * and compares with a "naive" baseline (immediate charging).
 */

import type { PricePoint, ChargingBlock } from '@/lib/config'
import { getGridFee, isModul3Active, getAverageGridFee, getAvailableDSOs } from '@/lib/grid-fees'

export interface OptimizeInput {
  prices: PricePoint[]
  battery_kwh: number
  charge_power_kw: number
  start_level_percent: number
  window_start: string  // "HH:MM"
  window_end: string    // "HH:MM"
  target_level_percent: number
  base_price_ct_kwh: number
  margin_ct_kwh: number
  customer_discount_ct_kwh: number
  dso?: string
}

export interface OptimizeResult {
  charging_schedule: ChargingBlock[]
  cost_without_flex_eur: number
  cost_with_flex_eur: number
  savings_eur: number
  customer_benefit_eur: number
  our_margin_eur: number
  win_win_eur: number
  avg_price_without_flex: number
  avg_price_with_flex: number
  energy_charged_kwh: number
  target_level_reached: boolean
  baseline_schedule: ChargingBlock[]
  baseline_avg_price: number
  // Module 3 fields (optional)
  dso?: string
  mod3_active?: boolean
  cost_with_mod3_eur?: number
  cost_without_mod3_eur?: number
  savings_from_mod3_eur?: number
  avg_grid_fee_window_ct_kwh?: number
  avg_grid_fee_optimal_ct_kwh?: number
  mod3_info?: string
}

interface PricePointExt extends PricePoint {
  hour: number
  minute: number
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

function isTimeInWindow(price: PricePointExt, windowStart: string, windowEnd: string): boolean {
  const { hour: startHour } = parseTime(windowStart)
  const { hour: endHour } = parseTime(windowEnd)

  // Overnight window (e.g. 22:00 - 06:00)
  if (startHour > endHour) {
    return price.hour >= startHour || price.hour < endHour
  }

  return price.hour >= startHour && price.hour < endHour
}

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

/**
 * Merge consecutive intervals into charging blocks
 */
function buildChargingBlocks(
  intervals: PricePointExt[],
  kwhPerInterval: number,
  windowStartHour: number
): ChargingBlock[] {
  const blocks: ChargingBlock[] = []
  let currentBlock: ChargingBlock | null = null

  // Sort chronologically, accounting for overnight windows
  const sorted = [...intervals].sort((a, b) => {
    const aNorm = a.hour < windowStartHour ? a.hour + 24 : a.hour
    const bNorm = b.hour < windowStartHour ? b.hour + 24 : b.hour
    return aNorm - bNorm || a.minute - b.minute
  })

  sorted.forEach((interval, index) => {
    const time = formatTime(interval.hour, interval.minute)
    const endDate = new Date()
    endDate.setHours(interval.hour, interval.minute + 15, 0, 0)
    const endTimeStr = formatTime(endDate.getHours(), endDate.getMinutes())

    if (!currentBlock) {
      currentBlock = {
        start: time,
        end: endTimeStr,
        price_ct_kwh: interval.price_ct_kwh,
        kwh: kwhPerInterval
      }
    } else {
      // Check if consecutive
      const prevEnd = new Date()
      const [hours, minutes] = currentBlock.end.split(':').map(Number)
      prevEnd.setHours(hours, minutes, 0, 0)

      const currentStart = new Date()
      currentStart.setHours(interval.hour, interval.minute, 0, 0)

      if (Math.abs(currentStart.getTime() - prevEnd.getTime()) <= 15 * 60 * 1000) {
        // Extend block
        currentBlock.end = endTimeStr
        currentBlock.kwh += kwhPerInterval
        // Weighted average price
        currentBlock.price_ct_kwh =
          (currentBlock.price_ct_kwh * (currentBlock.kwh - kwhPerInterval) +
           interval.price_ct_kwh * kwhPerInterval) / currentBlock.kwh
      } else {
        // New block
        blocks.push(currentBlock)
        currentBlock = {
          start: time,
          end: endTimeStr,
          price_ct_kwh: interval.price_ct_kwh,
          kwh: kwhPerInterval
        }
      }
    }

    // Add last block
    if (index === sorted.length - 1 && currentBlock) {
      blocks.push(currentBlock)
    }
  })

  return blocks
}

/**
 * Core function: Run optimization
 *
 * Compares optimized charging (cheapest intervals) with
 * baseline ("naive" immediate charging from window_start).
 */
export function runOptimization(input: OptimizeInput): OptimizeResult {
  const {
    prices,
    battery_kwh,
    charge_power_kw,
    start_level_percent,
    window_start,
    window_end,
    target_level_percent,
    base_price_ct_kwh,
    margin_ct_kwh,
    customer_discount_ct_kwh,
    dso
  } = input

  // Validate DSO
  const useMod3 = dso ? getAvailableDSOs().includes(dso) : false

  // Module 3 quarterly check
  const firstPriceDate = prices.length > 0 ? new Date(prices[0].timestamp) : new Date()
  const priceMonth = firstPriceDate.getMonth() + 1
  const mod3Active = useMod3 && dso ? isModul3Active(dso, priceMonth) : false

  // 1. Calculate required energy
  const energy_needed_kwh = battery_kwh * (target_level_percent - start_level_percent) / 100

  if (energy_needed_kwh <= 0) {
    return {
      charging_schedule: [],
      baseline_schedule: [],
      baseline_avg_price: 0,
      cost_without_flex_eur: 0,
      cost_with_flex_eur: 0,
      savings_eur: 0,
      customer_benefit_eur: 0,
      our_margin_eur: 0,
      win_win_eur: 0,
      avg_price_without_flex: 0,
      avg_price_with_flex: 0,
      energy_charged_kwh: 0,
      target_level_reached: true
    }
  }

  // 2. Calculate charging duration
  const intervals_needed = Math.ceil((energy_needed_kwh / charge_power_kw) * 4)
  const kwh_per_interval = charge_power_kw / 4

  // 3. Filter prices by time window
  const pricesWithTime: PricePointExt[] = prices.map(p => {
    const date = new Date(p.timestamp)
    return { ...p, hour: date.getHours(), minute: date.getMinutes() }
  }).filter(p => isTimeInWindow(p, window_start, window_end))

  if (pricesWithTime.length === 0) {
    return {
      charging_schedule: [],
      baseline_schedule: [],
      baseline_avg_price: 0,
      cost_without_flex_eur: (base_price_ct_kwh * energy_needed_kwh) / 100,
      cost_with_flex_eur: 0,
      savings_eur: 0,
      customer_benefit_eur: 0,
      our_margin_eur: 0,
      win_win_eur: 0,
      avg_price_without_flex: base_price_ct_kwh,
      avg_price_with_flex: 0,
      energy_charged_kwh: 0,
      target_level_reached: false
    }
  }

  const { hour: windowStartHour } = parseTime(window_start)

  // 4. Optimized: Sort by total cost (cheapest first)
  const sortedPrices = [...pricesWithTime].sort((a, b) => {
    if (mod3Active && dso) {
      const totalA = a.price_ct_kwh + getGridFee(a.hour, dso)
      const totalB = b.price_ct_kwh + getGridFee(b.hour, dso)
      return totalA - totalB
    }
    return a.price_ct_kwh - b.price_ct_kwh
  })
  const selectedIntervals = sortedPrices.slice(0, Math.min(intervals_needed, sortedPrices.length))

  // 5. Baseline: Chronologically first N intervals from window_start ("charge immediately")
  const chronologicalPrices = [...pricesWithTime].sort((a, b) => {
    const aNorm = a.hour < windowStartHour ? a.hour + 24 : a.hour
    const bNorm = b.hour < windowStartHour ? b.hour + 24 : b.hour
    return aNorm - bNorm || a.minute - b.minute
  })
  const baselineIntervals = chronologicalPrices.slice(0, Math.min(intervals_needed, chronologicalPrices.length))

  // 6. Build charging blocks
  const actual_energy_kwh = (selectedIntervals.length / 4) * charge_power_kw
  const canFullyCharge = actual_energy_kwh >= energy_needed_kwh

  const charging_schedule = buildChargingBlocks(selectedIntervals, kwh_per_interval, windowStartHour)
  const baseline_schedule = buildChargingBlocks(baselineIntervals, kwh_per_interval, windowStartHour)

  // 7. Calculate economics
  const avg_window_price = pricesWithTime.reduce((sum, p) => sum + p.price_ct_kwh, 0) / pricesWithTime.length
  const avg_optimal_price = selectedIntervals.reduce((sum, p) => sum + p.price_ct_kwh, 0) / selectedIntervals.length
  const baseline_avg_price = baselineIntervals.reduce((sum, p) => sum + p.price_ct_kwh, 0) / baselineIntervals.length

  const cost_without_flex_eur = (avg_window_price * energy_needed_kwh) / 100
  const cost_with_flex_eur = (avg_optimal_price * actual_energy_kwh) / 100
  const savings_eur = Math.max(0, cost_without_flex_eur - cost_with_flex_eur)

  const discount_savings = (customer_discount_ct_kwh * actual_energy_kwh) / 100
  const half_savings = savings_eur * 0.5
  const customer_benefit_eur = Math.min(discount_savings, half_savings)
  const our_margin_eur = Math.max(0, savings_eur - customer_benefit_eur)
  const win_win_eur = customer_benefit_eur + our_margin_eur

  // 8. Assemble result
  const result: OptimizeResult = {
    charging_schedule,
    baseline_schedule,
    baseline_avg_price: Math.round(baseline_avg_price * 100) / 100,
    cost_without_flex_eur: Math.round(cost_without_flex_eur * 100) / 100,
    cost_with_flex_eur: Math.round(cost_with_flex_eur * 100) / 100,
    savings_eur: Math.round(savings_eur * 100) / 100,
    customer_benefit_eur: Math.round(customer_benefit_eur * 100) / 100,
    our_margin_eur: Math.round(our_margin_eur * 100) / 100,
    win_win_eur: Math.round(win_win_eur * 100) / 100,
    avg_price_without_flex: Math.round(avg_window_price * 100) / 100,
    avg_price_with_flex: Math.round(avg_optimal_price * 100) / 100,
    energy_charged_kwh: Math.round(actual_energy_kwh * 10) / 10,
    target_level_reached: canFullyCharge
  }

  // 9. Module 3 supplementary calculation
  if (mod3Active && dso) {
    const avgGridFeeWindow = pricesWithTime.reduce(
      (sum, p) => sum + getGridFee(p.hour, dso), 0
    ) / pricesWithTime.length

    const avgGridFeeOptimal = selectedIntervals.reduce(
      (sum, p) => sum + getGridFee(p.hour, dso), 0
    ) / selectedIntervals.length

    const costWithMod3 = ((avg_optimal_price + avgGridFeeOptimal) * actual_energy_kwh) / 100
    const costWithoutMod3 = ((avg_window_price + avgGridFeeWindow) * energy_needed_kwh) / 100

    const flatGridFee = getAverageGridFee(dso)
    const costFlatGrid = ((avg_window_price + flatGridFee) * energy_needed_kwh) / 100
    const savingsFromMod3 = Math.max(0, costFlatGrid - costWithMod3)

    result.dso = dso
    result.mod3_active = true
    result.cost_with_mod3_eur = Math.round(costWithMod3 * 100) / 100
    result.cost_without_mod3_eur = Math.round(costWithoutMod3 * 100) / 100
    result.savings_from_mod3_eur = Math.round(savingsFromMod3 * 100) / 100
    result.avg_grid_fee_window_ct_kwh = Math.round(avgGridFeeWindow * 100) / 100
    result.avg_grid_fee_optimal_ct_kwh = Math.round(avgGridFeeOptimal * 100) / 100
  } else if (dso) {
    result.dso = dso
    result.mod3_active = false
    result.mod3_info = `Module 3 is not active for ${dso} in the current quarter`
  }

  return result
}
