'use client'

/**
 * BatteryDayChart — intra-day battery visualization for the plug-in battery
 * business case page (phase 08).
 *
 * Renders a Recharts ComposedChart for the user-selected date with six layered
 * series (render order matters — do NOT rearrange):
 *   1. <Area>  Household load (gray)
 *   2. <Area>  PV generation (amber) — only when variant.includePv === true
 *   3. <Bar>   Battery charge (blue)
 *   4. <Bar>   Battery discharge to load (emerald)
 *   5. <Line>  Day-ahead price (brand red #EA1C0A), YAxis right
 *   6. <Line>  Battery SoC (blue dashed)
 *
 * Data flow:
 *   scenario + prices
 *      ↓ useBatteryProfiles(country) → pvProfile, loadProfile (8760 hourly fractions)
 *      ↓ slice prices.hourlyQH (preferred) or prices.hourly by selectedDate
 *      ↓ scale profiles to per-slot kWh using scenario.annualLoadKwh + variant.pvCapacityWp
 *      ↓ runBatteryDay(...) → slots[] + summary
 *      ↓ map to ChartPoint[] → ComposedChart
 *
 * DE grid-export prohibition (VDE-AR-N 4105:2026-03) is signalled via a legend-
 * style pill with a shadcn Tooltip. The optimizer already unconditionally sets
 * gridExportKwh = 0, so no bars ever render in export territory.
 */

import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  Tooltip as ShadTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { getVariant, type BatteryScenario } from '@/lib/battery-config'
import { runBatteryDay, type BatteryParams, type SlotResult } from '@/lib/battery-optimizer'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import type { PriceData } from '@/lib/use-prices'

interface Props {
  scenario: BatteryScenario
  prices: PriceData
}

interface ChartPoint {
  timestamp: number
  label: string // 'HH:MM'
  priceCtKwh: number
  loadKwh: number
  pvKwh: number
  /** positive when charging (PV or grid) */
  chargeKwh: number
  /** positive when discharging to load */
  dischargeKwh: number
  socKwhStart: number
  socKwhEnd: number
  slotSavingsEur: number
  pvSelfKwh: number
  gridImportKwh: number
}

function buildParamsFromScenario(scenario: BatteryScenario): BatteryParams {
  const variant = getVariant(scenario.variantId)
  return {
    usableKwh: variant.usableKwh,
    maxChargeKw: variant.maxChargeKw,
    maxDischargeKw: variant.maxDischargeKw,
    roundTripEff: variant.roundTripEff,
    standbyWatts: variant.standbyWatts,
    feedInCapKw: scenario.feedInCapKw, // scenario toggle: 0.8 (default) or 2.0 (proposed)
    allowGridExport: false, // Phase 8 — Pass 3 enforces 0 regardless; belt-and-braces here
  }
}

