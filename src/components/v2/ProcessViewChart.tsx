'use client'

import { useMemo, useCallback } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea,
} from 'recharts'
import type { HourlyPrice, ChargingScenario } from '@/lib/v2-config'
import {
  PROCESS_STAGES, UNCERTAINTY_SCENARIOS, UNCERTAINTY_CONFIG,
  perturbPrices,
  type ProcessStage, type UncertaintyScenario, type ProcessViewResult,
} from '@/lib/process-view'

/* ── Props ── */

interface Props {
  prices: HourlyPrice[]
  intradayPrices: HourlyPrice[] | null
  scenario: ChargingScenario
  showFleet: boolean
  fleetConfig?: unknown
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
}

/* ── Chart data builder ── */

interface ChartDatum {
  idx: number
  label: string
  daPrice: number
  forecastPrice: number | null
  confidenceBand: [number, number] | null  // [lower, upper] for Recharts range Area
  isCharging: boolean  // selected for charging at current stage
}

function buildChartData(
  prices: HourlyPrice[],
  result: ProcessViewResult,
  activeStage: ProcessStage,
  uncertaintyScenario: UncertaintyScenario,
  dateSeed: string,
): ChartDatum[] {
  const stageResult = result.stages[activeStage]
  const cheapestSet = stageResult ? new Set(stageResult.cheapestHours) : new Set<number>()

  // Generate forecast prices + confidence band
  const forecastPrices = result.stages.forecast?.pricesUsed ?? null
  const noiseConfig = uncertaintyScenario === 'perfect'
    ? { daPriceNoiseEurMwh: 0 }
    : UNCERTAINTY_CONFIG[uncertaintyScenario]

  // Band: use 1.5x noise as confidence interval width
  const bandWidth = noiseConfig.daPriceNoiseEurMwh * 1.5 / 10  // convert to ct/kWh

  return prices.map((p, i) => {
    const hourLabel = `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`

    const datum: ChartDatum = {
      idx: i,
      label: hourLabel,
      daPrice: p.priceCtKwh,
      forecastPrice: null,
      confidenceBand: null,
      isCharging: cheapestSet.has(i),
    }

    // Forecast stage: show forecast curve + confidence band
    if (activeStage === 'forecast' && forecastPrices) {
      const fp = forecastPrices[i]
      if (fp) {
        datum.forecastPrice = fp.priceCtKwh
        datum.confidenceBand = [Math.max(0, fp.priceCtKwh - bandWidth), fp.priceCtKwh + bandWidth]
      }
    }

    // DA stage: show forecast as reference, DA is the main curve
    if (activeStage === 'da_nomination' && forecastPrices) {
      const fp = forecastPrices[i]
      if (fp) {
        datum.forecastPrice = fp.priceCtKwh
      }
    }

    return datum
  })
}

/* ── Component ── */

