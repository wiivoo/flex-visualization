'use client'

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowRight, BatteryCharging, Home, SunMedium, Zap, type LucideIcon } from 'lucide-react'
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { Card, CardContent } from '@/components/ui/card'
import type { PvBatteryAnnualResult, PvBatteryFlowPermissions, PvBatterySlotResult } from '@/lib/pv-battery-calculator'
import type { PriceUnits } from '@/lib/v2-config'

interface Props {
  annualResult: PvBatteryAnnualResult | null
  dayLabel: string
  flowPermissions: PvBatteryFlowPermissions
  units: PriceUnits
  loading?: boolean
  controls?: ReactNode
  priceNote?: string
  priceControls?: ReactNode
}

interface FlowSegment {
  color: string
  value: number
}

interface LaneDefinition {
  key: string
  label: string
  detail: string
  icon: LucideIcon
  accent: string
  mode: 'positive' | 'center'
  positive: (slot: PvBatterySlotResult) => FlowSegment[]
  negative?: (slot: PvBatterySlotResult) => FlowSegment[]
}

interface SummaryTone {
  background: string
  text: string
}

const COLORS = {
  pvDirect: '#F4C542',
  pvStored: '#E07A1F',
  pvCharge: '#E4A200',
  gridDirect: '#A1A8B3',
  gridStored: '#4A5565',
  export: '#5B9BDA',
  curtailed: '#E7A56A',
  lineSpot: '#16181D',
  lineHousehold: '#2C67B8',
  lineExport: '#76AEE9',
  bandCharge: '#D7DEE6',
  bandBattery: '#F5D7BF',
  bandPv: '#DDEBFA',
  surface: '#FFFFFF',
  surfaceMuted: '#FFFFFF',
  surfaceInset: '#FFFFFF',
  plot: '#F8FAFC',
  border: '#E5E7EB',
  borderStrong: '#CBD5E1',
  text: '#171717',
  textMuted: '#6B6A64',
  textSoft: '#8A877E',
} as const

function formatKwh(value: number): string {
  return `${value.toFixed(2)} kWh`
}

function formatCurrency(value: number, currencySym: string): string {
  return `${value >= 0 ? '+' : '-'}${currencySym}${Math.abs(value).toFixed(2)}`
}

function formatScaleTick(value: number): string {
  if (value >= 10) return `${value.toFixed(0)}`
  if (value >= 1) return `${value.toFixed(1)}`
  return `${value.toFixed(2)}`
}

function buildRanges(slots: PvBatterySlotResult[], predicate: (slot: PvBatterySlotResult) => boolean) {
  const ranges: Array<{ x1: number; x2: number }> = []
  let start: number | null = null

  slots.forEach((slot, index) => {
    const active = predicate(slot)
    if (active && start === null) start = index
    if (!active && start !== null) {
      ranges.push({ x1: start, x2: index - 0.001 })
      start = null
    }
  })

  if (start !== null) ranges.push({ x1: start, x2: slots.length - 0.001 })
  return ranges
}

function niceCeil(value: number): number {
  if (!Number.isFinite(value) || value <= 0) return 1
  const magnitude = Math.pow(10, Math.floor(Math.log10(value)))
  const normalized = value / magnitude
  const multiplier = normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10
  return multiplier * magnitude
}

function buildPositiveTicks(maxValue: number, steps = 4): number[] {
  const niceMax = niceCeil(maxValue)
  return Array.from({ length: steps + 1 }, (_, index) => Number(((niceMax / steps) * index).toFixed(6)))
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

function tone(background: string, text: string): SummaryTone {
  return { background, text }
}

function SummaryTile({
  label,
  value,
  detail,
  icon: Icon,
  palette,
}: {
  label: string
  value: string
  detail: string
  icon: LucideIcon
  palette: SummaryTone
}) {
  return (
    <div
      className="rounded-[20px] border px-4 py-4"
      style={{ backgroundColor: palette.background, borderColor: 'rgba(17,24,39,0.05)' }}
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em]" style={{ color: palette.text }}>
            {label}
          </p>
          <p className="mt-2 text-lg font-semibold tracking-[-0.02em] text-[#171717]">{value}</p>
          <p className="mt-1 text-xs text-[#5F5D55]">{detail}</p>
        </div>
        <span className="flex h-10 w-10 items-center justify-center rounded-full bg-white/80" style={{ color: palette.text }}>
          <Icon className="h-4 w-4" />
        </span>
      </div>
    </div>
  )
}

