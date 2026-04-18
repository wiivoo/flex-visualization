'use client';

/**
 * ExplainerPanel — audit-trail panel for the Management Dashboard (PROJ-40).
 *
 * Proves the headline monthly savings by rendering:
 *   1. Average QH price profile across the selected month (96 data points)
 *   2. Baseline window (18:00 → departure) shaded red
 *   3. Optimized charging window shaded green
 *   4. Reconciliation equation: spread × energy/session × sessions ≈ monthly €
 *   5. Energy-per-QH intuition in a tooltip on hover
 *
 * The reconciliation must match the KPI tile's monthly savings within 1%.
 * Drift above 1% renders a warning; within tolerance renders a confirmation.
 *
 * Requirements covered: MGMT-04, MGMT-05, MGMT-06.
 */

import * as React from 'react';
import {
  ComposedChart,
  Line,
  ReferenceArea,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { Card } from '@/components/ui/card';
import type { ExplainerData, ManagementScenario } from '@/lib/management-config';

interface ExplainerPanelProps {
  data: ExplainerData;
  scenario: ManagementScenario;
  /** Monthly savings from the KPI tile (EUR). Used to check reconciliation drift. */
  monthlySavingsEur: number;
}

const CHART_HEIGHT = 220;
const QH_PER_DAY = 96;

/** QH index (0..95) → "HH:MM". */
function qhToHhmm(qh: number): string {
  const clamped = Math.max(0, Math.min(QH_PER_DAY - 1, Math.floor(qh)));
  const h = Math.floor(clamped / 4);
  const m = (clamped % 4) * 15;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/**
 * Split a (possibly wrap-around) QH window [startQh..endQh] into one or two
 * linear sub-ranges expressed as {x1, x2} pairs on the 0..95 axis. When the
 * window wraps midnight, two sub-ranges are emitted.
 */
function windowToSubRanges(
  startQh: number,
  endQh: number,
): { x1: number; x2: number }[] {
  if (endQh >= startQh) return [{ x1: startQh, x2: endQh }];
  return [
    { x1: startQh, x2: QH_PER_DAY - 1 },
    { x1: 0, x2: endQh },
  ];
}

const EUR_FMT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
});

const EUR_FMT_2 = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 2,
});

interface TooltipPayloadEntry {
  payload?: { qhIndex?: number; ctKwh?: number };
}

interface TooltipContentProps {
  active?: boolean;
  payload?: TooltipPayloadEntry[];
  chargePowerKw: number;
}

const ChartTooltip: React.FC<TooltipContentProps> = ({ active, payload, chargePowerKw }) => {
  if (!active || !payload || payload.length === 0) return null;
  const first = payload[0];
  const p = first?.payload;
  if (!p || typeof p.qhIndex !== 'number' || typeof p.ctKwh !== 'number') return null;
  const energyPerQh = chargePowerKw * 0.25;
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] max-w-[240px]">
      <p className="text-gray-500 text-[11px] mb-1 font-mono">{qhToHhmm(p.qhIndex)}</p>
      <p className="font-semibold tabular-nums font-mono">
        {p.ctKwh.toFixed(2)} ct/kWh
      </p>
      <p className="text-gray-500 text-[11px] mt-1 tabular-nums">
        Energy per QH: {energyPerQh.toFixed(2)} kWh ({chargePowerKw} kW × 15 min)
      </p>
    </div>
  );
};

