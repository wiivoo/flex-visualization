'use client'

import { useMemo, useCallback } from 'react'
import type { HourlyPrice, ChargingScenario } from '@/lib/v2-config'
import {
  PROCESS_STAGES, UNCERTAINTY_SCENARIOS,
  type ProcessStage, type UncertaintyScenario, type ProcessViewResult,
} from '@/lib/process-view'

/* ── Props ── */

interface Props {
  prices: HourlyPrice[]
  intradayPrices: HourlyPrice[] | null
  scenario: ChargingScenario
  showFleet: boolean
  isQH: boolean
  chartWidth: number
  chartHeight: number
  hasIntraday: boolean
  dateSeed: string
  processResult: ProcessViewResult
  uncertaintyScenario: UncertaintyScenario
  onUncertaintyChange: (s: UncertaintyScenario) => void
  currentStage: ProcessStage
  onStageChange: (s: ProcessStage) => void
  // fleetConfig kept in parent interface but not used here after simplification
  fleetConfig?: unknown
}

/* ── Hourly aggregation for lightweight rendering ── */

interface HourBar {
  hour: number
  label: string
  daPrice: number
  forecastPrice?: number
  intradayPrice?: number
  isCharging: boolean
  isWindow: boolean
}

function buildHourlyBars(
  prices: HourlyPrice[],
  result: ProcessViewResult,
  activeStage: ProcessStage,
): HourBar[] {
  const stageResult = result.stages[activeStage]
  const cheapestSet = stageResult ? new Set(stageResult.cheapestHours) : new Set<number>()

  // Determine charging window
  const windowStartH = stageResult ? parseInt(stageResult.windowStart.split(':')[0], 10) : -1
  const windowEndH = stageResult ? parseInt(stageResult.windowEnd.split(':')[0], 10) : -1
  const wrapsWindow = windowEndH <= windowStartH

  // Aggregate to hourly: group by hour, take average price
  const hourMap = new Map<number, { prices: number[]; forecastPrices: number[]; intradayPrices: number[]; isCharging: boolean }>()

  prices.forEach((p, i) => {
    const entry = hourMap.get(p.hour) ?? { prices: [], forecastPrices: [], intradayPrices: [], isCharging: false }
    entry.prices.push(p.priceCtKwh)
    if (cheapestSet.has(i)) entry.isCharging = true

    // Forecast stage: show perturbed prices
    if (activeStage === 'forecast' && result.stages.forecast) {
      const fp = result.stages.forecast.pricesUsed[i]
      if (fp) entry.forecastPrices.push(fp.priceCtKwh)
    }

    // Intraday stage: show intraday prices
    if (activeStage === 'intraday_adjustment' && result.stages.intraday_adjustment) {
      const ip = result.stages.intraday_adjustment.pricesUsed[i]
      if (ip) entry.intradayPrices.push(ip.priceCtKwh)
    }

    hourMap.set(p.hour, entry)
  })

  const hours = Array.from(hourMap.entries()).sort((a, b) => a[0] - b[0])

  return hours.map(([hour, data]) => {
    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
    const inWindow = wrapsWindow
      ? (hour >= windowStartH || hour < windowEndH)
      : (hour >= windowStartH && hour < windowEndH)

    const bar: HourBar = {
      hour,
      label: `${String(hour).padStart(2, '0')}`,
      daPrice: avg(data.prices),
      isCharging: data.isCharging,
      isWindow: inWindow,
    }
    if (data.forecastPrices.length > 0) bar.forecastPrice = avg(data.forecastPrices)
    if (data.intradayPrices.length > 0) bar.intradayPrice = avg(data.intradayPrices)
    return bar
  })
}

/* ── Component ── */

