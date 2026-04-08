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
  { key: 'id3', label: 'ID3', description: '3h before delivery — first re-optimization' },
  { key: 'id1', label: 'ID1', description: '1h before delivery — second re-optimization' },
  { key: 'id_full', label: 'ID Full', description: 'Full intraday average — near-final view' },
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
}

/**
 * Compute funnel data for all stages.
 * Returns a map of stage → FunnelPoint[].
 */
function computeFunnelData(
  intradayFull: IntradayFullPoint[],
  daPrices: { timestamp: string; date: string; hour: number; minute: number; priceCtKwh: number }[]
): Map<FunnelStage, FunnelPoint[]> {
  const result = new Map<FunnelStage, FunnelPoint[]>()
  if (intradayFull.length === 0) return result

  // Build DA price lookup by date-hour-minute key
  const daMap = new Map<string, number>()
  for (const p of daPrices) {
    daMap.set(`${p.date}-${p.hour}-${p.minute}`, p.priceCtKwh)
  }

  // Find max volume for opacity normalization
  const maxVol = Math.max(...intradayFull.map(p => p.volume_mwh ?? 0), 1)

  for (const stage of FUNNEL_STAGES) {
    const points: FunnelPoint[] = []

    for (const p of intradayFull) {
      const key = `${p.date}-${p.hour}-${p.minute}`
      const daPrice = daMap.get(key)
      if (daPrice === undefined) continue // no matching DA price

      const low = p.low_ct ?? daPrice
      const high = p.high_ct ?? daPrice

      // At each stage, the "best known" price converges toward settlement
      let price: number
      let corridorLow: number
      let corridorHigh: number

      switch (stage.key) {
        case 'da':
          // Only DA known — corridor is full Low-High range
          price = daPrice
          corridorLow = low
          corridorHigh = high
          break
        case 'id3':
          // ID3 known — corridor narrows
          price = p.id3_ct ?? daPrice
          corridorLow = Math.max(low, Math.min(price - Math.abs(high - low) * 0.35, price))
          corridorHigh = Math.min(high, Math.max(price + Math.abs(high - low) * 0.35, price))
          break
        case 'id1':
          // ID1 known — corridor narrows further
          price = p.id1_ct ?? p.id3_ct ?? daPrice
          corridorLow = Math.max(low, Math.min(price - Math.abs(high - low) * 0.2, price))
          corridorHigh = Math.min(high, Math.max(price + Math.abs(high - low) * 0.2, price))
          break
        case 'id_full':
          // ID Full — near-final, tight corridor
          price = p.id_full_ct ?? p.id1_ct ?? daPrice
          corridorLow = Math.max(low, Math.min(price - Math.abs(high - low) * 0.1, price))
          corridorHigh = Math.min(high, Math.max(price + Math.abs(high - low) * 0.1, price))
          break
        case 'last':
          // Last trade — corridor collapses to a point
          price = p.last_ct ?? p.id_full_ct ?? daPrice
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
export function useIntradayFunnel({ intradayFull, daPrices, active }: IntradayFunnelProps) {
  const [stageIndex, setStageIndex] = useState(0)
  const [isPlaying, setIsPlaying] = useState(false)

  const funnelData = useMemo(() => {
    if (!active || intradayFull.length === 0) return new Map<FunnelStage, FunnelPoint[]>()
    return computeFunnelData(intradayFull, daPrices)
  }, [intradayFull, daPrices, active])

  const currentStage = FUNNEL_STAGES[stageIndex]
  const currentPoints = funnelData.get(currentStage.key) ?? []

  // DA stage points for savings comparison
  const daPoints = funnelData.get('da') ?? []
  const daAvg = daPoints.length > 0
    ? daPoints.reduce((s, p) => s + p.price, 0) / daPoints.length
    : 0

  const currentAvg = currentPoints.length > 0
    ? currentPoints.reduce((s, p) => s + p.price, 0) / currentPoints.length
    : 0

  const currentState: FunnelState = {
    stage: currentStage.key,
    stageIndex,
    points: currentPoints,
    avgPrice: Math.round(currentAvg * 100) / 100,
    savingsVsDa: Math.round((daAvg - currentAvg) * 100) / 100,
  }

  const goToStage = useCallback((idx: number) => {
    setStageIndex(Math.max(0, Math.min(idx, FUNNEL_STAGES.length - 1)))
  }, [])

  const nextStage = useCallback(() => {
    setStageIndex(prev => Math.min(prev + 1, FUNNEL_STAGES.length - 1))
  }, [])

  const prevStage = useCallback(() => {
    setStageIndex(prev => Math.max(prev - 1, 0))
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
    isPlaying,
    setIsPlaying,
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
  totalStages,
  stages,
  currentState,
  goToStage,
  isPlaying,
  setIsPlaying,
  onPlay,
}: {
  stageIndex: number
  totalStages: number
  stages: typeof FUNNEL_STAGES
  currentState: FunnelState
  goToStage: (idx: number) => void
  isPlaying: boolean
  setIsPlaying: (v: boolean) => void
  onPlay?: () => void
}) {
  return (
    <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 rounded-lg">
      {/* Play button */}
      <button
        onClick={() => {
          if (isPlaying) {
            setIsPlaying(false)
          } else {
            setIsPlaying(true)
            onPlay?.()
          }
        }}
        className="w-7 h-7 flex items-center justify-center rounded-full bg-white shadow-sm border border-gray-200 hover:bg-gray-50 transition-colors"
        title={isPlaying ? 'Pause' : 'Play convergence animation'}
      >
        {isPlaying ? (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <rect x="1" y="1" width="3" height="8" fill="#374151" />
            <rect x="6" y="1" width="3" height="8" fill="#374151" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10">
            <polygon points="2,0 10,5 2,10" fill="#374151" />
          </svg>
        )}
      </button>

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
