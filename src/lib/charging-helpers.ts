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
  // Financials — total benefit = load shifting + arbitrage
  chargeCostEur: number          // cost of buying energy
  dischargeRevenueEur: number    // revenue from selling energy
  degradationCostEur: number     // battery wear cost
  profitEur: number              // TOTAL benefit = loadShiftingBenefitEur + arbitrageUpliftEur
  profitCtKwh: number            // profit normalized per kWh discharged
  // Dual value streams (PROJ-29)
  loadShiftingBenefitEur: number // V1G-equivalent savings on net charge (startSoC→targetSoC)
  arbitrageUpliftEur: number     // extra profit from discharge/recharge cycling
  baselineChargeCostEur: number  // what charging immediately at plug-in would cost
  optimizedChargeCostEur: number // what smart-timed net charge costs (cheapest slots)
  // SoC tracking
  startSoc: number               // % at plug-in
  endSoc: number                 // % at departure (should >= targetSoc)
  minSocReached: number          // lowest SoC during session
  // Chart rendering
  dischargeKeys: Set<string>     // `date-hour-minute` keys of discharge slots
  chargeKeys: Set<string>        // `date-hour-minute` keys of ALL charge slots
  netChargeKeys: Set<string>     // keys of load-shifting charge slots (net energy needed)
  arbChargeKeys: Set<string>     // keys of arbitrage charge slots (extra cycling energy)
}

const EMPTY_V2G: V2gResult = {
  chargeSlots: [], dischargeSlots: [],
  chargeAvgCt: 0, dischargeAvgCt: 0,
  totalChargedKwh: 0, totalDischargedKwh: 0, netEnergyKwh: 0,
  chargeCostEur: 0, dischargeRevenueEur: 0, degradationCostEur: 0,
  profitEur: 0, profitCtKwh: 0,
  loadShiftingBenefitEur: 0, arbitrageUpliftEur: 0,
  baselineChargeCostEur: 0, optimizedChargeCostEur: 0,
  startSoc: 0, endSoc: 0, minSocReached: 0,
  dischargeKeys: new Set(), chargeKeys: new Set(),
  netChargeKeys: new Set(), arbChargeKeys: new Set(),
}

