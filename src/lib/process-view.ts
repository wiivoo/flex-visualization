/**
 * Process View — Pure computation engine for the chronological optimization timeline.
 *
 * Computes staged re-optimization results (Forecast → DA Nomination → Intraday)
 * under different uncertainty scenarios (Perfect / Realistic / Worst case).
 * Produces waterfall bar data for the value breakdown card.
 *
 * No React, no DOM — pure functions only.
 */

import type { OptimizeResult } from '@/lib/optimizer'
import { runOptimization } from '@/lib/optimizer'
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

export interface StageResult {
  optimizeResult: OptimizeResult
  windowStart: string
  windowEnd: string
  pricesUsed: HourlyPrice[]
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
  daForecastDragCtKwh: number
  availabilityDragCtKwh: number
  intradayCorrectionCtKwh: number
}

/* ── Uncertainty Calibration ── */

export const UNCERTAINTY_CONFIG = {
  realistic: { daPriceNoiseEurMwh: 8, plugInVarianceHours: 1, intradaySpreadEurMwh: 3 },
  worst: { daPriceNoiseEurMwh: 20, plugInVarianceHours: 2, intradaySpreadEurMwh: 10 },
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

/* ── Helper: Build OptimizeInput from ChargingScenario ── */

function buildOptimizeInput(
  prices: HourlyPrice[],
  scenario: ChargingScenario,
  windowStart: string,
  windowEnd: string,
) {
  const vehicle = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId) ?? VEHICLE_PRESETS[1]

  // Convert HourlyPrice[] to PricePoint[] for the optimizer
  const pricePoints = prices.map(p => ({
    timestamp: new Date(p.timestamp).toISOString(),
    price_ct_kwh: p.priceCtKwh,
  }))

  return {
    prices: pricePoints,
    battery_kwh: vehicle.battery_kwh,
    charge_power_kw: scenario.chargePowerKw,
    start_level_percent: scenario.startLevel,
    target_level_percent: scenario.targetLevel,
    window_start: windowStart,
    window_end: windowEnd,
    base_price_ct_kwh: 5.0,
    margin_ct_kwh: 2.15,
    customer_discount_ct_kwh: 1.0,
  }
}

/* ── Waterfall Builder ── */

