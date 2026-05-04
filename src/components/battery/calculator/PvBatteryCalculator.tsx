'use client'

import Link from 'next/link'
import { Suspense, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Battery, BatteryCharging, CircleHelp, Gauge, Home, LineChart, SunMedium, Zap, type LucideIcon } from 'lucide-react'

import { ConsumptionPriceBlockCard } from '@/components/battery/calculator/ConsumptionPriceBlockCard'
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
  optimizePvBatteryWithOptions,
  type PvBatteryAnnualResult,
  type PvBatteryCalculatorScenario,
  type PvBatteryCountry,
  type PvBatteryFlowPermissions,
  type PvBatteryPlannerAssumptions,
  type PvBatteryPlanningModel,
  type PvBatteryResolution,
} from '@/lib/pv-battery-calculator'
import { optimizePvBatteryRollingReplay } from '@/lib/pv-battery-rolling-replay'
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
  planningModel: PvBatteryPlanningModel
  year: number
  viewHours: 24 | 48 | 72
  resolution: PvBatteryResolution
  flowPriceMode: 'spot' | 'end'
  loadProfileId: BatteryLoadProfileId
  annualLoadKwh: number
  pvCapacityWp: number
  pvZipCode: string
  usableKwh: number
  initialSocKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number
  feedInCapKw: number
  flowPermissions: FlowPermissions
}

function sameState(a: CalculatorState, b: CalculatorState): boolean {
  return a.country === b.country
    && a.tariffId === b.tariffId
    && a.planningModel === b.planningModel
    && a.year === b.year
    && a.viewHours === b.viewHours
    && a.resolution === b.resolution
    && a.flowPriceMode === b.flowPriceMode
    && a.loadProfileId === b.loadProfileId
    && a.annualLoadKwh === b.annualLoadKwh
    && a.pvCapacityWp === b.pvCapacityWp
    && a.pvZipCode === b.pvZipCode
    && a.usableKwh === b.usableKwh
    && a.initialSocKwh === b.initialSocKwh
    && a.maxChargeKw === b.maxChargeKw
    && a.maxDischargeKw === b.maxDischargeKw
    && a.roundTripEff === b.roundTripEff
    && a.feedInCapKw === b.feedInCapKw
    && FLOW_PERMISSION_OPTIONS.every(({ key }) => a.flowPermissions[key] === b.flowPermissions[key])
}

