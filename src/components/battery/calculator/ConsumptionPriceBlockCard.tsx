'use client'

import { useMemo, useState, type ReactNode } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent } from '@/components/ui/card'
import type { PvBatteryAnnualResult, PvBatterySlotResult } from '@/lib/pv-battery-calculator'
import { cn } from '@/lib/utils'
import type { PriceUnits } from '@/lib/v2-config'

type DistributionView = 'chronological' | 'histogram'
type DeliveredSourceKey = 'gridDirect' | 'pvDirect' | 'batteryPv' | 'batteryGrid'

interface DeliveredSourceSegment {
  key: DeliveredSourceKey
  label: string
  kwh: number
  priceCtKwh: number
  exactBlocks: number
  fullBlocks: number
  remainderBlock: number
  priceIntensity: number
}

interface ChartSlotDatum {
  idx: number
  label: string
  date: string
  loadKwh: number
  segments: DeliveredSourceSegment[]
}

interface HistogramDatum {
  label: string
  shortLabel: string
  binStart: number
  binEnd: number
  kwh: number
  blocks: number
  segmentCount: number
  priceIntensity: number
  sourceKwh: Record<DeliveredSourceKey, number>
  sourceBlocks: Record<DeliveredSourceKey, number>
}

const BLOCK_KWH = 0.05
const EPSILON = 1e-6

const SOURCE_STYLES: Record<DeliveredSourceKey, { label: string; base: string; stripe?: string }> = {
  gridDirect: {
    label: 'Grid -> load',
    base: '#7D8797',
  },
  pvDirect: {
    label: 'PV -> load',
    base: '#E9B94A',
  },
  batteryPv: {
    label: 'PV -> battery -> load',
    base: '#D9B24E',
    stripe: 'rgba(47,111,179,0.42)',
  },
  batteryGrid: {
    label: 'Grid -> battery -> load',
    base: '#8A93A3',
    stripe: 'rgba(47,111,179,0.58)',
  },
}

function buildPositiveAxis(maxValue: number, targetTicks = 5) {
  if (!Number.isFinite(maxValue) || maxValue <= 0) {
    return {
      domain: [0, 1] as [number, number],
      ticks: [0, 0.25, 0.5, 0.75, 1],
      step: 0.25,
    }
  }

  const safeTickCount = Math.max(2, targetTicks)
  const rawStep = maxValue / Math.max(safeTickCount - 1, 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(rawStep || 1)))
  const normalized = rawStep / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 2.5 ? 2.5 : normalized <= 5 ? 5 : 10
  const step = multiplier * magnitude
  const axisMax = Math.ceil(maxValue / step) * step
  const tickCount = Math.max(2, Math.round(axisMax / step) + 1)
  const ticks = Array.from({ length: tickCount }, (_, index) => Number((index * step).toFixed(6)))

  return {
    domain: [0, Number(axisMax.toFixed(6))] as [number, number],
    ticks,
    step,
  }
}

function getSlotsPerHour(count: number) {
  if (count <= 24) return 1
  return Math.max(1, Math.round(count / 24))
}

function parseHourFromLabel(label: string): number {
  const hour = Number(label.slice(0, 2))
  return Number.isFinite(hour) ? hour : 0
}

function isFullHourLabel(label: string): boolean {
  return label.slice(3, 5) === '00'
}

function formatDateBoundaryLabel(date: string): string {
  return date.length >= 10 ? date.slice(5) : date
}

function formatKwhAxisTick(value: number, step: number): string {
  if (step >= 1) return value.toFixed(1)
  if (step >= 0.1) return value.toFixed(2)
  return value.toFixed(3)
}

function formatKwh(value: number): string {
  if (value >= 10) return `${value.toFixed(1)} kWh`
  return `${value.toFixed(2)} kWh`
}

function formatPrice(value: number, units: PriceUnits): string {
  return `${value.toFixed(2)} ${units.priceUnit}`
}

function formatBlockWh(): string {
  return `${BLOCK_KWH.toFixed(2)} kWh`
}

