'use client'

/**
 * useBatteryYear — derives an annual battery result for the plug-in battery
 * business case page (phase 08). This is a pure React hook: given the current
 * scenario + the full-year price dataset (from `usePrices`), it assembles the
 * inputs `runBatteryYear` needs and returns the `AnnualBatteryResult`.
 *
 * Data flow:
 *   usePrices(country)  →  prices.hourlyQH (preferred) or prices.hourly (fallback)
 *   useBatteryProfiles(country) → { pvProfile, loadProfile }  (8760 normalized hourly)
 *   scenario.variantId  →  getVariant(...)  →  usable kWh, PV capacity, etc.
 *
 * Returns `null` while any dependency is loading / empty / errored so callers
 * can render a placeholder cleanly without defensive guards.
 *
 * The dependency list includes scalar scenario fields only — not the whole
 * scenario object — so unrelated state changes (e.g. tariff id) do not cause
 * a 365-day re-optimization.
 */

import { useMemo } from 'react'
import {
  type AnnualBatteryResult,
} from '@/lib/battery-optimizer'
import { type BatteryScenario } from '@/lib/battery-config'
import {
  deriveAnnualBatteryResult,
  getAnnualModelPrices,
} from '@/lib/battery-economics'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import type { PriceData } from '@/lib/use-prices'

export function useBatteryYear(
  scenario: BatteryScenario,
  prices: PriceData,
): AnnualBatteryResult | null {
  const profiles = useBatteryProfiles(scenario.country)

  return useMemo(() => {
    // Guard 1 — profiles still loading or errored.
    if (profiles.loading) return null
    if (!profiles.pvProfile || !profiles.loadProfile) return null

    // Guard 2 — prices still loading.
    if (prices.loading) return null

    // Guard 3 — no prices to roll up. Prefer QH (96 slots/day); fall back to
    // hourly (24 slots/day). Both are accepted by runBatteryDay via its
    // `slotHours = 24 / N` derivation.
    const pricesToUse = getAnnualModelPrices(prices)
    if (pricesToUse.length === 0) return null
    return deriveAnnualBatteryResult(
      scenario,
      pricesToUse,
      profiles.pvProfile,
      profiles.loadProfile,
    )
  }, [
    profiles.pvProfile,
    profiles.loadProfile,
    profiles.loading,
    prices.hourlyQH,
    prices.hourly,
    prices.loading,
    scenario.variantId,
    scenario.country,
    scenario.annualLoadKwh,
    scenario.feedInCapKw,
  ])
}
