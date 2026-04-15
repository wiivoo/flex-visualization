'use client'

import { useState, useMemo, useDeferredValue, Suspense } from 'react'
import Link from 'next/link'
import { usePrices } from '@/lib/use-prices'
import { DEFAULT_SCENARIO, DEFAULT_FLEET_CONFIG } from '@/lib/v2-config'
import {
  sweepMileageByWindowLength,
  sweepSensitivity,
  sweepFleetMileageByWindowLength,
  sweepFleetSensitivity,
  type PinnedDefaults,
  type DateRange,
  type FleetSweepParams,
} from '@/lib/insights-sweep'
import { IdealParametersHeatmap } from '@/components/v2/insights/IdealParametersHeatmap'
import { SensitivityCurves } from '@/components/v2/insights/SensitivityCurves'
import { PricePatternsHeatmap } from '@/components/v2/insights/PricePatternsHeatmap'
import { InsightsControls } from '@/components/v2/insights/InsightsControls'
import { TimeFrameBar, type TimeFrame } from '@/components/v2/insights/TimeFrameBar'

export default function InsightsPage() {
  return (
    <Suspense>
      <InsightsInner />
    </Suspense>
  )
}

type Mode = 'single' | 'fleet'

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

function defaultFleet(): FleetSweepParams {
  return {
    fleetSize: DEFAULT_FLEET_CONFIG.fleetSize,
    arrivalMin: DEFAULT_FLEET_CONFIG.arrivalMin,
    arrivalMax: DEFAULT_FLEET_CONFIG.arrivalMax,
    arrivalAvg: DEFAULT_FLEET_CONFIG.arrivalAvg,
    departureMin: DEFAULT_FLEET_CONFIG.departureMin,
    departureMax: DEFAULT_FLEET_CONFIG.departureMax,
    departureAvg: DEFAULT_FLEET_CONFIG.departureAvg,
    spreadMode: DEFAULT_FLEET_CONFIG.spreadMode,
    mileageMin: 8000,
    mileageMax: 20000,
    chargePowerKw: DEFAULT_FLEET_CONFIG.chargePowerKw,
    plugInsPerWeek: DEFAULT_FLEET_CONFIG.plugInsPerWeek,
  }
}

/** Convert a TimeFrame selection into a concrete inclusive date range given available data. */
function resolveDateRange(tf: TimeFrame, dataMin: string, dataMax: string): DateRange {
  if (tf.kind === 'last365') {
    const end = dataMax
    const endDate = new Date(end + 'T12:00:00Z')
    endDate.setUTCDate(endDate.getUTCDate() - 364)
    const start = endDate.toISOString().slice(0, 10)
    return { start: start < dataMin ? dataMin : start, end, label: 'last 365 days' }
  }
  if (tf.kind === 'year') {
    const start = `${tf.year}-01-01`
    const end = `${tf.year}-12-31`
    return {
      start: start < dataMin ? dataMin : start,
      end: end > dataMax ? dataMax : end,
      label: `${tf.year}`,
    }
  }
  return {
    start: tf.start < dataMin ? dataMin : tf.start,
    end: tf.end > dataMax ? dataMax : tf.end,
    label: `${tf.start} → ${tf.end}`,
  }
}

function InsightsInner() {
  const prices = usePrices('DE')
  const [mode, setMode] = useState<Mode>('single')
  const [pinned, setPinned] = useState<PinnedDefaults>(defaultPinned)
  const [fleet, setFleet] = useState<FleetSweepParams>(defaultFleet)
  const [timeFrame, setTimeFrame] = useState<TimeFrame>({ kind: 'last365' })

  // Defer heavy sweep inputs so slider drags stay snappy.
  const deferredPinned = useDeferredValue(pinned)
  const deferredFleet = useDeferredValue(fleet)
  const deferredTimeFrame = useDeferredValue(timeFrame)

  const dataMin = prices.hourly[0]?.date ?? ''
  const dataMax = prices.hourly[prices.hourly.length - 1]?.date ?? ''

  const availableYears = useMemo(() => {
    if (!dataMin || !dataMax) return []
    const y0 = Number(dataMin.slice(0, 4))
    const y1 = Number(dataMax.slice(0, 4))
    const out: number[] = []
    for (let y = y0; y <= y1; y++) out.push(y)
    return out
  }, [dataMin, dataMax])

  const dateRange: DateRange | undefined = useMemo(() => {
    if (!dataMin || !dataMax) return undefined
    return resolveDateRange(deferredTimeFrame, dataMin, dataMax)
  }, [deferredTimeFrame, dataMin, dataMax])

  const grid = useMemo(() => {
    if (prices.hourly.length === 0) return null
    if (mode === 'fleet') {
      return sweepFleetMileageByWindowLength(prices.hourly, deferredFleet, dateRange)
    }
    return sweepMileageByWindowLength(
      prices.hourly,
      deferredPinned.plugInTime,
      deferredPinned.chargePowerKw,
      deferredPinned.plugInsPerWeek,
      dateRange,
    )
  }, [mode, prices.hourly, deferredPinned, deferredFleet, dateRange])

  const series = useMemo(() => {
    if (prices.hourly.length === 0) return null
    if (mode === 'fleet') {
      return sweepFleetSensitivity(prices.hourly, deferredFleet, dateRange)
    }
    return sweepSensitivity(prices.hourly, deferredPinned, dateRange)
  }, [mode, prices.hourly, deferredPinned, deferredFleet, dateRange])

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
        {/* Title + mode toggle */}
        <div className="flex items-start justify-between gap-6">
          <div>
            <h2 className="text-xl font-bold text-[#313131]">Ideal Parameters</h2>
            <p className="text-[12px] text-gray-500 mt-1">
              Find the customers worth targeting and the behaviors worth incentivizing. Adjust the
              controls and watch both views update in real time.
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
              {(['single', 'fleet'] as const).map(m => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                    mode === m ? 'bg-[#313131] text-white' : 'text-gray-500 hover:text-gray-700'
                  }`}>
                  {m === 'single' ? 'Single vehicle' : 'Fleet'}
                </button>
              ))}
            </div>
          </div>
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
            {/* Time frame bar */}
            <TimeFrameBar
              timeFrame={timeFrame}
              setTimeFrame={setTimeFrame}
              availableYears={availableYears}
              dataMin={dataMin}
              dataMax={dataMax}
            />

            {/* Profile controls (single or fleet) */}
            <InsightsControls
              mode={mode}
              pinned={pinned}
              setPinned={setPinned}
              fleet={fleet}
              setFleet={setFleet}
              onReset={() => {
                setPinned(defaultPinned())
                setFleet(defaultFleet())
              }}
            />

            {/* Both views, stacked full-width like the main page rhythm.
                Excel exports use single-vehicle formulas driven by `deferredPinned`
                even in fleet mode. This is a conscious simplification for the v1
                of the auditable export; the parameters sheet includes a note row. */}
            {grid && (
              <IdealParametersHeatmap
                grid={grid}
                mode={mode}
                fleetSize={fleet.fleetSize}
                hourlyQH={prices.hourlyQH}
                pinned={deferredPinned}
              />
            )}
            {series && (
              <SensitivityCurves
                series={series}
                mode={mode}
                fleetSize={fleet.fleetSize}
                hourlyQH={prices.hourlyQH}
                pinned={deferredPinned}
              />
            )}
            {prices.hourlyQH.length > 0 && <PricePatternsHeatmap hourlyQH={prices.hourlyQH} />}
          </>
        )}
      </main>
    </div>
  )
}