/**
 * V2G optimizer: maximize battery arbitrage profit within a price window.
 *
 * Model: plug in at startSoc → trade the battery (buy low / sell high) →
 * must reach targetSoc by departure. Total benefit = load shifting + arbitrage.
 *
 * Algorithm (PROJ-29 — chronological ordering + dual value streams):
 * 1. Compute V1G-equivalent load shifting benefit for net energy (startSoC→targetSoC)
 * 2. Reserve cheapest slots for mandatory net charge to reach targetSoc
 * 3. Greedily pair cheapest buy + most expensive sell for arbitrage
 * 4. Validate chronologically: walk slots in time order, track SoC, skip infeasible
 * 5. Discharge only from energy already in battery (existing SoC or prior charge)
 * 6. profitEur = loadShiftingBenefitEur + arbitrageUpliftEur
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
  const chargeKwhPerSlot = Math.min(kwhPerSlot, maxKwh)
  const dischargeKwhPerSlot = Math.min(dischargePowerKw * (kwhPerSlot / chargePowerKw), maxKwh)

  // Net kWh needed to reach target from start
  const netNeededKwh = Math.max(0, targetKwh - startKwh)

  // ── Load shifting benefit (V1G-equivalent for net energy) ──
  let loadShiftingBenefitEur = 0
  let baselineChargeCostEur = 0
  let optimizedChargeCostEur = 0
  if (netNeededKwh > 0) {
    const ls = computeWindowSavings(windowPrices, netNeededKwh, chargeKwhPerSlot, 1)
    baselineChargeCostEur = Math.round(ls.bAvg * netNeededKwh / 100 * 1000) / 1000
    optimizedChargeCostEur = Math.round(ls.oAvg * netNeededKwh / 100 * 1000) / 1000
    loadShiftingBenefitEur = baselineChargeCostEur - optimizedChargeCostEur
  }

  // ── Greedy pairing: find optimal charge/discharge assignment ──
  const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  const slotKey = (p: HourlyPrice) => `${p.date}-${p.hour}-${p.minute ?? 0}`

  // Reserve cheapest slots for net charging
  const netChargeSlotsNeeded = Math.ceil(netNeededKwh / chargeKwhPerSlot)
  const netChargeSlots = sorted.slice(0, netChargeSlotsNeeded)
  const netChargeKeys = new Set(netChargeSlots.map(slotKey))

  // From remaining slots, find profitable arbitrage pairs
  const remaining = sorted.filter(p => !netChargeKeys.has(slotKey(p)))
  const buyLow = [...remaining]
  const sellHigh = [...remaining].reverse()
  const candidateChargeSlots: HourlyPrice[] = []
  const candidateDischargeSlots: HourlyPrice[] = []
  const usedKeys = new Set<string>()
  const usableBatteryKwh = maxKwh - minKwh
  let currentCycleKwh = 0
  let bIdx = 0

  for (const sell of sellHigh) {
    const sk = slotKey(sell)
    if (usedKeys.has(sk)) continue
    while (bIdx < buyLow.length) {
      const bk = slotKey(buyLow[bIdx])
      if (!usedKeys.has(bk) && bk !== sk) break
      bIdx++
    }
    if (bIdx >= buyLow.length) break
    const buy = buyLow[bIdx]
    const profit = sell.priceCtKwh - (buy.priceCtKwh / roundTripEfficiency) - degradationCtKwh
    if (profit <= 0) break
    const tradeKwh = Math.min(dischargeKwhPerSlot, chargeKwhPerSlot)
    if (currentCycleKwh + tradeKwh > usableBatteryKwh) currentCycleKwh = 0
    candidateDischargeSlots.push(sell)
    candidateChargeSlots.push(buy)
    usedKeys.add(sk)
    usedKeys.add(slotKey(buy))
    currentCycleKwh += tradeKwh
    bIdx++
  }

  // ── Chronological validation: walk in time order, enforce SoC constraints ──
  const assignmentMap = new Map<string, 'netCharge' | 'arbCharge' | 'discharge'>()
  for (const p of netChargeSlots) assignmentMap.set(slotKey(p), 'netCharge')
  for (const p of candidateChargeSlots) assignmentMap.set(slotKey(p), 'arbCharge')
  for (const p of candidateDischargeSlots) assignmentMap.set(slotKey(p), 'discharge')

  const execCharge: HourlyPrice[] = []
  const execDischarge: HourlyPrice[] = []
  let socKwh = startKwh
  let minSocKwh = startKwh

  for (const slot of windowPrices) {
    const key = slotKey(slot)
    const action = assignmentMap.get(key)
    if (action === 'discharge' && socKwh - dischargeKwhPerSlot >= minKwh - 0.01) {
      execDischarge.push(slot)
      socKwh -= dischargeKwhPerSlot
      socKwh = Math.max(socKwh, minKwh)
      minSocKwh = Math.min(minSocKwh, socKwh)
    } else if ((action === 'netCharge' || action === 'arbCharge') && socKwh + chargeKwhPerSlot <= maxKwh + 0.01) {
      execCharge.push(slot)
      socKwh = Math.min(socKwh + chargeKwhPerSlot, maxKwh)
    }
  }

  // Post-processing: if targetSoc not reached, add cheapest unused charge slots
  if (socKwh < targetKwh - 0.01) {
    const execKeys = new Set([...execCharge.map(slotKey), ...execDischarge.map(slotKey)])
    const available = sorted.filter(p => !execKeys.has(slotKey(p)))
    for (const slot of available) {
      if (socKwh >= targetKwh - 0.01) break
      if (socKwh + chargeKwhPerSlot <= maxKwh + 0.01) {
        execCharge.push(slot)
        socKwh = Math.min(socKwh + chargeKwhPerSlot, maxKwh)
      }
    }
  }

  // ── Financials ──
  const totalChargedKwh = execCharge.length * chargeKwhPerSlot
  const totalDischargedKwh = execDischarge.length * dischargeKwhPerSlot

  const chargeAvgCt = execCharge.length > 0
    ? execCharge.reduce((s, p) => s + p.priceCtKwh, 0) / execCharge.length : 0
  const dischargeAvgCt = execDischarge.length > 0
    ? execDischarge.reduce((s, p) => s + p.priceCtKwh, 0) / execDischarge.length : 0

  const dischargeRevenueEur = execDischarge.reduce((s, p) => s + p.priceCtKwh * dischargeKwhPerSlot, 0) / 100
  const degradationCostEur = degradationCtKwh * totalDischargedKwh / 100

  // Split charge into net vs arb: cheapest executed charges are "net", rest are "arb recharge"
  const sortedExecCharge = [...execCharge].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  const arbChargeExec = sortedExecCharge.slice(Math.min(netChargeSlotsNeeded, sortedExecCharge.length))
  const netChargeExec = sortedExecCharge.slice(0, Math.min(netChargeSlotsNeeded, sortedExecCharge.length))

  const netChargeCostEur = netChargeExec.reduce((s, p) => s + p.priceCtKwh * chargeKwhPerSlot, 0) / 100
  const arbChargeCostEur = arbChargeExec.reduce((s, p) => s + p.priceCtKwh * chargeKwhPerSlot / roundTripEfficiency, 0) / 100

  // Arbitrage uplift: discharge revenue - arb recharge cost - degradation
  const arbitrageUpliftEur = Math.max(0, dischargeRevenueEur - arbChargeCostEur - degradationCostEur)

  // Total benefit = load shifting + arbitrage
  const profitEur = loadShiftingBenefitEur + arbitrageUpliftEur

  const endSoc = Math.min(100, Math.max(0, socKwh / batteryKwh * 100))

  const chargeKeys = new Set(execCharge.map(slotKey))
  const dischargeKeys = new Set(execDischarge.map(slotKey))
  const netChargeKeysSet = new Set(netChargeExec.map(slotKey))
  const arbChargeKeysSet = new Set(arbChargeExec.map(slotKey))

  return {
    chargeSlots: execCharge,
    dischargeSlots: execDischarge,
    chargeAvgCt,
    dischargeAvgCt,
    totalChargedKwh,
    totalDischargedKwh,
    netEnergyKwh: totalChargedKwh - totalDischargedKwh,
    chargeCostEur: netChargeCostEur + arbChargeCostEur,
    dischargeRevenueEur,
    degradationCostEur,
    profitEur,
    profitCtKwh: totalDischargedKwh > 0 ? arbitrageUpliftEur * 100 / totalDischargedKwh : 0,
    loadShiftingBenefitEur,
    arbitrageUpliftEur,
    baselineChargeCostEur,
    optimizedChargeCostEur,
    startSoc: startSocPercent,
    endSoc,
    minSocReached: Math.min(100, Math.max(0, minSocKwh / batteryKwh * 100)),
    dischargeKeys,
    chargeKeys,
    netChargeKeys: netChargeKeysSet,
    arbChargeKeys: arbChargeKeysSet,
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
