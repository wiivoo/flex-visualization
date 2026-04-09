'use client'

import { useMemo, useCallback } from 'react'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea,
} from 'recharts'
import type { HourlyPrice, ChargingScenario, FleetConfig } from '@/lib/v2-config'
import {
  PROCESS_STAGES, UNCERTAINTY_SCENARIOS,
  type ProcessStage, type UncertaintyScenario, type ProcessViewResult,
} from '@/lib/process-view'
import { computeFlexBand } from '@/lib/fleet-optimizer'

/* ── Props ── */

interface Props {
  prices: HourlyPrice[]
  intradayPrices: HourlyPrice[] | null
  scenario: ChargingScenario
  showFleet: boolean
  fleetConfig: FleetConfig
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
  chargingKw: number | null
  forecastPrice?: number
  intradayPrice?: number
}

function buildChartData(
  prices: HourlyPrice[],
  result: ProcessViewResult,
  activeStage: ProcessStage,
): ChartDatum[] {
  const stageResult = result.stages[activeStage]
  const forecastResult = result.stages.forecast

  return prices.map((p, i) => {
    const hourLabel = `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`

    // Mark hours where charging is happening at the active stage
    let chargingKw: number | null = null
    if (stageResult) {
      const schedule = stageResult.optimizeResult.charging_schedule
      for (const block of schedule) {
        const startH = parseInt(block.start.split(':')[0], 10)
        const endH = parseInt(block.end.split(':')[0], 10)
        if (p.hour >= startH && p.hour < endH) {
          chargingKw = stageResult.optimizeResult.energy_charged_kwh > 0 ? 1 : null
        }
      }
    }

    const datum: ChartDatum = {
      idx: i,
      label: hourLabel,
      daPrice: p.priceCtKwh,
      chargingKw,
    }

    // At forecast stage, show perturbed prices as a line
    if (activeStage === 'forecast' && forecastResult) {
      const fp = forecastResult.pricesUsed[i]
      if (fp) datum.forecastPrice = fp.priceCtKwh
    }

    // At intraday stage, show intraday prices
    if (activeStage === 'intraday_adjustment' && result.stages.intraday_adjustment) {
      const ip = result.stages.intraday_adjustment.pricesUsed[i]
      if (ip) datum.intradayPrice = ip.priceCtKwh
    }

    return datum
  })
}

/* ── Component ── */

