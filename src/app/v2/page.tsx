'use client'

import { useState, useMemo, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePrices } from '@/lib/use-prices'
import { runOptimization, type OptimizeResult } from '@/lib/optimizer'
import { DEFAULT_SCENARIO, DEFAULT_BATTERY_KWH, DEFAULT_CHARGE_POWER_KW, deriveEnergyPerSession, totalWeeklyPlugIns, type ChargingScenario } from '@/lib/v2-config'
import { Step2ChargingScenario } from '@/components/v2/steps/Step2ChargingScenario'
import { TutorialOverlay } from '@/components/v2/TutorialOverlay'

// Parse scenario from URL search params, falling back to defaults
function parseScenario(params: URLSearchParams): ChargingScenario {
  const get = (key: string, fallback: number) => {
    const v = Number(params.get(key))
    return isNaN(v) || v === 0 ? fallback : v
  }
  const mode = params.get('mode')
  // Backward compat: old `plugins` param → split into weekday/weekend
  const hasNewParams = params.has('plugins_wd') || params.has('plugins_we')
  let weekdayPlugIns = DEFAULT_SCENARIO.weekdayPlugIns
  let weekendPlugIns = DEFAULT_SCENARIO.weekendPlugIns
  if (hasNewParams) {
    weekdayPlugIns = get('plugins_wd', DEFAULT_SCENARIO.weekdayPlugIns)
    weekendPlugIns = get('plugins_we', DEFAULT_SCENARIO.weekendPlugIns)
  } else if (params.has('plugins')) {
    const old = get('plugins', 4)
    weekdayPlugIns = Math.min(old, 5)
    weekendPlugIns = Math.max(0, old - 5)
  }
  return {
    ...DEFAULT_SCENARIO,
    yearlyMileageKm: get('mileage', DEFAULT_SCENARIO.yearlyMileageKm),
    weekdayPlugIns,
    weekendPlugIns,
    plugInTime:      get('plugin_time', DEFAULT_SCENARIO.plugInTime),
    departureTime:   get('departure', DEFAULT_SCENARIO.departureTime),
    chargePowerKw:   get('power', DEFAULT_SCENARIO.chargePowerKw),
    chargingMode:    mode === 'fullday' ? 'fullday' : mode === 'threeday' ? 'threeday' : 'overnight',
  }
}

function fallbackCopy(text: string, setCopied: (v: boolean) => void) {
  try {
    const el = document.createElement('textarea')
    el.value = text
    el.style.position = 'fixed'
    el.style.opacity = '0'
    document.body.appendChild(el)
    el.focus()
    el.select()
    document.execCommand('copy')
    document.body.removeChild(el)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  } catch {
    // last resort: open prompt so user can copy manually
    window.prompt('Copy this link:', text)
  }
}

export default function V2Page() {
  return <Suspense><V2Inner /></Suspense>
}

function V2Inner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [scenario, setScenario] = useState<ChargingScenario>(() => parseScenario(searchParams))
  const [copied, setCopied] = useState(false)
  const [showTutorial, setShowTutorial] = useState(false)

  const prices = usePrices()

  // On mount: if URL has a date param, apply it once prices are loaded
  const urlDate = searchParams.get('date')
  useEffect(() => {
    if (urlDate && prices.daily.length > 0) {
      const exists = prices.daily.some(d => d.date === urlDate)
      if (exists) prices.setSelectedDate(urlDate)
    }
    // only run once when prices first load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices.daily.length > 0])

  // Keep URL in sync with scenario + selected date (replace, not push)
  useEffect(() => {
    const p = new URLSearchParams()
    if (prices.selectedDate) p.set('date', prices.selectedDate)
    p.set('mileage',     String(scenario.yearlyMileageKm))
    p.set('plugins_wd',  String(scenario.weekdayPlugIns))
    p.set('plugins_we',  String(scenario.weekendPlugIns))
    p.set('plugin_time', String(scenario.plugInTime))
    p.set('departure',   String(scenario.departureTime))
    if (scenario.chargePowerKw !== 7) p.set('power', String(scenario.chargePowerKw))
    if (scenario.chargingMode !== 'overnight') p.set('mode', scenario.chargingMode)
    router.replace(`/v2?${p.toString()}`, { scroll: false })
  }, [scenario, prices.selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleShare = useCallback(() => {
    const url = window.location.href
    if (navigator?.clipboard?.writeText) {
      navigator.clipboard.writeText(url).then(() => {
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }).catch(() => fallbackCopy(url, setCopied))
    } else {
      fallbackCopy(url, setCopied)
    }
  }, [])


  // Derive energy per session from mileage + frequency
  const energyPerSession = useMemo(() =>
    deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weekdayPlugIns, scenario.weekendPlugIns),
    [scenario.yearlyMileageKm, scenario.weekdayPlugIns, scenario.weekendPlugIns]
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
        <div className="max-w-[1440px] mx-auto px-8 py-4 flex items-center justify-between">
          <h1 className="text-lg font-bold text-[#313131]">EV Flex Charging — Load Shifting Visualization</h1>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowTutorial(true)}
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              Guide
            </button>
            <button
              onClick={handleShare}
              className="flex items-center gap-2 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              {copied ? (
                <>
                  <svg className="w-3.5 h-3.5 text-emerald-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                  </svg>
                  <span className="text-emerald-600">Copied!</span>
                </>
              ) : (
                <>
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
                  </svg>
                  Share
                </>
              )}
            </button>
          </div>
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

      {/* Tutorial overlay */}
      <TutorialOverlay active={showTutorial} onClose={() => setShowTutorial(false)} />
    </div>
  )
}