function choosePriceBinSize(span: number, targetBins: number): number {
  if (!Number.isFinite(span) || span <= EPSILON) return 0.5
  return span / Math.max(1, targetBins)
}

function getBatteryPvEffectivePriceCtKwh(slot: PvBatterySlotResult) {
  if (slot.batteryPvToLoadKwh <= EPSILON) return 0

  const loadValueCt =
    slot.householdImportPriceCtKwh * (slot.batteryPvToLoadKwh + slot.batteryGridToLoadKwh)
  const realizedSavingsCt = slot.batteryLoadSavingsEur * 100
  const gridInputCostCt = slot.batteryGridLoadInputCostEur * 100
  const totalInputCostCt = Math.max(0, loadValueCt - realizedSavingsCt)
  const pvInputCostCt = Math.max(0, totalInputCostCt - gridInputCostCt)

  return pvInputCostCt / slot.batteryPvToLoadKwh
}

function buildDeliveredSegments(slot: PvBatterySlotResult) {
  const segments: DeliveredSourceSegment[] = []

  if (slot.gridToLoadKwh > EPSILON) {
    const exactBlocks = slot.gridToLoadKwh / BLOCK_KWH
    const fullBlocks = Math.floor(exactBlocks + EPSILON)
    segments.push({
      key: 'gridDirect',
      label: SOURCE_STYLES.gridDirect.label,
      kwh: slot.gridToLoadKwh,
      priceCtKwh: slot.householdImportPriceCtKwh,
      exactBlocks,
      fullBlocks,
      remainderBlock: Math.max(0, exactBlocks - fullBlocks),
      priceIntensity: 0,
    })
  }

  if (slot.pvToLoadKwh > EPSILON) {
    const exactBlocks = slot.pvToLoadKwh / BLOCK_KWH
    const fullBlocks = Math.floor(exactBlocks + EPSILON)
    segments.push({
      key: 'pvDirect',
      label: SOURCE_STYLES.pvDirect.label,
      kwh: slot.pvToLoadKwh,
      priceCtKwh: 0,
      exactBlocks,
      fullBlocks,
      remainderBlock: Math.max(0, exactBlocks - fullBlocks),
      priceIntensity: 0,
    })
  }

  if (slot.batteryPvToLoadKwh > EPSILON) {
    const exactBlocks = slot.batteryPvToLoadKwh / BLOCK_KWH
    const fullBlocks = Math.floor(exactBlocks + EPSILON)
    segments.push({
      key: 'batteryPv',
      label: SOURCE_STYLES.batteryPv.label,
      kwh: slot.batteryPvToLoadKwh,
      priceCtKwh: getBatteryPvEffectivePriceCtKwh(slot),
      exactBlocks,
      fullBlocks,
      remainderBlock: Math.max(0, exactBlocks - fullBlocks),
      priceIntensity: 0,
    })
  }

  if (slot.batteryGridToLoadKwh > EPSILON) {
    const exactBlocks = slot.batteryGridToLoadKwh / BLOCK_KWH
    const fullBlocks = Math.floor(exactBlocks + EPSILON)
    const priceCtKwh = slot.batteryGridLoadInputCostEur > EPSILON
      ? (slot.batteryGridLoadInputCostEur * 100) / slot.batteryGridToLoadKwh
      : 0
    segments.push({
      key: 'batteryGrid',
      label: SOURCE_STYLES.batteryGrid.label,
      kwh: slot.batteryGridToLoadKwh,
      priceCtKwh,
      exactBlocks,
      fullBlocks,
      remainderBlock: Math.max(0, exactBlocks - fullBlocks),
      priceIntensity: 0,
    })
  }

  return segments
}

