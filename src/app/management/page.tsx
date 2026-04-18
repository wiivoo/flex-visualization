'use client';

/**
 * Management Dashboard — /management page (PROJ-40).
 *
 * Fixed-scenario executive view: headline load-shifting value, YoY comparison,
 * and the reconciliation explainer. Loads precomputed monthly aggregates from
 * `public/data/management-monthly.json` — no raw QH math at runtime.
 *
 * Requirements: MGMT-01 (route + password-gated + time-period toggles),
 *               MGMT-08 (graceful empty-state on missing data),
 *               MGMT-09 (desktop-first layout).
 *
 * Auth: enforced by `src/middleware.ts` — unauthenticated viewers are
 * redirected to `/login?redirect=/management` before this component renders.
 */

import { Suspense, useEffect, useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { KpiTile } from '@/components/management/KpiTile';
import { YoyBarChart } from '@/components/management/YoyBarChart';
import { ExplainerPanel } from '@/components/management/ExplainerPanel';
import {
  SettingsDrawer,
  loadScenarioFromStorage,
} from '@/components/management/SettingsDrawer';
import {
  DEFAULT_MANAGEMENT_SCENARIO,
  MANAGEMENT_DATA_URL,
  type ExplainerData,
  type ManagementDataset,
  type ManagementScenario,
  type MonthlyAggregate,
} from '@/lib/management-config';
import { computeYoy } from '@/lib/management-helpers';

type PeriodKey = 'YTD' | 'LAST_12' | 'ALL';

const BRAND_RED = '#EA1C0A';

const EUR_FMT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});
const CT_FMT = new Intl.NumberFormat('de-DE', {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1,
});
const INT_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 });

// -------- Pure helpers (no JSX) --------

function filterByPeriod(
  monthly: MonthlyAggregate[],
  period: PeriodKey,
): MonthlyAggregate[] {
  if (!monthly || monthly.length === 0) return [];
  if (period === 'ALL') return [...monthly];
  if (period === 'YTD') {
    const latest = monthly[monthly.length - 1];
    const year = latest?.year;
    if (!Number.isFinite(year)) return [];
    return monthly.filter((m) => m.year === year);
  }
  // LAST_12: take the last 12 entries (already sorted by monthKey asc).
  return monthly.slice(Math.max(0, monthly.length - 12));
}

/**
 * Previous-window selector used to compute per-KPI Δ%. Returns the same-length
 * window of months immediately preceding `current` within `monthly`, or `null`
 * if not enough data exists.
 */
function priorWindow(
  monthly: MonthlyAggregate[],
  current: MonthlyAggregate[],
  period: PeriodKey,
): MonthlyAggregate[] | null {
  if (!monthly || monthly.length === 0 || current.length === 0) return null;
  if (period === 'ALL') return null; // No "prior" for the full dataset.

  if (period === 'YTD') {
    const year = current[0].year;
    const prior = monthly.filter((m) => m.year === year - 1);
    return prior.length > 0 ? prior : null;
  }

  // LAST_12: the 12 months before the current 12.
  const idxFirst = monthly.findIndex(
    (m) => m.monthKey === current[0].monthKey,
  );
  if (idxFirst <= 0) return null;
  const start = Math.max(0, idxFirst - current.length);
  const end = idxFirst;
  const prior = monthly.slice(start, end);
  return prior.length > 0 ? prior : null;
}

/**
 * Recompute a MonthlyAggregate under a user-adjusted scenario. Uses the
 * precomputed avgSpreadCtKwh (real market data, scenario-invariant at plug-in
 * window level) but re-derives energy-per-session and sessions-in-month from
 * the override. Matches the intent called out in the plan's Task 2 notes.
 */
function reaggregate(
  entry: MonthlyAggregate,
  scenario: ManagementScenario,
  defaultScenario: ManagementScenario,
): MonthlyAggregate {
  // If scenario is default, do not mutate precomputed values.
  if (
    scenario.batteryCapacityKwh === defaultScenario.batteryCapacityKwh &&
    scenario.chargePowerKw === defaultScenario.chargePowerKw &&
    scenario.plugInTime === defaultScenario.plugInTime &&
    scenario.departureTime === defaultScenario.departureTime &&
    scenario.sessionsPerWeek === defaultScenario.sessionsPerWeek
  ) {
    return entry;
  }
  const daysInMonth = new Date(
    Date.UTC(entry.year, entry.month, 0),
  ).getUTCDate();
  const sessionsInMonth =
    Math.round(scenario.sessionsPerWeek * (daysInMonth / 7) * 10) / 10;

  // Energy per session: power × window hours, capped by battery.
  const [phStr, pmStr] = scenario.plugInTime.split(':');
  const [dhStr, dmStr] = scenario.departureTime.split(':');
  const ph = Number(phStr);
  const pm = Number(pmStr);
  const dh = Number(dhStr);
  const dm = Number(dmStr);
  const plugInQh = ph * 4 + Math.floor(pm / 15);
  const depQh = dh * 4 + Math.floor(dm / 15);
  const endQh = (depQh - 1 + 96) % 96;
  const slots = endQh >= plugInQh ? endQh - plugInQh + 1 : 96 - plugInQh + endQh + 1;
  const windowHours = slots * 0.25;
  const rawEnergy = scenario.chargePowerKw * windowHours;
  const energyPerSessionKwh =
    Math.round(Math.min(scenario.batteryCapacityKwh, rawEnergy) * 100) / 100;

  const savingsEur =
    Math.round(
      (entry.avgSpreadCtKwh / 100) *
        energyPerSessionKwh *
        sessionsInMonth *
        100,
    ) / 100;

  return {
    ...entry,
    energyPerSessionKwh,
    sessionsInMonth,
    savingsEur,
  };
}

