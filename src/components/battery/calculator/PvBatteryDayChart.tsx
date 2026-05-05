'use client'

import { useCallback, useMemo, useState, type ReactNode } from 'react'
import { Battery, BatteryCharging, Home, SunMedium, Zap } from 'lucide-react'
import {
  Area,
  Bar,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent } from '@/components/ui/card'
import type { PvBatteryAnnualResult, PvBatterySlotResult } from '@/lib/pv-battery-calculator'
import { cn } from '@/lib/utils'
import type { PriceUnits } from '@/lib/v2-config'

interface Props {
  annualResult: PvBatteryAnnualResult | null
  dayLabel: string
  units: PriceUnits
  savingsCard?: {
    selectedDay: {
      savingsCtKwh: number
      savingsEur: number
      sessionKwh: number
      marketSpreadCtKwh: number
      cheapestHour: string
      expensiveHour: string
    }
    historical: {
      last4WeeksAvgCtKwh: number
      last4WeeksTotalEur: number
      last52WeeksAvgCtKwh: number
      last52WeeksAnnualEur: number
    }
  } | null
  loading?: boolean
  controls?: ReactNode
  priceControls?: ReactNode
  householdControls?: ReactNode
  priceCurveMode?: 'spot' | 'end'
}

type HouseholdSeriesKey =
  | 'pvLoad'
  | 'batteryLoad'
  | 'gridDirect'
  | 'demand'

const COLORS = {
  pvDirect: '#E9B94A',
  pvStored: '#C96C1C',
  pvCharge: '#D99F21',
  gridDirect: '#7D8797',
  gridStored: '#2F6FB3',
  export: '#0F8A86',
  curtailed: '#E8CD88',
  lineSpot: '#0F172A',
  lineHousehold: '#334155',
  lineExport: '#0F8A86',
  bandCharge: '#D8E5F8',
  bandBattery: '#F8DFCA',
  bandPv: '#FCEFC8',
  bandSoc: '#FEE6BF',
  markerCharge: '#2F6FB3',
  markerDischarge: '#C96C1C',
  markerPvExport: '#C59B1F',
  surface: '#FFFFFF',
  surfaceMuted: '#FFFFFF',
  surfaceInset: '#FFFFFF',
  plot: '#F8FAFC',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  axis: '#64748B',
  axisStrong: '#475569',
  text: '#171717',
  textStrong: '#111827',
  textMuted: '#64748B',
  textSoft: '#94A3B8',
} as const

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

function buildSymmetricAxis(maxAbsValue: number, targetTicks = 5) {
  const positive = buildPositiveAxis(maxAbsValue, targetTicks)
  const positiveTicks = positive.ticks.filter((tick) => tick > 0)
  const negativeTicks = [...positiveTicks].reverse().map((tick) => Number((-tick).toFixed(6)))
  const ticks = [...negativeTicks, 0, ...positiveTicks]
  return {
    domain: [Number((-positive.domain[1]).toFixed(6)), positive.domain[1]] as [number, number],
    ticks,
    step: positive.step,
  }
}

function formatKwhAxisTick(value: number, step: number): string {
  if (step >= 1) return value.toFixed(1)
  if (step >= 0.1) return value.toFixed(2)
  return value.toFixed(3)
}

function buildRangeTicks(minValue: number, maxValue: number, targetTicks = 5): number[] {
  if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) return [0]
  if (minValue === maxValue) {
    const center = Math.round(minValue)
    return [center - 2, center, center + 2]
  }

  const span = maxValue - minValue
  const rawStep = span / Math.max(targetTicks - 1, 1)
  const magnitude = Math.pow(10, Math.floor(Math.log10(Math.abs(rawStep) || 1)))
  const normalized = rawStep / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  const step = multiplier * magnitude
  const start = Math.floor(minValue / step) * step
  const end = Math.ceil(maxValue / step) * step

  const ticks: number[] = []
  for (let tick = start; tick <= end + step / 2; tick += step) {
    ticks.push(Number(tick.toFixed(6)))
  }
  return ticks
}

function getSlotsPerHour(count: number) {
  if (count <= 24) return 1
  return Math.max(1, Math.round(count / 24))
}

function buildHourTicks(count: number) {
  if (count <= 0) return []
  const step = getSlotsPerHour(count)
  const ticks: number[] = []
  for (let index = 0; index < count; index += step) ticks.push(index)
  if (ticks[ticks.length - 1] !== count - 1) ticks.push(count - 1)
  return ticks
}

function buildSlotDomain(count: number): [number, number] {
  if (count <= 1) return [-0.5, 0.5]
  return [-0.5, count - 0.5]
}

