'use client'

import { useState, useMemo, useEffect, useDeferredValue, Suspense } from 'react'
import Link from 'next/link'
import { usePrices } from '@/lib/use-prices'
import { DEFAULT_SCENARIO, DEFAULT_FLEET_CONFIG } from '@/lib/v2-config'
import {
  sweepMileageByWindowLength,
  sweepSensitivity,
  sweepFleetMileageByWindowLength,
  sweepFleetSensitivity,
  type PinnedDefaults,
  type DateRange,
  type FleetSweepParams,
} from '@/lib/insights-sweep'
import { IdealParametersHeatmap } from '@/components/v2/insights/IdealParametersHeatmap'
import { SensitivityCurves } from '@/components/v2/insights/SensitivityCurves'
import { PricePatternsHeatmap } from '@/components/v2/insights/PricePatternsHeatmap'
import { InsightsControls } from '@/components/v2/insights/InsightsControls'
import { TimeFrameBar, type TimeFrame } from '@/components/v2/insights/TimeFrameBar'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import { KpiTile } from '@/components/management/KpiTile'
import { YoyBarChart } from '@/components/management/YoyBarChart'
import { ExplainerPanel } from '@/components/management/ExplainerPanel'
import { SettingsDrawer, loadScenarioFromStorage } from '@/components/management/SettingsDrawer'
import {
  DEFAULT_MANAGEMENT_SCENARIO,
  MANAGEMENT_DATA_URL,
  type ExplainerData,
  type ManagementDataset,
  type ManagementScenario,
  type MonthlyAggregate,
} from '@/lib/management-config'
import { computeYoy } from '@/lib/management-helpers'

// ---------- Management helpers (copied verbatim from /management page) ----------

type PeriodKey = 'YTD' | 'LAST_12' | 'ALL'

const BRAND_RED = '#EA1C0A'

const EUR_FMT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})
const CT_FMT = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
})
const INT_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

function filterByPeriod(
  monthly: MonthlyAggregate[],
  period: PeriodKey,
): MonthlyAggregate[] {
  if (!monthly || monthly.length === 0) return []
  if (period === 'ALL') return [...monthly]
  if (period === 'YTD') {
    const latest = monthly[monthly.length - 1]
    const year = latest?.year
    if (!Number.isFinite(year)) return []
    return monthly.filter((m) => m.year === year)
  }
  // LAST_12: take the last 12 entries (already sorted by monthKey asc).
  return monthly.slice(Math.max(0, monthly.length - 12))
}

function priorWindow(
  monthly: MonthlyAggregate[],
  current: MonthlyAggregate[],
  period: PeriodKey,
): MonthlyAggregate[] | null {
  if (!monthly || monthly.length === 0 || current.length === 0) return null
  if (period === 'ALL') return null

  if (period === 'YTD') {
    const year = current[0].year
    const prior = monthly.filter((m) => m.year === year - 1)
    return prior.length > 0 ? prior : null
  }

  const idxFirst = monthly.findIndex((m) => m.monthKey === current[0].monthKey)
  if (idxFirst <= 0) return null
  const start = Math.max(0, idxFirst - current.length)
  const end = idxFirst
  const prior = monthly.slice(start, end)
  return prior.length > 0 ? prior : null
}

