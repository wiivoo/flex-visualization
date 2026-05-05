'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { BarChart3, Blocks, Zap } from 'lucide-react'
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
type HistogramSort = 'price' | 'load'
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

const BLOCK_KWH = 0.025
const EPSILON = 1e-6
const TARGET_HISTOGRAM_BINS = 7

const SOURCE_STYLES: Record<DeliveredSourceKey, { label: string; base: string; chip: string }> = {
  gridDirect: {
    label: 'Grid -> load',
    base: '#4D7FB8',
    chip: '#E6F0FB',
  },
  pvDirect: {
    label: 'PV -> load',
    base: '#D6B04B',
    chip: '#F8F1D8',
  },
  batteryPv: {
    label: 'PV -> battery -> load',
    base: '#6E9C62',
    chip: '#E8F2E4',
  },
  batteryGrid: {
    label: 'Grid -> battery -> load',
    base: '#29435C',
    chip: '#DEE6EE',
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

function formatPriceCompact(value: number): string {
  return `${value.toFixed(value >= 10 ? 1 : 2)} ct/kWh`
}

function formatBlockCount(kwh: number): string {
  return `${Math.round(kwh / BLOCK_KWH).toLocaleString()} blocks`
}

function choosePriceBinSize(span: number, targetBins = TARGET_HISTOGRAM_BINS): number {
  if (!Number.isFinite(span) || span <= EPSILON) return 0.5
  return span / Math.max(1, targetBins)
}

function mixColor(startHex: string, endHex: string, ratio: number): string {
  const start = startHex.replace('#', '')
  const end = endHex.replace('#', '')
  const r = Math.max(0, Math.min(1, ratio))
  const sr = Number.parseInt(start.slice(0, 2), 16)
  const sg = Number.parseInt(start.slice(2, 4), 16)
  const sb = Number.parseInt(start.slice(4, 6), 16)
  const er = Number.parseInt(end.slice(0, 2), 16)
  const eg = Number.parseInt(end.slice(2, 4), 16)
  const eb = Number.parseInt(end.slice(4, 6), 16)
  const rr = Math.round(sr + ((er - sr) * r))
  const rg = Math.round(sg + ((eg - sg) * r))
  const rb = Math.round(sb + ((eb - sb) * r))
  return `rgb(${rr}, ${rg}, ${rb})`
}

function getChronologicalPriceFill(segment: DeliveredSourceSegment) {
  return mixColor('#D8E7F7', '#1D4ED8', 0.18 + (segment.priceIntensity * 0.72))
}

function getHistogramSourceFill(source: DeliveredSourceKey, priceIntensity: number) {
  return mixColor('#FFFFFF', SOURCE_STYLES[source].base, 0.24 + (priceIntensity * 0.66))
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
    <div className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-100/80 p-0.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          onClick={option.onClick}
          className={cn(
            'rounded-full px-3 py-1.5 text-[11px] font-semibold transition-colors whitespace-nowrap',
            option.active ? 'bg-white text-slate-900 shadow-sm ring-1 ring-slate-200' : 'text-slate-500 hover:text-slate-700',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function SummaryTile({
  label,
  value,
  detail,
  icon: Icon,
}: {
  label: string
  value: string
  detail: string
  icon: typeof Blocks
}) {
  return (
    <div className="rounded-[20px] border border-slate-200/80 bg-[linear-gradient(180deg,#FCFDFF_0%,#FFFFFF_100%)] px-3.5 py-3 shadow-[0_10px_24px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2">
        <span className="flex h-7 w-7 items-center justify-center rounded-full border border-slate-200 bg-slate-50 text-slate-600">
          <Icon className="h-3.5 w-3.5" />
        </span>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">{label}</p>
      </div>
      <p className="mt-2 text-[14px] font-semibold tracking-tight text-slate-950">{value}</p>
      <p className="mt-1 text-[11px] leading-4 text-slate-500">{detail}</p>
    </div>
  )
}

function LegendChip({
  label,
  tone,
}: {
  label: string
  tone: string
}) {
  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 shadow-[0_6px_16px_rgba(15,23,42,0.04)]">
      <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: tone }} />
      <span className="text-[11px] font-medium text-slate-600">{label}</span>
    </div>
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
              fill={getChronologicalPriceFill(segment)}
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

export function ConsumptionPriceBlockCard({
  annualResult,
  dayLabel,
  units,
  loading = false,
  controls,
  priceCurveMode = 'spot',
}: {
  annualResult: PvBatteryAnnualResult | null
  dayLabel: string
  units: PriceUnits
  loading?: boolean
  controls?: ReactNode
  priceCurveMode?: 'spot' | 'end'
}) {
  const [distributionView, setDistributionView] = useState<DistributionView>('chronological')
  const [histogramSort, setHistogramSort] = useState<HistogramSort>('price')
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
    () => choosePriceBinSize(priceStats.max - priceStats.min, TARGET_HISTOGRAM_BINS),
    [priceStats.max, priceStats.min],
  )

  const histogramData = useMemo<HistogramDatum[]>(() => {
    const bins = new Map<number, HistogramDatum>()
    const precision = histogramBinSize < 0.1 ? 3 : histogramBinSize < 1 ? 2 : 1
    const span = Math.max(priceStats.max - priceStats.min, EPSILON)

    for (const segment of flatSegments) {
      if (segment.kwh <= EPSILON) continue

      const relativeBinIndex = Math.min(
        TARGET_HISTOGRAM_BINS - 1,
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

      const binEnd = relativeBinIndex === TARGET_HISTOGRAM_BINS - 1 ? priceStats.max : binStart + histogramBinSize
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
  }, [flatSegments, histogramBinSize, priceStats.max, priceStats.min, units.priceUnit])

  const sortedHistogramData = useMemo(() => {
    const bins = [...histogramData]
    if (histogramSort === 'load') {
      bins.sort((a, b) => {
        if (Math.abs(b.kwh - a.kwh) > EPSILON) return b.kwh - a.kwh
        return a.binStart - b.binStart
      })
      return bins
    }
    bins.sort((a, b) => a.binStart - b.binStart)
    return bins
  }, [histogramData, histogramSort])

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

  const timelineMinWidthPx = useMemo(() => {
    const pxPerSlot = slotsPerHour >= 4 ? (slotData.length > 96 ? 6 : 8) : 16
    return Math.max(760, Math.round(slotData.length * pxPerSlot))
  }, [slotData.length, slotsPerHour])

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

  const sourceTotals = useMemo(() => {
    const totals: Record<DeliveredSourceKey, number> = {
      gridDirect: 0,
      pvDirect: 0,
      batteryPv: 0,
      batteryGrid: 0,
    }

    for (const segment of flatSegments) {
      totals[segment.key] += segment.kwh
    }

    return totals
  }, [flatSegments])

  const summaryCards = useMemo(() => [
    {
      label: 'Visible delivered load',
      value: formatKwh(priceStats.totalKwh),
      detail: formatBlockCount(priceStats.totalKwh),
      icon: Blocks,
    },
    {
      label: 'Effective delivered price',
      value: formatPrice(priceStats.weightedAvg, units),
      detail: 'weighted across delivered source blocks',
      icon: Zap,
    },
    {
      label: 'Price span',
      value: `${formatPriceCompact(priceStats.min)} to ${formatPriceCompact(priceStats.max)}`,
      detail: `${histogramData.length} of ${TARGET_HISTOGRAM_BINS} price bands occupied`,
      icon: BarChart3,
    },
  ], [histogramData.length, priceStats.max, priceStats.min, priceStats.totalKwh, priceStats.weightedAvg, units])

  const sourceLegend = (Object.keys(SOURCE_STYLES) as DeliveredSourceKey[])
    .filter((key) => sourceTotals[key] > EPSILON)

  const referenceLabel = priceCurveMode === 'end' ? 'Shared controls: end-price context' : 'Shared controls: spot-price context'

  if (loading || slotData.length === 0) {
    return (
      <Card className="rounded-[28px] border-gray-200 bg-white shadow-sm">
        <CardContent className="flex h-[420px] items-center justify-center p-8">
          <p className="text-sm text-gray-400">{loading ? 'Computing source-true load-price blocks…' : 'No complete day selected yet.'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-slate-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="grid gap-5 lg:grid-cols-[minmax(250px,0.95fr)_minmax(0,2.05fr)] lg:items-center">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-[#D6E5F7] bg-[#EEF5FC] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.16em] text-[#214F90]">
                  Load x Price
                </span>
                <span className="rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">
                  Source-true delivered mix
                </span>
              </div>
              <p className="mt-3 text-[26px] font-semibold tracking-[-0.03em] text-slate-950">Consumption blocks by delivered source</p>
              <p className="mt-1 text-[13px] font-medium text-slate-500">{dayLabel}</p>
              <p className="mt-3 max-w-[35rem] text-[12px] leading-5 text-slate-500">
                Each interval is rebuilt from the actual load-serving sources in the slot. Direct grid, direct PV, PV-stored battery discharge, and grid-stored battery discharge each keep their own effective delivered price.
              </p>
            </div>
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {summaryCards.map((card) => (
                <SummaryTile key={card.label} {...card} />
              ))}
            </div>
          </div>
        </div>

        <div className="pl-4 pr-2 pb-3 pt-3 sm:pl-5 sm:pr-3">
          <div className="mb-3 flex flex-col gap-3 xl:flex-row xl:items-start xl:justify-between">
            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <InlinePillGroup
                options={[
                  {
                    label: 'Chronological',
                    active: distributionView === 'chronological',
                    onClick: () => setDistributionView('chronological'),
                  },
                  {
                    label: 'Price histogram',
                    active: distributionView === 'histogram',
                    onClick: () => setDistributionView('histogram'),
                  },
                ]}
              />
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-slate-600 whitespace-nowrap">
                1 block = 25 Wh
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-slate-500 whitespace-nowrap">
                {referenceLabel}
              </span>
              {sourceLegend.map((key) => (
                <LegendChip key={key} label={`${SOURCE_STYLES[key].label} · ${formatKwh(sourceTotals[key])}`} tone={SOURCE_STYLES[key].base} />
              ))}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-2 xl:justify-end">
              {controls}
            </div>
          </div>

          {distributionView === 'chronological' ? (
            <>
              <div className="mb-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between px-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <LegendChip label="Bar height = delivered load per interval" tone="#CBD5E1" />
                  <LegendChip label="Color = effective delivered price" tone="#2563EB" />
                  <LegendChip label="Source split stays in tooltip and histogram" tone="#94A3B8" />
                </div>
                <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500">
                  Effective price range <span className="font-semibold text-slate-700">{formatPriceCompact(priceStats.min)} to {formatPriceCompact(priceStats.max)}</span>
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="h-[390px]" style={{ minWidth: `${timelineMinWidthPx}px` }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart
                      data={slotDataWithIntensity}
                      margin={{ top: 14, right: 12, bottom: 32, left: 2 }}
                      barCategoryGap={1}
                      barGap={0}
                    >
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
                        contentStyle={{ borderRadius: 18, borderColor: '#E5E7EB', boxShadow: '0 12px 30px rgba(15,23,42,0.12)' }}
                        labelFormatter={(value) => {
                          const index = typeof value === 'number' ? value : Number(value)
                          const slot = Number.isFinite(index) ? slotDataWithIntensity[index] : null
                          return slot ? `${dayLabel} · ${slot.label}` : dayLabel
                        }}
                        formatter={(_value, _name, item) => {
                          const slot = item.payload as ChartSlotDatum
                          return [
                            <div key="tooltip" className="space-y-1">
                              <div className="font-semibold text-slate-800">{formatKwh(slot.loadKwh)}</div>
                              {slot.segments.map((segment) => (
                                <div key={segment.key} className="flex items-center justify-between gap-3">
                                  <span>{segment.label}</span>
                                  <span className="tabular-nums">{formatKwh(segment.kwh)} @ {formatPrice(segment.priceCtKwh, units)}</span>
                                </div>
                              ))}
                            </div>,
                            'Delivered mix / effective price',
                          ]
                        }}
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

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-[11px] text-slate-500">
                  Midnight boundaries stay marked so 24h, 48h, and 72h windows remain readable.
                </p>
                <p className="text-[11px] font-medium text-slate-500">
                  Weighted delivered price <span className="font-semibold text-slate-700">{formatPrice(priceStats.weightedAvg, units)}</span>
                </p>
              </div>
            </>
          ) : (
            <>
              <div className="mb-2 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between px-1">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <LegendChip label="X axis = effective price bins" tone="#94A3B8" />
                  <LegendChip label="Y axis = represented delivered load" tone="#CBD5E1" />
                  <LegendChip label="Stack colors = source path, shade = price level" tone="#475569" />
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <div className="rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-medium text-slate-500">
                    Target {TARGET_HISTOGRAM_BINS} bins · size <span className="font-semibold text-slate-700">{histogramBinSize.toFixed(histogramBinSize < 0.1 ? 3 : histogramBinSize < 1 ? 2 : 1)} {units.priceUnit}</span>
                  </div>
                  <InlinePillGroup
                    options={[
                      {
                        label: 'Price order',
                        active: histogramSort === 'price',
                        onClick: () => setHistogramSort('price'),
                      },
                      {
                        label: 'Largest first',
                        active: histogramSort === 'load',
                        onClick: () => setHistogramSort('load'),
                      },
                    ]}
                  />
                </div>
              </div>

              <div className="h-[390px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={sortedHistogramData}
                    margin={{ top: 14, right: 10, bottom: 24, left: 0 }}
                  >
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
                      label={{ value: 'Represented delivered load (kWh)', angle: -90, position: 'insideLeft', fill: '#64748B', fontSize: 11, offset: 2 }}
                    />
                    <Tooltip
                      contentStyle={{ borderRadius: 18, borderColor: '#E5E7EB', boxShadow: '0 12px 30px rgba(15,23,42,0.12)' }}
                      labelFormatter={(value) => `${String(value).replace('|', ' ')}`}
                      formatter={(_value, _name, item) => {
                        const bin = item.payload as HistogramDatum
                        return [
                          <div key="tooltip" className="space-y-1">
                            <div>{formatKwh(bin.kwh)}</div>
                            <div>{Math.round(bin.blocks).toLocaleString()} blocks</div>
                            <div>{bin.segmentCount} delivered source segments</div>
                            {(Object.keys(SOURCE_STYLES) as DeliveredSourceKey[])
                              .filter((key) => bin.sourceKwh[key] > EPSILON)
                              .sort((a, b) => bin.sourceKwh[b] - bin.sourceKwh[a])
                              .map((key) => (
                                <div key={key} className="flex items-center justify-between gap-3">
                                  <span>{SOURCE_STYLES[key].label}</span>
                                  <span className="tabular-nums">{formatKwh(bin.sourceKwh[key])}</span>
                                </div>
                              ))}
                          </div>,
                          'Delivered load in price band',
                        ]
                      }}
                    />
                    {(Object.keys(SOURCE_STYLES) as DeliveredSourceKey[]).map((key) => (
                      <Bar key={key} dataKey={`sourceKwh.${key}`} stackId="histogram" radius={[0, 0, 0, 0]} isAnimationActive={false}>
                        {sortedHistogramData.map((entry) => {
                          const isTopOfStack = sourceLegend.filter((sourceKey) => entry.sourceKwh[sourceKey] > EPSILON).at(-1) === key
                          return (
                            <Cell
                              key={`${entry.label}-${key}`}
                              radius={isTopOfStack ? 8 : 0}
                              fill={getHistogramSourceFill(key, entry.priceIntensity)}
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

              <div className="mt-3 flex flex-wrap items-center justify-between gap-2 px-1">
                <p className="text-[11px] text-slate-500">
                  The histogram groups individual delivered source segments into wider price bands and can be ranked by price or by represented load.
                </p>
                <p className="text-[11px] font-medium text-slate-500">
                  Peak band load <span className="font-semibold text-slate-700">{formatKwh(Math.max(...sortedHistogramData.map((bin) => bin.kwh), 0))}</span>
                </p>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
