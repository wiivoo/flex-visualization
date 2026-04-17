/**
 * Battery Configuration — shared types and constants for the /battery business case page.
 *
 * Mirrors the pattern of src/lib/v2-config.ts. Used by:
 *  - src/lib/battery-optimizer.ts (types for params/results)
 *  - src/app/battery/page.tsx (default scenario, URL parse/serialize)
 *  - src/components/battery/*.tsx (display labels, variant picker data)
 *
 * All locked values sourced from:
 *  - .planning/phases/08-plug-in-battery-business-case-de-nl/08-CONTEXT.md (user decisions)
 *  - .planning/phases/08-plug-in-battery-business-case-de-nl/08-RESEARCH.md (sourced product specs)
 */

import type { HourlyPrice } from '@/lib/v2-config'
export type { HourlyPrice }

// ---------------------------------------------------------------------------
// Battery variants
// ---------------------------------------------------------------------------

export interface BatteryVariant {
  id: 'schuko-2kwh' | 'balcony-pv-1.6kwh' | 'wall-5kwh'
  label: string
  description: string
  // Physical specs
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number        // AC-to-AC (0..1), default 0.88
  standbyWatts: number
  includePv: boolean
  pvCapacityWp: number
  // Economics
  hardwareCostEurIncVat: number
  vatRate: number             // 0.00 (PV bundle) or 0.19 (standalone DE) — NL uses 0.21 at display time
  warrantyYears: number
  cycleLife: number
  // Regulation
  feedInCapKw: number
  electricianRequired: boolean
  priceConfidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export const BATTERY_VARIANTS: BatteryVariant[] = [
  {
    id: 'schuko-2kwh',
    label: 'Schuko Steckerspeicher',
    description: 'Marstek Venus B — 2 kWh, Schuko plug, no PV',
    usableKwh: 2.0,
    maxChargeKw: 1.5,
    maxDischargeKw: 0.8,     // DE self-consumption cap; no grid export allowed
    roundTripEff: 0.88,
    standbyWatts: 10,
    includePv: false,
    pvCapacityWp: 0,
    hardwareCostEurIncVat: 595,  // €499 placeholder × 1.19 VAT — see priceConfidence LOW
    vatRate: 0.19,
    warrantyYears: 5,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    electricianRequired: false,
    priceConfidence: 'LOW',
  },
  {
    id: 'balcony-pv-1.6kwh',
    label: 'Balkonkraftwerk + Speicher',
    description: 'Anker SOLIX Solarbank 2 E1600 Pro — 800 Wp PV + 1.52 kWh',
    usableKwh: 1.52,
    maxChargeKw: 2.0,
    maxDischargeKw: 1.0,
    roundTripEff: 0.88,
    standbyWatts: 8,
    includePv: true,
    pvCapacityWp: 800,
    hardwareCostEurIncVat: 1499,  // €1,199 unit + ~€300 panels, 0% VAT (PV + battery bundle)
    vatRate: 0.00,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    electricianRequired: false,
    priceConfidence: 'HIGH',
  },
  {
    id: 'wall-5kwh',
    label: 'Wandbatterie (Elektriker)',
    description: 'Marstek Venus E 3.0 — 5.12 kWh, requires electrician',
    usableKwh: 4.6,            // ~90% DoD of 5.12 kWh nominal
    maxChargeKw: 2.5,
    maxDischargeKw: 2.5,
    roundTripEff: 0.88,        // conservative; stated >93.5% is cell-level only
    standbyWatts: 12,
    includePv: false,
    pvCapacityWp: 0,
    hardwareCostEurIncVat: 1570,  // €1,319 sale × 1.19 VAT (standalone, no PV)
    vatRate: 0.19,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    electricianRequired: true,
    priceConfidence: 'MEDIUM',
  },
]

// ---------------------------------------------------------------------------
// Tariffs (dynamic electricity suppliers)
// ---------------------------------------------------------------------------

export interface Tariff {
  id: string
  label: string
  country: 'DE' | 'NL'
  monthlyFeeEur: number
  /** NL-only: % of market rate paid for exports. 0 in DE. */
  exportCompensationDefaultPct: number
}

export const DE_TARIFFS: Tariff[] = [
  { id: 'tibber-de',  label: 'Tibber DE',      country: 'DE', monthlyFeeEur: 5.99, exportCompensationDefaultPct: 0 },
  { id: 'awattar-de', label: 'aWATTar',        country: 'DE', monthlyFeeEur: 4.58, exportCompensationDefaultPct: 0 },
  { id: 'rabot-de',   label: 'Rabot Charge',   country: 'DE', monthlyFeeEur: 4.99, exportCompensationDefaultPct: 0 },
  { id: 'octopus-de', label: 'Octopus DE',     country: 'DE', monthlyFeeEur: 4.99, exportCompensationDefaultPct: 0 },
]

export const NL_TARIFFS: Tariff[] = [
  { id: 'frank-energie', label: 'Frank Energie', country: 'NL', monthlyFeeEur: 4.99, exportCompensationDefaultPct: 115 },
  { id: 'anwb-energie',  label: 'ANWB Energie',  country: 'NL', monthlyFeeEur: 4.99, exportCompensationDefaultPct: 50 },
  { id: 'tibber-nl',     label: 'Tibber NL',     country: 'NL', monthlyFeeEur: 5.99, exportCompensationDefaultPct: 50 },
  { id: 'zonneplan-nl',  label: 'Zonneplan',     country: 'NL', monthlyFeeEur: 4.50, exportCompensationDefaultPct: 50 },
]

// ---------------------------------------------------------------------------
// Scenario state (URL-synced)
// ---------------------------------------------------------------------------

export interface BatteryScenario {
  variantId: 'schuko-2kwh' | 'balcony-pv-1.6kwh' | 'wall-5kwh'
  country: 'DE' | 'NL'
  tariffId: string
  annualLoadKwh: number
  feedInCapKw: 0.8 | 2.0
  terugleverCostEur: number           // NL only; 0 in DE
  exportCompensationPct: number       // NL only; 0 in DE
  selectedDate: string                // 'YYYY-MM-DD' or ''
  nlRegime: 'post2027'                // reserved for future; only post-2027 modeled
}

export const DEFAULT_BATTERY_SCENARIO: BatteryScenario = {
  variantId: 'schuko-2kwh',
  country: 'DE',
  tariffId: 'awattar-de',
  annualLoadKwh: 2500,
  feedInCapKw: 0.8,
  terugleverCostEur: 0,
  exportCompensationPct: 50,
  selectedDate: '',
  nlRegime: 'post2027',
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function getVariant(id: BatteryVariant['id']): BatteryVariant {
  const v = BATTERY_VARIANTS.find(x => x.id === id)
  if (!v) throw new Error(`Unknown battery variant: ${id}`)
  return v
}

export function getTariffsFor(country: 'DE' | 'NL'): Tariff[] {
  return country === 'DE' ? DE_TARIFFS : NL_TARIFFS
}

export function getTariff(id: string, country: 'DE' | 'NL'): Tariff | undefined {
  return getTariffsFor(country).find(t => t.id === id)
}
