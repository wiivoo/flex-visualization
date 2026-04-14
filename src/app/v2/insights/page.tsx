'use client'

import { useState, useMemo, useDeferredValue, Suspense } from 'react'
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
import { InsightsControls } from '@/components/v2/insights/InsightsControls'

export default function InsightsPage() {
  return (
    <Suspense>
      <InsightsInner />
    </Suspense>
  )
}

function defaultPinned(): PinnedDefaults {
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
}

function InsightsInner() {
  const prices = usePrices('DE')
  const [pinned, setPinned] = useState<PinnedDefaults>(defaultPinned)

  // Defer the pinned values for the heavy sweep computation so slider drags stay snappy.
  const deferredPinned = useDeferredValue(pinned)

  const grid = useMemo(() => {
    if (prices.hourly.length === 0) return null
    return sweepMileageByWindowLength(
      prices.hourly,
      deferredPinned.plugInTime,
      deferredPinned.chargePowerKw,
      deferredPinned.plugInsPerWeek,
    )
  }, [prices.hourly, deferredPinned.plugInTime, deferredPinned.chargePowerKw, deferredPinned.plugInsPerWeek])

  const series = useMemo(() => {
    if (prices.hourly.length === 0) return null
    return sweepSensitivity(prices.hourly, deferredPinned)
  }, [prices.hourly, deferredPinned])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header — matches /v2 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-gray-400">EV Flex Charging — Insights</h1>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/v2"
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6 space-y-5">
        {/* Title */}
        <div>
          <h2 className="text-xl font-bold text-[#313131]">Ideal Parameters</h2>
          <p className="text-[12px] text-gray-500 mt-1">
            Find the customers worth targeting and the behaviors worth incentivizing. Adjust the
            controls and watch both views update in real time.
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

        {!prices.loading && !prices.error && (
          <>
            {/* Controls */}
            <InsightsControls pinned={pinned} setPinned={setPinned} onReset={() => setPinned(defaultPinned())} />

            {/* Both views, stacked full-width like the main page rhythm */}
            {grid && <IdealParametersHeatmap grid={grid} />}
            {series && <SensitivityCurves series={series} />}
          </>
        )}
      </main>
    </div>
  )
}
