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

export interface V2gResult {
  // Slot assignments
  chargeSlots: HourlyPrice[]     // slots where battery charges (buy low)
  dischargeSlots: HourlyPrice[]  // slots where battery discharges (sell high)
  // Averages
  chargeAvgCt: number            // avg buy price ct/kWh
  dischargeAvgCt: number         // avg sell price ct/kWh
  // Energy
  totalChargedKwh: number        // total kWh charged
  totalDischargedKwh: number     // total kWh discharged
  netEnergyKwh: number           // net kWh added to battery (charge - discharge/eff)
  // Financials — all revenue is "savings" in V2G
  chargeCostEur: number          // cost of buying energy
  dischargeRevenueEur: number    // revenue from selling energy
  degradationCostEur: number     // battery wear cost
  profitEur: number              // revenue - cost - degradation = net profit per session
  profitCtKwh: number            // profit normalized per kWh discharged
  // SoC tracking
  startSoc: number               // % at plug-in
  endSoc: number                 // % at departure (should >= targetSoc)
  minSocReached: number          // lowest SoC during session
  // Chart rendering
  dischargeKeys: Set<string>     // `date-hour-minute` keys of discharge slots
  chargeKeys: Set<string>        // `date-hour-minute` keys of charge slots
}

const EMPTY_V2G: V2gResult = {
  chargeSlots: [], dischargeSlots: [],
  chargeAvgCt: 0, dischargeAvgCt: 0,
  totalChargedKwh: 0, totalDischargedKwh: 0, netEnergyKwh: 0,
  chargeCostEur: 0, dischargeRevenueEur: 0, degradationCostEur: 0,
  profitEur: 0, profitCtKwh: 0,
  startSoc: 0, endSoc: 0, minSocReached: 0,
  dischargeKeys: new Set(), chargeKeys: new Set(),
}

/**
 * V2G optimizer: maximize battery arbitrage profit within a price window.
 *
 * Model: plug in at startSoc → trade the battery (buy low / sell high) →
 * must reach targetSoc by departure. All revenue IS the saving.
 *
 * Algorithm:
 * 1. Determine how many kWh must be net-charged: (targetSoc - startSoc) * batteryKwh / 100
 * 2. Greedy pair cheapest buy slots with most expensive sell slots
 * 3. Each pair is profitable if: sellPrice - buyPrice/efficiency - degradation > 0
 * 4. Respect battery bounds: never below minSoc, never above 100%
 * 5. Ensure enough net charge to reach targetSoc
 */
