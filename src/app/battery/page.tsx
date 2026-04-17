'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePrices } from '@/lib/use-prices'
import {
  DEFAULT_BATTERY_SCENARIO,
  getDefaultLoadProfileId,
  isLoadProfileValidForCountry,
  type BatteryScenario,
} from '@/lib/battery-config'
import { BatteryVariantPicker } from '@/components/battery/BatteryVariantPicker'
import { BatteryDayChart } from '@/components/battery/BatteryDayChart'
import { BatteryRoiCard } from '@/components/battery/BatteryRoiCard'
import { RegulationPanel } from '@/components/battery/RegulationPanel'
import { ManagementView } from '@/components/battery/ManagementView'
import { DateStrip } from '@/components/v2/DateStrip'

// ---------------------------------------------------------------------------
// URL parse — untrusted search params → typed scenario
// ---------------------------------------------------------------------------

const ALLOWED_VARIANT_IDS = ['schuko-2kwh', 'balcony-pv-1.6kwh', 'wall-5kwh'] as const
type VariantId = (typeof ALLOWED_VARIANT_IDS)[number]

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

  const countryRaw = params.get('country')
  const country: 'DE' | 'NL' = countryRaw === 'NL' ? 'NL' : 'DE'
  const loadProfileRaw = params.get('profile')
  const loadProfileId: BatteryScenario['loadProfileId'] = isLoadProfileValidForCountry(loadProfileRaw ?? '', country)
    ? (loadProfileRaw as BatteryScenario['loadProfileId'])
    : getDefaultLoadProfileId(country)

  const feedInCapKw = getNum('feedin', DEFAULT_BATTERY_SCENARIO.feedInCapKw, 0.8, 2.5)

  return {
    ...DEFAULT_BATTERY_SCENARIO,
    variantId,
    country,
    tariffId: params.get('tariff') ?? (country === 'NL' ? 'frank-energie' : 'awattar-de'),
    loadProfileId,
    annualLoadKwh: getNum('load', DEFAULT_BATTERY_SCENARIO.annualLoadKwh, 500, 15000),
    feedInCapKw,
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
  const prices = usePrices(scenario.country)

  // NL failure → auto-revert to DE (identical to /v2 pattern)
  useEffect(() => {
    if (prices.error && scenario.country !== 'DE') {
      console.warn(`[battery/country] ${scenario.country} failed: ${prices.error} — reverting to DE`)
      setScenario(s => ({
        ...s,
        country: 'DE',
        tariffId: 'awattar-de',
        terugleverCostEur: 0,
        exportCompensationPct: DEFAULT_BATTERY_SCENARIO.exportCompensationPct,
      }))
    }
  }, [prices.error, scenario.country])

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
    if (scenario.country !== 'DE') p.set('country', scenario.country)
    const defaultTariff = scenario.country === 'DE' ? 'awattar-de' : 'frank-energie'
    if (scenario.tariffId !== defaultTariff) p.set('tariff', scenario.tariffId)
    if (scenario.loadProfileId !== getDefaultLoadProfileId(scenario.country)) p.set('profile', scenario.loadProfileId)
    if (scenario.annualLoadKwh !== DEFAULT_BATTERY_SCENARIO.annualLoadKwh) p.set('load', String(scenario.annualLoadKwh))
    if (scenario.feedInCapKw !== 0.8) p.set('feedin', String(scenario.feedInCapKw))
    if (scenario.terugleverCostEur !== 0) p.set('teruglever', String(scenario.terugleverCostEur))
    if (scenario.exportCompensationPct !== DEFAULT_BATTERY_SCENARIO.exportCompensationPct) p.set('export_pct', String(scenario.exportCompensationPct))
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
            <span className="text-[11px] font-semibold px-2.5 py-1 rounded-full bg-[#EA1C0A] text-white">
              Home battery
            </span>
          </nav>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-8 space-y-6">
        <section>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Battery scenario
          </p>
          <BatteryVariantPicker scenario={scenario} setScenario={setScenario} />
        </section>

        {prices.daily.length > 0 && (
          <section>
            <div className="rounded-2xl border border-gray-200/80 bg-white p-3">
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
            </div>
          </section>
        )}

        <section data-slot="day-chart" className="min-h-[320px]">
          <div className="flex items-center justify-between mb-2">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Day schedule
            </p>
            {prices.loading && <span className="text-[10px] text-gray-400">Loading prices…</span>}
            {prices.error && <span className="text-[10px] text-amber-600">{prices.error}</span>}
          </div>
          <BatteryDayChart scenario={scenario} prices={prices} />
        </section>

        {/* Section 4: ROI card + Regulation panel (filled by plan 08-07) */}
        <section data-slot="roi-regulation" className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <BatteryRoiCard scenario={scenario} prices={prices} />
          <RegulationPanel scenario={scenario} setScenario={setScenario} />
        </section>

        {/* Section 5: Management view (filled by plan 08-08) */}
        <section data-slot="management-view" className="border-t border-gray-200 pt-6">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-3">
            Investor / Management View
          </p>
          <ManagementView scenario={scenario} />
        </section>
      </main>
    </div>
  )
}
