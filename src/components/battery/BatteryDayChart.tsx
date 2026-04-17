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

import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import {
  getLoadProfile,
  getVariant,
  type BatteryScenario,
} from '@/lib/battery-config'
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
  chargeFromGridKwh: number
  /** positive when discharging to load */
  dischargeKwh: number
  slotSavingsEur: number
  pvSelfKwh: number
  socPct: number
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
  const profileYear = useMemo(() => {
    const dateLike = prices.selectedDate
      ?? prices.daily[0]?.date
      ?? prices.hourly[0]?.date
      ?? prices.hourlyQH[0]?.date
    const parsed = Number(dateLike?.slice(0, 4))
    return Number.isFinite(parsed) && parsed > 2000 ? parsed : new Date().getUTCFullYear()
  }, [prices.selectedDate, prices.daily, prices.hourly, prices.hourlyQH])
  const profiles = useBatteryProfiles(scenario.country, scenario.loadProfileId, profileYear)
  const loadProfile = useMemo(
    () => getLoadProfile(scenario.loadProfileId, scenario.country),
    [scenario.country, scenario.loadProfileId],
  )
  const [batteryEnabled, setBatteryEnabled] = useState(true)

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
      chargeFromGridKwh: s.chargeFromGridKwh,
      dischargeKwh: s.dischargeToLoadKwh,
      slotSavingsEur: s.baselineCostEur - s.slotCostEur,
      pvSelfKwh: s.pvSelfKwh,
      socPct: variant.usableKwh > 0 ? (s.socKwhEnd / variant.usableKwh) * 100 : 0,
    }))
  }, [dayResult, variant.usableKwh])

  const showPv = variant.includePv
  const dischargeCapPerSlotKwh =
    chartData.length === 96 ? scenario.feedInCapKw * 0.25 : scenario.feedInCapKw * (24 / chartData.length)
  const displayData = useMemo(() => {
    return chartData.map((point) => ({
      ...point,
      chargeMarkerCtKwh: batteryEnabled && point.chargeKwh > 0 ? point.priceCtKwh : null,
      dischargeMarkerCtKwh: batteryEnabled && point.dischargeKwh > 0 ? point.priceCtKwh : null,
      visibleSocPct: batteryEnabled ? point.socPct : 0,
    }))
  }, [batteryEnabled, chartData])
  const selectedDayTotals = useMemo(() => {
    if (!dayResult || chartData.length === 0) return null
    const consumptionKwh = chartData.reduce((sum, point) => sum + point.loadKwh, 0)
    const chargeKwh = chartData.reduce((sum, point) => sum + point.chargeKwh, 0)
    const dischargeKwh = chartData.reduce((sum, point) => sum + point.dischargeKwh, 0)
    const baselineAvgCt = consumptionKwh > 0 ? (dayResult.summary.baselineCostEur / consumptionKwh) * 100 : 0
    const batteryAvgCt = consumptionKwh > 0 ? (dayResult.summary.optimizedCostEur / consumptionKwh) * 100 : 0
    return {
      consumptionKwh,
      chargeKwh,
      dischargeKwh,
      savingsEur: dayResult.summary.savingsEur,
      baselineCostEur: dayResult.summary.baselineCostEur,
      optimizedCostEur: dayResult.summary.optimizedCostEur,
      baselineAvgCt,
      batteryAvgCt,
    }
  }, [chartData, dayResult])

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
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Day schedule — {variant.shortLabel}
            </p>
            <p className="text-[12px] text-gray-500 mt-1">
              Household demand stays unchanged. Battery charging, discharging, and SoC are shown separately against the day-ahead price path.
            </p>
          </div>
          <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
            <button
              type="button"
              onClick={() => setBatteryEnabled(false)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                !batteryEnabled ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Battery off
            </button>
            <button
              type="button"
              onClick={() => setBatteryEnabled(true)}
              className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                batteryEnabled ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
              }`}
            >
              Battery on
            </button>
          </div>
        </div>
      </CardHeader>
      <CardContent className={`pt-4 ${prices.loading ? 'animate-pulse' : ''}`}>
        <div className="mb-3 rounded-xl border border-gray-200 bg-gray-50/70 px-3 py-2">
          <div className="flex items-center justify-between mb-1">
            <span className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">
              Battery state of charge
            </span>
            <span className="text-[10px] text-gray-400">
              {batteryEnabled ? `${variant.usableKwh.toFixed(1)} kWh usable` : 'Battery disabled'}
            </span>
          </div>
          <div className="h-[72px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={displayData} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
                <XAxis dataKey="label" hide />
                <YAxis hide domain={[0, 100]} />
                <Area
                  type="monotone"
                  dataKey="visibleSocPct"
                  fill="#DBEAFE"
                  fillOpacity={0.65}
                  stroke="#2563EB"
                  strokeWidth={1.5}
                  dot={false}
                  isAnimationActive={false}
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="relative h-[300px]">
          {batteryEnabled && selectedDayTotals && selectedDayTotals.consumptionKwh > 0 && (() => {
            const diffCt = selectedDayTotals.baselineAvgCt - selectedDayTotals.batteryAvgCt
            const isCheaper = diffCt >= 0
            return (
              <div className="absolute left-14 top-1 z-20 pointer-events-none flex items-center gap-1.5">
                <div className={`backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5 ${isCheaper ? 'bg-emerald-50/80 border-emerald-300/50' : 'bg-red-50/80 border-red-300/50'}`}>
                  <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCheaper ? 'bg-emerald-500' : 'bg-red-500'}`} />
                  <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${isCheaper ? 'text-emerald-700' : 'text-red-700'}`}>
                    {isCheaper ? '+' : ''}{selectedDayTotals.savingsEur.toFixed(2)} EUR
                  </span>
                  <span className={`text-[9px] font-semibold whitespace-nowrap ${isCheaper ? 'text-emerald-600' : 'text-red-600'}`}>
                    {isCheaper ? 'saved with battery today' : 'battery adds cost today'}
                  </span>
                </div>
                <span className="text-[9px] text-gray-400 tabular-nums">
                  {selectedDayTotals.batteryAvgCt.toFixed(1)} vs {selectedDayTotals.baselineAvgCt.toFixed(1)} ct/kWh
                </span>
              </div>
            )
          })()}
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayData} margin={{ top: 36, right: 48, bottom: 20, left: 20 }}>
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

              <Area
                yAxisId="left"
                type="monotone"
                dataKey="loadKwh"
                fill="#E5E7EB"
                fillOpacity={0.28}
                stroke="#6B7280"
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                name="Household demand"
              />

              {showPv && (
                <Area
                  yAxisId="left"
                  type="monotone"
                  dataKey="pvKwh"
                  fill="#FEF3C7"
                  fillOpacity={0.35}
                  stroke="#F59E0B"
                  strokeWidth={1.2}
                  dot={false}
                  isAnimationActive={false}
                  name="PV generation"
                />
              )}
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="priceCtKwh"
                stroke="#EA1C0A"
                strokeWidth={1.5}
                strokeOpacity={0.55}
                dot={false}
                isAnimationActive={false}
                name="Day-ahead price"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="chargeMarkerCtKwh"
                stroke="#2563EB"
                strokeWidth={2.5}
                connectNulls={false}
                dot={{ r: 2, fill: '#2563EB', stroke: '#2563EB' }}
                activeDot={{ r: 4, fill: '#2563EB', stroke: '#2563EB' }}
                isAnimationActive={false}
                name="Battery charging"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="dischargeMarkerCtKwh"
                stroke="#10B981"
                strokeWidth={2.5}
                connectNulls={false}
                dot={{ r: 2, fill: '#10B981', stroke: '#10B981' }}
                activeDot={{ r: 4, fill: '#10B981', stroke: '#10B981' }}
                isAnimationActive={false}
                name="Battery discharging"
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
                        Household demand: {d.loadKwh.toFixed(3)} kWh
                      </p>
                      <p className="tabular-nums text-slate-600">
                        SoC: {d.socPct.toFixed(0)}%
                      </p>
                      {showPv && (
                        <p className="tabular-nums text-amber-600">
                          PV generation: {d.pvKwh.toFixed(3)} kWh
                        </p>
                      )}
                      {d.chargeKwh > 0 && (
                        <p className="tabular-nums text-blue-600">
                          Battery charging: {d.chargeKwh.toFixed(3)} kWh
                          {d.chargeFromGridKwh > 0 ? ' from grid' : ' from PV'}
                        </p>
                      )}
                      {d.dischargeKwh > 0 && (
                        <p className="tabular-nums text-emerald-600">
                          Battery support: {d.dischargeKwh.toFixed(3)} kWh
                        </p>
                      )}
                      <p
                        className={`tabular-nums font-semibold ${
                          d.slotSavingsEur < 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {d.slotSavingsEur >= 0 ? '+' : ''}
                        {d.slotSavingsEur.toFixed(4)} EUR vs no battery
                      </p>
                    </div>
                  )
                }}
              />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex flex-wrap items-center gap-4 mt-2 text-[10px] text-gray-500">
          <span className="flex items-center gap-1">
            <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#E5E7EB' }} /> Household demand unchanged
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#2563EB' }} /> Battery charging
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#10B981' }} /> Battery discharging
          </span>
          <span className="flex items-center gap-1">
            <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#EA1C0A' }} /> Day-ahead price
          </span>
          <span className="text-gray-400">
            Profile: {loadProfile.label} · Battery cap {dischargeCapPerSlotKwh.toFixed(2)} kWh/slot
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
