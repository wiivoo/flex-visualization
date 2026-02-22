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
  { id: 'compact', label: 'Compact', battery_kwh: 40, charge_power_kw: 11, examples: 'Zoe, ID.3, Mini E' },
  { id: 'mid', label: 'Mid-Range', battery_kwh: 60, charge_power_kw: 22, examples: 'Model 3, Model Y, Ioniq 6' },
  { id: 'suv', label: 'SUV', battery_kwh: 100, charge_power_kw: 22, examples: 'e-tron, EQS, Model X' },
]

export interface ChargingScenario {
  vehicleId: 'compact' | 'mid' | 'suv'
  plugInTime: number   // hour 14-23
  departureTime: number // hour 4-10
  startLevel: number    // percent 10-80
  targetLevel: number   // percent 50-100
}

export const DEFAULT_SCENARIO: ChargingScenario = {
  vehicleId: 'mid',
  plugInTime: 18,
  departureTime: 7,
  startLevel: 20,
  targetLevel: 80,
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

export const VALUE_RANGES = {
  forwardPurchasing: { min: 30, max: 80, label: 'Forward Purchasing' },
  intradayOptimization: { min: 10, max: 50, label: 'Intraday Re-Optimization' },
  portfolioEffect: { min: 20, max: 60, label: 'Portfolio Effect' },
  gridFeeReduction: { min: 110, max: 190, label: 'Grid Fee Reduction (§14a)' },
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
  date: string       // YYYY-MM-DD
}

/** Daily summary for calendar view */
export interface DailySummary {
  date: string        // YYYY-MM-DD
  avgPrice: number    // ct/kWh
  minPrice: number
  maxPrice: number
  spread: number      // max - min in EUR/MWh
  negativeHours: number
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
}
