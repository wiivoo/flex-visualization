'use client'

import Link from 'next/link'
import { Suspense, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Battery, BatteryCharging, CircleHelp, Gauge, Home, LineChart, SunMedium, Zap, type LucideIcon } from 'lucide-react'

import { PvBatteryDayChart } from '@/components/battery/calculator/PvBatteryDayChart'
import { DateStrip } from '@/components/v2/DateStrip'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { usePvRadiation } from '@/lib/use-pv-radiation'
import {
  DE_BATTERY_LOAD_PROFILES,
  type BatteryLoadProfileId,
} from '@/lib/battery-config'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import {
  buildPvBatteryInputs,
  getAvailablePvBatteryYears,
  optimizePvBattery,
  type PvBatteryAnnualResult,
  type PvBatteryCalculatorScenario,
  type PvBatteryCountry,
  type PvBatteryFlowPermissions,
  type PvBatteryResolution,
} from '@/lib/pv-battery-calculator'
import { getDefaultTariffId, getTariffsFor } from '@/lib/retail-tariffs'
import { usePrices } from '@/lib/use-prices'
import { cn } from '@/lib/utils'
import { getPriceUnits } from '@/lib/v2-config'

type FlowPermissionKey =
  | 'pvToLoad'
  | 'pvToBattery'
  | 'gridToBattery'
  | 'batteryToLoad'
  | 'pvToGrid'
  | 'batteryToGrid'

type FlowPermissions = PvBatteryFlowPermissions
type DayFlowByRoute = Record<FlowPermissionKey | 'gridToHome', number>
const CALCULATOR_COUNTRY: PvBatteryCountry = 'DE'

const FLOW_PERMISSION_QUERY_KEYS: Record<FlowPermissionKey, string> = {
  pvToLoad: 'pvLoad',
  pvToBattery: 'pvBattery',
  gridToBattery: 'gridBattery',
  batteryToLoad: 'batteryLoad',
  pvToGrid: 'pvGrid',
  batteryToGrid: 'batteryGrid',
}

const DEFAULT_FLOW_PERMISSIONS: FlowPermissions = {
  pvToLoad: true,
  pvToBattery: true,
  gridToBattery: false,
  batteryToLoad: true,
  pvToGrid: true,
  batteryToGrid: true,
}

const ALLOWED_DE_LOAD_PROFILES = ['H25', 'P25', 'S25'] as const
type AllowedDeLoadProfile = typeof ALLOWED_DE_LOAD_PROFILES[number]

function isAllowedDeLoadProfile(value: string): value is AllowedDeLoadProfile {
  return (ALLOWED_DE_LOAD_PROFILES as readonly string[]).includes(value)
}

const FLOW_PERMISSION_OPTIONS: Array<{
  key: FlowPermissionKey
  title: string
  summary: string
  detail: string
}> = [
  {
    key: 'pvToLoad',
    title: 'PV -> load',
    summary: 'Serve household demand directly from PV generation.',
    detail: 'If you disable this, the model should not use live PV to cover household demand before other destinations.',
  },
  {
    key: 'pvToBattery',
    title: 'PV -> battery',
    summary: 'Store PV surplus in the battery for later use.',
    detail: 'If disabled, any PV surplus must export or curtail instead of charging the battery.',
  },
  {
    key: 'gridToBattery',
    title: 'Grid -> battery',
    summary: 'Allow deliberate grid charging when prices are attractive.',
    detail: 'This matters for tariff arbitrage and negative-price slots.',
  },
  {
    key: 'batteryToLoad',
    title: 'Battery -> load',
    summary: 'Let stored energy cover household demand later in the day.',
    detail: 'If disabled, the battery can only export or hold energy under the remaining permissions.',
  },
  {
    key: 'pvToGrid',
    title: 'PV -> grid',
    summary: 'Export PV directly instead of routing it only to local load or storage.',
    detail: 'Disable this when direct export is not allowed or should be curtailed.',
  },
  {
    key: 'batteryToGrid',
    title: 'Battery -> grid',
    summary: 'Allow delayed export from stored energy.',
    detail: 'This is separate from direct PV export and still obeys the shared export cap.',
  },
]

type FlowNodeKey = 'pv' | 'battery' | 'home' | 'grid'

const FLOW_NODE_META: Record<FlowNodeKey, {
  label: string
  icon: LucideIcon
  background: string
  text: string
}> = {
  pv: {
    label: 'PV',
    icon: SunMedium,
    background: '#FFF4D6',
    text: '#8A5A00',
  },
  battery: {
    label: 'Battery',
    icon: BatteryCharging,
    background: '#FFE8D9',
    text: '#8F4312',
  },
  home: {
    label: 'Home',
    icon: Home,
    background: '#EAF3FF',
    text: '#1E4F88',
  },
  grid: {
    label: 'Grid',
    icon: Zap,
    background: '#E9EEF5',
    text: '#31465F',
  },
}

const FLOW_ROUTE_GRAPH: Array<{
  key: FlowPermissionKey
  label: string
  from: FlowNodeKey
  to: FlowNodeKey
  emphasis: 'core' | 'market'
}> = [
  { key: 'pvToLoad', label: 'Direct supply', from: 'pv', to: 'home', emphasis: 'core' },
  { key: 'pvToBattery', label: 'Store solar', from: 'pv', to: 'battery', emphasis: 'core' },
  { key: 'batteryToLoad', label: 'Serve load', from: 'battery', to: 'home', emphasis: 'core' },
  { key: 'pvToGrid', label: 'Direct export', from: 'pv', to: 'grid', emphasis: 'market' },
  { key: 'gridToBattery', label: 'Grid charge', from: 'grid', to: 'battery', emphasis: 'market' },
  { key: 'batteryToGrid', label: 'Battery export', from: 'battery', to: 'grid', emphasis: 'market' },
]

interface CalculatorState {
  country: PvBatteryCountry
  tariffId: string
  year: number
  resolution: PvBatteryResolution
  flowPriceMode: 'spot' | 'end'
  loadProfileId: BatteryLoadProfileId
  annualLoadKwh: number
  pvCapacityWp: number
  pvZipCode: string
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number
  feedInCapKw: number
  flowPermissions: FlowPermissions
}

function sameState(a: CalculatorState, b: CalculatorState): boolean {
  return a.country === b.country
    && a.tariffId === b.tariffId
    && a.year === b.year
    && a.resolution === b.resolution
    && a.flowPriceMode === b.flowPriceMode
    && a.loadProfileId === b.loadProfileId
    && a.annualLoadKwh === b.annualLoadKwh
    && a.pvCapacityWp === b.pvCapacityWp
    && a.pvZipCode === b.pvZipCode
    && a.usableKwh === b.usableKwh
    && a.maxChargeKw === b.maxChargeKw
    && a.maxDischargeKw === b.maxDischargeKw
    && a.roundTripEff === b.roundTripEff
    && a.feedInCapKw === b.feedInCapKw
    && FLOW_PERMISSION_OPTIONS.every(({ key }) => a.flowPermissions[key] === b.flowPermissions[key])
}

