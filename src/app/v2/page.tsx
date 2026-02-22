'use client'

import { useState, useMemo } from 'react'
import { usePrices } from '@/lib/use-prices'
import { runOptimization, type OptimizeResult } from '@/lib/optimizer'
import { DEFAULT_SCENARIO, DEFAULT_VALUE_ESTIMATES, DEFAULT_BATTERY_KWH, DEFAULT_CHARGE_POWER_KW, deriveEnergyPerSession, type ChargingScenario, type ValueEstimates } from '@/lib/v2-config'
import { StepNavigation } from '@/components/v2/StepNavigation'
import { Step1PriceExplorer } from '@/components/v2/steps/Step1PriceExplorer'
import { Step2ChargingScenario } from '@/components/v2/steps/Step2ChargingScenario'
import { Step3CustomerBehavior } from '@/components/v2/steps/Step3CustomerBehavior'
import { Step4ValueWaterfall } from '@/components/v2/steps/Step4ValueWaterfall'
import { Step5MarketContext } from '@/components/v2/steps/Step5MarketContext'

const STEPS = [
  { id: 1, title: 'The Price Curve', subtitle: 'Understanding volatility' },
  { id: 2, title: 'Smart Charging', subtitle: 'Interactive load shifting' },
  { id: 3, title: 'Your Profile', subtitle: 'Behavior drives value' },
  { id: 4, title: 'Value Waterfall', subtitle: 'The full value stack' },
  { id: 5, title: 'Market Context', subtitle: 'Why now?' },
]

export default function V2Page() {
  const [currentStep, setCurrentStep] = useState(1)
  const [scenario, setScenario] = useState<ChargingScenario>(DEFAULT_SCENARIO)
  const [valueEstimates, setValueEstimates] = useState<ValueEstimates>(DEFAULT_VALUE_ESTIMATES)
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

  // Annual projection from single-session optimization
  const sessionsPerYear = scenario.weeklyPlugIns * 52
  const annualDayAhead = useMemo(() => {
    if (!optimization) return 150
    return Math.round(optimization.savings_eur * sessionsPerYear)
  }, [optimization, sessionsPerYear])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header */}
      <header className="sticky top-0 z-50 bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1440px] mx-auto px-8 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#EA1C0A] flex items-center justify-center">
              <span className="text-white font-bold text-sm">E.</span>
            </div>
            <div>
              <h1 className="text-lg font-bold text-[#313131]">B2C Flexibility Monetization</h1>
              <p className="text-xs text-gray-500">Smart EV Charging — Value Case</p>
            </div>
          </div>
          <StepNavigation
            steps={STEPS}
            currentStep={currentStep}
            onStepClick={setCurrentStep}
          />
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-8 py-8">
        {currentStep === 1 && (
          <Step1PriceExplorer
            prices={prices}
            onNext={() => setCurrentStep(2)}
          />
        )}
        {currentStep === 2 && (
          <Step2ChargingScenario
            prices={prices}
            scenario={scenario}
            setScenario={setScenario}
            optimization={optimization}
            onNext={() => setCurrentStep(3)}
            onBack={() => setCurrentStep(1)}
          />
        )}
        {currentStep === 3 && (
          <Step3CustomerBehavior
            savingsPerSession={optimization?.savings_eur ?? 0.5}
            baseEnergyKwh={energyPerSession}
            currentMileage={scenario.yearlyMileageKm}
            currentFrequency={scenario.weeklyPlugIns}
            onNext={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
          />
        )}
        {currentStep === 4 && (
          <Step4ValueWaterfall
            annualDayAhead={annualDayAhead}
            valueEstimates={valueEstimates}
            setValueEstimates={setValueEstimates}
            optimization={optimization}
            onNext={() => setCurrentStep(5)}
            onBack={() => setCurrentStep(3)}
          />
        )}
        {currentStep === 5 && (
          <Step5MarketContext
            monthly={prices.monthly}
            daily={prices.daily}
            hourly={prices.hourly}
            onBack={() => setCurrentStep(4)}
            onRestart={() => setCurrentStep(1)}
          />
        )}
      </main>
    </div>
  )
}
