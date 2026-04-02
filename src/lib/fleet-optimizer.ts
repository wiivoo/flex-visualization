/**
 * Fleet Flex Band Optimizer (PROJ-36 + PROJ-37)
 *
 * Pure functions — no React, no DOM. Computes:
 * 1. Flex band (greedy upper / lazy lower bounds) for a heterogeneous fleet
 * 2. Price-optimal aggregate schedule within the band constraints
 */
import type {
  FleetConfig, FlexBandSlot, FleetScheduleSlot, FleetOptimizationResult,
  HourlyPrice, DistributionEntry,
} from '@/lib/v2-config'
import { BATTERY_KWH_BY_CLASS } from '@/lib/v2-config'

/* ── Cohort model ── */

interface Cohort {
  arrivalHour: number
  departureHour: number   // next day
  batteryKwh: number
  chargePowerKw: number
  arrivalSocPct: number   // 0–100
  weight: number          // fraction of fleet (0–1), sum of all cohorts ≈ 1
}

/**
 * Expand fleet config into weighted cohorts.
 * Each cohort = arrival × departure × battery × power × SoC.
 * SoC is sampled at 3 points across the socMin–socMax range.
 */
function buildCohorts(config: FleetConfig): Cohort[] {
  const cohorts: Cohort[] = []
  const batteryTypes: { key: 'compact' | 'mid' | 'suv'; kwhVal: number }[] = [
    { key: 'compact', kwhVal: BATTERY_KWH_BY_CLASS.compact },
    { key: 'mid', kwhVal: BATTERY_KWH_BY_CLASS.mid },
    { key: 'suv', kwhVal: BATTERY_KWH_BY_CLASS.suv },
  ]
  const powerTypes = [
    { kw: 7, pct: config.chargePowerMix.kw7 },
    { kw: 11, pct: config.chargePowerMix.kw11 },
  ]
  // Sample SoC at 3 points (low, mid, high) across the range
  const socRange = config.socMax - config.socMin
  const socSamples = socRange > 0
    ? [config.socMin, config.socMin + socRange / 2, config.socMax]
    : [config.socMin]
  const socWeight = 1 / socSamples.length

  for (const arr of config.arrivalDist) {
    if (arr.pct <= 0) continue
    for (const dep of config.departureDist) {
      if (dep.pct <= 0) continue
      for (const bat of batteryTypes) {
        const batPct = config.batteryMix[bat.key]
        if (batPct <= 0) continue
        for (const pow of powerTypes) {
          if (pow.pct <= 0) continue
          for (const soc of socSamples) {
            const weight = (arr.pct / 100) * (dep.pct / 100) * (batPct / 100) * (pow.pct / 100) * socWeight
            if (weight < 1e-8) continue
            cohorts.push({
              arrivalHour: arr.hour,
              departureHour: dep.hour,
              batteryKwh: bat.kwhVal,
              chargePowerKw: pow.kw,
              arrivalSocPct: soc,
              weight,
            })
          }
        }
      }
    }
  }
  return cohorts
}

/* ── Flex Band Computation (PROJ-36) ── */

/**
 * Compute the flex band (greedy upper + lazy lower bounds) for a fleet
 * over the overnight window slots.
 *
 * @param config Fleet configuration
 * @param windowSlots Price slots covering the overnight window (14:00 day1 → 09:00 day2)
 * @param isQH Whether slots are quarter-hourly (true) or hourly (false)
 * @returns FlexBandSlot[] with greedyKw and lazyKw per slot
 */
