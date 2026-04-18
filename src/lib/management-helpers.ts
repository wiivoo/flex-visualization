/**
 * Management Dashboard — pure aggregation & reconciliation helpers (PROJ-40).
 *
 * All functions are pure: no I/O, no React. Inputs are SMARD raw QH points
 * with price in EUR/MWh. Internally converted to ct/kWh (`price / 10`) before
 * aggregation, per CLAUDE.md price convention.
 *
 * Used at build/CI time by `scripts/precompute-management-monthly.mjs`
 * (math duplicated there — keep in sync) and at runtime by the /management
 * route to recompute session × kWh × spread on settings changes.
 */

import type {
  ManagementScenario,
  MonthlyAggregate,
  YoyDatum,
  ExplainerData,
} from './management-config'

/** One quarter-hour price point (SMARD raw — EUR/MWh). */
export interface QhPricePoint {
  /** ISO timestamp or epoch ms serialised as string; anything `new Date(ts)` parses. */
  ts: string
  /** Price in EUR/MWh. */
  price: number
}

const QH_PER_DAY = 96

/** Parse "HH:MM" → quarter-hour index (0..95). "18:00" → 72, "06:00" → 24. */
export function hhmmToQhIndex(hhmm: string): number {
  if (typeof hhmm !== 'string') throw new Error(`Invalid HH:MM: ${String(hhmm)}`)
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) throw new Error(`Invalid HH:MM: ${hhmm}`)
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`Invalid HH:MM: ${hhmm}`)
  }
  return (h * 4) + Math.floor(mm / 15)
}

/**
 * Count quarter-hour slots in a [startQh..endQh] window (both inclusive).
 * Wraps past midnight when endQh < startQh.
 */
function windowQhCount(startQh: number, endQh: number): number {
  if (endQh >= startQh) return endQh - startQh + 1
  return (QH_PER_DAY - startQh) + (endQh + 1)
}

/**
 * Return true when `qhIndex` lies within [startQh..endQh], inclusive, with
 * wrap-around when endQh < startQh.
 */
function qhInWindow(qhIndex: number, startQh: number, endQh: number): boolean {
  if (endQh >= startQh) return qhIndex >= startQh && qhIndex <= endQh
  return qhIndex >= startQh || qhIndex <= endQh
}

/**
 * Charging window for the scenario: plug-in → departure. Inclusive QH indices.
 * endQh is the last QH before departure (departureQh − 1, wrapped when needed).
 * When departure ≤ plug-in, the window wraps past midnight (endQh < startQh).
 */
export function chargingWindowQh(scenario: ManagementScenario): { startQh: number; endQh: number } {
  const startQh = hhmmToQhIndex(scenario.plugInTime)
  const departureQh = hhmmToQhIndex(scenario.departureTime)
  const endQh = (departureQh - 1 + QH_PER_DAY) % QH_PER_DAY
  return { startQh, endQh }
}

/**
 * Baseline "dumb" window: starts at plug-in and fills at charge power until
 * the session's energy need is met (or battery capacity reached). Inclusive
 * QH indices, wraps past midnight.
 */
export function baselineWindowQh(scenario: ManagementScenario): { startQh: number; endQh: number } {
  const startQh = hhmmToQhIndex(scenario.plugInTime)
  const energyKwh = energyPerSession(scenario)
  const kwhPerQh = scenario.chargePowerKw * 0.25
  const slotsNeeded = kwhPerQh > 0 ? Math.max(1, Math.ceil(energyKwh / kwhPerQh)) : 1
  const endQh = (startQh + slotsNeeded - 1) % QH_PER_DAY
  return { startQh, endQh }
}

/**
 * Energy per session (kWh): min(batteryCapacityKwh, chargePowerKw × windowHours).
 * Handles wrap-around windows correctly.
 */
export function energyPerSession(scenario: ManagementScenario): number {
  const { startQh, endQh } = chargingWindowQh(scenario)
  const slots = windowQhCount(startQh, endQh)
  const windowHours = slots * 0.25
  const raw = scenario.chargePowerKw * windowHours
  return Math.min(scenario.batteryCapacityKwh, raw)
}

// Identify YYYY-MM and day-of-month from any timestamp a Date() can parse.
interface DayBucket {
  monthKey: string
  year: number
  month: number
  dayOfMonth: number
  qhByIndex: Map<number, number> // qhIndex → price in ct/kWh (last write wins if duplicate ts)
}

interface MonthBucket {
  year: number
  month: number
  monthKey: string
  days: Map<string, DayBucket> // dateKey YYYY-MM-DD → bucket
  allPricesCtKwh: number[]
}

