/**
 * Insights sweep — inverse of the dashboard.
 *
 * The dashboard answers "what are the savings for THIS customer?".
 * These functions answer "which customer parameters maximize savings?".
 *
 * Both views share one engine: build the overnight windows once, then loop
 * over the parameter grid and aggregate yearly savings per cell using the
 * existing computeWindowSavings primitive.
 */
import type { HourlyPrice } from '@/lib/v2-config'
import { deriveEnergyPerSession } from '@/lib/v2-config'
import { buildOvernightWindows, computeWindowSavings } from '@/lib/charging-helpers'

export interface SweepCell {
  yearlySavingsEur: number
  avgSpreadCt: number
  energyPerSessionKwh: number
  daysSampled: number
}

export interface MileageWindowGrid {
  mileages: number[]
  windowLengths: number[]
  cells: SweepCell[][] // cells[mileageIdx][windowLengthIdx]
  pinnedPlugInTime: number
  pinnedPlugInsPerWeek: number
  pinnedChargePowerKw: number
  rangeLabel: string
}

export interface DateRange {
  start: string // YYYY-MM-DD inclusive
  end: string   // YYYY-MM-DD inclusive
  label: string
}

export interface SweepPoint {
  x: number
  yearlySavingsEur: number
  energyPerSessionKwh: number
}

export interface SensitivitySeries {
  mileage: SweepPoint[]
  plugInTime: SweepPoint[]
  windowLength: SweepPoint[]
  chargePower: SweepPoint[]
  pinned: PinnedDefaults
  rangeLabel: string
}

export interface PinnedDefaults {
  yearlyMileageKm: number
  plugInTime: number
  windowLengthHours: number
  chargePowerKw: number
  plugInsPerWeek: number
}

/** Wrap an hour into 0–23 range. */
function wrapHour(h: number): number {
  const m = h % 24
  return m < 0 ? m + 24 : m
}

/**
 * Build insights windows that respect the requested window length. When
 * plugInTime + windowLengthHours ≤ 24 the session stays on one calendar day,
 * otherwise it rolls into the next morning. `buildOvernightWindows` always
 * crosses midnight, which is wrong for short evening windows, so we branch.
 */
function buildInsightsWindows(
  hourlyPrices: HourlyPrice[],
  plugInTime: number,
  windowLengthHours: number,
): Array<{ date: string; month: string; prices: HourlyPrice[] }> {
  const total = plugInTime + windowLengthHours
  if (total <= 24) {
    // Same-day window: collect hours [plugIn, plugIn+len) on each day.
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of hourlyPrices) {
      if (p.hour >= plugInTime && p.hour < total) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
    }
    const out: Array<{ date: string; month: string; prices: HourlyPrice[] }> = []
    for (const [date, prices] of byDate) {
      if (prices.length === 0) continue
      out.push({ date, month: date.slice(0, 7), prices })
    }
    return out
  }
  // Overnight window: reuse the shared helper (it crosses midnight correctly).
  const departureTime = wrapHour(total)
  return buildOvernightWindows(hourlyPrices, plugInTime, departureTime).map(w => ({
    date: w.date,
    month: w.month,
    prices: w.prices,
  }))
}

/**
 * Aggregate yearly savings for a single (mileage, plugInTime, windowLength,
 * chargePowerKw) tuple by looping over windows inside the requested date range.
 *
 * Yearly = avg savings per session × sessions per year (= plugInsPerWeek × 52).
 */