export function BatteryDayChart({ scenario, prices }: Props) {
  const variant = getVariant(scenario.variantId)
  const profiles = useBatteryProfiles(scenario.country)

  // Prefer QH (96 slots); fall back to hourly (24 slots).
  const daySlots = useMemo(() => {
    if (!prices.selectedDate) return []
    const qh = prices.hourlyQH.filter((p) => p.date === prices.selectedDate)
    if (qh.length > 0) return qh
    return prices.hourly.filter((p) => p.date === prices.selectedDate)
  }, [prices.hourlyQH, prices.hourly, prices.selectedDate])

  // Day-level optimizer result. Memoized on every input that materially affects it.
  const dayResult = useMemo(() => {
    if (daySlots.length === 0) return null
    if (!profiles.pvProfile || !profiles.loadProfile) return null
    if (!prices.selectedDate) return null

    const [yy, mm, dd] = prices.selectedDate.split('-').map(Number)
    const dayStart = Date.UTC(yy, mm - 1, dd)
    const yearStart = Date.UTC(yy, 0, 1)
    const hourOfYear = Math.floor((dayStart - yearStart) / 3_600_000)

    const slotHours = daySlots.length === 96 ? 0.25 : 24 / daySlots.length
    const pvCapKwp = variant.pvCapacityWp / 1000
    // Annual PV yield fallback (used as scalar only — profile already normalized to 1.0).
    // PVGIS confirmed yields from plan 08-01: DE 846 kWh/yr, NL 821 kWh/yr (Berlin / Rotterdam).
    // Research baseline was 820 DE / 730 NL — we use the confirmed numbers.
    const pvKwhPerYear = variant.includePv
      ? pvCapKwp * (scenario.country === 'DE' ? 820 : 730)
      : 0

    const pvPerSlot = new Array<number>(daySlots.length)
    const loadPerSlot = new Array<number>(daySlots.length)
    for (let i = 0; i < daySlots.length; i++) {
      const hourIdx = (hourOfYear + Math.floor(i * slotHours)) % 8760
      pvPerSlot[i] = (profiles.pvProfile[hourIdx] ?? 0) * pvKwhPerYear * slotHours
      loadPerSlot[i] =
        (profiles.loadProfile[hourIdx] ?? 0) * scenario.annualLoadKwh * slotHours
    }

    return runBatteryDay(daySlots, pvPerSlot, loadPerSlot, buildParamsFromScenario(scenario), 0)
  }, [daySlots, profiles.pvProfile, profiles.loadProfile, variant, scenario, prices.selectedDate])

  const chartData: ChartPoint[] = useMemo(() => {
    if (!dayResult) return []
    return dayResult.slots.map((s: SlotResult) => ({
      timestamp: s.timestamp,
      label: `${String(s.hour).padStart(2, '0')}:${String(s.minute).padStart(2, '0')}`,
      priceCtKwh: s.priceCtKwh,
      loadKwh: s.loadKwh,
      pvKwh: s.pvKwh,
      chargeKwh: s.chargeFromGridKwh + s.chargeFromPvKwh,
      dischargeKwh: s.dischargeToLoadKwh,
      socKwhStart: s.socKwhStart,
      socKwhEnd: s.socKwhEnd,
      slotSavingsEur: s.baselineCostEur - s.slotCostEur,
      pvSelfKwh: s.pvSelfKwh,
      gridImportKwh: s.gridImportKwh,
    }))
  }, [dayResult])

  const showPv = variant.includePv
  const isDe = scenario.country === 'DE'

  // --- Empty / loading state ------------------------------------------------
  if (!prices.selectedDate || chartData.length === 0) {
    const msg = profiles.error
      ? `Could not load profile data: ${profiles.error}`
      : profiles.loading || prices.loading
        ? 'Loading…'
        : 'No price data available for this date.'
    return (
      <Card className="shadow-sm border-gray-200/80">
        <CardContent className="pt-6 pb-6">
          <div className="flex items-center justify-center h-[320px]">
            <p className="text-[12px] text-gray-400">{msg}</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Day schedule — {variant.label}
          </p>
          {isDe && (
            <TooltipProvider>
              <ShadTooltip>
                <TooltipTrigger asChild>
                  <span className="inline-flex items-center text-[10px] font-medium text-gray-400 line-through cursor-help border border-gray-200 rounded-full px-2 py-0.5">
                    Grid export (prohibited DE)
                  </span>
                </TooltipTrigger>
                <TooltipContent side="bottom" className="text-[11px] max-w-[260px]">
                  VDE-AR-N 4105:2026-03 — battery discharge to the grid is not
                  permitted under the Steckerspeicher regime. Optimizer enforces
                  self-consumption only.
                </TooltipContent>
              </ShadTooltip>
            </TooltipProvider>
          )}
        </div>
      </CardHeader>
      <CardContent className={`pt-4 ${prices.loading ? 'animate-pulse' : ''}`}>
        <ResponsiveContainer width="100%" height={320}>
          <ComposedChart data={chartData} margin={{ top: 12, right: 48, bottom: 25, left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10, fill: '#6B7280' }}
              tickLine={false}
              axisLine={false}
              interval={chartData.length === 96 ? 11 : 2}
            />
            <YAxis
              yAxisId="left"
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => (typeof v === 'number' ? v.toFixed(2) : String(v))}
              label={{
                value: 'kWh / slot',
                angle: -90,
                position: 'insideLeft',
                fill: '#9CA3AF',
                fontSize: 10,
                dy: 20,
              }}
            />
            <YAxis
              yAxisId="right"
              orientation="right"
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              tickLine={false}
              axisLine={false}
              tickFormatter={(v) => (typeof v === 'number' ? `${v.toFixed(0)} ct` : String(v))}
            />

            {/* 1. Household load (gray Area) */}
            <Area
              yAxisId="left"
              type="monotone"
              dataKey="loadKwh"
              fill="#E5E7EB"
              fillOpacity={0.5}
              stroke="#9CA3AF"
              strokeWidth={1}
              dot={false}
              isAnimationActive={false}
              name="Household load"
            />

            {/* 2. PV generation (amber Area) — only when variant has PV */}
            {showPv && (
              <Area
                yAxisId="left"
                type="monotone"
                dataKey="pvKwh"
                fill="#FEF3C7"
                fillOpacity={0.6}
                stroke="#F59E0B"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="PV generation"
              />
            )}

            {/* 3. Battery charge bars (blue) */}
            <Bar
              yAxisId="left"
              dataKey="chargeKwh"
              fill="#3B82F6"
              fillOpacity={0.65}
              maxBarSize={8}
              isAnimationActive={false}
              name="Battery charge"
            />

            {/* 4. Battery discharge-to-load bars (emerald) */}
            <Bar
              yAxisId="left"
              dataKey="dischargeKwh"
              fill="#10B981"
              fillOpacity={0.65}
              maxBarSize={8}
              isAnimationActive={false}
              name="Battery discharge"
            />

            {/* 5. Day-ahead price line (brand red) — right YAxis in ct/kWh */}
            <Line
              yAxisId="right"
              type="monotone"
              dataKey="priceCtKwh"
              stroke="#EA1C0A"
              strokeWidth={2}
              strokeOpacity={prices.loading ? 0.3 : 1}
              dot={false}
              isAnimationActive={false}
              name="Day-ahead price"
            />

            {/* 6. Battery SoC line (blue dashed) — left YAxis in kWh */}
            <Line
              yAxisId="left"
              type="monotone"
              dataKey="socKwhEnd"
              stroke="#3B82F6"
              strokeWidth={1.5}
              strokeDasharray="4 3"
              dot={false}
              isAnimationActive={false}
              name="Battery SoC"
            />

            <Tooltip
              content={({ active, payload }) => {
                if (!active || !payload?.length) return null
                const d = payload[0].payload as ChartPoint
                return (
                  <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                    <p className="text-gray-500 text-[10px]">{d.label}</p>
                    <p className="tabular-nums text-[#EA1C0A] font-semibold">
                      {d.priceCtKwh.toFixed(1)} ct/kWh
                    </p>
                    <p className="tabular-nums text-gray-600">
                      Load: {d.loadKwh.toFixed(3)} kWh
                    </p>
                    {showPv && (
                      <p className="tabular-nums text-amber-600">
                        PV: {d.pvKwh.toFixed(3)} kWh
                      </p>
                    )}
                    {d.chargeKwh > 0 && (
                      <p className="tabular-nums text-blue-600">
                        Charge: {d.chargeKwh.toFixed(3)} kWh
                      </p>
                    )}
                    {d.dischargeKwh > 0 && (
                      <p className="tabular-nums text-emerald-600">
                        Discharge: {d.dischargeKwh.toFixed(3)} kWh
                      </p>
                    )}
                    <p className="tabular-nums text-blue-600">
                      SoC: {d.socKwhStart.toFixed(2)} → {d.socKwhEnd.toFixed(2)} kWh
                    </p>
                    <p
                      className={`tabular-nums font-semibold ${
                        d.slotSavingsEur < 0 ? 'text-red-600' : 'text-emerald-600'
                      }`}
                    >
                      {d.slotSavingsEur >= 0 ? '+' : ''}
                      {d.slotSavingsEur.toFixed(4)} EUR
                    </p>
                  </div>
                )
              }}
            />
            <Legend wrapperStyle={{ fontSize: '10px', paddingTop: '8px' }} iconType="rect" />
          </ComposedChart>
        </ResponsiveContainer>
      </CardContent>
    </Card>
  )
}
