/**
 * Management Dashboard — shared types, defaults, and constants (PROJ-40)
 *
 * Pure types/config module. No React or JSX. Used by both the runtime UI
 * (`src/app/management/page.tsx` and siblings) and the offline precompute
 * script (`scripts/precompute-management-monthly.mjs`).
 */

export interface ManagementScenario {
  /** Battery capacity (kWh). Default 60. */
  batteryCapacityKwh: number
  /** Charge power at the wallbox (kW). Default 7. */
  chargePowerKw: number
  /** Plug-in time "HH:MM" (24h). Default "18:00". */
  plugInTime: string
  /** Departure time "HH:MM" (24h). Default "06:00". Windows past midnight wrap. */
  departureTime: string
  /** Charging sessions per week. Default 4. */
  sessionsPerWeek: number
}

export interface MonthlyAggregate {
  year: number
  /** Calendar month, 1..12. */
  month: number
  /** Convenience "YYYY-MM". */
  monthKey: string
  /** Mean over days of (max − min in charging window), ct/kWh. */
  avgSpreadCtKwh: number
  /** Derived: chargePowerKw × windowHours, capped by battery capacity. */
  energyPerSessionKwh: number
  /** sessionsPerWeek × (daysInMonth / 7). */
  sessionsInMonth: number
  /** Total savings (EUR) for the month under the fixed scenario. */
  savingsEur: number
  /** Mean of all QH prices in the month (ct/kWh). */
  avgDayAheadCtKwh: number
}

export interface YoyDatum {
  /** Month-of-year key, "YYYY-MM" — uses year B for display continuity. */
  monthKey: string
  yearA: number
  yearB: number
  /** Total savings in EUR for the A year. */
  valueA: number
  /** Total savings in EUR for the B year. */
  valueB: number
  /** (B − A) / A × 100. `null` when A is 0 (percentage undefined). */
  deltaPct: number | null
}

export interface ExplainerData {
  /** Month this explainer describes ("YYYY-MM") or "" when empty. */
  monthKey: string
  /** Averaged QH price profile across all days in the month. Length 96. */
  avgQhProfile: { qhIndex: number; ctKwh: number }[]
  /** Inclusive QH indices for the charging (optimized) window. Wraps midnight. */
  chargingWindow: { startQh: number; endQh: number }
  /** Inclusive QH indices for the "dumb" baseline window (starts at plug-in). */
  baselineWindow: { startQh: number; endQh: number }
  /** Spread in ct/kWh used by reconciliation = max − min across the charging window profile. */
  spreadCtKwh: number
  /** Energy delivered per session (kWh). */
  energyPerSessionKwh: number
  /** Sessions-in-month count this explainer was computed for. */
  sessionsInMonth: number
  /** Reconciled € savings: spreadCtKwh/100 × energyPerSessionKwh × sessionsInMonth. */
  reconciledSavingsEur: number
}

export interface ManagementDataset {
  schemaVersion: 1
  /** ISO timestamp of generation run. */
  generatedAt: string
  scenario: ManagementScenario
  monthly: MonthlyAggregate[]
  /** Explainer for the latest complete month in the dataset. */
  explainer: ExplainerData
}

/**
 * Default fixed scenario for the management dashboard.
 *
 * These numbers are intentionally locked so headline savings are comparable
 * across months / years / audiences. Light settings drawer persists user
 * overrides to localStorage only — never to URL.
 */
export const DEFAULT_MANAGEMENT_SCENARIO: ManagementScenario = {
  batteryCapacityKwh: 60,
  chargePowerKw: 7,
  plugInTime: '18:00',
  departureTime: '06:00',
  sessionsPerWeek: 4,
}

/** localStorage key for the user's private scenario overrides. */
export const MANAGEMENT_STORAGE_KEY = 'flexmon-management-scenario-v1'

/** Public URL of the precomputed monthly dataset. */
export const MANAGEMENT_DATA_URL = '/data/management-monthly.json'
