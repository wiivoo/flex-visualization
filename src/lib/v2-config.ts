/**
 * V2 Configuration — shared types and constants for the storytelling flow
 */

export interface VehiclePreset {
  id: 'compact' | 'mid' | 'suv'
  label: string
  battery_kwh: number
  charge_power_kw: number
  examples: string
}

export const VEHICLE_PRESETS: VehiclePreset[] = [
  { id: 'compact', label: 'Compact', battery_kwh: 40, charge_power_kw: 7, examples: 'Zoe, ID.3, Mini E' },
  { id: 'mid', label: 'Mid-Range', battery_kwh: 60, charge_power_kw: 7, examples: 'Model 3, Model Y, Ioniq 6' },
  { id: 'suv', label: 'SUV', battery_kwh: 100, charge_power_kw: 7, examples: 'e-tron, EQS, Model X' },
]

export interface ChargingScenario {
  vehicleId: 'compact' | 'mid' | 'suv'
  plugInTime: number   // hour 14-23
  departureTime: number // hour 4-10
  startLevel: number    // percent 10-80
  targetLevel: number   // percent 50-100
  yearlyMileageKm: number  // 5000-40000
  weekdayPlugIns: number   // 0-5 (Mon-Fri)
  weekendPlugIns: number   // 0-2 (Sat-Sun)
  chargePowerKw: number    // 7 or 11
  chargingMode: 'overnight' | 'fullday' | 'threeday'
  gridMode: 'v1g' | 'v2g'  // V1G = smart charging only, V2G = bidirectional
  // V2G-specific settings (only used when gridMode === 'v2g')
  v2gStartSoc: number          // percent 10-90 — battery level at plug-in
  v2gTargetSoc: number         // percent 50-100 — required level at departure
  dischargePowerKw: number     // 5, 7, or 11 kW
  roundTripEfficiency: number  // 0.80-0.95 (default 0.88)
  degradationCtKwh: number    // 1-8 ct/kWh (battery wear cost per kWh cycled)
  minSocPercent: number        // 10-40% (floor SoC during session, never go below)
  v2gBatteryKwh: number        // 20-120 kWh in 10 kWh steps (V2G battery size)
}

/** Total weekly plug-ins (weekday + weekend) */
export function totalWeeklyPlugIns(s: ChargingScenario): number {
  return s.weekdayPlugIns + s.weekendPlugIns
}

export const DEFAULT_SCENARIO: ChargingScenario = {
  vehicleId: 'mid',
  plugInTime: 18,
  departureTime: 7,
  startLevel: 20,
  targetLevel: 80,
  yearlyMileageKm: 12000,
  weekdayPlugIns: 2,
  weekendPlugIns: 0,
  chargePowerKw: 7,
  chargingMode: 'overnight',
  gridMode: 'v1g',
  v2gStartSoc: 40,
  v2gTargetSoc: 80,
  dischargePowerKw: 7,
  roundTripEfficiency: 0.88,
  degradationCtKwh: 3,
  minSocPercent: 20,
  v2gBatteryKwh: 60,
}

/** Average EV consumption in kWh per 100 km */
export const AVG_CONSUMPTION_KWH_PER_100KM = 19

/** Default wallbox power in kW (net at home) */
export const DEFAULT_CHARGE_POWER_KW = 7

/** Default battery capacity */
export const DEFAULT_BATTERY_KWH = 60

/** Derive energy per session from mileage + frequency */
export function deriveEnergyPerSession(yearlyMileageKm: number, weekdayPlugIns: number, weekendPlugIns?: number): number {
  const weekly = Math.max(1, weekendPlugIns !== undefined ? weekdayPlugIns + weekendPlugIns : weekdayPlugIns)
  const sessionsPerYear = weekly * 52
  const kmPerSession = yearlyMileageKm / sessionsPerYear
  return Math.round((kmPerSession / 100) * AVG_CONSUMPTION_KWH_PER_100KM * 10) / 10
}

/** Value layer estimates (EUR/year per EV) */
export interface ValueEstimates {
  forwardPurchasing: number
  intradayOptimization: number
  portfolioEffect: number
  gridFeeReduction: number
}

export const DEFAULT_VALUE_ESTIMATES: ValueEstimates = {
  forwardPurchasing: 50,
  intradayOptimization: 25,
  portfolioEffect: 40,
  gridFeeReduction: 165,
}

/** Competitor benchmarks for comparison */
export const COMPETITOR_BENCHMARKS = [
  { name: 'Octopus Energy', value: 450, type: 'Smart tariff (V1G)', hardware: 'Smart meter only' },
  { name: 'The Mobility House', value: 650, type: 'V2G EPEX trading', hardware: 'Bidirectional charger' },
  { name: 'Sonnen', value: 250, type: 'VPP + §14a', hardware: 'Sonnen battery' },
  { name: '1KOMMA5°', value: 2201, type: 'Full system', hardware: 'PV+Battery+WB+HP' },
]

/** Hourly price data point */
export interface HourlyPrice {
  timestamp: number  // Unix ms
  priceEurMwh: number
  priceCtKwh: number
  hour: number       // 0-23
  minute: number     // 0 for hourly, 0/15/30/45 for quarter-hourly
  date: string       // YYYY-MM-DD
  isProjected?: boolean  // true for CSV-based projected prices (not real SMARD data)
}

/** Daily summary for calendar view */
export interface DailySummary {
  date: string        // YYYY-MM-DD
  avgPrice: number    // ct/kWh
  minPrice: number
  maxPrice: number
  spread: number      // max - min in EUR/MWh
  negativeHours: number
  dayAvgPrice: number  // EUR/MWh avg 6:00-22:00
  nightAvgPrice: number // EUR/MWh avg 22:00-6:00
  dayNightSpread: number // dayAvg - nightAvg
  priceAt18: number    // EUR/MWh price at 18:00 (typical arrival)
  cheapestNightPrice: number // EUR/MWh cheapest hour in 22:00-06:00
  nightSpread: number  // priceAt18 - cheapestNightPrice (the real opportunity)
  isProjected?: boolean  // true if any hour in this day uses projected prices
}

/** Monthly stats for volatility analysis */
export interface MonthlyStats {
  month: string       // YYYY-MM
  avgSpread: number   // EUR/MWh
  avgPrice: number    // EUR/MWh
  minPrice: number
  maxPrice: number
  negativeHours: number
  totalHours: number
  avgNightSpread: number  // avg cheapest night hour spread
  isProjected?: boolean   // true if any day in this month uses projected prices
}

/** Hourly generation data point */
export interface GenerationData {
  timestamp: number
  hour: number
  solarMw: number
  windMw: number
  loadMw: number
  renewableMw: number
  renewableShare: number  // percentage
}
