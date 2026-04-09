'use client'

import { useMemo } from 'react'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea, ReferenceLine,
} from 'recharts'
import { UNCERTAINTY_CONFIG, type UncertaintyScenario, type ProcessViewResult } from '@/lib/process-view'

const CHART_MARGIN = { top: 42, right: 30, bottom: 25, left: 20 }

/* ── Props ── */

// Accepts the SAME chartData the main chart uses, plus process view extras
interface Props {
  /** Main chart's processed data array — guarantees identical axes */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  mainChartData: any[]
  /** X axis ticks from main chart */
  xTicks: number[]
  /** X axis tick renderer from main chart */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  renderXTick: any
  /** Y axis domain from main chart */
  priceRange: { min: number; max: number }
  /** Midnight boundary indices */
  midnightIdxSet: Set<number>
  /** Whether QH resolution */
  isQH: boolean
  /** Process view result */
  processResult: ProcessViewResult
  /** Current uncertainty scenario */
  uncertaintyScenario: UncertaintyScenario
  /** Current process stage */
  currentStage: 'forecast' | 'da_nomination' | 'intraday_adjustment'
  /** Arrival/departure indices in mainChartData */
  arrivalIdx: number
  departureIdx: number
  /** Baseline slot indices (charge-now, first N from arrival) */
  baselineRanges: { x1: number; x2: number }[]
  /** Optimized slot indices (cheapest hours) */
  optimizedRanges: { x1: number; x2: number }[]
}