function LegendPill({
  label,
  color,
  icon: Icon,
}: {
  label: string
  color: string
  icon: LucideIcon
}) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-black/5 bg-white/90 px-3 py-1.5 text-[11px] font-medium text-[#4B4A45]">
      <span className="flex h-5 w-5 items-center justify-center rounded-full" style={{ backgroundColor: `${color}1F`, color }}>
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span>{label}</span>
    </span>
  )
}

function FlowScale({
  mode,
  ticks,
  maxValue,
}: {
  mode: 'positive' | 'center'
  ticks: number[]
  maxValue: number
}) {
  const positiveTicks = ticks.filter((tick) => tick > 0)

  return (
    <div className="pointer-events-none absolute inset-y-0 left-0 w-[56px] border-r border-[#E5E7EB] text-[10px] text-[#94A3B8]">
      <span className="absolute left-0 top-3 text-[9px] font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">kWh</span>

      {mode === 'positive' ? (
        ticks.map((tick) => {
          const bottom = maxValue <= 0 ? 0 : (tick / maxValue) * 100
          return (
            <span
              key={`positive-scale-${tick}`}
              className="absolute left-0 -translate-y-1/2 tabular-nums"
              style={{ bottom: `${bottom}%`, top: 'auto' }}
            >
              {formatScaleTick(tick)}
            </span>
          )
        })
      ) : (
        <>
          {positiveTicks.map((tick) => {
            const offset = maxValue <= 0 ? 0 : (tick / maxValue) * 50
            return (
              <span
                key={`center-positive-${tick}`}
                className="absolute left-0 -translate-y-1/2 tabular-nums"
                style={{ top: `${50 - offset}%` }}
              >
                +{formatScaleTick(tick)}
              </span>
            )
          })}
          <span className="absolute left-0 top-1/2 -translate-y-1/2 tabular-nums">0</span>
          {positiveTicks.map((tick) => {
            const offset = maxValue <= 0 ? 0 : (tick / maxValue) * 50
            return (
              <span
                key={`center-negative-${tick}`}
                className="absolute left-0 -translate-y-1/2 tabular-nums"
                style={{ top: `${50 + offset}%` }}
              >
                -{formatScaleTick(tick)}
              </span>
            )
          })}
        </>
      )}
    </div>
  )
}

