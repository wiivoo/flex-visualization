'use client'

import { useState, useMemo } from 'react'
import { usePrices } from '@/lib/use-prices'
import { runOptimization, type OptimizeResult } from '@/lib/optimizer'
import { DEFAULT_SCENARIO, DEFAULT_BATTERY_KWH, DEFAULT_CHARGE_POWER_KW, deriveEnergyPerSession, type ChargingScenario } from '@/lib/v2-config'
import { Step2ChargingScenario } from '@/components/v2/steps/Step2ChargingScenario'

export default function V2Page() {
  const [scenario, setScenario] = useState<ChargingScenario>(DEFAULT_SCENARIO)
  const prices = usePrices()

  // Derive energy per session from mileage + frequency
  const energyPerSession = useMemo(() =>
    deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weeklyPlugIns),
    [scenario.yearlyMileageKm, scenario.weeklyPlugIns]
  )

  // Compute start/target levels from energy per session for optimizer compat
  const effectiveStartLevel = useMemo(() => {
    const pct = Math.max(10, Math.round(100 - (energyPerSession / DEFAULT_BATTERY_KWH) * 100))
    return Math.min(90, pct)
  }, [energyPerSession])

  // Run optimization for selected day + scenario
  const optimization = useMemo<OptimizeResult | null>(() => {
    if (prices.selectedDayPrices.length === 0) return null

    const pricePoints = prices.selectedDayPrices.map(p => ({
      timestamp: new Date(p.timestamp).toISOString(),
      price_ct_kwh: p.priceCtKwh,
    }))

    try {
      return runOptimization({
        prices: pricePoints,
        battery_kwh: DEFAULT_BATTERY_KWH,
        charge_power_kw: DEFAULT_CHARGE_POWER_KW,
        start_level_percent: effectiveStartLevel,
        target_level_percent: 100,
        window_start: `${scenario.plugInTime}:00`,
        window_end: `${scenario.departureTime}:00`,
        base_price_ct_kwh: 35,
        margin_ct_kwh: 5,
        customer_discount_ct_kwh: 12,
      })
    } catch {
      return null
    }
  }, [prices.selectedDayPrices, scenario.plugInTime, scenario.departureTime, effectiveStartLevel])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-8 py-4">
          <h1 className="text-lg font-bold text-[#313131]">EV Flex Charging — Load Shifting Visualization</h1>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-8 py-8">
        <Step2ChargingScenario
          prices={prices}
          scenario={scenario}
          setScenario={setScenario}
          optimization={optimization}
        />
      </main>
    </div>
  )
}
