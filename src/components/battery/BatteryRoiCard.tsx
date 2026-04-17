'use client'

/**
 * BatteryRoiCard — the consumer-facing annual ROI card for the plug-in battery
 * business case page (phase 08). Three stacked sections:
 *
 *   1. Top — two-column baseline (no battery) vs. with-battery annual summary.
 *   2. Middle — four hero ROI metrics in a 2×2 grid:
 *        • Annual savings (EUR)
 *        • Simple payback (years)                  = hardwareCost / max(0.01, annualSavings)
 *        • Break-even year                         = currentYear + ceil(paybackYears)
 *        • 10-year NPV (3% discount, EUR)
 *   3. Bottom — 12-month stacked bar chart (arbitrage + PV self-consumption)
 *                 with cumulative-savings overlay line.
 *
 * Plus a collapsible formula accordion with the full computation walk-through.
 *
 * The component is pure display — it derives metrics from `useBatteryYear`
 * (Task 1 of this plan), not from any internal optimizer call. Loading and
 * empty states render a single placeholder.
 */

import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getVariant, type BatteryScenario } from '@/lib/battery-config'
import {
  computeBatteryEconomics,
  computeMonthlyEconomics,
  getTariffLabelForScenario,
} from '@/lib/battery-economics'
import { useBatteryYear } from '@/lib/use-battery-year'
import type { PriceData } from '@/lib/use-prices'

interface Props {
  scenario: BatteryScenario
  prices: PriceData
}

interface MonthChartPoint {
  displayLabel: string          // 'MM' — mirrors MonthlySavingsCard tick style
  arbitrageEur: number
  pvGrossEur: number
  valueDragNeg: number
  cumulative: number
}

/** Discount rate for 10-year NPV — pinned at 3% per UI-SPEC copy
 *  "10-year NPV (3% discount)". Do NOT change without updating the label. */
const DISCOUNT_RATE = 0.03

/** 10-year NPV of annual savings minus upfront hardware cost.
 *   NPV = -hardwareCost + Σ_{y=1..10} annualSavings / (1 + r)^y
 *  The per-year savings stream is nominally constant (no inflation on EUR savings)
 *  and discount rate is applied annually at year-end.  */
function computeNpv10(hardwareCostEur: number, annualSavings: number): number {
  let npv = -hardwareCostEur
  for (let y = 1; y <= 10; y++) {
    npv += annualSavings / Math.pow(1 + DISCOUNT_RATE, y)
  }
  return npv
}

