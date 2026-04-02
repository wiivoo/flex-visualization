/**
 * Fleet Flex Band Optimizer (PROJ-36 + PROJ-37)
 *
 * Pure functions — no React, no DOM. Computes:
 * 1. Flex band (greedy upper / lazy lower bounds) for a heterogeneous fleet
 * 2. Price-optimal aggregate schedule within the band constraints
 */
import type {
  FleetConfig, FlexBandSlot, FleetScheduleSlot, FleetOptimizationResult,
  HourlyPrice, DistributionEntry, SpreadMode,
} from '@/lib/v2-config'

/* ── Distribution generation from avg/min/max + spread mode ── */

/** Generate a bell-curve distribution over integer hours [min..max] centered on avg */
export function generateDistribution(
  min: number, max: number, avg: number, mode: SpreadMode, allHours: number[],
): DistributionEntry[] {
  if (mode === 'off') {
    // All weight on avg hour
    return allHours.map(h => ({ hour: h, pct: h === avg ? 100 : 0 }))
  }
  const sigma = mode === 'narrow' ? 0.8 : mode === 'wide' ? 2.5 : 1.5 // normal
  const entries: DistributionEntry[] = []
  let total = 0
  for (const h of allHours) {
    if (h < min || h > max) {
      entries.push({ hour: h, pct: 0 })
    } else {
      const w = Math.exp(-0.5 * ((h - avg) / sigma) ** 2)
      entries.push({ hour: h, pct: w })
      total += w
    }
  }
  // Normalize to 100
  if (total > 0) {
    let sum = 0
    for (const e of entries) {
      e.pct = Math.round(e.pct / total * 100)
      sum += e.pct
    }
    // Fix rounding
    const peak = entries.reduce((best, e) => e.pct > best.pct ? e : best, entries[0])
    peak.pct += 100 - sum
  }
  return entries
}

/** Derive full FleetConfig distributions from the simplified avg/min/max params */
export function deriveFleetDistributions(config: FleetConfig): FleetConfig {
  const arrivalHours = [14, 15, 16, 17, 18, 19, 20, 21, 22, 23]
  const departureHours = [5, 6, 7, 8, 9]
  return {
    ...config,
    arrivalDist: generateDistribution(config.arrivalMin, config.arrivalMax, config.arrivalAvg, config.spreadMode, arrivalHours),
    departureDist: generateDistribution(config.departureMin, config.departureMax, config.departureAvg, config.spreadMode, departureHours),
    socMin: config.chargeNeedMin,
    socMax: config.chargeNeedMax,
  }
}

/* ── Cohort model ── */

interface Cohort {
  arrivalHour: number
  departureHour: number   // next day
  chargeNeedKwh: number   // kWh needed per session
  chargePowerKw: number
  weight: number          // fraction of fleet (0–1), sum of all cohorts ≈ 1
}

const FLEET_CHARGE_POWER_KW = 7

/**
 * Expand fleet config into weighted cohorts.
 * Each cohort = arrival × departure × charge need.
 * Charge need is sampled at 3 points across the socMin–socMax kWh range.
 */
