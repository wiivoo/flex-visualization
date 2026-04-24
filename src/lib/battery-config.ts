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
  shortLabel: string
  typeLabel: string
  description: string
  merchantLabel: string
  buyUrl: string
  currentPriceEur: number
  priceAsOf: string
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
  lockedDischargeCapKw: number | null
  electricianRequired: boolean
  priceConfidence: 'HIGH' | 'MEDIUM' | 'LOW'
}

export const BATTERY_VARIANTS: BatteryVariant[] = [
  {
    id: 'schuko-2kwh',
    label: 'Marstek Venus B',
    shortLabel: 'Venus B',
    typeLabel: 'Plug-in balcony storage',
    description: '2.12 kWh all-in-one balcony battery with integrated inverter. Good for showing the 800 W discharge bottleneck.',
    merchantLabel: 'Marstek Power EU',
    buyUrl: 'https://marstek-power.eu/en/marstek-venus-b-2kwh-plug-in-home-battery',
    currentPriceEur: 599,
    priceAsOf: 'Apr 2026',
    usableKwh: 2.0,
    maxChargeKw: 1.5,
    maxDischargeKw: 0.8,     // DE self-consumption cap; no grid export allowed
    roundTripEff: 0.88,
    standbyWatts: 10,
    includePv: false,
    pvCapacityWp: 0,
    hardwareCostEurIncVat: 599,
    vatRate: 0.00,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    lockedDischargeCapKw: 0.8,
    electricianRequired: false,
    priceConfidence: 'MEDIUM',
  },
  {
    id: 'balcony-pv-1.6kwh',
    label: 'Anker SOLIX Solarbank 2 E1600 Pro',
    shortLabel: 'Solarbank 2 E1600 Pro',
    typeLabel: 'Balcony PV + battery',
    description: '1.6 kWh balcony storage that pairs directly with small PV. Same dynamic-price story, plus PV self-consumption.',
    merchantLabel: 'idealo lowest offer',
    buyUrl: 'https://www.idealo.de/preisvergleich/OffersOfProduct/205580737_-solix-solarbank-2-e1600-pro-solix-smart-meter-anker-tech.html',
    currentPriceEur: 471.9,
    priceAsOf: 'Apr 2026',
    usableKwh: 1.52,
    maxChargeKw: 2.0,
    maxDischargeKw: 0.8,
    roundTripEff: 0.88,
    standbyWatts: 8,
    includePv: true,
    pvCapacityWp: 800,
    hardwareCostEurIncVat: 471.9,
    vatRate: 0.00,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    lockedDischargeCapKw: 0.8,
    electricianRequired: false,
    priceConfidence: 'HIGH',
  },
  {
    id: 'wall-5kwh',
    label: 'Marstek Venus E Gen 3.0',
    shortLabel: 'Venus E 3.0',
    typeLabel: 'AC-coupled home battery',
    description: '5.12 kWh AC-coupled storage with much higher output power. This is the variant where the discharge cap becomes a real user control.',
    merchantLabel: 'idealo lowest offer',
    buyUrl: 'https://www.idealo.de/preisvergleich/Liste/122399645/marstek-venus-e-version-3-0.html',
    currentPriceEur: 961.8,
    priceAsOf: 'Apr 2026',
    usableKwh: 4.6,            // ~90% DoD of 5.12 kWh nominal
    maxChargeKw: 2.5,
    maxDischargeKw: 2.5,
    roundTripEff: 0.88,        // conservative; stated >93.5% is cell-level only
    standbyWatts: 12,
    includePv: false,
    pvCapacityWp: 0,
    hardwareCostEurIncVat: 961.8,
    vatRate: 0.19,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 2.5,
    lockedDischargeCapKw: null,
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
  { id: 'enviam-vision', label: 'enviaM MEIN STROM Vision', country: 'DE', monthlyFeeEur: 2.67, exportCompensationDefaultPct: 0 },
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
// Household load profiles
// ---------------------------------------------------------------------------

export type DeBatteryLoadProfileId = 'H0' | 'H25' | 'P25' | 'S25'
export type NlBatteryLoadProfileId = 'E1A' | 'E1B' | 'E1C'
export type BatteryLoadProfileId = DeBatteryLoadProfileId | NlBatteryLoadProfileId

export interface BatteryLoadProfileOption {
  id: BatteryLoadProfileId
  label: string
  description: string
  detail: string
}

export const DE_BATTERY_LOAD_PROFILES: BatteryLoadProfileOption[] = [
  {
    id: 'H0',
    label: 'BDEW H0',
    description: 'Classical residential SLP',
    detail: 'Official BDEW H0 household profile with the familiar morning and evening demand pattern.',
  },
  {
    id: 'H25',
    label: 'BDEW H25',
    description: '2025 household SLP',
    detail: 'Official BDEW H25 profile with a broader all-day residential demand shape.',
  },
  {
    id: 'P25',
    label: 'BDEW P25',
    description: 'Household + PV',
    detail: 'BDEW P25 profile for homes with PV. Better suited when midday demand already shifts around local generation.',
  },
  {
    id: 'S25',
    label: 'BDEW S25',
    description: 'Household + PV + battery',
    detail: 'BDEW S25 profile for homes with PV and storage. Useful when you want the background demand shape to reflect a prosumer household.',
  },
]

export const NL_BATTERY_LOAD_PROFILES: BatteryLoadProfileOption[] = [
  {
    id: 'E1A',
    label: 'E1A standard',
    description: 'Standard flat / household',
    detail: 'Balanced Dutch residential curve. Good default for apartment-style demand.',
  },
  {
    id: 'E1B',
    label: 'E1B night',
    description: 'Night-heavier household',
    detail: 'More overnight consumption, which makes cheap-night charging easier to capture.',
  },
  {
    id: 'E1C',
    label: 'E1C evening peak',
    description: 'Evening-peaking household',
    detail: 'Sharper evening demand peak. This makes the 800 W discharge limit more visible.',
  },
]

// ---------------------------------------------------------------------------
// Scenario state (URL-synced)
// ---------------------------------------------------------------------------

export interface BatteryScenario {
  variantId: 'schuko-2kwh' | 'balcony-pv-1.6kwh' | 'wall-5kwh'
  country: 'DE' | 'NL'
  tariffId: string
  loadProfileId: BatteryLoadProfileId
  customMode: boolean
  annualLoadKwh: number
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  pvCapacityWp: number
  feedInCapKw: number
  terugleverCostEur: number           // NL only; 0 in DE
  exportCompensationPct: number       // NL only; 0 in DE
  selectedDate: string                // 'YYYY-MM-DD' or ''
  nlRegime: 'post2027'                // reserved for future; only post-2027 modeled
}

export const DEFAULT_BATTERY_SCENARIO: BatteryScenario = {
  variantId: 'schuko-2kwh',
  country: 'DE',
  tariffId: 'enviam-vision',
  loadProfileId: 'H0',
  customMode: false,
  annualLoadKwh: 2500,
  usableKwh: 2.0,
  maxChargeKw: 1.5,
  maxDischargeKw: 0.8,
  pvCapacityWp: 0,
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

export function getScenarioVariant(scenario: BatteryScenario): BatteryVariant {
  const variant = getVariant(scenario.variantId)
  if (!scenario.customMode) return variant

  return {
    ...variant,
    usableKwh: scenario.usableKwh,
    maxChargeKw: scenario.maxChargeKw,
    maxDischargeKw: scenario.maxDischargeKw,
    pvCapacityWp: scenario.pvCapacityWp,
  }
}

export function getTariffsFor(country: 'DE' | 'NL'): Tariff[] {
  return country === 'DE' ? DE_TARIFFS : NL_TARIFFS
}

export function getTariff(id: string, country: 'DE' | 'NL'): Tariff | undefined {
  return getTariffsFor(country).find(t => t.id === id)
}

export function getDefaultDischargeCapKw(variant: BatteryVariant): number {
  return variant.lockedDischargeCapKw ?? variant.feedInCapKw
}

export function getLoadProfilesForCountry(country: 'DE' | 'NL'): BatteryLoadProfileOption[] {
  return country === 'DE' ? DE_BATTERY_LOAD_PROFILES : NL_BATTERY_LOAD_PROFILES
}

export function getDefaultLoadProfileId(country: 'DE' | 'NL'): BatteryLoadProfileId {
  return country === 'DE' ? 'H0' : 'E1A'
}

export function isLoadProfileValidForCountry(
  loadProfileId: string,
  country: 'DE' | 'NL',
): loadProfileId is BatteryLoadProfileId {
  return getLoadProfilesForCountry(country).some((profile) => profile.id === loadProfileId)
}

export function getLoadProfile(
  loadProfileId: BatteryLoadProfileId,
  country: 'DE' | 'NL',
): BatteryLoadProfileOption {
  const profile = getLoadProfilesForCountry(country).find((option) => option.id === loadProfileId)
  if (!profile) {
    throw new Error(`Unknown load profile ${loadProfileId} for country ${country}`)
  }
  return profile
}
