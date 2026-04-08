'use client'

import { useMemo, useState, useCallback } from 'react'
import type { IntradayFullPoint } from '@/lib/use-prices'

/**
 * Intraday Convergence Funnel
 *
 * Visualizes how intraday prices converge from wide uncertainty (Low–High)
 * to settlement (Last) through 5 stages: DA → ID3 → ID1 → ID Full → Last.
 *
 * For each QH slot, provides:
 * - Price corridor (min/max at current stage)
 * - Best-known price for optimization
 * - Volume-based confidence
 *
 * This component computes funnel data and provides a timeline scrubber UI.
 * The actual chart rendering (ReferenceAreas, re-optimized dots) is done
 * by the parent Step2 component using the data this component exposes.
 */

/** The 5 convergence stages */
export type FunnelStage = 'da' | 'id3' | 'id1' | 'id_full' | 'last'

export const FUNNEL_STAGES: { key: FunnelStage; label: string; description: string }[] = [
  { key: 'da', label: 'DA', description: 'Day-ahead auction — initial position' },
  { key: 'id_full', label: 'ID Full', description: 'Full session average — all intraday trades' },
  { key: 'id3', label: 'ID3', description: 'Last 3h average — closer to delivery' },
  { key: 'id1', label: 'ID1', description: 'Last 1h average — near delivery' },
  { key: 'last', label: 'Last', description: 'Final traded price — settlement' },
]

/** Per-QH funnel data point for a given stage */
export interface FunnelPoint {
  /** ISO timestamp of QH slot */
  timestamp: string
  date: string
  hour: number
  minute: number
  /** The best-known price at this stage (ct/kWh) */
  price: number
  /** Low end of price corridor at this stage (ct/kWh) */
  corridorLow: number
  /** High end of price corridor at this stage (ct/kWh) */
  corridorHigh: number
  /** Corridor width (high - low) — narrows as stages advance */
  corridorWidth: number
  /** Volume in MWh — maps to visual confidence/opacity */
  volume: number | null
  /** Normalized opacity (0-1) based on volume relative to day max */
  volumeOpacity: number
}

/** Computed funnel state for a given stage */
export interface FunnelState {
  stage: FunnelStage
  stageIndex: number
  points: FunnelPoint[]
  /** Average price across all QH slots at this stage */
  avgPrice: number
  /** Savings vs DA (ct/kWh) — how much cheaper is the optimizer's pick at this stage */
  savingsVsDa: number
}

interface IntradayFunnelProps {
  /** Full intraday data from use-prices hook */
  intradayFull: IntradayFullPoint[]
  /** DA prices for the same QH slots (from chartData) */
  daPrices: { timestamp: string; date: string; hour: number; minute: number; priceCtKwh: number }[]
  /** Whether the funnel is active/visible */
  active: boolean
  /** Chart resolution — when 'hour', aggregate QH intraday data to hourly averages */
  isQH: boolean
}

/**
 * Compute funnel data for all stages.
 * Returns a map of stage → FunnelPoint[].
 */
/** Aggregate QH intraday data to hourly: average 4 quarter-hour values per hour */
function aggregateToHourly(points: IntradayFullPoint[]): IntradayFullPoint[] {
  const buckets = new Map<string, IntradayFullPoint[]>()
  for (const p of points) {
    const key = `${p.date}-${p.hour}`
    const arr = buckets.get(key) || []
    arr.push(p)
    buckets.set(key, arr)
  }

  const result: IntradayFullPoint[] = []
  for (const [, group] of buckets) {
    const avg = (field: keyof IntradayFullPoint) => {
      const vals = group.map(p => p[field] as number | null).filter((v): v is number => v !== null)
      return vals.length > 0 ? Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100 : null
    }
    const sumField = (field: keyof IntradayFullPoint) => {
      const vals = group.map(p => p[field] as number | null).filter((v): v is number => v !== null)
      return vals.length > 0 ? Math.round(vals.reduce((s, v) => s + v, 0) * 100) / 100 : null
    }
    result.push({
      timestamp: group[0].timestamp,
      date: group[0].date,
      hour: group[0].hour,
      minute: 0,
      price_ct_kwh: avg('price_ct_kwh'),
      id_full_ct: avg('id_full_ct'),
      id1_ct: avg('id1_ct'),
      id3_ct: avg('id3_ct'),
      weight_avg_ct: avg('weight_avg_ct'),
      low_ct: avg('low_ct'),
      high_ct: avg('high_ct'),
      last_ct: avg('last_ct'),
      buy_vol_mwh: sumField('buy_vol_mwh'),
      sell_vol_mwh: sumField('sell_vol_mwh'),
      volume_mwh: sumField('volume_mwh'),
    })
  }
  return result.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : a.hour - b.hour)
}

