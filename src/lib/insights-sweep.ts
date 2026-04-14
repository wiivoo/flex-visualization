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
 * Aggregate yearly savings for a single (mileage, plugInTime, windowLength,
 * chargePowerKw) tuple by looping over the last 12 months of overnight windows.
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
): SweepCell {
  const departureTime = wrapHour(plugInTime + windowLengthHours)
  const windows = buildOvernightWindows(hourlyPrices, plugInTime, departureTime)
  if (windows.length === 0) {
    return { yearlySavingsEur: 0, avgSpreadCt: 0, energyPerSessionKwh: 0, daysSampled: 0 }
  }

  // Restrict to the last 12 months of available data (matches the dashboard heatmap convention).
  const allMonths = [...new Set(windows.map(w => w.month))].sort()
  const last12 = new Set(allMonths.slice(-12))
  const sample = windows.filter(w => last12.has(w.month))

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
): MileageWindowGrid {
  const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
  const windowLengths = [4, 6, 8, 10, 12, 14]

  const cells: SweepCell[][] = mileages.map(mil =>
    windowLengths.map(len =>
      aggregateYearly(hourlyPrices, mil, pinnedPlugInTime, len, pinnedChargePowerKw, pinnedPlugInsPerWeek),
    ),
  )

  return {
    mileages,
    windowLengths,
    cells,
    pinnedPlugInTime,
    pinnedPlugInsPerWeek,
    pinnedChargePowerKw,
  }
}

/** Product sensitivity: 4 single-axis sweeps with all other params pinned. */
export function sweepSensitivity(
  hourlyPrices: HourlyPrice[],
  pinned: PinnedDefaults,
): SensitivitySeries {
  const { yearlyMileageKm, plugInTime, windowLengthHours, chargePowerKw, plugInsPerWeek } = pinned

  // Mileage axis: 5k–40k step 5k.
  const mileageRange = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
  const mileage: SweepPoint[] = mileageRange.map(m => {
    const c = aggregateYearly(hourlyPrices, m, plugInTime, windowLengthHours, chargePowerKw, plugInsPerWeek)
    return { x: m, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Plug-in time axis: 14:00–22:00.
  const plugInTimeRange = [14, 15, 16, 17, 18, 19, 20, 21, 22]
  const plugInTimeSeries: SweepPoint[] = plugInTimeRange.map(t => {
    const c = aggregateYearly(hourlyPrices, yearlyMileageKm, t, windowLengthHours, chargePowerKw, plugInsPerWeek)
    return { x: t, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Window length axis: 4–14h.
  const windowLengthRange = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]
  const windowLength: SweepPoint[] = windowLengthRange.map(len => {
    const c = aggregateYearly(hourlyPrices, yearlyMileageKm, plugInTime, len, chargePowerKw, plugInsPerWeek)
    return { x: len, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  // Charge power axis: discrete wallbox sizes.
  const chargePowerRange = [3.7, 7, 11, 22]
  const chargePower: SweepPoint[] = chargePowerRange.map(p => {
    const c = aggregateYearly(hourlyPrices, yearlyMileageKm, plugInTime, windowLengthHours, p, plugInsPerWeek)
    return { x: p, yearlySavingsEur: c.yearlySavingsEur, energyPerSessionKwh: c.energyPerSessionKwh }
  })

  return { mileage, plugInTime: plugInTimeSeries, windowLength, chargePower, pinned }
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