export function computeFlexBand(
  config: FleetConfig,
  windowSlots: HourlyPrice[],
  isQH: boolean = false,
): FlexBandSlot[] {
  if (windowSlots.length === 0) return []

  const cohorts = buildCohorts(config)
  const slotDurationH = isQH ? 0.25 : 1
  const fleetSize = config.fleetSize

  // Build slot index: sequential position for each slot
  const slots = windowSlots.map((s, idx) => ({
    idx,
    hour: s.hour,
    minute: s.minute ?? 0,
    date: s.date,
  }))

  // For each slot, accumulate greedy and lazy kW across all cohorts
  const greedyKw = new Float64Array(slots.length)
  const lazyKw = new Float64Array(slots.length)

  for (const cohort of cohorts) {
    const energyNeededKwh = cohort.batteryKwh * (100 - cohort.arrivalSocPct) / 100
    const kwhPerSlot = cohort.chargePowerKw * slotDurationH
    const slotsNeeded = Math.ceil(energyNeededKwh / kwhPerSlot)
    if (slotsNeeded <= 0) continue

    // Find arrival and departure slot indices
    const arrIdx = findSlotIndex(slots, cohort.arrivalHour, 0)
    const depIdx = findDepartureIndex(slots, cohort.departureHour)

    if (arrIdx < 0 || depIdx < 0 || depIdx <= arrIdx) continue

    const availableSlots = depIdx - arrIdx
    const actualSlotsNeeded = Math.min(slotsNeeded, availableSlots)

    // Greedy: charge starting from arrival
    for (let i = arrIdx; i < arrIdx + actualSlotsNeeded && i < slots.length; i++) {
      greedyKw[i] += cohort.chargePowerKw * cohort.weight * fleetSize
    }

    // Lazy: charge ending at departure (last N slots before departure)
    const lazyStart = depIdx - actualSlotsNeeded
    for (let i = Math.max(arrIdx, lazyStart); i < depIdx && i < slots.length; i++) {
      lazyKw[i] += cohort.chargePowerKw * cohort.weight * fleetSize
    }
  }

  return slots.map((s, i) => ({
    hour: s.hour,
    minute: s.minute,
    date: s.date,
    greedyKw: Math.round(greedyKw[i] * 10) / 10,
    lazyKw: Math.round(Math.min(lazyKw[i], greedyKw[i]) * 10) / 10,
  }))
}

/** Find slot index for a given hour (first slot at or after that hour) */
function findSlotIndex(slots: { hour: number; minute: number; date: string }[], hour: number, minute: number): number {
  // Arrival hours are in day1 (14–23), departure hours in day2 (5–9)
  // Slots are sorted chronologically across the overnight window
  for (let i = 0; i < slots.length; i++) {
    if (slots[i].hour === hour && slots[i].minute === minute) return i
    // For hourly mode, just match the hour
    if (minute === 0 && slots[i].hour === hour) return i
  }
  return -1
}

/** Find the departure index — first slot in day2 at the departure hour */
function findDepartureIndex(slots: { hour: number; minute: number; date: string }[], depHour: number): number {
  // Departure hours (5–9) occur in day2 — find the first slot at that hour
  // Day2 is the second date in the window (after midnight)
  const dates = [...new Set(slots.map(s => s.date))].sort()
  if (dates.length < 2) return -1 // No next-day data — skip this cohort
  const day2 = dates[1]

  for (let i = 0; i < slots.length; i++) {
    if (slots[i].date === day2 && slots[i].hour >= depHour) return i
  }
  // Departure hour past available data — use end of day2 data
  for (let i = slots.length - 1; i >= 0; i--) {
    if (slots[i].date === day2) return i + 1
  }
  return -1
}

/* ── Fleet Schedule Optimizer (PROJ-37) ── */

/**
 * Compute total fleet energy requirement from config.
 */
export function computeFleetEnergyKwh(config: FleetConfig): number {
  const cohorts = buildCohorts(config)
  let totalKwh = 0
  for (const c of cohorts) {
    totalKwh += c.batteryKwh * (100 - c.arrivalSocPct) / 100 * c.weight * config.fleetSize
  }
  return Math.round(totalKwh * 10) / 10
}

/**
 * Optimize the fleet charging schedule against prices within the flex band.
 *
 * Algorithm:
 * 1. Allocate mandatory kW (lazy bound) at every slot
 * 2. Sort remaining flexible capacity by price ascending
 * 3. Fill cheapest slots to greedy bound until total energy target is met
 */
