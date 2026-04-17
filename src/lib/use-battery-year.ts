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
  runBatteryYear,
  type AnnualBatteryResult,
  type BatteryParams,
} from '@/lib/battery-optimizer'
import { getVariant, type BatteryScenario } from '@/lib/battery-config'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import type { PriceData } from '@/lib/use-prices'
import type { HourlyPrice } from '@/lib/v2-config'

/** PVGIS-confirmed south-facing annual yields per kWp installed (kWh/kWp).
 *  Matches the day-chart constants in plan 08-06 for visual + accounting consistency. */
const PV_YIELD_KWH_PER_KWP_DE = 820
const PV_YIELD_KWH_PER_KWP_NL = 730

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
    const pricesToUse: HourlyPrice[] =
      prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
    if (pricesToUse.length === 0) return null

    // Group prices by date so `runBatteryYear` can iterate day-by-day.
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of pricesToUse) {
      const arr = byDate.get(p.date)
      if (arr) arr.push(p)
      else byDate.set(p.date, [p])
    }

    // Variant-derived physical + economic constants.
    const variant = getVariant(scenario.variantId)
    const pvKwp = variant.pvCapacityWp / 1000
    const pvAnnualYield =
      scenario.country === 'DE' ? PV_YIELD_KWH_PER_KWP_DE : PV_YIELD_KWH_PER_KWP_NL
    const pvKwhPerYear = variant.includePv ? pvKwp * pvAnnualYield : 0

    const params: BatteryParams = {
      usableKwh: variant.usableKwh,
      maxChargeKw: variant.maxChargeKw,
      maxDischargeKw: variant.maxDischargeKw,
      roundTripEff: variant.roundTripEff,
      standbyWatts: variant.standbyWatts,
      feedInCapKw: scenario.feedInCapKw,
      // Phase 8 always: Pass 3 of the optimizer unconditionally zeros export.
      // This flag is belt-and-suspenders so upstream contracts are unambiguous.
      allowGridExport: false,
    }

    return runBatteryYear(
      byDate,
      profiles.pvProfile,
      profiles.loadProfile,
      pvKwhPerYear,
      scenario.annualLoadKwh,
      params,
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
