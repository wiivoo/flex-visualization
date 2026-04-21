'use client'

import { useState, useMemo, useEffect, useCallback, useRef, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePrices } from '@/lib/use-prices'
import { runOptimization, type OptimizeResult } from '@/lib/optimizer'
import { DEFAULT_SCENARIO, DEFAULT_BATTERY_KWH, DEFAULT_CHARGE_POWER_KW, deriveEnergyPerSession, totalWeeklyPlugIns, splitPlugInDays, type ChargingScenario, type DayOfWeek } from '@/lib/v2-config'
import { DEFAULT_GB_DAY_AHEAD_AUCTION, type GbDayAheadAuction } from '@/lib/gb-day-ahead'
import { Step2ChargingScenario } from '@/components/v2/steps/Step2ChargingScenario'
import { TutorialOverlay } from '@/components/v2/TutorialOverlay'
import { ExportDialog } from '@/components/v2/ExportDialog'
import type { FleetConfig } from '@/lib/v2-config'
import type { EnrichedWindow } from '@/lib/excel-export'

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
  // Parse explicit day selection (e.g. days=1,3,5 for Mon,Wed,Fri)
  let plugInDays: DayOfWeek[] | undefined = undefined
  if (params.has('days')) {
    const parsed = params.get('days')!.split(',').map(Number).filter(n => n >= 0 && n <= 6) as DayOfWeek[]
    if (parsed.length > 0) {
      plugInDays = parsed
      const split = splitPlugInDays(parsed)
      weekdayPlugIns = split.weekdayPlugIns
      weekendPlugIns = split.weekendPlugIns
    }
  }
  return {
    ...DEFAULT_SCENARIO,
    yearlyMileageKm: get('mileage', DEFAULT_SCENARIO.yearlyMileageKm),
    weekdayPlugIns,
    weekendPlugIns,
    plugInDays,
    plugInTime:      get('plugin_time', DEFAULT_SCENARIO.plugInTime),
    departureTime:   get('departure', DEFAULT_SCENARIO.departureTime),
    chargePowerKw:   get('power', DEFAULT_SCENARIO.chargePowerKw),
    chargingMode:    mode === 'fullday' ? 'fullday' : mode === 'threeday' ? 'threeday' : 'overnight',
  }
}

function parseCountry(params: URLSearchParams): 'DE' | 'NL' | 'GB' {
  const value = params.get('country')
  return value === 'NL' || value === 'GB' ? value : 'DE'
}

function parseGbAuction(params: URLSearchParams): GbDayAheadAuction {
  return params.get('gb_auction') === 'daa2' ? 'daa2' : DEFAULT_GB_DAY_AHEAD_AUCTION
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
  const [exportDialogOpen, setExportDialogOpen] = useState(false)
  const [exportData, setExportData] = useState<{
    overnightWindows: EnrichedWindow[]
    showFleet: boolean
    fleetConfig: FleetConfig
    resolution: 'hour' | 'quarterhour'
  } | null>(null)
  const [country, setCountry] = useState<'DE' | 'NL' | 'GB'>(() => parseCountry(searchParams))
  const [gbAuction, setGbAuction] = useState<GbDayAheadAuction>(() => parseGbAuction(searchParams))
  const prevCountryRef = useRef(country)

  const prices = usePrices(country, gbAuction)

  // If a non-DE country fails to load, auto-revert to DE
  useEffect(() => {
    if (prices.error && country !== 'DE') {
      console.warn(`[country] ${country} failed: ${prices.error} — reverting to DE`)
      setCountry('DE')
    }
    prevCountryRef.current = country
  }, [prices.error, country])

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
    if (country !== 'DE') p.set('country', country)
    if (country === 'GB') p.set('gb_auction', gbAuction)
    p.set('mileage',     String(scenario.yearlyMileageKm))
    p.set('plugins_wd',  String(scenario.weekdayPlugIns))
    p.set('plugins_we',  String(scenario.weekendPlugIns))
    p.set('plugin_time', String(scenario.plugInTime))
    p.set('departure',   String(scenario.departureTime))
    if (scenario.chargePowerKw !== 7) p.set('power', String(scenario.chargePowerKw))
    if (scenario.chargingMode !== 'overnight') p.set('mode', scenario.chargingMode)
    if (scenario.plugInDays) p.set('days', [...scenario.plugInDays].sort((a, b) => a - b).join(','))
    router.replace(`/v2?${p.toString()}`, { scroll: false })
  }, [scenario, prices.selectedDate, country, gbAuction]) // eslint-disable-line react-hooks/exhaustive-deps

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
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-400">EV Flex Charging — Load Shifting Visualization</h1>
          <div className="flex items-center gap-2">
            <details className="relative">
              <summary className="list-none flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors cursor-pointer select-none">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
                </svg>
                More
              </summary>
              <div className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-gray-200 bg-white shadow-lg p-1.5 z-20">
                <Link
                  href="/dynamic"
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Dynamic
                  <span className="text-[10px] text-gray-400">Tariff view</span>
                </Link>
                <Link
                  href="/battery"
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Battery
                  <span className="text-[10px] text-gray-400">Home storage</span>
                </Link>
                <Link
                  href="/v2/insights"
                  className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
                >
                  Management
                  <span className="text-[10px] text-gray-400">Exec KPIs</span>
                </Link>
              </div>
            </details>
            <Link
              href="/v2/insights"
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
              Insights
            </Link>
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
            {exportData && (
              <button
                onClick={() => setExportDialogOpen(true)}
                className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" /></svg>
                Export
              </button>
            )}
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
          country={country}
          setCountry={setCountry}
          gbAuction={gbAuction}
          setGbAuction={setGbAuction}
          onExportReady={useCallback((data: { overnightWindows: EnrichedWindow[]; showFleet: boolean; fleetConfig: FleetConfig; resolution: 'hour' | 'quarterhour' } | null) => setExportData(data), [])}
        />
      </main>

      {/* Export dialog */}
      {exportData && (
        <ExportDialog
          open={exportDialogOpen}
          onOpenChange={setExportDialogOpen}
          scenario={scenario}
          overnightWindows={exportData.overnightWindows}
          hourlyPrices={prices.hourly}
          hourlyQH={prices.hourlyQH}
          country={country}
          currentResolution={exportData.resolution}
          showFleet={exportData.showFleet}
          fleetConfig={exportData.fleetConfig}
        />
      )}

      {/* Tutorial overlay */}
      <TutorialOverlay active={showTutorial} onClose={() => setShowTutorial(false)} />
    </div>
  )
}