function reaggregate(
  entry: MonthlyAggregate,
  scenario: ManagementScenario,
  defaultScenario: ManagementScenario,
): MonthlyAggregate {
  if (
    scenario.batteryCapacityKwh === defaultScenario.batteryCapacityKwh &&
    scenario.chargePowerKw === defaultScenario.chargePowerKw &&
    scenario.plugInTime === defaultScenario.plugInTime &&
    scenario.departureTime === defaultScenario.departureTime &&
    scenario.sessionsPerWeek === defaultScenario.sessionsPerWeek
  ) {
    return entry
  }
  const daysInMonth = new Date(
    Date.UTC(entry.year, entry.month, 0),
  ).getUTCDate()
  const sessionsInMonth =
    Math.round(scenario.sessionsPerWeek * (daysInMonth / 7) * 10) / 10

  const [phStr, pmStr] = scenario.plugInTime.split(':')
  const [dhStr, dmStr] = scenario.departureTime.split(':')
  const ph = Number(phStr)
  const pm = Number(pmStr)
  const dh = Number(dhStr)
  const dm = Number(dmStr)
  const plugInQh = ph * 4 + Math.floor(pm / 15)
  const depQh = dh * 4 + Math.floor(dm / 15)
  const endQh = (depQh - 1 + 96) % 96
  const slots = endQh >= plugInQh ? endQh - plugInQh + 1 : 96 - plugInQh + endQh + 1
  const windowHours = slots * 0.25
  const rawEnergy = scenario.chargePowerKw * windowHours
  const energyPerSessionKwh =
    Math.round(Math.min(scenario.batteryCapacityKwh, rawEnergy) * 100) / 100

  const savingsEur =
    Math.round(
      (entry.avgSpreadCtKwh / 100) *
        energyPerSessionKwh *
        sessionsInMonth *
        100,
    ) / 100

  return {
    ...entry,
    energyPerSessionKwh,
    sessionsInMonth,
    savingsEur,
  }
}

function weightedAvgSpread(months: MonthlyAggregate[]): number {
  if (months.length === 0) return 0
  let num = 0
  let den = 0
  for (const m of months) {
    num += m.avgSpreadCtKwh * m.sessionsInMonth
    den += m.sessionsInMonth
  }
  return den > 0 ? num / den : 0
}

function sum(xs: number[]): number {
  let s = 0
  for (const x of xs) s += x
  return s
}

function pct(current: number, prior: number): number | null {
  if (!Number.isFinite(prior) || prior === 0) return null
  return ((current - prior) / prior) * 100
}

function padLeft(xs: number[], len: number): number[] {
  if (xs.length >= len) return xs.slice(xs.length - len)
  const pad = new Array<number>(len - xs.length).fill(0)
  return [...pad, ...xs]
}

function isDefaultScenario(
  scenario: ManagementScenario,
  defaultScenario: ManagementScenario,
): boolean {
  return (
    scenario.batteryCapacityKwh === defaultScenario.batteryCapacityKwh &&
    scenario.chargePowerKw === defaultScenario.chargePowerKw &&
    scenario.plugInTime === defaultScenario.plugInTime &&
    scenario.departureTime === defaultScenario.departureTime &&
    scenario.sessionsPerWeek === defaultScenario.sessionsPerWeek
  )
}

// -------- Page skeleton shown during Suspense / initial load --------

function PageSkeleton() {
  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      <div className="max-w-[1440px] mx-auto px-8 py-8">
        <div className="h-8 w-72 bg-gray-200 rounded animate-pulse mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
          {[0, 1, 2, 3].map((i) => (
            <div
              key={i}
              className="h-[120px] bg-gray-200 rounded-xl animate-pulse"
            />
          ))}
        </div>
        <div className="h-[260px] bg-gray-200 rounded-xl animate-pulse mb-6" />
        <div className="h-[360px] bg-gray-200 rounded-xl animate-pulse" />
      </div>
    </div>
  )
}

// -------- Period toggle segmented control --------

interface PeriodToggleProps {
  value: PeriodKey
  onChange: (next: PeriodKey) => void
}

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'YTD', label: 'YTD' },
  { key: 'LAST_12', label: 'Last 12 months' },
  { key: 'ALL', label: 'All' },
]

