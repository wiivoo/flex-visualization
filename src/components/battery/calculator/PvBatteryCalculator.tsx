'use client'

import Link from 'next/link'
import { Suspense, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Battery, BatteryCharging, CircleHelp, Gauge, Home, LineChart, Pause, Play, SunMedium, Zap, type LucideIcon } from 'lucide-react'

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
import { surchargesForYear, totalSurchargesNetto, VAT_RATE, type Surcharges } from '@/lib/dynamic-tariff'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import {
  aggregatePvBatteryAnnualResult,
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
type BatteryConnectionMode = 'plugin' | 'wired'
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

const PLUGIN_DISCHARGE_LIMIT_KW = 0.8
const DEFAULT_BATTERY_C_RATE = 0.5
const BATTERY_POWER_MIN_KW = 0.1
const BATTERY_POWER_MAX_KW = 15
const BATTERY_POWER_STEP_KW = 0.1
const PLUGIN_ROUND_TRIP_EFF = 0.88
const WIRED_ROUND_TRIP_EFF = 0.9

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

const ALLOCATION_FLOW_COLORS = {
  gridDirect: '#7D8797',
  pvDirect: '#E9B94A',
  pvStored: '#D9B24E',
  gridStored: '#2F6FB3',
  pvExport: '#D6B04B',
  batteryPvExport: '#D9B24E',
  batteryGridExport: '#8A93A3',
  batteryExport: '#2F6FB3',
  household: '#111827',
} as const

type AllocationNodeMetric = {
  label: string
  value: string
  color: string
  tooltip?: ReactNode
}

type AllocationSceneLaneSpec = {
  key: string
  path: string
  color: string
  width: number
  striped?: boolean
  label?: string
  labelDetail?: string
  labelX?: number
  labelY?: number
  labelAnchor?: 'start' | 'middle' | 'end'
}

type AllocationMobileEntry = {
  key: string
  title: string
  route: string
  sharePct: number
  kwh: number
  color: string
  badge: string
  tooltip: string
  striped?: boolean
}

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
    text: ALLOCATION_FLOW_COLORS.pvDirect,
  },
  battery: {
    label: 'Battery',
    icon: BatteryCharging,
    background: '#EAF2FF',
    text: ALLOCATION_FLOW_COLORS.gridStored,
  },
  home: {
    label: 'Home',
    icon: Home,
    background: '#F1F5F9',
    text: ALLOCATION_FLOW_COLORS.household,
  },
  grid: {
    label: 'Grid',
    icon: Zap,
    background: '#E9EEF5',
    text: ALLOCATION_FLOW_COLORS.gridDirect,
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
  viewHours: 24 | 36 | 48
  resolution: PvBatteryResolution
  flowPriceMode: 'spot' | 'end'
  loadProfileId: BatteryLoadProfileId
  annualLoadKwh: number
  pvCapacityWp: number
  pvZipCode: string
  batteryConnectionMode: BatteryConnectionMode
  usableKwh: number
  initialSocKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number
  feedInCapKw: number
  curtailPvAtNegativePrices: boolean
  flowPermissions: FlowPermissions
}

interface TariffComponentsLookup {
  plz: string
  location: string
  dso?: string | null
  gridFeeNetto: number
  taxesNetto: number
  defaultSupplier?: string
  cached?: boolean
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
    && a.batteryConnectionMode === b.batteryConnectionMode
    && a.usableKwh === b.usableKwh
    && a.initialSocKwh === b.initialSocKwh
    && a.maxChargeKw === b.maxChargeKw
    && a.maxDischargeKw === b.maxDischargeKw
    && a.roundTripEff === b.roundTripEff
    && a.feedInCapKw === b.feedInCapKw
    && a.curtailPvAtNegativePrices === b.curtailPvAtNegativePrices
    && FLOW_PERMISSION_OPTIONS.every(({ key }) => a.flowPermissions[key] === b.flowPermissions[key])
}

const DEFAULT_STATE: CalculatorState = {
  country: CALCULATOR_COUNTRY,
  tariffId: 'tibber-de',
  planningModel: 'deterministic',
  year: 0,
  viewHours: 24,
  resolution: 'quarterhour',
  flowPriceMode: 'spot',
  loadProfileId: 'H25',
  annualLoadKwh: 4500,
  pvCapacityWp: 8000,
  pvZipCode: '',
  batteryConnectionMode: 'wired',
  usableKwh: 10,
  initialSocKwh: 5,
  maxChargeKw: 5,
  maxDischargeKw: 5,
  roundTripEff: WIRED_ROUND_TRIP_EFF,
  feedInCapKw: 5,
  curtailPvAtNegativePrices: true,
  flowPermissions: DEFAULT_FLOW_PERMISSIONS,
}

const MARKET_EXPORT_COMPENSATION_PCT = 100

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function roundToStep(value: number, step: number): number {
  return Number((Math.round(value / step) * step).toFixed(3))
}

function defaultBatteryChargeKw(usableKwh: number): number {
  return clamp(roundToStep(usableKwh * DEFAULT_BATTERY_C_RATE, BATTERY_POWER_STEP_KW), BATTERY_POWER_MIN_KW, BATTERY_POWER_MAX_KW)
}

function defaultBatteryDischargeKw(mode: BatteryConnectionMode, usableKwh: number): number {
  if (mode === 'plugin') return PLUGIN_DISCHARGE_LIMIT_KW
  return defaultBatteryChargeKw(usableKwh)
}

function defaultBatteryEfficiency(mode: BatteryConnectionMode): number {
  return mode === 'plugin' ? PLUGIN_ROUND_TRIP_EFF : WIRED_ROUND_TRIP_EFF
}

function applyBatteryConnectionDefaults(state: CalculatorState, mode: BatteryConnectionMode): CalculatorState {
  return {
    ...state,
    batteryConnectionMode: mode,
    maxChargeKw: defaultBatteryChargeKw(state.usableKwh),
    maxDischargeKw: defaultBatteryDischargeKw(mode, state.usableKwh),
    roundTripEff: defaultBatteryEfficiency(mode),
  }
}

function getDefaultTariffForCountry(country: PvBatteryCountry): string {
  return getDefaultTariffId(country)
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

function formatSceneKwh(value: number): string {
  return `${formatCompactFlowKwh(value)} kWh`
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
  const loadProfileId = getDefaultCalculatorLoadProfileId(country)
  const planningModel: PvBatteryPlanningModel = params.get('model') === 'rolling' ? 'rolling' : 'deterministic'
  const parsedYear = Number(params.get('year'))
  const tariffIds = new Set(getTariffsFor(country).map((tariff) => tariff.id))
  const tariffId = tariffIds.has(params.get('tariff') ?? '')
    ? (params.get('tariff') as string)
    : getDefaultTariffForCountry(country)
  const resolution = params.get('resolution') === 'hour' ? 'hour' : 'quarterhour'
  const rawViewHours = Number(params.get('hours'))
  const viewHours: 24 | 36 | 48 = rawViewHours === 36 || rawViewHours === 48 ? rawViewHours : 24
  const flowPriceMode = 'spot'

  const getNum = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key)
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value)) return fallback
    return clamp(value, min, max)
  }

  const zipCodeRaw = params.get('pvzip') ?? ''
  const pvZipCode = /^\d{5}$/.test(zipCodeRaw) ? zipCodeRaw : ''
  const batteryConnectionMode: BatteryConnectionMode = params.get('batteryMode') === 'plugin' ? 'plugin' : 'wired'
  const usableKwh = getNum('battery', DEFAULT_STATE.usableKwh, 0, 20)
  const initialSocDefault = usableKwh > 0 ? usableKwh / 2 : 0
  const defaultChargeKw = defaultBatteryChargeKw(usableKwh)
  const defaultDischargeKw = defaultBatteryDischargeKw(batteryConnectionMode, usableKwh)

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
    batteryConnectionMode,
    usableKwh,
    initialSocKwh: getNum('soc', initialSocDefault, 0, Math.max(usableKwh, 0)),
    maxChargeKw: getNum('charge', defaultChargeKw, BATTERY_POWER_MIN_KW, BATTERY_POWER_MAX_KW),
    maxDischargeKw: getNum('discharge', defaultDischargeKw, BATTERY_POWER_MIN_KW, BATTERY_POWER_MAX_KW),
    roundTripEff: getNum('eff', defaultBatteryEfficiency(batteryConnectionMode), 0.75, 0.96),
    feedInCapKw: getNum('feedin', DEFAULT_STATE.feedInCapKw, 0.5, 20),
    curtailPvAtNegativePrices: params.get('curtailneg') !== '0',
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
    ? 'Day-ahead'
    : 'Full'
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
      <div className="border-b border-gray-100 bg-gray-50/80 px-5 py-2.5">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[10px] font-semibold tracking-widest uppercase text-gray-400">{label}</p>
            {value ? <p className="mt-1 text-xl font-bold text-[#313131] tabular-nums">{value}</p> : null}
          </div>
          {icon}
        </div>
      </div>
      <CardContent className="pt-3.5 pb-4">
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
      <div className="flex min-h-7 items-baseline justify-between gap-3">
        <span className="inline-flex min-w-0 items-center gap-1 text-[11px] font-semibold uppercase tracking-wide text-gray-500">
          {label}
          {help ? <HelpTooltip label={`${label} help`}>{help}</HelpTooltip> : null}
        </span>
        <span className="shrink-0 text-xl font-bold text-[#313131] tabular-nums">
          {numericValue}
          {unit && <span className="ml-1 text-[11px] font-normal text-gray-400">{unit}</span>}
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
    </div>
  )
}

function buildScenario(
  state: CalculatorState,
  regionalSurcharges?: Surcharges | null,
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
    regionalSurcharges,
    curtailPvAtNegativePrices: state.curtailPvAtNegativePrices,
    flowPermissions: state.flowPermissions,
  }
}

function AnnualSummaryRow({
  label,
  value,
  tone = 'neutral',
  detail,
}: {
  label: string
  value: string
  tone?: 'neutral' | 'positive' | 'muted'
  detail?: string
}) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-gray-200/80 py-2.5 last:border-b-0">
      <div className="min-w-0">
        <p className="text-sm font-medium text-gray-700">{label}</p>
        {detail ? <p className="mt-0.5 text-[11px] leading-4 text-gray-400">{detail}</p> : null}
      </div>
      <span
        className={cn(
          'max-w-[58%] text-right text-sm font-semibold tabular-nums sm:max-w-none',
          tone === 'positive' ? 'text-emerald-700' : tone === 'muted' ? 'text-gray-500' : 'text-gray-900',
        )}
      >
        {value}
      </span>
    </div>
  )
}

interface AnnualAccountingSummary {
  consumptionImportSavingsEur: number
  totalGridImportKwh: number
  totalGridImportCostEur: number
  totalGridImportAvgCt: number
  baselineAvgCt: number
  baselineSpotEnergyCostEur: number
  baselineRetailAddOnsEur: number
  baselineRetailAddOnsAvgCt: number
  optimizedSpotEnergyCostEur: number
  optimizedRetailAddOnsEur: number
  optimizedRetailAddOnsAvgCt: number
  gridToLoadKwh: number
  gridToLoadCostEur: number
  gridToLoadSpotCostEur: number
  gridToLoadRetailAddOnsEur: number
  gridToLoadAvgCt: number
  gridToBatteryCostEur: number
  gridToBatterySpotCostEur: number
  gridToBatteryRetailAddOnsEur: number
  gridToBatteryAvgCt: number
  pvBatteryToLoadKwh: number
  directPvAvoidedImportEur: number
  pvBatteryAvoidedImportEur: number
  pvAvoidedImportEur: number
  pvAvoidedImportAvgCt: number
  directExportRevenueEur: number
  directExportAvgCt: number
  batteryPvExportKwh: number
  batteryPvExportRevenueEur: number
  batteryPvExportAvgCt: number
  batteryGridExportKwh: number
  batteryGridExportRevenueEur: number
  batteryGridExportNetEur: number
  batteryGridExportGrossAvgCt: number
  batteryGridExportNetAvgCt: number
  curtailedAvoidedCostEur: number
  curtailedAvoidedCostAvgCt: number
  exportedEnergyKwh: number
  exportAvgCt: number
}