function computeFunnelData(
  intradayFull: IntradayFullPoint[],
  daPrices: { timestamp: string; date: string; hour: number; minute: number; priceCtKwh: number }[],
  isQH: boolean
): Map<FunnelStage, FunnelPoint[]> {
  const result = new Map<FunnelStage, FunnelPoint[]>()
  if (intradayFull.length === 0) return result

  // When chart is hourly, aggregate QH intraday to hourly averages (matching DA+ID behavior)
  const intraday = isQH ? intradayFull : aggregateToHourly(intradayFull)

  // Build DA price lookup by date-hour-minute key
  const daMap = new Map<string, number>()
  for (const p of daPrices) {
    daMap.set(`${p.date}-${p.hour}-${p.minute}`, p.priceCtKwh)
  }

  // Find max volume for opacity normalization
  const maxVol = Math.max(...intraday.map(p => p.volume_mwh ?? 0), 1)

  for (const stage of FUNNEL_STAGES) {
    const points: FunnelPoint[] = []

    for (const p of intraday) {
      const key = `${p.date}-${p.hour}-${p.minute}`
      const daPrice = daMap.get(key)
      if (daPrice === undefined) continue // no matching DA price

      const low = p.low_ct ?? daPrice
      const high = p.high_ct ?? daPrice

      // At each stage, the "best known" price converges toward settlement.
      //
      // The corridor [low, high] represents the actual EPEX continuous trading range
      // for this QH — it's real data, not synthetic. It stays the same across intraday
      // stages because it's the observed range of all trades.
      //
      // What converges is the PRICE LINE: DA → ID3 → ID1 → ID Full → Last.
      // Each step uses a more refined volume-weighted average closer to delivery.
      //
      // At the DA stage there's no intraday data yet, so no corridor is shown.
      // At the Last stage the corridor collapses to the final trade price.
      let price: number
      let corridorLow: number
      let corridorHigh: number

      switch (stage.key) {
        case 'da':
          // DA auction only — no intraday data yet, no corridor
          price = daPrice
          corridorLow = daPrice
          corridorHigh = daPrice
          break
        case 'id_full':
          // Full session VWAP (all trades) — broadest intraday view
          // Show full [low, high] trading range as context
          price = p.id_full_ct ?? daPrice
          corridorLow = low
          corridorHigh = high
          break
        case 'id3':
          // Last 3h VWAP — corridor narrows to range between ID indices
          price = p.id3_ct ?? p.id_full_ct ?? daPrice
          corridorLow = Math.min(p.id_full_ct ?? low, p.id3_ct ?? low, price)
          corridorHigh = Math.max(p.id_full_ct ?? high, p.id3_ct ?? high, price)
          break
        case 'id1':
          // Last 1h VWAP — corridor tightens further around recent trades
          price = p.id1_ct ?? p.id3_ct ?? daPrice
          corridorLow = Math.min(p.id3_ct ?? low, p.id1_ct ?? low, price)
          corridorHigh = Math.max(p.id3_ct ?? high, p.id1_ct ?? high, price)
          break
        case 'last':
          // Final trade — corridor collapses to settlement
          price = p.last_ct ?? p.id1_ct ?? daPrice
          corridorLow = price
          corridorHigh = price
          break
      }

      points.push({
        timestamp: p.timestamp,
        date: p.date,
        hour: p.hour,
        minute: p.minute,
        price,
        corridorLow,
        corridorHigh,
        corridorWidth: corridorHigh - corridorLow,
        volume: p.volume_mwh,
        volumeOpacity: p.volume_mwh != null ? Math.max(0.2, p.volume_mwh / maxVol) : 0.5,
      })
    }

    result.set(stage.key, points)
  }

  return result
}

/**
 * Hook: useIntradayFunnel
 *
 * Computes funnel data and exposes stage navigation.
 * Used by Step2 to overlay funnel visualization on the chart.
 */