function weightedAvgSpread(months: MonthlyAggregate[]): number {
  if (months.length === 0) return 0;
  let num = 0;
  let den = 0;
  for (const m of months) {
    num += m.avgSpreadCtKwh * m.sessionsInMonth;
    den += m.sessionsInMonth;
  }
  return den > 0 ? num / den : 0;
}

function sum(xs: number[]): number {
  let s = 0;
  for (const x of xs) s += x;
  return s;
}

function pct(current: number, prior: number): number | null {
  if (!Number.isFinite(prior) || prior === 0) return null;
  return ((current - prior) / prior) * 100;
}

function padLeft(xs: number[], len: number): number[] {
  if (xs.length >= len) return xs.slice(xs.length - len);
  const pad = new Array<number>(len - xs.length).fill(0);
  return [...pad, ...xs];
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
  );
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
  );
}

// -------- Empty-state card --------

function EmptyState({ message }: { message: string }) {
  return (
    <Card className="flex flex-col items-center justify-center gap-2 p-10 text-center max-w-xl mx-auto">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
        Flex Value Dashboard
      </span>
      <p className="text-sm text-muted-foreground">{message}</p>
      <p className="text-[11px] text-muted-foreground">
        Run{' '}
        <span className="font-mono">scripts/precompute-management-monthly.mjs</span>{' '}
        to generate it, or wait for the next scheduled workflow.
      </p>
    </Card>
  );
}

// -------- Period toggle segmented control --------

interface PeriodToggleProps {
  value: PeriodKey;
  onChange: (next: PeriodKey) => void;
}

const PERIOD_OPTIONS: { key: PeriodKey; label: string }[] = [
  { key: 'YTD', label: 'YTD' },
  { key: 'LAST_12', label: 'Last 12 months' },
  { key: 'ALL', label: 'All' },
];