const DEFAULT_STATE: CalculatorState = {
  country: CALCULATOR_COUNTRY,
  tariffId: 'enviam-vision',
  planningModel: 'deterministic',
  year: 0,
  viewHours: 24,
  resolution: 'quarterhour',
  flowPriceMode: 'spot',
  loadProfileId: 'H25',
  annualLoadKwh: 4500,
  pvCapacityWp: 8000,
  pvZipCode: '',
  usableKwh: 10,
  initialSocKwh: 5,
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
  const planningModel: PvBatteryPlanningModel = params.get('model') === 'rolling' ? 'rolling' : 'deterministic'
  const parsedYear = Number(params.get('year'))
  const tariffIds = new Set(getTariffsFor(country).map((tariff) => tariff.id))
  const tariffId = tariffIds.has(params.get('tariff') ?? '')
    ? (params.get('tariff') as string)
    : getDefaultTariffForCountry(country)
  const resolution = params.get('resolution') === 'hour' ? 'hour' : 'quarterhour'
  const rawViewHours = Number(params.get('hours'))
  const viewHours: 24 | 48 | 72 = rawViewHours === 48 || rawViewHours === 72 ? rawViewHours : 24
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
  const usableKwh = getNum('battery', DEFAULT_STATE.usableKwh, 0, 20)
  const initialSocDefault = usableKwh > 0 ? usableKwh / 2 : 0

  return {
    country,
    tariffId,
    planningModel,
    year: Number.isFinite(parsedYear) ? parsedYear : 0,
    viewHours,
    resolution,
    flowPriceMode,
    loadProfileId,
    annualLoadKwh: getNum('load', DEFAULT_STATE.annualLoadKwh, 1500, 15000),
    pvCapacityWp: getNum('pv', DEFAULT_STATE.pvCapacityWp, 0, 20000),
    pvZipCode,
    usableKwh,
    initialSocKwh: getNum('soc', initialSocDefault, 0, Math.max(usableKwh, 0)),
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

function getPlanningModelLabel(planningModel: PvBatteryPlanningModel): string {
  return planningModel === 'rolling'
    ? 'Rolling day-ahead planner'
    : 'Deterministic replay'
}

function getPlanningModelSummary(planningModel: PvBatteryPlanningModel): string {
  return planningModel === 'rolling'
    ? 'Rebuilds the year as a stitched chain of publication-time runs. Each run knows the remaining day plus the next day, commits only until the next 12:00 replan, and returns to its starting SoC by horizon end.'
    : 'Uses the full selected replay year in one deterministic solve. This is the current audit baseline: one horizon, full hindsight, and a free terminal SoC.'
}

function getPvForecastSourceLabel(pvZipCode: string): string {
  return pvZipCode
    ? 'Existing PV profile plus location-based radiation adjustment'
    : 'Existing PV profile plus default German radiation adjustment'
}

function buildPlannerAssumptions({
  planningModel,
  loadProfileLabel,
  tariffLabel,
  pvZipCode,
}: {
  planningModel: PvBatteryPlanningModel
  loadProfileLabel: string
  tariffLabel: string
  pvZipCode: string
}): PvBatteryPlannerAssumptions {
  const pvForecastSource = getPvForecastSourceLabel(pvZipCode)
  const tariffBasis = `${tariffLabel} retail import tariff with ${getAutomaticExportLabel(CALCULATOR_COUNTRY)} export valuation`

  if (planningModel === 'rolling') {
    return {
      objective: 'Minimize modeled household net electricity cost',
      loadForecastSource: 'H25 household load forecast',
      pvForecastSource,
      priceSource: 'Historical day-ahead replay, replanned on publication events',
      tariffBasis,
      replanCadence: 'Year-start bootstrap, then daily replanning at 12:00',
      terminalRule: 'Each run must end with the same SoC it started with',
    }
  }

  return {
    objective: 'Minimize modeled household net electricity cost',
    loadForecastSource: `${loadProfileLabel} standard load replay`,
    pvForecastSource,
    priceSource: 'Historical full-year replay solved in one pass',
    tariffBasis,
    replanCadence: 'Single full-horizon replay',
    terminalRule: 'Free terminal SoC at the end of the selected year',
  }
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
  arrowDirection = 'down',
}: {
  target: FlowNodeKey
  routeKey?: FlowPermissionKey
  enabled: boolean
  flowValue: number
  onToggle?: () => void
  isStatic?: boolean
  readOnly?: boolean
  arrowDirection?: 'down' | 'up'
}) {
  const Icon = FLOW_NODE_META[target].icon

  return (
    <div className="flex flex-col items-center gap-1">
      {/* Vertical arrow with flow value */}
      <div className="relative flex w-6 flex-col items-center">
        {arrowDirection === 'down' ? (
          <>
            <div className={cn('h-8 w-px', enabled ? 'bg-gray-800' : 'bg-gray-200')} />
            <div className={cn('mt-[-2px] h-0 w-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-t-[6px]', enabled ? 'border-t-gray-800' : 'border-t-gray-200')} />
          </>
        ) : (
          <>
            <div className={cn('h-0 w-0 border-l-[4px] border-l-transparent border-r-[4px] border-r-transparent border-b-[6px]', enabled ? 'border-b-gray-800' : 'border-b-gray-200')} />
            <div className={cn('mt-[-2px] h-8 w-px', enabled ? 'bg-gray-800' : 'bg-gray-200')} />
          </>
        )}
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
  unboxed = false,
  spread = false,
}: {
  permissions: FlowPermissions
  onToggle: (key: FlowPermissionKey) => void
  source: FlowNodeKey
  routes: Array<{ target: FlowNodeKey; routeKey?: FlowPermissionKey; isStatic?: boolean; arrowDirection?: 'down' | 'up' }>
  flowValues: DayFlowByRoute
  pvCapacityWp: number
  usableKwh: number
  isSystemSelected?: boolean
  isNoSystemSelected?: boolean
  readOnly?: boolean
  unboxed?: boolean
  spread?: boolean
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
      'w-full p-4 transition-opacity',
      !unboxed && 'rounded-2xl border border-gray-200 bg-white shadow-sm',
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
      <div className={cn('flex w-full', spread ? 'justify-between gap-6' : 'justify-center gap-4')}>
        {routes.map((route) => {
          const flowValue = route.routeKey ? flowValues[route.routeKey] : flowValues.gridToHome
          const isEnabled = route.routeKey ? permissions[route.routeKey] : true
          const routeKey = route.routeKey

          return (
            <div
              key={`${source}-${route.target}-${routeKey ?? route.arrowDirection ?? 'static'}`}
              className={cn(spread && 'flex-1')}
            >
              <FlowDestinationSlot
                target={route.target}
                routeKey={routeKey}
                enabled={!isCardDisabled && isEnabled}
                flowValue={flowValue}
              onToggle={!readOnly && !isCardDisabled && routeKey ? () => onToggle(routeKey) : undefined}
              isStatic={route.isStatic}
              readOnly={readOnly}
              arrowDirection={route.arrowDirection ?? 'down'}
            />
          </div>
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

type AllocationBucketKey = 'gridDirect' | 'pvDirect' | 'pvStored' | 'gridStored'
type AllocationDisplayMode = 'volume' | 'impact'
type AllocationVolumeMode = 'abs' | 'share'
type AllocationMetricKind = 'kwh' | 'share' | 'ct' | 'eur'

interface AllocationBucket {
  key: AllocationBucketKey
  label: string
  shortLabel: string
  detail: string
  kwh: number
  sharePct: number
  unitCostCtKwh: number
  totalCostEur: number
  costContributionCtKwh: number
  baselineCostShareEur: number
  impactDeltaCtKwh: number
  impactDeltaEur: number
  color: string
}

interface WaterfallChartColumn {
  key: string
  shortLabel: string
  label: string
  type: 'delta' | 'total'
  color: string
  priceCtKwh: number
  braceLabel?: string
  braceDetailLabel?: string
  fillSegments?: Array<{ color: string; ratio: number; striped?: boolean }>
  footerLines?: string[]
  separatorBefore?: boolean
  overlay?: {
    fromValue: number
    toValue: number
    label: string
    color: string
  }
  annotation?: {
    value: number
    label: string
    color: string
    dashed?: boolean
  }
  startValue?: number
  endValue?: number
  deltaValue?: number
  totalValue?: number
}

function formatSignedCt(value: number, priceUnit: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${Math.abs(value).toFixed(2)} ${priceUnit}`
}

function formatSignedCurrency(value: number, currencySym: string): string {
  const sign = value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${currencySym}${Math.abs(value).toFixed(0)}`
}

function formatMetricValue(
  value: number,
  kind: AllocationMetricKind,
  units: ReturnType<typeof getPriceUnits>,
): string {
  if (kind === 'share') return `${value.toFixed(1)}%`
  if (kind === 'kwh') return `${Math.round(value).toLocaleString()} kWh`
  if (kind === 'ct') return `${value.toFixed(2)} ${units.priceUnit}`
  return `${units.currencySym}${value.toFixed(0)}`
}

function formatMetricDelta(
  value: number,
  kind: AllocationMetricKind,
  units: ReturnType<typeof getPriceUnits>,
): string {
  if (kind === 'share') return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}%`
  if (kind === 'kwh') return `${value >= 0 ? '+' : '-'}${Math.abs(Math.round(value)).toLocaleString()} kWh`
  if (kind === 'ct') return formatSignedCt(value, units.priceUnit)
  return formatSignedCurrency(value, units.currencySym)
}

function getMetricAxisLabel(kind: AllocationMetricKind, units: ReturnType<typeof getPriceUnits>): string {
  if (kind === 'share') return '% of household'
  if (kind === 'kwh') return 'Delivered kWh'
  if (kind === 'ct') return units.priceUnit
  return `${units.currencySym} / year`
}

function formatCenteredPriceLabel(value: number, units: ReturnType<typeof getPriceUnits>): string {
  return `${value.toFixed(2)} ${units.priceUnit}`
}

function formatBracePriceLabel(value: number, priceUnit: string): string {
  return `${value.toFixed(1)} ${priceUnit}`
}

function formatBraceDetailLabel(
  valueEur: number,
  sharePct: number | null,
  volumeMode: AllocationVolumeMode,
  units: ReturnType<typeof getPriceUnits>,
): string {
  const costLabel = formatMetricValue(valueEur, 'eur', units)
  if (volumeMode === 'share' && sharePct !== null) return `${costLabel} / ${sharePct.toFixed(1)}%`
  return costLabel
}

function stripedFill(color: string): string {
  return `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 8px, rgba(255,255,255,0.55) 8px, rgba(255,255,255,0.55) 12px)`
}

const ALLOCATION_SCENE_NODE_LAYOUT: Record<FlowNodeKey, {
  left: string
  top: string
  label: string
  eyebrow?: string
  emphasis?: 'normal' | 'hero'
}> = {
  grid: {
    left: '12%',
    top: '46%',
    label: 'Grid',
    eyebrow: 'Import + export',
  },
  pv: {
    left: '50%',
    top: '16%',
    label: 'PV',
    eyebrow: 'On-site generation',
  },
  battery: {
    left: '50%',
    top: '82%',
    label: 'Battery',
    eyebrow: 'Shifted energy',
  },
  home: {
    left: '84%',
    top: '50%',
    label: 'Household load',
    eyebrow: 'Delivered destination',
    emphasis: 'hero',
  },
}

function getAllocationSceneWidth(sharePct: number, maxSharePct: number): number {
  const normalized = maxSharePct > 0 ? sharePct / maxSharePct : 0
  return 8 + (normalized * 12)
}

function formatScenePriceBadge(
  entry: { kind: 'bucket'; bucket: AllocationBucket } | { kind: 'export'; exportRevenueEur: number; exportAvgCt: number },
  units: ReturnType<typeof getPriceUnits>,
): string {
  if (entry.kind === 'export') return `+${units.currencySym}${entry.exportRevenueEur.toFixed(0)} rev.`
  return `${entry.bucket.unitCostCtKwh.toFixed(2)} ${units.priceUnit}`
}

function formatSceneStats(kwh: number, sharePct: number): string {
  return `${Math.round(kwh).toLocaleString()} kWh · ${sharePct.toFixed(1)}%`
}

function AllocationSceneNode({
  node,
}: {
  node: FlowNodeKey
}) {
  const meta = ALLOCATION_SCENE_NODE_LAYOUT[node]
  const iconMeta = FLOW_NODE_META[node]
  const Icon = iconMeta.icon
  const iconSize = meta.emphasis === 'hero' ? 'h-6 w-6' : 'h-5 w-5'
  const shellSize = meta.emphasis === 'hero' ? 'h-18 w-18' : 'h-14 w-14'

  return (
    <div
      className="absolute -translate-x-1/2 -translate-y-1/2"
      style={{ left: meta.left, top: meta.top }}
    >
      <div className="flex flex-col items-center">
        <div
          className={cn(
            'relative flex items-center justify-center rounded-full border border-white/80 bg-white/82 backdrop-blur-md shadow-[0_20px_40px_rgba(15,23,42,0.14)]',
            shellSize,
          )}
          style={{
            boxShadow: `0 20px 40px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.85)`,
          }}
        >
          <div
            className={cn('flex items-center justify-center rounded-full', meta.emphasis === 'hero' ? 'h-14 w-14' : 'h-12 w-12')}
            style={{ backgroundColor: iconMeta.background, color: iconMeta.text }}
          >
            <Icon className={iconSize} />
          </div>
        </div>
        {meta.eyebrow ? (
          <p className="mt-2.5 text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">{meta.eyebrow}</p>
        ) : null}
        <p className={cn(
          'mt-1 whitespace-nowrap text-[11px] font-semibold tracking-[0.01em] text-slate-900',
          meta.emphasis === 'hero' && 'text-[12px]',
        )}>
          {meta.label}
        </p>
      </div>
    </div>
  )
}

function AllocationSceneLane({
  path,
  color,
  width,
  striped = false,
  speedSeconds = 6,
}: {
  path: string
  color: string
  width: number
  striped?: boolean
  speedSeconds?: number
}) {
  const dotCount = Math.max(2, Math.min(3, Math.round(width / 5)))

  return (
    <>
      <path
        d={path}
        fill="none"
        stroke="rgba(148,163,184,0.14)"
        strokeWidth={width + 2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={width}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d={path}
        fill="none"
        stroke="rgba(255,255,255,0.24)"
        strokeWidth={Math.max(width * 0.14, 1.2)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {striped ? (
        <path
          d={path}
          fill="none"
          stroke="rgba(255,255,255,0.74)"
          strokeWidth={Math.max(width * 0.12, 1.2)}
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="10 10"
        />
      ) : null}
      {Array.from({ length: dotCount }, (_, index) => (
        <circle
          key={`${path}-dot-${index}`}
          r={Math.max(width * 0.09, 1.6)}
          fill="rgba(255,255,255,0.78)"
          opacity={0.95 - (index * 0.12)}
        >
          <animateMotion
            dur={`${speedSeconds}s`}
            repeatCount="indefinite"
            begin={`${index * (speedSeconds / dotCount)}s`}
            path={path}
            rotate="auto"
          />
        </circle>
      ))}
    </>
  )
}

function AllocationSceneCaption({
  title,
  statsLine,
  badge,
  accentColor,
  left,
  top,
  tooltip,
  align = 'left',
}: {
  title: string
  statsLine: string
  badge: string
  accentColor: string
  left: string
  top: string
  tooltip: ReactNode
  align?: 'left' | 'center' | 'right'
}) {
  const translateClass = align === 'center'
    ? '-translate-x-1/2'
    : align === 'right'
      ? '-translate-x-full'
      : ''

  return (
    <div
      className={cn('absolute pointer-events-none', translateClass)}
      style={{ left, top }}
    >
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            className="pointer-events-auto rounded-2xl border border-white/80 bg-white/78 px-2.5 py-2 text-left shadow-[0_16px_32px_rgba(15,23,42,0.10)] backdrop-blur-md transition-transform duration-200 hover:-translate-y-0.5"
          >
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 h-8 w-1.5 rounded-full" style={{ backgroundColor: accentColor }} />
              <div className="min-w-[124px]">
                <p className="text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">{title}</p>
                <p className="mt-1 text-[11px] font-semibold tabular-nums text-slate-900">{statsLine}</p>
                <span
                  className="mt-2 inline-flex rounded-full px-2.5 py-1 text-[9px] font-semibold tabular-nums text-slate-700"
                  style={{ backgroundColor: `${accentColor}1F` }}
                >
                  {badge}
                </span>
              </div>
            </div>
          </button>
        </TooltipTrigger>
        <TooltipContent side="top" className="max-w-[280px] rounded-2xl border-gray-200 bg-white p-3 text-[11px] leading-5 text-gray-600">
          {tooltip}
        </TooltipContent>
      </Tooltip>
    </div>
  )
}

function DeliveredAllocationScene({
  visibleBuckets,
  showExportBucket,
  stats,
  units,
}: {
  visibleBuckets: AllocationBucket[]
  showExportBucket: boolean
  stats: {
    deliveredLoadKwh: number
    exportKwh: number
    exportRevenueEur: number
    exportAvgCt: number
  }
  units: ReturnType<typeof getPriceUnits>
}) {
  const exportSharePct = (stats.exportKwh / Math.max(stats.deliveredLoadKwh, 1e-6)) * 100
  const maxSharePct = Math.max(
    ...visibleBuckets.map((bucket) => bucket.sharePct),
    showExportBucket ? exportSharePct : 0,
    1,
  )

  const laneSpecs = visibleBuckets.flatMap((bucket) => {
    const laneWidth = getAllocationSceneWidth(bucket.sharePct, maxSharePct)
    if (bucket.key === 'gridDirect') {
      return [{ key: bucket.key, path: 'M192 280 L 748 280', color: bucket.color, width: laneWidth }]
    }
    if (bucket.key === 'pvDirect') {
      return [{ key: bucket.key, path: 'M500 118 L 500 188 Q 500 236 548 236 L 748 236', color: bucket.color, width: laneWidth }]
    }
    if (bucket.key === 'pvStored') {
      return [
        { key: `${bucket.key}-charge`, path: 'M484 132 L 484 404', color: bucket.color, width: laneWidth },
        { key: `${bucket.key}-serve`, path: 'M516 404 Q 560 328 622 312 L 748 312', color: bucket.color, width: laneWidth },
      ]
    }
    return [
      { key: `${bucket.key}-charge`, path: 'M206 320 Q 280 398 460 424', color: bucket.color, width: laneWidth },
      { key: `${bucket.key}-serve`, path: 'M520 424 Q 608 332 664 328 L 748 328', color: bucket.color, width: laneWidth },
    ]
  })

  const captionSpecs = visibleBuckets.map((bucket) => {
    const tooltip = (
      <div className="space-y-1.5">
        <p className="font-medium text-slate-900">{bucket.detail}</p>
        <p>Modeled cost: {units.currencySym}{bucket.totalCostEur.toFixed(0)}</p>
        <p>Baseline-equivalent share: {units.currencySym}{bucket.baselineCostShareEur.toFixed(0)}</p>
        <p>Impact vs baseline: {formatMetricDelta(bucket.impactDeltaCtKwh, 'ct', units)}</p>
      </div>
    )

    if (bucket.key === 'gridDirect') {
      return {
        key: bucket.key,
        left: '24%',
        top: '36%',
        align: 'left' as const,
        accentColor: bucket.color,
        title: bucket.shortLabel,
        statsLine: formatSceneStats(bucket.kwh, bucket.sharePct),
        badge: formatScenePriceBadge({ kind: 'bucket', bucket }, units),
        tooltip,
      }
    }
    if (bucket.key === 'pvDirect') {
      return {
        key: bucket.key,
        left: '50%',
        top: '26%',
        align: 'center' as const,
        accentColor: bucket.color,
        title: bucket.shortLabel,
        statsLine: formatSceneStats(bucket.kwh, bucket.sharePct),
        badge: formatScenePriceBadge({ kind: 'bucket', bucket }, units),
        tooltip,
      }
    }
    if (bucket.key === 'pvStored') {
      return {
        key: bucket.key,
        left: '34%',
        top: '64%',
        align: 'center' as const,
        accentColor: bucket.color,
        title: bucket.shortLabel,
        statsLine: formatSceneStats(bucket.kwh, bucket.sharePct),
        badge: formatScenePriceBadge({ kind: 'bucket', bucket }, units),
        tooltip,
      }
    }
    return {
      key: bucket.key,
      left: '63%',
      top: '66%',
      align: 'left' as const,
      accentColor: bucket.color,
      title: bucket.shortLabel,
      statsLine: formatSceneStats(bucket.kwh, bucket.sharePct),
      badge: formatScenePriceBadge({ kind: 'bucket', bucket }, units),
      tooltip,
    }
  })

  const mobileEntries = visibleBuckets.map((bucket) => ({
    key: bucket.key,
    title: bucket.shortLabel,
    route: bucket.label,
    sharePct: bucket.sharePct,
    kwh: bucket.kwh,
    color: bucket.color,
    badge: formatScenePriceBadge({ kind: 'bucket', bucket }, units),
    tooltip: bucket.detail,
  }))

  if (showExportBucket) {
    laneSpecs.push({
      key: 'export',
      path: 'M468 132 Q 430 184 344 214 L 192 214',
      color: '#67B7D1',
      width: getAllocationSceneWidth(exportSharePct, maxSharePct),
      striped: true,
    })
    captionSpecs.push({
      key: 'export',
      left: '24%',
      top: '19%',
      align: 'left' as const,
      accentColor: '#67B7D1',
      title: 'Grid export',
      statsLine: formatSceneStats(stats.exportKwh, exportSharePct),
      badge: formatScenePriceBadge({
        kind: 'export',
        exportRevenueEur: stats.exportRevenueEur,
        exportAvgCt: stats.exportAvgCt,
      }, units),
      tooltip: (
        <div className="space-y-1.5">
          <p className="font-medium text-slate-900">Outbound export goes to the grid and stays outside the delivered-load mix so revenue does not read like a household supply path.</p>
          <p>Export volume: {Math.round(stats.exportKwh).toLocaleString()} kWh</p>
          <p>Average export value: {stats.exportAvgCt.toFixed(2)} {units.priceUnit}</p>
          <p>Revenue: +{units.currencySym}{stats.exportRevenueEur.toFixed(0)}</p>
        </div>
      ),
    })
    mobileEntries.push({
      key: 'export',
      title: 'Export',
      route: 'PV -> grid export',
      sharePct: exportSharePct,
      kwh: stats.exportKwh,
      color: '#67B7D1',
      badge: formatScenePriceBadge({
        kind: 'export',
        exportRevenueEur: stats.exportRevenueEur,
        exportAvgCt: stats.exportAvgCt,
      }, units),
      tooltip: 'Outbound branch kept separate from delivered household supply.',
      striped: true,
    })
  }

  return (
    <div className="mt-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Flow allocation scene</p>
          <p className="mt-1 text-sm font-semibold text-slate-900">Power map with straighter rails, faster dots on larger flows, and compact frosted cards.</p>
        </div>
      </div>

      <div className="mt-4 hidden overflow-hidden rounded-[30px] border border-slate-200/80 bg-[linear-gradient(180deg,#fdfdfd_0%,#f6f8fb_100%)] md:block">
        <div className="relative aspect-[16/9]">
          <svg viewBox="0 0 1000 560" className="h-full w-full" aria-hidden="true">
            <defs>
              <linearGradient id="allocation-scene-sky" x1="0" y1="0" x2="1" y2="1">
                <stop offset="0%" stopColor="#FFFFFF" />
                <stop offset="100%" stopColor="#F0F4FA" />
              </linearGradient>
            </defs>
            <rect x="0" y="0" width="1000" height="560" fill="url(#allocation-scene-sky)" />
            <path d="M150 280 L 770 280" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            <path d="M500 118 L 500 430" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            <path d="M770 150 L 770 410" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            {laneSpecs.map((lane) => (
              <AllocationSceneLane
                key={lane.key}
                path={lane.path}
                color={lane.color}
                width={lane.width}
                striped={lane.striped}
                speedSeconds={Math.max(1.8, 6.6 - (lane.width * 0.24))}
              />
            ))}
          </svg>

          <div className="absolute inset-0">
            {(['grid', 'pv', 'battery', 'home'] as const).map((node) => (
              <AllocationSceneNode key={node} node={node} />
            ))}
            {captionSpecs.map((caption) => (
              <AllocationSceneCaption
                key={caption.key}
                title={caption.title}
                statsLine={caption.statsLine}
                badge={caption.badge}
                accentColor={caption.accentColor}
                left={caption.left}
                top={caption.top}
                align={caption.align}
                tooltip={caption.tooltip}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:hidden">
        {mobileEntries.map((entry) => (
          <Tooltip key={entry.key}>
            <TooltipTrigger asChild>
              <button
                type="button"
                className="rounded-[22px] border border-slate-200 bg-white px-4 py-3 text-left shadow-sm"
              >
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-400">{entry.title}</p>
                    <p className="mt-1 text-sm font-semibold text-slate-900">{entry.route}</p>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-2.5 py-1 text-[10px] font-semibold tabular-nums text-slate-700"
                    style={{ background: entry.striped ? stripedFill('#67B7D1') : `${entry.color}1F` }}
                  >
                    {entry.badge}
                  </span>
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${Math.min(Math.max(entry.sharePct, 4), 100)}%`,
                        background: entry.striped ? stripedFill('#67B7D1') : entry.color,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums text-slate-600">{entry.sharePct.toFixed(1)}%</span>
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-slate-500">{Math.round(entry.kwh).toLocaleString()} kWh annual flow</p>
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="max-w-[260px] rounded-2xl border-gray-200 bg-white p-3 text-[11px] leading-5 text-gray-600">
              {entry.tooltip}
            </TooltipContent>
          </Tooltip>
        ))}
      </div>
    </div>
  )
}