const DEFAULT_STATE: CalculatorState = {
  country: CALCULATOR_COUNTRY,
  tariffId: 'enviam-vision',
  year: 0,
  resolution: 'quarterhour',
  flowPriceMode: 'spot',
  loadProfileId: 'H25',
  annualLoadKwh: 4500,
  pvCapacityWp: 8000,
  pvZipCode: '',
  usableKwh: 10,
  maxChargeKw: 5,
  maxDischargeKw: 5,
  roundTripEff: 0.9,
  feedInCapKw: 5,
  flowPermissions: DEFAULT_FLOW_PERMISSIONS,
}

const MARKET_EXPORT_COMPENSATION_PCT = 100

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function getDefaultTariffForCountry(country: PvBatteryCountry): string {
  return country === 'DE' ? 'enviam-vision' : getDefaultTariffId(country)
}

function getAutomaticExportLabel(
  country: PvBatteryCountry,
): string {
  if (country === 'DE') return '100% of the spot market'
  return '100% of the spot market'
}

function getDefaultCalculatorLoadProfileId(country: PvBatteryCountry): BatteryLoadProfileId {
  if (country === 'DE') return 'H25'
  return 'H25'
}

function parseFlowPermission(
  params: URLSearchParams,
  key: FlowPermissionKey,
): boolean {
  const raw = params.get(FLOW_PERMISSION_QUERY_KEYS[key])
  if (raw === '1') return true
  if (raw === '0') return false
  return DEFAULT_FLOW_PERMISSIONS[key]
}

function getFlowPermissionLabel(key: FlowPermissionKey): string {
  return FLOW_PERMISSION_OPTIONS.find((option) => option.key === key)?.title ?? key
}

function formatFlowPermissionList(keys: FlowPermissionKey[]): string {
  if (keys.length === 0) return 'none'
  return keys.map(getFlowPermissionLabel).join(', ')
}

function formatKwh(value: number): string {
  return `${Math.round(value).toLocaleString()} kWh`
}

function formatCompactFlowKwh(value: number): string {
  if (!Number.isFinite(value)) return '--'
  if (Math.abs(value) >= 100) return `${value.toFixed(0)}`
  if (Math.abs(value) >= 10) return `${value.toFixed(1)}`
  return `${value.toFixed(2)}`
}

function sumAnnualSlotMetric(
  annual: PvBatteryAnnualResult,
  key: keyof PvBatteryAnnualResult['slots'][number],
): number {
  return annual.slots.reduce((sum, slot) => sum + (typeof slot[key] === 'number' ? (slot[key] as number) : 0), 0)
}

function getChargingLogicTitle(flowPermissions: FlowPermissions): string {
  if (flowPermissions.pvToBattery && flowPermissions.gridToBattery) return 'PV + grid charging'
  if (flowPermissions.pvToBattery) return 'PV charging only'
  if (flowPermissions.gridToBattery) return 'Grid charging only'
  return 'Battery charging blocked'
}

function getChargingLogicDetail(flowPermissions: FlowPermissions): string {
  if (flowPermissions.pvToBattery && flowPermissions.gridToBattery) {
    return 'The solver can fill the battery from on-site PV or from the grid when tariff conditions justify it.'
  }
  if (flowPermissions.pvToBattery) {
    return 'The battery can only charge from PV. Low-price grid charging is disabled.'
  }
  if (flowPermissions.gridToBattery) {
    return 'The battery can charge from the grid, but PV surplus cannot be stored and must export or curtail.'
  }
  return 'No charging path is available. The battery stays idle apart from any energy already stored.'
}

function getDisabledFlowConsequences(flowPermissions: FlowPermissions): string[] {
  const consequences: Partial<Record<FlowPermissionKey, string>> = {
    pvToLoad: 'PV cannot serve household load directly, so the home may still import while PV is exported, stored, or curtailed.',
    pvToBattery: 'PV surplus cannot charge the battery, so excess solar must export directly or curtail.',
    gridToBattery: 'Grid charging is blocked, so the battery can only fill from PV.',
    batteryToLoad: 'Stored energy cannot cover household demand, so battery discharge can only export or remain idle.',
    pvToGrid: 'Direct PV export is blocked, so surplus solar must charge the battery or curtail.',
    batteryToGrid: 'Battery export is blocked, so stored energy can only serve the home or stay in the battery.',
  }

  return FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => !flowPermissions[key])
    .map(({ key }) => consequences[key] ?? '')
    .filter(Boolean)
}

function parseState(params: URLSearchParams): CalculatorState {
  const country: PvBatteryCountry = CALCULATOR_COUNTRY
  const rawLoadProfileId = params.get('profile') ?? ''
  const loadProfileId = isAllowedDeLoadProfile(rawLoadProfileId)
    ? rawLoadProfileId
    : getDefaultCalculatorLoadProfileId(country)
  const parsedYear = Number(params.get('year'))
  const tariffIds = new Set(getTariffsFor(country).map((tariff) => tariff.id))
  const tariffId = tariffIds.has(params.get('tariff') ?? '')
    ? (params.get('tariff') as string)
    : getDefaultTariffForCountry(country)
  const resolution = params.get('resolution') === 'hour' ? 'hour' : 'quarterhour'
  const flowPriceMode = params.get('price') === 'end' ? 'end' : 'spot'

  const getNum = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key)
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value)) return fallback
    return clamp(value, min, max)
  }

  const zipCodeRaw = params.get('pvzip') ?? ''
  const pvZipCode = /^\d{5}$/.test(zipCodeRaw) ? zipCodeRaw : ''

  return {
    country,
    tariffId,
    year: Number.isFinite(parsedYear) ? parsedYear : 0,
    resolution,
    flowPriceMode,
    loadProfileId,
    annualLoadKwh: getNum('load', DEFAULT_STATE.annualLoadKwh, 1500, 15000),
    pvCapacityWp: getNum('pv', DEFAULT_STATE.pvCapacityWp, 0, 20000),
    pvZipCode,
    usableKwh: getNum('battery', DEFAULT_STATE.usableKwh, 0, 20),
    maxChargeKw: getNum('charge', DEFAULT_STATE.maxChargeKw, 1, 15),
    maxDischargeKw: getNum('discharge', DEFAULT_STATE.maxDischargeKw, 1, 15),
    roundTripEff: getNum('eff', DEFAULT_STATE.roundTripEff, 0.75, 0.96),
    feedInCapKw: getNum('feedin', DEFAULT_STATE.feedInCapKw, 0.5, 20),
    flowPermissions: {
      pvToLoad: parseFlowPermission(params, 'pvToLoad'),
      pvToBattery: parseFlowPermission(params, 'pvToBattery'),
      gridToBattery: parseFlowPermission(params, 'gridToBattery'),
      batteryToLoad: parseFlowPermission(params, 'batteryToLoad'),
      pvToGrid: parseFlowPermission(params, 'pvToGrid'),
      batteryToGrid: parseFlowPermission(params, 'batteryToGrid'),
    },
  }
}

