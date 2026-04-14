'use client'

import { useState, useMemo, Suspense } from 'react'
import Link from 'next/link'
import { usePrices } from '@/lib/use-prices'
import { DEFAULT_SCENARIO } from '@/lib/v2-config'
import {
  sweepMileageByWindowLength,
  sweepSensitivity,
  type PinnedDefaults,
} from '@/lib/insights-sweep'
import { IdealParametersHeatmap } from '@/components/v2/insights/IdealParametersHeatmap'
import { SensitivityCurves } from '@/components/v2/insights/SensitivityCurves'

type View = 'targeting' | 'sensitivity'

export default function InsightsPage() {
  return (
    <Suspense>
      <InsightsInner />
    </Suspense>
  )
}

function InsightsInner() {
  const prices = usePrices('DE')
  const [view, setView] = useState<View>('targeting')

  // "Typical customer" defaults for the sensitivity view. Sourced from the
  // existing dashboard defaults until the KBA/ADAC/MiD research lands
  // (see .planning/research/questions.md).
  const pinned: PinnedDefaults = useMemo(() => {
    const plugInsPerWeek = Math.max(1, DEFAULT_SCENARIO.weekdayPlugIns + DEFAULT_SCENARIO.weekendPlugIns)
    const windowLength =
      DEFAULT_SCENARIO.departureTime > DEFAULT_SCENARIO.plugInTime
        ? DEFAULT_SCENARIO.departureTime - DEFAULT_SCENARIO.plugInTime
        : 24 - DEFAULT_SCENARIO.plugInTime + DEFAULT_SCENARIO.departureTime
    return {
      yearlyMileageKm: DEFAULT_SCENARIO.yearlyMileageKm,
      plugInTime: DEFAULT_SCENARIO.plugInTime,
      windowLengthHours: windowLength,
      chargePowerKw: DEFAULT_SCENARIO.chargePowerKw,
      plugInsPerWeek,
    }
  }, [])

  const grid = useMemo(() => {
    if (prices.hourly.length === 0) return null
    return sweepMileageByWindowLength(
      prices.hourly,
      pinned.plugInTime,
      pinned.chargePowerKw,
      pinned.plugInsPerWeek,
    )
  }, [prices.hourly, pinned.plugInTime, pinned.chargePowerKw, pinned.plugInsPerWeek])

  const series = useMemo(() => {
    if (prices.hourly.length === 0) return null
    return sweepSensitivity(prices.hourly, pinned)
  }, [prices.hourly, pinned])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-gray-400">EV Flex Charging — Insights</h1>
            <Link
              href="/v2"
              className="text-[12px] font-semibold text-gray-500 hover:text-[#313131] transition-colors">
              ← Back to dashboard
            </Link>
          </div>

          {/* View toggle */}
          <div className="flex items-center gap-1.5 bg-gray-100 rounded-full p-0.5">
            <button
              onClick={() => setView('targeting')}
              className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-colors ${
                view === 'targeting' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>
              Targeting (BD)
            </button>
            <button
              onClick={() => setView('sensitivity')}
              className={`text-[11px] font-semibold px-3 py-1 rounded-full transition-colors ${
                view === 'sensitivity' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}>
              Sensitivity (Product)
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6">
        <div className="mb-5">
          <h2 className="text-xl font-bold text-[#313131]">
            {view === 'targeting' ? 'Which customers should we target?' : 'Which behavior should we incentivize?'}
          </h2>
          <p className="text-[12px] text-gray-500 mt-1">
            {view === 'targeting'
              ? 'Yearly savings across mileage and plug-in window length, computed from the last 12 months of day-ahead prices. Hotter cells = larger flex value.'
              : 'Each chart varies one customer parameter while the others stay pinned. The slope tells you which lever moves savings most.'}
          </p>
        </div>

        {prices.loading && (
          <div className="text-[12px] text-gray-500 py-12 text-center">Loading price data…</div>
        )}

        {prices.error && (
          <div className="text-[12px] text-red-600 py-12 text-center">
            Failed to load prices: {prices.error}
          </div>
        )}

        {!prices.loading && !prices.error && view === 'targeting' && grid && (
          <IdealParametersHeatmap grid={grid} />
        )}

        {!prices.loading && !prices.error && view === 'sensitivity' && series && (
          <SensitivityCurves series={series} />
        )}
      </main>
    </div>
  )
}