function formatHourTick(label: string) {
  return label.slice(0, 5)
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

function formatDayKwh(value: number): string {
  return `${value.toFixed(2)} kWh`
}

function formatBlockKwh(value: number): string {
  if (value >= 1) return value.toFixed(2)
  if (value >= 0.1) return value.toFixed(3)
  return value.toFixed(4)
}

function formatBlockWh(value: number): string {
  return `${Math.round(value * 1000)}`
}

function formatTimestampLabel(timestamp: number): string {
  const value = new Date(timestamp)
  return `${value.toISOString().slice(0, 10)} ${value.toISOString().slice(11, 16)}`
}

function formatMetricKwh(value: number): string {
  return `${value.toFixed(3)} kWh`
}

function formatMoney(value: number, units: PriceUnits): string {
  return `${value >= 0 ? '+' : '-'}${units.currencySym}${Math.abs(value).toFixed(2)}`
}

function buildSlotWhyLines(
  slot: PvBatterySlotResult,
  units: PriceUnits,
  planningModel: 'deterministic' | 'rolling',
): string[] {
  const lines: string[] = []

  if (slot.gridToBatteryKwh > 0) {
    lines.push(`Grid charging happened because ${slot.importPriceCtKwh.toFixed(2)} ${units.priceUnit} was cheap enough to justify storing energy for a later slot in the same optimization horizon.`)
  }
  if (slot.pvToBatteryKwh > 0) {
    lines.push('PV surplus was stored because later household use or export was more valuable than giving all surplus away immediately.')
  }
  if (slot.batteryToLoadKwh > 0) {
    lines.push(`Battery discharge covered household demand because avoiding import at ${slot.importPriceCtKwh.toFixed(2)} ${units.priceUnit} beat holding that energy longer.`)
  }
  if (slot.batteryExportKwh > 0) {
    lines.push(`Battery export happened because the slot paid ${slot.exportPriceCtKwh.toFixed(2)} ${units.priceUnit} on the export side and the run valued export above waiting.`)
  }
  if (slot.pvToGridKwh > 0) {
    lines.push('PV exported after load and storage options were satisfied or blocked by the active constraints and value trade-offs.')
  }
  if (slot.curtailedKwh > 0) {
    lines.push('Some PV was curtailed because export limits, routing permissions, or battery limits left surplus with nowhere feasible to go.')
  }
  if (lines.length === 0 && planningModel === 'rolling') {
    lines.push('The planner largely held its position in this slot. In rolling mode that often means the current run saw more value in waiting for later slots while still respecting the terminal SoC rule.')
  }
  if (lines.length === 0) {
    lines.push('No exceptional routing was needed here: direct PV covered what it could and the remaining demand stayed on the simplest feasible path.')
  }

  return lines
}

interface SegmentedBarShapeProps {
  dataKey?: string
  fill?: string
  height?: number
  payload?: Record<string, unknown>
  value?: number | string | [number, number]
  width?: number
  x?: number
  y?: number
}

function SegmentedBarShape({
  x = 0,
  y = 0,
  width = 0,
  height = 0,
  value = 0,
  dataKey,
  payload,
  fill = COLORS.gridDirect,
  blockKwh,
}: SegmentedBarShapeProps & { blockKwh: number }) {
  if (height <= 0 || width <= 0) return null
  const stackedDelta = Array.isArray(value)
    ? Number(value[1] ?? 0) - Number(value[0] ?? 0)
    : null
  const stackedMagnitude = stackedDelta === null ? null : Math.abs(stackedDelta)
  const dataKeyValue = dataKey && payload ? Number(payload[dataKey]) : null
  const rawNumericValue = dataKeyValue !== null && Number.isFinite(dataKeyValue)
    ? dataKeyValue
    : typeof value === 'number'
    ? value
    : (stackedDelta !== null && Number.isFinite(stackedDelta))
      ? stackedDelta
      : (dataKeyValue !== null && Number.isFinite(dataKeyValue) ? dataKeyValue : Number(value))
  const numericValue = stackedMagnitude !== null && !(dataKeyValue !== null && Number.isFinite(dataKeyValue))
    ? stackedMagnitude
    : Math.abs(rawNumericValue)
  if (!Number.isFinite(numericValue) || numericValue <= 0) return null

  const safeBlockKwh = Math.max(blockKwh, 1e-6)
  const fullBlocks = Math.floor(numericValue / safeBlockKwh)
  const remainderKwh = Math.max(0, numericValue - fullBlocks * safeBlockKwh)
  const blockKwhParts = [
    ...Array.from({ length: fullBlocks }, () => safeBlockKwh),
    ...(remainderKwh > 1e-6 ? [remainderKwh] : []),
  ]
  if (blockKwhParts.length === 0) return null

  const pxPerKwh = height / numericValue
  const blockX = x
  const blockWidth = Math.max(0.75, width - 1.2)
  let cumulativeHeight = 0

  return (
    <g>
      {blockKwhParts.map((partKwh, index) => {
        const blockPixelHeight = Math.max(1.2, partKwh * pxPerKwh - 0.45)
        const blockY = y + height - cumulativeHeight - blockPixelHeight
        cumulativeHeight += partKwh * pxPerKwh
        const corner = Math.min(1.6, Math.max(0.6, blockPixelHeight * 0.25))
        return (
          <rect
            key={index}
            x={blockX}
            y={blockY}
            width={blockWidth}
            height={blockPixelHeight}
            rx={corner}
            ry={corner}
            fill={fill}
            fillOpacity={1}
            stroke="#FFFFFF"
            strokeOpacity={0.9}
            strokeWidth={0.9}
            shapeRendering="geometricPrecision"
          />
        )
      })}
    </g>
  )
}

export function PvBatteryDayChart({
  annualResult,
  dayLabel,
  units,
  savingsCard = null,
  loading = false,
  controls,
  priceControls,
  householdControls,
  priceCurveMode = 'spot',
}: Props) {
  const slots = useMemo(() => annualResult?.slots ?? [], [annualResult])
  const slotSelectionKey = `${slots.length}:${slots[0]?.timestamp ?? ''}`
  const [selectedState, setSelectedState] = useState({ key: '', index: 0 })
  const selectedIndex = selectedState.key === slotSelectionKey ? selectedState.index : 0
  const setSelectedIndex = useCallback((index: number) => {
    setSelectedState({ key: slotSelectionKey, index })
  }, [slotSelectionKey])
  const [visibleFlowLayers, setVisibleFlowLayers] = useState({
    charge: true,
    discharge: true,
    pvExport: true,
  })
  const [visibleSeries, setVisibleSeries] = useState<Record<HouseholdSeriesKey, boolean>>({
    pvLoad: true,
    batteryLoad: true,
    gridDirect: true,
    demand: true,
  })

  const effectiveSelectedIndex = Math.min(selectedIndex, Math.max(slots.length - 1, 0))
  const selectedSlot = slots[effectiveSelectedIndex]
  const runMap = useMemo(
    () => new Map((annualResult?.runs ?? []).map((run) => [run.runId, run])),
    [annualResult],
  )
  const selectedRun = selectedSlot ? runMap.get(selectedSlot.runId) ?? null : null
  const visibleRunSegments = useMemo(() => {
    const segments = new Map<string, {
      runId: string
      runLabel: string
      firstIndex: number
      lastIndex: number
      firstSlot: PvBatterySlotResult
      lastSlot: PvBatterySlotResult
      initialSocKwh: number
      knownHorizonEnd: number
      committedUntil: number
      terminalRule: string
      loadForecastSource: string
      pvForecastSource: string
      priceSource: string
      tariffBasis: string
    }>()

    slots.forEach((slot, index) => {
      const existing = segments.get(slot.runId)
      if (existing) {
        existing.lastIndex = index
        existing.lastSlot = slot
        return
      }

      const run = runMap.get(slot.runId)
      segments.set(slot.runId, {
        runId: slot.runId,
        runLabel: slot.runLabel,
        firstIndex: index,
        lastIndex: index,
        firstSlot: slot,
        lastSlot: slot,
        initialSocKwh: run?.initialSocKwh ?? slot.runInitialSocKwh,
        knownHorizonEnd: run?.knownHorizonEnd ?? slot.knownHorizonEnd,
        committedUntil: run?.committedUntil ?? slot.committedUntil,
        terminalRule: run?.terminalRule ?? slot.terminalRule,
        loadForecastSource: run?.loadForecastSource ?? slot.loadForecastSource,
        pvForecastSource: run?.pvForecastSource ?? slot.pvForecastSource,
        priceSource: run?.priceSource ?? slot.priceSource,
        tariffBasis: run?.tariffBasis ?? slot.tariffBasis,
      })
    })

    return [...segments.values()].sort((a, b) => a.firstIndex - b.firstIndex)
  }, [runMap, slots])
  const slotWhyLines = useMemo(
    () => selectedSlot
      ? buildSlotWhyLines(selectedSlot, units, annualResult?.planningModel ?? 'deterministic')
      : [],
    [annualResult?.planningModel, selectedSlot, units],
  )
  const flowChartLayout = {
    height: 420,
    marginTop: 24,
    marginBottom: 20,
  } as const

  const slotsPerHour = useMemo(() => getSlotsPerHour(slots.length), [slots.length])
  const flowPriceDataKey = priceCurveMode === 'end' ? 'householdImportPriceCtKwh' : 'spotPriceCtKwh'
  const flowPriceLegendLabel = priceCurveMode === 'end' ? 'End price' : 'Spot price'
  const flowPriceSeriesName = `${flowPriceLegendLabel} (${units.priceUnit})`

  const householdData = useMemo(
    () => slots.map((slot, index) => ({
      ...slot,
      idx: index,
      time: slot.label,
      visibleGridToLoadKwh: slot.gridToLoadKwh,
      visiblePvToLoadKwh: slot.pvToLoadKwh,
      visibleBatteryToLoadKwh: slot.batteryPvToLoadKwh + slot.batteryGridToLoadKwh,
      visiblePvExportKwh: slot.pvToGridKwh,
      visibleBatteryExportKwh: slot.batteryPvExportKwh + slot.batteryGridExportKwh,
      totalDemandKwh: slot.pvToLoadKwh + slot.batteryPvToLoadKwh + slot.batteryGridToLoadKwh + slot.gridToLoadKwh,
    })),
    [slots],
  )
  const daySummary = useMemo(() => {
    return slots.reduce((totals, slot) => {
      const batteryToLoadKwh = slot.batteryPvToLoadKwh + slot.batteryGridToLoadKwh
      const householdBreakdownKwh = slot.pvToLoadKwh + batteryToLoadKwh + slot.gridToLoadKwh

      totals.householdKwh += householdBreakdownKwh
      totals.pvKwh += slot.pvToLoadKwh
      totals.gridKwh += slot.gridToLoadKwh
      totals.batteryToLoadKwh += batteryToLoadKwh
      return totals
    }, {
      householdKwh: 0,
      pvKwh: 0,
      gridKwh: 0,
      batteryToLoadKwh: 0,
    })
  }, [slots])
  const maxSocKwh = useMemo(
    () => Math.max(...slots.map((slot) => Math.max(slot.socKwhStart, slot.socKwhEnd)), 0.1),
    [slots],
  )
  const maxFlowAbsKwh = useMemo(
    () => Math.max(
      ...slots.map((slot) =>
        Math.max(slot.gridToBatteryKwh, slot.pvToBatteryKwh, slot.batteryToLoadKwh, slot.batteryExportKwh, slot.pvToGridKwh)),
      0.1,
    ),
    [slots],
  )
  const flowAxis = useMemo(() => buildSymmetricAxis(maxFlowAbsKwh, 5), [maxFlowAbsKwh])
  const batteryFlowData = useMemo(
    () => slots.map((slot, index) => ({
      ...slot,
      idx: index,
      time: slot.label,
      chargeFromPriceKwh: slot.gridToBatteryKwh,
      chargeFromExcessPvKwh: slot.pvToBatteryKwh,
      dischargeToHouseholdKwh: -slot.batteryToLoadKwh,
      dischargeToPriceKwh: -slot.batteryExportKwh,
      sellExcessPvKwh: -slot.pvToGridKwh,
      chargeMarkerPrice: slot.chargeToBatteryKwh > 0 ? slot[flowPriceDataKey] : null,
      dischargeMarkerPrice: (slot.batteryToLoadKwh + slot.batteryExportKwh) > 0 ? slot[flowPriceDataKey] : null,
      pvExportMarkerPrice: slot.pvToGridKwh > 0 ? slot[flowPriceDataKey] : null,
      socBandKwh: maxSocKwh > 0
        ? (slot.socKwhEnd / maxSocKwh) * flowAxis.domain[1] * 0.9
        : 0,
    })),
    [flowAxis.domain, flowPriceDataKey, maxSocKwh, slots],
  )
  const householdDataByIndex = useMemo(
    () => new Map(householdData.map((point) => [point.idx, point])),
    [householdData],
  )
  const batteryFlowDataByIndex = useMemo(
    () => new Map(batteryFlowData.map((point) => [point.idx, point])),
    [batteryFlowData],
  )
  const xDomain = useMemo<[number, number]>(() => buildSlotDomain(householdData.length), [householdData.length])
  const xLabelIntervalHours = useMemo(() => {
    const totalHours = householdData.length / Math.max(slotsPerHour, 1)
    if (totalHours <= 48) return 2
    return 4
  }, [householdData.length, slotsPerHour])
  const midnightIdxSet = useMemo(() => {
    const set = new Set<number>()
    for (const point of householdData) {
      if (point.idx > 0 && isFullHourLabel(point.time) && parseHourFromLabel(point.time) === 0) {
        set.add(point.idx)
      }
    }
    return set
  }, [householdData])
  const xTicks = useMemo(() => {
    return householdData
      .filter((point) => {
        if (!isFullHourLabel(point.time)) return false
        if (midnightIdxSet.has(point.idx)) return true
        return parseHourFromLabel(point.time) % xLabelIntervalHours === 0
      })
      .map((point) => point.idx)
  }, [householdData, midnightIdxSet, xLabelIntervalHours])
  const renderXTick = useCallback((props: { x: number; y: number; payload: { value: number } }) => {
    const { x, y, payload } = props
    const point = householdData[payload.value]
    if (!point) return <g />

    const isDateBoundary = midnightIdxSet.has(point.idx)
    let isNearBoundary = false
    if (!isDateBoundary && parseHourFromLabel(point.time) % xLabelIntervalHours === 0) {
      const step = Math.max(1, slotsPerHour)
      for (const midIdx of midnightIdxSet) {
        if (Math.abs(point.idx - midIdx) < step * xLabelIntervalHours) {
          isNearBoundary = true
          break
        }
      }
    }

    const showHourLabel =
      parseHourFromLabel(point.time) % xLabelIntervalHours === 0 &&
      !isDateBoundary &&
      !isNearBoundary
    const fontSize = xLabelIntervalHours >= 6 ? 10 : 11

    return (
      <g transform={`translate(${x},${y})`}>
        <line
          x1={0}
          y1={0}
          x2={0}
          y2={isDateBoundary ? 8 : 6}
          stroke={isDateBoundary ? COLORS.axisStrong : COLORS.textSoft}
          strokeWidth={isDateBoundary ? 1.5 : 1}
        />
        {showHourLabel ? (
          <text x={0} y={0} dy={16} textAnchor="middle" fill={COLORS.axis} fontSize={fontSize} fontWeight={500}>
            {point.time}
          </text>
        ) : null}
        {isDateBoundary ? (
          <>
            <text x={0} y={0} dy={17} textAnchor="middle" fill={COLORS.axisStrong} fontSize={fontSize} fontWeight={700}>
              00:00
            </text>
            <text x={0} y={0} dy={30} textAnchor="middle" fill={COLORS.axis} fontSize={Math.max(fontSize - 1, 9)} fontWeight={600}>
              {formatDateBoundaryLabel(point.date)}
            </text>
          </>
        ) : null}
      </g>
    )
  }, [householdData, midnightIdxSet, slotsPerHour, xLabelIntervalHours])

  const flowPriceAxis = useMemo(() => {
    let minValue = Number.POSITIVE_INFINITY
    let maxValue = Number.NEGATIVE_INFINITY

    for (const slot of slots) {
      const priceValue = slot[flowPriceDataKey]
      minValue = Math.min(minValue, priceValue)
      maxValue = Math.max(maxValue, priceValue)
    }

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return { ticks: [0, 5, 10], domain: [0, 10] as [number, number] }
    }

    if (Math.abs(maxValue - minValue) < 1e-6) {
      const halfSpan = Math.max(Math.abs(minValue) * 0.03, 0.5)
      const domain = [Number((minValue - halfSpan).toFixed(6)), Number((maxValue + halfSpan).toFixed(6))] as [number, number]
      return { ticks: buildRangeTicks(domain[0], domain[1], 5), domain }
    }

    const padding = Math.max((maxValue - minValue) * 0.03, 0.4)
    const domain = [Number((minValue - padding).toFixed(6)), Number((maxValue + padding).toFixed(6))] as [number, number]
    return { ticks: buildRangeTicks(domain[0], domain[1], 5), domain }
  }, [flowPriceDataKey, slots])

  const isQuarterHour = slotsPerHour >= 4
  const timelineMinWidthPx = useMemo(() => {
    if (!isQuarterHour) return 0
    // Keep quarter-hour slots readable on 48h/72h windows.
    const pxPerSlot = householdData.length > 96 ? 6 : 4.5
    return Math.max(760, Math.round(householdData.length * pxPerSlot))
  }, [householdData.length, isQuarterHour])
  const socTurnAnnotations = useMemo(() => {
    if (slots.length < 3 || maxSocKwh <= 0) return [] as Array<{ key: string; time: string; y: number; label: string }>

    const epsilon = Math.max(maxSocKwh * 0.001, 0.01)
    const direction = (delta: number) => (delta > epsilon ? 1 : delta < -epsilon ? -1 : 0)
    const annotations: Array<{ key: string; time: string; y: number; label: string }> = []
    for (let index = 1; index < slots.length - 1; index += 1) {
      const prevDir = direction(slots[index].socKwhEnd - slots[index - 1].socKwhEnd)
      const nextDir = direction(slots[index + 1].socKwhEnd - slots[index].socKwhEnd)
      const hasTurn = prevDir !== nextDir && !(prevDir === 0 && nextDir === 0)
      if (!hasTurn) continue

      const percent = Math.round((slots[index].socKwhEnd / maxSocKwh) * 100)
      const point = batteryFlowData[index]
      if (!point) continue

      annotations.push({
        key: `soc-turn-${index}`,
        time: point.time,
        y: point.socBandKwh,
        label: `${percent}%`,
      })
    }

    return annotations
  }, [batteryFlowData, maxSocKwh, slots])
  const flowPills = useMemo(() => {
    let chargeKwh = 0
    let chargeWeightedCt = 0
    let dischargeKwh = 0
    let dischargeWeightedCt = 0
    let pvExportKwh = 0
    let pvExportWeightedCt = 0

    for (const slot of slots) {
      if (slot.chargeToBatteryKwh > 0) {
        chargeKwh += slot.chargeToBatteryKwh
        chargeWeightedCt += slot.chargeToBatteryKwh * slot[flowPriceDataKey]
      }

      const slotDischargeKwh = slot.batteryToLoadKwh + slot.batteryExportKwh
      if (slotDischargeKwh > 0) {
        dischargeKwh += slotDischargeKwh
        dischargeWeightedCt += slotDischargeKwh * slot[flowPriceDataKey]
      }

      if (slot.pvToGridKwh > 0) {
        pvExportKwh += slot.pvToGridKwh
        pvExportWeightedCt += slot.pvToGridKwh * slot.exportPriceCtKwh
      }
    }

    const chargeAvgCtKwh = chargeKwh > 0 ? chargeWeightedCt / chargeKwh : null
    const chargeTotalEur = chargeWeightedCt / 100
    const dischargeAvgCtKwh = dischargeKwh > 0 ? dischargeWeightedCt / dischargeKwh : null
    const pvExportAvgCtKwh = pvExportKwh > 0 ? pvExportWeightedCt / pvExportKwh : null

    return {
      charge: chargeAvgCtKwh === null
        ? null
        : {
            avgCtKwh: chargeAvgCtKwh,
            totalEur: chargeTotalEur,
          },
      discharge: dischargeAvgCtKwh === null
        ? null
        : {
            avgCtKwh: dischargeAvgCtKwh,
            totalEur: dischargeWeightedCt / 100,
          },
      pvExport: pvExportAvgCtKwh === null
        ? null
        : {
            avgCtKwh: pvExportAvgCtKwh,
            totalEur: pvExportWeightedCt / 100,
          },
    }
  }, [flowPriceDataKey, slots])
  const flowTopStats = useMemo(() => {
    let pvExportKwh = 0
    let pvExportWeightedCt = 0
    let batteryExportSpotKwh = 0
    let batteryExportSpotSavingsEur = 0
    let batteryExportPvKwh = 0
    let batteryExportPvSavingsEur = 0
    let chargeFromGridKwh = 0
    let chargeFromGridWeightedCt = 0
    let chargeFromPvKwh = 0
    let chargeFromPvWeightedCt = 0

    // Reference price for savings calculation depends on mode
    const referencePriceKey = priceCurveMode === 'end' ? 'householdImportPriceCtKwh' : 'spotPriceCtKwh'

    for (const slot of slots) {
      if (slot.pvToGridKwh > 0) {
        pvExportKwh += slot.pvToGridKwh
        pvExportWeightedCt += slot.pvToGridKwh * slot.exportPriceCtKwh
      }
      if (slot.batteryGridExportKwh > 0) {
        batteryExportSpotKwh += slot.batteryGridExportKwh
        // Calculate savings vs reference price
        const referencePrice = slot[referencePriceKey]
        const savingsEur = (slot.exportPriceCtKwh - referencePrice) * slot.batteryGridExportKwh / 100
        batteryExportSpotSavingsEur += savingsEur
      }
      if (slot.batteryPvExportKwh > 0) {
        batteryExportPvKwh += slot.batteryPvExportKwh
        // Calculate savings vs reference price
        const referencePrice = slot[referencePriceKey]
        const savingsEur = (slot.exportPriceCtKwh - referencePrice) * slot.batteryPvExportKwh / 100
        batteryExportPvSavingsEur += savingsEur
      }
      if (slot.gridToBatteryKwh > 0) {
        chargeFromGridKwh += slot.gridToBatteryKwh
        chargeFromGridWeightedCt += slot.gridToBatteryKwh * slot[referencePriceKey]
      }
      if (slot.pvToBatteryKwh > 0) {
        chargeFromPvKwh += slot.pvToBatteryKwh
        chargeFromPvWeightedCt += slot.pvToBatteryKwh * slot[referencePriceKey]
      }
    }

    return {
      pvExport: {
        kwh: pvExportKwh,
        avgCtKwh: pvExportKwh > 0 ? pvExportWeightedCt / pvExportKwh : null,
      },
      batteryExportSpot: {
        kwh: batteryExportSpotKwh,
        avgSavingCtKwh: batteryExportSpotKwh > 0 ? (batteryExportSpotSavingsEur * 100) / batteryExportSpotKwh : null,
      },
      batteryExportPv: {
        kwh: batteryExportPvKwh,
        avgSavingCtKwh: batteryExportPvKwh > 0 ? (batteryExportPvSavingsEur * 100) / batteryExportPvKwh : null,
      },
      chargeFromGrid: {
        kwh: chargeFromGridKwh,
        avgCtKwh: chargeFromGridKwh > 0 ? chargeFromGridWeightedCt / chargeFromGridKwh : null,
      },
      chargeFromPv: {
        kwh: chargeFromPvKwh,
        avgCtKwh: chargeFromPvKwh > 0 ? chargeFromPvWeightedCt / chargeFromPvKwh : null,
      },
    }
  }, [slots, priceCurveMode])
  const anchoredFlowPills = useMemo(() => {
    if (slots.length === 0) return []

    const toPercent = (index: number) => ((index + 0.5) / slots.length) * 100
    const clampPercent = (value: number) => Math.min(94, Math.max(6, value))
    const minGapPercent = 23
    const plotTopPx = flowChartLayout.marginTop
    const plotBottomPx = flowChartLayout.height - flowChartLayout.marginBottom
    const plotHeightPx = Math.max(1, plotBottomPx - plotTopPx)
    const priceDomainSpan = Math.max(1e-6, flowPriceAxis.domain[1] - flowPriceAxis.domain[0])
    const yMin = plotTopPx + 6
    const yMax = plotBottomPx - 22

    const weightedCenter = (
      predicate: (slot: PvBatterySlotResult) => boolean,
      weight: (slot: PvBatterySlotResult) => number,
    ) => {
      let weightedIndex = 0
      let totalWeight = 0

      slots.forEach((slot, index) => {
        if (!predicate(slot)) return
        const w = Math.max(weight(slot), 1e-6)
        weightedIndex += index * w
        totalWeight += w
      })

      if (totalWeight <= 0) return null
      return clampPercent(toPercent(weightedIndex / totalWeight))
    }
    const weightedPrice = (
      predicate: (slot: PvBatterySlotResult) => boolean,
      weight: (slot: PvBatterySlotResult) => number,
    ) => {
      let weightedPrice = 0
      let totalWeight = 0

      slots.forEach((slot) => {
        if (!predicate(slot)) return
        const w = Math.max(weight(slot), 1e-6)
        weightedPrice += slot[flowPriceDataKey] * w
        totalWeight += w
      })

      if (totalWeight <= 0) return null
      return weightedPrice / totalWeight
    }
    const toCurveYPx = (priceCtKwh: number) => {
      const ratio = (flowPriceAxis.domain[1] - priceCtKwh) / priceDomainSpan
      return plotTopPx + ratio * plotHeightPx
    }
    const clampYPx = (y: number) => Math.min(yMax, Math.max(yMin, y))

    const candidates: Array<{ id: 'charge' | 'discharge' | 'pvExport'; xPercent: number; curveYPx: number }> = []

    if (flowPills.charge) {
      const center = weightedCenter(
        (slot) => slot.chargeToBatteryKwh > 0,
        (slot) => slot.chargeToBatteryKwh,
      )
      const price = weightedPrice(
        (slot) => slot.chargeToBatteryKwh > 0,
        (slot) => slot.chargeToBatteryKwh,
      )
      if (center !== null && price !== null) candidates.push({ id: 'charge', xPercent: center, curveYPx: toCurveYPx(price) })
    }
    if (flowPills.discharge) {
      const center = weightedCenter(
        (slot) => (slot.batteryToLoadKwh + slot.batteryExportKwh) > 0,
        (slot) => slot.batteryToLoadKwh + slot.batteryExportKwh,
      )
      const price = weightedPrice(
        (slot) => (slot.batteryToLoadKwh + slot.batteryExportKwh) > 0,
        (slot) => slot.batteryToLoadKwh + slot.batteryExportKwh,
      )
      if (center !== null && price !== null) candidates.push({ id: 'discharge', xPercent: center, curveYPx: toCurveYPx(price) })
    }
    if (flowPills.pvExport) {
      const center = weightedCenter(
        (slot) => slot.pvToGridKwh > 0,
        (slot) => slot.pvToGridKwh,
      )
      const price = weightedPrice(
        (slot) => slot.pvToGridKwh > 0,
        (slot) => slot.pvToGridKwh,
      )
      if (center !== null && price !== null) candidates.push({ id: 'pvExport', xPercent: center, curveYPx: toCurveYPx(price) })
    }

    const placed: Array<{ id: 'charge' | 'discharge' | 'pvExport'; xPercent: number; yPx: number }> = []
    ;[...candidates]
      .sort((a, b) => a.xPercent - b.xPercent)
      .forEach((pill) => {
        const placeBelowCurve = pill.curveYPx < plotTopPx + plotHeightPx / 2
        const offsetDirection = placeBelowCurve ? 1 : -1
        let yPx = clampYPx(pill.curveYPx + (offsetDirection * 26))

        for (const other of placed) {
          const collidesX = Math.abs(pill.xPercent - other.xPercent) < minGapPercent
          const collidesY = Math.abs(yPx - other.yPx) < 24
          if (!collidesX || !collidesY) continue
          yPx = clampYPx(yPx + (offsetDirection * 24))
        }

        placed.push({ id: pill.id, xPercent: pill.xPercent, yPx })
      })
    return placed
  }, [flowChartLayout.height, flowChartLayout.marginBottom, flowChartLayout.marginTop, flowPills.charge, flowPills.discharge, flowPills.pvExport, flowPriceAxis.domain, flowPriceDataKey, slots])

  const maxHomeStackKwh = useMemo(
    () => Math.max(
      ...slots.map(
        (slot) =>
          slot.pvToLoadKwh +
          slot.batteryPvToLoadKwh +
          slot.batteryGridToLoadKwh +
          slot.gridToLoadKwh,
      ),
      0.1,
    ),
    [slots],
  )
  const minutesPerSlot = useMemo(() => Math.max(1, Math.round(60 / slotsPerHour)), [slotsPerHour])
  const homeAxis = useMemo(() => buildPositiveAxis(maxHomeStackKwh, 5), [maxHomeStackKwh])
  const demandBlockKwh = useMemo(() => {
    // Fixed tactile block sizing by visible resolution:
    // 60-min -> 0.100 kWh (100 Wh), 15-min -> 0.025 kWh (25 Wh)
    if (minutesPerSlot >= 60) return 0.1
    if (minutesPerSlot <= 15) return 0.025
    return Number((0.1 * (minutesPerSlot / 60)).toFixed(3))
  }, [minutesPerSlot])
  const toggleSeries = (key: HouseholdSeriesKey) => {
    setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleFlowLayer = (key: 'charge' | 'discharge' | 'pvExport') => {
    setVisibleFlowLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const syncSelectedIndex = useCallback((value: number | string | undefined | null) => {
    const nextIndex = typeof value === 'number' ? value : Number(value)
    if (!Number.isFinite(nextIndex)) return
    setSelectedIndex(Math.max(0, Math.min(slots.length - 1, nextIndex)))
  }, [setSelectedIndex, slots.length])

  if (loading || slots.length === 0 || !selectedSlot) {
    return (
      <Card className="rounded-[28px] border-gray-200 bg-white shadow-sm">
        <CardContent className="flex h-[420px] items-center justify-center p-8">
          <p className="text-sm text-gray-400">{loading ? 'Computing day profile…' : 'No complete day selected yet.'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      {controls ? <div>{controls}</div> : null}

      {/* Household consumption */}
      <Card className="overflow-hidden shadow-sm border-gray-200/80">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-7 sm:py-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,2.1fr)] lg:items-center">
              <div className="pt-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Household</p>
                <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Consumption Profile</p>
                <p className="mt-1 text-[13px] font-medium text-slate-500">{dayLabel}</p>
                <div className="mt-2 flex flex-wrap gap-2">
                  <span className="inline-flex items-center rounded-full border border-slate-200 bg-slate-50 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-slate-600">
                    Selected slot {selectedSlot.label}
                  </span>
                  {annualResult?.planningModel === 'rolling' ? (
                    <span className="inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-amber-800">
                      Produced by {selectedSlot.runLabel}
                    </span>
                  ) : (
                    <span className="inline-flex items-center rounded-full border border-slate-200 bg-white px-2.5 py-1 text-[10px] font-semibold tracking-[0.12em] text-slate-500">
                      One full-year deterministic run
                    </span>
                  )}
                </div>
              </div>
              <div className="min-w-0">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Total household load</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(daySummary.householdKwh)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">PV + Grid + Battery</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">PV to household</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(daySummary.pvKwh)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Grid to household</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(daySummary.gridKwh)}</p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Battery to household</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(daySummary.batteryToLoadKwh)}</p>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="pl-4 pr-2 pb-3 pt-3 sm:pl-5 sm:pr-3">
            <div className="mb-2 flex flex-wrap items-start gap-2 px-1 py-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => toggleSeries('demand')}
                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${visibleSeries.demand ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                  <span className="h-3 w-4 rounded-sm border border-slate-600/35 bg-slate-300/55" style={{ opacity: visibleSeries.demand ? 1 : 0.35 }} />
                  Total household
                </button>
                <button
                  type="button"
                  onClick={() => toggleSeries('pvLoad')}
                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${visibleSeries.pvLoad ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.pvDirect, opacity: visibleSeries.pvLoad ? 1 : 0.35 }} />
                  PV - load
                </button>
                <button
                  type="button"
                  onClick={() => toggleSeries('batteryLoad')}
                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${visibleSeries.batteryLoad ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.pvStored, opacity: visibleSeries.batteryLoad ? 1 : 0.35 }} />
                  Battery - load
                </button>
                <button
                  type="button"
                  onClick={() => toggleSeries('gridDirect')}
                  className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium transition-colors ${visibleSeries.gridDirect ? 'text-slate-600 hover:bg-slate-100' : 'text-slate-400 hover:bg-slate-50'}`}
                >
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.gridDirect, opacity: visibleSeries.gridDirect ? 1 : 0.35 }} />
                  Grid direct
                </button>
                <span className="ml-1 inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-500">
                  1 block = {formatBlockWh(demandBlockKwh)} Wh ({formatBlockKwh(demandBlockKwh)} kWh, {minutesPerSlot}-min view)
                </span>
              </div>
              {householdControls ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{householdControls}</div> : null}
            </div>
            <div className={cn(isQuarterHour ? 'overflow-x-auto' : '')}>
              <div
                className="relative h-[420px]"
                style={timelineMinWidthPx > 0 ? { minWidth: `${timelineMinWidthPx}px` } : undefined}
              >
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={householdData}
                    margin={{ top: 8, right: 26, bottom: 20, left: 10 }}
                    barCategoryGap={1}
                    barGap={0}
                    onMouseMove={(state) => syncSelectedIndex(state?.activeTooltipIndex)}
                    onClick={(state) => syncSelectedIndex(state?.activeTooltipIndex)}
                  >
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />

                  <XAxis
                    dataKey="idx"
                    type="number"
                    domain={xDomain}
                    ticks={xTicks}
                    tick={renderXTick as never}
                    tickLine={false}
                    axisLine={{ stroke: COLORS.textSoft }}
                    height={midnightIdxSet.size > 0 ? 46 : 30}
                    interval={0}
                    allowDecimals={false}
                  />

                  <YAxis
                    width={56}
                    domain={homeAxis.domain}
                    ticks={homeAxis.ticks}
                    tick={{ fontSize: 11, fill: COLORS.axis }}
                    tickLine={{ stroke: COLORS.textSoft }}
                    axisLine={{ stroke: COLORS.textSoft }}
                    tickFormatter={(value: number) => formatKwhAxisTick(value, homeAxis.step)}
                    label={{ value: 'kWh', angle: -90, position: 'insideLeft', fill: COLORS.axis, fontSize: 11 }}
                  />
                  <ReferenceLine x={effectiveSelectedIndex} stroke={COLORS.lineSpot} strokeOpacity={0.26} strokeDasharray="3 4" />

                  <Tooltip
                    contentStyle={{ borderRadius: 18, borderColor: COLORS.border, boxShadow: '0 12px 30px rgba(15,23,42,0.12)' }}
                    formatter={(value: number | string | undefined, name: string | undefined) => {
                      if (typeof value !== 'number') return [value ?? '—', name ?? 'Value']
                      if (name?.toLowerCase().includes('price')) return [`${value.toFixed(2)} ${units.priceUnit}`, name ?? 'Value']
                      return [`${value.toFixed(3)} kWh`, name ?? 'Value']
                    }}
                    labelFormatter={(value) => {
                      const index = typeof value === 'number' ? value : Number(value)
                      const slot = Number.isFinite(index) ? householdDataByIndex.get(index) : null
                      if (!slot) return dayLabel
                      const actions = [
                        slot.isGridChargingBattery ? 'Grid charge' : null,
                        slot.isBatteryDischarging ? 'Battery discharge' : null,
                      ].filter(Boolean).join(' · ')
                      const runLabel = annualResult?.planningModel === 'rolling' ? ` · ${slot.runLabel}` : ''
                      return `${dayLabel} · ${slot.label}${actions ? ` · ${actions}` : ''}${runLabel}`
                    }}
                  />

                  {visibleSeries.demand ? (
                    <Area
                      name="Household consumption"
                      type="monotone"
                      dataKey="totalDemandKwh"
                      stroke={COLORS.lineHousehold}
                      strokeOpacity={0.95}
                      strokeWidth={0}
                      fill={COLORS.borderStrong}
                      fillOpacity={0.09}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {/* Stacked pixel bars for household consumption composition */}
                  {visibleSeries.pvLoad ? (
                    <Bar
                      name="PV -> load"
                      dataKey="visiblePvToLoadKwh"
                      fill={COLORS.pvDirect}
                      minPointSize={2}
                      isAnimationActive={false}
                      stackId="consumption"
                      shape={(props) => <SegmentedBarShape {...props} blockKwh={demandBlockKwh} />}
                    />
                  ) : null}
                  {visibleSeries.batteryLoad ? (
                    <Bar
                      name="Battery -> load"
                      dataKey="visibleBatteryToLoadKwh"
                      fill={COLORS.pvStored}
                      minPointSize={2}
                      isAnimationActive={false}
                      stackId="consumption"
                      shape={(props) => <SegmentedBarShape {...props} blockKwh={demandBlockKwh} />}
                    />
                  ) : null}
                  {visibleSeries.gridDirect ? (
                    <Bar
                      name="Grid direct"
                      dataKey="visibleGridToLoadKwh"
                      fill={COLORS.gridDirect}
                      minPointSize={2}
                      isAnimationActive={false}
                      stackId="consumption"
                      shape={(props) => <SegmentedBarShape {...props} blockKwh={demandBlockKwh} />}
                    />
                  ) : null}
                  {visibleSeries.demand ? (
                    <Line
                      name="Household demand"
                      type="linear"
                      dataKey="totalDemandKwh"
                      stroke={COLORS.lineHousehold}
                      strokeOpacity={0.95}
                      strokeWidth={2.2}
                      dot={false}
                      isAnimationActive={false}
                    />
                  ) : null}

                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden shadow-sm border-gray-200/80">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-7 sm:py-5">
            <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(560px,2fr)_auto] lg:items-center">
              <div className="pt-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Asset Optimization</p>
                <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Asset Optimization</p>
                <p className="mt-1 text-[13px] font-medium text-slate-500">{dayLabel}</p>
              </div>
              <div className="min-w-0">
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-5">
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">PV export</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(flowTopStats.pvExport.kwh)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">
                      Avg {flowTopStats.pvExport.avgCtKwh === null ? '—' : `${flowTopStats.pvExport.avgCtKwh.toFixed(2)} ${units.priceUnit}`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Battery export (Spot)</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(flowTopStats.batteryExportSpot.kwh)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">
                      Avg saving {flowTopStats.batteryExportSpot.avgSavingCtKwh === null ? '—' : `${flowTopStats.batteryExportSpot.avgSavingCtKwh.toFixed(2)} ${units.priceUnit}`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Battery export (PV)</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(flowTopStats.batteryExportPv.kwh)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">
                      Avg saving {flowTopStats.batteryExportPv.avgSavingCtKwh === null ? '—' : `${flowTopStats.batteryExportPv.avgSavingCtKwh.toFixed(2)} ${units.priceUnit}`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Charge from grid</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(flowTopStats.chargeFromGrid.kwh)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">
                      Avg {flowTopStats.chargeFromGrid.avgCtKwh === null ? '—' : `${flowTopStats.chargeFromGrid.avgCtKwh.toFixed(2)} ${units.priceUnit}`}
                    </p>
                  </div>
                  <div className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">Charge from own PV</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{formatDayKwh(flowTopStats.chargeFromPv.kwh)}</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">
                      Avg {flowTopStats.chargeFromPv.avgCtKwh === null ? '—' : `${flowTopStats.chargeFromPv.avgCtKwh.toFixed(2)} ${units.priceUnit}`}
                    </p>
                  </div>
                </div>
              </div>
              <div />
            </div>
          </div>

          <div className="px-4 pb-3 pt-3 sm:px-5">
            <div className="mb-2 flex flex-wrap items-start gap-2 px-1 py-1">
              <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.gridStored }} />
                  Charge from price (grid)
                </span>
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.pvCharge }} />
                  Charge from excess PV
                </span>
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.pvStored }} />
                  Discharge to household
                </span>
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.export }} />
                  Discharge to price (export)
                </span>
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.curtailed }} />
                  Sell excess PV (direct)
                </span>
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-2 w-2 rounded-sm" style={{ backgroundColor: COLORS.bandSoc }} />
                  SoC presence band
                </span>
                <span className="inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] font-medium text-slate-600">
                  <span className="h-3 w-4 border-b-2" style={{ borderColor: COLORS.lineSpot }} />
                  {flowPriceLegendLabel}
                </span>
              </div>
              {priceControls ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{priceControls}</div> : null}
            </div>
            <div className={cn(isQuarterHour ? 'overflow-x-auto' : '')}>
              <div
                className="relative h-[420px]"
                style={timelineMinWidthPx > 0 ? { minWidth: `${timelineMinWidthPx}px` } : undefined}
              >
                {anchoredFlowPills.map((pill) => {
                  if (pill.id === 'charge' && flowPills.charge) {
                    return (
                      <button
                        type="button"
                        key={pill.id}
                        onClick={() => toggleFlowLayer('charge')}
                        className="absolute z-20 -translate-x-1/2"
                        aria-pressed={visibleFlowLayers.charge}
                        title={`${visibleFlowLayers.charge ? 'Hide' : 'Show'} charge layers`}
                        style={{ left: `${pill.xPercent}%`, top: `${pill.yPx}px` }}
                      >
                        <div className={cn(
                          'backdrop-blur-sm border rounded-full px-2 py-0.5 shadow-sm flex items-center gap-1 text-[10px] whitespace-nowrap transition-colors',
                          visibleFlowLayers.charge
                            ? 'bg-blue-50/80 border-blue-300/50 text-blue-800'
                            : 'bg-slate-100/95 border-slate-300/70 text-slate-500',
                        )}>
                          <BatteryCharging className="h-3 w-3 text-blue-700" />
                          <span className="font-semibold">Charge</span>
                          <span className="font-bold tabular-nums">
                            Avg {flowPills.charge.avgCtKwh.toFixed(2)} {units.priceUnit}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums font-semibold">
                            Total {units.currencySym}{flowPills.charge.totalEur.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    )
                  }

                  if (pill.id === 'discharge' && flowPills.discharge) {
                    return (
                      <button
                        type="button"
                        key={pill.id}
                        onClick={() => toggleFlowLayer('discharge')}
                        className="absolute z-20 -translate-x-1/2"
                        aria-pressed={visibleFlowLayers.discharge}
                        title={`${visibleFlowLayers.discharge ? 'Hide' : 'Show'} discharge layers`}
                        style={{ left: `${pill.xPercent}%`, top: `${pill.yPx}px` }}
                      >
                        <div className={cn(
                          'backdrop-blur-sm border rounded-full px-2 py-0.5 shadow-sm flex items-center gap-1 text-[10px] whitespace-nowrap transition-colors',
                          visibleFlowLayers.discharge
                            ? 'bg-amber-50/80 border-amber-300/50 text-amber-800'
                            : 'bg-slate-100/95 border-slate-300/70 text-slate-500',
                        )}>
                          <Battery className="h-3 w-3 text-amber-700" />
                          <span className="font-semibold">Discharge</span>
                          <span className="font-bold tabular-nums">
                            Avg {flowPills.discharge.avgCtKwh.toFixed(2)} {units.priceUnit}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums font-semibold">
                            Total {units.currencySym}{flowPills.discharge.totalEur.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    )
                  }

                  if (pill.id === 'pvExport' && flowPills.pvExport) {
                    return (
                      <button
                        type="button"
                        key={pill.id}
                        onClick={() => toggleFlowLayer('pvExport')}
                        className="absolute z-20 -translate-x-1/2"
                        aria-pressed={visibleFlowLayers.pvExport}
                        title={`${visibleFlowLayers.pvExport ? 'Hide' : 'Show'} PV export layers`}
                        style={{ left: `${pill.xPercent}%`, top: `${pill.yPx}px` }}
                      >
                        <div className={cn(
                          'backdrop-blur-sm border rounded-full px-2 py-0.5 shadow-sm flex items-center gap-1 text-[10px] whitespace-nowrap transition-colors',
                          visibleFlowLayers.pvExport
                            ? 'bg-yellow-50/85 border-yellow-300/50 text-yellow-800'
                            : 'bg-slate-100/95 border-slate-300/70 text-slate-500',
                        )}>
                          <SunMedium className="h-3 w-3 text-yellow-700" />
                          <span className="font-semibold">PV Export</span>
                          <span className="font-bold tabular-nums">
                            Avg {flowPills.pvExport.avgCtKwh.toFixed(2)} {units.priceUnit}
                          </span>
                          <span>·</span>
                          <span className="tabular-nums font-semibold">
                            Total {units.currencySym}{flowPills.pvExport.totalEur.toFixed(2)}
                          </span>
                        </div>
                      </button>
                    )
                  }

                  return null
                })}
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart
                    data={batteryFlowData}
                    margin={{ top: flowChartLayout.marginTop, right: 8, bottom: flowChartLayout.marginBottom, left: 6 }}
                    barCategoryGap={1}
                    barGap={0}
                    onMouseMove={(state) => syncSelectedIndex(state?.activeTooltipIndex)}
                    onClick={(state) => syncSelectedIndex(state?.activeTooltipIndex)}
                  >
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" />

                  <XAxis
                    dataKey="idx"
                    type="number"
                    domain={xDomain}
                    ticks={xTicks}
                    tick={renderXTick as never}
                    tickLine={false}
                    axisLine={{ stroke: COLORS.textSoft }}
                    height={midnightIdxSet.size > 0 ? 46 : 30}
                    interval={0}
                    allowDecimals={false}
                  />

                  <YAxis
                    yAxisId="flow"
                    orientation="left"
                    width={56}
                    domain={flowAxis.domain}
                    ticks={flowAxis.ticks}
                    tick={{ fontSize: 11, fill: COLORS.axis }}
                    tickLine={{ stroke: COLORS.textSoft }}
                    axisLine={{ stroke: COLORS.textSoft }}
                    tickFormatter={(value: number) => formatKwhAxisTick(value, flowAxis.step)}
                    label={{ value: 'kWh', angle: -90, position: 'insideLeft', fill: COLORS.axis, fontSize: 11 }}
                  />
                  <YAxis
                    yAxisId="price"
                    orientation="right"
                    domain={flowPriceAxis.domain}
                    ticks={flowPriceAxis.ticks}
                    width={62}
                    tick={{ fontSize: 10, fill: COLORS.axis }}
                    tickLine={{ stroke: COLORS.textSoft }}
                    axisLine={{ stroke: COLORS.textSoft }}
                    tickFormatter={(value: number) => `${value.toFixed(0)} ${units.priceSym}`}
                    label={{ value: units.priceUnit, angle: 90, position: 'insideRight', fill: COLORS.axis, fontSize: 10 }}
                  />
                  <ReferenceLine yAxisId="flow" y={0} stroke={COLORS.textSoft} strokeDasharray="3 3" />
                  <ReferenceLine x={effectiveSelectedIndex} stroke={COLORS.lineSpot} strokeOpacity={0.26} strokeDasharray="3 4" />

                  <Tooltip
                    contentStyle={{ borderRadius: 18, borderColor: COLORS.border, boxShadow: '0 12px 30px rgba(15,23,42,0.12)' }}
                    formatter={(value: number | string | undefined, name: string | undefined) => {
                      if (typeof value !== 'number') return [value ?? '—', name ?? 'Value']
                      if (name?.toLowerCase().includes('spot price')) return [`${value.toFixed(2)} ${units.priceUnit}`, name ?? 'Value']
                      return [`${Math.abs(value).toFixed(3)} kWh`, name ?? 'Value']
                    }}
                    labelFormatter={(value) => {
                      const index = typeof value === 'number' ? value : Number(value)
                      const slot = Number.isFinite(index) ? batteryFlowDataByIndex.get(index) : null
                      if (!slot) return dayLabel
                      const runLabel = annualResult?.planningModel === 'rolling' ? ` · ${slot.runLabel}` : ''
                      return `${dayLabel} · ${slot.label}${runLabel}`
                    }}
                  />

                  <Area
                    yAxisId="flow"
                    type="monotone"
                    dataKey="socBandKwh"
                    stroke="none"
                    fill={COLORS.bandSoc}
                    fillOpacity={0.32}
                    isAnimationActive={false}
                    tooltipType="none"
                  />
                  {socTurnAnnotations.map((annotation) => (
                    <ReferenceDot
                      key={annotation.key}
                      yAxisId="flow"
                      x={annotation.time}
                      y={annotation.y}
                      r={0}
                      ifOverflow="hidden"
                      label={{
                        value: annotation.label,
                        position: 'inside',
                        fill: COLORS.pvStored,
                        fontSize: 10,
                        fontWeight: 500,
                        opacity: 0.22,
                      }}
                    />
                  ))}

                  {visibleFlowLayers.charge ? (
                    <Bar
                      yAxisId="flow"
                      name="Charge from price (grid)"
                      dataKey="chargeFromPriceKwh"
                      fill={COLORS.gridStored}
                      isAnimationActive={false}
                      stackId="flow"
                    />
                  ) : null}
                  {visibleFlowLayers.charge ? (
                    <Bar
                      yAxisId="flow"
                      name="Charge from excess PV"
                      dataKey="chargeFromExcessPvKwh"
                      fill={COLORS.pvCharge}
                      isAnimationActive={false}
                      stackId="flow"
                    />
                  ) : null}
                  {visibleFlowLayers.discharge ? (
                    <Bar
                      yAxisId="flow"
                      name="Discharge to household"
                      dataKey="dischargeToHouseholdKwh"
                      fill={COLORS.pvStored}
                      isAnimationActive={false}
                      stackId="flow"
                    />
                  ) : null}
                  {visibleFlowLayers.discharge ? (
                    <Bar
                      yAxisId="flow"
                      name="Discharge to price (export)"
                      dataKey="dischargeToPriceKwh"
                      fill={COLORS.export}
                      isAnimationActive={false}
                      stackId="flow"
                    />
                  ) : null}
                  {visibleFlowLayers.pvExport ? (
                    <Bar
                      yAxisId="flow"
                      name="Sell excess PV (direct)"
                      dataKey="sellExcessPvKwh"
                      fill={COLORS.curtailed}
                      isAnimationActive={false}
                      stackId="flow"
                    />
                  ) : null}

                  <Line
                    yAxisId="price"
                    name={flowPriceSeriesName}
                    type="monotone"
                    dataKey={flowPriceDataKey}
                    stroke={COLORS.lineSpot}
                    strokeWidth={2.2}
                    dot={false}
                    isAnimationActive={false}
                  />
                  {visibleFlowLayers.charge ? (
                    <Line
                      yAxisId="price"
                      name="Battery charge"
                      type="monotone"
                      dataKey="chargeMarkerPrice"
                      stroke={COLORS.markerCharge}
                      strokeWidth={isQuarterHour ? 2 : 3}
                      dot={isQuarterHour
                        ? { r: 2, fill: COLORS.markerCharge, stroke: '#fff', strokeWidth: 1 }
                        : { r: 3.5, fill: COLORS.markerCharge, stroke: '#fff', strokeWidth: 1.5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {visibleFlowLayers.discharge ? (
                    <Line
                      yAxisId="price"
                      name="Battery discharge"
                      type="monotone"
                      dataKey="dischargeMarkerPrice"
                      stroke={COLORS.markerDischarge}
                      strokeWidth={isQuarterHour ? 2 : 3}
                      dot={isQuarterHour
                        ? { r: 2, fill: COLORS.markerDischarge, stroke: '#fff', strokeWidth: 1 }
                        : { r: 3.5, fill: COLORS.markerDischarge, stroke: '#fff', strokeWidth: 1.5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  {visibleFlowLayers.pvExport ? (
                    <Line
                      yAxisId="price"
                      name="PV export on price"
                      type="monotone"
                      dataKey="pvExportMarkerPrice"
                      stroke={COLORS.markerPvExport}
                      strokeWidth={isQuarterHour ? 2 : 3}
                      dot={isQuarterHour
                        ? { r: 2, fill: COLORS.markerPvExport, stroke: '#fff', strokeWidth: 1 }
                        : { r: 3.5, fill: COLORS.markerPvExport, stroke: '#fff', strokeWidth: 1.5 }}
                      connectNulls={false}
                      isAnimationActive={false}
                    />
                  ) : null}
                  </ComposedChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-7 sm:py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Run provenance</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Visible timeline segments</p>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              {annualResult?.planningModel === 'rolling'
                ? 'Every selected slot points back to the run that produced it.'
                : 'The deterministic model still shows a single replay run so you can compare the stitched planner against one annual baseline.'}
            </p>
          </div>
          <div className="grid gap-3 px-4 py-4 sm:px-5 lg:grid-cols-2">
            {visibleRunSegments.map((segment) => {
              const isSelectedRun = selectedRun?.runId === segment.runId
              return (
                <div
                  key={segment.runId}
                  className={cn(
                    'rounded-2xl border px-4 py-4 transition-colors',
                    isSelectedRun ? 'border-amber-300 bg-amber-50/80' : 'border-gray-200 bg-[#FBFAF6]',
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-[13px] font-semibold tracking-tight text-slate-900">{segment.runLabel}</p>
                    <span className={cn(
                      'rounded-full px-2 py-1 text-[10px] font-semibold tracking-[0.12em]',
                      isSelectedRun ? 'bg-amber-200/70 text-amber-900' : 'bg-white text-slate-500',
                    )}>
                      {isSelectedRun ? 'Selected slot run' : `${segment.lastIndex - segment.firstIndex + 1} visible slots`}
                    </span>
                  </div>

                  <div className="mt-3 grid gap-2 text-[11px] leading-5 text-slate-600">
                    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2">
                      <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Visible chain</span>
                      <span>{segment.firstSlot.date} {segment.firstSlot.label} {'->'} {segment.lastSlot.date} {segment.lastSlot.label}</span>
                    </div>
                    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2">
                      <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Known horizon</span>
                      <span>Until {formatTimestampLabel(segment.knownHorizonEnd)}</span>
                    </div>
                    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2">
                      <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Committed until</span>
                      <span>{formatTimestampLabel(segment.committedUntil)}</span>
                    </div>
                    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2">
                      <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Starting SoC</span>
                      <span>{segment.initialSocKwh.toFixed(1)} kWh</span>
                    </div>
                    <div className="grid grid-cols-[108px_minmax(0,1fr)] gap-2">
                      <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Terminal rule</span>
                      <span>{segment.terminalRule}</span>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-7 sm:py-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Quarter-hour inspector</p>
                <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Selected slot {selectedSlot.label}</p>
                <p className="mt-1 text-[13px] font-medium text-slate-500">
                  {selectedSlot.date} · {annualResult?.planningModel === 'rolling' ? selectedSlot.runLabel : 'Deterministic replay'}
                </p>
              </div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Slot economics</p>
                <p className="mt-1 text-[22px] font-semibold tracking-tight text-slate-900">
                  {formatMoney(-selectedSlot.slotNetCostEur, units)}
                </p>
                <p className="mt-1 text-[11px] leading-5 text-slate-500">
                  Import {formatMoney(selectedSlot.slotImportCostEur, units)} · Export {formatMoney(selectedSlot.slotExportRevenueEur, units)}
                </p>
              </div>
            </div>
          </div>

          <div className="grid gap-4 px-4 py-4 sm:px-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(300px,0.85fr)]">
            <div className="space-y-4">
              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                {[
                  { label: 'Load forecast', value: formatMetricKwh(selectedSlot.loadForecastKwh) },
                  { label: 'PV forecast', value: formatMetricKwh(selectedSlot.pvForecastKwh) },
                  { label: 'SoC', value: `${selectedSlot.socKwhStart.toFixed(2)} -> ${selectedSlot.socKwhEnd.toFixed(2)} kWh` },
                  { label: 'Import tariff', value: `${selectedSlot.importPriceCtKwh.toFixed(2)} ${units.priceUnit}` },
                  { label: 'Export value', value: `${selectedSlot.exportPriceCtKwh.toFixed(2)} ${units.priceUnit}` },
                  { label: 'Household price view', value: `${selectedSlot.householdImportPriceCtKwh.toFixed(2)} ${units.priceUnit}` },
                ].map((metric) => (
                  <div key={metric.label} className="rounded-xl border border-gray-200 bg-[#FBFAF6] px-3 py-3">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{metric.label}</p>
                    <p className="mt-1 text-[13px] font-semibold text-slate-900">{metric.value}</p>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white p-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Routing flows in this slot</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    { label: 'PV -> load', value: selectedSlot.pvToLoadKwh },
                    { label: 'PV -> battery', value: selectedSlot.pvToBatteryKwh },
                    { label: 'PV -> grid', value: selectedSlot.pvToGridKwh },
                    { label: 'Grid -> battery', value: selectedSlot.gridToBatteryKwh },
                    { label: 'Grid -> load', value: selectedSlot.gridToLoadKwh },
                    { label: 'Battery -> load', value: selectedSlot.batteryToLoadKwh },
                    { label: 'Battery -> grid', value: selectedSlot.batteryExportKwh },
                    { label: 'Curtailment', value: selectedSlot.curtailedKwh },
                    { label: 'Direct self-use', value: selectedSlot.directSelfKwh },
                  ].map((flow) => (
                    <div key={flow.label} className="rounded-xl border border-[#EEE8D8] bg-[#FCF8ED] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#82755F]">{flow.label}</p>
                      <p className="mt-1 text-[13px] font-semibold tabular-nums text-slate-900">{formatMetricKwh(flow.value)}</p>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-amber-200 bg-amber-50/70 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">Why this happened</p>
                <div className="mt-3 space-y-2">
                  {slotWhyLines.map((line, index) => (
                    <p key={index} className="text-[12px] leading-6 text-amber-950/80">
                      {line}
                    </p>
                  ))}
                </div>
              </div>
            </div>

            <div className="space-y-4">
              <div className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Selected slot provenance</p>
                <div className="mt-3 space-y-2 text-[11px] leading-5 text-slate-600">
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Run</span>
                    <span>{selectedSlot.runLabel}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Known horizon</span>
                    <span>Until {formatTimestampLabel(selectedSlot.knownHorizonEnd)}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Committed until</span>
                    <span>{formatTimestampLabel(selectedSlot.committedUntil)}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Run start SoC</span>
                    <span>{selectedSlot.runInitialSocKwh.toFixed(1)} kWh</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Terminal rule</span>
                    <span>{selectedSlot.terminalRule}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Load source</span>
                    <span>{selectedSlot.loadForecastSource}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">PV source</span>
                    <span>{selectedSlot.pvForecastSource}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Price source</span>
                    <span>{selectedSlot.priceSource}</span>
                  </div>
                  <div className="grid grid-cols-[112px_minmax(0,1fr)] gap-2">
                    <span className="font-semibold uppercase tracking-[0.12em] text-slate-400">Tariff basis</span>
                    <span>{selectedSlot.tariffBasis}</span>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-gray-200 bg-white px-4 py-4">
                <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-500">Battery discharge split</p>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {[
                    { label: 'PV -> battery -> load', value: selectedSlot.batteryPvToLoadKwh },
                    { label: 'Grid -> battery -> load', value: selectedSlot.batteryGridToLoadKwh },
                    { label: 'PV -> battery -> grid', value: selectedSlot.batteryPvExportKwh },
                    { label: 'Grid -> battery -> grid', value: selectedSlot.batteryGridExportKwh },
                  ].map((row) => (
                    <div key={row.label} className="rounded-xl border border-gray-200 bg-[#FAFBFC] px-3 py-2.5">
                      <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">{row.label}</p>
                      <p className="mt-1 text-[13px] font-semibold tabular-nums text-slate-900">{formatMetricKwh(row.value)}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-4 sm:px-7 sm:py-5">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Audit trail</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Per-slot reconstruction table</p>
            <p className="mt-1 text-[13px] font-medium text-slate-500">
              Click any row to sync the inspector and both charts to that quarter-hour.
            </p>
          </div>

          <div className="overflow-x-auto px-4 py-4 sm:px-5">
            <table className="min-w-[1480px] border-separate border-spacing-0 text-left text-[11px]">
              <thead>
                <tr>
                  {[
                    'Time',
                    'Run',
                    'SoC start',
                    'SoC end',
                    'Load fcst',
                    'PV fcst',
                    `Import ${units.priceSym}`,
                    `Export ${units.priceSym}`,
                    'PV->Load',
                    'PV->Batt',
                    'Grid->Batt',
                    'Batt->Load',
                    'Batt->Grid',
                    'Grid->Load',
                    'PV->Grid',
                    'Curtail',
                    `Import ${units.currencySym}`,
                    `Export ${units.currencySym}`,
                    `Net ${units.currencySym}`,
                  ].map((label) => (
                    <th key={label} className="sticky top-0 border-b border-slate-200 bg-[#F8FAFC] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-slate-500">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {slots.map((slot, index) => {
                  const active = index === effectiveSelectedIndex
                  return (
                    <tr
                      key={`${slot.timestamp}-${slot.runId}`}
                      onClick={() => setSelectedIndex(index)}
                      className={cn(
                        'cursor-pointer transition-colors',
                        active ? 'bg-amber-50/80' : 'hover:bg-slate-50',
                      )}
                    >
                      <td className="border-b border-slate-100 px-3 py-2 font-semibold text-slate-800">{slot.date} {slot.label}</td>
                      <td className="border-b border-slate-100 px-3 py-2 text-slate-600">{slot.runLabel}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.socKwhStart.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.socKwhEnd.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.loadForecastKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.pvForecastKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.importPriceCtKwh.toFixed(2)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.exportPriceCtKwh.toFixed(2)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.pvToLoadKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.pvToBatteryKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.gridToBatteryKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.batteryToLoadKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.batteryExportKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.gridToLoadKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.pvToGridKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.curtailedKwh.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.slotImportCostEur.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-700">{slot.slotExportRevenueEur.toFixed(3)}</td>
                      <td className="border-b border-slate-100 px-3 py-2 tabular-nums text-slate-900">{slot.slotNetCostEur.toFixed(3)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {savingsCard ? (
        <Card className="overflow-hidden shadow-sm border-gray-200/80">
          <CardContent className="p-0">
            <div className="px-6 py-5 sm:px-7">
              <div className="mb-5 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Savings</p>
                  <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Selected Day Replay</p>
                </div>
                <p className="text-[12px] text-slate-400 tabular-nums">
                  {savingsCard.selectedDay.sessionKwh.toFixed(1)} kWh/session
                </p>
              </div>

              <div className="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,0.5fr)]">
                <div className="rounded-lg border border-emerald-300/70 bg-emerald-100/85 px-5 py-4 shadow-sm ring-1 ring-emerald-200/60">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-[0.16em] mb-1.5">Savings on selected day</p>
                  <span className="text-[64px] leading-none font-extrabold tabular-nums text-emerald-700">
                    {savingsCard.selectedDay.savingsCtKwh.toFixed(2)}
                  </span>
                  <span className="text-[40px] font-semibold text-slate-500 ml-2">{units.priceUnit}</span>
                  <span className="text-[40px] font-medium text-slate-500 ml-2">cheaper</span>
                  <p className="text-[40px] mt-2 text-emerald-700/80">
                    = {(savingsCard.selectedDay.savingsEur * 100).toFixed(1)} {units.priceSym} saved on {savingsCard.selectedDay.sessionKwh.toFixed(1)} kWh session
                  </p>
                </div>

                <div className="rounded-lg border border-gray-200 bg-gray-50/80 px-3 py-3">
                  <p className="text-[10px] font-semibold text-gray-500 uppercase tracking-[0.16em]">Market spread</p>
                  <p className="mt-1 text-[48px] font-bold tabular-nums leading-none text-slate-800">
                    {savingsCard.selectedDay.marketSpreadCtKwh.toFixed(2)}
                    <span className="text-[32px] font-medium text-slate-400 ml-2">{units.priceSym}</span>
                  </p>
                  <p className="mt-2 text-[12px] text-gray-500">
                    {savingsCard.selectedDay.cheapestHour} ↔ {savingsCard.selectedDay.expensiveHour}
                  </p>
                </div>
              </div>

              <div className="mt-5 border-t border-gray-100 pt-4">
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-[10px] font-semibold text-gray-500 uppercase tracking-[0.16em]">Historical savings with same settings</span>
                  <span className="text-[12px] text-slate-400 tabular-nums">
                    {savingsCard.selectedDay.sessionKwh.toFixed(1)} kWh/session
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3">
                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                    <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-[0.14em]">Last 4 weeks average</p>
                    <p className="text-[44px] font-extrabold tabular-nums leading-none text-emerald-700">
                      {savingsCard.historical.last4WeeksAvgCtKwh.toFixed(2)}
                      <span className="text-[28px] font-medium text-slate-400 ml-2">{units.priceUnit}</span>
                    </p>
                    <p className="text-[32px] mt-1 text-gray-500 leading-relaxed">
                      {savingsCard.historical.last4WeeksTotalEur.toFixed(2)} {units.currency} total
                    </p>
                  </div>

                  <div className="rounded-lg border border-emerald-100 bg-emerald-50/70 px-4 py-3">
                    <p className="text-[9px] font-semibold text-gray-500 uppercase tracking-[0.14em]">Last 52 weeks average</p>
                    <p className="text-[44px] font-extrabold tabular-nums leading-none text-emerald-700">
                      {savingsCard.historical.last52WeeksAvgCtKwh.toFixed(2)}
                      <span className="text-[28px] font-medium text-slate-400 ml-2">{units.priceUnit}</span>
                    </p>
                    <p className="text-[32px] mt-1 text-gray-500 leading-relaxed">
                      {Math.round(savingsCard.historical.last52WeeksAnnualEur)} {units.currency}/yr
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

    </div>
  )
}
