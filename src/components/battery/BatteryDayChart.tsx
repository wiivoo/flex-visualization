'use client'

import { useMemo, useState } from 'react'
import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
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

type Resolution = 'hour' | 'quarterhour'
type WindowHours = 24 | 36 | 72

interface ChartPoint {
  timestamp: number
  label: string
  priceCtKwh: number
  loadKwh: number
  pvKwh: number
  chargeKwh: number
  chargeFromGridKwh: number
  dischargeKwh: number
  slotSavingsEur: number
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
    feedInCapKw: scenario.feedInCapKw,
    allowGridExport: false,
  }
}

function formatSlotLabel(timestamp: number) {
  const d = new Date(timestamp)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hour}:${minute}`
}

export function BatteryDayChart({ scenario, prices }: Props) {
  const [batteryEnabled, setBatteryEnabled] = useState(true)
  const [resolution, setResolution] = useState<Resolution>('hour')
  const [windowHours, setWindowHours] = useState<WindowHours>(36)

  const variant = useMemo(() => getVariant(scenario.variantId), [scenario.variantId])
  const profileYear = useMemo(() => {
    const dateLike = prices.selectedDate
      ?? prices.daily[0]?.date
      ?? prices.hourly[0]?.date
      ?? prices.hourlyQH[0]?.date
    const parsed = Number(dateLike?.slice(0, 4))
    return Number.isFinite(parsed) && parsed > 2000 ? parsed : new Date().getFullYear()
  }, [prices.selectedDate, prices.daily, prices.hourly, prices.hourlyQH])
  const profiles = useBatteryProfiles(scenario.country, scenario.loadProfileId, profileYear)
  const loadProfile = useMemo(
    () => getLoadProfile(scenario.loadProfileId, scenario.country),
    [scenario.country, scenario.loadProfileId],
  )

  const activePrices = useMemo(
    () => (resolution === 'quarterhour' && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly),
    [prices.hourly, prices.hourlyQH, resolution],
  )
  const slotHours = resolution === 'quarterhour' && prices.hourlyQH.length > 0 ? 0.25 : 1

  const windowSlots = useMemo(() => {
    if (!prices.selectedDate) return []
    const startIdx = activePrices.findIndex((point) => point.date === prices.selectedDate)
    if (startIdx < 0) return []
    const startTs = activePrices[startIdx].timestamp
    const endTs = startTs + windowHours * 3_600_000
    return activePrices.filter((point) => point.timestamp >= startTs && point.timestamp < endTs)
  }, [activePrices, prices.selectedDate, windowHours])

  const windowResult = useMemo(() => {
    if (windowSlots.length === 0) return null
    if (!profiles.pvProfile || !profiles.loadProfile) return null

    const pvCapKwp = variant.pvCapacityWp / 1000
    const pvKwhPerYear = variant.includePv
      ? pvCapKwp * (scenario.country === 'DE' ? 820 : 730)
      : 0

    const pvPerSlot = new Array<number>(windowSlots.length)
    const loadPerSlot = new Array<number>(windowSlots.length)

    for (let i = 0; i < windowSlots.length; i++) {
      const slotDate = new Date(windowSlots[i].timestamp)
      const yearStart = new Date(slotDate.getFullYear(), 0, 1).getTime()
      const hourIdx = Math.floor((windowSlots[i].timestamp - yearStart) / 3_600_000) % 8760
      pvPerSlot[i] = (profiles.pvProfile[hourIdx] ?? 0) * pvKwhPerYear * slotHours
      loadPerSlot[i] = (profiles.loadProfile[hourIdx] ?? 0) * scenario.annualLoadKwh * slotHours
    }

    return runBatteryDay(windowSlots, pvPerSlot, loadPerSlot, buildParamsFromScenario(scenario), 0)
  }, [profiles.loadProfile, profiles.pvProfile, scenario, slotHours, variant, windowSlots])

  const chartData: ChartPoint[] = useMemo(() => {
    if (!windowResult) return []
    return windowResult.slots.map((slot: SlotResult) => ({
      timestamp: slot.timestamp,
      label: formatSlotLabel(slot.timestamp),
      priceCtKwh: slot.priceCtKwh,
      loadKwh: slot.loadKwh,
      pvKwh: slot.pvKwh,
      chargeKwh: slot.chargeFromGridKwh + slot.chargeFromPvKwh,
      chargeFromGridKwh: slot.chargeFromGridKwh,
      dischargeKwh: slot.dischargeToLoadKwh,
      slotSavingsEur: slot.baselineCostEur - slot.slotCostEur,
      socPct: variant.usableKwh > 0 ? (slot.socKwhEnd / variant.usableKwh) * 100 : 0,
    }))
  }, [variant.usableKwh, windowResult])

  const displayData = useMemo(() => {
    return chartData.map((point) => ({
      ...point,
      chargeLineCtKwh: batteryEnabled && point.chargeKwh > 0 ? point.priceCtKwh : null,
      dischargeLineCtKwh: batteryEnabled && point.dischargeKwh > 0 ? point.priceCtKwh : null,
      visibleSocPct: batteryEnabled ? point.socPct : 0,
    }))
  }, [batteryEnabled, chartData])

  const summary = useMemo(() => {
    if (!windowResult || chartData.length === 0) return null
    const consumptionKwh = chartData.reduce((sum, point) => sum + point.loadKwh, 0)
    const chargeKwh = chartData.reduce((sum, point) => sum + point.chargeKwh, 0)
    const dischargeKwh = chartData.reduce((sum, point) => sum + point.dischargeKwh, 0)
    const baselineAvgCt = consumptionKwh > 0 ? (windowResult.summary.baselineCostEur / consumptionKwh) * 100 : 0
    const batteryAvgCt = consumptionKwh > 0 ? (windowResult.summary.optimizedCostEur / consumptionKwh) * 100 : 0
    return {
      consumptionKwh,
      chargeKwh,
      dischargeKwh,
      savingsEur: windowResult.summary.savingsEur,
      baselineAvgCt,
      batteryAvgCt,
    }
  }, [chartData, windowResult])

  const xAxisInterval = useMemo(
    () => Math.max(0, Math.floor(displayData.length / 8) - 1),
    [displayData.length],
  )
  const showPv = variant.includePv
  const capPerSlotKwh = scenario.feedInCapKw * slotHours

  if (!prices.selectedDate || chartData.length === 0) {
    const msg = profiles.error
      ? `Could not load profile data: ${profiles.error}`
      : profiles.loading || prices.loading
        ? 'Loading…'
        : 'No price data available for this cycle window.'
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
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
              Battery cycle view — {variant.shortLabel}
            </p>
            <p className="text-[12px] text-gray-500 mt-1">
              No feed-in revenue is modeled. The battery only shifts your own household demand across a continuous {windowHours}-hour cycle window.
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              <button
                type="button"
                onClick={() => setWindowHours(24)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  windowHours === 24 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                24h
              </button>
              <button
                type="button"
                onClick={() => setWindowHours(36)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  windowHours === 36 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                36h
              </button>
              <button
                type="button"
                onClick={() => setWindowHours(72)}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  windowHours === 72 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                72h
              </button>
            </div>
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              <button
                type="button"
                onClick={() => setResolution('hour')}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  resolution === 'hour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                60 min
              </button>
              <button
                type="button"
                disabled={prices.hourlyQH.length === 0}
                onClick={() => setResolution('quarterhour')}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  resolution === 'quarterhour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                15 min
              </button>
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
          {batteryEnabled && summary && summary.consumptionKwh > 0 && (
            <div className="absolute left-14 top-1 z-20 pointer-events-none flex items-center gap-1.5">
              <div className={`backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5 ${summary.savingsEur >= 0 ? 'bg-emerald-50/80 border-emerald-300/50' : 'bg-red-50/80 border-red-300/50'}`}>
                <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${summary.savingsEur >= 0 ? 'bg-emerald-500' : 'bg-red-500'}`} />
                <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${summary.savingsEur >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                  {summary.savingsEur >= 0 ? '+' : ''}{summary.savingsEur.toFixed(2)} EUR
                </span>
                <span className={`text-[9px] font-semibold whitespace-nowrap ${summary.savingsEur >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {summary.savingsEur >= 0 ? `saved over ${windowHours}h` : `adds cost over ${windowHours}h`}
                </span>
              </div>
              <span className="text-[9px] text-gray-400 tabular-nums">
                {summary.batteryAvgCt.toFixed(1)} vs {summary.baselineAvgCt.toFixed(1)} ct/kWh
              </span>
            </div>
          )}

          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayData} margin={{ top: 36, right: 48, bottom: 20, left: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                interval={xAxisInterval}
              />
              <YAxis
                yAxisId="left"
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
                tickFormatter={(value) => (typeof value === 'number' ? value.toFixed(2) : String(value))}
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
                tickFormatter={(value) => (typeof value === 'number' ? `${value.toFixed(0)} ct` : String(value))}
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
                strokeOpacity={0.5}
                dot={false}
                isAnimationActive={false}
                name="Day-ahead price"
              />
              <Line
                yAxisId="right"
                type="monotone"
                dataKey="chargeLineCtKwh"
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
                dataKey="dischargeLineCtKwh"
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
                  const point = payload[0].payload as ChartPoint
                  return (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                      <p className="text-gray-500 text-[10px]">{point.label}</p>
                      <p className="tabular-nums text-[#EA1C0A] font-semibold">
                        {point.priceCtKwh.toFixed(1)} ct/kWh
                      </p>
                      <p className="tabular-nums text-gray-600">
                        Household demand: {point.loadKwh.toFixed(3)} kWh
                      </p>
                      <p className="tabular-nums text-slate-600">
                        SoC: {point.socPct.toFixed(0)}%
                      </p>
                      {showPv && (
                        <p className="tabular-nums text-amber-600">
                          PV generation: {point.pvKwh.toFixed(3)} kWh
                        </p>
                      )}
                      {point.chargeKwh > 0 && (
                        <p className="tabular-nums text-blue-600">
                          Battery charging: {point.chargeKwh.toFixed(3)} kWh
                          {point.chargeFromGridKwh > 0 ? ' from grid' : ' from PV'}
                        </p>
                      )}
                      {point.dischargeKwh > 0 && (
                        <p className="tabular-nums text-emerald-600">
                          Battery discharging: {point.dischargeKwh.toFixed(3)} kWh
                        </p>
                      )}
                      <p
                        className={`tabular-nums font-semibold ${
                          point.slotSavingsEur < 0 ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        {point.slotSavingsEur >= 0 ? '+' : ''}
                        {point.slotSavingsEur.toFixed(4)} EUR vs no battery
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
            Profile: {loadProfile.label} · Battery cap {capPerSlotKwh.toFixed(2)} kWh/slot
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
