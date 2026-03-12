/**
 * Shared helper functions for the charging scenario visualization.
 */
import type { HourlyPrice } from '@/lib/v2-config'

export function nextDayStr(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
}

/**
 * Compute baseline vs optimized average price for a charging window.
 * Supports both hourly (slotsPerHour=1) and QH (slotsPerHour=4) modes.
 */
export function computeWindowSavings(
  windowPrices: HourlyPrice[],
  energyPerSession: number,
  kwhPerSlot: number,
  slotsPerHour: number,
): { bAvg: number; oAvg: number; savingsEur: number } {
  const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
  // Baseline: first N slots chronologically (each hour = slotsPerHour slots)
  let bSum = 0, bCount = 0
  for (const p of windowPrices) {
    const take = Math.min(slotsPerHour, slotsNeeded - bCount)
    if (take <= 0) break
    bSum += p.priceCtKwh * take
    bCount += take
  }
  // Optimized: cheapest N slots (sort by price, each hour = slotsPerHour slots)
  const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  let oSum = 0, oCount = 0
  for (const p of sorted) {
    const take = Math.min(slotsPerHour, slotsNeeded - oCount)
    if (take <= 0) break
    oSum += p.priceCtKwh * take
    oCount += take
  }
  const bAvg = bCount > 0 ? bSum / bCount : 0
  const oAvg = oCount > 0 ? oSum / oCount : 0
  return { bAvg, oAvg, savingsEur: (bAvg - oAvg) * energyPerSession / 100 }
}

/* ── Spread Indicator Types & Helpers ── */

export interface SpreadResult {
  marketSpreadCtKwh: number       // max − min in ct/kWh
  capturableSavingsCtKwh: number  // baseline avg − optimized avg in ct/kWh
  capturableSavingsEur: number    // baseline cost − optimized cost (EUR)
  minPriceCtKwh: number
  maxPriceCtKwh: number
  cheapestHour: string            // "HH:00" label of cheapest slot
  expensiveHour: string           // "HH:00" label of most expensive slot
  cheapestDate?: string           // YYYY-MM-DD (for multi-day windows)
  expensiveDate?: string          // YYYY-MM-DD (for multi-day windows)
  hoursInWindow: number
}

/** Compute market spread + capturable savings for a price window.
 *  kwhPerSlot: energy per price entry (7 for hourly @ 7kW, 1.75 for QH @ 7kW).
 *  slotsPerHour: how many charging slots each price entry represents
 *    (1 for both hourly and QH data — each entry = one slot).
 *    Legacy callers may pass 4 for hourly data to simulate QH; for actual QH data always pass 1.
 */
export function computeSpread(
  windowPrices: HourlyPrice[],
  energyPerSession: number,
  chargePowerKw: number,
  slotsPerHour: number = 1,
  kwhPerSlotOverride?: number,
): SpreadResult | null {
  if (windowPrices.length < 2) return null
  const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  const cheapest = sorted[0]
  const expensive = sorted[sorted.length - 1]
  const kwhPerSlot = kwhPerSlotOverride ?? (slotsPerHour === 4 ? chargePowerKw * 0.25 : chargePowerKw)
  const { bAvg, oAvg, savingsEur } = computeWindowSavings(windowPrices, energyPerSession, kwhPerSlot, slotsPerHour)
  return {
    marketSpreadCtKwh: Math.round((expensive.priceCtKwh - cheapest.priceCtKwh) * 100) / 100,
    capturableSavingsCtKwh: Math.round((bAvg - oAvg) * 100) / 100,
    capturableSavingsEur: Math.round(savingsEur * 1000) / 1000,
    minPriceCtKwh: cheapest.priceCtKwh,
    maxPriceCtKwh: expensive.priceCtKwh,
    cheapestHour: `${String(cheapest.hour).padStart(2, '0')}:00`,
    expensiveHour: `${String(expensive.hour).padStart(2, '0')}:00`,
    cheapestDate: cheapest.date,
    expensiveDate: expensive.date,
    hoursInWindow: windowPrices.length,
  }
}

/** Build multi-day price window from hourlyPrices between startDate plugInTime → endDate departureTime */
export function buildMultiDayWindow(
  hourlyPrices: HourlyPrice[],
  startDate: string,
  endDate: string,
  plugInTime: number,
  departureTime: number,
): HourlyPrice[] {
  return hourlyPrices.filter(p => {
    if (p.date === startDate) return p.hour >= plugInTime
    if (p.date === endDate) return p.hour < departureTime
    if (p.date > startDate && p.date < endDate) return true
    return false
  })
}

/** Add N days to a date string */
export function addDaysStr(dateStr: string, days: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + days)
  return d.toISOString().slice(0, 10)
}

/** Get day-of-week for a date string (0=Sun, 5=Fri, 6=Sat) */
export function getDow(dateStr: string): number {
  return new Date(dateStr + 'T12:00:00Z').getUTCDay()
}

