'use client'

import { useState, useEffect, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePrices } from '@/lib/use-prices'
import {
  DEFAULT_BATTERY_SCENARIO,
  BATTERY_VARIANTS,
  getDefaultLoadProfileId,
  getVariant,
  type BatteryScenario,
} from '@/lib/battery-config'
import { getPreferredBatteryResolution } from '@/lib/battery-economics'
import { BatteryVariantPicker } from '@/components/battery/BatteryVariantPicker'
import { BatteryDayChart } from '@/components/battery/BatteryDayChart'
import { BatteryRoiCard } from '@/components/battery/BatteryRoiCard'
import { ManagementView } from '@/components/battery/ManagementView'
import { DateStrip } from '@/components/v2/DateStrip'
import { Card, CardContent } from '@/components/ui/card'
import {
  useBatteryWindow,
  type BatteryResolution,
  type BatteryWindowHours,
} from '@/lib/use-battery-window'

// ---------------------------------------------------------------------------
// URL parse — untrusted search params → typed scenario
// ---------------------------------------------------------------------------

const ALLOWED_VARIANT_IDS = BATTERY_VARIANTS.map((variant) => variant.id) as readonly BatteryScenario['variantId'][]
type VariantId = BatteryScenario['variantId']

function parseScenario(params: URLSearchParams): BatteryScenario {
  const getNum = (key: string, fallback: number, min = -Infinity, max = Infinity) => {
    const raw = params.get(key)
    if (raw === null || raw === '') return fallback
    const n = Number(raw)
    if (!Number.isFinite(n)) return fallback
    return Math.max(min, Math.min(max, n))
  }

  const variantRaw = params.get('variant')
  const variantId: VariantId = (ALLOWED_VARIANT_IDS as readonly string[]).includes(variantRaw ?? '')
    ? (variantRaw as VariantId)
    : DEFAULT_BATTERY_SCENARIO.variantId

  const defaults = getVariant(variantId)
  const exportKw = getNum('export', getNum('feedin', defaults.maxDischargeKw, 0.2, 2.5), 0.2, 2.5)

  return {
    ...DEFAULT_BATTERY_SCENARIO,
    variantId,
    country: 'DE',
    tariffId: params.get('tariff') === 'tibber-de' ? 'tibber-de' : 'enviam-vision',
    loadProfileId: getDefaultLoadProfileId('DE'),
    annualLoadKwh: getNum('load', DEFAULT_BATTERY_SCENARIO.annualLoadKwh, 500, 15000),
    customMode: params.get('mode') === 'custom',
    usableKwh: getNum('capacity', defaults.usableKwh, 0.5, 6),
    maxChargeKw: getNum('import', defaults.maxChargeKw, 0.2, 2.5),
    maxDischargeKw: exportKw,
    pvCapacityWp: getNum('pv', defaults.pvCapacityWp, 0, 2000),
    feedInCapKw: exportKw,
    terugleverCostEur: getNum('teruglever', DEFAULT_BATTERY_SCENARIO.terugleverCostEur, 0, 1000),
    exportCompensationPct: getNum('export_pct', DEFAULT_BATTERY_SCENARIO.exportCompensationPct, 0, 200),
    selectedDate: params.get('date') ?? '',
  }
}

// ---------------------------------------------------------------------------
// Page (Suspense wrapper — useSearchParams requires a Suspense boundary)
// ---------------------------------------------------------------------------

export default function BatteryPage() {
  return (
    <Suspense>
      <BatteryInner />
    </Suspense>
  )
}

function BatteryInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  const [scenario, setScenario] = useState<BatteryScenario>(() => parseScenario(searchParams))
  const [windowHours, setWindowHours] = useState<BatteryWindowHours>(36)
  const [resolution, setResolution] = useState<BatteryResolution>(() => getPreferredBatteryResolution(parseScenario(searchParams)))
  const [showManagementView, setShowManagementView] = useState(false)
  const prices = usePrices('DE')
  const battery = useBatteryWindow(scenario, prices, windowHours, resolution)
  const preferredResolution = useMemo(
    () => getPreferredBatteryResolution(scenario, prices),
    [scenario, prices],
  )

  useEffect(() => {
    setResolution(preferredResolution)
  }, [preferredResolution])

  // On first prices load: apply URL ?date= if valid
  const urlDate = searchParams.get('date')
  useEffect(() => {
    if (urlDate && prices.daily.length > 0) {
      const exists = prices.daily.some(d => d.date === urlDate)
      if (exists) prices.setSelectedDate(urlDate)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prices.daily.length > 0])

  // Keep scenario.selectedDate synced with prices.selectedDate
  useEffect(() => {
    setScenario(s => s.selectedDate === prices.selectedDate ? s : { ...s, selectedDate: prices.selectedDate })
  }, [prices.selectedDate])

  // URL sync on every scenario change (replace, not push) — mirrors /v2
  useEffect(() => {
    const p = new URLSearchParams()
    if (scenario.selectedDate) p.set('date', scenario.selectedDate)
    if (scenario.variantId !== DEFAULT_BATTERY_SCENARIO.variantId) p.set('variant', scenario.variantId)
    const defaultTariff = 'enviam-vision'
    if (scenario.tariffId !== defaultTariff) p.set('tariff', scenario.tariffId)
    if (scenario.customMode) p.set('mode', 'custom')
    if (scenario.annualLoadKwh !== DEFAULT_BATTERY_SCENARIO.annualLoadKwh) p.set('load', String(scenario.annualLoadKwh))
    const variantDefaults = getVariant(scenario.variantId)
    if (scenario.usableKwh !== variantDefaults.usableKwh) p.set('capacity', String(scenario.usableKwh))
    if (scenario.maxChargeKw !== variantDefaults.maxChargeKw) p.set('import', String(scenario.maxChargeKw))
    if (scenario.maxDischargeKw !== variantDefaults.maxDischargeKw) p.set('export', String(scenario.maxDischargeKw))
    if (scenario.pvCapacityWp !== variantDefaults.pvCapacityWp) p.set('pv', String(scenario.pvCapacityWp))
    const qs = p.toString()
    router.replace(qs ? `/battery?${qs}` : '/battery', { scroll: false })
  }, [scenario, router])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header — matches /v2 pill style */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-400">Home Battery Business Case</h1>
          <nav className="flex items-center gap-2">
            <Link
              href="/v2"
              className="text-[11px] font-semibold px-2.5 py-1 rounded-full text-gray-400 hover:text-gray-600 transition-colors"
            >
              EV charging
            </Link>
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#313131] text-white">
              Home battery
            </span>
          </nav>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6 space-y-4">
        <div className="grid grid-cols-1 items-start lg:grid-cols-4 gap-5">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <BatteryVariantPicker scenario={scenario} setScenario={setScenario} />
          </aside>

          <div className="lg:col-span-3 space-y-4">
            {prices.daily.length > 0 && (
              <Card className="overflow-hidden shadow-sm border-gray-200/80">
                <CardContent className="py-1.5 px-3">
                  <DateStrip
                    daily={prices.daily}
                    selectedDate={prices.selectedDate}
                    onSelect={prices.setSelectedDate}
                    requireNextDay={false}
                    latestDate={(() => {
                      const now = new Date()
                      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                    })()}
                    forecastAfter={prices.lastRealDate || undefined}
                  />
                </CardContent>
              </Card>
            )}

            <section data-slot="day-chart" className="space-y-2">
              <div className="flex items-center justify-between">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  Price curve
                </p>
                <div className="flex items-center gap-2">
                  {prices.loading && <span className="text-[10px] text-gray-400">Loading prices…</span>}
                  {prices.error && <span className="text-[10px] text-amber-600">{prices.error}</span>}
                </div>
              </div>
              <BatteryDayChart
                chartData={battery.chartData}
                summary={battery.summary}
                variant={battery.variant}
                windowHours={windowHours}
                resolution={resolution}
                setResolution={setResolution}
                hasQuarterHour={prices.hourlyQH.length > 0}
                showPv={battery.showPv}
                capPerSlotKwh={battery.capPerSlotKwh}
                loadProfile={battery.loadProfile}
                loading={prices.loading}
                profilesError={battery.profilesError}
                profilesLoading={battery.profilesLoading}
                hasPriceData={battery.hasPriceData}
                selectedDate={prices.selectedDate}
              />
            </section>

            <section
              data-slot="roi-regulation"
              className="grid grid-cols-1 gap-4"
            >
              <BatteryRoiCard scenario={scenario} prices={prices} />
            </section>

            <section data-slot="management-view" className="border-t border-gray-200 pt-6">
              <div className="flex items-center justify-between gap-3 mb-3">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
                  Investor / Management View
                </p>
                <button
                  type="button"
                  onClick={() => setShowManagementView((value) => !value)}
                  className="text-[11px] font-semibold px-2.5 py-1 rounded-full border border-gray-200 text-gray-500 hover:text-gray-700 hover:border-gray-300 transition-colors"
                >
                  {showManagementView ? 'Hide analysis' : 'Load analysis'}
                </button>
              </div>
              {showManagementView ? (
                <ManagementView scenario={scenario} />
              ) : (
                <Card className="shadow-sm border-gray-200/80">
                  <CardContent className="py-5">
                    <p className="text-[12px] text-gray-500 leading-relaxed">
                      The investor comparison runs cross-country, full-year battery simulations for multiple setups.
                      Load it on demand so the main consumer view stays responsive.
                    </p>
                  </CardContent>
                </Card>
              )}
            </section>
          </div>
        </div>
      </main>
    </div>
  )
}
