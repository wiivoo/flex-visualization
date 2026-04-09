'use client'

import { useMemo, useCallback, useState, useRef, useEffect } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts'
import type { HourlyPrice, ChargingScenario } from '@/lib/v2-config'
import {
  PROCESS_STAGES, UNCERTAINTY_SCENARIOS, UNCERTAINTY_CONFIG,
  type ProcessStage, type UncertaintyScenario, type ProcessViewResult,
} from '@/lib/process-view'

const CHART_MARGIN = { top: 42, right: 30, bottom: 25, left: 20 }

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
  hour: number
  minute: number
  date: string
  label: string
  daPrice: number
  forecastPrice: number | null
  confidenceBand: [number, number] | null
  isCharging: boolean
}

function buildChartData(
  prices: HourlyPrice[],
  result: ProcessViewResult,
  activeStage: ProcessStage,
  uncertaintyScenario: UncertaintyScenario,
): ChartDatum[] {
  const stageResult = result.stages[activeStage]
  const cheapestSet = stageResult ? new Set(stageResult.cheapestHours) : new Set<number>()
  const forecastPrices = result.stages.forecast?.pricesUsed ?? null
  const noiseConfig = uncertaintyScenario === 'perfect'
    ? { daPriceNoiseEurMwh: 0 }
    : UNCERTAINTY_CONFIG[uncertaintyScenario]
  const bandWidth = noiseConfig.daPriceNoiseEurMwh * 1.5 / 10

  return prices.map((p, i) => {
    const hourLabel = `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`

    const datum: ChartDatum = {
      idx: i,
      hour: p.hour,
      minute: p.minute ?? 0,
      date: p.date,
      label: hourLabel,
      daPrice: p.priceCtKwh,
      forecastPrice: null,
      confidenceBand: null,
      isCharging: cheapestSet.has(i),
    }

    if ((activeStage === 'forecast' || activeStage === 'da_nomination') && forecastPrices) {
      const fp = forecastPrices[i]
      if (fp) {
        datum.forecastPrice = fp.priceCtKwh
        if (activeStage === 'forecast') {
          datum.confidenceBand = [Math.max(0, fp.priceCtKwh - bandWidth), fp.priceCtKwh + bandWidth]
        }
      }
    }

    return datum
  })
}

/* ── Component ── */