function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Time period"
      className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5"
    >
      {PERIOD_OPTIONS.map((opt) => {
        const active = opt.key === value
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className={
              'text-[12px] font-semibold px-3 py-1.5 rounded-md tabular-nums transition-colors ' +
              (active ? 'text-white' : 'text-gray-600 hover:bg-gray-50')
            }
            style={
              active
                ? { backgroundColor: BRAND_RED, borderColor: BRAND_RED }
                : undefined
            }
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

// ---------- Page shell ----------

export default function InsightsPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <InsightsInner />
    </Suspense>
  )
}

type Mode = 'single' | 'fleet'

function defaultPinned(): PinnedDefaults {
  const plugInsPerWeek = Math.max(1, DEFAULT_SCENARIO.weekdayPlugIns + DEFAULT_SCENARIO.weekendPlugIns)
  const windowLength =
    DEFAULT_SCENARIO.departureTime > DEFAULT_SCENARIO.plugInTime
      ? DEFAULT_SCENARIO.departureTime - DEFAULT_SCENARIO.plugInTime
      : 24 - DEFAULT_SCENARIO.plugInTime + DEFAULT_SCENARIO.departureTime
  return {
    yearlyMileageKm: DEFAULT_SCENARIO.yearlyMileageKm,
    plugInTime: DEFAULT_SCENARIO.plugInTime,
    windowLengthHours: windowLength,
    chargePowerKw: DEFAULT_SCENARIO.chargePowerKw,
    plugInsPerWeek,
  }
}

function defaultFleet(): FleetSweepParams {
  return {
    fleetSize: DEFAULT_FLEET_CONFIG.fleetSize,
    arrivalMin: DEFAULT_FLEET_CONFIG.arrivalMin,
    arrivalMax: DEFAULT_FLEET_CONFIG.arrivalMax,
    arrivalAvg: DEFAULT_FLEET_CONFIG.arrivalAvg,
    departureMin: DEFAULT_FLEET_CONFIG.departureMin,
    departureMax: DEFAULT_FLEET_CONFIG.departureMax,
    departureAvg: DEFAULT_FLEET_CONFIG.departureAvg,
    spreadMode: DEFAULT_FLEET_CONFIG.spreadMode,
    mileageMin: 8000,
    mileageMax: 20000,
    chargePowerKw: DEFAULT_FLEET_CONFIG.chargePowerKw,
    plugInsPerWeek: DEFAULT_FLEET_CONFIG.plugInsPerWeek,
  }
}

/** Convert a TimeFrame selection into a concrete inclusive date range given available data. */
function resolveDateRange(tf: TimeFrame, dataMin: string, dataMax: string): DateRange {
  if (tf.kind === 'last365') {
    const end = dataMax
    const endDate = new Date(end + 'T12:00:00Z')
    endDate.setUTCDate(endDate.getUTCDate() - 364)
    const start = endDate.toISOString().slice(0, 10)
    return { start: start < dataMin ? dataMin : start, end, label: 'last 365 days' }
  }
  if (tf.kind === 'year') {
    const start = `${tf.year}-01-01`
    const end = `${tf.year}-12-31`
    return {
      start: start < dataMin ? dataMin : start,
      end: end > dataMax ? dataMax : end,
      label: `${tf.year}`,
    }
  }
  return {
    start: tf.start < dataMin ? dataMin : tf.start,
    end: tf.end > dataMax ? dataMax : tf.end,
    label: `${tf.start} → ${tf.end}`,
  }
}

function InsightsInner() {
  const prices = usePrices('DE')
  const [mode, setMode] = useState<Mode>('single')
  const [pinned, setPinned] = useState<PinnedDefaults>(defaultPinned)
  const [fleet, setFleet] = useState<FleetSweepParams>(defaultFleet)
  const [timeFrame, setTimeFrame] = useState<TimeFrame>({ kind: 'last365' })

  // Management section state
  const [dataset, setDataset] = useState<ManagementDataset | null>(null)
  const [mgmtLoading, setMgmtLoading] = useState<boolean>(true)
  const [mgmtError, setMgmtError] = useState<string | null>(null)
  const [scenario, setScenario] = useState<ManagementScenario>(DEFAULT_MANAGEMENT_SCENARIO)
  const [period, setPeriod] = useState<PeriodKey>('LAST_12')
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false)

  // Hydrate scenario from localStorage after mount (SSR-safe).
  useEffect(() => {
    const stored = loadScenarioFromStorage()
    setScenario(stored)
  }, [])

  // Load precomputed dataset.
  useEffect(() => {
    let cancelled = false
    async function run() {
      try {
        const res = await fetch(MANAGEMENT_DATA_URL, { cache: 'no-store' })
        if (!res.ok) {
          if (!cancelled) {
            setMgmtError('No management data available yet')
            setDataset(null)
          }
          return
        }
        const json = (await res.json()) as ManagementDataset
        if (!cancelled) {
          setDataset(json)
          setMgmtError(null)
        }
      } catch {
        if (!cancelled) {
          setMgmtError('No management data available yet')
          setDataset(null)
        }
      } finally {
        if (!cancelled) setMgmtLoading(false)
      }
    }
    run()
    return () => {
      cancelled = true
    }
  }, [])

  // Defer heavy sweep inputs so slider drags stay snappy.
  const deferredPinned = useDeferredValue(pinned)
  const deferredFleet = useDeferredValue(fleet)
  const deferredTimeFrame = useDeferredValue(timeFrame)

  const dataMin = prices.hourly[0]?.date ?? ''
  const dataMax = prices.hourly[prices.hourly.length - 1]?.date ?? ''

  const availableYears = useMemo(() => {
    if (!dataMin || !dataMax) return []
    const y0 = Number(dataMin.slice(0, 4))
    const y1 = Number(dataMax.slice(0, 4))
    const out: number[] = []
    for (let y = y0; y <= y1; y++) out.push(y)
    return out
  }, [dataMin, dataMax])

  const dateRange: DateRange | undefined = useMemo(() => {
    if (!dataMin || !dataMax) return undefined
    return resolveDateRange(deferredTimeFrame, dataMin, dataMax)
  }, [deferredTimeFrame, dataMin, dataMax])

  const grid = useMemo(() => {
    if (prices.hourly.length === 0) return null
    if (mode === 'fleet') {
      return sweepFleetMileageByWindowLength(prices.hourly, deferredFleet, dateRange)
    }
    return sweepMileageByWindowLength(
      prices.hourly,
      deferredPinned.plugInTime,
      deferredPinned.chargePowerKw,
      deferredPinned.plugInsPerWeek,
      dateRange,
    )
  }, [mode, prices.hourly, deferredPinned, deferredFleet, dateRange])

  const series = useMemo(() => {
    if (prices.hourly.length === 0) return null
    if (mode === 'fleet') {
      return sweepFleetSensitivity(prices.hourly, deferredFleet, dateRange)
    }
    return sweepSensitivity(prices.hourly, deferredPinned, dateRange)
  }, [mode, prices.hourly, deferredPinned, deferredFleet, dateRange])

  // Management memos
  const adjustedMonthly: MonthlyAggregate[] = useMemo(() => {
    if (!dataset) return []
    return dataset.monthly.map((m) =>
      reaggregate(m, scenario, DEFAULT_MANAGEMENT_SCENARIO),
    )
  }, [dataset, scenario])

  const filteredMonthly = useMemo(
    () => filterByPeriod(adjustedMonthly, period),
    [adjustedMonthly, period],
  )

  const priorMonthly = useMemo(
    () => priorWindow(adjustedMonthly, filteredMonthly, period),
    [adjustedMonthly, filteredMonthly, period],
  )

  const latestYear = useMemo(() => {
    if (adjustedMonthly.length === 0) return new Date().getUTCFullYear()
    return adjustedMonthly[adjustedMonthly.length - 1].year
  }, [adjustedMonthly])

  const yoy = useMemo(
    () => computeYoy(adjustedMonthly, latestYear - 1, latestYear),
    [adjustedMonthly, latestYear],
  )

  const kpis = useMemo(() => {
    const totalSavings = sum(filteredMonthly.map((m) => m.savingsEur))
    const avgSpread = weightedAvgSpread(filteredMonthly)
    const sessions = Math.round(sum(filteredMonthly.map((m) => m.sessionsInMonth)))
    const avgDayAhead =
      filteredMonthly.length > 0
        ? sum(filteredMonthly.map((m) => m.avgDayAheadCtKwh)) /
          filteredMonthly.length
        : 0

    const prior = priorMonthly ?? []
    const priorTotal = sum(prior.map((m) => m.savingsEur))
    const priorSpread = weightedAvgSpread(prior)
    const priorSessions = Math.round(sum(prior.map((m) => m.sessionsInMonth)))
    const priorDayAhead =
      prior.length > 0
        ? sum(prior.map((m) => m.avgDayAheadCtKwh)) / prior.length
        : 0

    const sparkline = padLeft(filteredMonthly.map((m) => m.savingsEur), 12)

    return {
      totalSavings,
      avgSpread,
      sessions,
      avgDayAhead,
      deltaTotal: priorMonthly ? pct(totalSavings, priorTotal) : null,
      deltaSpread: priorMonthly ? pct(avgSpread, priorSpread) : null,
      deltaSessions: priorMonthly ? pct(sessions, priorSessions) : null,
      deltaDayAhead: priorMonthly ? pct(avgDayAhead, priorDayAhead) : null,
      sparkline,
    }
  }, [filteredMonthly, priorMonthly])

  const explainerData: ExplainerData | null = useMemo(() => {
    if (!dataset) return null
    return dataset.explainer ?? null
  }, [dataset])

  const latestMonthlySavings = useMemo(() => {
    if (filteredMonthly.length === 0) return 0
    return filteredMonthly[filteredMonthly.length - 1].savingsEur
  }, [filteredMonthly])

  const scenarioIsCustom = !isDefaultScenario(scenario, DEFAULT_MANAGEMENT_SCENARIO)
  const mgmtIsEmpty =
    mgmtError !== null ||
    dataset === null ||
    !Array.isArray(dataset?.monthly) ||
    (dataset?.monthly?.length ?? 0) === 0

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header — matches /v2 */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-4">
            <h1 className="text-sm font-semibold text-gray-400">EV Flex Charging — Insights</h1>
          </div>
          <div className="flex items-center gap-2">
            <PeriodToggle value={period} onChange={setPeriod} />
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open scenario settings"
            >
              <svg
                className="w-3.5 h-3.5 mr-1.5"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                />
              </svg>
              Settings
            </Button>
            <Link
              href="/v2"
              className="flex items-center gap-1.5 text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
              </svg>
              Dashboard
            </Link>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6 space-y-8">
        {/* PERFORMANCE SECTION */}
        <section aria-label="Performance" className="space-y-4">
          <div className="flex items-baseline justify-between">
            <h2 className="text-xl font-bold text-[#313131]">Performance</h2>
            <span className="text-[11px] text-gray-500">Precomputed monthly aggregates</span>
          </div>

          {mgmtLoading ? (
            <div className="text-[12px] text-gray-500 py-8 text-center">Loading aggregated performance…</div>
          ) : mgmtIsEmpty ? (
            <Card className="p-4 text-[12px] text-gray-600">
              No aggregated performance data yet — run <span className="font-mono">scripts/precompute-management-monthly.mjs</span> to generate it.
            </Card>
          ) : (
            <>
              {scenarioIsCustom ? (
                <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                  Custom scenario active — numbers reflect your overrides, not the dashboard defaults.
                </div>
              ) : null}

              {/* KPI row */}
              <section
                aria-label="Key performance indicators"
                className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
              >
                <KpiTile
                  label="Total savings"
                  value={EUR_FMT.format(kpis.totalSavings)}
                  deltaPct={kpis.deltaTotal}
                  deltaLabel="vs prior period"
                  sparklineData={kpis.sparkline}
                  accentColor={BRAND_RED}
                />
                <KpiTile
                  label="Avg spread"
                  value={`${CT_FMT.format(kpis.avgSpread)} ct/kWh`}
                  deltaPct={kpis.deltaSpread}
                  deltaLabel="vs prior"
                  sparklineData={padLeft(
                    filteredMonthly.map((m) => m.avgSpreadCtKwh),
                    12,
                  )}
                  accentColor={BRAND_RED}
                />
                <KpiTile
                  label="Sessions counted"
                  value={INT_FMT.format(kpis.sessions)}
                  deltaPct={kpis.deltaSessions}
                  deltaLabel="vs prior"
                  sparklineData={padLeft(
                    filteredMonthly.map((m) => m.sessionsInMonth),
                    12,
                  )}
                  accentColor={BRAND_RED}
                />
                <KpiTile
                  label="Avg day-ahead"
                  value={`${CT_FMT.format(kpis.avgDayAhead)} ct/kWh`}
                  deltaPct={kpis.deltaDayAhead}
                  deltaLabel="vs prior"
                  sparklineData={padLeft(
                    filteredMonthly.map((m) => m.avgDayAheadCtKwh),
                    12,
                  )}
                  accentColor={BRAND_RED}
                />
              </section>

              {/* YoY card */}
              <Card className="p-5">
                <div className="flex items-baseline justify-between mb-3">
                  <h2 className="text-sm font-semibold text-foreground">Year over year</h2>
                  <span className="text-[11px] text-muted-foreground tabular-nums">
                    {latestYear - 1} vs {latestYear}
                  </span>
                </div>
                <YoyBarChart
                  data={yoy}
                  yearALabel={String(latestYear - 1)}
                  yearBLabel={String(latestYear)}
                />
              </Card>

              {/* Explainer */}
              {explainerData ? (
                <ExplainerPanel
                  data={explainerData}
                  scenario={scenario}
                  monthlySavingsEur={latestMonthlySavings}
                />
              ) : null}
            </>
          )}
        </section>

        {/* EXPLORER SECTION */}
        <section aria-label="Explorer" className="space-y-5">
          <div className="flex items-start justify-between gap-6">
            <div>
              <h2 className="text-xl font-bold text-[#313131]">Explorer</h2>
              <p className="text-[12px] text-gray-500 mt-1">
                Find the customers worth targeting and the behaviors worth incentivizing. Adjust the
                controls and watch both views update in real time.
              </p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="inline-flex rounded-lg border border-gray-200 bg-white p-0.5">
                {(['single', 'fleet'] as const).map(m => (
                  <button
                    key={m}
                    onClick={() => setMode(m)}
                    className={`px-3 py-1.5 text-[11px] font-semibold rounded-md transition-colors ${
                      mode === m ? 'bg-[#313131] text-white' : 'text-gray-500 hover:text-gray-700'
                    }`}>
                    {m === 'single' ? 'Single vehicle' : 'Fleet'}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {prices.loading && (
            <div className="text-[12px] text-gray-500 py-12 text-center">Loading price data…</div>
          )}

          {prices.error && (
            <div className="text-[12px] text-red-600 py-12 text-center">
              Failed to load prices: {prices.error}
            </div>
          )}

          {!prices.loading && !prices.error && (
            <>
              {/* Time frame bar */}
              <TimeFrameBar
                timeFrame={timeFrame}
                setTimeFrame={setTimeFrame}
                availableYears={availableYears}
                dataMin={dataMin}
                dataMax={dataMax}
              />

              {/* Profile controls (single or fleet) */}
              <InsightsControls
                mode={mode}
                pinned={pinned}
                setPinned={setPinned}
                fleet={fleet}
                setFleet={setFleet}
                onReset={() => {
                  setPinned(defaultPinned())
                  setFleet(defaultFleet())
                }}
              />

              {/* Both views, stacked full-width like the main page rhythm.
                  Excel exports use single-vehicle formulas driven by `deferredPinned`
                  even in fleet mode. This is a conscious simplification for the v1
                  of the auditable export; the parameters sheet includes a note row. */}
              {grid && (
                <IdealParametersHeatmap
                  grid={grid}
                  mode={mode}
                  fleetSize={fleet.fleetSize}
                  hourlyQH={prices.hourlyQH}
                  pinned={deferredPinned}
                />
              )}
              {series && (
                <SensitivityCurves
                  series={series}
                  mode={mode}
                  fleetSize={fleet.fleetSize}
                  hourlyQH={prices.hourlyQH}
                  pinned={deferredPinned}
                />
              )}
              {prices.hourlyQH.length > 0 && <PricePatternsHeatmap hourlyQH={prices.hourlyQH} />}
            </>
          )}
        </section>

        {/* SettingsDrawer — mounted at the page root so it works in empty-state too */}
        <SettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          scenario={scenario}
          onChange={setScenario}
        />
      </main>
    </div>
  )
}