function aggregateYearly(
  hourlyPrices: HourlyPrice[],
  yearlyMileageKm: number,
  plugInTime: number,
  windowLengthHours: number,
  chargePowerKw: number,
  plugInsPerWeek: number,
  dateRange?: DateRange,
): SweepCell {
  const windows = buildInsightsWindows(hourlyPrices, plugInTime, windowLengthHours)
  if (windows.length === 0) {
    return { yearlySavingsEur: 0, avgSpreadCt: 0, energyPerSessionKwh: 0, daysSampled: 0 }
  }

  let sample
  if (dateRange) {
    sample = windows.filter(w => w.date >= dateRange.start && w.date <= dateRange.end)
  } else {
    // Fallback: last 12 months of available data.
    const allMonths = [...new Set(windows.map(w => w.month))].sort()
    const last12 = new Set(allMonths.slice(-12))
    sample = windows.filter(w => last12.has(w.month))
  }

  const eps = deriveEnergyPerSession(yearlyMileageKm, plugInsPerWeek, 0)
  const slotsNeeded = Math.ceil(eps / chargePowerKw)

  let totalSavPerSession = 0
  let totalSpread = 0
  let days = 0
  for (const w of sample) {
    if (w.prices.length < slotsNeeded) continue
    const r = computeWindowSavings(w.prices, eps, chargePowerKw, 1)
    totalSavPerSession += r.savingsEur
    totalSpread += r.bAvg - r.oAvg
    days++
  }

  if (days === 0) {
    return { yearlySavingsEur: 0, avgSpreadCt: 0, energyPerSessionKwh: eps, daysSampled: 0 }
  }

  const avgSavPerSession = totalSavPerSession / days
  const yearlySav = avgSavPerSession * plugInsPerWeek * 52
  const avgSpreadCt = Math.round((totalSpread / days) * 100) / 100

  return {
    yearlySavingsEur: Math.round(yearlySav * 100) / 100,
    avgSpreadCt,
    energyPerSessionKwh: eps,
    daysSampled: days,
  }
}

/** BD heatmap: mileage × plug-in window length. */
export function sweepMileageByWindowLength(
  hourlyPrices: HourlyPrice[],
  pinnedPlugInTime: number,
  pinnedChargePowerKw: number,
  pinnedPlugInsPerWeek: number,
  dateRange?: DateRange,
): MileageWindowGrid {
  const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
  const windowLengths = [4, 6, 8, 10, 12, 14]

  const cells: SweepCell[][] = mileages.map(mil =>
    windowLengths.map(len =>
      aggregateYearly(hourlyPrices, mil, pinnedPlugInTime, len, pinnedChargePowerKw, pinnedPlugInsPerWeek, dateRange),
    ),
  )

  return {
    mileages,
    windowLengths,
    cells,
    pinnedPlugInTime,
    pinnedPlugInsPerWeek,
    pinnedChargePowerKw,
    rangeLabel: dateRange?.label ?? 'last 12 months',
  }
}