export function useIntradayFunnel({ intradayFull, daPrices, active, isQH }: IntradayFunnelProps) {
  const [stageIndex, setStageIndex] = useState(-1)  // -1 = no stage selected

  const funnelData = useMemo(() => {
    if (!active || intradayFull.length === 0) return new Map<FunnelStage, FunnelPoint[]>()
    return computeFunnelData(intradayFull, daPrices, isQH)
  }, [intradayFull, daPrices, active, isQH])

  const currentStage = stageIndex >= 0 ? FUNNEL_STAGES[stageIndex] : null
  const currentPoints = currentStage ? (funnelData.get(currentStage.key) ?? []) : []

  // DA stage points for savings comparison
  const daPoints = funnelData.get('da') ?? []
  const daAvg = daPoints.length > 0
    ? daPoints.reduce((s, p) => s + p.price, 0) / daPoints.length
    : 0

  const currentAvg = currentPoints.length > 0
    ? currentPoints.reduce((s, p) => s + p.price, 0) / currentPoints.length
    : 0

  const currentState: FunnelState = {
    stage: currentStage?.key ?? 'da',
    stageIndex,
    points: currentPoints,
    avgPrice: Math.round(currentAvg * 100) / 100,
    savingsVsDa: Math.round((daAvg - currentAvg) * 100) / 100,
  }

  const goToStage = useCallback((idx: number) => {
    // Toggle: clicking the active stage deselects it
    setStageIndex(prev => prev === idx ? -1 : Math.max(0, Math.min(idx, FUNNEL_STAGES.length - 1)))
  }, [])

  const nextStage = useCallback(() => {
    setStageIndex(prev => Math.min(prev + 1, FUNNEL_STAGES.length - 1))
  }, [])

  const prevStage = useCallback(() => {
    setStageIndex(prev => prev <= 0 ? -1 : prev - 1)
  }, [])

  return {
    funnelData,
    currentState,
    stageIndex,
    totalStages: FUNNEL_STAGES.length,
    stages: FUNNEL_STAGES,
    goToStage,
    nextStage,
    prevStage,
    hasFunnelData: funnelData.size > 0 && currentPoints.length > 0,
  }
}

/**
 * FunnelTimeline — the scrubber/slider UI component
 *
 * Renders a horizontal timeline with 5 stage markers,
 * the current stage highlighted, and play/step controls.
 */
export function FunnelTimeline({
  stageIndex,
  stages,
  currentState,
  goToStage,
  nextStage,
  prevStage,
}: {
  stageIndex: number
  stages: typeof FUNNEL_STAGES
  currentState: FunnelState
  goToStage: (idx: number) => void
  nextStage: () => void
  prevStage: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'ArrowRight') { e.preventDefault(); nextStage() }
        if (e.key === 'ArrowLeft') { e.preventDefault(); prevStage() }
      }}
    >
      {/* Stage markers */}
      <div className="flex items-center gap-0 flex-1">
        {stages.map((stage, idx) => (
          <div key={stage.key} className="flex items-center flex-1">
            <button
              onClick={() => goToStage(idx)}
              className={`flex flex-col items-center gap-0.5 px-1.5 py-0.5 rounded transition-all ${
                idx === stageIndex
                  ? 'bg-sky-100 text-sky-700'
                  : idx < stageIndex
                  ? 'text-sky-500'
                  : 'text-gray-400 hover:text-gray-600'
              }`}
              title={stage.description}
            >
              {/* Dot */}
              <div className={`w-2.5 h-2.5 rounded-full border-2 transition-all ${
                idx === stageIndex
                  ? 'bg-sky-500 border-sky-500 scale-125'
                  : idx < stageIndex
                  ? 'bg-sky-300 border-sky-300'
                  : 'bg-white border-gray-300'
              }`} />
              <span className="text-[9px] font-semibold tabular-nums">{stage.label}</span>
            </button>
            {/* Connector line */}
            {idx < stages.length - 1 && (
              <div className={`h-0.5 flex-1 rounded ${
                idx < stageIndex ? 'bg-sky-300' : 'bg-gray-200'
              }`} />
            )}
          </div>
        ))}
      </div>

      {/* Savings indicator */}
      {currentState.savingsVsDa !== 0 && stageIndex > 0 && (
        <div className="text-right">
          <div className={`text-[11px] font-bold tabular-nums ${currentState.savingsVsDa > 0 ? 'text-emerald-600' : 'text-red-500'}`}>
            {currentState.savingsVsDa > 0 ? '+' : ''}{currentState.savingsVsDa.toFixed(2)} ct
          </div>
          <div className="text-[9px] text-gray-400">vs DA</div>
        </div>
      )}
    </div>
  )
}