function InlinePillGroup({
  options,
}: {
  options: Array<{ label: string; active: boolean; onClick: () => void }>
}) {
  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={option.onClick}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors whitespace-nowrap',
            option.active ? 'bg-white text-[#313131] shadow-sm ring-1 ring-gray-200' : 'text-gray-400 hover:text-gray-600',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function getSourceFill(source: DeliveredSourceKey): string {
  return SOURCE_STYLES[source].stripe ? `url(#consumption-${source}-stripe)` : SOURCE_STYLES[source].base
}

function getTooltipSwatch(source: DeliveredSourceKey): string {
  const style = SOURCE_STYLES[source]
  if (!style.stripe) return style.base
  return `repeating-linear-gradient(135deg, ${style.base} 0 4px, ${style.stripe} 4px 7px)`
}

function SourceFillDefs() {
  return (
    <defs>
      {(Object.keys(SOURCE_STYLES) as DeliveredSourceKey[]).map((key) => {
        const style = SOURCE_STYLES[key]
        if (!style.stripe) return null

        return (
          <pattern key={key} id={`consumption-${key}-stripe`} width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-45)">
            <rect width="8" height="8" fill={style.base} />
            <rect x="0" y="0" width="3" height="8" fill={style.stripe} />
          </pattern>
        )
      })}
    </defs>
  )
}

function DeliveredCompositionBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  payload,
}: {
  x?: number
  y?: number
  width?: number
  height?: number
  payload?: ChartSlotDatum
}) {
  if (!payload || height <= 0 || width <= 0) return null

  const totalBlocks = payload.segments.reduce((sum, segment) => sum + segment.exactBlocks, 0)
  if (totalBlocks <= EPSILON) return null

  const gap = Math.min(1, Math.max(0.2, height / Math.max(totalBlocks, 1) * 0.16))
  const unitHeight = height / totalBlocks
  const innerWidth = Math.max(1.5, width - 1)
  let consumedHeight = 0

  return (
    <g>
      {payload.segments.map((segment) => {
        const blocks = [
          ...Array.from({ length: segment.fullBlocks }, () => 1),
          ...(segment.remainderBlock > EPSILON ? [segment.remainderBlock] : []),
        ]

        return blocks.map((part, index) => {
          const rawHeight = unitHeight * part
          const blockHeight = Math.max(0.8, rawHeight - gap)
          const blockY = y + height - consumedHeight - rawHeight + (gap / 2)
          consumedHeight += rawHeight

          return (
            <rect
              key={`${segment.key}-${index}-${consumedHeight}`}
              x={x + 0.5}
              y={blockY}
              width={innerWidth}
              height={blockHeight}
              rx={Math.min(1.6, blockHeight / 3)}
              ry={Math.min(1.6, blockHeight / 3)}
              fill={getSourceFill(segment.key)}
              stroke="#FFFFFF"
              strokeOpacity={0.88}
              strokeWidth={0.85}
              shapeRendering="geometricPrecision"
            />
          )
        })
      })}
    </g>
  )
}

function HistogramTick({
  x,
  y,
  payload,
}: {
  x: number
  y: number
  payload: { value: string }
}) {
  const [top, bottom] = payload.value.split('|')

  return (
    <g transform={`translate(${x},${y})`}>
      <text x={0} y={0} textAnchor="middle" fill="#334155" fontSize={10} fontWeight={700}>
        <tspan x={0} dy={4}>{top}</tspan>
        {bottom ? (
          <tspan x={0} dy={11} fill="#94A3B8" fontSize={9} fontWeight={600}>
            {bottom}
          </tspan>
        ) : null}
      </text>
    </g>
  )
}

