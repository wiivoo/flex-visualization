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

/**
 * Expand fleet config into weighted cohorts.
 * Each cohort = arrival × departure × charge need.
 * Charge need is sampled at 3 points across the socMin–socMax kWh range.
 */
function buildCohorts(config: FleetConfig): Cohort[] {
  const cohorts: Cohort[] = []
  const chargePower = config.chargePowerKw ?? 7
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
          chargePowerKw: chargePower,
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
      // The latest it can start = depIdx - slotsNeeded.
      // Track partial last slot to avoid over-stating upper bound.
      const latestStart = depIdx - slotsNeeded
      let remainingForUpper: number
      if (t < latestStart) {
        remainingForUpper = energyNeededKwh
      } else {
        remainingForUpper = Math.max(0, energyNeededKwh - (t - latestStart) * kwhPerSlot)
      }
      if (remainingForUpper > 0) {
        const upperFraction = Math.min(1, remainingForUpper / kwhPerSlot)
        upperKw[t] += contribution * upperFraction
      }

      // LOWER: car must charge now if skipping this slot means it can't
      // finish by departure. Must charge at t if:
      // energyNeeded > (slotsRemaining - 1) * kwhPerSlot
      // Track partial last slot to avoid overcharging the lazy bound.
      const canDeliverLater = (slotsRemaining - 1) * kwhPerSlot
      if (energyNeededKwh > canDeliverLater) {
        // How much MUST be charged in this slot?
        const mustChargeKwh = energyNeededKwh - canDeliverLater
        const slotFraction = Math.min(1, mustChargeKwh / kwhPerSlot)
        lowerKw[t] += contribution * slotFraction
      }

      // GREEDY SCHEDULE: charge ASAP from arrival until energy is met
      // Track partial last slot: if remaining energy < full slot, only partial kW
      const greedyChargedSoFar = slotsElapsed * kwhPerSlot
      const greedyRemaining = energyNeededKwh - greedyChargedSoFar
      if (greedyRemaining > 0) {
        const slotFraction = Math.min(1, greedyRemaining / kwhPerSlot)
        greedyScheduleKw[t] += contribution * slotFraction
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

  // Optimization: place totalEnergyKwh into cheapest slots within the band.
  //
  // The greedyKw (upper bound) at each slot = max kW the fleet CAN draw.
  // The lazyKw (lower bound) is for visualization only — NOT used as a constraint
  // here because it sums to exactly totalEnergy and would leave zero flexibility.
  //
  // Strategy: sort all slots by price, fill cheapest to greedyKw capacity first.
  // The result is the cost-minimum schedule that respects physical constraints
  // (cable capacity, battery limits, connection times).

  const slotPrices: number[] = band.map(s =>
    priceMap.get(`${s.date}-${s.hour}-${s.minute}`) ?? 0
  )

  const schedule: FleetScheduleSlot[] = band.map((s, i) => ({
    ...s,
    optimizedKw: 0,
    mandatoryKw: s.lazyKw,
    flexibleKw: Math.max(0, s.greedyKw - s.lazyKw),
    slotCostEur: 0,
  }))

  // Sort slots by price ascending — fill cheapest first up to greedyKw
  const sortedSlots = band
    .map((s, i) => ({ i, price: slotPrices[i], capacity: s.greedyKw }))
    .filter(x => x.capacity > 0)
    .sort((a, b) => a.price - b.price)

  let remainingKwh = totalEnergyKwh
  for (const { i, price, capacity } of sortedSlots) {
    if (remainingKwh <= 0) break
    const maxKwh = capacity * slotDurationH
    const useKwh = Math.min(maxKwh, remainingKwh)
    const useKw = useKwh / slotDurationH
    schedule[i].optimizedKw = useKw
    schedule[i].slotCostEur = useKwh * price / 100
    remainingKwh -= useKwh
  }

  // Round values
  for (const s of schedule) {
    s.optimizedKw = Math.round(s.optimizedKw * 10) / 10
    s.slotCostEur = Math.round(s.slotCostEur * 100) / 100
  }

  // Compute baseline cost from greedyScheduleKw — the actual ASAP charging pattern.
  // This is the front-loaded schedule where each cohort charges immediately upon arrival.
  let baselineCostEur = 0
  let baselineEnergyKwh = 0
  for (const s of band) {
    if (s.greedyScheduleKw <= 0) continue
    const priceCt = priceMap.get(`${s.date}-${s.hour}-${s.minute}`) ?? 0
    const slotKwh = s.greedyScheduleKw * slotDurationH
    baselineCostEur += slotKwh * priceCt / 100
    baselineEnergyKwh += slotKwh
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
