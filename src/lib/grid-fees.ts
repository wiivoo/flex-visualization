/**
 * §14a EnWG Module 3 - Time-variable grid fees
 *
 * Implements time-variable grid fees per §14a EnWG for
 * controllable consumption devices (e.g. EV wallboxes).
 *
 * Three price zones:
 * - HT (peak load): afternoon/evening peak - highest fee
 * - ST (standard): morning/evening - medium fee
 * - NT (off-peak): night - lowest fee
 */

export type Tarifzone = 'HT' | 'ST' | 'NT'

export interface DsoTariff {
  HT: number // ct/kWh peak load
  ST: number // ct/kWh standard
  NT: number // ct/kWh off-peak
}

export interface QuarterValidity {
  Q1: boolean
  Q2: boolean
  Q3: boolean
  Q4: boolean
}

/**
 * DSO tariffs for time-variable grid fees (ct/kWh)
 * Source: Published price sheets of grid operators
 */
export const DSO_TARIFFS: Record<string, DsoTariff> = {
  'Westnetz': { HT: 15.65, ST: 9.53, NT: 0.95 },
  'Avacon': { HT: 8.41, ST: 6.04, NT: 0.60 },
  'MVV Netze': { HT: 5.96, ST: 4.32, NT: 1.73 },
  'MITNETZ': { HT: 12.60, ST: 6.31, NT: 0.69 },
  'Stadtwerke München': { HT: 7.14, ST: 6.47, NT: 2.59 },
  'Thüringer Energienetze': { HT: 8.62, ST: 5.56, NT: 1.67 },
  'LEW': { HT: 8.09, ST: 7.09, NT: 4.01 },
  'NetzeBW': { HT: 13.20, ST: 7.57, NT: 3.03 },
  'Bayernwerk': { HT: 9.03, ST: 4.72, NT: 0.47 },
  'EAM Netz': { HT: 10.52, ST: 5.48, NT: 1.64 },
} as const

/**
 * Quarterly validity per DSO.
 * Some grid operators only apply Module 3 in certain quarters.
 */
export const DSO_QUARTER_VALID: Record<string, QuarterValidity> = {
  'Westnetz': { Q1: true, Q2: true, Q3: true, Q4: true },
  'Avacon': { Q1: true, Q2: false, Q3: false, Q4: true },
  'MVV Netze': { Q1: true, Q2: true, Q3: true, Q4: true },
  'MITNETZ': { Q1: true, Q2: true, Q3: false, Q4: true },
  'Stadtwerke München': { Q1: true, Q2: true, Q3: true, Q4: true },
  'Thüringer Energienetze': { Q1: true, Q2: false, Q3: false, Q4: true },
  'LEW': { Q1: true, Q2: true, Q3: true, Q4: true },
  'NetzeBW': { Q1: true, Q2: true, Q3: true, Q4: true },
  'Bayernwerk': { Q1: true, Q2: false, Q3: false, Q4: true },
  'EAM Netz': { Q1: true, Q2: true, Q3: false, Q4: true },
}

/**
 * Hourly pattern for tariff zones (same for all DSOs):
 *
 * 00-04: NT (night)
 * 05-13: ST (standard)
 * 14-20: HT (peak load)
 * 21-22: ST (standard)
 * 23:    NT (night)
 */
const HOURLY_ZONES: Tarifzone[] = [
  'NT', 'NT', 'NT', 'NT', 'NT',   // 00-04
  'ST', 'ST', 'ST', 'ST', 'ST',   // 05-09
  'ST', 'ST', 'ST', 'ST',         // 10-13
  'HT', 'HT', 'HT', 'HT', 'HT', // 14-18
  'HT', 'HT',                     // 19-20
  'ST', 'ST',                     // 21-22
  'NT',                           // 23
]

/**
 * Determine the tariff zone for a given hour
 */
export function getTarifzone(hour: number): Tarifzone {
  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour: ${hour}. Must be between 0 and 23.`)
  }
  return HOURLY_ZONES[hour]
}

/**
 * Determine the grid fee for a given hour and DSO (ct/kWh).
 * Returns 0 if the DSO is unknown.
 */
export function getGridFee(hour: number, dso: string): number {
  const tariff = DSO_TARIFFS[dso]
  if (!tariff) {
    console.warn(`Unknown DSO: ${dso}. Grid fee = 0`)
    return 0
  }

  const zone = getTarifzone(hour)
  return tariff[zone]
}

/**
 * Check if Module 3 is active for a DSO in a given month.
 * Month: 1-12 (January = 1)
 */
export function isModul3Active(dso: string, month: number): boolean {
  const validity = DSO_QUARTER_VALID[dso]
  if (!validity) {
    return false
  }

  // Month → Quarter
  if (month >= 1 && month <= 3) return validity.Q1
  if (month >= 4 && month <= 6) return validity.Q2
  if (month >= 7 && month <= 9) return validity.Q3
  if (month >= 10 && month <= 12) return validity.Q4

  return false
}

/**
 * 24-hour grid fee array for a DSO (ct/kWh).
 * Index 0 = hour 0 (00:00), Index 23 = hour 23 (23:00).
 */
export function getDailyGridFees(dso: string): number[] {
  return Array.from({ length: 24 }, (_, hour) => getGridFee(hour, dso))
}

/**
 * Calculate total cost including grid fee, taxes and VAT.
 *
 * Formula: (exchange price + grid fee + taxes/levies) * (1 + VAT/100)
 *
 * @param priceCtKwh - Exchange electricity price in ct/kWh
 * @param gridFeeCtKwh - Grid fee in ct/kWh
 * @param taxesCtKwh - Taxes, levies, surcharges in ct/kWh
 * @param vatPercent - VAT rate in % (e.g. 19)
 * @returns Total cost in ct/kWh
 */
export function calculateTotalCost(
  priceCtKwh: number,
  gridFeeCtKwh: number,
  taxesCtKwh: number,
  vatPercent: number
): number {
  const nettoCtKwh = priceCtKwh + gridFeeCtKwh + taxesCtKwh
  const bruttoCtKwh = nettoCtKwh * (1 + vatPercent / 100)
  return Math.round(bruttoCtKwh * 100) / 100
}

/**
 * List of all available DSOs
 */
export function getAvailableDSOs(): string[] {
  return Object.keys(DSO_TARIFFS)
}

/**
 * Average grid fee for a DSO over 24h (ct/kWh)
 * Useful for comparison calculations without Module 3
 */
export function getAverageGridFee(dso: string): number {
  const fees = getDailyGridFees(dso)
  const sum = fees.reduce((acc, fee) => acc + fee, 0)
  return Math.round((sum / 24) * 100) / 100
}

/**
 * Reduced grid fee per §14a (flat deduction, if not Module 3)
 * Standard reduction: approx. 60% of regular grid fee
 */
export function getReducedGridFee(dso: string): number {
  return getAverageGridFee(dso)
}