function PeriodToggle({ value, onChange }: PeriodToggleProps) {
  return (
    <div
      role="tablist"
      aria-label="Time period"
      className="inline-flex items-center rounded-lg border border-gray-200 bg-white p-0.5"
    >
      {PERIOD_OPTIONS.map((opt) => {
        const active = opt.key === value;
        return (
          <button
            key={opt.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(opt.key)}
            className={
              'text-[12px] font-semibold px-3 py-1.5 rounded-md tabular-nums transition-colors ' +
              (active
                ? 'text-white'
                : 'text-gray-600 hover:bg-gray-50')
            }
            style={
              active
                ? { backgroundColor: BRAND_RED, borderColor: BRAND_RED }
                : undefined
            }
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

// -------- Page shell --------

export default function ManagementPage() {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <ManagementBody />
    </Suspense>
  );
}

// -------- Body: data load + layout --------

function ManagementBody() {
  const [dataset, setDataset] = useState<ManagementDataset | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [scenario, setScenario] = useState<ManagementScenario>(
    DEFAULT_MANAGEMENT_SCENARIO,
  );
  const [period, setPeriod] = useState<PeriodKey>('LAST_12');
  const [drawerOpen, setDrawerOpen] = useState<boolean>(false);

  // Hydrate scenario from localStorage after mount (SSR-safe).
  useEffect(() => {
    const stored = loadScenarioFromStorage();
    setScenario(stored);
  }, []);

  // Load precomputed dataset.
  useEffect(() => {
    let cancelled = false;
    async function run() {
      try {
        const res = await fetch(MANAGEMENT_DATA_URL, { cache: 'no-store' });
        if (!res.ok) {
          if (!cancelled) {
            setLoadError('No management data available yet');
            setDataset(null);
          }
          return;
        }
        const json = (await res.json()) as ManagementDataset;
        if (!cancelled) {
          setDataset(json);
          setLoadError(null);
        }
      } catch {
        if (!cancelled) {
          setLoadError('No management data available yet');
          setDataset(null);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    run();
    return () => {
      cancelled = true;
    };
  }, []);

  // Re-aggregate under scenario overrides (identity when scenario is default).
  const adjustedMonthly: MonthlyAggregate[] = useMemo(() => {
    if (!dataset) return [];
    return dataset.monthly.map((m) =>
      reaggregate(m, scenario, DEFAULT_MANAGEMENT_SCENARIO),
    );
  }, [dataset, scenario]);

  const filteredMonthly = useMemo(
    () => filterByPeriod(adjustedMonthly, period),
    [adjustedMonthly, period],
  );

  const priorMonthly = useMemo(
    () => priorWindow(adjustedMonthly, filteredMonthly, period),
    [adjustedMonthly, filteredMonthly, period],
  );

  const latestYear = useMemo(() => {
    if (adjustedMonthly.length === 0) return new Date().getUTCFullYear();
    return adjustedMonthly[adjustedMonthly.length - 1].year;
  }, [adjustedMonthly]);

  const yoy = useMemo(
    () => computeYoy(adjustedMonthly, latestYear - 1, latestYear),
    [adjustedMonthly, latestYear],
  );

  // KPI derivations.
  const kpis = useMemo(() => {
    const totalSavings = sum(filteredMonthly.map((m) => m.savingsEur));
    const avgSpread = weightedAvgSpread(filteredMonthly);
    const sessions = Math.round(sum(filteredMonthly.map((m) => m.sessionsInMonth)));
    const avgDayAhead =
      filteredMonthly.length > 0
        ? sum(filteredMonthly.map((m) => m.avgDayAheadCtKwh)) /
          filteredMonthly.length
        : 0;

    const prior = priorMonthly ?? [];
    const priorTotal = sum(prior.map((m) => m.savingsEur));
    const priorSpread = weightedAvgSpread(prior);
    const priorSessions = Math.round(
      sum(prior.map((m) => m.sessionsInMonth)),
    );
    const priorDayAhead =
      prior.length > 0
        ? sum(prior.map((m) => m.avgDayAheadCtKwh)) / prior.length
        : 0;

    const sparkline = padLeft(
      filteredMonthly.map((m) => m.savingsEur),
      12,
    );

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
    };
  }, [filteredMonthly, priorMonthly]);

  // Explainer month: latest month in the filtered window when available.
  const explainerData: ExplainerData | null = useMemo(() => {
    if (!dataset) return null;
    return dataset.explainer ?? null;
  }, [dataset]);

  const latestMonthlySavings = useMemo(() => {
    if (filteredMonthly.length === 0) return 0;
    return filteredMonthly[filteredMonthly.length - 1].savingsEur;
  }, [filteredMonthly]);

  // Loading / empty-state / error handling.
  if (loading) return <PageSkeleton />;

  const isEmpty =
    loadError !== null ||
    dataset === null ||
    !Array.isArray(dataset.monthly) ||
    dataset.monthly.length === 0;

  const scenarioIsCustom = !isDefaultScenario(
    scenario,
    DEFAULT_MANAGEMENT_SCENARIO,
  );

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-3 flex items-center justify-between gap-3 flex-wrap">
          <div className="flex flex-col">
            <h1 className="text-sm font-semibold text-[#313131]">
              Flex Value Dashboard
            </h1>
            <span className="text-[11px] text-muted-foreground">
              Load-shifting value — fixed scenario, password-gated
            </span>
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
          </div>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-[1440px] mx-auto px-8 py-8">
        {isEmpty ? (
          <EmptyState message="No management data available yet. Run scripts/precompute-management-monthly.mjs to generate it, or wait for the next scheduled workflow." />
        ) : (
          <>
            {scenarioIsCustom ? (
              <div className="mb-4 text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
                Custom scenario active — numbers reflect your overrides, not the
                dashboard defaults.
              </div>
            ) : null}

            {/* KPI row */}
            <section
              aria-label="Key performance indicators"
              className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-6"
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

            {/* YoY panel */}
            <Card className="p-5 mb-6">
              <div className="flex items-baseline justify-between mb-3">
                <h2 className="text-sm font-semibold text-foreground">
                  Year over year
                </h2>
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

            {/* Explainer panel */}
            {explainerData ? (
              <ExplainerPanel
                data={explainerData}
                scenario={scenario}
                monthlySavingsEur={latestMonthlySavings}
              />
            ) : null}
          </>
        )}

        {/* Settings drawer — mounted even in empty-state so users can adjust */}
        <SettingsDrawer
          open={drawerOpen}
          onOpenChange={setDrawerOpen}
          scenario={scenario}
          onChange={setScenario}
        />
      </main>
    </div>
  );
}