/** Product sensitivity: 4 single-axis sweeps with all other params pinned. */
export function sweepSensitivity(
  hourlyPrices: HourlyPrice[],
  pinned: PinnedDefaults,
  dateRange?: DateRange,
): SensitivitySeries {
  const { yearlyMileageKm, plugInTime, windowLengthHours, chargePowerKw, plugInsPerWeek } = pinned

  // Mileage axis: 5k–40k step 5k.
  const mileageRange = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
  const mileage: SweepPoint[] = mileageRange.map(m => {
    const c = aggregateYearly(hourlyPrices, m, plugInTime, windowLengthHours, chargePowerKw, plugInsPerWeek, dateRange)
    return { x: m, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Plug-in time axis: 14:00–22:00.
  const plugInTimeRange = [14, 15, 16, 17, 18, 19, 20, 21, 22]
  const plugInTimeSeries: SweepPoint[] = plugInTimeRange.map(t => {
    const c = aggregateYearly(hourlyPrices, yearlyMileageKm, t, windowLengthHours, chargePowerKw, plugInsPerWeek, dateRange)
    return { x: t, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Window length axis: 4–14h.
  const windowLengthRange = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  const windowLength: SweepPoint[] = windowLengthRange.map(len => {
    const c = aggregateYearly(hourlyPrices, yearlyMileageKm, plugInTime, len, chargePowerKw, plugInsPerWeek, dateRange)
    return { x: len, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Charge power axis: discrete wallbox sizes.
  const chargePowerRange = [3.7, 7, 11, 22]
  const chargePower: SweepPoint[] = chargePowerRange.map(p => {
    const c = aggregateYearly(hourlyPrices, yearlyMileageKm, plugInTime, windowLengthHours, p, plugInsPerWeek, dateRange)
    return { x: p, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  return { mileage, plugInTime: plugInTimeSeries, windowLength, chargePower, pinned, rangeLabel: dateRange?.label ?? 'last 12 months' }
}

/* ── Fleet mode sweep ───────────────────────────────────────────────────── */

export interface FleetSweepParams {
  fleetSize: number
  arrivalMin: number
  arrivalMax: number
  arrivalAvg: number
  departureMin: number
  departureMax: number
  departureAvg: number
  spreadMode: 'off' | 'narrow' | 'normal' | 'wide'
  mileageMin: number
  mileageMax: number
  chargePowerKw: number
  plugInsPerWeek: number
}

/** Bell-curve probability distribution over integer hours [lo..hi], centered on avg. */
function bellWeights(lo: number, hi: number, avg: number, mode: FleetSweepParams['spreadMode']): Map<number, number> {
  const out = new Map<number, number>()
  if (hi < lo) return out
  if (mode === 'off') {
    out.set(avg, 1)
    return out
  }
  const sigma = mode === 'narrow' ? 0.8 : mode === 'wide' ? 2.5 : 1.5
  let total = 0
  for (let h = lo; h <= hi; h++) {
    const w = Math.exp(-0.5 * ((h - avg) / sigma) ** 2)
    out.set(h, w)
    total += w
  }
  if (total > 0) {
    for (const [k, v] of out) out.set(k, v / total)
  }
  return out
}

/** Mileage distribution as 3 discrete samples (low/mid/high) with equal weight. */
function mileageSamples(lo: number, hi: number): { km: number; w: number }[] {
  if (hi <= lo) return [{ km: lo, w: 1 }]
  const mid = Math.round((lo + hi) / 2)
  return [
    { km: lo, w: 1 / 3 },
    { km: mid, w: 1 / 3 },
    { km: hi, w: 1 / 3 },
  ]
}

/**
 * Aggregate yearly fleet savings for a given (arrival, departure, mileage) distribution
 * at a particular pinned (chargePower, plugInsPerWeek) setting. Returns total fleet €/yr.
 */
function aggregateFleetYearly(
  hourlyPrices: HourlyPrice[],
  arrivalDist: Map<number, number>,
  departureDist: Map<number, number>,
  mileageDist: { km: number; w: number }[],
  chargePowerKw: number,
  plugInsPerWeek: number,
  fleetSize: number,
  dateRange?: DateRange,
): SweepCell {
  let totalSav = 0
  let totalSpread = 0
  let totalEps = 0
  let daysMax = 0
  for (const [arrHour, arrW] of arrivalDist) {
    if (arrW <= 0) continue
    for (const [depHour, depW] of departureDist) {
      if (depW <= 0) continue
      const windowLen = ((depHour - arrHour) + 24) % 24 || 24
      for (const m of mileageDist) {
        const w = arrW * depW * m.w
        if (w <= 0) continue
        const cell = aggregateYearly(hourlyPrices, m.km, arrHour, windowLen, chargePowerKw, plugInsPerWeek, dateRange)
        totalSav += cell.yearlySavingsEur * w
        totalSpread += cell.avgSpreadCt * w
        totalEps += cell.energyPerSessionKwh * w
        if (cell.daysSampled > daysMax) daysMax = cell.daysSampled
      }
    }
  }
  return {
    yearlySavingsEur: Math.round(totalSav * fleetSize * 100) / 100,
    avgSpreadCt: Math.round(totalSpread * 100) / 100,
    energyPerSessionKwh: Math.round(totalEps * 100) / 100,
    daysSampled: daysMax,
  }
}

/** Fleet heatmap: mileage × plug-in window length (window length = departureAvg - arrivalAvg). */
export function sweepFleetMileageByWindowLength(
  hourlyPrices: HourlyPrice[],
  fleet: FleetSweepParams,
  dateRange?: DateRange,
): MileageWindowGrid {
  const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
  const windowLengths = [4, 6, 8, 10, 12, 14]

  const arrivalDist = bellWeights(fleet.arrivalMin, fleet.arrivalMax, fleet.arrivalAvg, fleet.spreadMode)

  const cells: SweepCell[][] = mileages.map(mil =>
    windowLengths.map(len => {
      // Force departure = arrivalAvg + len (mod 24) → single departure hour for this axis
      const depHour = ((fleet.arrivalAvg + len) + 24) % 24
      const depDist = new Map<number, number>([[depHour, 1]])
      const mileageDist = mileageSamples(mil, mil)
      return aggregateFleetYearly(
        hourlyPrices,
        arrivalDist,
        depDist,
        mileageDist,
        fleet.chargePowerKw,
        fleet.plugInsPerWeek,
        fleet.fleetSize,
        dateRange,
      )
    }),
  )

  return {
    mileages,
    windowLengths,
    cells,
    pinnedPlugInTime: fleet.arrivalAvg,
    pinnedPlugInsPerWeek: fleet.plugInsPerWeek,
    pinnedChargePowerKw: fleet.chargePowerKw,
    rangeLabel: dateRange?.label ?? 'last 12 months',
  }
}

/** Fleet sensitivity: 4 single-axis sweeps with all distributions held. */
export function sweepFleetSensitivity(
  hourlyPrices: HourlyPrice[],
  fleet: FleetSweepParams,
  dateRange?: DateRange,
): SensitivitySeries {
  const arrivalDist = bellWeights(fleet.arrivalMin, fleet.arrivalMax, fleet.arrivalAvg, fleet.spreadMode)
  const departureDist = bellWeights(fleet.departureMin, fleet.departureMax, fleet.departureAvg, fleet.spreadMode)
  const mileageDist = mileageSamples(fleet.mileageMin, fleet.mileageMax)
  const pinnedWindowLen = ((fleet.departureAvg - fleet.arrivalAvg) + 24) % 24 || 24

  // Mileage axis: sweep avg mileage (single-point distribution per cell)
  const mileageRange = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
  const mileage: SweepPoint[] = mileageRange.map(m => {
    const c = aggregateFleetYearly(
      hourlyPrices, arrivalDist, departureDist, mileageSamples(m, m),
      fleet.chargePowerKw, fleet.plugInsPerWeek, fleet.fleetSize, dateRange,
    )
    return { x: m, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Arrival-time axis: shift the arrival distribution centre
  const arrRange = [14, 15, 16, 17, 18, 19, 20, 21, 22]
  const plugInTimeSeries: SweepPoint[] = arrRange.map(t => {
    const shifted = bellWeights(fleet.arrivalMin, fleet.arrivalMax, t, fleet.spreadMode)
    const c = aggregateFleetYearly(
      hourlyPrices, shifted, departureDist, mileageDist,
      fleet.chargePowerKw, fleet.plugInsPerWeek, fleet.fleetSize, dateRange,
    )
    return { x: t, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Window-length axis: departure = arrivalAvg + len
  const windowLengthRange = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  const windowLength: SweepPoint[] = windowLengthRange.map(len => {
    const depHour = ((fleet.arrivalAvg + len) + 24) % 24
    const depDist = new Map<number, number>([[depHour, 1]])
    const c = aggregateFleetYearly(
      hourlyPrices, arrivalDist, depDist, mileageDist,
      fleet.chargePowerKw, fleet.plugInsPerWeek, fleet.fleetSize, dateRange,
    )
    return { x: len, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Charge-power axis
  const chargePowerRange = [3.7, 7, 11, 22]
  const chargePower: SweepPoint[] = chargePowerRange.map(p => {
    const c = aggregateFleetYearly(
      hourlyPrices, arrivalDist, departureDist, mileageDist,
      p, fleet.plugInsPerWeek, fleet.fleetSize, dateRange,
    )
    return { x: p, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  return {
    mileage,
    plugInTime: plugInTimeSeries,
    windowLength,
    chargePower,
    pinned: {
      yearlyMileageKm: Math.round((fleet.mileageMin + fleet.mileageMax) / 2),
      plugInTime: fleet.arrivalAvg,
      windowLengthHours: pinnedWindowLen,
      chargePowerKw: fleet.chargePowerKw,
      plugInsPerWeek: fleet.plugInsPerWeek,
    },
    rangeLabel: dateRange?.label ?? 'last 12 months',
  }
}

/** Locate the best cell in a mileage × window-length grid (for the BD callout). */
export function findBestCell(grid: MileageWindowGrid): {
  mileage: number
  windowLengthHours: number
  yearlySavingsEur: number
} | null {
  let best: { mileage: number; windowLengthHours: number; yearlySavingsEur: number } | null = null
  for (let i = 0; i < grid.mileages.length; i++) {
    for (let j = 0; j < grid.windowLengths.length; j++) {
      const cell = grid.cells[i][j]
      if (!best || cell.yearlySavingsEur > best.yearlySavingsEur) {
        best = {
          mileage: grid.mileages[i],
          windowLengthHours: grid.windowLengths[j],
          yearlySavingsEur: cell.yearlySavingsEur,
        }
      }
    }
  }
  return best
}