export const ProcessViewChart = ({
  prices,
  hasIntraday,
  processResult,
  uncertaintyScenario,
  onUncertaintyChange,
  currentStage,
  onStageChange,
}: Props) => {
  const stageIndex = PROCESS_STAGES.findIndex(s => s.key === currentStage)

  const goToStage = useCallback((idx: number) => {
    if (idx === 2 && !hasIntraday) return
    const clamped = Math.max(0, Math.min(idx, PROCESS_STAGES.length - 1))
    onStageChange(PROCESS_STAGES[clamped].key)
  }, [hasIntraday, onStageChange])

  const nextStage = useCallback(() => {
    const next = stageIndex + 1
    if (next === 2 && !hasIntraday) return
    if (next < PROCESS_STAGES.length) onStageChange(PROCESS_STAGES[next].key)
  }, [stageIndex, hasIntraday, onStageChange])

  const prevStage = useCallback(() => {
    if (stageIndex > 0) onStageChange(PROCESS_STAGES[stageIndex - 1].key)
  }, [stageIndex, onStageChange])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') { e.preventDefault(); nextStage() }
    if (e.key === 'ArrowLeft') { e.preventDefault(); prevStage() }
  }, [nextStage, prevStage])

  // Always 24 bars max — aggregate QH to hourly
  const bars = useMemo(() => buildHourlyBars(prices, processResult, currentStage), [prices, processResult, currentStage])

  const maxPrice = useMemo(() => Math.max(...bars.map(b => Math.max(b.daPrice, b.forecastPrice ?? 0, b.intradayPrice ?? 0)), 1), [bars])

  // Stage badge
  const stageBadge = useMemo(() => {
    switch (currentStage) {
      case 'forecast': return { text: 'D-2 to D-1 12:00', className: 'text-amber-600' }
      case 'da_nomination': return { text: 'D-1 12:00', className: 'text-emerald-600' }
      case 'intraday_adjustment': return { text: 'Day D', className: 'text-sky-600' }
    }
  }, [currentStage])

  const daBarOpacity = currentStage === 'forecast' ? 0.4 : 1.0

  if (prices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-[11px]">
        No price data for selected date.
      </div>
    )
  }

  return (
    <div className="space-y-2">
      {/* Stage scrubber */}
      <div
        className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"
        tabIndex={0}
        onKeyDown={handleKeyDown}
      >
        <div className="flex items-center gap-0 flex-1">
          {PROCESS_STAGES.map((stage, idx) => {
            const isDisabled = idx === 2 && !hasIntraday
            return (
              <div key={stage.key} className="flex items-center flex-1">
                <button
                  onClick={() => goToStage(idx)}
                  disabled={isDisabled}
                  className={`flex flex-col items-center gap-0.5 px-1.5 py-0.5 rounded transition-all ${
                    isDisabled
                      ? 'opacity-40 cursor-not-allowed'
                      : idx === stageIndex
                      ? 'bg-sky-100 text-sky-700'
                      : idx < stageIndex
                      ? 'text-sky-500'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                  title={isDisabled ? 'Intraday data not available for this date' : stage.description}
                >
                  <div className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                    idx === stageIndex
                      ? 'bg-sky-500 border-sky-500 scale-125'
                      : idx < stageIndex
                      ? 'bg-sky-300 border-sky-300'
                      : 'bg-white border-gray-300'
                  }`} />
                  <span className="text-[10px] font-bold tabular-nums">{stage.label}</span>
                </button>
                {idx < PROCESS_STAGES.length - 1 && (
                  <div className={`h-0.5 flex-1 rounded ${
                    idx < stageIndex ? 'bg-sky-300' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            )
          })}
        </div>
        <span className={`text-[10px] font-bold ${stageBadge.className}`}>{stageBadge.text}</span>
      </div>

      {/* Scenario selector */}
      <div className="bg-gray-100 rounded-md p-0.5 flex">
        {UNCERTAINTY_SCENARIOS.map(s => (
          <button
            key={s.key}
            onClick={() => onUncertaintyChange(s.key)}
            className={`flex-1 text-[10px] font-bold uppercase tracking-wider py-1.5 rounded transition-colors ${
              uncertaintyScenario === s.key
                ? 'bg-white text-[#313131] shadow-sm'
                : 'text-gray-400 hover:text-gray-600'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Lightweight HTML bar chart — 24 bars, no Recharts */}
      <div className="relative px-1" style={{ height: 280 }}>
        {/* Y axis labels */}
        <div className="absolute left-0 top-0 bottom-4 w-8 flex flex-col justify-between text-[9px] text-gray-400 tabular-nums">
          <span>{maxPrice.toFixed(0)}</span>
          <span>{(maxPrice / 2).toFixed(0)}</span>
          <span>0</span>
        </div>

        {/* Bars container */}
        <div className="ml-9 flex items-end gap-[2px] h-[248px]">
          {bars.map((bar) => {
            const heightPct = (bar.daPrice / maxPrice) * 100
            const forecastPct = bar.forecastPrice !== undefined ? (bar.forecastPrice / maxPrice) * 100 : undefined
            const intradayPct = bar.intradayPrice !== undefined ? (bar.intradayPrice / maxPrice) * 100 : undefined

            return (
              <div key={bar.hour} className="flex-1 flex flex-col items-center gap-0" style={{ minWidth: 0 }}>
                <div className="relative w-full flex items-end justify-center" style={{ height: 228 }}>
                  {/* Window background */}
                  {bar.isWindow && currentStage === 'forecast' && (
                    <div className="absolute inset-0 bg-amber-100/40 rounded-sm" />
                  )}

                  {/* DA price bar */}
                  <div
                    className={`w-full rounded-t-sm transition-all duration-150 ${
                      bar.isCharging ? 'bg-emerald-400' : 'bg-slate-400'
                    }`}
                    style={{
                      height: `${Math.max(1, heightPct)}%`,
                      opacity: bar.isCharging ? 1 : daBarOpacity,
                    }}
                    title={`${bar.label}:00 — ${bar.daPrice.toFixed(1)} ct/kWh${bar.isCharging ? ' (charging)' : ''}`}
                  />

                  {/* Forecast price marker */}
                  {forecastPct !== undefined && (
                    <div
                      className="absolute w-full border-t-2 border-dashed border-amber-500"
                      style={{ bottom: `${Math.max(0, forecastPct)}%` }}
                    />
                  )}

                  {/* Intraday price marker */}
                  {intradayPct !== undefined && (
                    <div
                      className="absolute w-full border-t-2 border-sky-500"
                      style={{ bottom: `${Math.max(0, intradayPct)}%` }}
                    />
                  )}
                </div>
              </div>
            )
          })}
        </div>

        {/* X axis labels */}
        <div className="ml-9 flex gap-[2px] mt-0.5">
          {bars.map((bar, i) => (
            <div key={bar.hour} className="flex-1 text-center" style={{ minWidth: 0 }}>
              <span className={`text-[8px] tabular-nums ${i % 3 === 0 ? 'text-gray-500' : 'text-transparent'}`}>
                {bar.label}
              </span>
            </div>
          ))}
        </div>

        {/* ct/kWh label */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 -rotate-90 text-[9px] text-gray-400 origin-center" style={{ left: -4 }}>
          ct/kWh
        </div>
      </div>

      {/* Legend */}
      <div className="flex items-center gap-4 px-2 text-[10px] text-gray-500">
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-emerald-400" />
          <span>Charging</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-2.5 h-2.5 rounded-sm bg-slate-400" style={{ opacity: daBarOpacity }} />
          <span>DA Price</span>
        </div>
        {currentStage === 'forecast' && (
          <div className="flex items-center gap-1">
            <div className="w-4 border-t-2 border-dashed border-amber-500" />
            <span>Forecast</span>
          </div>
        )}
        {currentStage === 'intraday_adjustment' && hasIntraday && (
          <div className="flex items-center gap-1">
            <div className="w-4 border-t-2 border-sky-500" />
            <span>Intraday</span>
          </div>
        )}
      </div>

      {/* Savings summary strip */}
      <div className="flex items-center gap-3 px-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-400">Perfect:</span>
          <span className="text-[11px] font-bold tabular-nums text-emerald-600">{processResult.perfectSavingsCtKwh.toFixed(2)} ct/kWh</span>
        </div>
        {processResult.daForecastDragCtKwh > 0.01 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400">DA Error:</span>
            <span className="text-[11px] font-bold tabular-nums text-red-500">-{processResult.daForecastDragCtKwh.toFixed(2)}</span>
          </div>
        )}
        {processResult.availabilityDragCtKwh > 0.01 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400">Avail.:</span>
            <span className="text-[11px] font-bold tabular-nums text-red-500">-{processResult.availabilityDragCtKwh.toFixed(2)}</span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-400">Realized:</span>
          <span className="text-[11px] font-bold tabular-nums text-emerald-600">{processResult.realizedSavingsCtKwh.toFixed(2)} ct/kWh</span>
        </div>
      </div>
    </div>
  )
}