export const ExplainerPanel: React.FC<ExplainerPanelProps> = ({
  data,
  scenario,
  monthlySavingsEur,
}) => {
  const { avgQhProfile, chargingWindow, baselineWindow, spreadCtKwh, energyPerSessionKwh, sessionsInMonth, reconciledSavingsEur, monthKey } = data;

  const hasData = avgQhProfile.length > 0;

  const baselineRanges = React.useMemo(
    () => windowToSubRanges(baselineWindow.startQh, baselineWindow.endQh),
    [baselineWindow.startQh, baselineWindow.endQh],
  );
  const chargingRanges = React.useMemo(
    () => windowToSubRanges(chargingWindow.startQh, chargingWindow.endQh),
    [chargingWindow.startQh, chargingWindow.endQh],
  );

  const driftPct = React.useMemo(() => {
    const denom = Math.max(1, Math.abs(monthlySavingsEur));
    return Math.abs(reconciledSavingsEur - monthlySavingsEur) / denom;
  }, [reconciledSavingsEur, monthlySavingsEur]);
  const reconciled = driftPct <= 0.01;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-baseline justify-between">
        <h3 className="text-sm font-semibold text-foreground">Why these numbers add up</h3>
        <span className="text-[11px] text-muted-foreground font-mono tabular-nums">
          {monthKey || '—'}
        </span>
      </div>

      {!hasData ? (
        <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
          No data for selected period
        </div>
      ) : (
        <>
          <div style={{ width: '100%', height: CHART_HEIGHT }}>
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart
                data={avgQhProfile}
                margin={{ top: 8, right: 12, left: 0, bottom: 8 }}
              >
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis
                  dataKey="qhIndex"
                  type="number"
                  domain={[0, 95]}
                  ticks={[0, 24, 48, 72, 95]}
                  tickFormatter={(qh: number) => qhToHhmm(qh)}
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  stroke="#9CA3AF"
                  allowDecimals={false}
                />
                <YAxis
                  tick={{ fontSize: 10, fill: '#6B7280' }}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  stroke="#9CA3AF"
                  width={40}
                  label={{
                    value: 'ct/kWh',
                    angle: -90,
                    position: 'insideLeft',
                    fontSize: 10,
                    fill: '#6B7280',
                  }}
                />

                <Tooltip
                  content={<ChartTooltip chargePowerKw={scenario.chargePowerKw} />}
                />

                {baselineRanges.map((r, i) => (
                  <ReferenceArea
                    key={`baseline-${i}`}
                    x1={r.x1}
                    x2={r.x2}
                    fill="#DC2626"
                    fillOpacity={0.08}
                    stroke="#fca5a5"
                    strokeOpacity={0.4}
                    ifOverflow="hidden"
                    label={
                      i === 0
                        ? {
                            value: 'Baseline (unmanaged)',
                            position: 'insideTopLeft',
                            fontSize: 9,
                            fill: '#991B1B',
                          }
                        : undefined
                    }
                  />
                ))}
                {chargingRanges.map((r, i) => (
                  <ReferenceArea
                    key={`charging-${i}`}
                    x1={r.x1}
                    x2={r.x2}
                    fill="#059669"
                    fillOpacity={0.12}
                    stroke="#86efac"
                    strokeOpacity={0.4}
                    ifOverflow="hidden"
                    label={
                      i === 0
                        ? {
                            value: 'Optimized window',
                            position: 'insideTopRight',
                            fontSize: 9,
                            fill: '#065F46',
                          }
                        : undefined
                    }
                  />
                ))}

                <Line
                  type="stepAfter"
                  dataKey="ctKwh"
                  stroke="#374151"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>

          {/* Reconciliation equation row */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 border-t border-gray-100 pt-3">
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                Spread
              </span>
              <span className="text-base font-semibold tabular-nums font-mono">
                {spreadCtKwh.toFixed(2)} ct/kWh
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                × Energy/session
              </span>
              <span className="text-base font-semibold tabular-nums font-mono">
                {energyPerSessionKwh.toFixed(1)} kWh
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                × Sessions
              </span>
              <span className="text-base font-semibold tabular-nums font-mono">
                {sessionsInMonth.toFixed(1)}
              </span>
            </div>
            <div className="flex flex-col">
              <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
                = Monthly
              </span>
              <span className="text-base font-semibold tabular-nums font-mono">
                {EUR_FMT.format(reconciledSavingsEur)}
              </span>
            </div>
          </div>

          {/* Tolerance check */}
          <div className="flex items-center justify-between text-[11px]">
            {reconciled ? (
              <span className="text-emerald-600 tabular-nums">
                Reconciled within 1% — headline {EUR_FMT_2.format(monthlySavingsEur)} ≈ derived {EUR_FMT_2.format(reconciledSavingsEur)}
              </span>
            ) : (
              <span className="text-red-600 tabular-nums">
                ⚠ Reconciliation drift: {(driftPct * 100).toFixed(1)}% (headline {EUR_FMT_2.format(monthlySavingsEur)} vs derived {EUR_FMT_2.format(reconciledSavingsEur)})
              </span>
            )}
            <span className="text-muted-foreground">
              Energy per QH = power × 0.25 h
            </span>
          </div>

          {/* Energy-per-QH intuition caption */}
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground mb-2">
              How to read this chart
            </p>
            <p className="text-[12px] text-muted-foreground mb-2 leading-relaxed">
              Each 15-min slot contributes <span className="font-mono tabular-nums">price × power × 0.25 h</span> to session cost.
              The red band is what you'd pay by charging immediately at plug-in; the green band is the cheapest contiguous slots inside your plug-in→departure window.
            </p>
            <div className="overflow-x-auto">
              <table className="text-[11px] tabular-nums font-mono w-full">
                <thead>
                  <tr className="text-muted-foreground text-left">
                    <th className="pr-3 font-normal">Power</th>
                    <th className="pr-3 font-normal">kWh per QH slot</th>
                    <th className="font-normal">Slots to fill 10 kWh</th>
                  </tr>
                </thead>
                <tbody className="text-foreground">
                  <tr>
                    <td className="pr-3 py-0.5">0.8 kW</td>
                    <td className="pr-3 py-0.5">0.20 kWh</td>
                    <td className="py-0.5">50 (12.5 h)</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5">3.7 kW</td>
                    <td className="pr-3 py-0.5">0.93 kWh</td>
                    <td className="py-0.5">≈11 (2.75 h)</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5">7 kW</td>
                    <td className="pr-3 py-0.5">1.75 kWh</td>
                    <td className="py-0.5">≈6 (1.5 h)</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5">11 kW</td>
                    <td className="pr-3 py-0.5">2.75 kWh</td>
                    <td className="py-0.5">≈4 (1 h)</td>
                  </tr>
                  <tr>
                    <td className="pr-3 py-0.5">22 kW</td>
                    <td className="pr-3 py-0.5">5.50 kWh</td>
                    <td className="py-0.5">2 (0.5 h)</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </Card>
  );
};