function buildCohorts(config: FleetConfig): Cohort[] {
  const cohorts: Cohort[] = []
  // socMin/socMax now represent kWh/session charge need range
  const needRange = config.socMax - config.socMin
  const needSamples = needRange > 0
    ? [config.socMin, config.socMin + needRange / 2, config.socMax]
    : [config.socMin]
  const needWeight = 1 / needSamples.length

  for (const arr of config.arrivalDist) {
    if (arr.pct <= 0) continue
    for (const dep of config.departureDist) {
      if (dep.pct <= 0) continue
      for (const need of needSamples) {
        const weight = (arr.pct / 100) * (dep.pct / 100) * needWeight
        if (weight < 1e-8) continue
        cohorts.push({
          arrivalHour: arr.hour,
          departureHour: dep.hour,
          chargeNeedKwh: need,
          chargePowerKw: FLEET_CHARGE_POWER_KW,
          weight,
        })
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

  // For each slot, accumulate upper and lower kW bounds across all cohorts.
  //
  // For each cohort at each slot t (where arrival <= t < departure):
  //
  // UPPER BOUND (can charge): The car has been charging as LITTLE as possible
  // up to this point (lazy strategy so far). How much energy remains?
  // If > 0, this car CAN charge at this slot → contributes chargePowerKw.
  // Calculated: energyCharged_lazy_up_to_t = max(0, energyNeeded - remainingCapacity_from_t_to_departure)
  // remainingNeed = energyNeeded - energyCharged_lazy_up_to_t
  // canCharge = remainingNeed > 0
  //
  // LOWER BOUND (must charge): How many slots remain until departure?
  // If remainingEnergy > remainingSlotsCapacity, this car MUST charge now.
  // Calculated: remainingSlots = depIdx - t
  // mustCharge = energyNeeded > (remainingSlots - 1) * kwhPerSlot
  // (i.e., if we skip this slot, we can't fit the remaining energy)

  const upperKw = new Float64Array(slots.length)
  const lowerKw = new Float64Array(slots.length)
  const greedyScheduleKw = new Float64Array(slots.length) // actual ASAP charging

  for (const cohort of cohorts) {
    const energyNeededKwh = cohort.chargeNeedKwh
    const kwhPerSlot = cohort.chargePowerKw * slotDurationH
    if (energyNeededKwh <= 0) continue

    const arrIdx = findSlotIndex(slots, cohort.arrivalHour, 0)
    const depIdx = findDepartureIndex(slots, cohort.departureHour)
    if (arrIdx < 0 || depIdx < 0 || depIdx <= arrIdx) continue

    const slotsInWindow = depIdx - arrIdx
    const slotsNeeded = Math.min(Math.ceil(energyNeededKwh / kwhPerSlot), slotsInWindow)
    const contribution = cohort.chargePowerKw * cohort.weight * fleetSize

    for (let t = arrIdx; t < depIdx && t < slots.length; t++) {
      const slotsElapsed = t - arrIdx         // slots since arrival
      const slotsRemaining = depIdx - t       // slots until departure (including this one)

      // UPPER: car can charge if it still has energy need remaining,
      // assuming it has deferred charging as much as possible up to now.
      // If it deferred, it charged 0 until the point where it must start.
      // The latest it can start = depIdx - slotsNeeded.
      // So at slot t, if t < latestStart, it hasn't charged yet → full need remains → CAN charge.
      // If t >= latestStart, it has been charging → remaining = energyNeeded - (t - latestStart) * kwhPerSlot
      const latestStart = depIdx - slotsNeeded
      let remainingForUpper: number
      if (t < latestStart) {
        remainingForUpper = energyNeededKwh // hasn't started yet, full need available
      } else {
        remainingForUpper = Math.max(0, energyNeededKwh - (t - latestStart) * kwhPerSlot)
      }
      if (remainingForUpper > 0) {
        upperKw[t] += contribution
      }

      // LOWER: car must charge now if skipping this slot means it can't
      // finish by departure. Remaining energy if it charged as much as possible
      // before now = energyNeeded - slotsElapsed * kwhPerSlot (greedy up to now).
      // But lower bound is about: given optimal deferral, what's mandatory?
      // Must charge at t if: energyNeeded > (slotsRemaining - 1) * kwhPerSlot
      // i.e., even using all future slots, we still need this one.
      if (energyNeededKwh > (slotsRemaining - 1) * kwhPerSlot) {
        lowerKw[t] += contribution
      }

      // GREEDY SCHEDULE: charge ASAP from arrival until energy is met
      const greedyChargedSoFar = slotsElapsed * kwhPerSlot
      if (greedyChargedSoFar < energyNeededKwh) {
        greedyScheduleKw[t] += contribution
      }
    }
  }

  return slots.map((s, i) => ({
    hour: s.hour,
    minute: s.minute,
    date: s.date,
    greedyKw: Math.round(upperKw[i] * 10) / 10,
    greedyScheduleKw: Math.round(greedyScheduleKw[i] * 10) / 10,
    lazyKw: Math.round(Math.min(lowerKw[i], upperKw[i]) * 10) / 10,
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
    totalKwh += c.chargeNeedKwh * c.weight * config.fleetSize
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