export const ProcessViewChart = ({
  prices,
  scenario,
  showFleet,
  fleetConfig,
  isQH,
  chartHeight,
  hasIntraday,
  processResult,
  uncertaintyScenario,
  onUncertaintyChange,
  currentStage,
  onStageChange,
}: Props) => {
  const stageIndex = PROCESS_STAGES.findIndex(s => s.key === currentStage)
  const activeStage = currentStage

  // Prevent navigating to intraday when unavailable
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

  // Chart data from externally-provided processResult
  const chartData = useMemo(() => buildChartData(prices, processResult, activeStage), [prices, processResult, activeStage])

  // Fleet flex band (for overlay)
  const flexBand = useMemo(() => {
    if (!showFleet) return null
    return computeFlexBand(fleetConfig, prices, isQH, scenario.chargingMode)
  }, [showFleet, fleetConfig, prices, isQH, scenario.chargingMode])

  // Determine charging window indices for ReferenceArea overlays
  const windowIndices = useMemo(() => {
    const stageResult = processResult.stages[activeStage]
    if (!stageResult) return { start: -1, end: -1 }
    const startHour = parseInt(stageResult.windowStart.split(':')[0], 10)
    const endHour = parseInt(stageResult.windowEnd.split(':')[0], 10)
    let startIdx = prices.findIndex(p => p.hour === startHour)
    let endIdx = prices.findIndex(p => p.hour === endHour)
    if (startIdx < 0) startIdx = 0
    if (endIdx < 0) endIdx = prices.length - 1
    return { start: startIdx, end: endIdx }
  }, [processResult, activeStage, prices])

  // Stage badge configuration
  const stageBadge = useMemo(() => {
    switch (activeStage) {
      case 'forecast': return { text: 'D-2 to D-1 12:00', className: 'text-[10px] text-amber-600' }
      case 'da_nomination': return { text: 'D-1 12:00', className: 'text-[10px] text-emerald-600' }
      case 'intraday_adjustment': return { text: 'Day D', className: 'text-[10px] text-sky-600' }
    }
  }, [activeStage])

  // DA bar opacity depends on stage
  const daBarOpacity = activeStage === 'forecast' ? 0.4 : 1.0

  if (prices.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-[11px]">
        No price data for selected date. Select a different date to run the process view.
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

        {/* Stage badge */}
        <span className={stageBadge.className + ' font-bold'}>{stageBadge.text}</span>
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

      {/* Chart */}
      <div className="relative" style={{ height: chartHeight > 0 ? chartHeight : 350 }}>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#E5E7EB" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={{ stroke: '#E5E7EB' }}
              interval={isQH ? 7 : 1}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }}
            />
            <Tooltip
              contentStyle={{ fontSize: 11 }}
              labelFormatter={(label) => `${label}`}
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              formatter={((value: any, name: any) => {
                const v = typeof value === 'number' ? value : 0
                const n = String(name ?? '')
                if (n === 'daPrice') return [`${v.toFixed(2)} ct/kWh`, 'DA Price']
                if (n === 'forecastPrice') return [`${v.toFixed(2)} ct/kWh`, 'Forecast']
                if (n === 'intradayPrice') return [`${v.toFixed(2)} ct/kWh`, 'Intraday']
                return [`${v}`, n]
              }) as never}
            />

            {/* Forecast stage: yellow uncertainty corridor */}
            {activeStage === 'forecast' && windowIndices.start >= 0 && (
              <ReferenceArea
                x1={windowIndices.start}
                x2={windowIndices.end > windowIndices.start ? windowIndices.end : chartData.length - 1}
                yAxisId="left"
                fill="#FEF9C3"
                fillOpacity={0.35}
                stroke="none"
              />
            )}

            {/* DA Nomination stage: emerald optimized blocks */}
            {activeStage === 'da_nomination' && processResult.stages.da_nomination && (
              processResult.stages.da_nomination.optimizeResult.charging_schedule.map((block, bi) => {
                const startH = parseInt(block.start.split(':')[0], 10)
                const endH = parseInt(block.end.split(':')[0], 10)
                const startIdx = chartData.findIndex(d => parseInt(d.label.split(':')[0], 10) === startH)
                const endIdx = chartData.findIndex(d => parseInt(d.label.split(':')[0], 10) === endH)
                if (startIdx < 0) return null
                return (
                  <ReferenceArea
                    key={`da-block-${bi}`}
                    x1={startIdx}
                    x2={endIdx > startIdx ? endIdx : startIdx + 1}
                    yAxisId="left"
                    fill="#D1FAE5"
                    fillOpacity={0.5}
                    stroke="none"
                  />
                )
              })
            )}

            {/* Intraday stage: red correction zones */}
            {activeStage === 'intraday_adjustment' && processResult.stages.intraday_adjustment && processResult.stages.forecast && (() => {
              const forecastStart = parseInt(processResult.stages.forecast.windowStart.split(':')[0], 10)
              const realStart = parseInt(processResult.stages.intraday_adjustment.windowStart.split(':')[0], 10)
              if (forecastStart !== realStart) {
                const minH = Math.min(forecastStart, realStart)
                const maxH = Math.max(forecastStart, realStart)
                const startIdx = chartData.findIndex(d => parseInt(d.label.split(':')[0], 10) === minH)
                const endIdx = chartData.findIndex(d => parseInt(d.label.split(':')[0], 10) === maxH)
                if (startIdx >= 0 && endIdx >= 0) {
                  return (
                    <ReferenceArea
                      x1={startIdx}
                      x2={endIdx}
                      yAxisId="left"
                      fill="#FEE2E2"
                      fillOpacity={0.4}
                      stroke="none"
                    />
                  )
                }
              }
              return null
            })()}

            {/* Intraday stage: emerald re-optimized blocks */}
            {activeStage === 'intraday_adjustment' && processResult.stages.intraday_adjustment && (
              processResult.stages.intraday_adjustment.optimizeResult.charging_schedule.map((block, bi) => {
                const startH = parseInt(block.start.split(':')[0], 10)
                const endH = parseInt(block.end.split(':')[0], 10)
                const startIdx = chartData.findIndex(d => parseInt(d.label.split(':')[0], 10) === startH)
                const endIdx = chartData.findIndex(d => parseInt(d.label.split(':')[0], 10) === endH)
                if (startIdx < 0) return null
                return (
                  <ReferenceArea
                    key={`id-block-${bi}`}
                    x1={startIdx}
                    x2={endIdx > startIdx ? endIdx : startIdx + 1}
                    yAxisId="left"
                    fill="#D1FAE5"
                    fillOpacity={0.5}
                    stroke="none"
                  />
                )
              })
            )}

            {/* Fleet flex band overlay */}
            {showFleet && flexBand && flexBand.length > 0 && (() => {
              // Simplified: show band as a single reference area per contiguous segment
              const firstBand = flexBand[0]
              const lastBand = flexBand[flexBand.length - 1]
              const startIdx = chartData.findIndex(d => {
                const h = parseInt(d.label.split(':')[0], 10)
                return h === firstBand.hour
              })
              const endIdx = chartData.findIndex(d => {
                const h = parseInt(d.label.split(':')[0], 10)
                return h === lastBand.hour
              })
              if (startIdx >= 0 && endIdx >= 0) {
                return (
                  <ReferenceArea
                    x1={startIdx}
                    x2={endIdx}
                    yAxisId="left"
                    fill="#DBEAFE"
                    fillOpacity={0.3}
                    stroke="none"
                  />
                )
              }
              return null
            })()}

            {/* DA price bars */}
            <Bar
              yAxisId="left"
              dataKey="daPrice"
              fill="#94A3B8"
              fillOpacity={daBarOpacity}
              radius={[2, 2, 0, 0]}
              isAnimationActive={false}
            />

            {/* Forecast price line (at forecast stage) */}
            {activeStage === 'forecast' && (
              <Line
                yAxisId="left"
                dataKey="forecastPrice"
                stroke="#D97706"
                strokeWidth={1.5}
                strokeDasharray="4 2"
                dot={false}
                isAnimationActive={false}
              />
            )}

            {/* Intraday price line (at intraday stage) */}
            {activeStage === 'intraday_adjustment' && hasIntraday && (
              <Line
                yAxisId="left"
                dataKey="intradayPrice"
                stroke="#0EA5E9"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
              />
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Waterfall summary */}
      <div className="flex items-center gap-3 px-2">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-bold text-gray-400">Perfect:</span>
          <span className="text-[11px] font-bold tabular-nums text-emerald-600">{processResult.perfectSavingsCtKwh.toFixed(2)} ct/kWh</span>
        </div>
        {processResult.daForecastDragCtKwh > 0 && (
          <div className="flex items-center gap-1.5">
            <span className="text-[10px] font-bold text-gray-400">DA Error:</span>
            <span className="text-[11px] font-bold tabular-nums text-red-500">-{processResult.daForecastDragCtKwh.toFixed(2)}</span>
          </div>
        )}
        {processResult.availabilityDragCtKwh > 0 && (
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
