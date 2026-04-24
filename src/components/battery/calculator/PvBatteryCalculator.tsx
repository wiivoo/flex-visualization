'use client'

import Link from 'next/link'
import { Suspense, type ReactNode, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Battery, BatteryCharging, CircleHelp, Gauge, Home, LineChart, SunMedium, Zap, type LucideIcon } from 'lucide-react'

import { PvBatteryDayChart } from '@/components/battery/calculator/PvBatteryDayChart'
import { DateStrip } from '@/components/v2/DateStrip'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import {
  getDefaultLoadProfileId,
  getLoadProfilesForCountry,
  isLoadProfileValidForCountry,
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

const DE_TEMPORARY_LOAD_PROFILE_IDS: BatteryLoadProfileId[] = ['H25', 'P25', 'S25']

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
    background: '#FFF6D8',
    text: '#7A5B00',
  },
  battery: {
    label: 'Battery',
    icon: BatteryCharging,
    background: '#FFE9D7',
    text: '#9A4E00',
  },
  home: {
    label: 'Home',
    icon: Home,
    background: '#EEF5FF',
    text: '#27558E',
  },
  grid: {
    label: 'Grid',
    icon: Zap,
    background: '#EEF1F5',
    text: '#435061',
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
  loadProfileId: BatteryLoadProfileId
  annualLoadKwh: number
  pvCapacityWp: number
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
    && a.loadProfileId === b.loadProfileId
    && a.annualLoadKwh === b.annualLoadKwh
    && a.pvCapacityWp === b.pvCapacityWp
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
  loadProfileId: 'H25',
  annualLoadKwh: 4500,
  pvCapacityWp: 8000,
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

function getSupportedLoadProfiles(country: PvBatteryCountry) {
  const profiles = getLoadProfilesForCountry(country)
  if (country !== 'DE') return profiles
  return profiles.filter((profile) => DE_TEMPORARY_LOAD_PROFILE_IDS.includes(profile.id))
}

function getDefaultCalculatorLoadProfileId(country: PvBatteryCountry): BatteryLoadProfileId {
  if (country === 'DE') return 'H25'
  return getDefaultLoadProfileId(country)
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
  const supportedProfileIds = new Set(getSupportedLoadProfiles(country).map((profile) => profile.id))
  const loadProfileRaw = params.get('profile') ?? getDefaultCalculatorLoadProfileId(country)
  const loadProfileId = isLoadProfileValidForCountry(loadProfileRaw, country) && supportedProfileIds.has(loadProfileRaw)
    ? loadProfileRaw
    : getDefaultCalculatorLoadProfileId(country)
  const parsedYear = Number(params.get('year'))
  const tariffIds = new Set(getTariffsFor(country).map((tariff) => tariff.id))
  const tariffId = tariffIds.has(params.get('tariff') ?? '')
    ? (params.get('tariff') as string)
    : getDefaultTariffForCountry(country)
  const resolution = params.get('resolution') === 'hour' ? 'hour' : 'quarterhour'

  const getNum = (key: string, fallback: number, min: number, max: number) => {
    const raw = params.get(key)
    if (!raw) return fallback
    const value = Number(raw)
    if (!Number.isFinite(value)) return fallback
    return clamp(value, min, max)
  }

  return {
    country,
    tariffId,
    year: Number.isFinite(parsedYear) ? parsedYear : 0,
    resolution,
    loadProfileId,
    annualLoadKwh: getNum('load', DEFAULT_STATE.annualLoadKwh, 1500, 15000),
    pvCapacityWp: getNum('pv', DEFAULT_STATE.pvCapacityWp, 0, 20000),
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

function PillButton({
  active,
  disabled = false,
  children,
  onClick,
}: {
  active: boolean
  disabled?: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-lg border px-3 py-1.5 text-[12px] font-semibold transition-colors',
        active
          ? 'border-[#313131] bg-[#313131] text-white shadow-sm'
          : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300 hover:bg-[#F8F8F5] hover:text-gray-900',
        disabled && 'cursor-not-allowed opacity-40 hover:border-gray-200',
      )}
    >
      {children}
    </button>
  )
}

function SegmentedPillGroup({
  label,
  options,
}: {
  label: string
  options: Array<{ label: string; active: boolean; onClick: () => void }>
}) {
  return (
    <div className="flex items-center gap-3">
      <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">{label}</span>
      <div className="inline-flex rounded-xl border border-gray-200 bg-[#F8F8F5] p-1">
        {options.map((option) => (
          <button
            key={option.label}
            type="button"
            onClick={option.onClick}
            className={cn(
              'rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors',
              option.active ? 'bg-[#313131] text-white shadow-sm' : 'text-gray-500 hover:bg-white hover:text-gray-700',
            )}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  )
}

function OptionCard({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-[20px] border p-4 text-left transition-all',
        active
          ? 'border-[#313131] bg-[#F8F8F5] text-gray-900 shadow-[0_10px_24px_rgba(15,23,42,0.06)] ring-1 ring-black/5'
          : 'border-gray-200 bg-white text-gray-900 hover:-translate-y-0.5 hover:border-gray-300 hover:bg-[#FBFBF8] hover:shadow-[0_10px_24px_rgba(15,23,42,0.04)]',
      )}
    >
      <p className="text-[14px] font-semibold">{title}</p>
      <p className={cn('mt-1 text-[12px] leading-5', active ? 'text-gray-600' : 'text-gray-500')}>{detail}</p>
    </button>
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
    <div className="rounded-[20px] border border-gray-200 bg-white p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.72)]">
      <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <p className="mt-2 text-2xl font-semibold text-gray-900">{value}</p>
      {hint ? <p className="mt-1 text-[12px] leading-5 text-gray-500">{hint}</p> : null}
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
  const compactValue = value && value.length > 16

  return (
    <Card className="rounded-[24px] border-gray-200 bg-white shadow-sm">
      <CardContent className="p-5 sm:p-6">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</p>
            {value ? (
              <p className={cn(
                'mt-1 font-semibold tracking-tight text-gray-900',
                compactValue ? 'text-lg' : 'text-2xl',
              )}
              >
                {value}
              </p>
            ) : null}
          </div>
          {icon}
        </div>
        <div>{children}</div>
      </CardContent>
    </Card>
  )
}

function FlowNodeBadge({ node }: { node: FlowNodeKey }) {
  const meta = FLOW_NODE_META[node]
  const Icon = meta.icon

  return (
    <div
      className="inline-flex min-w-[106px] items-center justify-center gap-2 rounded-[12px] border px-3.5 py-2.5 shadow-[0_8px_18px_rgba(15,23,42,0.045)]"
      style={{ backgroundColor: meta.background, borderColor: 'rgba(17,24,39,0.05)', color: meta.text }}
    >
      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-white/82 shadow-[inset_0_1px_0_rgba(255,255,255,0.65)]">
        <Icon className="h-3.5 w-3.5" />
      </span>
      <span className="text-[11px] font-semibold uppercase tracking-[0.12em]">{meta.label}</span>
    </div>
  )
}

function getFlowRouteOption(routeKey: FlowPermissionKey) {
  return FLOW_PERMISSION_OPTIONS.find((option) => option.key === routeKey)
}

function FlowLineSwitch({
  routeKey,
  checked,
  onToggle,
}: {
  routeKey: FlowPermissionKey
  checked: boolean
  onToggle: () => void
}) {
  const option = getFlowRouteOption(routeKey)

  return (
    <button
      type="button"
      aria-pressed={checked}
      onClick={onToggle}
      className={cn(
        'relative z-10 inline-flex h-7 w-[46px] items-center rounded-full border transition-all duration-200',
        checked
          ? 'border-[#171717]/10 bg-[#171717] shadow-[0_10px_24px_rgba(15,23,42,0.10)]'
          : 'border-[#CBD5E1] bg-white hover:border-[#94A3B8] hover:bg-[#F8FAFC]',
      )}
      title={option?.title ?? routeKey}
    >
      <span
        className={cn(
          'absolute h-[18px] w-[18px] rounded-full bg-white shadow-[0_2px_8px_rgba(15,23,42,0.16)] transition-transform duration-200',
          checked ? 'translate-x-[23px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  )
}

function FlowVerticalRoute({
  routeKey,
  checked,
  onToggle,
  target,
  staticLabel,
}: {
  routeKey?: FlowPermissionKey
  checked?: boolean
  onToggle?: () => void
  target: FlowNodeKey
  staticLabel?: string
}) {
  return (
    <div className="flex min-w-0 flex-col items-center">
      <div className="my-2 h-6 w-px bg-[#D7DCE3]" />
      {routeKey && onToggle ? (
        <FlowLineSwitch routeKey={routeKey} checked={Boolean(checked)} onToggle={onToggle} />
      ) : (
        <span className="relative z-10 rounded-full border border-[#D7DCE3] bg-white px-3 py-1 text-[10px] font-semibold uppercase tracking-[0.12em] text-[#94A3B8]">
          {staticLabel}
        </span>
      )}
      <div className="my-2 h-6 w-px bg-[#D7DCE3]" />
      <FlowNodeBadge node={target} />
    </div>
  )
}

function FlowSourceColumn({
  source,
  title,
  tone,
  routes,
  permissions,
  onToggle,
}: {
  permissions: FlowPermissions
  onToggle: (key: FlowPermissionKey) => void
  source: FlowNodeKey
  title: string
  tone: 'primary' | 'secondary'
  routes: Array<{ target: FlowNodeKey; routeKey?: FlowPermissionKey; staticLabel?: string }>
}) {
  const isSecondary = tone === 'secondary'

  return (
    <div className="rounded-[20px] border border-[#E5E7EB] bg-[#FBFCFD] p-4">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">{title}</p>
          <p className="mt-1 text-[14px] font-semibold text-gray-900">{isSecondary ? 'Secondary routes' : 'Primary routes'}</p>
        </div>
      </div>

      <div className="flex flex-col items-center">
        <FlowNodeBadge node={source} />
        <div className="mt-3 h-6 w-px bg-[#D7DCE3]" />
        <div className="h-px w-[82%] bg-[#D7DCE3]" />
        <div className="mt-4 grid w-full gap-4" style={{ gridTemplateColumns: `repeat(${routes.length}, minmax(0, 1fr))` }}>
          {routes.map((route) => (
            <FlowVerticalRoute
              key={`${source}-${route.target}-${route.routeKey ?? route.staticLabel}`}
              routeKey={route.routeKey}
              checked={route.routeKey ? permissions[route.routeKey] : undefined}
              onToggle={route.routeKey ? () => onToggle(route.routeKey as FlowPermissionKey) : undefined}
              staticLabel={route.staticLabel}
              target={route.target}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function FlowRouteDiagram({
  permissions,
  onToggle,
}: {
  permissions: FlowPermissions
  onToggle: (key: FlowPermissionKey, checked: boolean) => void
}) {
  const toggle = (key: FlowPermissionKey) => onToggle(key, !permissions[key])

  return (
    <div className="space-y-4">
      <div className="grid gap-4 xl:grid-cols-3">
        <FlowSourceColumn
          source="pv"
          title="PV"
          tone="primary"
          routes={[
            { target: 'home', routeKey: 'pvToLoad' },
            { target: 'battery', routeKey: 'pvToBattery' },
            { target: 'grid', routeKey: 'pvToGrid' },
          ]}
          permissions={permissions}
          onToggle={toggle}
        />

        <FlowSourceColumn
          source="battery"
          title="Battery"
          tone="primary"
          routes={[
            { target: 'home', routeKey: 'batteryToLoad' },
            { target: 'grid', routeKey: 'batteryToGrid' },
          ]}
          permissions={permissions}
          onToggle={toggle}
        />

        <FlowSourceColumn
          source="grid"
          title="Grid"
          tone="secondary"
          routes={[
            { target: 'home', staticLabel: 'Always' },
            { target: 'battery', routeKey: 'gridToBattery' },
          ]}
          permissions={permissions}
          onToggle={toggle}
        />
      </div>
      <p className="text-[12px] leading-5 text-gray-500">
        Grid -&gt; load is always available, so household demand remains served even when storage and export paths are disabled.
      </p>
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
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{eyebrow}</p>
          {help ? <HelpTooltip label={`${title} help`}>{help}</HelpTooltip> : null}
        </div>
        <p className="mt-1 text-[18px] font-semibold tracking-tight text-gray-900">{title}</p>
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
  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-medium text-gray-600">{label}</span>
          {help ? <HelpTooltip label={`${label} help`}>{help}</HelpTooltip> : null}
        </div>
        <span className="text-[12px] font-semibold text-gray-900">{value}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={sliderValue}
        onChange={(event) => onChange(Number(event.target.value))}
        className="h-2 w-full cursor-pointer appearance-none rounded-full bg-[#E7E5E0] accent-[#171717]"
      />
      {minLabel || maxLabel ? (
        <div className="flex justify-between text-[11px] text-gray-400">
          <span>{minLabel}</span>
          <span>{maxLabel}</span>
        </div>
      ) : null}
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
    <Card className="overflow-hidden rounded-[24px] border-gray-200 bg-white shadow-sm">
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
  const loadProfiles = getSupportedLoadProfiles(state.country)
  const loadProfileId = loadProfiles.some((profile) => profile.id === state.loadProfileId)
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
    <Card className="rounded-[24px] border-gray-200 bg-white shadow-sm">
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
      'rounded-[24px] shadow-sm',
      tone === 'warning' ? 'border-amber-200 bg-amber-50' : 'border-gray-200',
    )}>
      <CardContent className="p-6">
        <p className={cn('text-sm font-medium', tone === 'warning' ? 'text-amber-900' : 'text-gray-900')}>{title}</p>
        <p className={cn('mt-2 text-sm leading-6', tone === 'warning' ? 'text-amber-800' : 'text-gray-600')}>{body}</p>
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

  const loadProfiles = useMemo(() => getSupportedLoadProfiles(CALCULATOR_COUNTRY), [])
  const tariffs = useMemo(() => getTariffsFor(CALCULATOR_COUNTRY), [])
  const { loadProfile, pvProfile, loading: profilesLoading, error: profilesError } = useBatteryProfiles(
    CALCULATOR_COUNTRY,
    state.loadProfileId,
    effectiveYear,
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
    if (prices.selectedDate && yearDates.some((day) => day.date === prices.selectedDate)) return
    prices.setSelectedDate(latestDate)
  }, [prices.selectedDate, prices.setSelectedDate, yearDates])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('tariff', state.tariffId)
    if (state.year) params.set('year', String(state.year))
    params.set('resolution', state.resolution)
    params.set('profile', state.loadProfileId)
    params.set('load', String(Math.round(state.annualLoadKwh)))
    params.set('pv', String(Math.round(state.pvCapacityWp)))
    params.set('battery', String(state.usableKwh))
    params.set('charge', String(state.maxChargeKw))
    params.set('discharge', String(state.maxDischargeKw))
    params.set('eff', String(Number(state.roundTripEff.toFixed(2))))
    params.set('feedin', String(state.feedInCapKw))
    FLOW_PERMISSION_OPTIONS.forEach(({ key }) => {
      params.set(FLOW_PERMISSION_QUERY_KEYS[key], state.flowPermissions[key] ? '1' : '0')
    })
    if (prices.selectedDate) params.set('date', prices.selectedDate)
    const nextQuery = params.toString()
    if (nextQuery === searchParamsString) return
    if (nextQuery === lastSyncedQueryRef.current) return
    const timeoutId = window.setTimeout(() => {
      lastSyncedQueryRef.current = nextQuery
      router.replace(`/battery/calculator?${nextQuery}`, { scroll: false })
    }, 180)
    return () => window.clearTimeout(timeoutId)
  }, [prices.selectedDate, router, searchParamsString, state])

  useEffect(() => {
    const urlDate = new URLSearchParams(searchParamsString).get('date')
    if (!urlDate || yearDates.length === 0) return
    if (!yearDates.some((day) => day.date === urlDate)) return
    prices.setSelectedDate(urlDate)
  }, [prices.setSelectedDate, searchParamsString, yearDates])

  const scenario = useMemo(
    () => buildScenario(deferredState),
    [deferredState],
  )

  const annualPrices = useMemo(() => {
    return prices.hourly
      .filter((point) => point.date.slice(0, 4) === String(effectiveYear))
      .filter((point) => !prices.lastRealDate || point.date <= prices.lastRealDate)
  }, [effectiveYear, prices.hourly, prices.lastRealDate])

  const annualResult = useMemo(() => {
    if (!loadProfile || !pvProfile || annualPrices.length === 0) return null
    return optimizePvBattery(buildPvBatteryInputs(annualPrices, loadProfile, pvProfile, scenario), scenario)
  }, [annualPrices, loadProfile, pvProfile, scenario])

  const daySource = useMemo(
    () => {
      if (state.resolution !== 'quarterhour') return prices.hourly
      if (!prices.selectedDate) return prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
      const hasQuarterHourForDay = prices.hourlyQH.some((point) => point.date === prices.selectedDate)
      return hasQuarterHourForDay ? prices.hourlyQH : prices.hourly
    },
    [prices.hourly, prices.hourlyQH, prices.selectedDate, state.resolution],
  )
  const effectiveDayResolution: PvBatteryResolution = daySource === prices.hourlyQH ? 'quarterhour' : 'hour'
  const dayPrices = useMemo(() => {
    if (!prices.selectedDate) return []
    return daySource.filter((point) => point.date === prices.selectedDate)
  }, [daySource, prices.selectedDate])

  const dayResult = useMemo(() => {
    if (!loadProfile || !pvProfile || dayPrices.length === 0) return null
    return optimizePvBattery(buildPvBatteryInputs(dayPrices, loadProfile, pvProfile, scenario), scenario)
  }, [dayPrices, loadProfile, pvProfile, scenario])

  const loading = prices.loading || profilesLoading
  const noYearData = !loading && !prices.error && availableYears.length === 0
  const pendingFlowPermissionKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => state.flowPermissions[key] !== DEFAULT_FLOW_PERMISSIONS[key])
    .map(({ key }) => key)
  const disabledFlowKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => !state.flowPermissions[key])
    .map(({ key }) => key)
  const hasQuarterHourReplay = prices.hourlyQH.length > 0
  const resolutionMessage = state.resolution === 'quarterhour' && effectiveDayResolution !== 'quarterhour'
    ? `Quarter-hour replay is unavailable for ${formatDayLabel(prices.selectedDate)}. Showing hourly routing instead.`
    : hasQuarterHourReplay
      ? 'Resolution only changes the selected-day replay. The annual estimate still uses the active annual market replay.'
      : 'Only hourly replay data is available for this market snapshot.'
  const activeFlowKeys = FLOW_PERMISSION_OPTIONS
    .filter(({ key }) => state.flowPermissions[key])
    .map(({ key }) => key)
  const activeFlowSummary = formatFlowPermissionList(activeFlowKeys)
  const requestedConstraintSummary = disabledFlowKeys.length > 0
    ? `Blocked routes: ${formatFlowPermissionList(disabledFlowKeys)}.`
    : 'All optional PV and battery routes are currently allowed.'
  const disabledFlowConsequences = getDisabledFlowConsequences(state.flowPermissions)
  const annualPvToBatteryKwh = annualResult ? sumAnnualSlotMetric(annualResult, 'chargeToBatteryKwh') : 0
  const hasCustomFlowPermissions = pendingFlowPermissionKeys.length > 0

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

        <main className="mx-auto max-w-[1440px] px-4 py-6 sm:px-6 lg:px-8">
          <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="max-w-[860px]">
              <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Home battery optimization</p>
              <h2 className="mt-2 text-[34px] font-semibold tracking-tight text-gray-900 sm:text-4xl">
                Interactive PV + battery calculator
              </h2>
              <p className="mt-3 text-[15px] leading-7 text-gray-500">
                Same visual language as{' '}
                <Link href="/v2" className="font-semibold text-gray-700 transition-colors hover:text-gray-900">
                  /v2
                </Link>
                , adapted for household load, PV generation, and battery routing. Configure the system on the left, inspect the day replay first,
                then sanity-check the annual rollup below.
              </p>
            </div>

            <div className="flex flex-wrap gap-3">
              <Button asChild className="w-fit rounded-full bg-[#313131] hover:bg-[#1f1f1f]">
                <Link href="/battery">
                  Open battery business case
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                className="w-fit rounded-full border-gray-200 bg-white text-gray-700 hover:bg-[#F8F8F5] hover:text-gray-900"
              >
                <Link href="/v2">See EV calculator</Link>
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)] lg:gap-5">
            <aside className="order-2 space-y-4 lg:order-1 lg:sticky lg:top-20 lg:self-start">
              <ControlBlock
                label="Market and year"
                value={availableYears.length > 0 ? `DE · ${effectiveYear}` : 'DE'}
                icon={<Gauge className="h-5 w-5 text-gray-400" />}
              >
                <div className="space-y-4">
                  <div className="grid gap-2">
                    <OptionCard
                      active
                      title="Germany"
                      detail="SMARD replay with tariff-adjusted import pricing, market-priced export, and permission-aware battery dispatch."
                      onClick={() => {}}
                    />
                  </div>

                  {availableYears.length > 0 ? (
                    <div className="flex flex-wrap gap-2">
                      {availableYears.map((year) => (
                        <PillButton key={year} active={effectiveYear === year} onClick={() => setDraftState((current) => ({ ...current, year }))}>
                          {year}
                        </PillButton>
                      ))}
                    </div>
                  ) : (
                    <div className="rounded-2xl border border-gray-200 bg-[#F8F8F5] px-4 py-3 text-[12px] leading-6 text-gray-600">
                      {loading ? 'Loading annual price history…' : 'No complete annual price history is available for the selected market yet.'}
                    </div>
                  )}

                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Import tariff
                      </label>
                      <HelpTooltip label="Import tariff help">
                        The selected tariff sets the import-cost curve used in the optimization. Export stays valued against the underlying market curve.
                      </HelpTooltip>
                    </div>
                    <select
                      value={state.tariffId}
                      onChange={(event) => setDraftState((current) => ({ ...current, tariffId: event.target.value }))}
                      className="w-full rounded-2xl border border-gray-200 bg-[#F8F8F5] px-4 py-3 text-sm font-medium text-gray-700 outline-none transition-colors focus:border-gray-400"
                    >
                      {tariffs.map((tariff) => (
                        <option key={tariff.id} value={tariff.id}>
                          {tariff.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </ControlBlock>

              <ControlBlock
                label="Household"
                value={`${Math.round(state.annualLoadKwh).toLocaleString()} kWh`}
                icon={<Home className="h-5 w-5 text-gray-400" />}
              >
                <div className="space-y-5">
                  <RangeControl
                    label="Annual household demand"
                    help="Annual electricity demand matched against the selected BDEW load profile."
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
                    <div className="flex items-center gap-2">
                      <label className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                        Load profile
                      </label>
                      <HelpTooltip label="Load profile help">
                        BDEW standard household demand shapes. Switching profile changes when the modeled load appears through the day and year.
                      </HelpTooltip>
                    </div>
                    <div className="grid gap-2">
                      {loadProfiles.map((profile) => (
                        <OptionCard
                          key={profile.id}
                          active={state.loadProfileId === profile.id}
                          title={profile.label}
                          detail={profile.detail}
                          onClick={() => setDraftState((current) => ({ ...current, loadProfileId: profile.id }))}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              </ControlBlock>

              <ControlBlock
                label="PV and battery"
                value={`${(state.pvCapacityWp / 1000).toFixed(1)} kWp · ${state.usableKwh.toFixed(1)} kWh`}
                icon={<Battery className="h-5 w-5 text-gray-400" />}
              >
                <div className="space-y-5">
                  <RangeControl
                    label="PV size"
                    help="Installed PV peak capacity. This sets the available solar energy that the solver can route to load, battery, export, or curtailment."
                    value={`${(state.pvCapacityWp / 1000).toFixed(1)} kWp`}
                    min={0}
                    max={20000}
                    step={500}
                    sliderValue={state.pvCapacityWp}
                    onChange={(value) => setDraftState((current) => ({ ...current, pvCapacityWp: value }))}
                    minLabel="0"
                    maxLabel="20 kWp"
                  />

                  <RangeControl
                    label="Usable battery"
                    help="Usable battery energy. The solver can route stored energy to household load or export later, depending on the active permissions and price signal."
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
                      help="Battery or inverter charging limit. This is usually fixed by the installation."
                      value={`${state.maxChargeKw.toFixed(1)} kW`}
                      min={1}
                      max={15}
                      step={0.5}
                      sliderValue={state.maxChargeKw}
                      onChange={(value) => setDraftState((current) => ({ ...current, maxChargeKw: value }))}
                    />

                    <RangeControl
                      label="Discharge power"
                      help="Battery or inverter discharge limit. Default is set to a typical 5 kW home-storage installation value."
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
                    help="Total battery cycle efficiency applied to all battery cycling, whether the stored energy is later used in the household or exported."
                    value={`${Math.round(state.roundTripEff * 100)}%`}
                    min={0.75}
                    max={0.96}
                    step={0.01}
                    sliderValue={state.roundTripEff}
                    onChange={(value) => setDraftState((current) => ({ ...current, roundTripEff: value }))}
                    minLabel="75%"
                    maxLabel="96%"
                  />
                </div>
              </ControlBlock>

              <ControlBlock
                label="Export logic"
                value={getAutomaticExportLabel(CALCULATOR_COUNTRY)}
                icon={<Zap className="h-5 w-5 text-gray-400" />}
              >
                <div className="space-y-5">
                  <div className="rounded-2xl border border-gray-200 bg-[#F8F8F5] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Export value</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{getAutomaticExportLabel(CALCULATOR_COUNTRY)}</p>
                      </div>
                      <HelpTooltip label="Export value help">
                        There is no manual feed-in tariff input here. Export follows the replayed market price curve, and the solver chooses direct use, charging, immediate export, delayed export, or curtailment by lowest modeled net cost subject to the active permissions.
                      </HelpTooltip>
                    </div>
                  </div>

                  <RangeControl
                    label="Grid export limit"
                    help="Limit on power exported to the grid at the connection point. This is separate from battery discharge because direct PV export can also hit the same cap."
                    value={`${state.feedInCapKw.toFixed(1)} kW`}
                    min={0.5}
                    max={20}
                    step={0.5}
                    sliderValue={state.feedInCapKw}
                    onChange={(value) => setDraftState((current) => ({ ...current, feedInCapKw: value }))}
                    minLabel="0.5 kW"
                    maxLabel="20 kW"
                  />

                  <div className="rounded-2xl border border-gray-200 bg-[#F8F8F5] px-4 py-3">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Charging logic</p>
                        <p className="mt-1 text-sm font-semibold text-gray-900">{getChargingLogicTitle(state.flowPermissions)}</p>
                      </div>
                      <HelpTooltip label="Charging logic help">
                        Grid charging follows the active flow permissions. The solver still minimizes net household energy cost, keeps household demand served, and will only use the routes that remain enabled.
                      </HelpTooltip>
                    </div>
                    <p className="mt-2 text-[12px] leading-6 text-gray-600">{getChargingLogicDetail(state.flowPermissions)}</p>
                  </div>
                </div>
              </ControlBlock>

            </aside>

            <section className="order-1 space-y-5 lg:order-2">
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
                  <PvBatteryDayChart
                    annualResult={dayResult}
                    dayLabel={formatDayLabel(prices.selectedDate)}
                    flowPermissions={state.flowPermissions}
                    units={units}
                    loading={prices.loading}
                    controls={(
                      <div className="space-y-5">
                        <div>
                          <SectionHeading
                            eyebrow="Selected day"
                            title="Flow map and price replay"
                            help="Choose a day from the active year to inspect quarter-hour PV, battery, household, and grid flows with a separate price panel for adjusted household price, spot export value, and action windows."
                          />
                          <p className="text-sm leading-6 text-gray-500">{resolutionMessage}</p>
                        </div>
                        <div className="overflow-hidden rounded-[20px] border border-gray-200 bg-white">
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
                          <div className="border-t border-gray-200 px-5 py-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                              <p className="text-[12px] leading-5 text-gray-500">
                                Choose the replay resolution, then edit dispatch rules in the routing card below.
                              </p>

                              <div className="flex flex-wrap gap-2">
                                <PillButton active={state.resolution === 'hour'} onClick={() => setDraftState((current) => ({ ...current, resolution: 'hour' }))}>
                                  60 min
                                </PillButton>
                                <PillButton
                                  active={state.resolution === 'quarterhour'}
                                  disabled={prices.hourlyQH.length === 0}
                                  onClick={() => prices.hourlyQH.length > 0 && setDraftState((current) => ({ ...current, resolution: 'quarterhour' }))}
                                >
                                  15 min
                                </PillButton>
                              </div>
                            </div>
                          </div>
                        </div>

                        <div className="rounded-[20px] border border-gray-200 bg-white p-5">
                          <div className="flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
                            <div className="space-y-2">
                              <div className="flex flex-wrap items-center gap-2">
                                <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Dispatch routes</p>
                                <span className="rounded-full bg-[#F5F5F2] px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-gray-700">
                                  {activeFlowKeys.length}/6 open
                                </span>
                                {hasCustomFlowPermissions ? (
                                  <span className="rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-amber-800">
                                    Custom
                                  </span>
                                ) : null}
                              </div>
                              <p className="text-[12px] leading-5 text-gray-500">Use the quick policies or the live diagram to open and close each allowed path.</p>
                              {disabledFlowKeys.length > 0 ? (
                                <p className="text-[12px] leading-5 text-amber-800">
                                  Blocked: {formatFlowPermissionList(disabledFlowKeys)}
                                </p>
                              ) : (
                                <p className="text-[12px] leading-5 text-gray-500">{requestedConstraintSummary}</p>
                              )}
                            </div>

                            <div className="flex flex-wrap items-center gap-4">
                              <SegmentedPillGroup
                                label="Solar"
                                options={[
                                  {
                                    label: 'PV',
                                    active: state.flowPermissions.pvToLoad && !state.flowPermissions.pvToBattery && state.flowPermissions.pvToGrid,
                                    onClick: () => setDraftState((current) => ({
                                      ...current,
                                      flowPermissions: {
                                        ...current.flowPermissions,
                                        pvToLoad: true,
                                        pvToBattery: false,
                                        pvToGrid: true,
                                      },
                                    })),
                                  },
                                  {
                                    label: 'PV+B',
                                    active: state.flowPermissions.pvToLoad && state.flowPermissions.pvToBattery && state.flowPermissions.pvToGrid,
                                    onClick: () => setDraftState((current) => ({
                                      ...current,
                                      flowPermissions: {
                                        ...current.flowPermissions,
                                        pvToLoad: true,
                                        pvToBattery: true,
                                        pvToGrid: true,
                                      },
                                    })),
                                  },
                                ]}
                              />

                              <SegmentedPillGroup
                                label="Battery"
                                options={[
                                  {
                                    label: 'Uni-Directional',
                                    active: state.flowPermissions.batteryToLoad && state.flowPermissions.gridToBattery && !state.flowPermissions.batteryToGrid,
                                    onClick: () => setDraftState((current) => ({
                                      ...current,
                                      flowPermissions: {
                                        ...current.flowPermissions,
                                        batteryToLoad: true,
                                        gridToBattery: true,
                                        batteryToGrid: false,
                                      },
                                    })),
                                  },
                                  {
                                    label: 'Bi-Directional',
                                    active: state.flowPermissions.batteryToLoad && state.flowPermissions.gridToBattery && state.flowPermissions.batteryToGrid,
                                    onClick: () => setDraftState((current) => ({
                                      ...current,
                                      flowPermissions: {
                                        ...current.flowPermissions,
                                        batteryToLoad: true,
                                        gridToBattery: true,
                                        batteryToGrid: true,
                                      },
                                    })),
                                  },
                                ]}
                              />
                            </div>
                          </div>

                          <div className="mt-4 border-t border-gray-200 pt-4">
                            <FlowRouteDiagram
                              permissions={state.flowPermissions}
                              onToggle={(key, checked) => setDraftState((current) => ({
                                ...current,
                                flowPermissions: {
                                  ...current.flowPermissions,
                                  [key]: checked,
                                },
                              }))}
                            />
                          </div>
                        </div>
                      </div>
                    )}
                  />

                  <div className="space-y-4">
                    <div className="flex items-center justify-between gap-4">
                      <div>
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Secondary view</p>
                        <h3 className="mt-1 text-lg font-semibold text-gray-900">Annual replay snapshot</h3>
                      </div>
                      <p className="max-w-[520px] text-right text-sm leading-6 text-gray-500">
                        Same dispatch rules, rolled up across the selected year. Use this to sanity-check the day-level decisions rather than lead the workflow.
                      </p>
                    </div>

                    <AnnualHero annual={annualResult} units={units} />

                    <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                      <Card className="rounded-[24px] border-gray-200 bg-white shadow-sm">
                        <CardContent className="p-6">
                          <SectionHeading
                            eyebrow="Energy routing"
                            title="Annual routing outcome"
                            help="How the cost-minimizing replay allocated energy across direct use, storage, imports, exports, and curtailment under the active flow permissions."
                            icon={<Battery className="h-5 w-5 text-gray-400" />}
                          />
                          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                            <MetricTile
                              label="PV -> home"
                              value={formatKwh(annualResult.directSelfConsumedKwh)}
                              hint="Direct household supply from on-site PV."
                            />
                            <MetricTile
                              label="PV -> battery"
                              value={formatKwh(annualPvToBatteryKwh)}
                              hint={state.flowPermissions.pvToBattery
                                ? 'Solar energy stored for later use or export.'
                                : 'Blocked. Surplus PV must export directly or curtail.'}
                            />
                            <MetricTile
                              label="Grid -> battery"
                              value={formatKwh(annualResult.gridToBatteryKwh)}
                              hint={state.flowPermissions.gridToBattery
                                ? 'Low-price grid charging used by the solver when economical.'
                                : 'Blocked. The battery can only charge from PV.'}
                            />
                            <MetricTile
                              label="Battery -> home"
                              value={formatKwh(annualResult.batteryToLoadKwh)}
                              hint={state.flowPermissions.batteryToLoad
                                ? 'Stored energy later used behind the meter.'
                                : 'Blocked. Stored energy cannot cover household demand.'}
                            />
                            <MetricTile
                              label="PV -> grid"
                              value={formatKwh(annualResult.directExportKwh)}
                              hint={state.flowPermissions.pvToGrid
                                ? 'Instantaneous export from PV after local routing.'
                                : 'Blocked. Any unmatched PV must charge or curtail.'}
                            />
                            <MetricTile
                              label="Battery -> grid"
                              value={formatKwh(annualResult.batteryExportKwh)}
                              hint={state.flowPermissions.batteryToGrid
                                ? 'Stored energy later released to the grid.'
                                : 'Blocked. The battery can only serve load or remain idle.'}
                            />
                            <MetricTile
                              label="Curtailed PV"
                              value={formatKwh(annualResult.curtailedKwh)}
                              hint="Surplus PV with no permitted destination or no export headroom."
                            />
                          </div>
                        </CardContent>
                      </Card>

                      <Card className="rounded-[24px] border-gray-200 bg-[#FBFBF8] shadow-sm">
                        <CardContent className="p-6">
                          <SectionHeading
                            eyebrow="Model basis"
                            title="Replay inputs and active rules"
                            help="The annual estimate replays the selected year hourly. The selected-day view can switch resolution when data exists, but both views obey the same flow permissions."
                            icon={<Gauge className="h-5 w-5 text-gray-400" />}
                          />
                          <div className="space-y-4 text-sm text-gray-600">
                            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                              <span>PV generation modeled</span>
                              <span className="font-semibold text-gray-900">{formatKwh(annualResult.pvGenerationKwh)}/yr</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                              <span>Household load modeled</span>
                              <span className="font-semibold text-gray-900">{formatKwh(annualResult.loadKwh)}/yr</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                              <span>Automatic export value</span>
                              <span className="font-semibold text-gray-900">{getAutomaticExportLabel(CALCULATOR_COUNTRY)}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                              <span>Allowed routes</span>
                              <span className="max-w-[52%] text-right font-semibold text-gray-900">{activeFlowSummary}</span>
                            </div>
                            <div className="flex items-center justify-between gap-4">
                              <span>Blocked routes</span>
                              <span className="max-w-[52%] text-right font-semibold text-gray-900">
                                {disabledFlowKeys.length > 0 ? formatFlowPermissionList(disabledFlowKeys) : 'None'}
                              </span>
                            </div>
                          </div>

                          {disabledFlowConsequences.length > 0 ? (
                            <div className="mt-5 space-y-2 rounded-2xl bg-amber-50 px-4 py-4 text-[12px] leading-6 text-amber-900">
                              <p className="font-semibold">Disabled-route consequences</p>
                              {disabledFlowConsequences.slice(0, 3).map((message) => (
                                <p key={message}>{message}</p>
                              ))}
                            </div>
                          ) : (
                            <div className="mt-5 rounded-2xl bg-white px-4 py-4 text-[12px] leading-6 text-gray-600">
                              All modeled PV and battery routes are open. The solver selects the lowest-cost feasible path in each replay slot.
                            </div>
                          )}
                        </CardContent>
                      </Card>
                    </div>
                  </div>

                  <MonthlyBars annual={annualResult} units={units} />
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