/* ── V2G (Bidirectional) Optimizer ── */

export interface V2gSlot {
  price: HourlyPrice
  action: 'charge' | 'discharge' | 'idle'
}

export interface V2gResult {
  // V1G portion (smart charging savings)
  v1gBAvg: number           // baseline avg ct/kWh
  v1gOAvg: number           // optimized charge avg ct/kWh
  v1gSavingsEur: number     // shift savings EUR
  // V2G arbitrage portion
  chargeSlots: HourlyPrice[]    // hours selected for charging (driving + V2G buy-low)
  dischargeSlots: HourlyPrice[] // hours selected for discharging (V2G sell-high)
  dischargeAvgCt: number        // avg sell price ct/kWh
  chargeAvgCt: number           // avg buy price ct/kWh (for V2G extra charge)
  dischargedKwh: number         // total kWh discharged
  v2gGrossEur: number           // revenue from selling
  v2gChargeCostEur: number      // cost of extra charge to feed discharge
  v2gDegradationEur: number     // battery wear cost
  v2gNetEur: number             // gross - chargeCost - degradation
  // Combined
  totalSavingsEur: number       // v1gSavings + v2gNet
  totalSavingsCtKwh: number     // total savings per kWh of driving energy
  // For chart rendering
  dischargeKeys: Set<string>    // `date-hour-minute` keys of discharge slots
  chargeKeys: Set<string>       // `date-hour-minute` keys of all charge slots
}

/**
 * Compute V2G savings: smart charging (buy low) + arbitrage (sell high).
 * Uses greedy pairing: match cheapest charge slots with most expensive discharge slots.
 */