export function optimizeFleetSchedule(
  band: FlexBandSlot[],
  prices: HourlyPrice[],
  totalEnergyKwh: number,
  isQH: boolean = false,
): FleetOptimizationResult {
  const slotDurationH = isQH ? 0.25 : 1

  // Build price lookup
  const priceMap = new Map<string, number>()
  for (const p of prices) {
    priceMap.set(`${p.date}-${p.hour}-${p.minute ?? 0}`, p.priceCtKwh)
  }

  // Step 1: allocate mandatory (lazy) at each slot
  let mandatoryEnergyKwh = 0
  const schedule: FleetScheduleSlot[] = band.map(s => {
    const mandatoryKw = s.lazyKw
    const flexibleKw = Math.max(0, s.greedyKw - s.lazyKw)
    mandatoryEnergyKwh += mandatoryKw * slotDurationH
    const priceCt = priceMap.get(`${s.date}-${s.hour}-${s.minute}`) ?? 0
    return {
      ...s,
      optimizedKw: mandatoryKw,
      mandatoryKw,
      flexibleKw,
      slotCostEur: mandatoryKw * slotDurationH * priceCt / 100,
    }
  })

  // Step 2: remaining energy to allocate in flexible slots
  let remainingKwh = Math.max(0, totalEnergyKwh - mandatoryEnergyKwh)

  // Step 3: sort flexible slots by price, fill cheapest first
  const flexIndices = schedule
    .map((s, i) => ({ i, flexKw: s.flexibleKw, price: priceMap.get(`${s.date}-${s.hour}-${s.minute}`) ?? 0 }))
    .filter(x => x.flexKw > 0)
    .sort((a, b) => a.price - b.price)

  for (const { i, flexKw, price } of flexIndices) {
    if (remainingKwh <= 0) break
    const addKwh = Math.min(flexKw * slotDurationH, remainingKwh)
    const addKw = addKwh / slotDurationH
    schedule[i].optimizedKw += addKw
    schedule[i].slotCostEur += addKw * slotDurationH * price / 100
    remainingKwh -= addKwh
  }

  // Round values
  for (const s of schedule) {
    s.optimizedKw = Math.round(s.optimizedKw * 10) / 10
    s.slotCostEur = Math.round(s.slotCostEur * 100) / 100
  }

  // Compute baseline cost: simulate greedy charging (ASAP) capped at totalEnergyKwh.
  // Process slots chronologically, charging at greedy kW until total energy is met.
  let baselineCostEur = 0
  let baselineEnergyKwh = 0
  for (const s of band) {
    if (baselineEnergyKwh >= totalEnergyKwh) break
    const priceCt = priceMap.get(`${s.date}-${s.hour}-${s.minute}`) ?? 0
    const slotEnergyKwh = s.greedyKw * slotDurationH
    const remainingKwhNeeded = totalEnergyKwh - baselineEnergyKwh
    const actualKwh = Math.min(slotEnergyKwh, remainingKwhNeeded)
    baselineCostEur += actualKwh * priceCt / 100
    baselineEnergyKwh += actualKwh
  }

  const optimizedCostEur = schedule.reduce((s, x) => s + x.slotCostEur, 0)
  const savingsEur = baselineCostEur - optimizedCostEur
  const optimizedEnergyKwh = schedule.reduce((s, x) => s + x.optimizedKw * slotDurationH, 0)

  return {
    totalEnergyKwh: Math.round(optimizedEnergyKwh * 10) / 10,
    baselineCostEur: Math.round(baselineCostEur * 100) / 100,
    optimizedCostEur: Math.round(optimizedCostEur * 100) / 100,
    savingsEur: Math.round(savingsEur * 100) / 100,
    savingsPct: baselineCostEur > 0 ? Math.round(savingsEur / baselineCostEur * 1000) / 10 : 0,
    baselineAvgCtKwh: totalEnergyKwh > 0 ? Math.round(baselineCostEur * 100 / totalEnergyKwh * 100) / 100 : 0,
    optimizedAvgCtKwh: optimizedEnergyKwh > 0 ? Math.round(optimizedCostEur * 100 / optimizedEnergyKwh * 100) / 100 : 0,
    schedule,
    shortfallKwh: Math.round(Math.max(0, totalEnergyKwh - optimizedEnergyKwh) * 10) / 10,
  }
}
