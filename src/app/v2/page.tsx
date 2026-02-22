'use client'

import { useState, useMemo } from 'react'
import { usePrices } from '@/lib/use-prices'
import { runOptimization, type OptimizeResult } from '@/lib/optimizer'
import { VEHICLE_PRESETS, DEFAULT_SCENARIO, DEFAULT_VALUE_ESTIMATES, type ChargingScenario, type ValueEstimates } from '@/lib/v2-config'
import { StepNavigation } from '@/components/v2/StepNavigation'
import { Step1PriceExplorer } from '@/components/v2/steps/Step1PriceExplorer'
import { Step2ChargingScenario } from '@/components/v2/steps/Step2ChargingScenario'
import { Step3ValueWaterfall } from '@/components/v2/steps/Step3ValueWaterfall'
import { Step4PortfolioScale } from '@/components/v2/steps/Step4PortfolioScale'
import { Step5MarketContext } from '@/components/v2/steps/Step5MarketContext'

const STEPS = [
  { id: 1, title: 'The Price Curve', subtitle: 'Understanding volatility' },
  { id: 2, title: 'Smart Charging', subtitle: 'Interactive load shifting' },
  { id: 3, title: 'Value Waterfall', subtitle: 'Breaking down 430 EUR/year' },
  { id: 4, title: 'Portfolio Scale', subtitle: 'From 1 to 100,000 EVs' },
  { id: 5, title: 'Market Context', subtitle: 'Why now?' },
]

export default function V2Page() {
  const [currentStep, setCurrentStep] = useState(1)
  const [scenario, setScenario] = useState<ChargingScenario>(DEFAULT_SCENARIO)
  const [valueEstimates, setValueEstimates] = useState<ValueEstimates>(DEFAULT_VALUE_ESTIMATES)
  const prices = usePrices()

  // Run optimization for selected day + scenario
  const optimization = useMemo<OptimizeResult | null>(() => {
    if (prices.selectedDayPrices.length === 0) return null

    const vehicle = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId) || VEHICLE_PRESETS[1]
    const pricePoints = prices.selectedDayPrices.map(p => ({
      timestamp: new Date(p.timestamp).toISOString(),
      price_ct_kwh: p.priceCtKwh,
    }))

    try {
      return runOptimization({
        prices: pricePoints,
        battery_kwh: vehicle.battery_kwh,
        charge_power_kw: vehicle.charge_power_kw,
        start_level_percent: scenario.startLevel,
        target_level_percent: scenario.targetLevel,
        window_start: `${scenario.plugInTime}:00`,
        window_end: `${scenario.departureTime}:00`,
        base_price_ct_kwh: 35,
        margin_ct_kwh: 5,
        customer_discount_ct_kwh: 12,
      })
    } catch {
      return null
    }
  }, [prices.selectedDayPrices, scenario])

  // Annual projection from single-session optimization
  const annualDayAhead = useMemo(() => {
    if (!optimization) return 150 // default estimate
    // ~200 sessions/year (3-4 per week)
    return Math.round(optimization.savings_eur * 200)
  }, [optimization])

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
          <Step3ValueWaterfall
            annualDayAhead={annualDayAhead}
            valueEstimates={valueEstimates}
            setValueEstimates={setValueEstimates}
            optimization={optimization}
            onNext={() => setCurrentStep(4)}
            onBack={() => setCurrentStep(2)}
          />
        )}
        {currentStep === 4 && (
          <Step4PortfolioScale
            annualDayAhead={annualDayAhead}
            valueEstimates={valueEstimates}
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
