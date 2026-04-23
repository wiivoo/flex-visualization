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
 * The annual result is memoized from the derived annual price series, loaded
 * profiles, and the current scenario object so React Compiler can preserve the
 * optimization safely under the repo's lint rules.
 */

import { useMemo } from 'react'
import {
  type AnnualBatteryResult,
} from '@/lib/battery-optimizer'
import {
  getDefaultLoadProfileId,
  isLoadProfileValidForCountry,
  type BatteryScenario,
} from '@/lib/battery-config'
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
  const pricesToUse = useMemo(() => getAnnualModelPrices(prices, scenario), [prices, scenario])
  const profileYear = useMemo(() => {
    const dateLike = pricesToUse[0]?.date ?? prices.selectedDate
    const parsed = Number(dateLike?.slice(0, 4))
    return Number.isFinite(parsed) && parsed > 2000 ? parsed : new Date().getUTCFullYear()
  }, [pricesToUse, prices.selectedDate])
  const loadProfileId = isLoadProfileValidForCountry(scenario.loadProfileId, scenario.country)
    ? scenario.loadProfileId
    : getDefaultLoadProfileId(scenario.country)
  const { pvProfile, loadProfile, loading: profilesLoading } = useBatteryProfiles(scenario.country, loadProfileId, profileYear)

  return useMemo(() => {
    // Guard 1 — profiles still loading or errored.
    if (profilesLoading) return null
    if (!pvProfile || !loadProfile) return null

    // Guard 2 — prices still loading.
    if (prices.loading) return null

    // Guard 3 — no prices to roll up. Prefer QH (96 slots/day); fall back to
    // hourly (24 slots/day). Both are accepted by runBatteryDay via its
    // `slotHours = 24 / N` derivation.
    if (pricesToUse.length === 0) return null
    return deriveAnnualBatteryResult(
      scenario,
      pricesToUse,
      pvProfile,
      loadProfile,
    )
  }, [pvProfile, loadProfile, profilesLoading, prices.loading, pricesToUse, scenario])
}