export function computeV2gWindowSavings(
  windowPrices: HourlyPrice[],
  batteryKwh: number,
  chargePowerKw: number,
  dischargePowerKw: number,
  startSocPercent: number,
  targetSocPercent: number,
  minSocPercent: number,
  roundTripEfficiency: number,
  degradationCtKwh: number,
  kwhPerSlot: number,
): V2gResult {
  if (windowPrices.length === 0) return { ...EMPTY_V2G }

  const startKwh = batteryKwh * startSocPercent / 100
  const targetKwh = batteryKwh * targetSocPercent / 100
  const minKwh = batteryKwh * minSocPercent / 100
  const maxKwh = batteryKwh
  const chargeKwhPerSlot = Math.min(kwhPerSlot, maxKwh) // capped by slot duration × power
  const dischargeKwhPerSlot = Math.min(dischargePowerKw * (kwhPerSlot / chargePowerKw), maxKwh)

  // Net kWh needed to reach target from start
  const netNeededKwh = Math.max(0, targetKwh - startKwh)

  // Sort all prices cheap→expensive
  const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)

  // Step 1: Reserve cheapest slots for net charging (must reach targetSoc)
  // Each charge slot adds kwhPerSlot to battery
  const netChargeSlotsNeeded = Math.ceil(netNeededKwh / chargeKwhPerSlot)
  const netChargeSlots = sorted.slice(0, netChargeSlotsNeeded)
  const netChargeKeys = new Set(netChargeSlots.map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

  // Step 2: From remaining slots, find profitable charge/discharge pairs
  const remaining = sorted.filter(p => !netChargeKeys.has(`${p.date}-${p.hour}-${p.minute ?? 0}`))
  const buyLow = [...remaining] // cheap→expensive
  const sellHigh = [...remaining].reverse() // expensive→cheap

  const arbitrageChargeSlots: HourlyPrice[] = []
  const arbitrageDischargeSlots: HourlyPrice[] = []
  const usedKeys = new Set<string>()

  // Available capacity for trading: room above minSoc + startKwh, capped by battery
  // The battery can cycle within [minKwh, maxKwh] during the session
  const maxTradeableKwh = maxKwh - minKwh

  let totalTraded = 0
  let bIdx = 0
  for (const sell of sellHigh) {
    if (totalTraded >= maxTradeableKwh) break
    const sellKey = `${sell.date}-${sell.hour}-${sell.minute ?? 0}`
    if (usedKeys.has(sellKey)) continue

    // Find cheapest unused buy slot
    while (bIdx < buyLow.length) {
      const bk = `${buyLow[bIdx].date}-${buyLow[bIdx].hour}-${buyLow[bIdx].minute ?? 0}`
      if (!usedKeys.has(bk) && bk !== sellKey) break
      bIdx++
    }
    if (bIdx >= buyLow.length) break

    const buy = buyLow[bIdx]
    // Profitability: sell revenue > buy cost (adj for RT efficiency) + degradation
    const profit = sell.priceCtKwh - (buy.priceCtKwh / roundTripEfficiency) - degradationCtKwh
    if (profit <= 0) break

    const tradeKwh = Math.min(dischargeKwhPerSlot, chargeKwhPerSlot, maxTradeableKwh - totalTraded)
    arbitrageDischargeSlots.push(sell)
    arbitrageChargeSlots.push(buy)
    usedKeys.add(sellKey)
    usedKeys.add(`${buy.date}-${buy.hour}-${buy.minute ?? 0}`)
    totalTraded += tradeKwh
    bIdx++
  }

  // Combine all charge and discharge slots
  const allChargeSlots = [...netChargeSlots, ...arbitrageChargeSlots]
  const allDischargeSlots = arbitrageDischargeSlots

  const totalChargedKwh = allChargeSlots.length * chargeKwhPerSlot
  const totalDischargedKwh = allDischargeSlots.length * dischargeKwhPerSlot

  // Financials
  const chargeAvgCt = allChargeSlots.length > 0
    ? allChargeSlots.reduce((s, p) => s + p.priceCtKwh, 0) / allChargeSlots.length : 0
  const dischargeAvgCt = allDischargeSlots.length > 0
    ? allDischargeSlots.reduce((s, p) => s + p.priceCtKwh, 0) / allDischargeSlots.length : 0

  const chargeCostEur = allChargeSlots.reduce((s, p) => s + p.priceCtKwh * chargeKwhPerSlot, 0) / 100
  const dischargeRevenueEur = allDischargeSlots.reduce((s, p) => s + p.priceCtKwh * dischargeKwhPerSlot, 0) / 100
  const degradationCostEur = degradationCtKwh * totalDischargedKwh / 100
  const profitEur = dischargeRevenueEur - chargeCostEur + (chargeAvgCt > 0 ? 0 : 0) // net: sell - buy - degradation
  // But we need to account for: the net charging cost is just the cost of getting to targetSoc
  // The arbitrage profit = sell revenue - buy cost for arb pairs - degradation
  const arbChargeCost = arbitrageChargeSlots.reduce((s, p) => s + p.priceCtKwh * chargeKwhPerSlot / roundTripEfficiency, 0) / 100
  const arbProfit = dischargeRevenueEur - arbChargeCost - degradationCostEur
  // Net charge cost = cheapest slots to reach target
  const netChargeCostEur = netChargeSlots.reduce((s, p) => s + p.priceCtKwh * chargeKwhPerSlot, 0) / 100
  // Total "savings" = arbitrage profit (the net charging cost is unavoidable)
  const totalProfitEur = arbProfit

  // SoC tracking (simplified — greedy doesn't guarantee chronological feasibility,
  // but for the dashboard visualization this is sufficient)
  const endSocKwh = startKwh + totalChargedKwh - totalDischargedKwh
  const endSoc = Math.min(100, Math.max(0, endSocKwh / batteryKwh * 100))

  // Build key sets
  const chargeKeys = new Set(allChargeSlots.map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))
  const dischargeKeys = new Set(allDischargeSlots.map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

  return {
    chargeSlots: allChargeSlots,
    dischargeSlots: allDischargeSlots,
    chargeAvgCt,
    dischargeAvgCt,
    totalChargedKwh,
    totalDischargedKwh,
    netEnergyKwh: totalChargedKwh - totalDischargedKwh,
    chargeCostEur: netChargeCostEur + arbChargeCost,
    dischargeRevenueEur,
    degradationCostEur,
    profitEur: totalProfitEur,
    profitCtKwh: totalDischargedKwh > 0 ? totalProfitEur * 100 / totalDischargedKwh : 0,
    startSoc: startSocPercent,
    endSoc,
    minSocReached: minSocPercent, // greedy approximation
    dischargeKeys,
    chargeKeys,
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