export const ProcessViewChart = ({
  prices,
  isQH,
  hasIntraday,
  dateSeed,
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

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowRight') {
      e.preventDefault()
      const next = stageIndex + 1
      if (next === 2 && !hasIntraday) return
      if (next < PROCESS_STAGES.length) onStageChange(PROCESS_STAGES[next].key)
    }
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      if (stageIndex > 0) onStageChange(PROCESS_STAGES[stageIndex - 1].key)
    }
  }, [stageIndex, hasIntraday, onStageChange])

  const chartData = useMemo(
    () => buildChartData(prices, processResult, currentStage, uncertaintyScenario, dateSeed),
    [prices, processResult, currentStage, uncertaintyScenario, dateSeed],
  )

  // Price range for Y axis
  const priceRange = useMemo(() => {
    let min = Infinity, max = -Infinity
    for (const d of chartData) {
      if (d.daPrice < min) min = d.daPrice
      if (d.daPrice > max) max = d.daPrice
      if (d.forecastPrice !== null) {
        if (d.forecastPrice < min) min = d.forecastPrice
        if (d.forecastPrice > max) max = d.forecastPrice
      }
      if (d.confidenceBand !== null) {
        if (d.confidenceBand[1] > max) max = d.confidenceBand[1]
        if (d.confidenceBand[0] < min) min = d.confidenceBand[0]
      }
    }
    const pad = (max - min) * 0.1
    return { min: Math.floor(min - pad), max: Math.ceil(max + pad) }
  }, [chartData])

  // Charging window indices for grey overlay
  const windowInfo = useMemo(() => {
    const stageResult = processResult.stages[currentStage]
    if (!stageResult) return null
    const startH = parseInt(stageResult.windowStart.split(':')[0], 10)
    const endH = parseInt(stageResult.windowEnd.split(':')[0], 10)
    const startIdx = prices.findIndex(p => p.hour === startH)
    const endIdx = prices.findIndex(p => p.hour === endH)
    return { startIdx: startIdx >= 0 ? startIdx : 0, endIdx: endIdx >= 0 ? endIdx : prices.length - 1 }
  }, [processResult, currentStage, prices])

  // Stage badge
  const stageBadge = useMemo(() => {
    switch (currentStage) {
      case 'forecast': return { text: 'D-2 to D-1 12:00 — Forecast', className: 'text-amber-600' }
      case 'da_nomination': return { text: 'D-1 12:00 — DA Prices Revealed', className: 'text-emerald-600' }
      case 'intraday_adjustment': return { text: 'Day D — Intraday', className: 'text-sky-600' }
    }
  }, [currentStage])

  // X axis tick interval
  const tickInterval = isQH ? 7 : 1

  if (prices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-[11px]">
        No price data for selected date.
      </div>
    )
  }

  // Summary values for current stage
  const stageResult = processResult.stages[currentStage]
  const forecastSavings = processResult.stages.forecast
    ? processResult.perfectSavingsCtKwh - processResult.daForecastDragCtKwh - processResult.availabilityDragCtKwh
    : 0

  return (
    <div className="space-y-2">
      {/* Stage scrubber + scenario selector in one row */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg" tabIndex={0} onKeyDown={handleKeyDown}>
        {/* Stage dots */}
        <div className="flex items-center gap-0 flex-1">
          {PROCESS_STAGES.filter((_, i) => i < 2).map((stage, idx) => {
            return (
              <div key={stage.key} className="flex items-center flex-1">
                <button
                  onClick={() => goToStage(idx)}
                  className={`flex flex-col items-center gap-0.5 px-2 py-0.5 rounded transition-all ${
                    idx === stageIndex
                      ? 'bg-sky-100 text-sky-700'
                      : idx < stageIndex
                      ? 'text-sky-500'
                      : 'text-gray-400 hover:text-gray-600'
                  }`}
                  title={stage.description}
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
                {idx < 1 && (
                  <div className={`h-0.5 flex-1 rounded ${
                    idx < stageIndex ? 'bg-sky-300' : 'bg-gray-200'
                  }`} />
                )}
              </div>
            )
          })}
        </div>

        {/* Divider */}
        <div className="w-px h-6 bg-gray-200" />

        {/* Scenario selector */}
        <div className="bg-gray-100 rounded-full p-0.5 flex">
          {UNCERTAINTY_SCENARIOS.map(s => (
            <button
              key={s.key}
              onClick={() => onUncertaintyChange(s.key)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                uncertaintyScenario === s.key
                  ? 'bg-white text-[#313131] shadow-sm'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        {/* Stage badge */}
        <span className={`text-[10px] font-bold ${stageBadge.className} flex-shrink-0`}>{stageBadge.text}</span>
      </div>

      {/* Recharts chart — same style as main price chart */}
      <div style={{ height: 350 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <defs>
              <linearGradient id="pvForecastBand" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.15} />
                <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="pvDaGrad" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#94A3B8" stopOpacity={0.08} />
                <stop offset="100%" stopColor="#94A3B8" stopOpacity={0} />
              </linearGradient>
            </defs>

            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#E5E7EB' }}
              interval={tickInterval}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              domain={[priceRange.min, priceRange.max]}
              label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }}
            />

            <Tooltip
              contentStyle={{ fontSize: 11 }}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((value: any, name: any) => {
                const v = typeof value === 'number' ? value : 0
                const n = String(name ?? '')
                if (n === 'daPrice') return [`${v.toFixed(2)} ct/kWh`, 'DA Price']
                if (n === 'forecastPrice') return [`${v.toFixed(2)} ct/kWh`, 'Forecast']
                return [null, null]
              }) as never}
            />

            {/* Grey outside-window overlay: before arrival */}
            {windowInfo && windowInfo.startIdx > 0 && (
              <ReferenceArea
                x1={0} x2={windowInfo.startIdx}
                yAxisId="left" fill="#94A3B8" fillOpacity={0.08} stroke="none"
              />
            )}
            {/* Grey outside-window overlay: after departure */}
            {windowInfo && windowInfo.endIdx < chartData.length - 1 && (
              <ReferenceArea
                x1={windowInfo.endIdx} x2={chartData.length - 1}
                yAxisId="left" fill="#94A3B8" fillOpacity={0.08} stroke="none"
              />
            )}

            {/* Charging slot highlights — green bands for selected cheapest hours */}
            {stageResult && stageResult.cheapestHours.map(idx => (
              <ReferenceArea
                key={`charge-${idx}`}
                x1={idx} x2={Math.min(idx + (isQH ? 1 : 1), chartData.length - 1)}
                yAxisId="left" fill="#10B981" fillOpacity={0.12} stroke="none"
              />
            ))}

            {/* Forecast stage: confidence band as range area [lower, upper] */}
            {currentStage === 'forecast' && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="confidenceBand"
                stroke="#D97706"
                strokeWidth={0.5}
                strokeOpacity={0.3}
                fill="url(#pvForecastBand)"
                fillOpacity={1}
                isAnimationActive={false}
                connectNulls={false}
              />
            )}

            {/* DA price curve — solid grey (dimmed at forecast stage) */}
            <Area
              yAxisId="left" type="monotone" dataKey="daPrice"
              fill="url(#pvDaGrad)" stroke="none"
              fillOpacity={currentStage === 'forecast' ? 0.3 : 1}
              isAnimationActive={false}
            />
            <Line
              yAxisId="left" type="monotone" dataKey="daPrice"
              stroke="#94A3B8" strokeWidth={1.5}
              strokeOpacity={currentStage === 'forecast' ? 0.3 : 1}
              dot={false} isAnimationActive={false}
            />

            {/* Forecast price curve — dashed amber */}
            {(currentStage === 'forecast' || currentStage === 'da_nomination') && (
              <Line
                yAxisId="left" type="monotone" dataKey="forecastPrice"
                stroke="#D97706" strokeWidth={1.5}
                strokeDasharray="6 3"
                dot={false} isAnimationActive={false}
                connectNulls={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Stage summary strip */}
      <div className="flex items-center gap-4 px-2 text-[10px]">
        {/* Legend */}
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1">
            <div className="w-4 border-t-[1.5px] border-gray-400" />
            <span className="text-gray-500">DA</span>
          </div>
          <div className="flex items-center gap-1">
            <div className="w-4 border-t-[1.5px] border-dashed border-amber-500" />
            <span className="text-gray-500">Forecast</span>
          </div>
          {currentStage === 'forecast' && (
            <div className="flex items-center gap-1">
              <div className="w-3 h-2.5 bg-amber-500/15 rounded-sm" />
              <span className="text-gray-500">Confidence</span>
            </div>
          )}
          <div className="flex items-center gap-1">
            <div className="w-3 h-2.5 bg-emerald-500/15 rounded-sm" />
            <span className="text-gray-500">Charging</span>
          </div>
        </div>

        <div className="flex-1" />

        {/* Savings values */}
        {currentStage === 'forecast' && (
          <div className="flex items-center gap-1.5">
            <span className="font-bold text-gray-400">Forecast savings:</span>
            <span className="text-[11px] font-bold tabular-nums text-amber-600">
              {forecastSavings.toFixed(2)} ct/kWh
            </span>
          </div>
        )}
        {currentStage === 'da_nomination' && (
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-gray-400">Perfect:</span>
              <span className="text-[11px] font-bold tabular-nums text-emerald-600">{processResult.perfectSavingsCtKwh.toFixed(2)}</span>
            </div>
            {processResult.daForecastDragCtKwh > 0.01 && (
              <div className="flex items-center gap-1.5">
                <span className="font-bold text-gray-400">DA Error:</span>
                <span className="text-[11px] font-bold tabular-nums text-red-500">-{processResult.daForecastDragCtKwh.toFixed(2)}</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <span className="font-bold text-gray-400">Realized:</span>
              <span className="text-[11px] font-bold tabular-nums text-emerald-600">{processResult.realizedSavingsCtKwh.toFixed(2)} ct/kWh</span>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
