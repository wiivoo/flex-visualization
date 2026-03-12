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