function summarizeAnnualAccounting(annual: PvBatteryAnnualResult): AnnualAccountingSummary {
  const grossSpotFactor = 1 + VAT_RATE / 100
  const totals = annual.slots.reduce((acc, slot) => {
    const baselineSpotCostEur = (slot.loadKwh * slot.spotPriceCtKwh * grossSpotFactor) / 100
    const gridToLoadSpotCostEur = (slot.gridToLoadKwh * slot.spotPriceCtKwh * grossSpotFactor) / 100
    const gridToLoadCostEur = (slot.gridToLoadKwh * slot.importPriceCtKwh) / 100
    const gridToBatterySpotCostEur = (slot.gridToBatteryKwh * slot.spotPriceCtKwh * grossSpotFactor) / 100
    const gridToBatteryCostEur = (slot.gridToBatteryKwh * slot.importPriceCtKwh) / 100
    const importedKwh = slot.gridToLoadKwh + slot.gridToBatteryKwh
    const optimizedSpotCostEur = (importedKwh * slot.spotPriceCtKwh * grossSpotFactor) / 100

    acc.baselineSpotEnergyCostEur += baselineSpotCostEur
    acc.baselineRetailAddOnsEur += slot.baselineCostEur - baselineSpotCostEur
    acc.optimizedSpotEnergyCostEur += optimizedSpotCostEur
    acc.optimizedRetailAddOnsEur += slot.gridImportCostEur - optimizedSpotCostEur
    acc.gridToLoadKwh += slot.gridToLoadKwh
    acc.gridToLoadCostEur += gridToLoadCostEur
    acc.gridToLoadSpotCostEur += gridToLoadSpotCostEur
    acc.gridToLoadRetailAddOnsEur += gridToLoadCostEur - gridToLoadSpotCostEur
    acc.gridToBatteryCostEur += gridToBatteryCostEur
    acc.gridToBatterySpotCostEur += gridToBatterySpotCostEur
    acc.gridToBatteryRetailAddOnsEur += gridToBatteryCostEur - gridToBatterySpotCostEur
    acc.pvBatteryToLoadKwh += slot.batteryPvToLoadKwh
    acc.directPvAvoidedImportEur += (slot.pvToLoadKwh * slot.importPriceCtKwh) / 100
    acc.pvBatteryAvoidedImportEur += (slot.batteryPvToLoadKwh * slot.importPriceCtKwh) / 100
    acc.directExportRevenueEur += (slot.directExportKwh * slot.exportPriceCtKwh) / 100
    acc.batteryPvExportKwh += slot.batteryPvExportKwh
    acc.batteryPvExportRevenueEur += (slot.batteryPvExportKwh * slot.exportPriceCtKwh) / 100
    acc.batteryGridExportKwh += slot.batteryGridExportKwh
    acc.batteryGridExportRevenueEur += (slot.batteryGridExportKwh * slot.exportPriceCtKwh) / 100
    acc.batteryGridExportNetEur += slot.batteryGridExportSavingsEur
    acc.curtailedAvoidedCostEur += (slot.curtailedKwh * Math.max(0, -slot.exportPriceCtKwh)) / 100
    return acc
  }, {
    baselineSpotEnergyCostEur: 0,
    baselineRetailAddOnsEur: 0,
    optimizedSpotEnergyCostEur: 0,
    optimizedRetailAddOnsEur: 0,
    gridToLoadKwh: 0,
    gridToLoadCostEur: 0,
    gridToLoadSpotCostEur: 0,
    gridToLoadRetailAddOnsEur: 0,
    gridToBatteryCostEur: 0,
    gridToBatterySpotCostEur: 0,
    gridToBatteryRetailAddOnsEur: 0,
    pvBatteryToLoadKwh: 0,
    directPvAvoidedImportEur: 0,
    pvBatteryAvoidedImportEur: 0,
    directExportRevenueEur: 0,
    batteryPvExportKwh: 0,
    batteryPvExportRevenueEur: 0,
    batteryGridExportKwh: 0,
    batteryGridExportRevenueEur: 0,
    batteryGridExportNetEur: 0,
    curtailedAvoidedCostEur: 0,
  })

  const totalGridImportKwh = annual.gridImportKwh + annual.gridToBatteryKwh
  const exportedEnergyKwh = annual.directExportKwh + annual.batteryExportKwh
  const pvToHouseholdKwh = annual.directSelfConsumedKwh + totals.pvBatteryToLoadKwh
  const pvAvoidedImportEur = totals.directPvAvoidedImportEur + totals.pvBatteryAvoidedImportEur

  return {
    consumptionImportSavingsEur: annual.baselineCostEur - annual.gridImportCostEur,
    totalGridImportKwh,
    totalGridImportCostEur: annual.gridImportCostEur,
    totalGridImportAvgCt: totalGridImportKwh > 0 ? (annual.gridImportCostEur * 100) / totalGridImportKwh : 0,
    baselineAvgCt: annual.loadKwh > 0 ? (annual.baselineCostEur * 100) / annual.loadKwh : 0,
    baselineSpotEnergyCostEur: totals.baselineSpotEnergyCostEur,
    baselineRetailAddOnsEur: totals.baselineRetailAddOnsEur,
    baselineRetailAddOnsAvgCt: annual.loadKwh > 0 ? (totals.baselineRetailAddOnsEur * 100) / annual.loadKwh : 0,
    optimizedSpotEnergyCostEur: totals.optimizedSpotEnergyCostEur,
    optimizedRetailAddOnsEur: totals.optimizedRetailAddOnsEur,
    optimizedRetailAddOnsAvgCt: totalGridImportKwh > 0 ? (totals.optimizedRetailAddOnsEur * 100) / totalGridImportKwh : 0,
    gridToLoadKwh: totals.gridToLoadKwh,
    gridToLoadCostEur: totals.gridToLoadCostEur,
    gridToLoadSpotCostEur: totals.gridToLoadSpotCostEur,
    gridToLoadRetailAddOnsEur: totals.gridToLoadRetailAddOnsEur,
    gridToLoadAvgCt: totals.gridToLoadKwh > 0 ? (totals.gridToLoadCostEur * 100) / totals.gridToLoadKwh : 0,
    gridToBatteryCostEur: totals.gridToBatteryCostEur,
    gridToBatterySpotCostEur: totals.gridToBatterySpotCostEur,
    gridToBatteryRetailAddOnsEur: totals.gridToBatteryRetailAddOnsEur,
    gridToBatteryAvgCt: annual.gridToBatteryKwh > 0 ? (totals.gridToBatteryCostEur * 100) / annual.gridToBatteryKwh : 0,
    pvBatteryToLoadKwh: totals.pvBatteryToLoadKwh,
    directPvAvoidedImportEur: totals.directPvAvoidedImportEur,
    pvBatteryAvoidedImportEur: totals.pvBatteryAvoidedImportEur,
    pvAvoidedImportEur,
    pvAvoidedImportAvgCt: pvToHouseholdKwh > 0 ? (pvAvoidedImportEur * 100) / pvToHouseholdKwh : 0,
    directExportRevenueEur: totals.directExportRevenueEur,
    directExportAvgCt: annual.directExportKwh > 0 ? (totals.directExportRevenueEur * 100) / annual.directExportKwh : 0,
    batteryPvExportKwh: totals.batteryPvExportKwh,
    batteryPvExportRevenueEur: totals.batteryPvExportRevenueEur,
    batteryPvExportAvgCt: totals.batteryPvExportKwh > 0 ? (totals.batteryPvExportRevenueEur * 100) / totals.batteryPvExportKwh : 0,
    batteryGridExportKwh: totals.batteryGridExportKwh,
    batteryGridExportRevenueEur: totals.batteryGridExportRevenueEur,
    batteryGridExportNetEur: totals.batteryGridExportNetEur,
    batteryGridExportGrossAvgCt: totals.batteryGridExportKwh > 0 ? (totals.batteryGridExportRevenueEur * 100) / totals.batteryGridExportKwh : 0,
    batteryGridExportNetAvgCt: totals.batteryGridExportKwh > 0 ? (totals.batteryGridExportNetEur * 100) / totals.batteryGridExportKwh : 0,
    curtailedAvoidedCostEur: totals.curtailedAvoidedCostEur,
    curtailedAvoidedCostAvgCt: annual.curtailedKwh > 0 ? (totals.curtailedAvoidedCostEur * 100) / annual.curtailedKwh : 0,
    exportedEnergyKwh,
    exportAvgCt: exportedEnergyKwh > 0 ? (annual.exportRevenueEur * 100) / exportedEnergyKwh : 0,
  }
}

function formatCurrencyAmount(value: number, units: ReturnType<typeof getPriceUnits>, options?: { signed?: boolean }) {
  const sign = options?.signed && value > 0 ? '+' : value < 0 ? '-' : ''
  return `${sign}${units.currencySym}${Math.round(Math.abs(value)).toLocaleString()}`
}

function formatPriceAmount(value: number, units: ReturnType<typeof getPriceUnits>) {
  if (!Number.isFinite(value)) return 'n/a'
  return `${value.toFixed(2)} ${units.priceUnit}`
}

function formatKwhWithShare(kwh: number, basisKwh: number) {
  const share = basisKwh > 0 ? (kwh / basisKwh) * 100 : 0
  return `${formatKwh(kwh)} / ${share.toFixed(0)}%`
}

function mutedDash(label = '—') {
  return <span className="text-gray-300">{label}</span>
}