function ChronologicalTooltip({
  active,
  payload,
  dayLabel,
  units,
}: {
  active?: boolean
  payload?: Array<{ payload?: ChartSlotDatum }>
  dayLabel: string
  units: PriceUnits
}) {
  if (!active || !payload?.length) return null

  const slot = payload[0]?.payload
  if (!slot) return null

  return (
    <div className="min-w-[240px] rounded-2xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.14)]">
      <div className="border-b border-slate-100 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">{dayLabel}</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">{slot.label}</p>
        <p className="mt-0.5 font-semibold tabular-nums text-slate-700">{formatKwh(slot.loadKwh)} delivered</p>
      </div>
      <div className="mt-2 space-y-1.5">
        {slot.segments.map((segment) => (
          <div key={segment.key} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: getTooltipSwatch(segment.key) }} />
            <span className="truncate">{segment.label}</span>
            <span className="font-semibold tabular-nums text-slate-900">
              {formatKwh(segment.kwh)} · {formatPrice(segment.priceCtKwh, units)}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

function HistogramTooltip({
  active,
  payload,
}: {
  active?: boolean
  payload?: Array<{ payload?: HistogramDatum }>
}) {
  if (!active || !payload?.length) return null

  const bin = payload[0]?.payload
  if (!bin) return null
  const sources = (Object.keys(SOURCE_STYLES) as DeliveredSourceKey[])
    .filter((key) => bin.sourceKwh[key] > EPSILON)
    .sort((a, b) => bin.sourceKwh[b] - bin.sourceKwh[a])

  return (
    <div className="min-w-[240px] rounded-2xl border border-slate-200 bg-white p-3 text-[11px] text-slate-600 shadow-[0_14px_34px_rgba(15,23,42,0.14)]">
      <div className="border-b border-slate-100 pb-2">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Price band</p>
        <p className="mt-0.5 text-sm font-semibold text-slate-900">{bin.shortLabel}</p>
        <p className="mt-0.5 font-semibold tabular-nums text-slate-700">{formatKwh(bin.kwh)} delivered</p>
      </div>
      <div className="mt-2 space-y-1.5">
        {sources.map((key) => (
          <div key={key} className="grid grid-cols-[10px_minmax(0,1fr)_auto] items-center gap-2">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: getTooltipSwatch(key) }} />
            <span className="truncate">{SOURCE_STYLES[key].label}</span>
            <span className="font-semibold tabular-nums text-slate-900">{formatKwh(bin.sourceKwh[key])}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function ConsumptionPriceBlockCard({
  annualResult,
  dayLabel,
  units,
  loading = false,
  windowControls,
}: {
  annualResult: PvBatteryAnnualResult | null
  dayLabel: string
  units: PriceUnits
  loading?: boolean
  windowControls?: ReactNode
}) {
  const [distributionView, setDistributionView] = useState<DistributionView>('chronological')
  const [histogramBinCount, setHistogramBinCount] = useState(8)
  const slots = useMemo(() => annualResult?.slots ?? [], [annualResult])

  const slotData = useMemo<ChartSlotDatum[]>(() => slots.map((slot, index) => ({
    idx: index,
    label: slot.label,
    date: slot.date,
    loadKwh: slot.loadKwh,
    segments: buildDeliveredSegments(slot),
  })), [slots])

  const flatSegments = useMemo(
    () => slotData.flatMap((slot) => slot.segments.map((segment) => ({ ...segment, slotIdx: slot.idx, slotLabel: slot.label, date: slot.date }))),
    [slotData],
  )

  const priceStats = useMemo(() => {
    let min = Number.POSITIVE_INFINITY
    let max = Number.NEGATIVE_INFINITY
    let weightedCt = 0
    let totalKwh = 0

    for (const segment of flatSegments) {
      min = Math.min(min, segment.priceCtKwh)
      max = Math.max(max, segment.priceCtKwh)
      weightedCt += segment.priceCtKwh * segment.kwh
      totalKwh += segment.kwh
    }

    return {
      min: Number.isFinite(min) ? min : 0,
      max: Number.isFinite(max) ? max : 0,
      weightedAvg: totalKwh > EPSILON ? weightedCt / totalKwh : 0,
      totalKwh,
    }
  }, [flatSegments])

  const slotDataWithIntensity = useMemo<ChartSlotDatum[]>(() => {
    const span = Math.max(priceStats.max - priceStats.min, EPSILON)

    return slotData.map((slot) => ({
      ...slot,
      segments: slot.segments.map((segment) => ({
        ...segment,
        priceIntensity: (segment.priceCtKwh - priceStats.min) / span,
      })),
    }))
  }, [priceStats.max, priceStats.min, slotData])

  const histogramBinSize = useMemo(
    () => choosePriceBinSize(priceStats.max - priceStats.min, histogramBinCount),
    [histogramBinCount, priceStats.max, priceStats.min],
  )

  const histogramData = useMemo<HistogramDatum[]>(() => {
    const bins = new Map<number, HistogramDatum>()
    const precision = histogramBinSize < 0.1 ? 3 : histogramBinSize < 1 ? 2 : 1
    const span = Math.max(priceStats.max - priceStats.min, EPSILON)

    for (const segment of flatSegments) {
      if (segment.kwh <= EPSILON) continue

      const relativeBinIndex = Math.min(
        histogramBinCount - 1,
        Math.max(0, Math.floor((segment.priceCtKwh - priceStats.min) / histogramBinSize)),
      )
      const binStart = priceStats.min + (relativeBinIndex * histogramBinSize)
      const existing = bins.get(binStart)

      if (existing) {
        existing.kwh += segment.kwh
        existing.blocks += segment.exactBlocks
        existing.segmentCount += 1
        existing.sourceKwh[segment.key] += segment.kwh
        existing.sourceBlocks[segment.key] += segment.exactBlocks
        continue
      }

      const binEnd = relativeBinIndex === histogramBinCount - 1 ? priceStats.max : binStart + histogramBinSize
      bins.set(binStart, {
        label: `${binStart.toFixed(precision)}-${binEnd.toFixed(precision)}|${binEnd.toFixed(precision)} ${units.priceUnit}`,
        shortLabel: `${binStart.toFixed(precision)}-${binEnd.toFixed(precision)}`,
        binStart,
        binEnd,
        kwh: segment.kwh,
        blocks: segment.exactBlocks,
        segmentCount: 1,
        priceIntensity: (binStart - priceStats.min) / span,
        sourceKwh: {
          gridDirect: segment.key === 'gridDirect' ? segment.kwh : 0,
          pvDirect: segment.key === 'pvDirect' ? segment.kwh : 0,
          batteryPv: segment.key === 'batteryPv' ? segment.kwh : 0,
          batteryGrid: segment.key === 'batteryGrid' ? segment.kwh : 0,
        },
        sourceBlocks: {
          gridDirect: segment.key === 'gridDirect' ? segment.exactBlocks : 0,
          pvDirect: segment.key === 'pvDirect' ? segment.exactBlocks : 0,
          batteryPv: segment.key === 'batteryPv' ? segment.exactBlocks : 0,
          batteryGrid: segment.key === 'batteryGrid' ? segment.exactBlocks : 0,
        },
      })
    }

    return [...bins.values()]
      .map((bin) => ({
        ...bin,
        kwh: Number(bin.kwh.toFixed(6)),
        blocks: Number(bin.blocks.toFixed(6)),
        sourceKwh: {
          gridDirect: Number(bin.sourceKwh.gridDirect.toFixed(6)),
          pvDirect: Number(bin.sourceKwh.pvDirect.toFixed(6)),
          batteryPv: Number(bin.sourceKwh.batteryPv.toFixed(6)),
          batteryGrid: Number(bin.sourceKwh.batteryGrid.toFixed(6)),
        },
        sourceBlocks: {
          gridDirect: Number(bin.sourceBlocks.gridDirect.toFixed(6)),
          pvDirect: Number(bin.sourceBlocks.pvDirect.toFixed(6)),
          batteryPv: Number(bin.sourceBlocks.batteryPv.toFixed(6)),
          batteryGrid: Number(bin.sourceBlocks.batteryGrid.toFixed(6)),
        },
      }))
  }, [flatSegments, histogramBinCount, histogramBinSize, priceStats.max, priceStats.min, units.priceUnit])

  const sortedHistogramData = useMemo(() => {
    const bins = [...histogramData]
    bins.sort((a, b) => a.binStart - b.binStart)
    return bins
  }, [histogramData])

  const loadAxis = useMemo(
    () => buildPositiveAxis(Math.max(...slotData.map((slot) => slot.loadKwh), 0.1), 5),
    [slotData],
  )
  const histogramAxis = useMemo(
    () => buildPositiveAxis(Math.max(...sortedHistogramData.map((bin) => bin.kwh), 0.1), 5),
    [sortedHistogramData],
  )

  const slotsPerHour = useMemo(() => getSlotsPerHour(slotData.length), [slotData.length])
  const visibleHours = useMemo(() => slotData.length / Math.max(slotsPerHour, 1), [slotData.length, slotsPerHour])
  const xLabelIntervalHours = useMemo(() => {
    if (visibleHours <= 24) return 2
    if (visibleHours <= 48) return 4
    return 6
  }, [visibleHours])

  const xTicks = useMemo(
    () => slotData
      .filter((slot) => {
        if (!isFullHourLabel(slot.label)) return false
        const hour = parseHourFromLabel(slot.label)
        return slot.idx === 0 || hour === 0 || hour % xLabelIntervalHours === 0
      })
      .map((slot) => slot.idx),
    [slotData, xLabelIntervalHours],
  )

  const renderXTick = ({
    x,
    y,
    payload,
  }: {
    x: number
    y: number
    payload: { value: number }
  }) => {
    const point = slotData[payload.value]
    if (!point) return <g />

    const isBoundary = point.idx > 0 && isFullHourLabel(point.label) && parseHourFromLabel(point.label) === 0

    return (
      <g transform={`translate(${x},${y})`}>
        <text x={0} y={0} dy={13} textAnchor="middle" fill="#64748B" fontSize={10} fontWeight={600}>
          {point.label}
        </text>
        {isBoundary ? (
          <text x={0} y={0} dy={25} textAnchor="middle" fill="#475569" fontSize={9} fontWeight={700}>
            {formatDateBoundaryLabel(point.date)}
          </text>
        ) : null}
      </g>
    )
  }

  const activeSources = useMemo(() => {
    const totals: Record<DeliveredSourceKey, number> = {
      gridDirect: 0,
      pvDirect: 0,
      batteryPv: 0,
      batteryGrid: 0,
    }

    for (const segment of flatSegments) {
      totals[segment.key] += segment.kwh
    }

    return (Object.keys(SOURCE_STYLES) as DeliveredSourceKey[])
      .filter((key) => totals[key] > EPSILON)
  }, [flatSegments])

  if (loading || slotData.length === 0) {
    return (
      <Card className="rounded-[28px] border-gray-200 bg-white shadow-sm">
        <CardContent className="flex h-[420px] items-center justify-center p-8">
          <p className="text-sm text-gray-400">{loading ? 'Computing source-true load-price blocks…' : 'No complete day selected yet.'}</p>
        </CardContent>
      </Card>
    )
  }

  const viewControls = (
    <InlinePillGroup
      options={[
        {
          label: 'Chronological',
          active: distributionView === 'chronological',
          onClick: () => setDistributionView('chronological'),
        },
        {
          label: 'Histogram',
          active: distributionView === 'histogram',
          onClick: () => setDistributionView('histogram'),
        },
      ]}
    />
  )

  return (
    <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-7">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <p className="text-[20px] font-semibold tracking-tight text-slate-950">Hourly consumption breakdown</p>
            <div className="flex flex-wrap items-center gap-2 lg:justify-end">
              <span className="inline-flex items-center rounded-full border border-gray-200 bg-white px-2.5 py-1 text-[11px] font-semibold text-gray-500 shadow-sm whitespace-nowrap">
                1 box = {formatBlockWh()}
              </span>
              {viewControls}
              {windowControls}
            </div>
          </div>
        </div>

        <div className="px-4 pb-3 pt-4 sm:px-5">
          {distributionView === 'chronological' ? (
            <>
              <div>
                <div className="h-[390px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={slotDataWithIntensity}
                      margin={{ top: 14, right: 12, bottom: 32, left: 2 }}
                      barCategoryGap={1}
                      barGap={0}
                    >
                      <SourceFillDefs />
                      <CartesianGrid stroke="#DBE4EF" strokeDasharray="3 3" />
                      <XAxis
                        dataKey="idx"
                        type="number"
                        domain={[-0.5, Math.max(slotDataWithIntensity.length - 0.5, 0.5)]}
                        ticks={xTicks}
                        tick={renderXTick as never}
                        tickLine={false}
                        axisLine={{ stroke: '#94A3B8' }}
                        height={38}
                        interval={0}
                        allowDecimals={false}
                      />
                      <YAxis
                        width={58}
                        domain={loadAxis.domain}
                        ticks={loadAxis.ticks}
                        tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }}
                        tickLine={{ stroke: '#94A3B8' }}
                        axisLine={{ stroke: '#94A3B8' }}
                        tickFormatter={(value: number) => formatKwhAxisTick(value, loadAxis.step)}
                        label={{ value: 'Delivered load per interval (kWh)', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11, offset: 2 }}
                      />
                      <Tooltip
                        cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                        content={(props) => (
                          <ChronologicalTooltip
                            active={props.active}
                            payload={props.payload as Array<{ payload?: ChartSlotDatum }> | undefined}
                            dayLabel={dayLabel}
                            units={units}
                          />
                        )}
                      />
                      <Bar
                        dataKey="loadKwh"
                        name="Delivered load"
                        minPointSize={2}
                        isAnimationActive={false}
                        shape={<DeliveredCompositionBarShape />}
                      />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-end gap-3 px-1">
                <label className="text-[11px] font-semibold text-slate-500">Bins</label>
                <input
                  type="range"
                  min={4}
                  max={16}
                  step={1}
                  value={histogramBinCount}
                  onChange={(event) => setHistogramBinCount(Number(event.target.value))}
                  className="h-1.5 w-36 cursor-pointer appearance-none rounded-full bg-slate-200 accent-slate-900"
                  aria-label="Histogram bin count"
                />
                <span className="w-6 text-right text-[11px] font-semibold tabular-nums text-slate-700">{histogramBinCount}</span>
              </div>

              <div className="h-[390px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sortedHistogramData}
                    margin={{ top: 14, right: 10, bottom: 24, left: 0 }}
                  >
                    <SourceFillDefs />
                    <CartesianGrid stroke="#DBE4EF" strokeDasharray="3 3" vertical={false} />
                    <XAxis
                      type="category"
                      dataKey="label"
                      interval={0}
                      height={42}
                      tick={HistogramTick as never}
                      tickLine={false}
                      axisLine={{ stroke: '#94A3B8' }}
                    />
                    <YAxis
                      type="number"
                      domain={histogramAxis.domain}
                      ticks={histogramAxis.ticks}
                      width={58}
                      tick={{ fontSize: 11, fill: '#475569', fontWeight: 600 }}
                      tickLine={{ stroke: '#94A3B8' }}
                      axisLine={{ stroke: '#94A3B8' }}
                      tickFormatter={(value: number) => formatKwhAxisTick(value, histogramAxis.step)}
                      label={{ value: 'Delivered load (kWh)', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11, offset: 2 }}
                    />
                    <Tooltip
                      cursor={{ fill: 'rgba(148,163,184,0.12)' }}
                      content={(props) => (
                        <HistogramTooltip
                          active={props.active}
                          payload={props.payload as Array<{ payload?: HistogramDatum }> | undefined}
                        />
                      )}
                    />
                    {(Object.keys(SOURCE_STYLES) as DeliveredSourceKey[]).map((key) => (
                      <Bar key={key} dataKey={`sourceKwh.${key}`} stackId="histogram" radius={[0, 0, 0, 0]} isAnimationActive={false}>
                        {sortedHistogramData.map((entry) => {
                          const isTopOfStack = activeSources.filter((sourceKey) => entry.sourceKwh[sourceKey] > EPSILON).at(-1) === key
                          return (
                            <Cell
                              key={`${entry.label}-${key}`}
                              radius={isTopOfStack ? 8 : 0}
                              fill={getSourceFill(key)}
                              fillOpacity={entry.sourceKwh[key] > EPSILON ? 1 : 0}
                              strokeOpacity={0}
                            />
                          )
                        })}
                      </Bar>
                    ))}
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
