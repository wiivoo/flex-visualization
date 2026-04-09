/**
 * Process View — Pure computation engine for the chronological optimization timeline.
 *
 * Computes staged re-optimization results (Forecast → DA Nomination → Intraday)
 * under different uncertainty scenarios (Perfect / Realistic / Worst case).
 * Produces waterfall bar data for the value breakdown card.
 *
 * No React, no DOM — pure functions only.
 */

import type { HourlyPrice, ChargingScenario, FleetConfig } from '@/lib/v2-config'
import { VEHICLE_PRESETS } from '@/lib/v2-config'

/* ── Types ── */

export type ProcessStage = 'forecast' | 'da_nomination' | 'intraday_adjustment'
export type UncertaintyScenario = 'perfect' | 'realistic' | 'worst'

export const PROCESS_STAGES: { key: ProcessStage; label: string; description: string }[] = [
  { key: 'forecast', label: 'Forecast', description: 'D-2 to D-1 12:00 — estimate availability and energy need' },
  { key: 'da_nomination', label: 'DA Nom.', description: 'D-1 12:00 — day-ahead auction prices revealed, nominate cheapest slots' },
  { key: 'intraday_adjustment', label: 'Intraday', description: 'Day D — actual car availability revealed, re-optimize position' },
]

export const UNCERTAINTY_SCENARIOS: { key: UncertaintyScenario; label: string }[] = [
  { key: 'perfect', label: 'Perfect' },
  { key: 'realistic', label: 'Realistic' },
  { key: 'worst', label: 'Worst case' },
]

/** Interpolate uncertainty parameters from a 0–100 slider value */
export function uncertaintyFromPct(pct: number): {
  daPriceNoiseEurMwh: number
  plugInVarianceHours: number
  departureVarianceHours: number
} {
  const t = Math.max(0, Math.min(100, pct)) / 100
  return {
    daPriceNoiseEurMwh: t * 20,        // 0 → 0, 100 → 20 EUR/MWh
    plugInVarianceHours: t * 2,          // 0 → 0h, 100 → 2h
    departureVarianceHours: t * 2,       // 0 → 0h, 100 → 2h
  }
}

export interface StageResult {
  windowStart: string
  windowEnd: string
  pricesUsed: HourlyPrice[]
  avgPriceCtKwh: number      // average price in the charging window
  cheapestHours: number[]    // indices of cheapest hours picked for charging
}

export interface WaterfallBar {
  label: string
  base: number       // invisible offset (ct/kWh)
  value: number      // visible bar height, negative for drag bars
  color: string      // 'emerald' | 'red' | 'blue'
  isTotal?: boolean
}

export interface ProcessViewResult {
  stages: Record<ProcessStage, StageResult | null>
  waterfall: WaterfallBar[]
  fleetWaterfall: WaterfallBar[] | null
  perfectSavingsCtKwh: number
  realizedSavingsCtKwh: number
  availabilityDragCtKwh: number
  priceForecastDragCtKwh: number
  intradayCorrectionCtKwh: number
}

/* ── Uncertainty Calibration ── */

export const UNCERTAINTY_CONFIG = {
  realistic: { daPriceNoiseEurMwh: 8, plugInVarianceHours: 1, departureVarianceHours: 1, intradaySpreadEurMwh: 3 },
  worst: { daPriceNoiseEurMwh: 20, plugInVarianceHours: 2, departureVarianceHours: 2, intradaySpreadEurMwh: 10 },
} as const

/* ── Seeded PRNG (multiply-with-carry) ── */

function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) - hash + str.charCodeAt(i)) | 0
  }
  return Math.abs(hash) || 1
}

function createSeededRng(seed: string): () => number {
  let w = hashString(seed)
  let z = hashString(seed + '_z')
  return () => {
    z = (36969 * (z & 0xffff) + (z >>> 16)) | 0
    w = (18000 * (w & 0xffff) + (w >>> 16)) | 0
    const result = ((z << 16) + (w & 0xffff)) | 0
    return (result >>> 0) / 0x100000000
  }
}