function buildWaterfall(
  perfectSavingsEur: number,
  daSavingsEur: number,
  forecastSavingsEur: number,
  intradaySavingsEur: number | null,
  energyKwh: number,
): { bars: WaterfallBar[]; perfectCtKwh: number; realizedCtKwh: number; daErrorCtKwh: number; availErrorCtKwh: number; idCostCtKwh: number } {
  const toCtKwh = (eur: number) => energyKwh > 0 ? (eur / energyKwh) * 100 : 0

  const perfectCtKwh = toCtKwh(perfectSavingsEur)
  const daErrorCtKwh = toCtKwh(perfectSavingsEur - daSavingsEur)
  const availErrorCtKwh = toCtKwh(daSavingsEur - forecastSavingsEur)
  const idCostCtKwh = intradaySavingsEur !== null ? toCtKwh(forecastSavingsEur - intradaySavingsEur) : 0

  const realizedSavings = intradaySavingsEur ?? forecastSavingsEur
  const realizedCtKwh = toCtKwh(realizedSavings)

  let runningBase = perfectCtKwh

  const bars: WaterfallBar[] = [
    { label: 'Perfect', base: 0, value: perfectCtKwh, color: 'emerald', isTotal: true },
  ]

  if (daErrorCtKwh > 0) {
    runningBase -= daErrorCtKwh
    bars.push({ label: 'DA Error', base: runningBase, value: -daErrorCtKwh, color: 'red' })
  }

  if (availErrorCtKwh > 0) {
    runningBase -= availErrorCtKwh
    bars.push({ label: 'Avail. Error', base: runningBase, value: -availErrorCtKwh, color: 'red' })
  }

  if (intradaySavingsEur !== null && idCostCtKwh > 0) {
    runningBase -= idCostCtKwh
    bars.push({ label: 'ID Cost', base: runningBase, value: -idCostCtKwh, color: 'red' })
  }

  bars.push({ label: 'Realized', base: 0, value: realizedCtKwh, color: 'emerald', isTotal: true })

  return { bars, perfectCtKwh, realizedCtKwh, daErrorCtKwh, availErrorCtKwh, idCostCtKwh }
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
  showFleet: boolean
  fleetConfig: FleetConfig | null
  dateSeed: string
}): ProcessViewResult {
  const { prices, intradayPrices, scenario, uncertaintyScenario, showFleet, fleetConfig, dateSeed } = params

  const windowStart = `${String(scenario.plugInTime).padStart(2, '0')}:00`
  const windowEnd = `${String(scenario.departureTime).padStart(2, '0')}:00`

  // Perfect reference: real prices + real window
  const perfectInput = buildOptimizeInput(prices, scenario, windowStart, windowEnd)
  const perfectResult = runOptimization(perfectInput)

  // Perturbed values
  const perturbedPrices = perturbPrices(prices, uncertaintyScenario, dateSeed)
  const perturbedWindowStart = perturbWindow(windowStart, uncertaintyScenario, dateSeed)

  // Stage 1 — Forecast: perturbed prices + perturbed window
  const forecastInput = buildOptimizeInput(perturbedPrices, scenario, perturbedWindowStart, windowEnd)
  const forecastResult = runOptimization(forecastInput)

  // Stage 2 — DA Nomination: real prices + perturbed window
  const daInput = buildOptimizeInput(prices, scenario, perturbedWindowStart, windowEnd)
  const daResult = runOptimization(daInput)

  // Stage 3 — Intraday: intraday prices + real window (if available)
  let intradayResult: OptimizeResult | null = null
  if (intradayPrices && intradayPrices.length > 0) {
    const idInput = buildOptimizeInput(intradayPrices, scenario, windowStart, windowEnd)
    intradayResult = runOptimization(idInput)
  }

  const stages: Record<ProcessStage, StageResult | null> = {
    forecast: {
      optimizeResult: forecastResult,
      windowStart: perturbedWindowStart,
      windowEnd,
      pricesUsed: perturbedPrices,
    },
    da_nomination: {
      optimizeResult: daResult,
      windowStart: perturbedWindowStart,
      windowEnd,
      pricesUsed: prices,
    },
    intraday_adjustment: intradayResult ? {
      optimizeResult: intradayResult,
      windowStart,
      windowEnd,
      pricesUsed: intradayPrices!,
    } : null,
  }

  // Waterfall computation
  const energyKwh = perfectResult.energy_charged_kwh || 1 // avoid division by zero
  const intradaySavingsEur = intradayResult ? intradayResult.savings_eur : null

  const { bars, perfectCtKwh, realizedCtKwh, daErrorCtKwh, availErrorCtKwh, idCostCtKwh } = buildWaterfall(
    perfectResult.savings_eur,
    daResult.savings_eur,
    forecastResult.savings_eur,
    intradaySavingsEur,
    energyKwh,
  )

  // Fleet waterfall: scale perturbation noise by 1/sqrt(effectiveFleetSize)
  let fleetWaterfall: WaterfallBar[] | null = null
  if (showFleet && fleetConfig) {
    const effectiveFleetSize = fleetConfig.fleetSize * Math.min(1, (fleetConfig.plugInsPerWeek ?? 3) / 7)
    const sqrtN = Math.sqrt(Math.max(1, effectiveFleetSize))

    // Fleet reduces uncertainty drag bars by sqrt(N) factor
    const fleetDaErrorCtKwh = daErrorCtKwh / sqrtN
    const fleetAvailErrorCtKwh = availErrorCtKwh / sqrtN
    const fleetIdCostCtKwh = idCostCtKwh / sqrtN

    const fleetRealizedCtKwh = perfectCtKwh - fleetDaErrorCtKwh - fleetAvailErrorCtKwh - fleetIdCostCtKwh

    let fleetRunningBase = perfectCtKwh
    const fleetBars: WaterfallBar[] = [
      { label: 'Perfect', base: 0, value: perfectCtKwh, color: 'emerald', isTotal: true },
    ]

    if (fleetDaErrorCtKwh > 0.001) {
      fleetRunningBase -= fleetDaErrorCtKwh
      fleetBars.push({ label: 'DA Error', base: fleetRunningBase, value: -fleetDaErrorCtKwh, color: 'blue' })
    }

    if (fleetAvailErrorCtKwh > 0.001) {
      fleetRunningBase -= fleetAvailErrorCtKwh
      fleetBars.push({ label: 'Avail. Error', base: fleetRunningBase, value: -fleetAvailErrorCtKwh, color: 'blue' })
    }

    if (intradaySavingsEur !== null && fleetIdCostCtKwh > 0.001) {
      fleetRunningBase -= fleetIdCostCtKwh
      fleetBars.push({ label: 'ID Cost', base: fleetRunningBase, value: -fleetIdCostCtKwh, color: 'blue' })
    }

    fleetBars.push({ label: 'Realized', base: 0, value: Math.max(0, fleetRealizedCtKwh), color: 'emerald', isTotal: true })
    fleetWaterfall = fleetBars
  }

  return {
    stages,
    waterfall: bars,
    fleetWaterfall,
    perfectSavingsCtKwh: perfectCtKwh,
    realizedSavingsCtKwh: realizedCtKwh,
    daForecastDragCtKwh: daErrorCtKwh,
    availabilityDragCtKwh: availErrorCtKwh,
    intradayCorrectionCtKwh: idCostCtKwh,
  }
}