function AnnualRowIcon({ icon: Icon, tone = 'neutral' }: { icon: LucideIcon; tone?: 'neutral' | 'home' | 'pv' | 'battery' | 'grid' | 'total' }) {
  return (
    <span
      className={cn(
        'inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md border',
        tone === 'home' && 'border-slate-200 bg-slate-50 text-slate-600',
        tone === 'pv' && 'border-amber-200 bg-amber-50 text-amber-600',
        tone === 'battery' && 'border-sky-200 bg-sky-50 text-sky-600',
        tone === 'grid' && 'border-violet-200 bg-violet-50 text-violet-600',
        tone === 'total' && 'border-emerald-200 bg-emerald-50 text-emerald-700',
        tone === 'neutral' && 'border-gray-200 bg-gray-50 text-gray-500',
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </span>
  )
}

function AnnualBreakdownSectionRow({
  label,
  icon,
  open,
  onToggle,
  summary,
  tone = 'neutral',
}: {
  label: string
  icon: LucideIcon
  open: boolean
  onToggle: () => void
  summary?: ReactNode
  tone?: 'neutral' | 'home' | 'pv' | 'battery' | 'grid' | 'total'
}) {
  const Icon = icon

  return (
    <tr>
      <th
        scope="rowgroup"
        colSpan={4}
        className={cn(
          'border-t px-4 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.16em] first:border-t-0',
          tone === 'home' && 'border-slate-200 bg-slate-50 text-slate-500',
          tone === 'pv' && 'border-amber-200 bg-amber-50/80 text-amber-700',
          tone === 'battery' && 'border-sky-200 bg-sky-50/80 text-sky-700',
          tone === 'grid' && 'border-violet-200 bg-violet-50/80 text-violet-700',
          tone === 'total' && 'border-emerald-200 bg-emerald-50/90 text-emerald-700',
          tone === 'neutral' && 'border-gray-200 bg-gray-50 text-gray-400',
        )}
      >
        <button
          type="button"
          className="flex w-full items-center justify-between gap-3 text-left"
          aria-expanded={open}
          onClick={onToggle}
        >
          <span className="inline-flex items-center gap-2">
            <AnnualRowIcon icon={Icon} tone={tone} />
            <span>{label}</span>
          </span>
          <span className="inline-flex items-center gap-3 text-[13px] font-semibold normal-case tracking-normal opacity-70">
            {summary ? <span className="hidden tabular-nums sm:inline">{summary}</span> : null}
            <span aria-hidden="true">{open ? '▾' : '▸'}</span>
          </span>
        </button>
      </th>
    </tr>
  )
}

function AnnualBreakdownRow({
  label,
  detail,
  energy,
  cost,
  avg,
  indent = false,
  total = false,
  tone = 'neutral',
}: {
  label: string
  detail?: string
  energy: ReactNode
  cost?: ReactNode
  avg?: ReactNode
  indent?: boolean
  total?: boolean
  tone?: 'neutral' | 'optimized' | 'muted'
}) {
  return (
    <tr className={cn('border-t border-gray-200', total && 'border-t-gray-300')}>
      <th scope="row" className={cn('px-4 py-3 text-left align-top', indent && 'pl-8')}>
        <span className="flex items-start gap-2">
          {indent ? <span className="mt-0.5 text-gray-300">↳</span> : null}
          <span className="min-w-0">
            <span className={cn('block text-sm text-gray-800', total ? 'font-semibold' : 'font-medium')}>{label}</span>
            {detail ? <span className="mt-1 block text-[11px] font-normal leading-4 text-gray-400">{detail}</span> : null}
          </span>
        </span>
      </th>
      <td className={cn('px-4 py-3 text-right align-top text-sm tabular-nums text-gray-800', total && 'font-semibold text-gray-900', tone === 'muted' && 'text-gray-500')}>
        {energy}
      </td>
      <td className={cn('px-4 py-3 text-right align-top text-sm tabular-nums text-gray-800', total && 'font-semibold text-gray-900', tone === 'optimized' && 'font-semibold text-emerald-800', tone === 'muted' && 'text-gray-500')}>
        {cost ?? mutedDash()}
      </td>
      <td className={cn('px-4 py-3 text-right align-top text-sm tabular-nums text-gray-800', total && 'font-semibold text-gray-900', tone === 'optimized' && 'font-semibold text-emerald-800', tone === 'muted' && 'text-gray-500')}>
        {avg ?? mutedDash()}
      </td>
    </tr>
  )
}

function AnnualSummaryCard({
  annual,
  units,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
}) {
  const accounting = summarizeAnnualAccounting(annual)

  return (
    <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div>
            <div className="flex items-center gap-2">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Annual summary</p>
              <HelpTooltip label="Annual summary help">
                Total annual benefit equals consumption/import savings plus export credit. Battery grid charging is included in optimized retail import cost, so export credit is added separately without double-counting.
              </HelpTooltip>
            </div>
            <div className="mt-3 flex flex-wrap items-end gap-x-3 gap-y-1">
              <span className="text-4xl font-semibold tracking-tight text-gray-900">
                {formatCurrencyAmount(annual.savingsEur, units)}
              </span>
              <span className="pb-1.5 text-sm font-medium text-emerald-700">total annual benefit</span>
            </div>
            <p className="mt-1 text-sm text-gray-500">
              {formatCurrencyAmount(accounting.consumptionImportSavingsEur, units)} consumption savings + {formatCurrencyAmount(annual.exportRevenueEur, units)} export credit.
            </p>
          </div>

          <div className="grid min-w-0 gap-3 sm:grid-cols-2 lg:w-[48%]">
            <MetricTile
              label="Household demand"
              value={formatKwh(annual.loadKwh)}
              hint="Annual load served by all sources."
            />
            <MetricTile
              label="Net grid import"
              value={formatKwh(accounting.totalGridImportKwh)}
              hint="Retail grid import after PV and battery dispatch, including grid-to-battery charging."
            />
            <MetricTile
              label="Exported energy"
              value={formatKwh(accounting.exportedEnergyKwh)}
              hint="Direct PV export plus battery export."
            />
            <MetricTile
              label="PV self-consumption"
              value={`${annual.selfConsumptionPct.toFixed(0)}%`}
              hint="Share of PV generation used by the household directly or through the battery."
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

function AnnualBillCard({
  annual,
  units,
  pvCapacityWp,
  usableKwh,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
  pvCapacityWp: number
  usableKwh: number
}) {
  const accounting = summarizeAnnualAccounting(annual)
  const batteryGridToLoadKwh = annual.slots.reduce((sum, slot) => sum + slot.batteryGridToLoadKwh, 0)
  const batteryGridLoadInputCostEur = annual.slots.reduce((sum, slot) => sum + slot.batteryGridLoadInputCostEur, 0)
  const batteryToLoadValueEur = accounting.pvBatteryAvoidedImportEur + batteryGridLoadInputCostEur
  const [openSections, setOpenSections] = useState({
    setup: true,
    pv: true,
    battery: true,
    grid: true,
    total: true,
  })
  const toggleSection = (key: keyof typeof openSections) => {
    setOpenSections((current) => ({ ...current, [key]: !current[key] }))
  }
  const pvToGridKwh = annual.directExportKwh + accounting.batteryPvExportKwh
  const pvExportRevenueEur = accounting.directExportRevenueEur + accounting.batteryPvExportRevenueEur
  const pvSubtotalValueEur = accounting.pvAvoidedImportEur + pvExportRevenueEur + accounting.curtailedAvoidedCostEur
  const batteryExportRevenueEur = accounting.batteryPvExportRevenueEur + accounting.batteryGridExportRevenueEur
  const batterySubtotalValueEur = batteryToLoadValueEur + batteryExportRevenueEur

  return (
    <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Baseline vs optimized bill</p>
            <h3 className="mt-1 text-lg font-semibold text-gray-900">Retail import accounting</h3>
          </div>
          <p className="max-w-2xl text-xs leading-5 text-gray-500">
            Energy flows are shown first. Costs appear only on imported grid energy, split into spot energy and retail add-ons for each use.
          </p>
        </div>

        <div className="mt-5 overflow-hidden rounded-lg border border-gray-200 bg-white">
          <div className="grid gap-0 divide-y divide-gray-200">
            <button
              type="button"
              className="flex flex-col gap-2 bg-gray-50/80 p-4 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={openSections.setup}
              onClick={() => toggleSection('setup')}
            >
              <div className="flex items-center gap-3">
                <AnnualRowIcon icon={Home} tone="home" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-500">Baseline</p>
                  <p className="mt-0.5 text-xs text-gray-500">All household demand imported from grid.</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-3 text-2xl font-semibold tabular-nums text-gray-900">
                {formatCurrencyAmount(annual.baselineCostEur, units)}
                <span className="text-base text-gray-400" aria-hidden="true">{openSections.setup ? '▾' : '▸'}</span>
              </span>
            </button>

            <button
              type="button"
              className="flex flex-col gap-2 p-4 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={openSections.grid}
              onClick={() => setOpenSections((current) => ({
                ...current,
                pv: !current.pv || !current.battery || !current.grid ? true : false,
                battery: !current.pv || !current.battery || !current.grid ? true : false,
                grid: !current.pv || !current.battery || !current.grid ? true : false,
              }))}
            >
              <div className="flex items-center gap-3">
                <AnnualRowIcon icon={Gauge} tone="grid" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-violet-700">Optimized household</p>
                  <p className="mt-0.5 text-xs text-gray-500">
                    {formatCurrencyAmount(accounting.totalGridImportCostEur, units)} import - {formatCurrencyAmount(annual.exportRevenueEur, units)} export credit.
                  </p>
                </div>
              </div>
              <div className="text-left sm:text-right">
                <p className="text-2xl font-semibold tabular-nums text-gray-900">{formatCurrencyAmount(annual.netCostEur, units)}</p>
                <p className="mt-0.5 text-xs tabular-nums text-gray-500">
                  net after export <span className="text-gray-400" aria-hidden="true">{openSections.pv && openSections.battery && openSections.grid ? '▾' : '▸'}</span>
                </p>
              </div>
            </button>

            <button
              type="button"
              className="flex flex-col gap-2 bg-emerald-50/70 p-4 text-left sm:flex-row sm:items-center sm:justify-between"
              aria-expanded={openSections.total}
              onClick={() => toggleSection('total')}
            >
              <div className="flex items-center gap-3">
                <AnnualRowIcon icon={Zap} tone="total" />
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-emerald-700">Difference</p>
                  <p className="mt-0.5 text-xs text-emerald-700/75">Baseline minus optimized net cost.</p>
                </div>
              </div>
              <span className="inline-flex items-center gap-3 text-2xl font-semibold tabular-nums text-emerald-800">
                {formatCurrencyAmount(annual.savingsEur, units)}
                <span className="text-base text-emerald-700/60" aria-hidden="true">{openSections.total ? '▾' : '▸'}</span>
              </span>
            </button>
          </div>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[760px] w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-gray-200 bg-white">
                <th scope="col" className="px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Category and flow</th>
                <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Energy / size</th>
                <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Value</th>
                <th scope="col" className="px-4 py-3 text-right text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Avg value</th>
              </tr>
            </thead>
            <tbody>
              <AnnualBreakdownSectionRow label="Household setup" icon={Home} open={openSections.setup} onToggle={() => toggleSection('setup')} tone="home" summary={formatCurrencyAmount(annual.baselineCostEur, units)} />
              {openSections.setup ? (
                <>
                  <AnnualBreakdownRow
                    label="Consumption"
                    energy={formatKwh(annual.loadKwh)}
                    cost={`${formatCurrencyAmount(annual.baselineCostEur, units)} baseline`}
                    avg={formatPriceAmount(accounting.baselineAvgCt, units)}
                  />
                  <AnnualBreakdownRow
                    label="PV size"
                    energy={`${formatSetupSize(pvCapacityWp / 1000)} kWp`}
                    cost={mutedDash()}
                    avg={`${formatKwh(annual.pvGenerationKwh)} generation`}
                  />
                  <AnnualBreakdownRow
                    label="Battery storage"
                    energy={`${formatSetupSize(usableKwh)} kWh`}
                    cost={mutedDash()}
                    avg="configured usable capacity"
                  />
                </>
              ) : null}

              <AnnualBreakdownSectionRow label="PV usage" icon={SunMedium} open={openSections.pv} onToggle={() => toggleSection('pv')} tone="pv" summary={formatCurrencyAmount(pvSubtotalValueEur, units)} />
              {openSections.pv ? (
                <>
                  <AnnualBreakdownRow
                    label="To household"
                    detail="PV consumed by the home directly or after battery storage."
                    energy={formatKwh(annual.directSelfConsumedKwh + accounting.pvBatteryToLoadKwh)}
                    cost={`${formatCurrencyAmount(accounting.pvAvoidedImportEur, units)} avoided grid cost`}
                    avg={`${formatPriceAmount(accounting.pvAvoidedImportAvgCt, units)} / ${annual.selfConsumptionPct.toFixed(0)}% self-consumed`}
                    tone="optimized"
                    total
                  />
                  <AnnualBreakdownRow
                    label="Direct"
                    energy={formatKwh(annual.directSelfConsumedKwh)}
                    cost={formatCurrencyAmount(accounting.directPvAvoidedImportEur, units)}
                    avg={formatPriceAmount(annual.directSelfConsumedKwh > 0 ? (accounting.directPvAvoidedImportEur * 100) / annual.directSelfConsumedKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Via battery"
                    detail="Only appears when storing PV for later load beats direct PV use or export after battery losses."
                    energy={formatKwh(accounting.pvBatteryToLoadKwh)}
                    cost={formatCurrencyAmount(accounting.pvBatteryAvoidedImportEur, units)}
                    avg={formatPriceAmount(accounting.pvBatteryToLoadKwh > 0 ? (accounting.pvBatteryAvoidedImportEur * 100) / accounting.pvBatteryToLoadKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="To grid"
                    detail="PV exported directly or after battery storage."
                    energy={formatKwh(pvToGridKwh)}
                    cost={formatCurrencyAmount(pvExportRevenueEur, units)}
                    avg={formatPriceAmount(pvToGridKwh > 0 ? (pvExportRevenueEur * 100) / pvToGridKwh : 0, units)}
                    tone="optimized"
                    total
                  />
                  <AnnualBreakdownRow
                    label="Direct"
                    energy={formatKwh(annual.directExportKwh)}
                    cost={formatCurrencyAmount(accounting.directExportRevenueEur, units)}
                    avg={formatPriceAmount(accounting.directExportAvgCt, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Via battery"
                    energy={formatKwh(accounting.batteryPvExportKwh)}
                    cost={formatCurrencyAmount(accounting.batteryPvExportRevenueEur, units)}
                    avg={formatPriceAmount(accounting.batteryPvExportAvgCt, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Curtailed"
                    detail="Avoided value from not exporting PV during negative export-price intervals. Informational, not export credit."
                    energy={formatKwh(annual.curtailedKwh)}
                    cost={`${formatCurrencyAmount(accounting.curtailedAvoidedCostEur, units)} avoided negative export cost`}
                    avg={formatPriceAmount(accounting.curtailedAvoidedCostAvgCt, units)}
                    tone="muted"
                  />
                  <AnnualBreakdownRow
                    label="PV value subtotal"
                    detail="Avoided grid import, PV export credit, and avoided negative export cost."
                    energy={`${formatKwh(annual.directSelfConsumedKwh + accounting.pvBatteryToLoadKwh)} local / ${formatKwh(pvToGridKwh)} export`}
                    cost={formatCurrencyAmount(pvSubtotalValueEur, units)}
                    avg={`${formatCurrencyAmount(accounting.pvAvoidedImportEur, units)} local + ${formatCurrencyAmount(pvExportRevenueEur, units)} export + ${formatCurrencyAmount(accounting.curtailedAvoidedCostEur, units)} curtailed`}
                    total
                    tone="optimized"
                  />
                </>
              ) : null}

              <AnnualBreakdownSectionRow label="Battery usage" icon={Battery} open={openSections.battery} onToggle={() => toggleSection('battery')} tone="battery" summary={formatCurrencyAmount(batterySubtotalValueEur, units)} />
              {openSections.battery ? (
                <>
                  <AnnualBreakdownRow
                    label="To household"
                    detail="Battery output serving household load, split by original charge source."
                    energy={formatKwh(annual.batteryToLoadKwh)}
                    cost={formatCurrencyAmount(batteryToLoadValueEur, units)}
                    avg={formatPriceAmount(annual.batteryToLoadKwh > 0 ? (batteryToLoadValueEur * 100) / annual.batteryToLoadKwh : 0, units)}
                    total
                  />
                  <AnnualBreakdownRow
                    label="PV-charged"
                    energy={formatKwh(accounting.pvBatteryToLoadKwh)}
                    cost={`${formatCurrencyAmount(accounting.pvBatteryAvoidedImportEur, units)} avoided grid cost`}
                    avg={formatPriceAmount(accounting.pvBatteryToLoadKwh > 0 ? (accounting.pvBatteryAvoidedImportEur * 100) / accounting.pvBatteryToLoadKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Grid-charged"
                    energy={formatKwh(batteryGridToLoadKwh)}
                    cost="included in grid import"
                    avg={formatPriceAmount(batteryGridToLoadKwh > 0 ? (batteryGridLoadInputCostEur * 100) / batteryGridToLoadKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="To grid"
                    energy={formatKwh(annual.batteryExportKwh)}
                    cost={formatCurrencyAmount(batteryExportRevenueEur, units)}
                    avg={formatPriceAmount(annual.batteryExportKwh > 0 ? (batteryExportRevenueEur * 100) / annual.batteryExportKwh : 0, units)}
                    total
                  />
                  <AnnualBreakdownRow
                    label="PV-charged export"
                    energy={formatKwh(accounting.batteryPvExportKwh)}
                    cost={formatCurrencyAmount(accounting.batteryPvExportRevenueEur, units)}
                    avg={formatPriceAmount(accounting.batteryPvExportAvgCt, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Grid-charged export"
                    energy={formatKwh(accounting.batteryGridExportKwh)}
                    cost={formatCurrencyAmount(accounting.batteryGridExportRevenueEur, units)}
                    avg={formatPriceAmount(accounting.batteryGridExportGrossAvgCt, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Battery value subtotal"
                    detail="Battery load value plus gross battery export credit. Grid-charge input cost is still shown under grid import."
                    energy={`${formatKwh(annual.batteryToLoadKwh)} load / ${formatKwh(annual.batteryExportKwh)} export`}
                    cost={formatCurrencyAmount(batterySubtotalValueEur, units)}
                    avg={`${formatCurrencyAmount(batteryToLoadValueEur, units)} load + ${formatCurrencyAmount(batteryExportRevenueEur, units)} export`}
                    total
                    tone="optimized"
                  />
                </>
              ) : null}

              <AnnualBreakdownSectionRow label="Grid import" icon={Zap} open={openSections.grid} onToggle={() => toggleSection('grid')} tone="grid" summary={formatCurrencyAmount(accounting.totalGridImportCostEur, units)} />
              {openSections.grid ? (
                <>
                  <AnnualBreakdownRow
                    label="To household"
                    detail="Imported kWh serving household demand directly."
                    energy={formatKwhWithShare(accounting.gridToLoadKwh, annual.loadKwh)}
                    cost={formatCurrencyAmount(accounting.gridToLoadCostEur, units)}
                    avg={formatPriceAmount(accounting.gridToLoadAvgCt, units)}
                    total
                  />
                  <AnnualBreakdownRow
                    label="Spot energy"
                    energy={formatKwh(accounting.gridToLoadKwh)}
                    cost={formatCurrencyAmount(accounting.gridToLoadSpotCostEur, units)}
                    avg={formatPriceAmount(accounting.gridToLoadKwh > 0 ? (accounting.gridToLoadSpotCostEur * 100) / accounting.gridToLoadKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Retail add-ons"
                    detail="Grid fees, levies, supplier margin, and VAT uplift."
                    energy={formatKwh(accounting.gridToLoadKwh)}
                    cost={formatCurrencyAmount(accounting.gridToLoadRetailAddOnsEur, units)}
                    avg={formatPriceAmount(accounting.gridToLoadKwh > 0 ? (accounting.gridToLoadRetailAddOnsEur * 100) / accounting.gridToLoadKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="To battery"
                    detail="Grid-charged battery kWh on the same retail tariff basis."
                    energy={formatKwh(annual.gridToBatteryKwh)}
                    cost={formatCurrencyAmount(accounting.gridToBatteryCostEur, units)}
                    avg={formatPriceAmount(accounting.gridToBatteryAvgCt, units)}
                    total
                  />
                  <AnnualBreakdownRow
                    label="Spot energy"
                    energy={formatKwh(annual.gridToBatteryKwh)}
                    cost={formatCurrencyAmount(accounting.gridToBatterySpotCostEur, units)}
                    avg={formatPriceAmount(annual.gridToBatteryKwh > 0 ? (accounting.gridToBatterySpotCostEur * 100) / annual.gridToBatteryKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Retail add-ons"
                    detail="Same retail add-on stack as household grid import."
                    energy={formatKwh(annual.gridToBatteryKwh)}
                    cost={formatCurrencyAmount(accounting.gridToBatteryRetailAddOnsEur, units)}
                    avg={formatPriceAmount(annual.gridToBatteryKwh > 0 ? (accounting.gridToBatteryRetailAddOnsEur * 100) / annual.gridToBatteryKwh : 0, units)}
                    indent
                  />
                  <AnnualBreakdownRow
                    label="Total grid import"
                    energy={formatKwh(accounting.totalGridImportKwh)}
                    cost={formatCurrencyAmount(accounting.totalGridImportCostEur, units)}
                    avg={formatPriceAmount(accounting.totalGridImportAvgCt, units)}
                    total
                    tone="optimized"
                  />
                </>
              ) : null}

              <AnnualBreakdownSectionRow label="Annual total" icon={Gauge} open={openSections.total} onToggle={() => toggleSection('total')} tone="total" summary={formatCurrencyAmount(annual.savingsEur, units)} />
              {openSections.total ? (
                <AnnualBreakdownRow
                  label="Total annual benefit"
                  detail="Consumption/import savings plus export credit. Curtailed PV avoided negative export cost remains informational."
                  energy={`${formatKwh(accounting.totalGridImportKwh)} import / ${formatKwh(accounting.exportedEnergyKwh)} export`}
                  cost={formatCurrencyAmount(annual.savingsEur, units)}
                  avg={`${formatCurrencyAmount(accounting.consumptionImportSavingsEur, units)} savings + ${formatCurrencyAmount(annual.exportRevenueEur, units)} export`}
                  total
                  tone="optimized"
                />
              ) : null}
            </tbody>
          </table>
        </div>
      </CardContent>
    </Card>
  )
}

function AnnualExportCreditCard({
  annual,
  units,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
}) {
  const accounting = summarizeAnnualAccounting(annual)

  return (
    <Card className="overflow-hidden border-gray-200/80 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Export credit</p>
            <h3 className="mt-1 text-lg font-semibold text-gray-900">Export kept separate from household consumption</h3>
          </div>
          <p className="max-w-xl text-xs leading-5 text-gray-500">
            Grid-charged battery export shows gross revenue and net result. The total export credit remains gross export revenue because grid charging cost is already inside optimized import cost.
          </p>
        </div>

        <div className="mt-5 overflow-x-auto rounded-lg border border-gray-200">
          <table className="min-w-[760px] w-full border-collapse text-sm">
            <thead className="bg-gray-50 text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-400">
              <tr>
                <th scope="col" className="px-4 py-3 text-left">Flow</th>
                <th scope="col" className="px-4 py-3 text-right">Energy</th>
                <th scope="col" className="px-4 py-3 text-right">Gross credit</th>
                <th scope="col" className="px-4 py-3 text-right">Net result</th>
                <th scope="col" className="px-4 py-3 text-right">Avg value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-200 bg-white">
              <tr>
                <th scope="row" className="px-4 py-3 text-left font-medium text-gray-800">Direct PV export</th>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatKwh(annual.directExportKwh)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{formatCurrencyAmount(accounting.directExportRevenueEur, units)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">same as gross</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatPriceAmount(accounting.directExportAvgCt, units)}</td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-3 text-left font-medium text-gray-800">PV battery export</th>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatKwh(accounting.batteryPvExportKwh)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{formatCurrencyAmount(accounting.batteryPvExportRevenueEur, units)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">same as gross</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-700">{formatPriceAmount(accounting.batteryPvExportAvgCt, units)}</td>
              </tr>
              <tr>
                <th scope="row" className="px-4 py-3 text-left align-top font-medium text-gray-800">
                  Grid battery export
                  <p className="mt-1 max-w-[240px] text-[11px] font-normal leading-4 text-gray-400">Net result subtracts attributed grid charge cost already included in optimized import cost.</p>
                </th>
                <td className="px-4 py-3 text-right align-top tabular-nums text-gray-700">{formatKwh(accounting.batteryGridExportKwh)}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums font-semibold text-gray-900">{formatCurrencyAmount(accounting.batteryGridExportRevenueEur, units)}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums font-semibold text-gray-900">{formatCurrencyAmount(accounting.batteryGridExportNetEur, units, { signed: true })}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-gray-700">{formatPriceAmount(accounting.batteryGridExportNetAvgCt, units)}</td>
              </tr>
              <tr className="bg-gray-50/70">
                <th scope="row" className="px-4 py-3 text-left align-top font-medium text-gray-600">
                  Curtailed PV
                  <p className="mt-1 max-w-[280px] text-[11px] font-normal leading-4 text-gray-400">Avoided cost is summed per interval from curtailed kWh and that interval&apos;s negative export price. Not export credit.</p>
                </th>
                <td className="px-4 py-3 text-right align-top tabular-nums text-gray-600">{formatKwh(annual.curtailedKwh)}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-gray-400">{mutedDash('not applicable')}</td>
                <td className="px-4 py-3 text-right align-top tabular-nums font-semibold text-gray-600">{formatCurrencyAmount(accounting.curtailedAvoidedCostEur, units)} avoided</td>
                <td className="px-4 py-3 text-right align-top tabular-nums text-gray-600">{formatPriceAmount(accounting.curtailedAvoidedCostAvgCt, units)}</td>
              </tr>
            </tbody>
            <tfoot className="border-t border-gray-300 bg-white">
              <tr>
                <th scope="row" className="px-4 py-3 text-left font-semibold text-gray-900">Total export credit</th>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{formatKwh(accounting.exportedEnergyKwh)}</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{formatCurrencyAmount(annual.exportRevenueEur, units)}</td>
                <td className="px-4 py-3 text-right tabular-nums text-gray-500">before import-cost offset</td>
                <td className="px-4 py-3 text-right tabular-nums font-semibold text-gray-900">{formatPriceAmount(accounting.exportAvgCt, units)}</td>
              </tr>
            </tfoot>
          </table>
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
  topBadgeLabel?: string
  topBadgeTone?: 'neutral' | 'slate' | 'emerald' | 'sky'
  segmentBraces?: Array<{
    color: string
    label: string
    detailLabel?: string
    ratio: number
  }>
  fillSegments?: Array<{ color: string; ratio: number; striped?: boolean; stripeColor?: string }>
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
  if (kind === 'kwh') return formatSceneKwh(value)
  if (kind === 'ct') return `${value.toFixed(2)} ${units.priceUnit}`
  return `${units.currencySym}${value.toFixed(0)}`
}

function formatMetricDelta(
  value: number,
  kind: AllocationMetricKind,
  units: ReturnType<typeof getPriceUnits>,
): string {
  if (kind === 'share') return `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}%`
  if (kind === 'kwh') return `${value >= 0 ? '+' : '-'}${formatSceneKwh(Math.abs(value))}`
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

function stripedFill(color: string, stripeColor = 'rgba(255,255,255,0.55)'): string {
  return `repeating-linear-gradient(-45deg, ${color} 0px, ${color} 8px, ${stripeColor} 8px, ${stripeColor} 12px)`
}

function formatNetResultLabel(valueEur: number, currencySym: string): string {
  const prefix = valueEur >= 0 ? 'Net benefit' : 'Net loss'
  return `${prefix} ${formatSignedCurrency(valueEur, currencySym)}`
}

function getAllocationFillSegment(bucket: AllocationBucket): NonNullable<WaterfallChartColumn['fillSegments']>[number] {
  if (bucket.key === 'pvStored') {
    return {
      color: ALLOCATION_FLOW_COLORS.batteryPvExport,
      ratio: 1,
      striped: true,
      stripeColor: 'rgba(47,111,179,0.42)',
    }
  }

  if (bucket.key === 'gridStored') {
    return {
      color: ALLOCATION_FLOW_COLORS.batteryGridExport,
      ratio: 1,
      striped: true,
      stripeColor: 'rgba(47,111,179,0.58)',
    }
  }

  return { color: bucket.color, ratio: 1 }
}

function formatSetupSize(value: number): string {
  return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(1)
}

function addDays(date: string, days: number): string {
  const next = new Date(`${date}T12:00:00Z`)
  next.setUTCDate(next.getUTCDate() + days)
  return next.toISOString().slice(0, 10)
}

function slicePvBatteryResult(
  baseResult: PvBatteryAnnualResult,
  slots: PvBatteryAnnualResult['slots'],
): PvBatteryAnnualResult | null {
  if (slots.length === 0) return null

  return aggregatePvBatteryAnnualResult(slots, {
    planningModel: baseResult.planningModel,
    modelLabel: baseResult.modelLabel,
    assumptions: baseResult.assumptions,
    runs: baseResult.runs,
  })
}

function findMiddaySlotIndex<T extends { date: string; hour: number; minute?: number }>(
  slots: T[],
  date: string,
): number {
  return slots.findIndex((slot) => slot.date === date && slot.hour === 12 && (slot.minute ?? 0) === 0)
}

const ALLOCATION_SCENE_NODE_LAYOUT: Record<FlowNodeKey, {
  left: string
  top: string
  label: string
  eyebrow?: string
  emphasis?: 'normal' | 'hero'
}> = {
  grid: {
    left: '15%',
    top: '52%',
    label: 'Grid',
    eyebrow: 'Market connection',
  },
  pv: {
    left: '50%',
    top: '21%',
    label: 'PV',
    eyebrow: 'On-site generation',
  },
  battery: {
    left: '50%',
    top: '79%',
    label: 'Battery',
    eyebrow: 'Shifted energy',
  },
  home: {
    left: '80%',
    top: '52%',
    label: 'Household load',
    eyebrow: 'Delivered destination',
    emphasis: 'hero',
  },
}

function getAllocationSceneWidth(sharePct: number, maxSharePct: number): number {
  const normalized = maxSharePct > 0 ? sharePct / maxSharePct : 0
  return 4 + (normalized * 8)
}

function formatScenePriceBadge(
  entry: { kind: 'bucket'; bucket: AllocationBucket } | { kind: 'export'; exportRevenueEur: number; exportAvgCt: number },
  units: ReturnType<typeof getPriceUnits>,
): string {
  if (entry.kind === 'export') return `+${units.currencySym}${entry.exportRevenueEur.toFixed(0)} rev.`
  return `${entry.bucket.unitCostCtKwh.toFixed(2)} ${units.priceUnit}`
}

function AllocationSceneNode({
  node,
  muted = false,
  metrics = [],
}: {
  node: FlowNodeKey
  muted?: boolean
  metrics?: AllocationNodeMetric[]
}) {
  const meta = ALLOCATION_SCENE_NODE_LAYOUT[node]
  const iconMeta = FLOW_NODE_META[node]
  const Icon = iconMeta.icon
  const isHero = meta.emphasis === 'hero'
  const iconSize = isHero ? 'h-6 w-6' : 'h-5 w-5'
  const shellSize = isHero ? 'h-[96px] w-[96px]' : 'h-[86px] w-[86px]'
  const primaryMetric = metrics[0]
  const gridMetrics = node === 'grid' ? metrics.slice(0, 2) : []

  return (
    <div
      className={cn('absolute z-20 -translate-x-1/2 -translate-y-1/2 transition-opacity', muted && 'opacity-45')}
      style={{ left: meta.left, top: meta.top }}
    >
      <div className="flex flex-col items-center">
        {meta.eyebrow ? (
          <p className="mb-1 text-center text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-400">{meta.eyebrow}</p>
        ) : null}
        <p className={cn(
          'mb-1.5 whitespace-nowrap text-center text-[13px] font-semibold tracking-[0.01em] text-slate-900',
          isHero && 'text-[14px]',
        )}>
          {meta.label}
        </p>
        <div
          className={cn(
            'relative flex flex-col items-center justify-center rounded-full border border-white/80 bg-white/86 text-center backdrop-blur-md shadow-[0_20px_40px_rgba(15,23,42,0.14)]',
            shellSize,
          )}
          style={{
            boxShadow: `0 20px 40px rgba(15,23,42,0.14), inset 0 1px 0 rgba(255,255,255,0.85)`,
          }}
        >
          <div className="flex items-center justify-center" style={{ color: iconMeta.text }}>
            <Icon className={iconSize} />
          </div>
          {node === 'grid' && gridMetrics.length > 0 ? (
            <div className="mt-1 space-y-0.5">
              {gridMetrics.map((metric) => (
                <p key={metric.label} className="flex items-center justify-center gap-1 text-[10px] font-bold tabular-nums text-slate-900">
                  <span style={{ color: metric.color }}>{metric.label}</span>
                  <span>{metric.value}</span>
                </p>
              ))}
            </div>
          ) : primaryMetric ? (
            <p className="mt-1 max-w-[84%] truncate text-[13px] font-bold tabular-nums text-slate-900">
              {primaryMetric.value}
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}

function AllocationSceneLane({
  path,
  color,
  width,
  striped = false,
  label,
  labelDetail,
  labelX,
  labelY,
  labelAnchor = 'middle',
  speedSeconds = 6,
}: {
  path: string
  color: string
  width: number
  striped?: boolean
  label?: string
  labelDetail?: string
  labelX?: number
  labelY?: number
  labelAnchor?: 'start' | 'middle' | 'end'
  speedSeconds?: number
}) {
  const dotCount = Math.max(2, Math.min(3, Math.round(width / 5)))
  const labelText = labelDetail ?? label ?? ''
  const labelWidth = Math.max(112, Math.min(156, (labelText.length * 7.5) + 34))
  const labelLeft = labelAnchor === 'end'
    ? labelX === undefined ? 0 : labelX - labelWidth
    : labelAnchor === 'middle'
      ? labelX === undefined ? 0 : labelX - (labelWidth / 2)
      : labelX ?? 0
  const labelDotX = labelLeft + 14
  const labelTextX = labelLeft + 24

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
        markerEnd="url(#allocation-flow-arrow)"
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
      {label && labelX !== undefined && labelY !== undefined ? (
        <g>
          <rect
            x={labelLeft}
            y={labelY - 15}
            width={labelWidth}
            height="30"
            rx="15"
            fill="rgba(255,255,255,0.94)"
            stroke="rgba(100,116,139,0.30)"
          />
          <circle
            cx={labelDotX}
            cy={labelY}
            r="4"
            fill={color}
          />
          <text
            x={labelTextX}
            y={labelY}
            textAnchor="start"
            dominantBaseline="middle"
            fill="#0F172A"
            className="select-none text-[14px] font-bold tabular-nums"
          >
            {labelDetail ?? label}
          </text>
        </g>
      ) : null}
    </>
  )
}

function DeliveredAllocationScene({
  visibleBuckets,
  showExportBucket,
  stats,
  setup,
  units,
  timeline,
}: {
  visibleBuckets: AllocationBucket[]
  showExportBucket: boolean
  stats: {
    deliveredLoadKwh: number
    exportKwh: number
    directExportKwh: number
    batteryExportKwh: number
    exportRevenueEur: number
    exportAvgCt: number
  }
  setup: {
    pvCapacityWp: number
    usableKwh: number
  }
  units: ReturnType<typeof getPriceUnits>
  timeline?: ReactNode
}) {
  const exportSharePct = (stats.exportKwh / Math.max(stats.deliveredLoadKwh, 1e-6)) * 100
  const maxSharePct = Math.max(
    ...visibleBuckets.map((bucket) => bucket.sharePct),
    showExportBucket ? exportSharePct : 0,
    1,
  )
  const bucketByKey = new Map(visibleBuckets.map((bucket) => [bucket.key, bucket]))
  const makeBucketMetric = (bucket: AllocationBucket): AllocationNodeMetric => ({
    label: bucket.shortLabel,
    value: formatSceneKwh(bucket.kwh),
    color: bucket.color,
    tooltip: (
      <div className="space-y-1.5">
        <p className="font-medium text-slate-900">{bucket.label}</p>
        <p>{bucket.sharePct.toFixed(1)}% of delivered load</p>
        <p>Unit cost: {bucket.unitCostCtKwh.toFixed(2)} {units.priceUnit}</p>
        <p>Modeled cost: {units.currencySym}{bucket.totalCostEur.toFixed(0)}</p>
      </div>
    ),
  })
  const pvMetrics: AllocationNodeMetric[] = []
  if (setup.pvCapacityWp > 0) {
    pvMetrics.push({
      label: 'Setup',
      value: `${formatSetupSize(setup.pvCapacityWp / 1000)} kWp`,
      color: ALLOCATION_FLOW_COLORS.pvDirect,
    })
  }
  const pvDirectBucket = bucketByKey.get('pvDirect')
  if (pvDirectBucket) pvMetrics.push(makeBucketMetric(pvDirectBucket))

  const batteryMetrics: AllocationNodeMetric[] = []
  if (setup.usableKwh > 0) {
    batteryMetrics.push({
      label: 'Setup',
      value: `${formatSetupSize(setup.usableKwh)} kWh`,
      color: ALLOCATION_FLOW_COLORS.gridStored,
    })
  }
  const pvStoredBucket = bucketByKey.get('pvStored')
  const gridStoredBucket = bucketByKey.get('gridStored')
  if (pvStoredBucket) batteryMetrics.push(makeBucketMetric(pvStoredBucket))
  if (gridStoredBucket) batteryMetrics.push(makeBucketMetric(gridStoredBucket))

  const gridImportKwh =
    (bucketByKey.get('gridDirect')?.kwh ?? 0) +
    (bucketByKey.get('gridStored')?.kwh ?? 0)

  const nodeMetrics: Record<FlowNodeKey, AllocationNodeMetric[]> = {
    grid: [
      {
        label: '->',
        value: formatSceneKwh(gridImportKwh),
        color: ALLOCATION_FLOW_COLORS.gridDirect,
      },
      {
        label: '<-',
        value: formatSceneKwh(showExportBucket ? stats.exportKwh : 0),
        color: ALLOCATION_FLOW_COLORS.pvExport,
      },
    ],
    pv: pvMetrics,
    battery: batteryMetrics,
    home: [
      {
        label: 'Served load',
        value: formatSceneKwh(stats.deliveredLoadKwh),
        color: ALLOCATION_FLOW_COLORS.household,
      },
      ...visibleBuckets.map((bucket) => ({
        label: bucket.shortLabel,
        value: `${bucket.sharePct.toFixed(1)}%`,
        color: bucket.color,
        tooltip: (
          <div className="space-y-1.5">
            <p className="font-medium text-slate-900">{bucket.label}</p>
            <p>{formatSceneKwh(bucket.kwh)} delivered to household load.</p>
            <p>Unit cost: {bucket.unitCostCtKwh.toFixed(2)} {units.priceUnit}</p>
          </div>
        ),
      })),
    ],
  }

  const laneSpecs: AllocationSceneLaneSpec[] = visibleBuckets.flatMap((bucket) => {
    const laneWidth = getAllocationSceneWidth(bucket.sharePct, maxSharePct)
    const laneKwh = formatSceneKwh(bucket.kwh)
    if (bucket.key === 'gridDirect') {
      return [{
        key: bucket.key,
        path: 'M228 292 L704 292',
        color: bucket.color,
        width: laneWidth,
        label: laneKwh,
        labelX: 458,
        labelY: 258,
      }]
    }
    if (bucket.key === 'pvDirect') {
      return [{
        key: bucket.key,
        path: 'M532 150 C596 226 646 252 704 252',
        color: bucket.color,
        width: laneWidth,
        label: laneKwh,
        labelX: 626,
        labelY: 218,
      }]
    }
    if (bucket.key === 'pvStored') {
      return [
        {
          key: `${bucket.key}-charge`,
          path: 'M500 166 L500 390',
          color: bucket.color,
          width: laneWidth,
        },
        {
          key: `${bucket.key}-serve`,
          path: 'M540 412 C604 350 652 332 704 332',
          color: bucket.color,
          width: laneWidth,
          label: laneKwh,
          labelX: 642,
          labelY: 316,
        },
      ]
    }
    return [
      {
        key: `${bucket.key}-charge`,
        path: 'M228 318 C318 318 370 390 458 414',
        color: bucket.color,
        width: laneWidth,
        label: laneKwh,
        labelX: 340,
        labelY: 350,
      },
      {
        key: `${bucket.key}-serve`,
        path: 'M540 438 C610 384 656 370 704 370',
        color: bucket.color,
        width: laneWidth,
        label: laneKwh,
        labelX: 632,
        labelY: 402,
      },
    ]
  })

  const mobileEntries: AllocationMobileEntry[] = visibleBuckets.map((bucket) => ({
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
    const directExportSharePct = (stats.directExportKwh / Math.max(stats.deliveredLoadKwh, 1e-6)) * 100
    const batteryExportSharePct = (stats.batteryExportKwh / Math.max(stats.deliveredLoadKwh, 1e-6)) * 100
    if (stats.directExportKwh > 1e-6) {
      laneSpecs.push({
        key: 'pv-export',
        path: 'M470 150 C432 222 332 250 228 266',
        color: ALLOCATION_FLOW_COLORS.pvExport,
        width: getAllocationSceneWidth(directExportSharePct, maxSharePct),
        striped: true,
        label: formatSceneKwh(stats.directExportKwh),
        labelX: 346,
        labelY: 222,
      })
    }
    if (stats.batteryExportKwh > 1e-6) {
      laneSpecs.push({
        key: 'battery-export',
        path: 'M458 438 C354 414 318 338 228 338',
        color: ALLOCATION_FLOW_COLORS.batteryExport,
        width: getAllocationSceneWidth(batteryExportSharePct, maxSharePct),
        striped: true,
        label: formatSceneKwh(stats.batteryExportKwh),
        labelX: 340,
        labelY: 380,
      })
    }
    mobileEntries.push({
      key: 'export',
      title: 'Export',
      route: 'PV / battery -> grid',
      sharePct: exportSharePct,
      kwh: stats.exportKwh,
      color: ALLOCATION_FLOW_COLORS.pvExport,
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
    <div>
      <div className="hidden overflow-hidden bg-white md:block">
        {timeline}
        <div className="relative aspect-[2/1]">
          <svg viewBox="0 40 1000 500" className="h-full w-full" aria-hidden="true">
            <defs>
              <marker
                id="allocation-flow-arrow"
                viewBox="0 0 12 12"
                markerWidth="3.4"
                markerHeight="3.4"
                refX="10"
                refY="6"
                orient="auto"
                markerUnits="strokeWidth"
              >
                <path
                  d="M2 2.5 L9.5 6 L2 9.5"
                  fill="none"
                  stroke="context-stroke"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </marker>
            </defs>
            <rect x="0" y="40" width="1000" height="500" fill="#FFFFFF" />
            <path d="M150 292 L790 292" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            <path d="M500 118 L500 442" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            <path d="M470 150 C432 222 332 250 228 266" fill="none" stroke="rgba(214,176,75,0.14)" strokeWidth="1" />
            <path d="M532 150 C596 226 646 252 704 252" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            <path d="M458 438 C354 414 318 338 228 338" fill="none" stroke="rgba(47,111,179,0.10)" strokeWidth="1" />
            <path d="M540 438 C610 384 656 370 704 370" fill="none" stroke="rgba(148,163,184,0.08)" strokeWidth="1" />
            <rect x="214" y="244" width="28" height="116" rx="14" fill="rgba(255,255,255,0.78)" stroke="rgba(148,163,184,0.24)" />
            {[266, 292, 318, 338].map((portY) => (
              <circle key={`allocation-grid-port-${portY}`} cx="228" cy={portY} r="4.5" fill="rgba(148,163,184,0.34)" />
            ))}
            <path d="M206 292 L214 292" fill="none" stroke="rgba(71,85,105,0.30)" strokeWidth="10" strokeLinecap="round" />
            <path d="M206 292 L214 292" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" />
            <rect x="690" y="230" width="28" height="162" rx="14" fill="rgba(255,255,255,0.78)" stroke="rgba(148,163,184,0.24)" />
            {[252, 292, 332, 370].map((portY) => (
              <circle key={`allocation-intake-port-${portY}`} cx="704" cy={portY} r="4.5" fill="rgba(148,163,184,0.34)" />
            ))}
            <path d="M718 292 L736 292" fill="none" stroke="rgba(71,85,105,0.30)" strokeWidth="10" strokeLinecap="round" />
            <path d="M718 292 L736 292" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="2" strokeLinecap="round" />
            {laneSpecs.map((lane) => (
              <AllocationSceneLane
                key={lane.key}
                path={lane.path}
                color={lane.color}
                width={lane.width}
                striped={lane.striped}
                label={lane.label}
                labelDetail={lane.labelDetail}
                labelX={lane.labelX}
                labelY={lane.labelY}
                labelAnchor={lane.labelAnchor}
                speedSeconds={Math.max(1.8, 6.6 - (lane.width * 0.24))}
              />
            ))}
          </svg>

          <div className="absolute inset-0">
            {([
              { key: 'grid', muted: false },
              { key: 'pv', muted: false },
              { key: 'battery', muted: false },
              { key: 'home', muted: false },
            ] satisfies Array<{ key: FlowNodeKey; muted: boolean }>).map((node) => (
              <AllocationSceneNode key={node.key} node={node.key} muted={node.muted} metrics={nodeMetrics[node.key]} />
            ))}
          </div>
        </div>
      </div>

      <div className="mt-4 grid gap-3 md:hidden">
        {timeline}
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
                    style={{ background: entry.striped ? stripedFill(entry.color) : `${entry.color}1F` }}
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
                        background: entry.striped ? stripedFill(entry.color) : entry.color,
                      }}
                    />
                  </div>
                  <span className="text-[11px] font-semibold tabular-nums text-slate-600">{entry.sharePct.toFixed(1)}%</span>
                </div>
                <p className="mt-2 text-[11px] tabular-nums text-slate-500">{formatSceneKwh(entry.kwh)} modeled flow</p>
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
  pvCapacityWp,
  usableKwh,
  title = 'Delivered allocation',
  controls,
  timeline,
}: {
  annual: PvBatteryAnnualResult
  units: ReturnType<typeof getPriceUnits>
  flowPermissions: FlowPermissions
  isPvSelected: boolean
  isBatterySelected: boolean
  pvCapacityWp: number
  usableKwh: number
  title?: string
  controls?: ReactNode
  timeline?: ReactNode
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
      acc.batteryPvExportKwh += slot.batteryPvExportKwh
      acc.batteryGridExportKwh += slot.batteryGridExportKwh
      acc.baselineCostEur += slot.baselineCostEur
      acc.exportRevenueEur += slot.exportRevenueEur
      acc.directExportRevenueEur += (slot.directExportKwh * slot.exportPriceCtKwh) / 100
      acc.batteryExportRevenueEur += (slot.batteryExportKwh * slot.exportPriceCtKwh) / 100
      acc.batteryPvExportRevenueEur += (slot.batteryPvExportKwh * slot.exportPriceCtKwh) / 100
      acc.batteryGridExportRevenueEur += (slot.batteryGridExportKwh * slot.exportPriceCtKwh) / 100
      acc.batteryPvExportNetEur += asFinite(slot.batteryPvExportSavingsEur, 0)
      acc.batteryGridExportNetEur += asFinite(slot.batteryGridExportSavingsEur, 0)
      acc.gridDirectCostEur += (slot.gridToLoadKwh * slot.importPriceCtKwh) / 100
      acc.gridStoredInputCostEur += asFinite(slot.batteryGridLoadInputCostEur, 0)
      return acc
    }, {
      gridDirectKwh: 0,
      pvDirectKwh: 0,
      pvStoredKwh: 0,
      gridStoredKwh: 0,
      batteryPvExportKwh: 0,
      batteryGridExportKwh: 0,
      baselineCostEur: 0,
      exportRevenueEur: 0,
      directExportRevenueEur: 0,
      batteryExportRevenueEur: 0,
      batteryPvExportRevenueEur: 0,
      batteryGridExportRevenueEur: 0,
      batteryPvExportNetEur: 0,
      batteryGridExportNetEur: 0,
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
    const directExportAvgCt = annual.directExportKwh > 0 ? (totals.directExportRevenueEur * 100) / annual.directExportKwh : 0
    const batteryExportAvgCt = annual.batteryExportKwh > 0 ? (totals.batteryExportRevenueEur * 100) / annual.batteryExportKwh : 0
    const batteryPvExportAvgCt = totals.batteryPvExportKwh > 0 ? (totals.batteryPvExportRevenueEur * 100) / totals.batteryPvExportKwh : 0
    const batteryGridExportGrossAvgCt = totals.batteryGridExportKwh > 0 ? (totals.batteryGridExportRevenueEur * 100) / totals.batteryGridExportKwh : 0
    const batteryPvExportNetAvgCt = totals.batteryPvExportKwh > 0 ? (totals.batteryPvExportNetEur * 100) / totals.batteryPvExportKwh : 0
    const batteryGridExportNetAvgCt = totals.batteryGridExportKwh > 0 ? (totals.batteryGridExportNetEur * 100) / totals.batteryGridExportKwh : 0
    const batteryGridExportChargeCostEur = totals.batteryGridExportRevenueEur - totals.batteryGridExportNetEur
    const netExportCreditEur =
      totals.directExportRevenueEur +
      totals.batteryPvExportRevenueEur +
      totals.batteryGridExportNetEur

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
        color: ALLOCATION_FLOW_COLORS.gridDirect,
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
        color: ALLOCATION_FLOW_COLORS.pvDirect,
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
        color: ALLOCATION_FLOW_COLORS.pvStored,
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
        color: ALLOCATION_FLOW_COLORS.gridStored,
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
      directExportKwh: annual.directExportKwh,
      batteryExportKwh: annual.batteryExportKwh,
      batteryPvExportKwh: totals.batteryPvExportKwh,
      batteryGridExportKwh: totals.batteryGridExportKwh,
      directExportAvgCt,
      batteryExportAvgCt,
      batteryPvExportAvgCt,
      batteryGridExportGrossAvgCt,
      batteryPvExportNetAvgCt,
      batteryGridExportNetAvgCt,
      batteryPvExportRevenueEur: totals.batteryPvExportRevenueEur,
      batteryGridExportRevenueEur: totals.batteryGridExportRevenueEur,
      batteryPvExportNetEur: totals.batteryPvExportNetEur,
      batteryGridExportNetEur: totals.batteryGridExportNetEur,
      batteryGridExportChargeCostEur,
      exportAvgCt,
      netExportCreditEur,
      exportCreditCtEquivalent: netExportCreditEur > 0 ? (netExportCreditEur * 100) / safeLoadKwh : 0,
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
          fillSegments: [getAllocationFillSegment(bucket)],
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
        color: ALLOCATION_FLOW_COLORS.household,
        priceCtKwh: stats.grossDeliveredCt,
        braceLabel: formatBracePriceLabel(stats.grossDeliveredCt, units.priceUnit),
        braceDetailLabel: formatBraceDetailLabel(stats.grossDeliveredCostEur, volumeMode === 'share' ? 100 : null, volumeMode, units),
        fillSegments: [{ color: ALLOCATION_FLOW_COLORS.household, ratio: 1 }],
        footerLines: [],
        totalValue: running,
      })

      if (showExportBucket) {
        const directExportRatio = stats.exportKwh > 0 ? stats.directExportKwh / stats.exportKwh : 0
        const batteryPvExportRatio = stats.exportKwh > 0 ? stats.batteryPvExportKwh / stats.exportKwh : 0
        const batteryGridExportRatio = stats.exportKwh > 0 ? stats.batteryGridExportKwh / stats.exportKwh : 0
        columns.push({
          key: 'export',
          shortLabel: 'Export',
          label: 'Export outside household total',
          type: 'total',
          color: ALLOCATION_FLOW_COLORS.pvExport,
          priceCtKwh: stats.exportAvgCt,
          braceDetailLabel: volumeMode === 'share'
            ? `${formatSignedCurrency(stats.netExportCreditEur, units.currencySym)} net credit / ${exportBasisValue.toFixed(1)}%`
            : `${formatSignedCurrency(stats.netExportCreditEur, units.currencySym)} net credit`,
          fillSegments: [
            { color: ALLOCATION_FLOW_COLORS.pvExport, ratio: directExportRatio },
            {
              color: ALLOCATION_FLOW_COLORS.batteryPvExport,
              ratio: batteryPvExportRatio,
              striped: true,
              stripeColor: 'rgba(47,111,179,0.42)',
            },
            {
              color: ALLOCATION_FLOW_COLORS.batteryGridExport,
              ratio: batteryGridExportRatio,
              striped: true,
              stripeColor: 'rgba(47,111,179,0.58)',
            },
          ],
          segmentBraces: [
            {
              color: ALLOCATION_FLOW_COLORS.pvExport,
              label: `${stats.directExportAvgCt.toFixed(2)} ${units.priceUnit}`,
              detailLabel: `Direct PV · ${formatSceneKwh(stats.directExportKwh)}`,
              ratio: directExportRatio,
            },
            {
              color: ALLOCATION_FLOW_COLORS.batteryPvExport,
              label: `${stats.batteryPvExportAvgCt.toFixed(2)} ${units.priceUnit}`,
              detailLabel: `Battery PV · ${formatSceneKwh(stats.batteryPvExportKwh)}`,
              ratio: batteryPvExportRatio,
            },
            {
              color: ALLOCATION_FLOW_COLORS.batteryGridExport,
              label: `${stats.batteryGridExportGrossAvgCt.toFixed(2)} ${units.priceUnit}`,
              detailLabel: `${formatNetResultLabel(stats.batteryGridExportNetEur, units.currencySym)} · ${formatSceneKwh(stats.batteryGridExportKwh)}`,
              ratio: batteryGridExportRatio,
            },
          ].filter((segment) => segment.ratio > 1e-6),
          footerLines: [
            `Direct PV feed-in ${formatSceneKwh(stats.directExportKwh)}`,
            `PV battery feed-in ${formatSceneKwh(stats.batteryPvExportKwh)}`,
            `Spot battery feed-in ${formatSceneKwh(stats.batteryGridExportKwh)} · ${formatNetResultLabel(stats.batteryGridExportNetEur, units.currencySym)}`,
          ],
          separatorBefore: true,
          totalValue: exportBasisValue,
        })
      }
    } else {
      const baselineValue = stats.baselineAvgCt
      title = 'Baseline to household price in ct/kWh'
      description = 'Starts from the all-household grid-only baseline, then each delivered bucket reduces or increases the average household price until export credit reaches the final result. Residual grid means only the load still bought directly from the grid after PV and battery routing.'
      totalLabel = formatMetricValue(stats.overallNetEquivalentCt, 'ct', units)

      columns = [{
        key: 'baseline',
        shortLabel: 'Baseline (Grid only)',
        label: 'All-household grid-only baseline',
        type: 'total',
        color: '#CBD5E1',
        priceCtKwh: stats.baselineAvgCt,
        braceLabel: formatBracePriceLabel(stats.baselineAvgCt, units.priceUnit),
        topBadgeLabel: `${formatMetricValue(stats.baselineCostEur, 'eur', units)} · ${formatSceneKwh(stats.deliveredLoadKwh)}`,
        topBadgeTone: 'slate',
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
        fillSegments: [getAllocationFillSegment(bucket)],
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
        color: ALLOCATION_FLOW_COLORS.household,
        priceCtKwh: stats.grossDeliveredCt,
        braceLabel: formatBracePriceLabel(stats.grossDeliveredCt, units.priceUnit),
        topBadgeLabel: `${formatMetricValue(stats.grossDeliveredCostEur, 'eur', units)} · ${formatSceneKwh(stats.deliveredLoadKwh)}`,
        topBadgeTone: 'neutral',
        fillSegments: [{ color: ALLOCATION_FLOW_COLORS.household, ratio: 1 }],
        totalValue: running,
      })
      const exportDelta = -stats.exportCreditCtEquivalent
      const finalValue = running + exportDelta
      columns.push({
        key: 'final',
        shortLabel: 'Household incl. Export',
        label: 'Household including export credit',
        type: 'total',
        color: '#0F766E',
        priceCtKwh: stats.overallNetEquivalentCt,
        braceLabel: formatBracePriceLabel(stats.overallNetEquivalentCt, units.priceUnit),
        topBadgeLabel: `Export credit -${units.currencySym}${stats.netExportCreditEur.toFixed(0)} net`,
        topBadgeTone: 'sky',
        fillSegments: [{ color: '#0F766E', ratio: 1 }],
        separatorBefore: true,
        overlay: {
          fromValue: 0,
          toValue: running,
          label: formatSignedCt(-stats.exportCreditCtEquivalent, units.priceUnit),
          color: ALLOCATION_FLOW_COLORS.pvExport,
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
  const chartHeightPx = 420
  const minBraceHeightPct = 2.6
  const graphControls = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedPillGroup
        options={[
          {
            label: 'Volume',
            active: displayMode === 'volume',
            onClick: () => setDisplayMode('volume'),
          },
          {
            label: 'Price',
            active: displayMode === 'impact',
            onClick: () => setDisplayMode('impact'),
          },
        ]}
      />
      {displayMode === 'volume' ? (
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
      ) : null}
    </div>
  )

  return (
    <div className="space-y-4">
      <Card className="border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-[24px] font-semibold tracking-tight text-slate-900">{title}</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 xl:justify-end">
                {controls}
              </div>
            </div>
          </div>

          <div className="px-4 pb-5 pt-4 sm:px-6">
            <DeliveredAllocationScene
              visibleBuckets={visibleBuckets}
              showExportBucket={showExportBucket}
              stats={stats}
              setup={{
                pvCapacityWp,
                usableKwh,
              }}
              units={units}
              timeline={timeline}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="border-gray-200/80 bg-white shadow-sm">
        <CardContent className="p-0">
          <div className="border-b border-gray-100 px-5 py-5 sm:px-7">
            <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <p className="text-[20px] font-semibold tracking-tight text-slate-900">Household Consumption Breakdown</p>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 xl:justify-end">
                {graphControls}
                {controls}
              </div>
            </div>
          </div>

          <div className="px-4 pb-5 pt-12 sm:px-6">

          <div className="grid grid-cols-[58px_minmax(0,1fr)] items-start gap-3">
            <div className="relative" style={{ height: `${chartHeightPx}px` }}>
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

            <div className="min-w-0 overflow-visible pb-1 pt-9 -mt-9">
              <div className="space-y-3">
                <div className="relative" style={{ height: `${chartHeightPx}px` }}>
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
                    className="absolute inset-0 grid gap-2 sm:gap-3"
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
                          const showCenteredPrice = isImpactChart
                            && column.type === 'total'
                            && ['baseline', 'gross', 'final'].includes(column.key)
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
                            ? column.topBadgeLabel ?? formatMetricValue(column.totalValue ?? 0, 'ct', units)
                            : null
                          const impactRunningToneClass =
                            column.topBadgeTone === 'sky'
                              ? 'border border-sky-100 bg-sky-50 text-sky-800'
                              : column.topBadgeTone === 'emerald'
                                ? 'border border-emerald-100 bg-emerald-50 text-emerald-800'
                                : column.topBadgeTone === 'slate'
                                  ? 'border border-slate-200 bg-slate-50 text-slate-700'
                                  : 'bg-white text-gray-900'
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
                          const segmentBraces = usesBridgeBraceLabels ? column.segmentBraces ?? [] : []
                          const braceHeightPct = Math.min(Math.max(barHeightPct, minBraceHeightPct), 100)
                          const braceMidPct = (lowPct + highPct) / 2
                          const braceBottomPct = Math.max(Math.min(braceMidPct - (braceHeightPct / 2), 100 - braceHeightPct), 0)
                          const hasRightBraceRail = showBridgeBraceLabel || segmentBraces.length > 0
                          const barLeftInsetPx = hasRightBraceRail ? 10 : 16
                          const barRightInsetPx = hasRightBraceRail ? 46 : 16
                          const barFrameStyle = {
                            left: `${barLeftInsetPx}px`,
                            right: `${barRightInsetPx}px`,
                          }
                          let segmentBraceOffsetPct = 0

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
                                <span className={cn('whitespace-nowrap rounded-full px-2 py-0.5 text-[10px] font-semibold tabular-nums shadow-sm', impactRunningToneClass)}>
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
                                  width: '44px',
                                }}
                              >
                                <div className="absolute left-0 top-[1px] h-px w-3 bg-gray-300" />
                                <div className="absolute bottom-[1px] left-0 h-px w-3 bg-gray-300" />
                                <div className="absolute bottom-[1px] left-3 top-[1px] w-px bg-gray-300" />
                                <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                  <div className="flex flex-col gap-1">
                                    <span className="whitespace-nowrap rounded-full border border-gray-200 bg-white/95 px-1 py-0.5 text-[8px] font-semibold tabular-nums text-gray-700 shadow-sm">
                                      {column.braceLabel}
                                    </span>
                                    {column.braceDetailLabel ? (
                                      <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50/95 px-1 py-0.5 text-[7px] font-medium tabular-nums text-slate-500 shadow-sm">
                                        {column.braceDetailLabel}
                                      </span>
                                    ) : null}
                                  </div>
                                </div>
                              </div>
                            ) : null}
                            {segmentBraces.map((segment, segmentIndex) => {
                              const segmentHeightPct = Math.max(segment.ratio * barHeightPct, minBraceHeightPct)
                              const segmentBottomPct = lowPct + (segmentBraceOffsetPct * barHeightPct)
                              segmentBraceOffsetPct += segment.ratio

                              return (
                                <div
                                  key={`${column.key}-segment-brace-${segmentIndex}`}
                                  className="pointer-events-none absolute z-20 transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                                  style={{
                                    bottom: `${segmentBottomPct}%`,
                                    height: `${segmentHeightPct}%`,
                                    right: '4px',
                                    width: '44px',
                                  }}
                                >
                                  <div className="absolute left-0 top-[1px] h-px w-3" style={{ backgroundColor: segment.color }} />
                                  <div className="absolute bottom-[1px] left-0 h-px w-3" style={{ backgroundColor: segment.color }} />
                                  <div className="absolute bottom-[1px] left-3 top-[1px] w-px" style={{ backgroundColor: segment.color }} />
                                  <div className="absolute left-3 top-1/2 -translate-y-1/2">
                                    <div className="flex flex-col gap-1">
                                      <span className="whitespace-nowrap rounded-full border border-gray-200 bg-white/95 px-1 py-0.5 text-[8px] font-semibold tabular-nums text-gray-700 shadow-sm">
                                        {segment.label}
                                      </span>
                                      {segment.detailLabel ? (
                                        <span className="whitespace-nowrap rounded-full border border-slate-200 bg-slate-50/95 px-1 py-0.5 text-[7px] font-medium uppercase tracking-[0.08em] text-slate-500 shadow-sm">
                                          {segment.detailLabel}
                                        </span>
                                      ) : null}
                                    </div>
                                  </div>
                                </div>
                              )
                            })}
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
                                        background: segment.striped ? stripedFill(segment.color, segment.stripeColor) : segment.color,
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
                  className="grid gap-2 sm:gap-3"
                  style={{ gridTemplateColumns: `repeat(${chartSeries.columns.length}, minmax(0, 1fr))` }}
                >
                  {chartSeries.columns.map((column) => (
                    <div
                      key={`${column.key}-xlabel`}
                      className="relative min-h-[54px] transition-all duration-300 ease-[cubic-bezier(0.22,1,0.36,1)]"
                    >
                      {column.separatorBefore ? (
                        <div className="absolute bottom-0 left-[-8px] top-0 border-l-2 border-dashed border-gray-500" />
                      ) : null}
                      <div
                        className="absolute top-0 text-center"
                        style={{
                          left: `${usesBridgeBraceLabels ? 10 : 16}px`,
                          right: `${usesBridgeBraceLabels && column.braceLabel ? 46 : 16}px`,
                        }}
                      >
                        <p className={cn(
                          'text-[10px] font-semibold uppercase tracking-[0.08em] sm:text-[11px]',
                          column.key === 'export' ? 'text-slate-500' : 'text-slate-600',
                        )}>
                          {column.shortLabel}
                        </p>
                        {column.footerLines?.map((line, lineIndex) => (
                          <p key={`${column.key}-footer-${lineIndex}`} className="mt-0.5 truncate text-[9px] leading-4 tabular-nums text-gray-500">
                            {line}
                          </p>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>

          </div>
        </CardContent>
      </Card>
    </div>
  )
}

function normalizeCalculatorState(
  state: CalculatorState,
  availableYears: number[],
): CalculatorState {
  const loadProfileId = getDefaultCalculatorLoadProfileId(state.country)

  const availableTariffs = new Set(getTariffsFor(state.country).map((tariff) => tariff.id))
  const tariffId = availableTariffs.has(state.tariffId)
    ? state.tariffId
    : getDefaultTariffForCountry(state.country)

  const year = availableYears.length === 0 || availableYears.includes(state.year)
    ? state.year
    : availableYears[0]
  const usableKwh = clamp(state.usableKwh, 0, 20)
  const initialSocKwh = clamp(state.initialSocKwh, 0, usableKwh)
  const feedInCapKw = 5

  if (
    year === state.year &&
    loadProfileId === state.loadProfileId &&
    tariffId === state.tariffId &&
    usableKwh === state.usableKwh &&
    initialSocKwh === state.initialSocKwh &&
    feedInCapKw === state.feedInCapKw
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
    feedInCapKw,
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
  const [allocationWindow, setAllocationWindow] = useState<'day' | 'last365'>('day')
  const [allocationDayView, setAllocationDayView] = useState<'quarterHour' | 'fullDay'>('fullDay')
  const [selectedAllocationTimestamp, setSelectedAllocationTimestamp] = useState<number | null>(null)
  const [isAllocationTimelapsePlaying, setIsAllocationTimelapsePlaying] = useState(false)

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
  const [zipInput, setZipInput] = useState(state.pvZipCode)
  const isZipInputCommitted = zipInput === state.pvZipCode && /^\d{5}$/.test(state.pvZipCode)
  const rollingInitialSocKwh = state.usableKwh * 0.5

  useEffect(() => {
    // External URL changes need to replace the local ZIP draft.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setZipInput(state.pvZipCode)
  }, [state.pvZipCode])

  const deferredState = useDeferredValue(state)
  const effectiveYear = state.year || availableYears[0] || new Date().getUTCFullYear()

  const tariffs = useMemo(() => getTariffsFor(CALCULATOR_COUNTRY), [])
  const activeLoadProfileId: BatteryLoadProfileId = 'H25'
  const activeLoadProfile = DE_BATTERY_LOAD_PROFILES.find((profile) => profile.id === activeLoadProfileId)
  const activeLoadProfileLabel = activeLoadProfile?.label ?? activeLoadProfileId
  const selectedTariff = tariffs.find((tariff) => tariff.id === state.tariffId)
  const isPvSelected = state.pvCapacityWp > 0
  const isBatterySelected = state.usableKwh > 0
  const { loadProfile, pvProfile, loading: profilesLoading, error: profilesError } = useBatteryProfiles(
    CALCULATOR_COUNTRY,
    activeLoadProfileId,
    effectiveYear,
  )
  const selectedDateYear = Number(selectedDate?.slice(0, 4))
  const selectedDayProfileYear = Number.isFinite(selectedDateYear) ? selectedDateYear : effectiveYear
  const {
    loadProfile: selectedDayLoadProfile,
    pvProfile: selectedDayPvProfile,
    loading: selectedDayProfilesLoading,
    error: selectedDayProfilesError,
  } = useBatteryProfiles(
    CALCULATOR_COUNTRY,
    activeLoadProfileId,
    selectedDayProfileYear,
  )
  const { data: radiationData, loading: radiationLoading } = usePvRadiation(
    state.pvZipCode || null,
    state.pvCapacityWp / 1000,
  )
  const [tariffComponents, setTariffComponents] = useState<TariffComponentsLookup | null>(null)
  const [tariffComponentsLoading, setTariffComponentsLoading] = useState(false)
  const [tariffComponentsError, setTariffComponentsError] = useState<string | null>(null)

  useEffect(() => {
    if (!/^\d{5}$/.test(state.pvZipCode)) {
      // Reset regional lookup state when the ZIP input is no longer complete.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setTariffComponents(null)
      setTariffComponentsLoading(false)
      setTariffComponentsError(null)
      return
    }

    const controller = new AbortController()
    setTariffComponentsLoading(true)
    setTariffComponentsError(null)

    fetch(`/api/tariff-components?plz=${state.pvZipCode}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Tariff lookup failed (${response.status})`)
        return response.json() as Promise<TariffComponentsLookup>
      })
      .then((data) => {
        setTariffComponents(data)
        setTariffComponentsError(null)
      })
      .catch((error) => {
        if (error instanceof DOMException && error.name === 'AbortError') return
        setTariffComponents(null)
        setTariffComponentsError(error instanceof Error ? error.message : 'Tariff lookup failed')
      })
      .finally(() => {
        if (!controller.signal.aborted) setTariffComponentsLoading(false)
      })

    return () => controller.abort()
  }, [state.pvZipCode])

  const selectedDateOptions = useMemo(() => {
    return prices.daily
      .filter((day) => !prices.lastRealDate || day.date <= prices.lastRealDate)
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [prices.daily, prices.lastRealDate])

  useEffect(() => {
    const latestDate = selectedDateOptions[selectedDateOptions.length - 1]?.date
    if (!latestDate) return
    if (selectedDate && selectedDateOptions.some((day) => day.date === selectedDate)) return
    setSelectedDate(latestDate)
  }, [selectedDate, selectedDateOptions, setSelectedDate])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('tariff', state.tariffId)
    params.set('model', state.planningModel)
    if (state.year) params.set('year', String(state.year))
    params.set('resolution', state.resolution)
    params.set('hours', String(state.viewHours))
    params.set('profile', state.loadProfileId)
    params.set('load', String(Math.round(state.annualLoadKwh)))
    params.set('pv', String(Math.round(state.pvCapacityWp)))
    if (state.pvZipCode) params.set('pvzip', state.pvZipCode)
    params.set('batteryMode', state.batteryConnectionMode)
    params.set('battery', String(state.usableKwh))
    params.set('soc', String(Number(rollingInitialSocKwh.toFixed(2))))
    params.set('charge', String(state.maxChargeKw))
    params.set('discharge', String(state.maxDischargeKw))
    params.set('eff', String(Number(state.roundTripEff.toFixed(2))))
    params.set('feedin', String(state.feedInCapKw))
    params.set('curtailneg', state.curtailPvAtNegativePrices ? '1' : '0')
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
  }, [rollingInitialSocKwh, router, searchParamsString, selectedDate, state])

  useEffect(() => {
    const urlDate = new URLSearchParams(searchParamsString).get('date')
    if (!urlDate || selectedDateOptions.length === 0) return
    if (!selectedDateOptions.some((day) => day.date === urlDate)) return
    setSelectedDate(urlDate)
  }, [searchParamsString, selectedDateOptions, setSelectedDate])

  const regionalSurcharges = useMemo<Surcharges | null>(() => {
    if (!tariffComponents) return null

    const base = surchargesForYear(effectiveYear)
    const supplierMarkupInTaxes = 2.15
    return {
      ...base,
      gridFee: tariffComponents.gridFeeNetto,
      konzessionsabgabe: Math.max(
        0,
        tariffComponents.taxesNetto -
          supplierMarkupInTaxes -
          base.stromsteuer -
          base.kwkg -
          base.offshore -
          base.par19,
      ),
    }
  }, [effectiveYear, tariffComponents])

  const scenario = useMemo(
    () => buildScenario(deferredState, regionalSurcharges),
    [deferredState, regionalSurcharges],
  )
  const activeTariffSurcharges = useMemo(() => {
    const supplierMargin = selectedTariff?.supplierFeeModel === 'margin'
      ? selectedTariff.supplierMarginCtKwh
      : 0
    return {
      ...(regionalSurcharges ?? surchargesForYear(effectiveYear)),
      margin: supplierMargin,
    }
  }, [effectiveYear, regionalSurcharges, selectedTariff])
  const tariffBreakdownRows = useMemo(() => [
    { label: 'Grid fee', value: activeTariffSurcharges.gridFee, source: tariffComponents ? 'ZIP' : 'Default' },
    { label: 'Stromsteuer', value: activeTariffSurcharges.stromsteuer, source: 'Fixed' },
    { label: 'Konzessionsabgabe', value: activeTariffSurcharges.konzessionsabgabe, source: tariffComponents ? 'ZIP' : 'Default' },
    { label: 'KWKG-Umlage', value: activeTariffSurcharges.kwkg, source: 'Year' },
    { label: 'Offshore', value: activeTariffSurcharges.offshore, source: 'Year' },
    { label: '§19 StromNEV', value: activeTariffSurcharges.par19, source: 'Year' },
    { label: 'Supplier margin', value: activeTariffSurcharges.margin, source: selectedTariff?.supplierFeeModel === 'margin' ? 'Tariff' : 'Monthly fee' },
  ], [activeTariffSurcharges, selectedTariff?.supplierFeeModel, tariffComponents])

  const annualSource = useMemo(() => {
    if (state.resolution !== 'quarterhour') return prices.hourly
    return prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
  }, [prices.hourly, prices.hourlyQH, state.resolution])

  const annualPrices = useMemo(() => {
    return annualSource
      .filter((point) => point.date.slice(0, 4) === String(effectiveYear))
      .filter((point) => !prices.lastRealDate || point.date <= prices.lastRealDate)
  }, [annualSource, effectiveYear, prices.lastRealDate])
  const selectedDaySource = annualSource

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
        initialSocKwh: rollingInitialSocKwh,
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
    rollingInitialSocKwh,
    scenario,
    state.planningModel,
  ])

  const dayResult = useMemo(() => {
    const slotsPerHour = state.resolution === 'quarterhour' ? 4 : 1
    const targetCount = state.viewHours * slotsPerHour
    if (!prices.selectedDate) return null

    if (annualResult) {
      const firstIndex = annualResult.slots.findIndex((slot) => slot.date === prices.selectedDate)
      if (firstIndex >= 0) {
        const middayIndex = state.viewHours === 36
          ? findMiddaySlotIndex(annualResult.slots, prices.selectedDate)
          : -1
        const windowStartIndex = middayIndex >= 0 ? middayIndex : firstIndex
        const slots = annualResult.slots.slice(windowStartIndex, windowStartIndex + targetCount)
        if (slots.length === 0) return null
        return {
          ...annualResult,
          months: [],
          slots,
        }
      }
    }

    if (!selectedDayLoadProfile || !selectedDayPvProfile) return null
    const candidateWindowPrices = selectedDaySource
      .filter((point) => point.date >= prices.selectedDate)
      .filter((point) => !prices.lastRealDate || point.date <= prices.lastRealDate)
    const middayPriceIndex = state.viewHours === 36
      ? findMiddaySlotIndex(candidateWindowPrices, prices.selectedDate)
      : -1
    const windowPrices = candidateWindowPrices.slice(
      Math.max(0, middayPriceIndex),
      Math.max(0, middayPriceIndex) + targetCount,
    )

    if (windowPrices.length === 0) return null
    const inputs = buildPvBatteryInputs(windowPrices, selectedDayLoadProfile, selectedDayPvProfile, scenario, radiationAdjustment)
    const result = optimizePvBatteryWithOptions(inputs, scenario, {
      planningModel: state.planningModel,
      modelLabel: planningModelLabel,
      assumptions: plannerAssumptions,
      initialSocKwh: state.planningModel === 'rolling' ? rollingInitialSocKwh : undefined,
      run: {
        runId: `${state.planningModel}-selected-day-replay`,
        runLabel: `${planningModelLabel} selected-day replay`,
      },
    })
    const slots = result.slots.slice(0, targetCount)
    if (slots.length === 0) return null
    return {
      ...result,
      months: [],
      slots,
    }
  }, [
    annualResult,
    plannerAssumptions,
    planningModelLabel,
    prices.lastRealDate,
    prices.selectedDate,
    radiationAdjustment,
    rollingInitialSocKwh,
    scenario,
    selectedDayLoadProfile,
    selectedDayPvProfile,
    selectedDaySource,
    state.planningModel,
    state.resolution,
    state.viewHours,
  ])
  const selectedDayAllocationResult = useMemo(() => {
    if (!dayResult || !prices.selectedDate) return null
    return slicePvBatteryResult(
      dayResult,
      dayResult.slots.filter((slot) => slot.date === prices.selectedDate),
    )
  }, [dayResult, prices.selectedDate])
  const selectedDaySlots = useMemo(
    () => dayResult?.slots.filter((slot) => slot.date === prices.selectedDate) ?? [],
    [dayResult, prices.selectedDate],
  )
  const effectiveAllocationSlot = useMemo(() => {
    if (selectedDaySlots.length === 0) return null
    const firstActiveSlot = selectedDaySlots.find((slot) => {
      const deliveredKwh = slot.gridToLoadKwh + slot.pvToLoadKwh + slot.batteryToLoadKwh
      const exportKwh = slot.directExportKwh + slot.batteryExportKwh
      const batteryMoveKwh = slot.gridToBatteryKwh + slot.pvToBatteryKwh
      return deliveredKwh + exportKwh + batteryMoveKwh > 1e-6
    })
    return selectedDaySlots.find((slot) => slot.timestamp === selectedAllocationTimestamp) ?? firstActiveSlot ?? selectedDaySlots[0]
  }, [selectedAllocationTimestamp, selectedDaySlots])
  useEffect(() => {
    if (!isAllocationTimelapsePlaying || selectedDaySlots.length === 0 || allocationWindow !== 'day') return
    const intervalId = window.setInterval(() => {
      setAllocationDayView('quarterHour')
      setSelectedAllocationTimestamp((current) => {
        const currentIndex = selectedDaySlots.findIndex((slot) => slot.timestamp === current)
        const nextIndex = currentIndex >= 0 ? (currentIndex + 1) % selectedDaySlots.length : 0
        return selectedDaySlots[nextIndex]?.timestamp ?? null
      })
    }, 360)
    return () => window.clearInterval(intervalId)
  }, [allocationWindow, isAllocationTimelapsePlaying, selectedDaySlots])
  const selectedSlotAllocationResult = useMemo(() => {
    if (!dayResult || !effectiveAllocationSlot) return selectedDayAllocationResult
    return slicePvBatteryResult(dayResult, [effectiveAllocationSlot]) ?? selectedDayAllocationResult
  }, [dayResult, effectiveAllocationSlot, selectedDayAllocationResult])
  const trailingAllocationResult = useMemo(() => {
    if (!annualResult || !prices.selectedDate) return selectedDayAllocationResult
    const startDate = addDays(prices.selectedDate, -364)
    return slicePvBatteryResult(
      annualResult,
      annualResult.slots.filter((slot) => slot.date >= startDate && slot.date <= prices.selectedDate),
    ) ?? selectedDayAllocationResult
  }, [annualResult, prices.selectedDate, selectedDayAllocationResult])
  const allocationResult = allocationWindow === 'day'
    ? allocationDayView === 'quarterHour'
      ? selectedSlotAllocationResult
      : selectedDayAllocationResult
    : trailingAllocationResult
  const allocationWindowLabel = allocationWindow === 'day'
    ? allocationDayView === 'quarterHour'
      ? `Quarter-hour · ${effectiveAllocationSlot?.label ?? formatDayLabel(prices.selectedDate)}`
      : `Full day · ${formatDayLabel(prices.selectedDate)}`
    : 'Last 365 days'
  const hasQuarterHourReplay = prices.hourlyQH.length > 0
  const allocationTimeline = allocationWindow === 'day' && selectedDaySlots.length > 0 ? (
    <div className="border-b border-slate-200/80 bg-white/52 px-5 py-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">Selected day timeline</p>
          <p className="mt-1 text-[12px] font-medium text-slate-600">
            {allocationDayView === 'quarterHour' && effectiveAllocationSlot
              ? `${isAllocationTimelapsePlaying ? 'Time-lapse' : 'Pinned'} ${effectiveAllocationSlot.label} · ${effectiveAllocationSlot.loadKwh.toFixed(2)} kWh load`
              : `${formatDayLabel(prices.selectedDate)} · ${selectedDaySlots.length} modeled slots`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => {
              setAllocationDayView('quarterHour')
              setIsAllocationTimelapsePlaying((current) => !current)
            }}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[11px] font-semibold transition-colors',
              isAllocationTimelapsePlaying
                ? 'border-slate-900 bg-slate-900 text-white shadow-sm'
                : 'border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:bg-slate-50',
            )}
          >
            {isAllocationTimelapsePlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            Time-lapse
          </button>
          <SegmentedPillGroup
            options={[
              {
                label: 'Full day',
                active: allocationDayView === 'fullDay',
                onClick: () => setAllocationDayView('fullDay'),
              },
              {
                label: '60 min',
                active: allocationDayView === 'quarterHour' && state.resolution === 'hour',
                onClick: () => {
                  setAllocationDayView('quarterHour')
                  setDraftState((current) => ({ ...current, resolution: 'hour' }))
                },
              },
              {
                label: '15 min',
                active: allocationDayView === 'quarterHour' && state.resolution === 'quarterhour',
                disabled: !hasQuarterHourReplay,
                onClick: () => {
                  if (!hasQuarterHourReplay) return
                  setAllocationDayView('quarterHour')
                  setDraftState((current) => ({ ...current, resolution: 'quarterhour' }))
                },
              },
            ]}
          />
        </div>
      </div>
      <div
        className="grid gap-0.5"
        style={{ gridTemplateColumns: `repeat(${selectedDaySlots.length}, minmax(3px, 1fr))` }}
      >
        {selectedDaySlots.map((slot) => {
          const active = effectiveAllocationSlot?.timestamp === slot.timestamp
          const deliveredKwh = slot.gridToLoadKwh + slot.pvToLoadKwh + slot.batteryToLoadKwh
          const exportKwh = slot.directExportKwh + slot.batteryExportKwh
          const intensity = Math.min(1, Math.max(deliveredKwh + exportKwh, 0.01) / 3)
          return (
            <button
              key={`${slot.timestamp}-${slot.label}`}
              type="button"
              onClick={() => {
                setSelectedAllocationTimestamp(slot.timestamp)
                setIsAllocationTimelapsePlaying(false)
                setAllocationDayView('quarterHour')
              }}
              title={`${slot.label} · load ${slot.loadKwh.toFixed(2)} kWh · export ${exportKwh.toFixed(2)} kWh`}
              className={cn(
                'h-8 rounded-[3px] border transition-all hover:-translate-y-0.5 hover:shadow-sm',
                active && allocationDayView === 'quarterHour' ? 'border-slate-900 ring-2 ring-slate-900/15' : 'border-white/70',
              )}
              style={{
                background: slot.isBatteryExporting
                  ? ALLOCATION_FLOW_COLORS.batteryExport
                  : slot.isDirectPvExporting
                    ? ALLOCATION_FLOW_COLORS.pvExport
                    : slot.isBatteryDischarging
                      ? ALLOCATION_FLOW_COLORS.gridStored
                      : slot.pvToLoadKwh > 1e-6
                        ? ALLOCATION_FLOW_COLORS.pvDirect
                        : ALLOCATION_FLOW_COLORS.gridDirect,
                opacity: 0.28 + (intensity * 0.72),
              }}
              aria-label={`Select ${slot.label}`}
            />
          )
        })}
      </div>
      <div className="mt-2 flex items-center justify-between text-[10px] font-medium text-slate-400">
        <span>00:00</span>
        <span>06:00</span>
        <span>12:00</span>
        <span>18:00</span>
        <span>24:00</span>
      </div>
    </div>
  ) : null

  const loading = prices.loading || profilesLoading || selectedDayProfilesLoading
  const combinedProfilesError = profilesError ?? selectedDayProfilesError
  const noYearData = !loading && !prices.error && availableYears.length === 0 && selectedDateOptions.length === 0
  const pendingFlowPermissionKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => state.flowPermissions[key] !== DEFAULT_FLOW_PERMISSIONS[key])
    .map(({ key }) => key)
  const disabledFlowKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => !state.flowPermissions[key])
    .map(({ key }) => key)
  const selectedDayControls = (
    <div className="sticky top-3 z-30 w-full overflow-hidden rounded-lg border border-gray-200/80 bg-white/95 shadow-sm backdrop-blur">
        <div className="px-4 py-3">
          <DateStrip
            daily={selectedDateOptions}
            selectedDate={prices.selectedDate}
            onSelect={prices.setSelectedDate}
            latestDate={selectedDateOptions[selectedDateOptions.length - 1]?.date}
            requireNextDay={false}
            forecastAfter={prices.lastRealDate || undefined}
            country={CALCULATOR_COUNTRY}
          />
        </div>
    </div>
  )
  const consumptionWindowControls = (
    <div className="flex flex-wrap items-center gap-2">
      <SegmentedPillGroup
        options={[
          {
            label: '24h',
            active: state.viewHours === 24,
            onClick: () => setDraftState((current) => ({ ...current, viewHours: 24 })),
          },
          {
            label: '36h',
            active: state.viewHours === 36,
            onClick: () => setDraftState((current) => ({ ...current, viewHours: 36 })),
          },
          {
            label: '48h',
            active: state.viewHours === 48,
            onClick: () => setDraftState((current) => ({ ...current, viewHours: 48 })),
          },
        ]}
      />
      <SegmentedPillGroup
        options={[
          {
            label: '60 min',
            active: state.resolution === 'hour',
            onClick: () => setDraftState((current) => ({ ...current, resolution: 'hour' })),
          },
          {
            label: '15 min',
            active: state.resolution === 'quarterhour',
            disabled: prices.hourlyQH.length === 0,
            onClick: () => {
              if (prices.hourlyQH.length === 0) return
              setDraftState((current) => ({ ...current, resolution: 'quarterhour' }))
            },
          },
        ]}
      />
    </div>
  )
  const showPlannerCards = false
  const batteryDefaultChargeKw = defaultBatteryChargeKw(state.usableKwh)
  const batteryDefaultDischargeKw = defaultBatteryDischargeKw(state.batteryConnectionMode, state.usableKwh)
  const batteryModeSummary = state.batteryConnectionMode === 'plugin'
    ? 'Plug-in defaults: 0.8 kW discharge, 0.5 C charge, 88% efficiency'
    : 'Wired defaults: 0.5 C charge/discharge, 90% efficiency'
  const handleBatteryCapacityChange = (value: number) => {
    setDraftState((current) => {
      const previousDefaultChargeKw = defaultBatteryChargeKw(current.usableKwh)
      const previousDefaultDischargeKw = defaultBatteryDischargeKw(current.batteryConnectionMode, current.usableKwh)
      const nextDefaultChargeKw = defaultBatteryChargeKw(value)
      const nextDefaultDischargeKw = defaultBatteryDischargeKw(current.batteryConnectionMode, value)
      const followsChargeDefault = Math.abs(current.maxChargeKw - previousDefaultChargeKw) <= BATTERY_POWER_STEP_KW / 2
      const followsDischargeDefault = Math.abs(current.maxDischargeKw - previousDefaultDischargeKw) <= BATTERY_POWER_STEP_KW / 2

      return {
        ...current,
        usableKwh: value,
        initialSocKwh: clamp(current.initialSocKwh, 0, value),
        maxChargeKw: followsChargeDefault ? nextDefaultChargeKw : current.maxChargeKw,
        maxDischargeKw: followsDischargeDefault ? nextDefaultDischargeKw : current.maxDischargeKw,
      }
    })
  }
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
                          Foresight mode
                        </label>
                        <span className="text-[10px] text-gray-400">{planningModelLabel}</span>
                      </div>
                      <SegmentedPillGroup
                        options={[
                          {
                            label: 'Full',
                            active: state.planningModel === 'deterministic',
                            onClick: () => setDraftState((current) => ({ ...current, planningModel: 'deterministic' })),
                          },
                          {
                            label: 'Day-Ahead',
                            active: state.planningModel === 'rolling',
                            onClick: () => setDraftState((current) => ({ ...current, planningModel: 'rolling' })),
                          },
                        ]}
                      />
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
                              setDraftState((current) => {
                                const usableKwh = 10
                                return {
                                  ...current,
                                  usableKwh,
                                  initialSocKwh: usableKwh / 2,
                                  maxChargeKw: defaultBatteryChargeKw(usableKwh),
                                  maxDischargeKw: defaultBatteryDischargeKw(current.batteryConnectionMode, usableKwh),
                                  roundTripEff: defaultBatteryEfficiency(current.batteryConnectionMode),
                                }
                              })
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
                    <div className="border-t border-gray-200 pt-4 space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-1.5">
                          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Dynamic tariff
                          </label>
                          <Tooltip>
                            <TooltipTrigger asChild>
                              <button type="button" className="rounded-full text-gray-400 transition-colors hover:text-gray-700" aria-label="Dynamic tariff cost breakdown">
                                <CircleHelp className="h-3.5 w-3.5" />
                              </button>
                            </TooltipTrigger>
                            <TooltipContent side="right" className="max-w-[320px] rounded-2xl border-gray-200 bg-white p-3 text-[11px] leading-5 text-gray-600">
                              <div className="space-y-2">
                                <div>
                                  <p className="font-semibold text-slate-900">{selectedTariff?.label ?? 'Selected dynamic tariff'}</p>
                                  <p className="text-[10px] text-gray-500">
                                    End-customer import price = spot market + surcharges + grid fees + VAT.
                                  </p>
                                </div>
                                <div className="space-y-1 border-t border-gray-100 pt-2">
                                  {tariffBreakdownRows.map((row) => (
                                    <div key={row.label} className="flex items-center justify-between gap-3">
                                      <span>{row.label}</span>
                                      <span className="shrink-0 font-semibold tabular-nums text-slate-900">
                                        {row.value.toFixed(2)} ct/kWh
                                      </span>
                                    </div>
                                  ))}
                                  <div className="flex items-center justify-between gap-3 border-t border-gray-100 pt-1 font-semibold text-slate-900">
                                    <span>Total netto add-on</span>
                                    <span className="shrink-0 tabular-nums">{totalSurchargesNetto(activeTariffSurcharges).toFixed(2)} ct/kWh</span>
                                  </div>
                                </div>
                                <p className="text-[10px] text-gray-500">
                                  {tariffComponents
                                    ? `ZIP ${tariffComponents.plz}: ${tariffComponents.location}${tariffComponents.dso ? ` · ${tariffComponents.dso}` : ''}.`
                                    : 'Enter a ZIP code to replace default grid fee and concession assumptions.'}
                                </p>
                              </div>
                            </TooltipContent>
                          </Tooltip>
                        </div>
                        {tariffComponentsLoading ? (
                          <span className="text-[10px] text-gray-400">Loading fees...</span>
                        ) : tariffComponents ? (
                          <span className="text-[10px] text-emerald-700">ZIP fees active</span>
                        ) : null}
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

                      <div className="space-y-2 pt-2">
                        <div className="flex items-center justify-between">
                          <label className="text-xs font-semibold uppercase tracking-wide text-gray-500">
                            Location
                          </label>
                          {isZipInputCommitted && radiationData ? (
                            <span className="text-[10px] text-gray-400">{radiationData.location.region}</span>
                          ) : null}
                        </div>
                        <input
                          type="text"
                          maxLength={5}
                          placeholder="ZIP code, e.g. 10115"
                          value={zipInput}
                          onChange={(event) => {
                            const value = event.target.value.replace(/\D/g, '').slice(0, 5)
                            setZipInput(value)
                            if (value.length === 5) {
                              setDraftState((current) => ({ ...current, pvZipCode: value }))
                              return
                            }
                            if (value.length === 0 || state.pvZipCode) {
                              setDraftState((current) => ({ ...current, pvZipCode: '' }))
                            }
                          }}
                          className="w-full rounded-lg border border-gray-200 bg-white px-3 py-2.5 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-gray-400"
                        />
                        {zipInput.length > 0 && zipInput.length < 5 ? (
                          <p className="text-[10px] text-gray-400">Enter 5 digits to load regional values.</p>
                        ) : null}
                        {isZipInputCommitted && radiationLoading ? (
                          <p className="text-[10px] text-gray-400">Loading PV radiation data...</p>
                        ) : null}
                        {isZipInputCommitted && tariffComponents ? (
                          <p className="text-[10px] leading-4 text-emerald-700">
                            Regional tariff add-ons: grid {tariffComponents.gridFeeNetto.toFixed(2)} ct/kWh, taxes {tariffComponents.taxesNetto.toFixed(2)} ct/kWh
                          </p>
                        ) : null}
                        {isZipInputCommitted && tariffComponentsError ? (
                          <p className="text-[10px] leading-4 text-amber-600">
                            Regional grid fees unavailable; using default German tariff assumptions.
                          </p>
                        ) : null}
                        {isZipInputCommitted && radiationData && !radiationData.isDefault ? (
                          <p className="text-[10px] leading-4 text-emerald-700">
                            PVGIS yield: {Math.round(radiationData.annualTotal)} kWh/kWp
                          </p>
                        ) : null}
                        {isZipInputCommitted && radiationData?.isDefault ? (
                          <p className="text-[10px] leading-4 text-amber-600">
                            PVGIS unavailable for this ZIP; using default German radiation values.
                          </p>
                        ) : null}
                      </div>
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

                    <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200 bg-gray-50/70 px-3 py-2">
                      <div className="min-w-0">
                        <p className="text-[11px] font-semibold text-gray-800">Curtail PV at negative prices</p>
                      </div>
                      <button
                        type="button"
                        role="switch"
                        aria-label="Curtail PV at negative prices"
                        aria-checked={state.curtailPvAtNegativePrices}
                        onClick={() => setDraftState((current) => ({
                          ...current,
                          curtailPvAtNegativePrices: !current.curtailPvAtNegativePrices,
                        }))}
                        className={cn(
                          'relative h-5 w-9 shrink-0 rounded-full transition-colors',
                          state.curtailPvAtNegativePrices ? 'bg-slate-700' : 'bg-gray-300',
                        )}
                        title="When enabled, PV surplus is curtailed instead of exported during negative spot-price slots."
                      >
                        <span
                          className={cn(
                            'absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white shadow-sm transition-transform',
                            state.curtailPvAtNegativePrices ? 'translate-x-4' : 'translate-x-0',
                          )}
                        />
                      </button>
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
                  <div className="space-y-3.5">
                    <div className="rounded-lg border border-gray-200 bg-gray-50/70 p-2.5">
                      <div className="flex items-center justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-gray-400">Connection</p>
                          <p className="mt-0.5 text-[11px] leading-4 text-gray-500">{batteryModeSummary}</p>
                        </div>
                        <div className="inline-flex shrink-0 rounded-full bg-gray-100 p-0.5">
                          {[
                            { mode: 'plugin' as const, label: 'Plug-in' },
                            { mode: 'wired' as const, label: 'Wired' },
                          ].map((option) => (
                            <button
                              key={option.mode}
                              type="button"
                              onClick={() => setDraftState((current) => applyBatteryConnectionDefaults(current, option.mode))}
                              className={cn(
                                'rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
                                state.batteryConnectionMode === option.mode
                                  ? 'bg-white text-gray-900 shadow-sm ring-1 ring-gray-200'
                                  : 'text-gray-400 hover:text-gray-600',
                              )}
                            >
                              {option.label}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>

                    <RangeControl
                      label="Usable capacity"
                      value={`${state.usableKwh.toFixed(1)} kWh`}
                      min={0}
                      max={20}
                      step={0.5}
                      sliderValue={state.usableKwh}
                      onChange={handleBatteryCapacityChange}
                      minLabel="0"
                      maxLabel="20 kWh"
                    />

                    {state.planningModel === 'rolling' ? (
                      <div
                        className="rounded-lg border border-emerald-100 bg-emerald-50 px-3 py-2"
                        title="Initial state is fixed for the stitched rolling planner."
                      >
                        <p className="text-[11px] font-semibold text-emerald-800">50% initial SoC · {rollingInitialSocKwh.toFixed(1)} kWh</p>
                      </div>
                    ) : null}

                    <div className="grid gap-4 sm:grid-cols-2">
                      <RangeControl
                        label="Charge limit"
                        value={`${state.maxChargeKw.toFixed(1)} kW`}
                        min={BATTERY_POWER_MIN_KW}
                        max={BATTERY_POWER_MAX_KW}
                        step={BATTERY_POWER_STEP_KW}
                        sliderValue={state.maxChargeKw}
                        onChange={(value) => setDraftState((current) => ({ ...current, maxChargeKw: value }))}
                        minLabel="0.1"
                        maxLabel={`${BATTERY_POWER_MAX_KW} kW`}
                        help={`Full-battery input cap. ${state.batteryConnectionMode === 'plugin' ? `Default is 0.5 C (${batteryDefaultChargeKw.toFixed(1)} kW here), but you can override it.` : 'PV charging and grid charging share this one limit.'}`}
                      />

                      <RangeControl
                        label="Discharge limit"
                        value={`${state.maxDischargeKw.toFixed(1)} kW`}
                        min={BATTERY_POWER_MIN_KW}
                        max={BATTERY_POWER_MAX_KW}
                        step={BATTERY_POWER_STEP_KW}
                        sliderValue={state.maxDischargeKw}
                        onChange={(value) => setDraftState((current) => ({ ...current, maxDischargeKw: value }))}
                        minLabel="0.1"
                        maxLabel={`${BATTERY_POWER_MAX_KW} kW`}
                        help={`Full-battery output cap. ${state.batteryConnectionMode === 'plugin' ? `Plug-in default is ${batteryDefaultDischargeKw.toFixed(1)} kW, but you can override it.` : 'Household discharge and grid export share this one limit.'}`}
                      />
                    </div>

                    <RangeControl
                      label="Efficiency"
                      value={`${Math.round(state.roundTripEff * 100)}%`}
                      min={0.75}
                      max={0.96}
                      step={0.01}
                      sliderValue={state.roundTripEff}
                      onChange={(value) => setDraftState((current) => ({ ...current, roundTripEff: value }))}
                      minLabel="75%"
                      maxLabel="96%"
                    />

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
              {selectedDayControls}
              {loading ? (
                <StatusCard title="Loading calculator inputs" body="Fetching German price history and bundled household profiles." />
              ) : prices.error ? (
                <StatusCard title="Price data could not be loaded" body={prices.error} tone="warning" />
              ) : combinedProfilesError ? (
                <StatusCard title="Profile data could not be loaded" body={combinedProfilesError} tone="warning" />
              ) : noYearData ? (
                <StatusCard
                  title="No complete annual replay is available"
                  body="The calculator needs a full year of German market prices before it can build an annual estimate."
                  tone="warning"
                />
              ) : annualResult ? (
                <>
                  <AnnualSummaryCard annual={annualResult} units={units} />
                  <AnnualBillCard
                    annual={annualResult}
                    units={units}
                    pvCapacityWp={state.pvCapacityWp}
                    usableKwh={state.usableKwh}
                  />
                  <AnnualExportCreditCard annual={annualResult} units={units} />
                  {allocationResult ? (
                    <DeliveredAllocationCard
                      annual={allocationResult}
                      units={units}
                      flowPermissions={state.flowPermissions}
                      isPvSelected={isPvSelected}
                      isBatterySelected={isBatterySelected}
                      pvCapacityWp={state.pvCapacityWp}
                      usableKwh={state.usableKwh}
                      title="Energy Flows"
                      timeline={allocationTimeline}
                      controls={(
                        <SegmentedPillGroup
                          options={[
                            {
                              label: 'Selected day',
                              active: allocationWindow === 'day',
                              onClick: () => setAllocationWindow('day'),
                            },
                            {
                              label: 'Last 365 days',
                              active: allocationWindow === 'last365',
                              onClick: () => setAllocationWindow('last365'),
                            },
                          ]}
                        />
                      )}
                    />
                  ) : null}
                  <ConsumptionPriceBlockCard
                    annualResult={dayResult}
                    dayLabel={formatDayLabel(prices.selectedDate)}
                    units={units}
                    loading={prices.loading}
                    windowControls={consumptionWindowControls}
                  />
                  <PvBatteryDayChart
                    annualResult={dayResult}
                    dayLabel={formatDayLabel(prices.selectedDate)}
                    units={units}
                    loading={loading}
                    priceCurveMode="spot"
                    windowControls={consumptionWindowControls}
                    mode="optimizationFlow"
                  />
                  {showPlannerCards ? (
                    <>
                      <PlanningModelCard
                        planningModel={state.planningModel}
                        onChange={(planningModel) => setDraftState((current) => ({ ...current, planningModel }))}
                      />
                      <PlannerAssumptionsCard
                        planningModel={state.planningModel}
                        assumptions={annualResult.assumptions}
                        initialSocKwh={rollingInitialSocKwh}
                      />
                    </>
                  ) : null}

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