export const ProcessViewChart = ({
  prices,
  scenario,
  isQH,
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
    () => buildChartData(prices, processResult, currentStage, uncertaintyScenario),
    [prices, processResult, currentStage, uncertaintyScenario],
  )

  const N = chartData.length

  // Arrival/departure indices — same logic as main chart
  const arrivalIdx = useMemo(() => {
    const firstDate = prices[0]?.date
    return chartData.findIndex(d => d.date === firstDate && d.hour === scenario.plugInTime)
  }, [chartData, prices, scenario.plugInTime])

  const departureIdx = useMemo(() => {
    const lastDate = prices[prices.length - 1]?.date
    // Departure is on the next day typically
    const depDate = chartData.find(d => d.date !== prices[0]?.date)?.date ?? lastDate
    return chartData.findIndex(d => d.date === depDate && d.hour === scenario.departureTime)
  }, [chartData, prices, scenario.departureTime])

  const arrivalLabel = `${String(scenario.plugInTime).padStart(2, '0')}:00`
  const departureLabel = `${String(scenario.departureTime).padStart(2, '0')}:00`

  // Midnight boundaries
  const midnightIdxSet = useMemo(() => {
    const set = new Set<number>()
    for (let i = 1; i < chartData.length; i++) {
      if (chartData[i].date !== chartData[i - 1].date) set.add(i)
    }
    return set
  }, [chartData])

  // X axis ticks — match main chart pattern
  const labelInterval = isQH ? 3 : 2
  const xTicks = useMemo(() => {
    return chartData
      .filter(d => d.minute === 0 && (midnightIdxSet.has(d.idx) || d.hour % labelInterval === 0))
      .map(d => d.idx)
  }, [chartData, midnightIdxSet, labelInterval])

  const renderXTick = useCallback((props: { x: number; y: number; payload: { value: number } }) => {
    const { x, y, payload } = props
    const pt = chartData[payload.value]
    if (!pt) return <g />
    const isDateBoundary = midnightIdxSet.has(pt.idx)
    let isNearBoundary = false
    if (!isDateBoundary && pt.hour % labelInterval === 0) {
      const step = isQH ? 4 : 1
      for (const midIdx of midnightIdxSet) {
        if (Math.abs(pt.idx - midIdx) < step * labelInterval) { isNearBoundary = true; break }
      }
    }
    const showLabel = pt.hour % labelInterval === 0 && !isDateBoundary && !isNearBoundary
    const fontSize = labelInterval >= 6 ? 10 : 12
    return (
      <g transform={`translate(${x},${y})`}>
        <line x1={0} y1={0} x2={0} y2={isDateBoundary ? 8 : 6} stroke={isDateBoundary ? '#6B7280' : '#D1D5DB'} strokeWidth={isDateBoundary ? 1.5 : 1} />
        {showLabel && (
          <text x={0} y={0} dy={18} textAnchor="middle" fill="#6B7280" fontSize={fontSize} fontWeight={500}>
            {`${String(pt.hour).padStart(2, '0')}:00`}
          </text>
        )}
        {isDateBoundary && (
          <>
            <text x={0} y={0} dy={20} textAnchor="middle" fill="#374151" fontSize={fontSize} fontWeight={700}>
              00:00
            </text>
          </>
        )}
      </g>
    )
  }, [chartData, midnightIdxSet, labelInterval, isQH])

  // Price range
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

  // Stage badge
  const stageBadge = useMemo(() => {
    switch (currentStage) {
      case 'forecast': return { text: 'D-2 to D-1 12:00 — Forecast', className: 'text-amber-600' }
      case 'da_nomination': return { text: 'D-1 12:00 — DA Prices Revealed', className: 'text-emerald-600' }
      case 'intraday_adjustment': return { text: 'Day D — Intraday', className: 'text-sky-600' }
    }
  }, [currentStage])

  // Plot area measurement for overlays
  const containerRef = useRef<HTMLDivElement>(null)
  const [plotArea, setPlotArea] = useState<{ left: number; width: number; top: number; height: number } | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const svg = containerRef.current.querySelector('.recharts-wrapper svg')
    const plotBg = containerRef.current.querySelector('.recharts-cartesian-grid')
    if (svg && plotBg) {
      const svgRect = svg.getBoundingClientRect()
      const plotRect = plotBg.getBoundingClientRect()
      setPlotArea({
        left: plotRect.left - svgRect.left,
        width: plotRect.width,
        top: plotRect.top - svgRect.top,
        height: plotRect.height,
      })
    }
  }, [chartData, N])

  // Compute pixel position for an index
  const idxToPx = (idx: number) => {
    if (!plotArea || N <= 1) return 0
    return plotArea.left + (idx / (N - 1)) * plotArea.width
  }

  const stageResult = processResult.stages[currentStage]
  const forecastSavings = processResult.perfectSavingsCtKwh - processResult.daForecastDragCtKwh - processResult.availabilityDragCtKwh

  if (prices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-[11px]">
        No price data for selected date.
      </div>
    )
  }

  return (
    <div className="space-y-0">
      {/* Stage scrubber + scenario selector in one row */}
      <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg mb-1" tabIndex={0} onKeyDown={handleKeyDown}>
        <div className="flex items-center gap-0 flex-1">
          {PROCESS_STAGES.filter((_, i) => i < 2).map((stage, idx) => (
            <div key={stage.key} className="flex items-center flex-1">
              <button
                onClick={() => goToStage(idx)}
                className={`flex flex-col items-center gap-0.5 px-2 py-0.5 rounded transition-all ${
                  idx === stageIndex ? 'bg-sky-100 text-sky-700'
                    : idx < stageIndex ? 'text-sky-500'
                    : 'text-gray-400 hover:text-gray-600'
                }`}
                title={stage.description}
              >
                <div className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                  idx === stageIndex ? 'bg-sky-500 border-sky-500 scale-125'
                    : idx < stageIndex ? 'bg-sky-300 border-sky-300'
                    : 'bg-white border-gray-300'
                }`} />
                <span className="text-[10px] font-bold tabular-nums">{stage.label}</span>
              </button>
              {idx < 1 && <div className={`h-0.5 flex-1 rounded ${idx < stageIndex ? 'bg-sky-300' : 'bg-gray-200'}`} />}
            </div>
          ))}
        </div>
        <div className="w-px h-6 bg-gray-200" />
        <div className="bg-gray-100 rounded-full p-0.5 flex">
          {UNCERTAINTY_SCENARIOS.map(s => (
            <button key={s.key} onClick={() => onUncertaintyChange(s.key)}
              className={`text-[10px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
                uncertaintyScenario === s.key ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >{s.label}</button>
          ))}
        </div>
        <span className={`text-[10px] font-bold ${stageBadge.className} flex-shrink-0`}>{stageBadge.text}</span>
      </div>

      {/* Chart — matching main chart layout */}
      <div className="relative" style={{ height: 400 }} ref={containerRef}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={CHART_MARGIN}>
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

            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

            <XAxis
              dataKey="idx" type="number"
              domain={[0, Math.max(N - 1, 1)]}
              ticks={xTicks}
              tick={renderXTick as never}
              tickLine={false}
              stroke="#9CA3AF"
              interval={0}
              height={midnightIdxSet.size > 0 ? 48 : 32}
              allowDecimals={false}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 11, fontWeight: 500 }}
              stroke="#9CA3AF"
              width={35}
              domain={[priceRange.min, priceRange.max]}
              allowDataOverflow
              allowDecimals={false}
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

            {/* Grey outside charging window */}
            {arrivalIdx > 0 && (
              <ReferenceArea x1={0} x2={arrivalIdx} yAxisId="left" fill="#94A3B8" fillOpacity={0.10} stroke="none" />
            )}
            {departureIdx >= 0 && departureIdx < N - 1 && (
              <ReferenceArea x1={departureIdx} x2={N - 1} yAxisId="left" fill="#94A3B8" fillOpacity={0.10} stroke="none" />
            )}

            {/* Charging slot highlights — green bands for nominated cheapest hours */}
            {stageResult && stageResult.cheapestHours.map(idx => (
              <ReferenceArea
                key={`charge-${idx}`}
                x1={idx} x2={Math.min(idx + 1, N - 1)}
                yAxisId="left" fill="#3B82F6" fillOpacity={0.08} stroke="none"
              />
            ))}

            {/* Forecast confidence band */}
            {currentStage === 'forecast' && (
              <Area yAxisId="left" type="monotone" dataKey="confidenceBand"
                stroke="#D97706" strokeWidth={0.5} strokeOpacity={0.3}
                fill="url(#pvForecastBand)" fillOpacity={1}
                isAnimationActive={false} connectNulls={false}
              />
            )}

            {/* DA price curve */}
            <Area yAxisId="left" type="monotone" dataKey="daPrice"
              fill="url(#pvDaGrad)" stroke="none"
              fillOpacity={currentStage === 'forecast' ? 0.3 : 1}
              isAnimationActive={false}
            />
            <Line yAxisId="left" type="monotone" dataKey="daPrice"
              stroke="#94A3B8" strokeWidth={1.5}
              strokeOpacity={currentStage === 'forecast' ? 0.3 : 1}
              dot={false} isAnimationActive={false}
            />

            {/* Forecast price curve — dashed amber */}
            {(currentStage === 'forecast' || currentStage === 'da_nomination') && (
              <Line yAxisId="left" type="monotone" dataKey="forecastPrice"
                stroke="#D97706" strokeWidth={1.5} strokeDasharray="6 3"
                dot={false} isAnimationActive={false} connectNulls={false}
              />
            )}

            {/* Arrival line */}
            {arrivalIdx >= 0 && (
              <ReferenceLine x={arrivalIdx} yAxisId="left"
                stroke="#EA1C0A" strokeWidth={1.5} strokeOpacity={0.6}
              />
            )}
            {/* Departure line */}
            {departureIdx >= 0 && (
              <ReferenceLine x={departureIdx} yAxisId="left"
                stroke="#2563EB" strokeWidth={1.5} strokeOpacity={0.6}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>

        {/* Arrival label — positioned as HTML overlay */}
        {arrivalIdx >= 0 && plotArea && (
          <div className="absolute pointer-events-none z-10"
            style={{ left: idxToPx(arrivalIdx), top: 4, transform: 'translateX(-50%)' }}>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border text-[#EA1C0A] bg-white/95 border-red-200">
              Plug-in {arrivalLabel}
            </span>
          </div>
        )}

        {/* Departure label */}
        {departureIdx >= 0 && plotArea && (
          <div className="absolute pointer-events-none z-10"
            style={{ left: idxToPx(departureIdx), top: 4, transform: 'translateX(-50%)' }}>
            <span className="text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border text-blue-600 bg-white/95 border-blue-200">
              Departure {departureLabel}
            </span>
          </div>
        )}

        {/* Savings pill — top center */}
        {plotArea && (
          <div className="absolute pointer-events-none z-10" style={{ left: '50%', top: 4, transform: 'translateX(-50%)' }}>
            {currentStage === 'forecast' && forecastSavings > 0 && (
              <div className="backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm bg-amber-50/80 border-amber-300/50">
                <span className="text-[11px] font-bold tabular-nums text-amber-700">
                  Forecast: ▼ {forecastSavings.toFixed(1)} ct/kWh
                </span>
              </div>
            )}
            {currentStage === 'da_nomination' && processResult.perfectSavingsCtKwh > 0 && (
              <div className="flex items-center gap-1.5">
                <div className="backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm bg-emerald-50/80 border-emerald-300/50">
                  <span className="text-[11px] font-bold tabular-nums text-emerald-700">
                    ▼ {processResult.realizedSavingsCtKwh.toFixed(1)} ct/kWh realized
                  </span>
                </div>
                {processResult.daForecastDragCtKwh > 0.01 && (
                  <div className="backdrop-blur-sm border rounded-full px-2 py-0.5 shadow-sm bg-red-50/80 border-red-300/50">
                    <span className="text-[10px] font-bold tabular-nums text-red-600">
                      DA Error: -{processResult.daForecastDragCtKwh.toFixed(2)} ct
                    </span>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Legend strip */}
      <div className="flex items-center gap-4 px-2 text-[10px] text-gray-500">
        <div className="flex items-center gap-1"><div className="w-4 border-t-[1.5px] border-gray-400" /><span>DA</span></div>
        <div className="flex items-center gap-1"><div className="w-4 border-t-[1.5px] border-dashed border-amber-500" /><span>Forecast</span></div>
        {currentStage === 'forecast' && (
          <div className="flex items-center gap-1"><div className="w-3 h-2.5 bg-amber-500/15 rounded-sm" /><span>Confidence</span></div>
        )}
        <div className="flex items-center gap-1"><div className="w-3 h-2.5 bg-blue-500/10 rounded-sm" /><span>Nominated slots</span></div>
      </div>
    </div>
  )
}
