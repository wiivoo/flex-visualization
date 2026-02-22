// Shared configuration types and defaults for B2C Flex Monetization

export interface VehicleProfile {
  id: 'klein' | 'medium' | 'suv'
  name: string
  battery_kwh: number
  charge_power_kw: number
  range_km: number
  examples: string[]
}

export const VEHICLE_PROFILES: Record<VehicleProfile['id'], VehicleProfile> = {
  klein: {
    id: 'klein',
    name: 'Compact',
    battery_kwh: 40,
    charge_power_kw: 11,
    range_km: 250,
    examples: ['Zoe', 'ID.3', 'Mini E']
  },
  medium: {
    id: 'medium',
    name: 'Mid-Range',
    battery_kwh: 60,
    charge_power_kw: 22,
    range_km: 350,
    examples: ['Model 3', 'Model Y', 'Ioniq 6']
  },
  suv: {
    id: 'suv',
    name: 'SUV',
    battery_kwh: 100,
    charge_power_kw: 22,
    range_km: 450,
    examples: ['e-tron', 'EQS', 'Model X']
  }
}

export interface DsoProfile {
  id: string
  name: string
  ht_ct_kwh: number  // Hochtarif (day)
  st_ct_kwh: number  // Standardtarif
  nt_ct_kwh: number  // Niedertarif (night)
}

export const DSO_PROFILES: Record<string, DsoProfile> = {
  'eon': { id: 'eon', name: 'E.ON Netz', ht_ct_kwh: 9.2, st_ct_kwh: 7.5, nt_ct_kwh: 4.8 },
  'westnetz': { id: 'westnetz', name: 'Westnetz', ht_ct_kwh: 8.8, st_ct_kwh: 7.2, nt_ct_kwh: 4.5 },
  'tennet': { id: 'tennet', name: 'TenneT (50Hertz)', ht_ct_kwh: 9.0, st_ct_kwh: 7.3, nt_ct_kwh: 4.6 },
  'netzbw': { id: 'netzbw', name: 'Netze BW', ht_ct_kwh: 8.5, st_ct_kwh: 7.0, nt_ct_kwh: 4.3 },
  'bayernwerk': { id: 'bayernwerk', name: 'Bayernwerk', ht_ct_kwh: 8.7, st_ct_kwh: 7.1, nt_ct_kwh: 4.4 },
  'stromnetz-hamburg': { id: 'stromnetz-hamburg', name: 'Stromnetz Hamburg', ht_ct_kwh: 9.5, st_ct_kwh: 7.8, nt_ct_kwh: 5.0 },
  'stromnetz-berlin': { id: 'stromnetz-berlin', name: 'Stromnetz Berlin', ht_ct_kwh: 9.3, st_ct_kwh: 7.6, nt_ct_kwh: 4.9 },
  'syna': { id: 'syna', name: 'Syna (Suedwest)', ht_ct_kwh: 8.6, st_ct_kwh: 7.0, nt_ct_kwh: 4.3 },
  'mitnetz': { id: 'mitnetz', name: 'MITNETZ Strom', ht_ct_kwh: 9.1, st_ct_kwh: 7.4, nt_ct_kwh: 4.7 },
  'avacon': { id: 'avacon', name: 'Avacon Netz', ht_ct_kwh: 8.9, st_ct_kwh: 7.2, nt_ct_kwh: 4.5 },
}

export interface ConfigState {
  vehicle: VehicleProfile['id']
  base_price_ct_kwh: number
  margin_ct_kwh: number
  customer_discount_ct_kwh: number
  start_level_percent: number
  window_start: string
  window_end: string
  dso?: string // Selected DSO for 14a grid fees, undefined = no Modul 3
  priceType?: 'day-ahead' | 'intraday' | 'forward'
}

export const DEFAULT_CONFIG: ConfigState = {
  vehicle: 'medium',
  base_price_ct_kwh: 35,
  margin_ct_kwh: 5,
  customer_discount_ct_kwh: 12,
  start_level_percent: 20,
  window_start: '22:00',
  window_end: '06:00'
}

export const CONFIG_STORAGE_KEY = 'flexmon-config'

export function loadConfig(): ConfigState {
  if (typeof window === 'undefined') return DEFAULT_CONFIG

  try {
    const stored = localStorage.getItem(CONFIG_STORAGE_KEY)
    if (stored) {
      return { ...DEFAULT_CONFIG, ...JSON.parse(stored) }
    }
  } catch (error) {
    console.error('Failed to load config from localStorage:', error)
  }

  return DEFAULT_CONFIG
}

export function saveConfig(config: ConfigState): void {
  if (typeof window === 'undefined') return

  try {
    localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify(config))
  } catch (error) {
    console.error('Failed to save config to localStorage:', error)
  }
}

export function resetConfig(): ConfigState {
  if (typeof window === 'undefined') return DEFAULT_CONFIG

  try {
    localStorage.removeItem(CONFIG_STORAGE_KEY)
  } catch (error) {
    console.error('Failed to remove config from localStorage:', error)
  }

  return DEFAULT_CONFIG
}

export interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

export interface OptimizationResult {
  charging_schedule: ChargingBlock[]
  cost_without_flex_eur: number
  cost_with_flex_eur: number
  savings_eur: number
  customer_benefit_eur: number
  our_margin_eur: number
  win_win_eur: number
  // Additional metrics for comparison visualization
  avg_price_without_flex?: number
  avg_price_with_flex?: number
  energy_charged_kwh?: number
  target_level_reached?: boolean
  // Baseline comparison (immediate charging vs. optimized)
  baseline_schedule?: ChargingBlock[]
  baseline_avg_price?: number
}

export interface ChargingBlock {
  start: string
  end: string
  price_ct_kwh: number
  kwh: number
}