export const ProcessViewChart = ({
  mainChartData,
  xTicks,
  renderXTick,
  priceRange,
  midnightIdxSet,
  isQH,
  processResult,
  uncertaintyScenario,
  currentStage,
  arrivalIdx,
  departureIdx,
  baselineRanges,
  optimizedRanges,
}: Props) => {
  const N = mainChartData.length

  // Enrich mainChartData with forecast price + confidence band
  const noiseConfig = uncertaintyScenario === 'perfect'
    ? { daPriceNoiseEurMwh: 0 }
    : UNCERTAINTY_CONFIG[uncertaintyScenario]
  const bandWidth = noiseConfig.daPriceNoiseEurMwh * 1.5 / 10

  const forecastPrices = processResult.stages.forecast?.pricesUsed ?? null

  const enrichedData = useMemo(() => {
    if (!forecastPrices) return mainChartData
    return mainChartData.map((d, i) => {
      const fp = forecastPrices[i]
      if (!fp) return d
      return {
        ...d,
        pvForecastPrice: fp.priceCtKwh,
        pvConfidenceBand: currentStage === 'forecast'
          ? [Math.max(0, fp.priceCtKwh - bandWidth), fp.priceCtKwh + bandWidth]
          : undefined,
      }
    })
  }, [mainChartData, forecastPrices, bandWidth, currentStage])

  if (N === 0) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-[11px]">
        No price data for selected date.
      </div>
    )
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={enrichedData} margin={CHART_MARGIN}>
        <defs>
          <linearGradient id="pvForecastBand" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#F59E0B" stopOpacity={0.15} />
            <stop offset="100%" stopColor="#F59E0B" stopOpacity={0.05} />
          </linearGradient>
          <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#94A3B8" stopOpacity={0.08} />
            <stop offset="100%" stopColor="#94A3B8" stopOpacity={0} />
          </linearGradient>
        </defs>

        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

        {/* Exact same axes as main chart */}
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
          isAnimationActive={false}
          content={({ active, payload, label }) => {
            if (!active || !payload?.length) return null
            const d = enrichedData[Number(label)]
            if (!d) return null
            return (
              <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[13px] max-w-[260px]">
                <p className="text-gray-500 text-xs mb-1">{d.label}</p>
                <p className="font-semibold tabular-nums">{d.priceVal?.toFixed(2) ?? d.price?.toFixed(2)} ct/kWh <span className="text-gray-400 font-normal">DA</span></p>
                {d.pvForecastPrice != null && (
                  <p className="text-amber-600 text-[12px] tabular-nums">{d.pvForecastPrice.toFixed(2)} ct/kWh <span className="font-normal">Forecast</span></p>
                )}
                {d.baselinePrice !== null && d.baselinePrice !== undefined && (
                  <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
                    <span className="w-2 h-2 bg-red-500 rounded-full inline-block flex-shrink-0" />
                    Charge now
                  </p>
                )}
                {d.optimizedPrice !== null && d.optimizedPrice !== undefined && (
                  <p className="text-blue-600 text-xs mt-1 flex items-center gap-1">
                    <span className="w-2 h-2 bg-blue-500 rounded-full inline-block flex-shrink-0" />
                    Smart charging
                  </p>
                )}
              </div>
            )
          }}
        />

        {/* Overnight spread corridor — same as main chart */}
        {arrivalIdx > 0 && (
          <ReferenceArea x1={0} x2={arrivalIdx} yAxisId="left" fill="#94A3B8" fillOpacity={0.13} stroke="none" ifOverflow="hidden" />
        )}
        {departureIdx >= 0 && departureIdx < N - 1 && (
          <ReferenceArea x1={departureIdx} x2={N - 1} yAxisId="left" fill="#94A3B8" fillOpacity={0.13} stroke="none" ifOverflow="hidden" />
        )}

        {/* Baseline (charge-now) slots — red bands */}
        {baselineRanges.map((r, i) => (
          <ReferenceArea key={`b-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#EF4444" fillOpacity={0.08} ifOverflow="hidden" />
        ))}

        {/* Optimized slots — blue bands */}
        {optimizedRanges.map((r, i) => (
          <ReferenceArea key={`o-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#3B82F6" fillOpacity={0.08} ifOverflow="hidden" />
        ))}

        {/* Forecast confidence band (forecast stage only) */}
        {currentStage === 'forecast' && uncertaintyScenario !== 'perfect' && (
          <Area yAxisId="left" type="monotone" dataKey="pvConfidenceBand"
            stroke="#D97706" strokeWidth={0.5} strokeOpacity={0.3}
            fill="url(#pvForecastBand)" fillOpacity={1}
            isAnimationActive={false} connectNulls={false}
          />
        )}

        {/* DA price curve — same as main chart (dimmed at forecast stage) */}
        <Area yAxisId="left" type="monotone" dataKey="price"
          fill="url(#priceGrad)" stroke="none"
          fillOpacity={currentStage === 'forecast' && uncertaintyScenario !== 'perfect' ? 0.3 : 1}
          isAnimationActive={false}
        />
        <Line yAxisId="left" type="monotone" dataKey="price"
          stroke="#94A3B8" strokeWidth={1.5}
          strokeOpacity={currentStage === 'forecast' && uncertaintyScenario !== 'perfect' ? 0.35 : 1}
          dot={isQH ? { r: 1.5, fill: '#94A3B8', stroke: 'none', fillOpacity: currentStage === 'forecast' ? 0.3 : 1 } : false}
          connectNulls isAnimationActive={false}
        />

        {/* Baseline dots — red */}
        <Line yAxisId="left" type="monotone" dataKey="baselinePrice"
          stroke="#EF4444" strokeWidth={0}
          dot={{ r: isQH ? 2.5 : 4, fill: '#EF4444', stroke: '#fff', strokeWidth: isQH ? 1 : 2 }}
          connectNulls={false} isAnimationActive={false}
        />

        {/* Optimized dots — blue */}
        <Line yAxisId="left" type="monotone" dataKey="optimizedPrice"
          stroke="#3B82F6" strokeWidth={0}
          dot={{ r: isQH ? 2.5 : 4, fill: '#3B82F6', stroke: '#fff', strokeWidth: isQH ? 1 : 2 }}
          connectNulls={false} isAnimationActive={false}
        />

        {/* Forecast price curve — dashed amber */}
        {(currentStage === 'forecast' || currentStage === 'da_nomination') && uncertaintyScenario !== 'perfect' && (
          <Line yAxisId="left" type="monotone" dataKey="pvForecastPrice"
            stroke="#D97706" strokeWidth={1.5} strokeDasharray="6 3"
            dot={false} isAnimationActive={false} connectNulls={false}
          />
        )}

        {/* Forecast start divider if exists */}
        {mainChartData.some((d: { isProjected?: boolean }) => d.isProjected) && (() => {
          const fcIdx = mainChartData.findIndex((d: { isProjected?: boolean }) => d.isProjected)
          return fcIdx >= 0 ? (
            <ReferenceArea x1={fcIdx} x2={N - 1} yAxisId="left"
              fill="#D97706" fillOpacity={0.03} stroke="none" ifOverflow="hidden" />
          ) : null
        })()}
      </ComposedChart>
    </ResponsiveContainer>
  )
}
