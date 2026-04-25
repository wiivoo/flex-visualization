'use client'

import { useMemo, useState, type ReactNode } from 'react'
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

function formatHourTick(label: string) {
  return label.slice(0, 5)
}

function formatDayKwh(value: number): string {
  return `${value.toFixed(2)} kWh`
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
  const stackedValue = Array.isArray(value) ? Math.abs((value[1] ?? 0) - (value[0] ?? 0)) : null
  const dataKeyValue = dataKey && payload ? Number(payload[dataKey]) : null
  const numericValue = typeof value === 'number'
    ? value
    : stackedValue ?? (dataKeyValue !== null && Number.isFinite(dataKeyValue) ? dataKeyValue : Number(value))
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
  const [selectedIndex, setSelectedIndex] = useState(0)
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
  const hourTicks = useMemo(() => buildHourTicks(householdData.length), [householdData.length])
  const householdIndexByTime = useMemo(
    () => new Map(householdData.map((point) => [point.time, point.idx])),
    [householdData],
  )
  const householdTickTimes = useMemo(
    () => hourTicks.map((tick) => householdData[tick]?.time).filter((tick): tick is string => Boolean(tick)),
    [hourTicks, householdData],
  )
  const homeMajorHourStep = 2

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
    let dischargeSavingsEur = 0
    let pvExportKwh = 0
    let pvExportWeightedCt = 0

    for (const slot of slots) {
      if (slot.chargeToBatteryKwh > 0) {
        chargeKwh += slot.chargeToBatteryKwh
        chargeWeightedCt += slot.chargeToBatteryKwh * slot.spotPriceCtKwh
      }

      const slotDischargeKwh = slot.batteryToLoadKwh + slot.batteryExportKwh
      if (slotDischargeKwh > 0) {
        dischargeKwh += slotDischargeKwh
        dischargeWeightedCt += slotDischargeKwh * slot.spotPriceCtKwh
        dischargeSavingsEur += slot.batteryDischargeSavingsEur
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
            totalEur: dischargeSavingsEur,
          },
      pvExport: pvExportAvgCtKwh === null
        ? null
        : {
            avgCtKwh: pvExportAvgCtKwh,
            totalEur: pvExportWeightedCt / 100,
          },
    }
  }, [slots])
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
  const homeAxis = useMemo(() => buildPositiveAxis(maxHomeStackKwh, 5), [maxHomeStackKwh])
  const demandBlockKwh = useMemo(() => Math.max(0.02, homeAxis.step / 8), [homeAxis.step])
  const toggleSeries = (key: HouseholdSeriesKey) => {
    setVisibleSeries((prev) => ({ ...prev, [key]: !prev[key] }))
  }
  const toggleFlowLayer = (key: 'charge' | 'discharge' | 'pvExport') => {
    setVisibleFlowLayers((prev) => ({ ...prev, [key]: !prev[key] }))
  }

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
            <div className="grid gap-4 lg:grid-cols-[minmax(240px,1fr)_minmax(560px,2fr)_auto] lg:items-center">
              <div className="pt-0.5">
                <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Household</p>
                <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Consumption Profile</p>
                <p className="mt-1 text-[13px] font-medium text-slate-500">{dayLabel}</p>
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
              <div />
            </div>
          </div>

          <div className="px-4 pb-3 pt-3 sm:px-5">
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
              </div>
              {householdControls ? <div className="ml-auto flex shrink-0 flex-wrap items-center gap-2">{householdControls}</div> : null}
            </div>
            <div className="relative h-[420px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={householdData} margin={{ top: 8, right: 26, bottom: 20, left: 10 }} barCategoryGap={1} barGap={0}>
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={true} />

                  <XAxis
                    dataKey="time"
                    type="category"
                    ticks={householdTickTimes}
                    tickFormatter={(value) => {
                      const index = householdIndexByTime.get(String(value))
                      if (index === undefined) return ''
                      return index === 0 || index === householdData.length - 1 || index % (slotsPerHour * homeMajorHourStep) === 0
                        ? formatHourTick(String(value))
                        : ''
                    }}
                    tick={{ fontSize: 11, fill: COLORS.axisStrong }}
                    tickLine={{ stroke: COLORS.textSoft }}
                    axisLine={{ stroke: COLORS.textSoft }}
                    height={40}
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
                  {!selectedSlot.label.endsWith('00:00') ? (
                    <ReferenceLine x={selectedSlot.label} stroke={COLORS.lineSpot} strokeOpacity={0.26} strokeDasharray="3 4" />
                  ) : null}

                  <Tooltip
                    contentStyle={{ borderRadius: 18, borderColor: COLORS.border, boxShadow: '0 12px 30px rgba(15,23,42,0.12)' }}
                    formatter={(value: number | string | undefined, name: string | undefined) => {
                      if (typeof value !== 'number') return [value ?? '—', name ?? 'Value']
                      if (name?.toLowerCase().includes('price')) return [`${value.toFixed(2)} ${units.priceUnit}`, name ?? 'Value']
                      return [`${value.toFixed(3)} kWh`, name ?? 'Value']
                    }}
                    labelFormatter={(value) => {
                      const index = householdIndexByTime.get(String(value))
                      const slot = index === undefined ? null : householdData[index]
                      if (!slot) return dayLabel
                      const actions = [
                        slot.isGridChargingBattery ? 'Grid charge' : null,
                        slot.isBatteryDischarging ? 'Battery discharge' : null,
                      ].filter(Boolean).join(' · ')
                      return `${dayLabel} · ${slot.label}${actions ? ` · ${actions}` : ''}`
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
            <div className="relative h-[420px]">
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
                  margin={{ top: flowChartLayout.marginTop, right: 18, bottom: flowChartLayout.marginBottom, left: 10 }}
                  barCategoryGap={1}
                  barGap={0}
                >
                  <CartesianGrid stroke={COLORS.border} strokeDasharray="3 3" vertical={true} />

                  <XAxis
                    dataKey="time"
                    type="category"
                    ticks={householdTickTimes}
                    tickFormatter={(value) => {
                      const index = householdIndexByTime.get(String(value))
                      if (index === undefined) return ''
                      return index === 0 || index === householdData.length - 1 || index % (slotsPerHour * homeMajorHourStep) === 0
                        ? formatHourTick(String(value))
                        : ''
                    }}
                    tick={{ fontSize: 11, fill: COLORS.axisStrong }}
                    tickLine={{ stroke: COLORS.textSoft }}
                    axisLine={{ stroke: COLORS.textSoft }}
                    height={40}
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

                  <Tooltip
                    contentStyle={{ borderRadius: 18, borderColor: COLORS.border, boxShadow: '0 12px 30px rgba(15,23,42,0.12)' }}
                    formatter={(value: number | string | undefined, name: string | undefined) => {
                      if (typeof value !== 'number') return [value ?? '—', name ?? 'Value']
                      if (name?.toLowerCase().includes('spot price')) return [`${value.toFixed(2)} ${units.priceUnit}`, name ?? 'Value']
                      return [`${Math.abs(value).toFixed(3)} kWh`, name ?? 'Value']
                    }}
                    labelFormatter={(value) => `${dayLabel} · ${String(value)}`}
                  />

                  <Area
                    yAxisId="flow"
                    type="monotone"
                    dataKey="socBandKwh"
                    stroke="none"
                    fill={COLORS.bandSoc}
                    fillOpacity={0.22}
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
                    <Bar yAxisId="flow" name="Charge from price (grid)" dataKey="chargeFromPriceKwh" fill={COLORS.gridStored} isAnimationActive={false} stackId="flow" />
                  ) : null}
                  {visibleFlowLayers.charge ? (
                    <Bar yAxisId="flow" name="Charge from excess PV" dataKey="chargeFromExcessPvKwh" fill={COLORS.pvCharge} isAnimationActive={false} stackId="flow" />
                  ) : null}
                  {visibleFlowLayers.discharge ? (
                    <Bar yAxisId="flow" name="Discharge to household" dataKey="dischargeToHouseholdKwh" fill={COLORS.pvStored} isAnimationActive={false} stackId="flow" />
                  ) : null}
                  {visibleFlowLayers.discharge ? (
                    <Bar yAxisId="flow" name="Discharge to price (export)" dataKey="dischargeToPriceKwh" fill={COLORS.export} isAnimationActive={false} stackId="flow" />
                  ) : null}
                  {visibleFlowLayers.pvExport ? (
                    <Bar yAxisId="flow" name="Sell excess PV (direct)" dataKey="sellExcessPvKwh" fill={COLORS.curtailed} isAnimationActive={false} stackId="flow" />
                  ) : null}

                  <Line
                    yAxisId="price"
                    name={flowPriceSeriesName}
                    type="monotone"
                    dataKey={flowPriceDataKey}
                    stroke={COLORS.lineSpot}
                    strokeWidth={1.8}
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