/** Group QH points by month and by day-of-month; timestamps interpreted as UTC. */
function groupByMonth(qhPrices: QhPricePoint[]): Map<string, MonthBucket> {
  const months = new Map<string, MonthBucket>()
  for (const point of qhPrices) {
    const d = new Date(point.ts)
    if (Number.isNaN(d.getTime())) continue
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const hour = d.getUTCHours()
    const minute = d.getUTCMinutes()
    const qhIndex = (hour * 4) + Math.floor(minute / 15)
    const monthKey = `${year}-${String(month).padStart(2, '0')}`
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`

    let mb = months.get(monthKey)
    if (!mb) {
      mb = { year, month, monthKey, days: new Map(), allPricesCtKwh: [] }
      months.set(monthKey, mb)
    }
    let db = mb.days.get(dateKey)
    if (!db) {
      db = { monthKey, year, month, dayOfMonth: day, qhByIndex: new Map() }
      mb.days.set(dateKey, db)
    }
    const ctKwh = point.price / 10
    db.qhByIndex.set(qhIndex, ctKwh)
    mb.allPricesCtKwh.push(ctKwh)
  }
  return months
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/**
 * Group prices by YYYY-MM and compute monthly aggregates under the fixed scenario.
 *
 * - avgSpreadCtKwh: mean across days of (max − min of QH prices inside the
 *   charging window), in ct/kWh. Days with no QH observations in the window
 *   are skipped.
 * - savingsEur: avgSpreadCtKwh/100 × energyPerSessionKwh × sessionsInMonth.
 * - sessionsInMonth: sessionsPerWeek × (daysInMonth / 7), rounded to 1 decimal.
 * - avgDayAheadCtKwh: mean across all QH points observed in the month.
 */
export function aggregateMonthly(
  qhPrices: QhPricePoint[],
  scenario: ManagementScenario,
): MonthlyAggregate[] {
  if (!qhPrices || qhPrices.length === 0) return []

  const { startQh, endQh } = chargingWindowQh(scenario)
  const energyKwh = energyPerSession(scenario)
  const months = groupByMonth(qhPrices)

  const out: MonthlyAggregate[] = []
  for (const mb of months.values()) {
    const dayCount = daysInMonth(mb.year, mb.month)
    const sessionsInMonth = round1(scenario.sessionsPerWeek * (dayCount / 7))

    // Per-day spread inside the charging window.
    let spreadSum = 0
    let spreadDays = 0
    for (const db of mb.days.values()) {
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      let count = 0
      for (const [qh, ctKwh] of db.qhByIndex) {
        if (!qhInWindow(qh, startQh, endQh)) continue
        if (ctKwh < min) min = ctKwh
        if (ctKwh > max) max = ctKwh
        count++
      }
      if (count >= 2) {
        spreadSum += (max - min)
        spreadDays++
      }
    }
    const avgSpreadCtKwh = spreadDays > 0 ? spreadSum / spreadDays : 0

    const avgDayAheadCtKwh = mb.allPricesCtKwh.length > 0
      ? mb.allPricesCtKwh.reduce((s, v) => s + v, 0) / mb.allPricesCtKwh.length
      : 0

    const savingsEur = reconcile(avgSpreadCtKwh, energyKwh, sessionsInMonth)

    out.push({
      year: mb.year,
      month: mb.month,
      monthKey: mb.monthKey,
      avgSpreadCtKwh: round2(avgSpreadCtKwh),
      energyPerSessionKwh: round2(energyKwh),
      sessionsInMonth,
      savingsEur: round2(savingsEur),
      avgDayAheadCtKwh: round2(avgDayAheadCtKwh),
    })
  }

  out.sort((a, b) => (a.monthKey < b.monthKey ? -1 : a.monthKey > b.monthKey ? 1 : 0))
  return out
}

/** Build YoY pairs for two years, aligned by month-of-year (1..12). */
export function computeYoy(
  monthly: MonthlyAggregate[],
  yearA: number,
  yearB: number,
): YoyDatum[] {
  const byYearMonth = new Map<string, MonthlyAggregate>()
  for (const m of monthly) byYearMonth.set(`${m.year}-${m.month}`, m)

  const out: YoyDatum[] = []
  for (let month = 1; month <= 12; month++) {
    const a = byYearMonth.get(`${yearA}-${month}`)
    const b = byYearMonth.get(`${yearB}-${month}`)
    const valueA = a ? a.savingsEur : 0
    const valueB = b ? b.savingsEur : 0
    const deltaPct = valueA === 0 ? null : round2(((valueB - valueA) / valueA) * 100)
    out.push({
      monthKey: `${yearB}-${String(month).padStart(2, '0')}`,
      yearA,
      yearB,
      valueA: round2(valueA),
      valueB: round2(valueB),
      deltaPct,
    })
  }
  return out
}

/**
 * Build an ExplainerData for the given "YYYY-MM". Profile is the average
 * ct/kWh at each of the 96 QH slots across every day in the month that has
 * data for that slot. Spread comes from max-min of the profile inside the
 * charging window.
 */
export function computeExplainer(
  qhPrices: QhPricePoint[],
  monthKey: string,
  scenario: ManagementScenario,
): ExplainerData {
  const chargingWindow = chargingWindowQh(scenario)
  const baselineWindow = baselineWindowQh(scenario)
  const energyKwh = energyPerSession(scenario)

  const emptyProfile: ExplainerData['avgQhProfile'] = []
  if (!qhPrices || qhPrices.length === 0 || !monthKey) {
    return {
      monthKey: monthKey || '',
      avgQhProfile: emptyProfile,
      chargingWindow,
      baselineWindow,
      spreadCtKwh: 0,
      energyPerSessionKwh: round2(energyKwh),
      sessionsInMonth: 0,
      reconciledSavingsEur: 0,
    }
  }

  // Only keep prices from the requested month.
  const monthPrices = qhPrices.filter((p) => {
    const d = new Date(p.ts)
    if (Number.isNaN(d.getTime())) return false
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}` === monthKey
  })

  if (monthPrices.length === 0) {
    return {
      monthKey,
      avgQhProfile: emptyProfile,
      chargingWindow,
      baselineWindow,
      spreadCtKwh: 0,
      energyPerSessionKwh: round2(energyKwh),
      sessionsInMonth: 0,
      reconciledSavingsEur: 0,
    }
  }

  // Sum and count per QH index.
  const sums = new Array<number>(QH_PER_DAY).fill(0)
  const counts = new Array<number>(QH_PER_DAY).fill(0)
  for (const p of monthPrices) {
    const d = new Date(p.ts)
    const hour = d.getUTCHours()
    const minute = d.getUTCMinutes()
    const qh = (hour * 4) + Math.floor(minute / 15)
    sums[qh] += p.price / 10
    counts[qh] += 1
  }

  const avgQhProfile: ExplainerData['avgQhProfile'] = []
  for (let qh = 0; qh < QH_PER_DAY; qh++) {
    const ctKwh = counts[qh] > 0 ? round2(sums[qh] / counts[qh]) : 0
    avgQhProfile.push({ qhIndex: qh, ctKwh })
  }

  // Spread: max − min of profile across the charging window (wrap-aware).
  let profileMin = Number.POSITIVE_INFINITY
  let profileMax = Number.NEGATIVE_INFINITY
  for (let qh = 0; qh < QH_PER_DAY; qh++) {
    if (!qhInWindow(qh, chargingWindow.startQh, chargingWindow.endQh)) continue
    if (counts[qh] === 0) continue
    const v = sums[qh] / counts[qh]
    if (v < profileMin) profileMin = v
    if (v > profileMax) profileMax = v
  }
  const spreadCtKwh = (Number.isFinite(profileMin) && Number.isFinite(profileMax))
    ? profileMax - profileMin
    : 0

  // Sessions in this month.
  const [yearStr, monthStr] = monthKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const dayCount = (Number.isFinite(year) && Number.isFinite(month))
    ? daysInMonth(year, month)
    : 0
  const sessionsInMonth = round1(scenario.sessionsPerWeek * (dayCount / 7))

  const reconciledSavingsEur = reconcile(spreadCtKwh, energyKwh, sessionsInMonth)

  return {
    monthKey,
    avgQhProfile,
    chargingWindow,
    baselineWindow,
    spreadCtKwh: round2(spreadCtKwh),
    energyPerSessionKwh: round2(energyKwh),
    sessionsInMonth,
    reconciledSavingsEur: round2(reconciledSavingsEur),
  }
}

/**
 * Reconciliation identity: spreadCtKwh/100 × energyPerSessionKwh × sessionsInMonth.
 * Kept as its own export so tests and UI can verify the headline number
 * against the explainer within the 1% tolerance mandated by the spec.
 */
export function reconcile(
  spreadCtKwh: number,
  energyPerSessionKwh: number,
  sessionsInMonth: number,
): number {
  if (!Number.isFinite(spreadCtKwh) || !Number.isFinite(energyPerSessionKwh) || !Number.isFinite(sessionsInMonth)) {
    return 0
  }
  return (spreadCtKwh / 100) * energyPerSessionKwh * sessionsInMonth
}