export function computeV2gWindowSavings(
  windowPrices: HourlyPrice[],
  energyPerSession: number,
  kwhPerSlot: number,
  slotsPerHour: number,
  batteryKwh: number,
  startSocPercent: number,
  targetSocPercent: number,
  minSocPercent: number,
  dischargePowerKw: number,
  roundTripEfficiency: number,
  degradationCtKwh: number,
): V2gResult {
  if (windowPrices.length === 0) {
    return {
      v1gBAvg: 0, v1gOAvg: 0, v1gSavingsEur: 0,
      chargeSlots: [], dischargeSlots: [],
      dischargeAvgCt: 0, chargeAvgCt: 0, dischargedKwh: 0,
      v2gGrossEur: 0, v2gChargeCostEur: 0, v2gDegradationEur: 0, v2gNetEur: 0,
      totalSavingsEur: 0, totalSavingsCtKwh: 0,
      dischargeKeys: new Set(), chargeKeys: new Set(),
    }
  }

  // Step 1: V1G baseline and optimized (same as computeWindowSavings)
  const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
  let bSum = 0, bCount = 0
  for (const p of windowPrices) {
    const take = Math.min(slotsPerHour, slotsNeeded - bCount)
    if (take <= 0) break
    bSum += p.priceCtKwh * take
    bCount += take
  }
  const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  let oSum = 0, oCount = 0
  for (const p of sorted) {
    const take = Math.min(slotsPerHour, slotsNeeded - oCount)
    if (take <= 0) break
    oSum += p.priceCtKwh * take
    oCount += take
  }
  const v1gBAvg = bCount > 0 ? bSum / bCount : 0
  const v1gOAvg = oCount > 0 ? oSum / oCount : 0
  const v1gSavingsEur = (v1gBAvg - v1gOAvg) * energyPerSession / 100

  // Charge slots for driving energy (cheapest N)
  const drivingChargeSlots = sorted.slice(0, slotsNeeded)
  const drivingChargeKeys = new Set(drivingChargeSlots.map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

  // Step 2: V2G arbitrage — find profitable charge/discharge pairs
  // Available energy for trading: battery capacity above minSoC minus driving needs
  const usableBatteryKwh = batteryKwh * (1 - minSocPercent / 100)
  const tradeableKwh = Math.max(0, usableBatteryKwh - energyPerSession)
  const dischargeKwhPerSlot = dischargePowerKw * (slotsPerHour === 4 ? 0.25 : 1)

  // Remaining slots (not used for driving charge)
  const remainingSlots = sorted.filter(p => !drivingChargeKeys.has(`${p.date}-${p.hour}-${p.minute ?? 0}`))

  // Cheapest remaining = buy-low candidates, most expensive remaining = sell-high candidates
  const buyLow = [...remainingSlots] // already sorted cheap→expensive
  const sellHigh = [...remainingSlots].reverse() // expensive→cheap

  const v2gChargeSlots: HourlyPrice[] = []
  const v2gDischargeSlots: HourlyPrice[] = []
  const usedKeys = new Set<string>()
  let totalDischargedKwh = 0

  let buyIdx = 0
  for (const sell of sellHigh) {
    if (totalDischargedKwh >= tradeableKwh) break
    const sellKey = `${sell.date}-${sell.hour}-${sell.minute ?? 0}`
    if (usedKeys.has(sellKey)) continue

    // Find cheapest unused buy slot
    while (buyIdx < buyLow.length) {
      const buyKey = `${buyLow[buyIdx].date}-${buyLow[buyIdx].hour}-${buyLow[buyIdx].minute ?? 0}`
      if (!usedKeys.has(buyKey) && buyKey !== sellKey) break
      buyIdx++
    }
    if (buyIdx >= buyLow.length) break

    const buy = buyLow[buyIdx]
    // Profitability check: sell revenue > buy cost (adjusted for efficiency) + degradation
    const netProfit = sell.priceCtKwh - (buy.priceCtKwh / roundTripEfficiency) - degradationCtKwh
    if (netProfit <= 0) break // no more profitable pairs

    const dischargeKwh = Math.min(dischargeKwhPerSlot, tradeableKwh - totalDischargedKwh)
    v2gDischargeSlots.push(sell)
    v2gChargeSlots.push(buy)
    usedKeys.add(sellKey)
    usedKeys.add(`${buy.date}-${buy.hour}-${buy.minute ?? 0}`)
    totalDischargedKwh += dischargeKwh
    buyIdx++
  }

  // Compute V2G financials
  const dischargeAvgCt = v2gDischargeSlots.length > 0
    ? v2gDischargeSlots.reduce((s, p) => s + p.priceCtKwh, 0) / v2gDischargeSlots.length : 0
  const chargeAvgCt = v2gChargeSlots.length > 0
    ? v2gChargeSlots.reduce((s, p) => s + p.priceCtKwh, 0) / v2gChargeSlots.length : 0
  const v2gGrossEur = dischargeAvgCt * totalDischargedKwh / 100
  const chargeNeededKwh = totalDischargedKwh / roundTripEfficiency
  const v2gChargeCostEur = chargeAvgCt * chargeNeededKwh / 100
  const v2gDegradationEur = degradationCtKwh * totalDischargedKwh / 100
  const v2gNetEur = v2gGrossEur - v2gChargeCostEur - v2gDegradationEur
  const totalSavingsEur = v1gSavingsEur + v2gNetEur

  // Build key sets for chart rendering
  const allChargeKeys = new Set(drivingChargeKeys)
  for (const p of v2gChargeSlots) allChargeKeys.add(`${p.date}-${p.hour}-${p.minute ?? 0}`)
  const dischargeKeys = new Set(v2gDischargeSlots.map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

  return {
    v1gBAvg: v1gBAvg,
    v1gOAvg: v1gOAvg,
    v1gSavingsEur,
    chargeSlots: [...drivingChargeSlots, ...v2gChargeSlots],
    dischargeSlots: v2gDischargeSlots,
    dischargeAvgCt,
    chargeAvgCt,
    dischargedKwh: totalDischargedKwh,
    v2gGrossEur,
    v2gChargeCostEur,
    v2gDegradationEur,
    v2gNetEur,
    totalSavingsEur,
    totalSavingsCtKwh: energyPerSession > 0 ? totalSavingsEur * 100 / energyPerSession : 0,
    dischargeKeys,
    chargeKeys: allChargeKeys,
  }
}

/** Build overnight window prices for a given date pair */
export interface OvernightWindow {
  date: string
  month: string
  prices: HourlyPrice[]
  sorted: HourlyPrice[]
  isProjected?: boolean  // true if any price in the window uses projected data
  isWeekend: boolean     // true if the plug-in date is Saturday or Sunday
}

export function buildOvernightWindows(
  hourlyPrices: HourlyPrice[],
  plugInTime: number,
  departureTime: number,
): OvernightWindow[] {
  const byDate = new Map<string, HourlyPrice[]>()
  for (const p of hourlyPrices) {
    const arr = byDate.get(p.date) || []
    arr.push(p)
    byDate.set(p.date, arr)
  }
  const windows: OvernightWindow[] = []
  for (const [dDate, dPrices] of byDate) {
    const nd = nextDayStr(dDate)
    const nPrices = byDate.get(nd)
    if (!nPrices || nPrices.length === 0) continue
    const eve = dPrices.filter(p => p.hour >= plugInTime)
    const morn = nPrices.filter(p => p.hour < departureTime)
    const win = [...eve, ...morn]
    if (win.length === 0) continue
    const sorted = [...win].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
    const dow = new Date(dDate + 'T12:00:00Z').getUTCDay() // 0=Sun, 6=Sat
    const isWeekend = dow === 0 || dow === 6
    windows.push({ date: dDate, month: dDate.slice(0, 7), prices: win, sorted, isProjected: win.some(p => p.isProjected), isWeekend })
  }
  return windows
}