export function BatteryRoiCard({ scenario, prices }: Props) {
  const variant = getVariant(scenario.variantId)
  const annual = useBatteryYear(scenario, prices)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const tariffLabel = getTariffLabelForScenario(scenario)
  const economics = useMemo(
    () => (annual ? computeBatteryEconomics(annual, scenario) : null),
    [annual, scenario],
  )

  const metrics = useMemo(() => {
    if (!annual || !economics) return null
    const annualSavingsEur = economics.netAnnualSavingsEur
    const hardwareCost = variant.hardwareCostEurIncVat
    // Guard against zero/negative savings → non-finite payback → render em-dash.
    const paybackYears =
      annualSavingsEur > 0.01 ? hardwareCost / annualSavingsEur : Infinity
    // Break-even year derived at render from the current runtime date — never hardcoded.
    const currentYear = new Date().getUTCFullYear()
    const breakEvenYear = Number.isFinite(paybackYears)
      ? currentYear + Math.ceil(paybackYears)
      : null
    const npv10 = computeNpv10(hardwareCost, annualSavingsEur)
    return {
      annualSavingsEur,
      paybackYears,
      breakEvenYear,
      npv10,
      hardwareCost,
    }
  }, [annual, economics, variant])

  const monthChartData: MonthChartPoint[] = useMemo(() => {
    if (!annual) return []
    let cum = 0
    return computeMonthlyEconomics(annual.months, scenario).map((m) => {
      cum += m.netSavingsEur
      return {
        displayLabel: m.month.slice(5),    // 'YYYY-MM' → 'MM'
        arbitrageEur: m.arbitrageEur,
        pvGrossEur: m.pvGrossEur,
        valueDragNeg: -m.valueDragEur,
        cumulative: cum,
      }
    })
  }, [annual, scenario])

  // Loading / empty — render a single placeholder card.
  if (!annual || !metrics || !economics) {
    return (
      <Card className="shadow-sm border-gray-200/80">
        <CardHeader className="pb-2 border-b border-gray-100">
          <CardTitle className="text-base font-semibold text-[#313131]">
            Consumer ROI
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-center justify-center h-[240px]">
            <p className="text-[12px] text-gray-400">Computing annual ROI…</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  const showPv = variant.includePv
  // VAT footnote string varies by variant.vatRate per UI-SPEC §Screen 3.
  const vatNote =
    variant.vatRate === 0
      ? '0% VAT applies (PV + battery bundle, §12 Abs. 3 UStG)'
      : 'Incl. 19% VAT (standalone battery without PV, §12 Abs. 3 UStG)'

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <CardTitle className="text-base font-semibold text-[#313131]">
          Consumer ROI — {variant.label}
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-5">

        {/* ---------------------------------------------------------------- */}
        {/* Section 1: Baseline vs. with-battery annual summary              */}
        {/* ---------------------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-3">
          {/* No battery */}
          <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
            <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-2.5">
              Reference case
            </p>
            <p className="tabular-nums text-[#313131] text-[12px]">
              Dynamic tariff:{' '}
              <span className="font-semibold">{tariffLabel}</span>
            </p>
            <p className="tabular-nums text-[#313131] text-[12px]">
              Country mode: <span className="font-semibold">{scenario.country}</span>
            </p>
          </div>

          {/* With battery */}
          <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-100/80">
            <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2.5">
              With battery
            </p>
            <p className="tabular-nums text-[#313131] text-[12px]">
              Arbitrage saving:{' '}
              <span className="font-semibold text-emerald-700">
                {annual.arbitrageSavingsEur.toFixed(0)} EUR/yr
              </span>
            </p>
            <p className="tabular-nums text-[#313131] text-[12px]">
              Residual grid import:{' '}
              <span className="font-semibold">
                {annual.gridImportKwh.toFixed(0)} kWh/yr
              </span>
            </p>
            {showPv && (
              <p className="tabular-nums text-[#313131] text-[12px]">
                PV self-consumption (gross):{' '}
                <span className="font-semibold text-amber-700">
                  {economics.pvSelfConsumptionGrossEur.toFixed(0)} EUR/yr
                </span>
              </p>
            )}
            <p className="tabular-nums text-[#313131] text-[12px]">
              Standby cost:{' '}
              <span className="font-semibold text-red-600">
                -{annual.standbyCostEur.toFixed(0)} EUR/yr
              </span>
            </p>
            {economics.fixedRegulationCostEur > 0 && (
              <p className="tabular-nums text-[#313131] text-[12px]">
                Return-delivery fee:{' '}
                <span className="font-semibold text-red-600">
                  -{economics.fixedRegulationCostEur.toFixed(0)} EUR/yr
                </span>
              </p>
            )}
          </div>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Section 2: Four hero ROI metrics                                 */}
        {/* ---------------------------------------------------------------- */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <p className="text-xl font-semibold text-emerald-700 tabular-nums">
              {metrics.annualSavingsEur.toFixed(0)} EUR
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">Annual savings</p>
          </div>
          <div>
            <p className="text-xl font-semibold text-[#313131] tabular-nums">
              {Number.isFinite(metrics.paybackYears)
                ? metrics.paybackYears.toFixed(1)
                : '—'}{' '}
              yr
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">Simple payback</p>
          </div>
          <div>
            <p className="text-xl font-semibold text-[#313131] tabular-nums">
              {metrics.breakEvenYear ?? '—'}
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">Break-even year</p>
          </div>
          <div>
            <p
              className={`text-xl font-semibold tabular-nums ${
                metrics.npv10 >= 0 ? 'text-emerald-700' : 'text-red-600'
              }`}
            >
              {metrics.npv10.toFixed(0)} EUR
            </p>
            <p className="text-[10px] text-gray-400 mt-0.5">
              10-year NPV (3% discount)
            </p>
          </div>
        </div>

        {/* VAT footnote — amber marker, varies by variant.vatRate */}
        <p className="text-[10px] text-amber-600">* {vatNote}</p>

        {/* ---------------------------------------------------------------- */}
        {/* Section 3: 12-month revenue breakdown (stacked bar + cumulative) */}
        {/* ---------------------------------------------------------------- */}
        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            12-month revenue breakdown
          </p>
          <ResponsiveContainer width="100%" height={180}>
            <ComposedChart
              data={monthChartData}
              margin={{ top: 12, right: 48, bottom: 2, left: 5 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="displayLabel"
                tick={{ fontSize: 10, fontWeight: 500, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <YAxis
                yAxisId="right"
                orientation="right"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              {/* Arbitrage savings — always rendered */}
              <Bar
                yAxisId="left"
                dataKey="arbitrageEur"
                stackId="rev"
                fill="#10B981"
                fillOpacity={0.7}
                maxBarSize={22}
                isAnimationActive={false}
              />
              {/* PV self-consumption — only for variants with PV */}
              {showPv && (
                <Bar
                  yAxisId="left"
                  dataKey="pvGrossEur"
                  stackId="rev"
                  fill="#F59E0B"
                  fillOpacity={0.7}
                  maxBarSize={22}
                  isAnimationActive={false}
                  radius={[3, 3, 0, 0]}
                />
              )}
              <Bar
                yAxisId="left"
                dataKey="valueDragNeg"
                stackId="rev"
                fill="#F87171"
                fillOpacity={0.45}
                maxBarSize={22}
                isAnimationActive={false}
              />
              {/* Cumulative savings line (dashed, right axis) */}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="cumulative"
                stroke="#374151"
                strokeWidth={1.5}
                strokeDasharray="4 3"
                dot={false}
                isAnimationActive={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as MonthChartPoint
                  return (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                      <p className="text-gray-500 text-[10px]">Month {d.displayLabel}</p>
                      <p className="tabular-nums text-emerald-700">
                        Arbitrage: {d.arbitrageEur.toFixed(1)} EUR
                      </p>
                      {showPv && (
                        <p className="tabular-nums text-amber-700">
                          PV self: {d.pvGrossEur.toFixed(1)} EUR
                        </p>
                      )}
                      <p className="tabular-nums text-red-500">
                        Value drag: {Math.abs(d.valueDragNeg).toFixed(1)} EUR
                      </p>
                      <p className="tabular-nums text-gray-600">
                        Cumulative: {d.cumulative.toFixed(1)} EUR
                      </p>
                    </div>
                  )
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* ---------------------------------------------------------------- */}
        {/* Section 4: Collapsible formula walk-through                      */}
        {/* ---------------------------------------------------------------- */}
        <div className="border border-gray-200/60 rounded-lg overflow-hidden">
          <button
            type="button"
            onClick={() => setFormulaOpen((v) => !v)}
            aria-expanded={formulaOpen}
            className="w-full flex items-center justify-between bg-gray-50/80 px-3.5 py-2 text-left hover:bg-gray-100/60 transition-colors"
          >
            <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Formula: hardware cost ÷ annual savings = payback (yr)
            </span>
            <span className="text-[10px] text-gray-400 ml-2">
              {formulaOpen ? '▲' : '▼'}
            </span>
          </button>
          {formulaOpen && (
            <div className="px-3.5 py-3 text-[11px] space-y-1.5 bg-gray-50/40 tabular-nums">
              <div className="flex justify-between">
                <span className="text-gray-500">Hardware cost (incl. VAT)</span>
                <span className="font-semibold text-[#313131]">
                  {metrics.hardwareCost.toFixed(0)} EUR
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Arbitrage savings / yr</span>
                <span className="font-semibold text-emerald-700">
                  {annual.arbitrageSavingsEur.toFixed(1)} EUR
                </span>
              </div>
              {showPv && (
                <div className="flex justify-between">
                  <span className="text-gray-500">PV self-consumption / yr</span>
                  <span className="font-semibold text-amber-700">
                    {economics.pvSelfConsumptionGrossEur.toFixed(1)} EUR
                  </span>
                </div>
              )}
              {economics.pvOpportunityCostEur > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Foregone export value / yr</span>
                  <span className="font-semibold text-red-600">
                    -{economics.pvOpportunityCostEur.toFixed(1)} EUR
                  </span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-gray-500">Standby cost / yr</span>
                <span className="font-semibold text-red-600">
                  -{annual.standbyCostEur.toFixed(1)} EUR
                </span>
              </div>
              {economics.fixedRegulationCostEur > 0 && (
                <div className="flex justify-between">
                  <span className="text-gray-500">Terugleverkosten / yr</span>
                  <span className="font-semibold text-red-600">
                    -{economics.fixedRegulationCostEur.toFixed(1)} EUR
                  </span>
                </div>
              )}
              <div className="flex justify-between border-t border-gray-200 pt-1">
                <span className="text-gray-500">Net annual savings</span>
                <span className="font-semibold text-[#313131]">
                  {economics.netAnnualSavingsEur.toFixed(1)} EUR
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Simple payback</span>
                <span className="font-semibold text-[#313131]">
                  {Number.isFinite(metrics.paybackYears)
                    ? metrics.paybackYears.toFixed(2) + ' yr'
                    : 'n/a'}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">10-year NPV (3%)</span>
                <span
                  className={`font-semibold ${
                    metrics.npv10 >= 0 ? 'text-emerald-700' : 'text-red-600'
                  }`}
                >
                  {metrics.npv10.toFixed(0)} EUR
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Battery cycles / yr</span>
                <span className="font-semibold text-[#313131]">
                  {annual.cyclesEquivalent.toFixed(1)}
                </span>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