function isDarkColumnColor(color: string): boolean {
  const normalized = color.replace('#', '')
  if (normalized.length !== 6) return false
  const r = Number.parseInt(normalized.slice(0, 2), 16)
  const g = Number.parseInt(normalized.slice(2, 4), 16)
  const b = Number.parseInt(normalized.slice(4, 6), 16)
  const luminance = ((0.299 * r) + (0.587 * g) + (0.114 * b)) / 255
  return luminance < 0.52
}

function DeliveredAllocationCard({
  annual,
  units,
  flowPermissions,
  isPvSelected,
  isBatterySelected,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
  flowPermissions: FlowPermissions
  isPvSelected: boolean
  isBatterySelected: boolean
}) {
  const [displayMode, setDisplayMode] = useState<AllocationDisplayMode>('volume')
  const [volumeMode, setVolumeMode] = useState<AllocationVolumeMode>('abs')

  const asFinite = (value: number, fallback = 0) => (Number.isFinite(value) ? value : fallback)
  const stats = useMemo(() => {
    const totals = annual.slots.reduce((acc, slot) => {
      acc.gridDirectKwh += slot.gridToLoadKwh
      acc.pvDirectKwh += slot.pvToLoadKwh
      acc.pvStoredKwh += slot.batteryPvToLoadKwh
      acc.gridStoredKwh += slot.batteryGridToLoadKwh
      acc.baselineCostEur += slot.baselineCostEur
      acc.exportRevenueEur += slot.exportRevenueEur
      acc.gridDirectCostEur += (slot.gridToLoadKwh * slot.importPriceCtKwh) / 100
      acc.gridStoredInputCostEur += asFinite(slot.batteryGridLoadInputCostEur, 0)
      return acc
    }, {
      gridDirectKwh: 0,
      pvDirectKwh: 0,
      pvStoredKwh: 0,
      gridStoredKwh: 0,
      baselineCostEur: 0,
      exportRevenueEur: 0,
      gridDirectCostEur: 0,
      gridStoredInputCostEur: 0,
    })

    const deliveredLoadKwh =
      totals.gridDirectKwh +
      totals.pvDirectKwh +
      totals.pvStoredKwh +
      totals.gridStoredKwh
    const safeLoadKwh = Math.max(deliveredLoadKwh, 1e-6)
    const gridDirectCt = totals.gridDirectKwh > 0 ? (totals.gridDirectCostEur * 100) / totals.gridDirectKwh : 0
    const gridStoredCt = totals.gridStoredKwh > 0 ? (totals.gridStoredInputCostEur * 100) / totals.gridStoredKwh : 0
    const baselineAvgCt = (totals.baselineCostEur * 100) / safeLoadKwh
    const grossDeliveredCostEur = totals.gridDirectCostEur + totals.gridStoredInputCostEur
    const grossDeliveredCt = (grossDeliveredCostEur * 100) / safeLoadKwh
    const exportKwh = annual.directExportKwh + annual.batteryExportKwh
    const exportAvgCt = exportKwh > 0 ? (totals.exportRevenueEur * 100) / exportKwh : 0

    const buckets: AllocationBucket[] = [
      {
        key: 'gridDirect',
        label: 'Residual grid -> Load',
        shortLabel: 'Residual grid',
        detail: 'Only the household demand still served directly from the grid after PV and battery routing.',
        kwh: totals.gridDirectKwh,
        sharePct: (totals.gridDirectKwh / safeLoadKwh) * 100,
        unitCostCtKwh: gridDirectCt,
        totalCostEur: totals.gridDirectCostEur,
        costContributionCtKwh: (totals.gridDirectCostEur * 100) / safeLoadKwh,
        baselineCostShareEur: (totals.gridDirectKwh * baselineAvgCt) / 100,
        impactDeltaCtKwh: 0,
        impactDeltaEur: 0,
        color: '#7D8797',
      },
      {
        key: 'pvDirect',
        label: 'PV -> Load',
        shortLabel: 'PV',
        detail: 'Direct PV supply to the household, priced at 0.00 ct/kWh marginal view.',
        kwh: totals.pvDirectKwh,
        sharePct: (totals.pvDirectKwh / safeLoadKwh) * 100,
        unitCostCtKwh: 0,
        totalCostEur: 0,
        costContributionCtKwh: 0,
        baselineCostShareEur: (totals.pvDirectKwh * baselineAvgCt) / 100,
        impactDeltaCtKwh: 0,
        impactDeltaEur: 0,
        color: '#E9B94A',
      },
      {
        key: 'pvStored',
        label: 'PV -> Battery -> Load',
        shortLabel: 'PV via battery',
        detail: 'Household load delivered later from stored PV energy.',
        kwh: totals.pvStoredKwh,
        sharePct: (totals.pvStoredKwh / safeLoadKwh) * 100,
        unitCostCtKwh: 0,
        totalCostEur: 0,
        costContributionCtKwh: 0,
        baselineCostShareEur: (totals.pvStoredKwh * baselineAvgCt) / 100,
        impactDeltaCtKwh: 0,
        impactDeltaEur: 0,
        color: '#D9B24E',
      },
      {
        key: 'gridStored',
        label: 'Grid -> Battery -> Load',
        shortLabel: 'Spot battery',
        detail: 'Low-price grid charging shifted through the battery into household load.',
        kwh: totals.gridStoredKwh,
        sharePct: (totals.gridStoredKwh / safeLoadKwh) * 100,
        unitCostCtKwh: gridStoredCt,
        totalCostEur: totals.gridStoredInputCostEur,
        costContributionCtKwh: (totals.gridStoredInputCostEur * 100) / safeLoadKwh,
        baselineCostShareEur: (totals.gridStoredKwh * baselineAvgCt) / 100,
        impactDeltaCtKwh: 0,
        impactDeltaEur: 0,
        color: '#2F6FB3',
      },
    ]

    for (const bucket of buckets) {
      bucket.impactDeltaEur = bucket.totalCostEur - bucket.baselineCostShareEur
      bucket.impactDeltaCtKwh = (bucket.impactDeltaEur * 100) / safeLoadKwh
    }

    return {
      deliveredLoadKwh,
      baselineCostEur: totals.baselineCostEur,
      baselineAvgCt,
      buckets,
      grossDeliveredCostEur,
      grossDeliveredCt,
      exportRevenueEur: totals.exportRevenueEur,
      exportKwh,
      exportAvgCt,
      exportCreditCtEquivalent: totals.exportRevenueEur > 0 ? (totals.exportRevenueEur * 100) / safeLoadKwh : 0,
      overallNetEquivalentCt: (annual.netCostEur * 100) / safeLoadKwh,
      overallNetCostEur: annual.netCostEur,
    }
  }, [annual])

  const chartMetric = useMemo<AllocationMetricKind>(() => {
    if (displayMode === 'impact') return 'ct'
    return volumeMode === 'abs' ? 'kwh' : 'share'
  }, [displayMode, volumeMode])

  const visibleBuckets = useMemo(() => {
    const orderedKeys: AllocationBucketKey[] = ['gridDirect', 'pvDirect', 'pvStored', 'gridStored']
    return orderedKeys
      .map((key) => stats.buckets.find((bucket) => bucket.key === key))
      .filter((bucket): bucket is AllocationBucket => {
        if (!bucket || bucket.kwh <= 1e-6) return false
        if (bucket.key === 'gridDirect') return true
        if (bucket.key === 'pvDirect') return isPvSelected && flowPermissions.pvToLoad
        if (bucket.key === 'pvStored') return isPvSelected && isBatterySelected && flowPermissions.pvToBattery && flowPermissions.batteryToLoad
        return isBatterySelected && flowPermissions.gridToBattery && flowPermissions.batteryToLoad
      })
  }, [flowPermissions, isBatterySelected, isPvSelected, stats.buckets])

  const showExportBucket = useMemo(
    () => stats.exportKwh > 1e-6 && (
      (isPvSelected && flowPermissions.pvToGrid) || (isBatterySelected && flowPermissions.batteryToGrid)
    ),
    [flowPermissions, isBatterySelected, isPvSelected, stats.exportKwh],
  )

  const chartSeries = useMemo(() => {
    let columns: WaterfallChartColumn[] = []
    let title = ''
    let description = ''
    let totalLabel = ''

    if (displayMode === 'volume') {
      const usesAbsoluteBasis = volumeMode === 'abs'
      const basisMetric: AllocationMetricKind = usesAbsoluteBasis ? 'kwh' : 'share'
      const basisLabel = usesAbsoluteBasis ? 'delivered household kWh' : 'share of household load'
      const totalBasisValue = usesAbsoluteBasis ? stats.deliveredLoadKwh : 100
      const exportBasisValue = usesAbsoluteBasis
        ? stats.exportKwh
        : ((stats.exportKwh / Math.max(stats.deliveredLoadKwh, 1e-6)) * 100)

      title = usesAbsoluteBasis ? 'Delivered household volume build-up' : 'Delivered household volume share build-up'
      description = `Each bar adds its ${basisLabel} until the household total, with export shown separately to the right. Braces carry average ${units.priceUnit}, with annual cost directly underneath.`
      totalLabel = formatMetricValue(totalBasisValue, basisMetric, units)

      let running = 0
      for (const bucket of visibleBuckets) {
        const basisValue = usesAbsoluteBasis ? bucket.kwh : bucket.sharePct
        columns.push({
          key: bucket.key,
          shortLabel: bucket.shortLabel,
          label: bucket.label,
          type: 'delta',
          color: bucket.color,
          priceCtKwh: bucket.unitCostCtKwh,
          braceLabel: formatBracePriceLabel(bucket.unitCostCtKwh, units.priceUnit),
          braceDetailLabel: formatBraceDetailLabel(bucket.totalCostEur, volumeMode === 'share' ? bucket.sharePct : null, volumeMode, units),
          fillSegments: [{ color: bucket.color, ratio: 1 }],
          footerLines: [],
          startValue: running,
          endValue: running + basisValue,
          deltaValue: basisValue,
        })
        running += basisValue
      }

      columns.push({
        key: 'total',
        shortLabel: 'Household',
        label: 'Household total',
        type: 'total',
        color: '#111827',
        priceCtKwh: stats.grossDeliveredCt,
        braceLabel: formatBracePriceLabel(stats.grossDeliveredCt, units.priceUnit),
        braceDetailLabel: formatBraceDetailLabel(stats.grossDeliveredCostEur, volumeMode === 'share' ? 100 : null, volumeMode, units),
        fillSegments: [{ color: '#111827', ratio: 1 }],
        footerLines: [],
        totalValue: running,
      })

      if (showExportBucket) {
        columns.push({
          key: 'export',
          shortLabel: 'Export',
          label: 'Export outside household total',
          type: 'total',
          color: '#67B7D1',
          priceCtKwh: stats.exportAvgCt,
          braceLabel: formatBracePriceLabel(stats.exportAvgCt, units.priceUnit),
          braceDetailLabel: volumeMode === 'share'
            ? `${formatSignedCurrency(-stats.exportRevenueEur, units.currencySym)} / ${exportBasisValue.toFixed(1)}%`
            : formatSignedCurrency(-stats.exportRevenueEur, units.currencySym),
          fillSegments: [{ color: '#67B7D1', ratio: 1, striped: true }],
          footerLines: [],
          separatorBefore: true,
          totalValue: exportBasisValue,
        })
      }
    } else {
      const baselineValue = stats.baselineAvgCt
      title = 'Baseline to final household price in ct/kWh'
      description = 'Starts from the all-household grid-only baseline, then each delivered bucket reduces or increases the average household price until export credit reaches the final result. Residual grid means only the load still bought directly from the grid after PV and battery routing.'
      totalLabel = formatMetricValue(stats.overallNetEquivalentCt, 'ct', units)

      columns = [{
        key: 'baseline',
        shortLabel: 'Baseline',
        label: 'All-household grid-only baseline',
        type: 'total',
        color: '#CBD5E1',
        priceCtKwh: stats.baselineAvgCt,
        fillSegments: [{ color: '#CBD5E1', ratio: 1 }],
        totalValue: baselineValue,
      }]

      let running = baselineValue
      const impactColumns = visibleBuckets.map((bucket) => ({
        key: bucket.key,
        shortLabel: bucket.shortLabel,
        label: bucket.label,
        deltaValue: bucket.impactDeltaCtKwh,
        color: bucket.color,
        priceCtKwh: bucket.unitCostCtKwh,
        fillSegments: [{ color: bucket.color, ratio: 1 }],
      }))

      for (const column of impactColumns) {
        columns.push({
          key: column.key,
          shortLabel: column.shortLabel,
          label: column.label,
          type: 'delta',
          color: column.color,
          priceCtKwh: column.priceCtKwh,
          fillSegments: column.fillSegments,
          startValue: running,
          endValue: running + column.deltaValue,
          deltaValue: column.deltaValue,
          annotation: Math.abs(column.deltaValue) > 1e-6
            ? {
              value: Math.max(running, running + column.deltaValue),
              label: formatSignedCt(column.deltaValue, units.priceUnit),
              color: column.deltaValue < 0 ? '#B45309' : '#374151',
              dashed: false,
            }
            : undefined,
        })
        running += column.deltaValue
      }

      columns.push({
        key: 'gross',
        shortLabel: 'Gross household',
        label: 'Household total',
        type: 'total',
        color: '#111827',
        priceCtKwh: stats.grossDeliveredCt,
        fillSegments: [{ color: '#111827', ratio: 1 }],
        totalValue: running,
      })
      const exportDelta = -stats.exportCreditCtEquivalent
      const finalValue = running + exportDelta
      columns.push({
        key: 'final',
        shortLabel: 'Final household',
        label: 'Final household result',
        type: 'total',
        color: '#0F766E',
        priceCtKwh: stats.overallNetEquivalentCt,
        fillSegments: [{ color: '#0F766E', ratio: 1 }],
        separatorBefore: true,
        overlay: {
          fromValue: 0,
          toValue: running,
          label: formatSignedCt(-stats.exportCreditCtEquivalent, units.priceUnit),
          color: '#67B7D1',
        },
        totalValue: finalValue,
      })
    }

    const extrema = columns.flatMap((column) => {
      if (column.type === 'total') return [column.totalValue ?? 0]
      return [column.startValue ?? 0, column.endValue ?? 0]
    })
    const minValue = Math.min(0, ...extrema)
    const maxValue = Math.max(1, ...extrema)
    const range = Math.max(maxValue - minValue, 1)
    const valueToPct = (value: number) => ((value - minValue) / range) * 100

    return {
      title,
      description,
      totalLabel,
      columns,
      minValue,
      maxValue,
      valueToPct,
    }
  }, [displayMode, showExportBucket, stats, units, visibleBuckets, volumeMode])

  const usesBridgeBraceLabels = displayMode === 'volume'
  const chartMinWidthPx = chartSeries.columns.length * (usesBridgeBraceLabels ? 132 : 108)

  return (
    <Card className="border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-0">
        <div className="border-b border-gray-100 px-5 py-4 sm:px-7 sm:py-5">
          <div className="grid gap-4 lg:grid-cols-[minmax(220px,0.9fr)_minmax(0,2.1fr)] lg:items-center">
            <div className="pt-0.5">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-400">Cost Allocation</p>
              <p className="mt-1 text-[24px] font-semibold tracking-tight text-slate-900">Delivered allocation</p>
              <p className="mt-2 max-w-[38rem] text-[12px] leading-5 text-slate-500">
                Compare delivered household supply paths and their modeled impact without nesting the chart inside a second card surface.
              </p>
            </div>
            <div className="min-w-0">
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 xl:grid-cols-4">
                {visibleBuckets.map((bucket) => (
                  <div key={`${bucket.key}-summary`} className="rounded-lg border border-gray-200 bg-white px-3 py-2.5">
                    <p className="text-[9px] font-semibold uppercase tracking-wide text-gray-500">{bucket.shortLabel}</p>
                    <p className="mt-1 text-[12px] font-semibold tabular-nums text-slate-900">{Math.round(bucket.kwh).toLocaleString()} kWh</p>
                    <p className="mt-1 text-[10px] leading-4 text-gray-500">{bucket.sharePct.toFixed(1)}% of delivered load</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>

        <div className="pl-4 pr-2 pb-4 pt-3 sm:pl-5 sm:pr-3">
          <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-sm font-semibold text-gray-900">{chartSeries.title}</p>
              <p className="mt-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
                {getMetricAxisLabel(chartMetric, units)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2 pb-1 lg:justify-end">
              <SegmentedPillGroup
                options={[
                  {
                    label: 'Volume',
                    active: displayMode === 'volume',
                    onClick: () => setDisplayMode('volume'),
                  },
                  {
                    label: 'Impact',
                    active: displayMode === 'impact',
                    onClick: () => setDisplayMode('impact'),
                  },
                ]}
              />
              {displayMode === 'volume' ? (
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-400">Bar basis</span>
                  <SegmentedPillGroup
                    options={[
                      {
                        label: 'Abs. kWh',
                        active: volumeMode === 'abs',
                        onClick: () => setVolumeMode('abs'),
                      },
                      {
                        label: '%',
                        active: volumeMode === 'share',
                        onClick: () => setVolumeMode('share'),
                      },
                    ]}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="grid grid-cols-[68px_minmax(0,1fr)] items-start gap-3">
            <div className="relative h-[340px]">
              {[0, 0.25, 0.5, 0.75, 1].map((ratio) => {
                const value = chartSeries.minValue + ((chartSeries.maxValue - chartSeries.minValue) * ratio)
                return (
                  <div
                    key={`${chartMetric}-axis-${ratio}`}
                    className="absolute inset-x-0"
                    style={{ bottom: `${ratio * 100}%` }}
                  >
                    <span className="absolute right-0 top-[-10px] text-[10px] tabular-nums text-gray-400">
                      {formatMetricValue(value, chartMetric, units)}
                    </span>
                  </div>
                )
              })}
            </div>

            <div className="overflow-x-auto overflow-y-visible pb-1 pt-8 -mt-8">
              <div className="space-y-2" style={{ minWidth: `${chartMinWidthPx}px` }}>
                <div className="relative h-[340px]">
                  {[0, 0.25, 0.5, 0.75, 1].map((ratio) => (
                    <div
                      key={`${chartMetric}-grid-${ratio}`}
                      className="absolute inset-x-0 border-t border-dashed border-gray-200"
                      style={{ bottom: `${ratio * 100}%` }}
                    />
                  ))}
                  <div
                    className="absolute inset-x-0 border-t-2 border-gray-500"
                    style={{ bottom: `${chartSeries.valueToPct(0)}%` }}
                  />

                  <div
                    className="absolute inset-0 grid gap-3"
                    style={{ gridTemplateColumns: `repeat(${chartSeries.columns.length}, minmax(0, 1fr))` }}
                  >
                    {chartSeries.columns.map((column, index) => {
                          const previousColumn = index > 0 ? chartSeries.columns[index - 1] : null
                          const isImpactChart = displayMode === 'impact'
                          const isZeroValue = column.type === 'total'
                            ? Math.abs(column.totalValue ?? 0) < 1e-6
                            : Math.abs(column.deltaValue ?? 0) < 1e-6
                          const lowValue = column.type === 'total'
                            ? Math.min(0, column.totalValue ?? 0)
                            : Math.min(column.startValue ?? 0, column.endValue ?? 0)
                          const highValue = column.type === 'total'
                            ? Math.max(0, column.totalValue ?? 0)
                            : Math.max(column.startValue ?? 0, column.endValue ?? 0)
                          const lowPct = chartSeries.valueToPct(lowValue)
                          const highPct = chartSeries.valueToPct(highValue)
                          const barHeightPct = isZeroValue ? 0 : Math.max(highPct - lowPct, 1.8)
                          const showCenteredPrice = false
                          const overlayLowValue = column.overlay
                            ? Math.min(column.overlay.fromValue, column.overlay.toValue)
                            : 0
                          const overlayHighValue = column.overlay
                            ? Math.max(column.overlay.fromValue, column.overlay.toValue)
                            : 0
                          const overlayLowPct = chartSeries.valueToPct(overlayLowValue)
                          const overlayHighPct = chartSeries.valueToPct(overlayHighValue)
                          const overlayBarHeightPct = Math.max(overlayHighPct - overlayLowPct, 1.8)
                          const overlayLabelLowValue = column.overlay
                            ? Math.max(column.totalValue ?? 0, column.overlay.fromValue)
                            : 0
                          const overlayLabelHighValue = column.overlay
                            ? column.overlay.toValue
                            : 0
                          const overlayLabelLowPct = chartSeries.valueToPct(overlayLabelLowValue)
                          const overlayLabelHighPct = chartSeries.valueToPct(overlayLabelHighValue)
                          const overlayLabelHeightPct = Math.max(overlayLabelHighPct - overlayLabelLowPct, 0)
                          const showOverlayLabel = overlayLabelHeightPct >= 9
                          const annotationPct = column.annotation
                            ? chartSeries.valueToPct(column.annotation.value)
                            : 0
                          const topValueLabel = displayMode === 'volume'
                            ? (
                              column.key === 'export'
                                ? formatMetricValue(stats.exportKwh, 'kwh', units)
                                : formatMetricValue(
                                  column.type === 'total' ? (column.totalValue ?? 0) : Math.abs(column.deltaValue ?? 0),
                                  chartMetric,
                                  units,
                                )
                            )
                            : null
                          const showImpactTopLabel = isImpactChart
                            && column.type === 'total'
                            && ['baseline', 'gross', 'final'].includes(column.key)
                          const impactRunningLabel = showImpactTopLabel
                            ? formatMetricValue(column.totalValue ?? 0, 'ct', units)
                            : null
                          const impactDeltaInBarLabel = isImpactChart && column.type === 'delta' && Math.abs(column.deltaValue ?? 0) > 1e-6
                            ? formatSignedCt(column.deltaValue ?? 0, units.priceUnit)
                            : null
                          const showImpactDeltaOutside = Boolean(impactDeltaInBarLabel) && barHeightPct < 14
                          const impactDeltaCenteredLabel = showImpactDeltaOutside ? null : impactDeltaInBarLabel
                          const impactDeltaOutsideLabel = showImpactDeltaOutside ? impactDeltaInBarLabel : null
                          const connectorValue = previousColumn
                            ? (
                              previousColumn.type === 'total'
                                ? (previousColumn.totalValue ?? 0)
                                : (previousColumn.endValue ?? 0)
                            )
                            : null
                          const connectorPct = connectorValue === null ? 0 : chartSeries.valueToPct(connectorValue)
                          const showImpactConnector = isImpactChart
                            && Boolean(previousColumn)
                            && !column.separatorBefore
                            && connectorValue !== null
                          const darkLabel = isDarkColumnColor(column.color)
                          const showExternalPrice = false
                          const showBridgeBraceLabel = usesBridgeBraceLabels && Boolean(column.braceLabel)
                          const braceHeightPct = Math.min(Math.max(barHeightPct, 5.5), 100)
                          const braceMidPct = (lowPct + highPct) / 2
                          const braceBottomPct = Math.max(Math.min(braceMidPct - (braceHeightPct / 2), 100 - braceHeightPct), 0)
                          const barLeftInsetPx = 24
                          const barRightInsetPx = showBridgeBraceLabel ? 58 : 24
                          const barFrameStyle = {
                            left: `${barLeftInsetPx}px`,
                            right: `${barRightInsetPx}px`,
                          }

                      return (
                        <div key={column.key} className="relative">
                            {showImpactConnector ? (
                              <div
                                className="absolute left-[-12px] w-[36px] border-t-2 border-dashed border-gray-400"
                                style={{ bottom: `${connectorPct}%` }}
                              />
                            ) : null}
                            {column.separatorBefore ? (
                              <div className="absolute bottom-0 left-[-8px] top-0 border-l-2 border-dashed border-gray-500" />
                            ) : null}
                            {displayMode !== 'volume' && column.annotation?.dashed ? (
                              <div
                                className="absolute border-t-2 border-dashed"
                                style={{
                                  ...barFrameStyle,
                                  bottom: `${annotationPct}%`,
                                  borderColor: column.annotation.color,
                                }}
                              />
                            ) : null}
                            {displayMode === 'volume' && topValueLabel && !isZeroValue ? (
                              <div
                                className="absolute z-10 flex justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{
                                  ...barFrameStyle,
                                  bottom: `calc(${Math.min(highPct, 100)}% + 8px)`,
                                }}
                              >
                                <span className="whitespace-nowrap rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-gray-700 shadow-sm">
                                  {topValueLabel}
                                </span>
                              </div>
                            ) : null}
                            {impactRunningLabel && !isZeroValue ? (
                              <div
                                className="absolute inset-x-1 z-20 flex justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{ bottom: `calc(${Math.min(highPct, 100)}% + 8px)` }}
                              >
                                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-gray-900 shadow-sm">
                                  {impactRunningLabel}
                                </span>
                              </div>
                            ) : null}
                            {impactDeltaOutsideLabel ? (
                              <div
                                className="absolute inset-x-1 z-20 flex justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{ bottom: `calc(${Math.max(lowPct, 0)}% - 22px)` }}
                              >
                                <span className="rounded-full border border-gray-200 bg-white/95 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-gray-600 shadow-sm">
                                  {impactDeltaOutsideLabel}
                                </span>
                              </div>
                            ) : null}
                            {showBridgeBraceLabel ? (
                              <div
                                className="pointer-events-none absolute z-20 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{
                                  bottom: `${braceBottomPct}%`,
                                  height: `${braceHeightPct}%`,
                                  right: '4px',
                                  width: '54px',
                                }}
                              >
                                <div className="absolute left-0 top-[1px] h-px w-3 bg-gray-300" />
                                <div className="absolute bottom-[1px] left-0 h-px w-3 bg-gray-300" />
                                <div className="absolute bottom-[1px] left-3 top-[1px] w-px bg-gray-300" />
                                <div className="absolute left-4 top-1/2 -translate-y-1/2">
                                  <div className="flex flex-col gap-1">
                                    <span className="whitespace-nowrap rounded-full border border-gray-200 bg-white/95 px-1.5 py-0.5 text-[9px] font-semibold tabular-nums text-gray-700 shadow-sm">
                                      {column.braceLabel}
                                    </span>
                                    {column.braceDetailLabel ? (
                                      <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50/95 px-1.5 py-0.5 text-[8px] font-medium tabular-nums text-slate-500 shadow-sm">
                                        {column.braceDetailLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                            {column.overlay ? (
                              <div
                                className="absolute rounded-t-lg rounded-b-lg transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{
                                  ...barFrameStyle,
                                  bottom: `${overlayLowPct}%`,
                                  height: `${overlayBarHeightPct}%`,
                                  backgroundColor: column.overlay.color,
                                  opacity: 0.28,
                                }}
                              >
                                {showOverlayLabel ? (
                                  <div
                                    className="absolute inset-x-2 flex items-center justify-center"
                                    style={{
                                      bottom: `${Math.max(overlayLabelLowPct - overlayLowPct, 0)}%`,
                                      height: `${overlayLabelHeightPct}%`,
                                    }}
                                  >
                                    <span className="rounded-full bg-white/80 px-2 py-0.5 text-[10px] font-semibold tabular-nums text-sky-900">
                                      {column.overlay.label}
                                    </span>
                                  </div>
                                ) : null}
                              </div>
                            ) : null}
                            {showExternalPrice ? (
                              <div
                                className="absolute inset-x-1 z-10 flex justify-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                style={{ bottom: `calc(${Math.min(highPct, 100)}% + 6px)` }}
                              >
                                <span className="rounded-full bg-white px-2 py-0.5 text-[10px] font-semibold tabular-nums text-gray-900 shadow-sm">
                                  {formatCenteredPriceLabel(column.priceCtKwh, units)}
                                </span>
                              </div>
                            ) : null}

                            <div
                              className={cn(
                                'absolute rounded-t-lg rounded-b-lg transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]',
                                column.type === 'total' && 'shadow-[inset_0_1px_0_rgba(255,255,255,0.35)]',
                                isZeroValue && 'hidden',
                              )}
                              style={{
                                ...barFrameStyle,
                                bottom: `${lowPct}%`,
                                height: `${barHeightPct}%`,
                                opacity: 0.94,
                                backgroundColor: column.fillSegments && column.fillSegments.length > 1 ? 'transparent' : column.color,
                              }}
                            >
                              {column.fillSegments && column.fillSegments.length > 0 ? (
                                <div className="absolute inset-0 overflow-hidden rounded-[inherit]">
                                  {(() => {
                                    const fillSegments = column.fillSegments ?? []
                                    let segmentOffset = 0
                                    return fillSegments.map((segment, index) => {
                                      const segmentHeight = Math.max(segment.ratio * 100, index === fillSegments.length - 1 ? 100 - segmentOffset : 0)
                                      const style = {
                                        bottom: `${segmentOffset}%`,
                                        height: `${segmentHeight}%`,
                                        background: segment.striped ? stripedFill(segment.color) : segment.color,
                                        opacity: 0.98,
                                      }
                                      segmentOffset += segmentHeight
                                      return (
                                        <div
                                          key={`${column.key}-fill-${index}`}
                                          className="absolute inset-x-0 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                          style={style}
                                        />
                                      )
                                    })
                                  })()}
                                </div>
                              ) : null}
                              {impactDeltaCenteredLabel ? (
                                <div className="absolute inset-1 flex items-center justify-center text-center">
                                  <span className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                                    darkLabel
                                      ? 'bg-black/15 text-white'
                                      : 'bg-white/82 text-gray-900',
                                  )}>
                                    {impactDeltaCenteredLabel}
                                  </span>
                                </div>
                              ) : null}
                              {showCenteredPrice ? (
                                <div className="absolute inset-1 flex items-center justify-center text-center">
                                  <span className={cn(
                                    'rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums',
                                    darkLabel
                                      ? 'bg-black/15 text-white'
                                      : 'bg-white/82 text-gray-900',
                                  )}>
                                    {formatCenteredPriceLabel(column.priceCtKwh, units)}
                                  </span>
                                </div>
                              ) : null}
                        </div>
                        </div>
                      )
                    })}
                  </div>
                </div>

                <div
                  className="grid gap-3"
                  style={{ gridTemplateColumns: `repeat(${chartSeries.columns.length}, minmax(0, 1fr))` }}
                >
                  {chartSeries.columns.map((column) => (
                    <div
                      key={`${column.key}-xlabel`}
                      className="relative text-center transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    >
                      {column.separatorBefore ? (
                        <div className="absolute bottom-0 left-[-8px] top-0 border-l-2 border-dashed border-gray-500" />
                      ) : null}
                      <p className={cn(
                        'text-[11px] font-semibold uppercase tracking-[0.12em]',
                        column.key === 'export' ? 'text-slate-400' : 'text-slate-600',
                      )}>
                        {column.shortLabel}
                      </p>
                      {column.footerLines?.map((line, lineIndex) => (
                        <p key={`${column.key}-footer-${lineIndex}`} className="mt-0.5 text-[10px] leading-4 tabular-nums text-gray-500">
                          {line}
                        </p>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className="mt-4 grid gap-3 lg:grid-cols-2">
            {showExportBucket ? (
              <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-3">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Export kept separate</p>
                <p className="mt-1 text-base font-semibold tabular-nums text-slate-700">
                  {formatSignedCurrency(-stats.exportRevenueEur, units.currencySym)}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  {units.currencySym}{stats.exportRevenueEur.toFixed(0)} export revenue
                </p>
              </div>
            ) : null}

            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Overall modeled net result</p>
              <p className="mt-1 text-lg font-bold tabular-nums text-emerald-900">{units.currencySym}{stats.overallNetCostEur.toFixed(0)}</p>
              <p className="mt-1 text-[11px] text-emerald-800">
                {stats.overallNetEquivalentCt.toFixed(2)} {units.priceUnit} normalized to annual load
              </p>
            </div>
          </div>

          <DeliveredAllocationScene
            visibleBuckets={visibleBuckets}
            showExportBucket={showExportBucket}
            stats={stats}
            units={units}
          />
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
  const usableKwh = clamp(state.usableKwh, 0, 20)
  const initialSocKwh = clamp(state.initialSocKwh, 0, usableKwh)

  if (
    year === state.year &&
    loadProfileId === state.loadProfileId &&
    tariffId === state.tariffId &&
    usableKwh === state.usableKwh &&
    initialSocKwh === state.initialSocKwh
  ) {
    return state
  }

  return {
    ...state,
    year,
    loadProfileId,
    tariffId,
    usableKwh,
    initialSocKwh,
  }
}

function MonthlyBars({
  annual,
  units,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
}) {
  const maxAbsValue = Math.max(
    ...annual.months.flatMap((month) => [Math.abs(month.savingsEur), Math.abs(month.exportRevenueEur), 1]),
    1,
  )

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
                <div className="absolute inset-y-0 left-1/2 w-px bg-white/90" />
                <div
                  className="absolute inset-y-0 rounded-full bg-emerald-500/80"
                  style={{
                    left: month.savingsEur >= 0
                      ? '50%'
                      : `${50 - ((Math.abs(month.savingsEur) / maxAbsValue) * 50)}%`,
                    width: `${(Math.abs(month.savingsEur) / maxAbsValue) * 50}%`,
                  }}
                />
                <div
                  className="absolute inset-y-0 rounded-full bg-blue-500/80"
                  style={{
                    left: '50%',
                    width: `${(Math.abs(month.exportRevenueEur) / maxAbsValue) * 50}%`,
                  }}
                />
              </div>
              <span className="text-right text-sm font-semibold text-gray-900">
                {month.savingsEur < 0 ? '-' : ''}{units.currencySym}{Math.abs(Math.round(month.savingsEur))}
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

function PlanningModelCard({
  planningModel,
  onChange,
}: {
  planningModel: PvBatteryPlanningModel
  onChange: (planningModel: PvBatteryPlanningModel) => void
}) {
  return (
    <Card className="border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-6">
        <SectionHeading
          eyebrow="Planning model"
          title="Replay basis"
          help="Deterministic replay keeps the current full-year hindsight baseline. Rolling day-ahead planner restitches the year from publication-time runs so every selected slot can be traced back to a specific plan."
          icon={<Gauge className="h-5 w-5 text-gray-400" />}
        />

        <div className="grid gap-3 lg:grid-cols-2">
          {[
            {
              id: 'deterministic' as const,
              title: 'Deterministic replay',
              detail: 'One annual solve over the full selected year. Best for today’s baseline and side-by-side chart continuity.',
              chips: ['Full-year hindsight', 'Selected load profile', 'Free terminal SoC'],
            },
            {
              id: 'rolling' as const,
              title: 'Rolling day-ahead planner',
              detail: 'A stitched chain of runs. Each run only knows the remaining day plus the next day, then commits until the next 12:00 replan.',
              chips: ['H25 locked', '12:00 replans', 'SoC returns to start'],
            },
          ].map((option) => {
            const active = planningModel === option.id
            return (
              <button
                key={option.id}
                type="button"
                onClick={() => onChange(option.id)}
                className={cn(
                  'rounded-2xl border p-4 text-left transition-all',
                  active
                    ? 'border-slate-900 bg-slate-900 text-white shadow-[0_18px_40px_rgba(15,23,42,0.16)]'
                    : 'border-gray-200 bg-[#FAF8F1] text-slate-900 hover:border-gray-300 hover:bg-white',
                )}
              >
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[15px] font-semibold tracking-tight">{option.title}</p>
                  <span className={cn(
                    'rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em]',
                    active ? 'bg-white/12 text-white' : 'bg-white text-slate-500',
                  )}>
                    {active ? 'Active' : 'Available'}
                  </span>
                </div>
                <p className={cn('mt-2 text-[12px] leading-5', active ? 'text-slate-200' : 'text-slate-600')}>
                  {option.detail}
                </p>
                <div className="mt-3 flex flex-wrap gap-2">
                  {option.chips.map((chip) => (
                    <span
                      key={chip}
                      className={cn(
                        'rounded-full px-2 py-1 text-[10px] font-semibold tracking-wide',
                        active ? 'bg-white/10 text-white' : 'bg-white text-slate-600',
                      )}
                    >
                      {chip}
                    </span>
                  ))}
                </div>
              </button>
            )
          })}
        </div>

        <div className="mt-4 rounded-2xl border border-[#E4DDC9] bg-[#FBF6E8] px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#7A6E52]">How to read it</p>
          <p className="mt-1 text-[12px] leading-6 text-[#5D5547]">
            {getPlanningModelSummary(planningModel)}
          </p>
        </div>
      </CardContent>
    </Card>
  )
}

function PlannerAssumptionsCard({
  planningModel,
  assumptions,
  initialSocKwh,
}: {
  planningModel: PvBatteryPlanningModel
  assumptions: PvBatteryPlannerAssumptions
  initialSocKwh: number
}) {
  const rows = [
    { label: 'Objective', value: assumptions.objective },
    { label: 'Household basis', value: assumptions.loadForecastSource },
    { label: 'PV basis', value: assumptions.pvForecastSource },
    { label: 'Price basis', value: assumptions.priceSource },
    { label: 'Tariff basis', value: assumptions.tariffBasis },
    { label: 'Cadence', value: assumptions.replanCadence },
    { label: 'Terminal rule', value: assumptions.terminalRule },
    ...(planningModel === 'rolling'
      ? [{ label: 'Initial SoC', value: `${initialSocKwh.toFixed(1)} kWh at replay start` }]
      : []),
  ]

  return (
    <Card className="border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-6">
        <SectionHeading
          eyebrow="Explainability"
          title="How this model works"
          help="This card makes the active claim boundaries explicit: what the solver optimizes, what it is allowed to know, and which assumptions drive the visible quarter-hour routing."
          icon={<LineChart className="h-5 w-5 text-gray-400" />}
        />

        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.05fr)_minmax(320px,0.95fr)]">
          <div className="rounded-2xl border border-slate-200 bg-slate-50 px-5 py-4">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-slate-500">Narrative</p>
            <p className="mt-2 text-[14px] leading-7 text-slate-700">
              {planningModel === 'rolling'
                ? 'The rolling planner behaves like a planning desk instead of a clairvoyant annual replay. It solves on publication cadence, commits only the visible stitched chain, and keeps every day selectable so quarter-hour decisions remain inspectable without pretending the solver knew the full year ahead.'
                : 'The deterministic replay remains the current audit baseline. It solves the full selected year in one pass, then lets you inspect any day on that chain to understand where value came from before introducing publication-time uncertainty.'}
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm">Any day stays selectable</span>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm">Quarter-hour flows remain auditable</span>
              <span className="rounded-full bg-white px-2 py-1 text-[10px] font-semibold text-slate-600 shadow-sm">Tariff economics drive routing</span>
            </div>
          </div>

          <div className="rounded-2xl border border-[#E8E3D7] bg-[#FCFBF7] px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-[#857865]">Planner assumptions</p>
            <div className="mt-3 space-y-2">
              {rows.map((row) => (
                <div key={row.label} className="grid gap-1 rounded-xl border border-white bg-white/90 px-3 py-2 shadow-[0_1px_0_rgba(255,255,255,0.8)]">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8B816F]">{row.label}</p>
                  <p className="text-[12px] leading-5 text-slate-700">{row.value}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
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
  const activeLoadProfileId: BatteryLoadProfileId = state.planningModel === 'rolling' ? 'H25' : state.loadProfileId
  const activeLoadProfileLabel = loadProfileOptions.find((profile) => profile.id === activeLoadProfileId)?.label ?? activeLoadProfileId
  const selectedTariff = tariffs.find((tariff) => tariff.id === state.tariffId)
  const isPvSelected = state.pvCapacityWp > 0
  const isBatterySelected = state.usableKwh > 0
  const { loadProfile, pvProfile, loading: profilesLoading, error: profilesError } = useBatteryProfiles(
    CALCULATOR_COUNTRY,
    activeLoadProfileId,
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
    params.set('model', state.planningModel)
    if (state.year) params.set('year', String(state.year))
    params.set('resolution', state.resolution)
    params.set('hours', String(state.viewHours))
    params.set('price', state.flowPriceMode)
    params.set('profile', state.loadProfileId)
    params.set('load', String(Math.round(state.annualLoadKwh)))
    params.set('pv', String(Math.round(state.pvCapacityWp)))
    if (state.pvZipCode) params.set('pvzip', state.pvZipCode)
    params.set('battery', String(state.usableKwh))
    params.set('soc', String(Number(state.initialSocKwh.toFixed(2))))
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

  const annualSource = useMemo(() => {
    if (state.resolution !== 'quarterhour') return prices.hourly
    return prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
  }, [prices.hourly, prices.hourlyQH, state.resolution])

  const annualPrices = useMemo(() => {
    return annualSource
      .filter((point) => point.date.slice(0, 4) === String(effectiveYear))
      .filter((point) => !prices.lastRealDate || point.date <= prices.lastRealDate)
  }, [annualSource, effectiveYear, prices.lastRealDate])

  const radiationAdjustment = useMemo(() => {
    if (!radiationData) return null
    // Convert absolute radiation values to relative factors
    const avgMonthly = radiationData.annualTotal / 12
    const monthlyFactors = radiationData.monthlyRadiation.map(
      (monthly: number) => avgMonthly > 0 ? monthly / avgMonthly : 1.0
    )
    return { monthlyFactors }
  }, [radiationData])
  const planningModelLabel = getPlanningModelLabel(state.planningModel)
  const plannerAssumptions = useMemo(
    () => buildPlannerAssumptions({
      planningModel: state.planningModel,
      loadProfileLabel: activeLoadProfileLabel,
      tariffLabel: selectedTariff?.label ?? 'Selected dynamic tariff',
      pvZipCode: state.pvZipCode,
    }),
    [activeLoadProfileLabel, selectedTariff?.label, state.planningModel, state.pvZipCode],
  )

  const annualResult = useMemo(() => {
    if (!loadProfile || !pvProfile || annualPrices.length === 0) return null
    const inputs = buildPvBatteryInputs(annualPrices, loadProfile, pvProfile, scenario, radiationAdjustment)

    if (state.planningModel === 'rolling') {
      return optimizePvBatteryRollingReplay(inputs, scenario, {
        initialSocKwh: state.initialSocKwh,
        modelLabel: planningModelLabel,
        assumptions: plannerAssumptions,
      })
    }

    return optimizePvBatteryWithOptions(inputs, scenario, {
      planningModel: 'deterministic',
      modelLabel: planningModelLabel,
      assumptions: plannerAssumptions,
      run: {
        runId: 'deterministic-annual-replay',
        runLabel: 'Annual deterministic replay',
      },
    })
  }, [
    annualPrices,
    loadProfile,
    plannerAssumptions,
    planningModelLabel,
    pvProfile,
    radiationAdjustment,
    scenario,
    state.initialSocKwh,
    state.planningModel,
  ])

  const dayResult = useMemo(() => {
    if (!annualResult || !prices.selectedDate) return null
    const firstIndex = annualResult.slots.findIndex((slot) => slot.date === prices.selectedDate)
    if (firstIndex < 0) return null
    const slotsPerHour = state.resolution === 'quarterhour' ? 4 : 1
    const targetCount = state.viewHours * slotsPerHour
    const slots = annualResult.slots.slice(firstIndex, firstIndex + targetCount)
    if (slots.length === 0) return null
    return {
      ...annualResult,
      months: [],
      slots,
    }
  }, [annualResult, prices.selectedDate, state.resolution, state.viewHours])

  const loading = prices.loading || profilesLoading
  const noYearData = !loading && !prices.error && availableYears.length === 0
  const pendingFlowPermissionKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => state.flowPermissions[key] !== DEFAULT_FLOW_PERMISSIONS[key])
    .map(({ key }) => key)
  const disabledFlowKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => !state.flowPermissions[key])
    .map(({ key }) => key)
  const hasQuarterHourReplay = prices.hourlyQH.length > 0
  const viewWindowOptions = [
    {
      label: '24h',
      active: state.viewHours === 24,
      onClick: () => setDraftState((current) => ({ ...current, viewHours: 24 })),
    },
    {
      label: '48h',
      active: state.viewHours === 48,
      onClick: () => setDraftState((current) => ({ ...current, viewHours: 48 })),
    },
    {
      label: '72h',
      active: state.viewHours === 72,
      onClick: () => setDraftState((current) => ({ ...current, viewHours: 72 })),
    },
  ]
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
  const replayWindowControls = <SegmentedPillGroup options={viewWindowOptions} />
  const replayResolutionControls = <SegmentedPillGroup options={replayResolutionOptions} />
  const priceReplayControls = (
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
      {replayWindowControls}
      {replayResolutionControls}
    </div>
  )
  const selectedDayControls = (
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
  )
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
                        value={state.planningModel === 'rolling' ? 'H25' : state.loadProfileId}
                        disabled={state.planningModel === 'rolling'}
                        onChange={(event) => setDraftState((current) => ({
                          ...current,
                          loadProfileId: event.target.value as BatteryLoadProfileId,
                        }))}
                        className={cn(
                          'w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-gray-400',
                          state.planningModel === 'rolling' && 'cursor-not-allowed bg-gray-50 text-gray-500',
                        )}
                      >
                        {loadProfileOptions.map((profile) => (
                          <option key={profile.id} value={profile.id}>
                            {profile.label}
                          </option>
                        ))}
                      </select>
                      {state.planningModel === 'rolling' ? (
                        <p className="text-[10px] leading-4 text-amber-700">
                          Rolling mode locks the household forecast basis to H25 so every stitched run uses the same published-load assumption.
                        </p>
                      ) : null}
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

                    <div className="pt-2">
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
                        unboxed
                        spread
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

                    <div className="space-y-2">
                      <RangeControl
                        label="Initial SoC"
                        value={`${state.initialSocKwh.toFixed(1)} kWh`}
                        min={0}
                        max={Math.max(state.usableKwh, 0)}
                        step={0.5}
                        sliderValue={Math.min(state.initialSocKwh, state.usableKwh)}
                        onChange={(value) => setDraftState((current) => ({ ...current, initialSocKwh: value }))}
                        minLabel="0"
                        maxLabel={`${state.usableKwh.toFixed(1)} kWh`}
                      />
                      <p className={cn(
                        'text-[10px] leading-4',
                        state.planningModel === 'rolling' ? 'text-emerald-700' : 'text-gray-500',
                      )}>
                        {state.planningModel === 'rolling'
                          ? 'Used as the starting battery state for the stitched rolling chain and as the terminal anchor for each run.'
                          : 'Saved for the rolling planner. The current deterministic replay still keeps its original empty-start, free-terminal behavior.'}
                      </p>
                    </div>

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

                    <div className="space-y-2 pt-2">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Battery flow routing</p>
                      <FlowRouteCard
                        source="battery"
                        routes={[
                          { target: 'home', routeKey: 'batteryToLoad' },
                          { target: 'grid', routeKey: 'batteryToGrid' },
                          { target: 'grid', routeKey: 'gridToBattery', arrowDirection: 'up' },
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
                        unboxed
                        spread
                      />
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
                  <PlanningModelCard
                    planningModel={state.planningModel}
                    onChange={(planningModel) => setDraftState((current) => ({ ...current, planningModel }))}
                  />
                  <PlannerAssumptionsCard
                    planningModel={state.planningModel}
                    assumptions={annualResult.assumptions}
                    initialSocKwh={state.initialSocKwh}
                  />
                  <AnnualHero annual={annualResult} units={units} />
                  <DeliveredAllocationCard
                    annual={annualResult}
                    units={units}
                    flowPermissions={state.flowPermissions}
                    isPvSelected={isPvSelected}
                    isBatterySelected={isBatterySelected}
                  />
                  <MonthlyBars annual={annualResult} units={units} />
                  <ConsumptionPriceBlockCard
                    annualResult={dayResult}
                    dayLabel={formatDayLabel(prices.selectedDate)}
                    units={units}
                    loading={prices.loading}
                    priceCurveMode={state.flowPriceMode}
                    controls={priceReplayControls}
                  />
                  <PvBatteryDayChart
                    annualResult={dayResult}
                    dayLabel={formatDayLabel(prices.selectedDate)}
                    units={units}
                    priceCurveMode={state.flowPriceMode}
                    loading={prices.loading}
                    controls={selectedDayControls}
                    householdControls={(
                      <div className="flex flex-wrap gap-2">
                        {replayWindowControls}
                        {replayResolutionControls}
                      </div>
                    )}
                    priceControls={priceReplayControls}
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