function SlotBars({
  slot,
  lane,
  maxValue,
  active,
  onClick,
}: {
  slot: PvBatterySlotResult
  lane: LaneDefinition
  maxValue: number
  active: boolean
  onClick: () => void
}) {
  const positive = lane.positive(slot)
  const negative = lane.negative ? lane.negative(slot) : []

  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative h-full min-w-0 overflow-hidden rounded-[4px] transition-all ${
        active
          ? 'bg-[rgba(59,130,246,0.06)] shadow-[inset_0_0_0_1px_rgba(59,130,246,0.16)]'
          : 'hover:bg-[rgba(17,24,39,0.03)]'
      }`}
      title={`${lane.label} · ${slot.label}`}
    >
      {active ? <div className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[#2563EB]" /> : null}

      {lane.mode === 'center' ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-[#CBD5E1]" />
      ) : null}

      <div className={`pointer-events-none absolute inset-x-[2px] ${lane.mode === 'center' ? 'top-[4px] bottom-1/2' : 'inset-y-[4px]'}`}>
        <div className="flex h-full flex-col justify-end gap-px">
          {positive.map((segment, index) => {
            if (segment.value <= 0) return null
            const heightPct = Math.max((segment.value / Math.max(maxValue, 0.001)) * 100, 2)
            return (
              <div
                key={`${slot.timestamp}-positive-${index}`}
                className="w-full rounded-[3px]"
                style={{ height: `${Math.min(heightPct, 100)}%`, backgroundColor: segment.color }}
              />
            )
          })}
        </div>
      </div>

      {lane.mode === 'center' ? (
        <div className="pointer-events-none absolute inset-x-[2px] top-1/2 bottom-[4px]">
          <div className="flex h-full flex-col gap-px">
            {negative.map((segment, index) => {
              if (segment.value <= 0) return null
              const heightPct = Math.max((segment.value / Math.max(maxValue, 0.001)) * 100, 2)
              return (
                <div
                  key={`${slot.timestamp}-negative-${index}`}
                className="w-full rounded-[3px]"
                style={{ height: `${Math.min(heightPct, 100)}%`, backgroundColor: segment.color }}
              />
              )
            })}
          </div>
        </div>
      ) : null}
    </button>
  )
}

function FlowLaneRow({
  lane,
  slots,
  selectedIndex,
  setSelectedIndex,
  slotsPerHour,
}: {
  lane: LaneDefinition
  slots: PvBatterySlotResult[]
  selectedIndex: number
  setSelectedIndex: (index: number) => void
  slotsPerHour: number
}) {
  const maxPositive = useMemo(
    () => Math.max(
      ...slots.map((slot) => lane.positive(slot).reduce((sum, segment) => sum + segment.value, 0)),
      0.1,
    ),
    [lane, slots],
  )
  const maxNegative = useMemo(
    () => Math.max(
      ...slots.map((slot) => (lane.negative ? lane.negative(slot).reduce((sum, segment) => sum + segment.value, 0) : 0)),
      0.1,
    ),
    [lane, slots],
  )
  const laneScaleMax = lane.mode === 'center'
    ? Math.max(maxPositive, maxNegative, 0.1)
    : Math.max(maxPositive, 0.1)
  const flowTicks = useMemo(() => buildPositiveTicks(laneScaleMax), [laneScaleMax])
  const Icon = lane.icon
  const guideTicks = flowTicks.filter((tick) => tick > 0)
  const chartHeight = lane.mode === 'center' ? 'h-[188px]' : 'h-[108px]'

  return (
    <div className={`grid grid-cols-[14px_minmax(0,1fr)] gap-3 ${chartHeight}`}>
      <div
        className="flex items-start justify-center pt-3"
        style={{ color: lane.accent, backgroundColor: 'transparent' }}
        aria-hidden="true"
      >
        <span className="text-current">
          <Icon className="h-4 w-4" />
        </span>
      </div>

      <div
        className={`relative overflow-hidden rounded-[14px] border pl-[60px] pr-1.5 py-2 ${chartHeight}`}
        style={{ borderColor: COLORS.border, backgroundColor: COLORS.plot }}
        aria-label={lane.label}
      >
        <FlowScale mode={lane.mode} ticks={flowTicks} maxValue={laneScaleMax} />
        <div className="pointer-events-none absolute left-[60px] top-3 text-[11px] font-semibold text-[#334155]">
          {lane.label}
        </div>

        <div className="pointer-events-none absolute inset-0">
          {lane.mode === 'positive' ? (
            guideTicks.map((tick) => {
              const top = 100 - (tick / Math.max(laneScaleMax, 0.001)) * 100
              return (
                <div
                  key={`${lane.key}-guide-${tick}`}
                  className="absolute inset-x-0 border-t border-[#E5E7EB]"
                  style={{ top: `${top}%` }}
                />
              )
            })
          ) : (
            <>
              {guideTicks.map((tick) => {
                const offset = (tick / Math.max(laneScaleMax, 0.001)) * 50
                return (
                  <div
                    key={`${lane.key}-guide-positive-${tick}`}
                    className="absolute inset-x-0 border-t border-[#E5E7EB]"
                    style={{ top: `${50 - offset}%` }}
                  />
                )
              })}
              <div className="absolute inset-x-0 top-1/2 border-t border-[#D1D5DB]" />
              {guideTicks.map((tick) => {
                const offset = (tick / Math.max(laneScaleMax, 0.001)) * 50
                return (
                  <div
                    key={`${lane.key}-guide-negative-${tick}`}
                    className="absolute inset-x-0 border-t border-[#E5E7EB]"
                    style={{ top: `${50 + offset}%` }}
                  />
                )
              })}
            </>
          )}
        </div>

        <div
          className="pointer-events-none absolute inset-0 grid gap-[2px] px-1.5 py-2"
          style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}
        >
          {slots.map((slot, index) => {
            const isHourTick = index % slotsPerHour === 0
            const isMajorTick = index % (slotsPerHour * 4) === 0

            return (
              <div
                key={`${lane.key}-vertical-${slot.timestamp}`}
                className={`border-l ${isHourTick ? 'opacity-100' : 'opacity-0'} ${isMajorTick ? 'border-l-[#D1D5DB]' : 'border-l-[#E5E7EB]'}`}
              />
            )
          })}
        </div>

        <div className="grid h-full gap-[2px]" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
          {slots.map((slot, index) => (
            <SlotBars
              key={`${lane.key}-${slot.timestamp}`}
              slot={slot}
              lane={lane}
              maxValue={laneScaleMax}
              active={selectedIndex === index}
              onClick={() => setSelectedIndex(index)}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function DayFlowPill({
  label,
  value,
  color,
}: {
  label: string
  value: string
  color: string
}) {
  return (
    <div className="rounded-[14px] border border-[#E5E7EB] bg-white px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
        <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#64748B]">{label}</span>
      </div>
      <p className="mt-1 text-sm font-semibold text-[#171717]">{value}</p>
    </div>
  )
}

export function PvBatteryDayChart({
  annualResult,
  dayLabel,
  flowPermissions,
  units,
  loading = false,
  controls,
  priceNote,
  priceControls,
}: Props) {
  const slots = useMemo(() => annualResult?.slots ?? [], [annualResult])
  const [selectedIndex, setSelectedIndex] = useState(0)
  const effectiveSelectedIndex = Math.min(selectedIndex, Math.max(slots.length - 1, 0))
  const selectedSlot = slots[effectiveSelectedIndex]

  const disabledFlowSummary = useMemo(() => {
    const disabled: string[] = []
    if (!flowPermissions.pvToLoad) disabled.push('PV -> load')
    if (!flowPermissions.pvToBattery) disabled.push('PV -> battery')
    if (!flowPermissions.gridToBattery) disabled.push('Grid -> battery')
    if (!flowPermissions.batteryToLoad) disabled.push('Battery -> load')
    if (!flowPermissions.pvToGrid) disabled.push('PV -> grid')
    if (!flowPermissions.batteryToGrid) disabled.push('Battery -> grid')
    return disabled.length > 0 ? disabled.join(', ') : 'None'
  }, [flowPermissions])

  const totals = useMemo(() => slots.reduce((acc, slot) => ({
    pvToLoad: acc.pvToLoad + slot.pvToLoadKwh,
    pvToBattery: acc.pvToBattery + slot.pvToBatteryKwh,
    pvToGrid: acc.pvToGrid + slot.pvToGridKwh,
    curtailed: acc.curtailed + slot.curtailedKwh,
    gridToLoad: acc.gridToLoad + slot.gridToLoadKwh,
    gridToBattery: acc.gridToBattery + slot.gridToBatteryKwh,
    batteryPvToLoad: acc.batteryPvToLoad + slot.batteryPvToLoadKwh,
    batteryGridToLoad: acc.batteryGridToLoad + slot.batteryGridToLoadKwh,
    batteryPvExport: acc.batteryPvExport + slot.batteryPvExportKwh,
    batteryGridExport: acc.batteryGridExport + slot.batteryGridExportKwh,
    importCost: acc.importCost + slot.gridImportCostEur,
    exportRevenue: acc.exportRevenue + slot.exportRevenueEur,
    netCost: acc.netCost + slot.netCostEur,
  }), {
    pvToLoad: 0,
    pvToBattery: 0,
    pvToGrid: 0,
    curtailed: 0,
    gridToLoad: 0,
    gridToBattery: 0,
    batteryPvToLoad: 0,
    batteryGridToLoad: 0,
    batteryPvExport: 0,
    batteryGridExport: 0,
    importCost: 0,
    exportRevenue: 0,
    netCost: 0,
  }), [slots])

  const lanes: LaneDefinition[] = useMemo(() => [
    {
      key: 'pv',
      label: 'PV',
      detail: 'Generation split between home, storage, export, and curtailment.',
      icon: SunMedium,
      accent: COLORS.pvCharge,
      mode: 'positive',
      positive: (slot) => [
        { color: COLORS.pvDirect, value: slot.pvToLoadKwh },
        { color: COLORS.pvCharge, value: slot.pvToBatteryKwh },
        { color: COLORS.export, value: slot.pvToGridKwh },
        { color: COLORS.curtailed, value: slot.curtailedKwh },
      ],
    },
    {
      key: 'battery',
      label: 'Battery',
      detail: 'Charge above zero, discharge below zero. Same kWh scale as the other tracks.',
      icon: BatteryCharging,
      accent: COLORS.pvStored,
      mode: 'center',
      positive: (slot) => [
        { color: COLORS.pvCharge, value: slot.pvToBatteryKwh },
        { color: COLORS.gridDirect, value: slot.gridToBatteryKwh },
      ],
      negative: (slot) => [
        { color: COLORS.pvStored, value: slot.batteryPvToLoadKwh + slot.batteryPvExportKwh },
        { color: COLORS.gridStored, value: slot.batteryGridToLoadKwh + slot.batteryGridExportKwh },
      ],
    },
    {
      key: 'home',
      label: 'Home',
      detail: 'Demand covered by direct PV, stored energy, or the grid.',
      icon: Home,
      accent: COLORS.lineHousehold,
      mode: 'positive',
      positive: (slot) => [
        { color: COLORS.pvDirect, value: slot.pvToLoadKwh },
        { color: COLORS.pvStored, value: slot.batteryPvToLoadKwh },
        { color: COLORS.gridStored, value: slot.batteryGridToLoadKwh },
        { color: COLORS.gridDirect, value: slot.gridToLoadKwh },
      ],
    },
  ], [])

  const slotsPerHour = useMemo(() => getSlotsPerHour(slots.length), [slots.length])

  const priceData = useMemo(
    () => slots.map((slot, index) => ({ ...slot, idx: index })),
    [slots],
  )
  const hourTicks = useMemo(() => buildHourTicks(priceData.length), [priceData.length])
  const majorHourStep = slots.length > 48 ? 4 : 2

  const ranges = useMemo(() => ({
    gridCharge: buildRanges(slots, (slot) => slot.isGridChargingBattery),
    batteryUse: buildRanges(slots, (slot) => slot.isBatteryDischarging),
    pvExport: buildRanges(slots, (slot) => slot.isDirectPvExporting),
  }), [slots])

  const priceAxis = useMemo(() => {
    let minValue = Number.POSITIVE_INFINITY
    let maxValue = Number.NEGATIVE_INFINITY

    for (const slot of slots) {
      minValue = Math.min(minValue, slot.spotPriceCtKwh, slot.householdImportPriceCtKwh, slot.exportPriceCtKwh)
      maxValue = Math.max(maxValue, slot.spotPriceCtKwh, slot.householdImportPriceCtKwh, slot.exportPriceCtKwh)
    }

    if (!Number.isFinite(minValue) || !Number.isFinite(maxValue)) {
      return { ticks: [0, 5, 10], domain: [0, 10] as [number, number] }
    }

    const padding = Math.max((maxValue - minValue) * 0.08, 1.5)
    const ticks = buildRangeTicks(minValue - padding, maxValue + padding, 5)
    return { ticks, domain: [ticks[0], ticks[ticks.length - 1]] as [number, number] }
  }, [slots])

  const heroStats = useMemo(() => [
    {
      label: 'PV kept on site',
      value: formatKwh(totals.pvToLoad + totals.pvToBattery),
      detail: `${formatKwh(totals.pvToGrid)} exported`,
      icon: SunMedium,
      palette: tone('#FFF7DA', '#7A5B00'),
    },
    {
      label: 'Battery delivered',
      value: formatKwh(totals.batteryPvToLoad + totals.batteryGridToLoad + totals.batteryPvExport + totals.batteryGridExport),
      detail: `${formatKwh(totals.gridToBattery)} grid-charged`,
      icon: BatteryCharging,
      palette: tone('#FFEAD7', '#9A4E00'),
    },
    {
      label: 'Grid imported',
      value: formatKwh(totals.gridToLoad + totals.gridToBattery),
      detail: `${formatKwh(totals.gridToLoad)} to the home`,
      icon: Zap,
      palette: tone('#EEF1F5', '#435061'),
    },
    {
      label: 'Net energy cost',
      value: formatCurrency(totals.netCost, units.currencySym),
      detail: `${formatCurrency(totals.exportRevenue, units.currencySym)} export revenue`,
      icon: ArrowRight,
      palette: tone('#EDF5FF', '#28538B'),
    },
  ], [totals, units.currencySym])

  const dayFlowSummary = useMemo(() => ([
    { label: 'PV to home', value: totals.pvToLoad, color: COLORS.pvDirect },
    { label: 'PV to battery', value: totals.pvToBattery, color: COLORS.pvCharge },
    { label: 'PV to grid', value: totals.pvToGrid, color: COLORS.export },
    { label: 'Battery to home', value: totals.batteryPvToLoad + totals.batteryGridToLoad, color: COLORS.pvStored },
    { label: 'Battery to grid', value: totals.batteryPvExport + totals.batteryGridExport, color: COLORS.gridStored },
    { label: 'Grid to battery', value: totals.gridToBattery, color: COLORS.gridDirect },
    { label: 'Grid to home', value: totals.gridToLoad, color: COLORS.gridDirect },
  ]).filter((item) => item.value > 0.001), [totals])

  if (loading || slots.length === 0 || !selectedSlot) {
    return (
      <Card className="rounded-[28px] border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="flex h-[420px] items-center justify-center p-8">
          <p className="text-sm text-gray-400">{loading ? 'Computing day profile…' : 'No complete day selected yet.'}</p>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-5">
      <Card className="overflow-hidden rounded-[28px] border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="p-6 sm:p-7 xl:p-8">
          <div className="flex flex-col gap-5">
            <div className="flex flex-col gap-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-black/5 bg-white/90 px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-[#6B6A64]">
                  Selected day
                </span>
                <span className="rounded-full border border-black/5 bg-white/70 px-3 py-1 text-[10px] font-medium uppercase tracking-[0.16em] text-[#6B6A64]">
                  {slots.length} slices
                </span>
              </div>

              <div className="flex flex-col gap-1">
                <h3 className="text-[30px] font-semibold tracking-[-0.03em] text-[#171717] sm:text-[34px]">{dayLabel}</h3>
                <p className="max-w-3xl text-sm leading-6 text-[#6B6A64]">
                  A 24-hour replay of PV generation, storage movement, household demand, and market interaction.
                </p>
              </div>

              <p className="text-xs text-[#94A3B8]">Blocked routes: {disabledFlowSummary}.</p>
            </div>

            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
              {heroStats.map((stat) => (
                <SummaryTile
                  key={stat.label}
                  label={stat.label}
                  value={stat.value}
                  detail={stat.detail}
                  icon={stat.icon}
                  palette={stat.palette}
                />
              ))}
            </div>

            {controls ? controls : (
              <p className="text-sm leading-6 text-[#6B7280]">
                Choose a day to inspect the same routing logic at finer detail.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-[24px] border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="p-6 sm:p-7">
          <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">Primary replay</p>
              <p className="mt-1 text-[24px] font-semibold tracking-tight text-[#171717]">Intraday routing shape</p>
              <p className="mt-2 text-sm leading-6 text-[#6B7280]">
                PV, battery, and home over the selected 24 hours. Each lane uses its own kWh scale so the shapes stay readable.
              </p>
            </div>

            <div className="flex flex-wrap gap-2">
              <LegendPill label="Direct PV" color={COLORS.pvDirect} icon={SunMedium} />
              <LegendPill label="Stored PV" color={COLORS.pvStored} icon={BatteryCharging} />
              <LegendPill label="Grid" color={COLORS.gridDirect} icon={Zap} />
              <LegendPill label="Stored grid" color={COLORS.gridStored} icon={BatteryCharging} />
              <LegendPill label="Export" color={COLORS.export} icon={ArrowRight} />
            </div>
          </div>

          <div className="space-y-4">
            <div>
              <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-[#94A3B8]">Day flows</p>
              <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {dayFlowSummary.map((flow) => (
                  <DayFlowPill
                    key={flow.label}
                    label={flow.label}
                    value={formatKwh(flow.value)}
                    color={flow.color}
                  />
                ))}
              </div>
            </div>

            {lanes.map((lane) => (
              <FlowLaneRow
                key={lane.key}
                lane={lane}
                slots={slots}
                selectedIndex={effectiveSelectedIndex}
                setSelectedIndex={setSelectedIndex}
                slotsPerHour={slotsPerHour}
              />
            ))}

            <div className="grid grid-cols-[14px_minmax(0,1fr)] gap-3">
              <div />
              <div className="grid gap-[2px] pl-[60px] pr-2" style={{ gridTemplateColumns: `repeat(${slots.length}, minmax(0, 1fr))` }}>
                {slots.map((slot, index) => {
                  const isHourTick = index % slotsPerHour === 0
                  const isMajorTick = index % (slotsPerHour * majorHourStep) === 0
                  const showLabel = index === 0 || index === slots.length - 1 || isMajorTick

                  return (
                    <button
                      key={`flow-axis-${slot.timestamp}`}
                      type="button"
                      onClick={() => setSelectedIndex(index)}
                      className={`flex flex-col items-center gap-1 px-0.5 py-1 text-center transition-colors ${
                        effectiveSelectedIndex === index ? 'text-[#2563EB]' : 'text-[#94A3B8] hover:text-[#475569]'
                      }`}
                    >
                      <span className={`w-px ${isHourTick ? 'bg-[#CBD5E1]' : 'bg-[#E5E7EB]'} ${isMajorTick ? 'h-4' : 'h-2.5'}`} />
                      <span className={`text-[10px] ${showLabel ? 'font-medium' : 'opacity-0'}`}>
                        {showLabel ? formatHourTick(slot.label) : '.'}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="overflow-hidden rounded-[24px] border-[#E5E7EB] bg-white shadow-sm">
        <CardContent className="p-6 sm:p-7">
          <div className="mb-4 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">Market context</p>
              <p className="mt-1 text-[24px] font-semibold tracking-tight text-[#171717]">Price Replay</p>
              <p className="mt-2 text-sm text-[#6B7280]">Spot, household import, and export value with the same chart language as `/v2`.</p>
              {priceNote ? <p className="mt-2 text-[12px] leading-5 text-[#6B7280]">{priceNote}</p> : null}
            </div>

            <div className="flex flex-wrap items-center justify-end gap-2">
              {priceControls}
              <LegendPill label="Spot" color={COLORS.lineSpot} icon={Zap} />
              <LegendPill label="Household" color={COLORS.lineHousehold} icon={Home} />
              <LegendPill label="Export" color={COLORS.lineExport} icon={ArrowRight} />
            </div>
          </div>

          <div className="h-[344px] rounded-[16px] border border-[#E5E7EB] bg-[#F8FAFC] px-2 pb-2 pt-4">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={priceData} margin={{ top: 8, right: 18, bottom: 18, left: 18 }}>
                <CartesianGrid stroke="#E5E7EB" strokeDasharray="3 3" vertical={false} />

                <XAxis
                  dataKey="idx"
                  type="number"
                  domain={[0, Math.max(priceData.length - 1, 1)]}
                  ticks={hourTicks}
                  tickFormatter={(value) => {
                    const slot = priceData[Number(value)]
                    if (!slot) return ''
                    const index = Number(value)
                    return index === 0 || index === priceData.length - 1 || index % (slotsPerHour * majorHourStep) === 0
                      ? formatHourTick(slot.label)
                      : ''
                  }}
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  height={40}
                />

                <YAxis
                  domain={priceAxis.domain}
                  ticks={priceAxis.ticks}
                  width={72}
                  tick={{ fontSize: 10, fill: '#9CA3AF' }}
                  tickLine={false}
                  axisLine={false}
                  tickFormatter={(value) => `${value.toFixed(0)} ${units.priceSym}`}
                />

                {ranges.gridCharge.map((range, index) => (
                  <ReferenceArea key={`charge-${index}`} x1={range.x1} x2={range.x2} fill={COLORS.bandCharge} fillOpacity={0.18} ifOverflow="hidden" />
                ))}
                {ranges.batteryUse.map((range, index) => (
                  <ReferenceArea key={`battery-${index}`} x1={range.x1} x2={range.x2} fill={COLORS.bandBattery} fillOpacity={0.16} ifOverflow="hidden" />
                ))}
                {ranges.pvExport.map((range, index) => (
                  <ReferenceArea key={`pv-${index}`} x1={range.x1} x2={range.x2} fill={COLORS.bandPv} fillOpacity={0.22} ifOverflow="hidden" />
                ))}

                <ReferenceLine x={effectiveSelectedIndex} stroke="#111827" strokeOpacity={0.26} strokeDasharray="3 4" />

                <Tooltip
                  contentStyle={{ borderRadius: 18, borderColor: '#E5E0D5', boxShadow: '0 18px 40px rgba(15,23,42,0.12)' }}
                  formatter={(value: number | string | undefined, name: string | undefined) => {
                    if (typeof value !== 'number') return [value ?? '—', name ?? 'Value']
                    return [value.toFixed(2), name ?? 'Value']
                  }}
                  labelFormatter={(value) => {
                    const slot = priceData[Number(value)]
                    if (!slot) return dayLabel
                    const actions = [
                      slot.isGridChargingBattery ? 'Grid charge' : null,
                      slot.isBatteryExporting ? 'Battery export' : slot.isBatteryDischarging ? 'Battery discharge' : null,
                      slot.isDirectPvExporting ? 'PV export' : null,
                    ].filter(Boolean).join(' · ')
                    return `${dayLabel} · ${slot.label}${actions ? ` · ${actions}` : ''}`
                  }}
                />

                <Line
                  type="monotone"
                  name={`Spot price (${units.priceUnit})`}
                  dataKey="spotPriceCtKwh"
                  stroke={COLORS.lineSpot}
                  strokeWidth={2.1}
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  name={`Household price (${units.priceUnit})`}
                  dataKey="householdImportPriceCtKwh"
                  stroke={COLORS.lineHousehold}
                  strokeWidth={1.9}
                  strokeDasharray="5 4"
                  dot={false}
                  isAnimationActive={false}
                />
                <Line
                  type="monotone"
                  name={`Export value (${units.priceUnit})`}
                  dataKey="exportPriceCtKwh"
                  stroke={COLORS.lineExport}
                  strokeWidth={1.7}
                  strokeDasharray="3 5"
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          <div className="mt-3 grid gap-2 text-[12px] text-[#5F5D55] sm:grid-cols-3">
            <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FBFBF8] px-4 py-3">
              <p className="font-semibold text-[#171717]">Gray bands</p>
              <p className="mt-1 leading-6">Grid-charging windows.</p>
            </div>
            <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FBFBF8] px-4 py-3">
              <p className="font-semibold text-[#171717]">Amber bands</p>
              <p className="mt-1 leading-6">Battery discharge or export windows.</p>
            </div>
            <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FBFBF8] px-4 py-3">
              <p className="font-semibold text-[#171717]">Blue bands</p>
              <p className="mt-1 leading-6">Direct PV export windows.</p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