function formatDayLabel(date: string): string {
  if (!date) return 'Selected day'
  return new Date(`${date}T12:00:00Z`).toLocaleDateString('en-GB', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  })
}

function formatMonthLabel(month: string): string {
  const [year, mm] = month.split('-')
  return new Date(Number(year), Number(mm) - 1, 1).toLocaleDateString('en-US', {
    month: 'short',
  })
}

function SegmentedPillGroup({
  options,
}: {
  options: Array<{ label: string; active: boolean; onClick: () => void; disabled?: boolean }>
}) {
  return (
    <div className="inline-flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
      {options.map((option) => (
        <button
          key={option.label}
          type="button"
          disabled={option.disabled}
          onClick={option.onClick}
          className={cn(
            'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
            option.active ? 'bg-white text-[#313131] shadow-sm ring-1 ring-gray-200' : 'text-gray-400 hover:text-gray-600',
            option.disabled && 'cursor-not-allowed opacity-40 hover:text-gray-400',
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}

function MetricTile({
  label,
  value,
  hint,
}: {
  label: string
  value: string
  hint?: string
}) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
      <p className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</p>
      <p className="mt-1 text-2xl font-bold text-[#313131] tabular-nums">{value}</p>
      {hint ? <p className="mt-1 text-[10px] text-gray-400">{hint}</p> : null}
    </div>
  )
}

function ControlBlock({
  label,
  value,
  icon,
  children,
}: {
  label: string
  value?: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">{label}</p>
            {value ? <p className="mt-1 text-2xl font-bold text-[#313131] tabular-nums">{value}</p> : null}
          </div>
          {icon}
        </div>
      </div>
      <CardContent className="pt-4 pb-4">
        {children}
      </CardContent>
    </Card>
  )
}

function getFlowRouteOption(routeKey: FlowPermissionKey) {
  return FLOW_PERMISSION_OPTIONS.find((option) => option.key === routeKey)
}

/** Single destination slot: arrow from source + destination badge with toggle inside */
function FlowDestinationSlot({
  target,
  routeKey,
  enabled,
  flowValue,
  onToggle,
  isStatic,
  readOnly,
}: {
  target: FlowNodeKey
  routeKey?: FlowPermissionKey
  enabled: boolean
  flowValue: number
  onToggle?: () => void
  isStatic?: boolean
  readOnly?: boolean
}) {
  const Icon = FLOW_NODE_META[target].icon

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Vertical arrow with flow value */}
      <div className="relative flex w-6 flex-col items-center">
        {/* Arrow line */}
        <div className={cn('h-8 w-px', enabled ? 'bg-gray-800' : 'bg-gray-200')} />
        {/* Arrowhead */}
        <div className={cn('mt-[-2px] h-0 w-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px]', enabled ? 'border-t-gray-800' : 'border-t-gray-200')} />
        {/* Flow value badge on arrow */}
        <div className={cn(
          'absolute top-1/2 -translate-y-1/2 rounded px-1 py-0.5 text-[8px] font-semibold tabular-nums',
          enabled ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-400',
        )}>
          {formatCompactFlowKwh(flowValue)}
        </div>
      </div>

      {/* Destination badge with toggle inside */}
      <div
        className={cn(
          'flex w-full flex-col items-center justify-center gap-1 rounded-lg border px-2 py-1.5 transition-colors',
          enabled
            ? 'border-gray-200 bg-white text-gray-900'
            : 'border-gray-100 bg-gray-50 text-gray-400',
        )}
      >
        <span className={cn('flex h-5 w-5 items-center justify-center rounded-full', enabled ? 'bg-gray-100' : 'bg-gray-200')}>
          <Icon className={cn('h-2.5 w-2.5', enabled ? 'text-gray-700' : 'text-gray-400')} />
        </span>
        <span className="text-[8px] font-bold uppercase tracking-wider">{FLOW_NODE_META[target].label}</span>

        {/* Toggle inside the badge */}
        {isStatic || readOnly ? (
          <div className="mt-0.5 flex h-4 w-8 items-center justify-center rounded-full border border-gray-200 bg-gray-100 text-[7px] font-bold uppercase tracking-wider text-gray-400">
            {enabled ? 'On' : 'Off'}
          </div>
        ) : (
          <button
            type="button"
            onClick={onToggle}
            className={cn(
              'relative mt-0.5 h-4 w-7 rounded-full border transition-all',
              enabled
                ? 'border-gray-800 bg-gray-800'
                : 'border-gray-200 bg-white',
            )}
            title={routeKey ? getFlowRouteOption(routeKey)?.detail : undefined}
          >
            <span
              className={cn(
                'absolute top-1/2 h-2.5 w-2.5 -translate-y-1/2 rounded-full transition-all',
                enabled
                  ? 'right-0.5 bg-white'
                  : 'left-0.5 bg-gray-300',
              )}
            />
          </button>
        )}
      </div>
    </div>
  )
}

function FlowRouteCard({
  source,
  routes,
  permissions,
  onToggle,
  flowValues,
  pvCapacityWp,
  usableKwh,
  isSystemSelected = true,
  isNoSystemSelected = false,
  readOnly = false,
}: {
  permissions: FlowPermissions
  onToggle: (key: FlowPermissionKey) => void
  source: FlowNodeKey
  routes: Array<{ target: FlowNodeKey; routeKey?: FlowPermissionKey; isStatic?: boolean }>
  flowValues: DayFlowByRoute
  pvCapacityWp: number
  usableKwh: number
  isSystemSelected?: boolean
  isNoSystemSelected?: boolean
  readOnly?: boolean
}) {
  const meta = FLOW_NODE_META[source]
  const Icon = meta.icon

  // Check if asset is disabled (0 size)
  const isAssetDisabled = source === 'pv' ? pvCapacityWp === 0 : source === 'battery' ? usableKwh === 0 : false
  const isCardDisabled = source === 'grid'
    ? false
    : isNoSystemSelected || !isSystemSelected || isAssetDisabled
  const formatAssetSize = (value: number) => Number.isInteger(value) ? String(value) : value.toFixed(1)
  const assetSizeLabel =
    source === 'pv' && isSystemSelected && pvCapacityWp > 0
      ? `${formatAssetSize(pvCapacityWp / 1000)} kWp`
      : source === 'battery' && isSystemSelected && usableKwh > 0
        ? `${formatAssetSize(usableKwh)} kWh`
        : null

  return (
    <div className={cn(
      'rounded-2xl border border-gray-200 bg-white p-4 shadow-sm transition-opacity',
      isCardDisabled && 'opacity-50',
    )}>
      {/* Source header */}
      <div
        className={cn(
          'mb-3 flex flex-col items-center justify-center gap-1 rounded-xl px-4 py-2.5',
          isCardDisabled ? 'bg-gray-100 text-gray-400' : '',
        )}
        style={!isCardDisabled ? { backgroundColor: meta.background, color: meta.text } : {}}
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4" />
          <span className="text-[11px] font-bold uppercase tracking-[0.18em]">{meta.label}</span>
          {assetSizeLabel ? (
            <span
              className={cn(
                'rounded-full px-1.5 py-0.5 text-[9px] font-semibold tabular-nums',
                isCardDisabled ? 'bg-gray-200 text-gray-400' : 'bg-white/70 text-current',
              )}
            >
              {assetSizeLabel}
            </span>
          ) : null}
        </div>
      </div>

      {/* Destination slots */}
      <div className="flex justify-center gap-4">
        {routes.map((route) => {
          const flowValue = route.routeKey ? flowValues[route.routeKey] : flowValues.gridToHome
          const isEnabled = route.routeKey ? permissions[route.routeKey] : true
          const routeKey = route.routeKey

          return (
            <FlowDestinationSlot
              key={`${source}-${route.target}`}
              target={route.target}
              routeKey={routeKey}
              enabled={!isCardDisabled && isEnabled}
              flowValue={flowValue}
              onToggle={!readOnly && !isCardDisabled && routeKey ? () => onToggle(routeKey) : undefined}
              isStatic={route.isStatic}
              readOnly={readOnly}
            />
          )
        })}
      </div>
    </div>
  )
}

function HelpTooltip({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          aria-label={label}
          className="inline-flex h-4 w-4 items-center justify-center rounded-full text-gray-400 transition-colors hover:text-gray-700"
        >
          <CircleHelp className="h-3.5 w-3.5" />
        </button>
      </TooltipTrigger>
      <TooltipContent side="bottom" className="max-w-[260px] rounded-xl border-gray-200 bg-white p-3 text-[11px] leading-5 text-gray-600">
        {children}
      </TooltipContent>
    </Tooltip>
  )
}

function SectionHeading({
  eyebrow,
  title,
  help,
  icon,
}: {
  eyebrow: string
  title: string
  help?: ReactNode
  icon?: ReactNode
}) {
  return (
    <div className="mb-5 flex items-center justify-between gap-3">
      <div>
        <div className="flex items-center gap-2">
          <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">{eyebrow}</p>
          {help ? <HelpTooltip label={`${title} help`}>{help}</HelpTooltip> : null}
        </div>
        <p className="mt-1 text-[18px] font-bold tracking-tight text-[#313131]">{title}</p>
      </div>
      {icon}
    </div>
  )
}

function RangeControl({
  label,
  help,
  value,
  min,
  max,
  step,
  sliderValue,
  onChange,
  minLabel,
  maxLabel,
}: {
  label: string
  help?: ReactNode
  value: string
  min: number
  max: number
  step: number
  sliderValue: number
  onChange: (value: number) => void
  minLabel?: string
  maxLabel?: string
}) {
  // Split value and unit (e.g., "4,500 kWh" → value="4,500", unit="kWh")
  const valueParts = value.split(' ')
  const numericValue = valueParts[0]
  const unit = valueParts.slice(1).join(' ')

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-baseline justify-between h-8">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">{label}</span>
        <span className="text-2xl font-bold text-[#313131] tabular-nums">
          {numericValue}
          {unit && <span className="text-xs font-normal text-gray-400 ml-1">{unit}</span>}
        </span>
      </div>
      <div>
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={sliderValue}
          onChange={(event) => onChange(Number(event.target.value))}
          aria-label={`${label}: ${value}`}
          className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
        />
        {minLabel || maxLabel ? (
          <div className="flex justify-between text-[10px] text-gray-400 mt-1">
            <span>{minLabel}</span>
            <span>{maxLabel}</span>
          </div>
        ) : null}
      </div>
      {help && <p className="text-[10px] text-gray-400">{help}</p>}
    </div>
  )
}

function buildScenario(
  state: CalculatorState,
): PvBatteryCalculatorScenario {
  return {
    country: state.country,
    tariffId: state.tariffId,
    annualLoadKwh: state.annualLoadKwh,
    pvCapacityWp: state.pvCapacityWp,
    usableKwh: state.usableKwh,
    maxChargeKw: state.maxChargeKw,
    maxDischargeKw: state.maxDischargeKw,
    roundTripEff: state.roundTripEff,
    feedInCapKw: state.feedInCapKw,
    exportCompensationPct: MARKET_EXPORT_COMPENSATION_PCT,
    flowPermissions: state.flowPermissions,
  }
}

function AnnualHero({
  annual,
  units,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
}) {
  return (
    <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
      <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.1fr_0.9fr]">
        <div className="border-b border-gray-200 bg-white p-6 xl:border-b-0 xl:border-r">
          <div className="flex items-center gap-2">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Annual snapshot</p>
            <HelpTooltip label="Annual snapshot help">
              Baseline means the household buys every kWh from the tariff-adjusted grid import curve. The optimized case
              minimizes modeled net household energy cost using the selected tariff, market-priced export curve, and active flow permissions.
              Self-sufficiency is reported as an outcome metric, not as the dispatch objective.
            </HelpTooltip>
          </div>
          <div className="mt-5 flex items-end gap-3">
            <span className="text-4xl font-semibold tracking-tight text-gray-900">
              {units.currencySym}{Math.round(annual.savingsEur).toLocaleString()}
            </span>
            <span className="pb-1.5 text-sm font-medium text-emerald-700">per year</span>
          </div>

          <div className="mt-7 grid gap-4 sm:grid-cols-3">
            <MetricTile
              label="Self-sufficiency"
              value={`${annual.selfSufficiencyPct}%`}
              hint="Outcome metric, not the optimizer target."
            />
            <MetricTile
              label="Self-consumption"
              value={`${annual.selfConsumptionPct}%`}
              hint="Shows how much PV stays on site after dispatch."
            />
            <MetricTile
              label="Grid import left"
              value={`${Math.round(annual.gridImportKwh).toLocaleString()} kWh`}
              hint="Residual annual grid draw after PV and battery routing."
            />
          </div>
        </div>

        <div className="bg-[#F8F8F5] p-6">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Value stack</p>
          <div className="mt-5 space-y-4 text-sm text-gray-600">
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <span>Baseline annual import cost</span>
              <span className="font-semibold text-gray-900">{units.currencySym}{Math.round(annual.baselineCostEur)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <span>Residual grid import cost</span>
              <span className="font-semibold text-gray-900">{units.currencySym}{Math.round(annual.gridImportCostEur)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <span>Spot-priced export revenue</span>
              <span className="font-semibold text-blue-700">+{units.currencySym}{Math.round(annual.exportRevenueEur)}</span>
            </div>
            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
              <span>Net annual energy cost</span>
              <span className="font-semibold text-gray-900">{units.currencySym}{Math.round(annual.netCostEur)}</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span>Stored-then-exported PV</span>
              <span className="font-semibold text-gray-900">{Math.round(annual.batteryExportKwh).toLocaleString()} kWh</span>
            </div>
          </div>
          <p className="mt-5 text-[12px] leading-6 text-gray-500">
            Import costs follow the selected retail tariff. Export revenue follows the replayed market price curve. Dispatch stays within the active routing permissions.
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function normalizeCalculatorState(
  state: CalculatorState,
  availableYears: number[],
): CalculatorState {
  const loadProfileId = isAllowedDeLoadProfile(state.loadProfileId)
    ? state.loadProfileId
    : getDefaultCalculatorLoadProfileId(state.country)

  const availableTariffs = new Set(getTariffsFor(state.country).map((tariff) => tariff.id))
  const tariffId = availableTariffs.has(state.tariffId)
    ? state.tariffId
    : getDefaultTariffForCountry(state.country)

  const year = availableYears.length === 0 || availableYears.includes(state.year)
    ? state.year
    : availableYears[0]

  if (
    year === state.year &&
    loadProfileId === state.loadProfileId &&
    tariffId === state.tariffId
  ) {
    return state
  }

  return {
    ...state,
    year,
    loadProfileId,
    tariffId,
  }
}

function MonthlyBars({
  annual,
  units,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
}) {
  const maxValue = Math.max(...annual.months.map((month) => Math.max(month.savingsEur, month.exportRevenueEur, 1)), 1)

  return (
    <Card className="border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-6">
        <SectionHeading
          eyebrow="Monthly breakdown"
          title="Savings by month"
          help="Green is total annualized savings for that month. Blue isolates the export-value share inside the same month."
          icon={<LineChart className="h-5 w-5 text-gray-400" />}
        />

        <div className="space-y-3">
          {annual.months.map((month) => (
            <div key={month.month} className="grid grid-cols-[48px_minmax(0,1fr)_92px] items-center gap-3">
              <span className="text-sm font-medium text-gray-500">{formatMonthLabel(month.month)}</span>
              <div className="relative h-3 overflow-hidden rounded-full bg-[#ECEBE6]">
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-emerald-500/80"
                  style={{ width: `${Math.max((month.savingsEur / maxValue) * 100, 4)}%` }}
                />
                <div
                  className="absolute inset-y-0 left-0 rounded-full bg-blue-500/80"
                  style={{ width: `${Math.max((month.exportRevenueEur / maxValue) * 100, 2)}%` }}
                />
              </div>
              <span className="text-right text-sm font-semibold text-gray-900">
                {units.currencySym}{Math.round(month.savingsEur)}
              </span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}

function StatusCard({
  title,
  body,
  tone = 'neutral',
}: {
  title: string
  body: string
  tone?: 'neutral' | 'warning'
}) {
  return (
    <Card className={cn(
      'border-gray-200/80 shadow-sm',
      tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-gray-200',
    )}>
      <CardContent className="p-6">
        <p className={cn('text-sm font-medium', tone === 'warning' ? 'text-amber-900' : 'text-gray-900')}>{title}</p>
        <p className={cn('mt-2 text-sm leading-6', tone === 'warning' ? 'text-amber-800' : 'text-gray-600')}>{body}</p>
      </CardContent>
    </Card>
  )
}

function MutedNote({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-gray-50 px-4 py-3 text-[12px] leading-6 text-gray-600">
      {children}
    </div>
  )
}

function PvBatteryCalculatorInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const searchParamsString = searchParams.toString()
  const lastSyncedQueryRef = useRef(searchParamsString)
  const initialState = useMemo(
    () => parseState(new URLSearchParams(searchParamsString)),
    [searchParamsString],
  )
  const [draftState, setDraftState] = useState<CalculatorState>(initialState)

  useEffect(() => {
    lastSyncedQueryRef.current = searchParamsString
  }, [searchParamsString])

  useEffect(() => {
    // External URL changes need to replace the local draft state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDraftState((current) => (sameState(current, initialState) ? current : initialState))
  }, [initialState])

  const prices = usePrices(CALCULATOR_COUNTRY)
  const selectedDate = prices.selectedDate
  const setSelectedDate = prices.setSelectedDate
  const units = getPriceUnits(CALCULATOR_COUNTRY)
  const availableYears = useMemo(
    () => getAvailablePvBatteryYears(prices.hourly, prices.lastRealDate),
    [prices.hourly, prices.lastRealDate],
  )
  const state = useMemo(
    () => normalizeCalculatorState(draftState, availableYears),
    [draftState, availableYears],
  )
  const deferredState = useDeferredValue(state)
  const effectiveYear = state.year || availableYears[0] || new Date().getUTCFullYear()

  const tariffs = useMemo(() => getTariffsFor(CALCULATOR_COUNTRY), [])
  const loadProfileOptions = useMemo(
    () => DE_BATTERY_LOAD_PROFILES.filter((profile) => isAllowedDeLoadProfile(profile.id)),
    [],
  )
  const isPvSelected = state.pvCapacityWp > 0
  const isBatterySelected = state.usableKwh > 0
  const { loadProfile, pvProfile, loading: profilesLoading, error: profilesError } = useBatteryProfiles(
    CALCULATOR_COUNTRY,
    state.loadProfileId,
    effectiveYear,
  )
  const { data: radiationData, loading: radiationLoading } = usePvRadiation(
    state.pvZipCode || null,
    state.pvCapacityWp / 1000,
  )

  const yearDates = useMemo(() => {
    return prices.daily
      .filter((day) => day.date.slice(0, 4) === String(effectiveYear))
      .filter((day) => !prices.lastRealDate || day.date <= prices.lastRealDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [effectiveYear, prices.daily, prices.lastRealDate])

  useEffect(() => {
    const latestDate = yearDates[yearDates.length - 1]?.date
    if (!latestDate) return
    if (selectedDate && yearDates.some((day) => day.date === selectedDate)) return
    setSelectedDate(latestDate)
  }, [selectedDate, setSelectedDate, yearDates])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('tariff', state.tariffId)
    if (state.year) params.set('year', String(state.year))
    params.set('resolution', state.resolution)
    params.set('price', state.flowPriceMode)
    params.set('profile', state.loadProfileId)
    params.set('load', String(Math.round(state.annualLoadKwh)))
    params.set('pv', String(Math.round(state.pvCapacityWp)))
    if (state.pvZipCode) params.set('pvzip', state.pvZipCode)
    params.set('battery', String(state.usableKwh))
    params.set('charge', String(state.maxChargeKw))
    params.set('discharge', String(state.maxDischargeKw))
    params.set('eff', String(Number(state.roundTripEff.toFixed(2))))
    params.set('feedin', String(state.feedInCapKw))
    FLOW_PERMISSION_OPTIONS.forEach(({ key }) => {
      params.set(FLOW_PERMISSION_QUERY_KEYS[key], state.flowPermissions[key] ? '1' : '0')
    })
    if (selectedDate) params.set('date', selectedDate)
    const nextQuery = params.toString()
    if (nextQuery === searchParamsString) return
    if (nextQuery === lastSyncedQueryRef.current) return
    const timeoutId = window.setTimeout(() => {
      lastSyncedQueryRef.current = nextQuery
      router.replace(`/battery/calculator?${nextQuery}`, { scroll: false })
    }, 180)
    return () => window.clearTimeout(timeoutId)
  }, [router, searchParamsString, selectedDate, state])

  useEffect(() => {
    const urlDate = new URLSearchParams(searchParamsString).get('date')
    if (!urlDate || yearDates.length === 0) return
    if (!yearDates.some((day) => day.date === urlDate)) return
    setSelectedDate(urlDate)
  }, [searchParamsString, setSelectedDate, yearDates])

  const scenario = useMemo(
    () => buildScenario(deferredState),
    [deferredState],
  )

  const annualPrices = useMemo(() => {
    return prices.hourly
      .filter((point) => point.date.slice(0, 4) === String(effectiveYear))
      .filter((point) => !prices.lastRealDate || point.date <= prices.lastRealDate)
  }, [effectiveYear, prices.hourly, prices.lastRealDate])

  const radiationAdjustment = useMemo(() => {
    if (!radiationData) return null
    // Convert absolute radiation values to relative factors
    const avgMonthly = radiationData.annualTotal / 12
    const monthlyFactors = radiationData.monthlyRadiation.map(
      (monthly: number) => avgMonthly > 0 ? monthly / avgMonthly : 1.0
    )
    return { monthlyFactors }
  }, [radiationData])

  const annualResult = useMemo(() => {
    if (!loadProfile || !pvProfile || annualPrices.length === 0) return null
    return optimizePvBattery(
      buildPvBatteryInputs(annualPrices, loadProfile, pvProfile, scenario, radiationAdjustment),
      scenario,
    )
  }, [annualPrices, loadProfile, pvProfile, scenario, radiationAdjustment])

  const dayResult = useMemo(() => {
    if (!annualResult || !prices.selectedDate) return null
    const slots = annualResult.slots.filter((slot) => slot.date === prices.selectedDate)
    if (slots.length === 0) return null
    return {
      ...annualResult,
      months: [],
      slots,
    }
  }, [annualResult, prices.selectedDate])

  const loading = prices.loading || profilesLoading
  const noYearData = !loading && !prices.error && availableYears.length === 0
  const pendingFlowPermissionKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => state.flowPermissions[key] !== DEFAULT_FLOW_PERMISSIONS[key])
    .map(({ key }) => key)
  const disabledFlowKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => !state.flowPermissions[key])
    .map(({ key }) => key)
  const hasQuarterHourReplay = prices.hourlyQH.length > 0
  const replayResolutionOptions = [
    {
      label: '60 min',
      active: state.resolution === 'hour',
      onClick: () => setDraftState((current) => ({ ...current, resolution: 'hour' })),
    },
    {
      label: '15 min',
      active: state.resolution === 'quarterhour',
      disabled: !hasQuarterHourReplay,
      onClick: () => hasQuarterHourReplay && setDraftState((current) => ({ ...current, resolution: 'quarterhour' })),
    },
  ]
  const replayResolutionControls = <SegmentedPillGroup options={replayResolutionOptions} />
  const activeFlowKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => state.flowPermissions[key])
    .map(({ key }) => key)
  const activeFlowSummary = formatFlowPermissionList(activeFlowKeys)
  const disabledFlowConsequences = getDisabledFlowConsequences(state.flowPermissions)
  const annualPvToBatteryKwh = annualResult ? sumAnnualSlotMetric(annualResult, 'chargeToBatteryKwh') : 0
  const hasCustomFlowPermissions = pendingFlowPermissionKeys.length > 0
  const dayFlowValues = useMemo<DayFlowByRoute>(() => {
    if (!dayResult) {
      return {
        pvToLoad: 0,
        pvToBattery: 0,
        gridToBattery: 0,
        batteryToLoad: 0,
        pvToGrid: 0,
        batteryToGrid: 0,
        gridToHome: 0,
      }
    }
    return {
      pvToLoad: sumAnnualSlotMetric(dayResult, 'pvToLoadKwh'),
      pvToBattery: sumAnnualSlotMetric(dayResult, 'pvToBatteryKwh'),
      gridToBattery: sumAnnualSlotMetric(dayResult, 'gridToBatteryKwh'),
      batteryToLoad: sumAnnualSlotMetric(dayResult, 'batteryToLoadKwh'),
      pvToGrid: sumAnnualSlotMetric(dayResult, 'pvToGridKwh'),
      batteryToGrid: sumAnnualSlotMetric(dayResult, 'batteryExportKwh'),
      gridToHome: sumAnnualSlotMetric(dayResult, 'gridToLoadKwh'),
    }
  }, [dayResult])
  return (
    <TooltipProvider delayDuration={120}>
      <div className="min-h-screen bg-[#F5F5F2]">
        <header className="border-b border-gray-200 bg-white">
          <div className="mx-auto flex max-w-[1440px] flex-wrap items-center justify-between gap-3 px-4 py-2.5 sm:px-6 lg:px-8">
            <h1 className="text-sm font-semibold text-gray-400">PV + Battery Dynamic Tariff Calculator</h1>
            <nav className="flex flex-wrap items-center gap-2">
              <Link
                href="/battery"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
              >
                Battery business case
              </Link>
              <Link
                href="/v2"
                className="flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-[12px] font-semibold text-gray-600 transition-colors hover:bg-gray-50"
              >
                EV charging
              </Link>
              <span className="rounded-lg border border-[#313131] bg-[#313131] px-3 py-1.5 text-[12px] font-semibold text-white shadow-sm">
                PV + battery calculator
              </span>
            </nav>
          </div>
        </header>

        <main className="mx-auto max-w-[1440px] px-8 py-8">
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
            <aside className="order-2 space-y-4 lg:order-1">
              {/* Household Settings Card - always visible */}
              <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
                <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <p className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">Household settings</p>
                    </div>
                    <Home className="h-5 w-5 text-gray-400" />
                  </div>
                </div>
                <CardContent className="pt-4 pb-4">
                  <div className="space-y-4">
                    {/* Annual household demand - first */}
                    <RangeControl
                      label="Annual household demand"
                      value={`${Math.round(state.annualLoadKwh).toLocaleString()} kWh`}
                      min={1500}
                      max={15000}
                      step={250}
                      sliderValue={state.annualLoadKwh}
                      onChange={(value) => setDraftState((current) => ({ ...current, annualLoadKwh: value }))}
                      minLabel="1,500"
                      maxLabel="15,000"
                    />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Load profile
                        </label>
                        <span className="text-[10px] text-gray-400">H25 / P25 / S25</span>
                      </div>
                      <select
                        value={state.loadProfileId}
                        onChange={(event) => setDraftState((current) => ({
                          ...current,
                          loadProfileId: event.target.value as BatteryLoadProfileId,
                        }))}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-gray-400"
                      >
                        {loadProfileOptions.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.label}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Horizontal line + Assets toggles */}
                    <div className="border-t border-gray-200 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400 mb-3">
                        System
                      </p>
                      <div className="space-y-3">
                        <button
                          type="button"
                          onClick={() => {
                            if (isPvSelected) {
                              setDraftState((current) => ({ ...current, pvCapacityWp: 0 }))
                              return
                            }
                            if (state.pvCapacityWp === 0) {
                              setDraftState((current) => ({ ...current, pvCapacityWp: 8000 }))
                            }
                          }}
                          className={cn(
                            'flex w-full items-center justify-between rounded-lg border px-4 py-3 transition-colors',
                            isPvSelected
                              ? 'border-gray-900 bg-gray-50 text-gray-900'
                              : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <SunMedium className={cn('h-5 w-5', isPvSelected ? 'text-gray-900' : 'text-gray-500')} />
                            <div className="text-left">
                              <p className={cn('text-sm font-semibold', isPvSelected ? 'text-gray-900' : 'text-gray-700')}>
                                PV system
                              </p>
                              <p className="text-[11px] text-gray-500">
                                {isPvSelected ? `${(state.pvCapacityWp / 1000).toFixed(1)} kWp configured` : 'Not selected'}
                              </p>
                            </div>
                          </div>
                          <span className={cn('text-xs font-medium', isPvSelected ? 'text-gray-900' : 'text-gray-500')}>
                            {isPvSelected ? '−' : '+'}
                          </span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isBatterySelected) {
                              setDraftState((current) => ({ ...current, usableKwh: 0 }))
                              return
                            }
                            if (state.usableKwh === 0) {
                              setDraftState((current) => ({ ...current, usableKwh: 10 }))
                            }
                          }}
                          className={cn(
                            'flex w-full items-center justify-between rounded-lg border px-4 py-3 transition-colors',
                            isBatterySelected
                              ? 'border-gray-900 bg-gray-50 text-gray-900'
                              : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50',
                          )}
                        >
                          <div className="flex items-center gap-3">
                            <BatteryCharging className={cn('h-5 w-5', isBatterySelected ? 'text-gray-900' : 'text-gray-500')} />
                            <div className="text-left">
                              <p className={cn('text-sm font-semibold', isBatterySelected ? 'text-gray-900' : 'text-gray-700')}>
                                Battery storage
                              </p>
                              <p className="text-[11px] text-gray-500">
                                {isBatterySelected ? `${state.usableKwh.toFixed(1)} kWh configured` : 'Not selected'}
                              </p>
                            </div>
                          </div>
                          <span className={cn('text-xs font-medium', isBatterySelected ? 'text-gray-900' : 'text-gray-500')}>
                            {isBatterySelected ? '−' : '+'}
                          </span>
                        </button>
                      </div>
                    </div>

                    {/* Dynamic tariff - after horizontal line */}
                    <div className="border-t border-gray-200 pt-4 space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Dynamic tariff
                        </label>
                        <span className="text-[10px] text-gray-400">Germany only</span>
                      </div>
                      <select
                        value={state.tariffId}
                        onChange={(event) => setDraftState((current) => ({ ...current, tariffId: event.target.value }))}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-gray-400"
                      >
                        {tariffs.map((tariff) => (
                          <option key={tariff.id} value={tariff.id}>
                            {tariff.label}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                </CardContent>
              </Card>

              {/* PV Card - conditionally shown */}
              {isPvSelected && (
                <ControlBlock
                  label="PV system"
                  icon={<SunMedium className="h-5 w-5 text-gray-400" />}
                >
                  <div className="space-y-4">
                    <RangeControl
                      label="PV capacity"
                      value={`${(state.pvCapacityWp / 1000).toFixed(1)} kWp`}
                      min={0}
                      max={20000}
                      step={500}
                      sliderValue={state.pvCapacityWp}
                      onChange={(value) => setDraftState((current) => ({ ...current, pvCapacityWp: value }))}
                      minLabel="0"
                      maxLabel="20 kWp"
                    />

                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                          Zip code
                        </label>
                        {radiationData && (
                          <span className="text-[10px] text-gray-400">
                            {radiationData.location.region}
                          </span>
                        )}
                      </div>
                      <input
                        type="text"
                        maxLength={5}
                        placeholder="e.g., 10115 (Berlin)"
                        value={state.pvZipCode}
                        onChange={(event) => {
                          const value = event.target.value.replace(/\D/g, '').slice(0, 5)
                          setDraftState((current) => ({ ...current, pvZipCode: value }))
                        }}
                        className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-gray-400"
                      />
                      {radiationLoading && (
                        <p className="text-[10px] text-gray-400">Loading radiation data...</p>
                      )}
                      {radiationData && !radiationData.isDefault && (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 text-[11px] text-emerald-800">
                          <p className="font-semibold">PVGIS data loaded</p>
                          <p className="mt-1">
                            Annual yield: <span className="font-medium">{Math.round(radiationData.annualTotal)} kWh/kWp</span>
                          </p>
                        </div>
                      )}
                      {radiationData && radiationData.isDefault && (
                        <p className="text-[10px] text-amber-600">
                          Using default German radiation values (PVGIS unavailable)
                        </p>
                      )}
                    </div>

                    <div className="space-y-2 border-t border-gray-200 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">PV flow routing</p>
                      <FlowRouteCard
                        source="pv"
                        routes={[
                          { target: 'home', routeKey: 'pvToLoad' },
                          { target: 'battery', routeKey: 'pvToBattery' },
                          { target: 'grid', routeKey: 'pvToGrid' },
                        ]}
                        permissions={state.flowPermissions}
                        flowValues={dayFlowValues}
                        onToggle={(key) => setDraftState((current) => ({
                          ...current,
                          flowPermissions: {
                            ...current.flowPermissions,
                            [key]: !current.flowPermissions[key],
                          },
                        }))}
                        pvCapacityWp={state.pvCapacityWp}
                        usableKwh={0}
                        isSystemSelected={isPvSelected}
                      />
                    </div>
                  </div>
                </ControlBlock>
              )}

              {/* Battery Card - conditionally shown */}
              {isBatterySelected && (
                <ControlBlock
                  label="Battery storage"
                  icon={<BatteryCharging className="h-5 w-5 text-gray-400" />}
                >
                  <div className="space-y-4">
                    <RangeControl
                      label="Usable capacity"
                      value={`${state.usableKwh.toFixed(1)} kWh`}
                      min={0}
                      max={20}
                      step={0.5}
                      sliderValue={state.usableKwh}
                      onChange={(value) => setDraftState((current) => ({ ...current, usableKwh: value }))}
                      minLabel="0"
                      maxLabel="20 kWh"
                    />

                    <div className="grid gap-4 sm:grid-cols-2">
                      <RangeControl
                        label="Charge power"
                        value={`${state.maxChargeKw.toFixed(1)} kW`}
                        min={1}
                        max={15}
                        step={0.5}
                        sliderValue={state.maxChargeKw}
                        onChange={(value) => setDraftState((current) => ({ ...current, maxChargeKw: value }))}
                      />

                      <RangeControl
                        label="Discharge power"
                        value={`${state.maxDischargeKw.toFixed(1)} kW`}
                        min={1}
                        max={15}
                        step={0.5}
                        sliderValue={state.maxDischargeKw}
                        onChange={(value) => setDraftState((current) => ({ ...current, maxDischargeKw: value }))}
                      />
                    </div>

                    <RangeControl
                      label="Round-trip efficiency"
                      value={`${Math.round(state.roundTripEff * 100)}%`}
                      min={0.75}
                      max={0.96}
                      step={0.01}
                      sliderValue={state.roundTripEff}
                      onChange={(value) => setDraftState((current) => ({ ...current, roundTripEff: value }))}
                      minLabel="75%"
                      maxLabel="96%"
                    />

                    <div className="flex items-center justify-between rounded-lg border border-gray-200 bg-gray-50 p-3">
                      <div>
                        <p className="text-sm font-semibold text-gray-900">Plug-In</p>
                        <p className="text-[11px] text-gray-500">Restricts export to 800 W</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-checked={state.feedInCapKw <= 0.8}
                        onClick={() => setDraftState((current) => ({
                          ...current,
                          feedInCapKw: current.feedInCapKw <= 0.8 ? 5 : 0.8,
                        }))}
                        className={cn(
                          'relative inline-flex h-6 w-11 items-center rounded-full transition-colors',
                          state.feedInCapKw <= 0.8 ? 'bg-gray-900' : 'bg-gray-300',
                        )}
                      >
                        <span
                          className={cn(
                            'inline-block h-5 w-5 transform rounded-full bg-white transition-transform',
                            state.feedInCapKw <= 0.8 ? 'translate-x-5' : 'translate-x-1',
                          )}
                        />
                      </button>
                    </div>

                    <div className="space-y-2 border-t border-gray-200 pt-4">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Battery flow routing</p>
                      <div className="grid gap-3 md:grid-cols-2">
                        <FlowRouteCard
                          source="battery"
                          routes={[
                            { target: 'home', routeKey: 'batteryToLoad' },
                            { target: 'grid', routeKey: 'batteryToGrid' },
                          ]}
                          permissions={state.flowPermissions}
                          flowValues={dayFlowValues}
                          onToggle={(key) => setDraftState((current) => ({
                            ...current,
                            flowPermissions: {
                              ...current.flowPermissions,
                              [key]: !current.flowPermissions[key],
                            },
                          }))}
                          pvCapacityWp={0}
                          usableKwh={state.usableKwh}
                          isSystemSelected={isBatterySelected}
                        />
                        <FlowRouteCard
                          source="grid"
                          routes={[
                            { target: 'battery', routeKey: 'gridToBattery' },
                          ]}
                          permissions={state.flowPermissions}
                          flowValues={dayFlowValues}
                          onToggle={(key) => setDraftState((current) => ({
                            ...current,
                            flowPermissions: {
                              ...current.flowPermissions,
                              [key]: !current.flowPermissions[key],
                            },
                          }))}
                          pvCapacityWp={0}
                          usableKwh={0}
                          isSystemSelected={isBatterySelected}
                        />
                      </div>
                    </div>
                  </div>
                </ControlBlock>
              )}

            </aside>

            <section className="order-1 space-y-4 lg:order-2 lg:col-span-3">
              {loading ? (
                <StatusCard title="Loading calculator inputs" body="Fetching German price history and bundled household profiles." />
              ) : prices.error ? (
                <StatusCard title="Price data could not be loaded" body={prices.error} tone="warning" />
              ) : profilesError ? (
                <StatusCard title="Profile data could not be loaded" body={profilesError} tone="warning" />
              ) : noYearData ? (
                <StatusCard
                  title="No complete annual replay is available"
                  body="The calculator needs a full year of German market prices before it can build an annual estimate."
                  tone="warning"
                />
              ) : annualResult ? (
                <>
                  <AnnualHero annual={annualResult} units={units} />
                  <MonthlyBars annual={annualResult} units={units} />
                  <PvBatteryDayChart
                    annualResult={dayResult}
                    dayLabel={formatDayLabel(prices.selectedDate)}
                    units={units}
                    priceCurveMode={state.flowPriceMode}
                    loading={prices.loading}
                    controls={(
                      <div className="space-y-3">
                        <div className="overflow-hidden rounded-lg border border-gray-200/80 bg-white">
                          <div className="px-4 py-3">
                            <DateStrip
                              daily={yearDates}
                              selectedDate={prices.selectedDate}
                              onSelect={prices.setSelectedDate}
                              latestDate={yearDates[yearDates.length - 1]?.date}
                              requireNextDay={false}
                              forecastAfter={prices.lastRealDate || undefined}
                              country={CALCULATOR_COUNTRY}
                            />
                          </div>
                        </div>

                      </div>
                    )}
                    householdControls={replayResolutionControls}
                    priceControls={(
                      <div className="flex flex-wrap gap-2">
                        <SegmentedPillGroup
                          options={[
                            {
                              label: 'Spot',
                              active: state.flowPriceMode === 'spot',
                              onClick: () => setDraftState((current) => ({ ...current, flowPriceMode: 'spot' })),
                            },
                            {
                              label: 'End',
                              active: state.flowPriceMode === 'end',
                              onClick: () => setDraftState((current) => ({ ...current, flowPriceMode: 'end' })),
                            },
                          ]}
                        />
                        <SegmentedPillGroup
                          options={[
                            ...replayResolutionOptions,
                          ]}
                        />
                      </div>
                    )}
                  />

                </>
              ) : (
                <StatusCard
                  title="No complete estimate could be built"
                  body="Try a different year or tariff. The annual replay needs a full price year and matching profile data."
                  tone="warning"
                />
              )}
            </section>
          </div>
        </main>
      </div>
    </TooltipProvider>
  )
}

export function PvBatteryCalculator() {
  return (
    <Suspense>
      <PvBatteryCalculatorInner />
    </Suspense>
  )
}