/** Box-Muller transform for Gaussian noise from uniform RNG */
function gaussianNoise(rng: () => number): number {
  const u1 = Math.max(1e-10, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/* ── Perturbation Functions ── */

/**
 * Perturb prices with Gaussian noise seeded deterministically from dateSeed.
 * Perfect: return unchanged. Realistic/Worst: add noise per UNCERTAINTY_CONFIG.
 */
export function perturbPrices(
  prices: HourlyPrice[],
  scenario: UncertaintyScenario,
  dateSeed: string,
): HourlyPrice[] {
  if (scenario === 'perfect') return prices

  const config = UNCERTAINTY_CONFIG[scenario]
  const rng = createSeededRng(`${dateSeed}_prices_${scenario}`)

  return prices.map(p => {
    const noiseEurMwh = gaussianNoise(rng) * config.daPriceNoiseEurMwh
    const perturbedEurMwh = p.priceEurMwh + noiseEurMwh
    return {
      ...p,
      priceEurMwh: perturbedEurMwh,
      priceCtKwh: perturbedEurMwh / 10,
    }
  })
}

/**
 * Perturb plug-in time window start.
 * Perfect: unchanged. Realistic: +/-1h. Worst: +2h (car arrives late).
 * Clamp to 14-23 range.
 */
export function perturbWindow(
  windowStart: string,
  scenario: UncertaintyScenario,
  dateSeed: string,
): string {
  if (scenario === 'perfect') return windowStart

  const hour = parseInt(windowStart.split(':')[0], 10)
  const rng = createSeededRng(`${dateSeed}_window_${scenario}`)

  let shiftHours: number
  if (scenario === 'worst') {
    shiftHours = 2 // car always arrives late in worst case
  } else {
    // Realistic: +-1 hour, deterministic from seed
    shiftHours = rng() > 0.5 ? 1 : -1
  }

  const newHour = Math.max(14, Math.min(23, hour + shiftHours))
  return `${String(newHour).padStart(2, '0')}:00`
}

/**
 * Perturb departure time.
 * Perfect: unchanged. Realistic: +/-1h. Worst: -2h (car leaves early).
 * Clamp to 4-12 range.
 */
export function perturbDeparture(
  windowEnd: string,
  scenario: UncertaintyScenario,
  dateSeed: string,
): string {
  if (scenario === 'perfect') return windowEnd

  const hour = parseInt(windowEnd.split(':')[0], 10)
  const rng = createSeededRng(`${dateSeed}_departure_${scenario}`)

  let shiftHours: number
  if (scenario === 'worst') {
    shiftHours = -2 // car leaves early in worst case
  } else {
    shiftHours = rng() > 0.5 ? 1 : -1
  }

  const newHour = Math.max(4, Math.min(12, hour + shiftHours))
  return `${String(newHour).padStart(2, '0')}:00`
}

/* ── Continuous-control perturbation (slider-driven) ── */

/** Perturb prices with a specific noise level (EUR/MWh) */
function perturbPricesWithNoise(prices: HourlyPrice[], noiseEurMwh: number, dateSeed: string): HourlyPrice[] {
  const rng = createSeededRng(`${dateSeed}_prices_slider`)
  return prices.map(p => {
    const noise = gaussianNoise(rng) * noiseEurMwh
    const perturbedEurMwh = p.priceEurMwh + noise
    return { ...p, priceEurMwh: perturbedEurMwh, priceCtKwh: perturbedEurMwh / 10 }
  })
}

/** Perturb a time boundary by a specific variance (hours). Direction is seeded. */
function perturbWindowByHours(time: string, varianceHours: number, dateSeed: string, kind: 'arrival' | 'departure'): string {
  const hour = parseInt(time.split(':')[0], 10)
  const rng = createSeededRng(`${dateSeed}_${kind}_slider`)
  // Round variance to nearest integer for clean hours
  const maxShift = Math.round(varianceHours)
  if (maxShift === 0) return time
  // Arrival tends late (+), departure tends early (-)
  const direction = kind === 'arrival' ? 1 : -1
  // Seeded: sometimes shift less, sometimes full
  const shift = rng() > 0.5 ? maxShift * direction : Math.ceil(maxShift / 2) * direction
  const clampMin = kind === 'arrival' ? 14 : 4
  const clampMax = kind === 'arrival' ? 23 : 12
  const newHour = Math.max(clampMin, Math.min(clampMax, hour + shift))
  return `${String(newHour).padStart(2, '0')}:00`
}

/* ── Lightweight price analysis (no optimizer calls) ── */

/**
 * Find cheapest N hours in a price window. Returns indices into `prices`.
 * This approximates what the optimizer does without running the full engine.
 */
function findCheapestHours(prices: HourlyPrice[], startH: number, endH: number, hoursNeeded: number): number[] {
  const windowPrices = prices
    .map((p, i) => ({ i, h: p.hour, price: p.priceCtKwh }))
    .filter(p => {
      const wraps = endH <= startH
      return wraps ? (p.h >= startH || p.h < endH) : (p.h >= startH && p.h < endH)
    })
    .sort((a, b) => a.price - b.price)
  return windowPrices.slice(0, Math.max(1, hoursNeeded)).map(p => p.i)
}

function avgPrice(prices: HourlyPrice[], indices: number[]): number {
  if (indices.length === 0) return 0
  return indices.reduce((s, i) => s + (prices[i]?.priceCtKwh ?? 0), 0) / indices.length
}

/**
 * Baseline avg: first N slots chronologically in the window (charge-now).
 * Matches computeWindowSavings logic from charging-helpers.ts.
 */
function baselineAvgPrice(prices: HourlyPrice[], startH: number, endH: number, slotsNeeded: number): number {
  const windowPrices = prices.filter(p => {
    const wraps = endH <= startH
    return wraps ? (p.hour >= startH || p.hour < endH) : (p.hour >= startH && p.hour < endH)
  })
  if (windowPrices.length === 0 || slotsNeeded <= 0) return 0
  let sum = 0, count = 0
  for (const p of windowPrices) {
    if (count >= slotsNeeded) break
    sum += p.priceCtKwh
    count++
  }
  return count > 0 ? sum / count : 0
}

/* ── Waterfall Builder (from pre-computed ct/kWh values) ── */

function buildWaterfallFromCtKwh(
  perfectCtKwh: number,
  daErrorCtKwh: number,
  availErrorCtKwh: number,
  idCostCtKwh: number,
  realizedCtKwh: number,
  hasIntraday: boolean,
  dragColor: string = 'red',
): { bars: WaterfallBar[] } {
  let runningBase = perfectCtKwh
  const bars: WaterfallBar[] = [
    { label: 'Perfect', base: 0, value: perfectCtKwh, color: 'emerald', isTotal: true },
  ]

  if (daErrorCtKwh > 0.001) {
    runningBase -= daErrorCtKwh
    bars.push({ label: 'DA Error', base: runningBase, value: -daErrorCtKwh, color: dragColor })
  }

  if (availErrorCtKwh > 0.001) {
    runningBase -= availErrorCtKwh
    bars.push({ label: 'Avail. Error', base: runningBase, value: -availErrorCtKwh, color: dragColor })
  }

  if (hasIntraday && idCostCtKwh > 0.001) {
    runningBase -= idCostCtKwh
    bars.push({ label: 'ID Cost', base: runningBase, value: -idCostCtKwh, color: dragColor })
  }

  bars.push({ label: 'Realized', base: 0, value: realizedCtKwh, color: 'emerald', isTotal: true })
  return { bars }
}

/* ── Main Computation ── */

/**
 * Compute the full process view: 3-stage optimization + waterfall breakdown.
 *
 * - Forecast: perturbed prices + perturbed window (what we thought would happen)
 * - DA Nomination: real prices + perturbed window (real prices, still guessing availability)
 * - Intraday: intraday prices + real window (if available)
 *
 * Also computes a "perfect" reference: real prices + real window.
 */
export function computeProcessViewResults(params: {
  prices: HourlyPrice[]
  intradayPrices: HourlyPrice[] | null
  scenario: ChargingScenario
  uncertaintyScenario: UncertaintyScenario
  /** Continuous uncertainty 0–100. When provided, overrides uncertaintyScenario for noise/variance. */
  uncertaintyPct?: number
  showFleet: boolean
  fleetConfig: FleetConfig | null
  dateSeed: string
  perfectBaseline?: { baselineAvgCt: number; optimizedAvgCt: number } | null
}): ProcessViewResult {
  const { prices, intradayPrices, scenario, uncertaintyScenario, uncertaintyPct, showFleet, fleetConfig, dateSeed, perfectBaseline } = params

  const startH = scenario.plugInTime
  const endH = scenario.departureTime
  const windowStart = `${String(startH).padStart(2, '0')}:00`
  const windowEnd = `${String(endH).padStart(2, '0')}:00`

  const vehicle = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId) ?? VEHICLE_PRESETS[1]
  const energyNeeded = vehicle.battery_kwh * (scenario.targetLevel - scenario.startLevel) / 100
  const hoursNeeded = Math.ceil(energyNeeded / scenario.chargePowerKw)

  if (energyNeeded <= 0) {
    const emptyStages: Record<ProcessStage, StageResult | null> = {
      forecast: { windowStart, windowEnd, pricesUsed: prices, avgPriceCtKwh: 0, cheapestHours: [] },
      da_nomination: { windowStart, windowEnd, pricesUsed: prices, avgPriceCtKwh: 0, cheapestHours: [] },
      intraday_adjustment: null,
    }
    return { stages: emptyStages, waterfall: [], fleetWaterfall: null, perfectSavingsCtKwh: 0, realizedSavingsCtKwh: 0, availabilityDragCtKwh: 0, priceForecastDragCtKwh: 0, intradayCorrectionCtKwh: 0 }
  }

  // Resolve uncertainty config: slider (pct) takes precedence over named scenario
  const uConfig = uncertaintyPct !== undefined && uncertaintyPct > 0
    ? uncertaintyFromPct(uncertaintyPct)
    : uncertaintyScenario === 'perfect'
      ? { daPriceNoiseEurMwh: 0, plugInVarianceHours: 0, departureVarianceHours: 0 }
      : UNCERTAINTY_CONFIG[uncertaintyScenario]
  const effectiveScenario = (uncertaintyPct !== undefined && uncertaintyPct > 0) || uncertaintyScenario !== 'perfect' ? 'realistic' : 'perfect'

  // Perturbed values (arrival + departure + prices) using resolved config
  const perturbedPrices = uConfig.daPriceNoiseEurMwh > 0
    ? perturbPricesWithNoise(prices, uConfig.daPriceNoiseEurMwh, dateSeed)
    : prices
  const perturbedWindowStart = uConfig.plugInVarianceHours > 0
    ? perturbWindowByHours(windowStart, uConfig.plugInVarianceHours, dateSeed, 'arrival')
    : windowStart
  const perturbedWindowEnd = uConfig.departureVarianceHours > 0
    ? perturbWindowByHours(windowEnd, uConfig.departureVarianceHours, dateSeed, 'departure')
    : windowEnd
  const perturbedStartH = parseInt(perturbedWindowStart.split(':')[0], 10)
  const perturbedEndH = parseInt(perturbedWindowEnd.split(':')[0], 10)

  // Determine slots needed (QH-aware: if prices have minute data, use QH slots)
  const isQH = prices.some(p => (p.minute ?? 0) !== 0)
  const slotsPerHour = isQH ? 4 : 1
  const slotsNeeded = Math.ceil(energyNeeded / (scenario.chargePowerKw * (isQH ? 0.25 : 1)))

  // Perfect: cheapest slots with real prices + real window
  const perfectCheapest = findCheapestHours(prices, startH, endH, slotsNeeded)
  const perfectAvg = avgPrice(prices, perfectCheapest)

  // Baseline: use ground-truth from main chart when available, fall back to approximate
  const approxBaselineAvg = baselineAvgPrice(prices, startH, endH, slotsNeeded)
  const baselineAvg = perfectBaseline ? perfectBaseline.baselineAvgCt : approxBaselineAvg
  const optimizedAvg = perfectBaseline ? perfectBaseline.optimizedAvgCt : perfectAvg
  const perfectSavingsCtKwh = Math.max(0, baselineAvg - optimizedAvg)

  // Forecast baseline: "charge now" from perturbed arrival (baseline shifts with plug-in time)
  const forecastBaselineAvg = (perturbedStartH !== startH || perturbedEndH !== endH)
    ? baselineAvgPrice(prices, perturbedStartH, perturbedEndH, slotsNeeded)
    : baselineAvg

  // Stage 1 — Forecast: perturbed prices + perturbed window (arrival + departure)
  const forecastCheapest = findCheapestHours(perturbedPrices, perturbedStartH, perturbedEndH, slotsNeeded)
  const forecastActualAvg = avgPrice(prices, forecastCheapest) // what those hours actually cost
  const forecastSavingsCtKwh = Math.max(0, forecastBaselineAvg - forecastActualAvg)

  // DA Nomination kept internally for error decomposition but not exposed as a UI stage
  const daCheapest = findCheapestHours(prices, perturbedStartH, perturbedEndH, slotsNeeded)
  const daAvg = avgPrice(prices, daCheapest)
  const daSavingsCtKwh = Math.max(0, baselineAvg - daAvg)

  // Intraday (kept for future use)
  let intradaySavingsCtKwh: number | null = null
  let intradayCheapest: number[] = []
  if (intradayPrices && intradayPrices.length > 0) {
    intradayCheapest = findCheapestHours(intradayPrices, startH, endH, slotsNeeded)
    const idAvg = avgPrice(intradayPrices, intradayCheapest)
    const idBaseline = baselineAvgPrice(intradayPrices, startH, endH, slotsNeeded)
    intradaySavingsCtKwh = Math.max(0, idBaseline - idAvg)
  }

  const stages: Record<ProcessStage, StageResult | null> = {
    forecast: {
      windowStart: perturbedWindowStart,
      windowEnd: perturbedWindowEnd,
      pricesUsed: perturbedPrices,
      avgPriceCtKwh: forecastActualAvg,
      cheapestHours: forecastCheapest,
    },
    da_nomination: {
      windowStart: perturbedWindowStart,
      windowEnd: perturbedWindowEnd,
      pricesUsed: prices,
      avgPriceCtKwh: daAvg,
      cheapestHours: daCheapest,
    },
    intraday_adjustment: intradayPrices && intradayPrices.length > 0 ? {
      windowStart,
      windowEnd,
      pricesUsed: intradayPrices,
      avgPriceCtKwh: avgPrice(intradayPrices, intradayCheapest),
      cheapestHours: intradayCheapest,
    } : null,
  }

  // Waterfall: express drags as ct/kWh
  // Availability drag: cost of not knowing exact arrival time (perfect window vs perturbed window, both with real prices)
  const availabilityErrorCtKwh = Math.max(0, perfectSavingsCtKwh - daSavingsCtKwh)
  // Price forecast drag: cost of using forecast prices instead of real prices (both with perturbed window)
  const priceForecastErrorCtKwh = Math.max(0, daSavingsCtKwh - forecastSavingsCtKwh)
  const idCostCtKwh = intradaySavingsCtKwh !== null ? Math.max(0, forecastSavingsCtKwh - intradaySavingsCtKwh) : 0

  const realizedSavingsCtKwh = intradaySavingsCtKwh ?? forecastSavingsCtKwh

  const { bars } = buildWaterfallFromCtKwh(perfectSavingsCtKwh, availabilityErrorCtKwh, priceForecastErrorCtKwh, idCostCtKwh, realizedSavingsCtKwh, intradaySavingsCtKwh !== null)

  // Fleet waterfall: scale drag by 1/sqrt(N)
  let fleetWaterfall: WaterfallBar[] | null = null
  if (showFleet && fleetConfig) {
    const effectiveFleetSize = fleetConfig.fleetSize * Math.min(1, (fleetConfig.plugInsPerWeek ?? 3) / 7)
    const sqrtN = Math.sqrt(Math.max(1, effectiveFleetSize))
    const fAvail = availabilityErrorCtKwh / sqrtN
    const fPrice = priceForecastErrorCtKwh / sqrtN
    const fId = idCostCtKwh / sqrtN
    const fRealized = perfectSavingsCtKwh - fAvail - fPrice - fId
    const { bars: fBars } = buildWaterfallFromCtKwh(perfectSavingsCtKwh, fAvail, fPrice, fId, Math.max(0, fRealized), intradaySavingsCtKwh !== null, 'blue')
    fleetWaterfall = fBars
  }

  return {
    stages,
    waterfall: bars,
    fleetWaterfall,
    perfectSavingsCtKwh,
    realizedSavingsCtKwh,
    availabilityDragCtKwh: availabilityErrorCtKwh,
    priceForecastDragCtKwh: priceForecastErrorCtKwh,
    intradayCorrectionCtKwh: idCostCtKwh,
  }
}
