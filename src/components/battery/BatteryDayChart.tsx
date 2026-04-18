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
import type { BatteryVariant, BatteryLoadProfileOption } from '@/lib/battery-config'
import type {
  BatteryChartPoint,
  BatteryResolution,
  BatteryWindowHours,
  BatteryWindowSummary,
} from '@/lib/use-battery-window'

type ChartMode = 'price' | 'grid'

interface Props {
  chartData: BatteryChartPoint[]
  summary: BatteryWindowSummary | null
  variant: BatteryVariant
  windowHours: BatteryWindowHours
  resolution: BatteryResolution
  setResolution: (value: BatteryResolution) => void
  hasQuarterHour: boolean
  showPv: boolean
  capPerSlotKwh: number
  loadProfile: BatteryLoadProfileOption
  loading: boolean
  profilesError: string | null
  profilesLoading: boolean
  hasPriceData: boolean
  selectedDate: string
}

interface DisplayPoint extends BatteryChartPoint {
  chargeLineCtKwh: number | null
  dischargeLineCtKwh: number | null
  visibleSocPct: number
  visibleGridImport: number
  visibleDischargeToLoad: number
  visiblePvSelf: number
  visibleChargeFromGrid: number
}

export function BatteryDayChart({
  chartData,
  summary,
  variant,
  windowHours,
  resolution,
  setResolution,
  hasQuarterHour,
  showPv,
  capPerSlotKwh,
  loadProfile,
  loading,
  profilesError,
  profilesLoading,
  hasPriceData,
  selectedDate,
}: Props) {
  const [batteryEnabled, setBatteryEnabled] = useState(true)
  const [chartMode, setChartMode] = useState<ChartMode>('price')

  const displayData: DisplayPoint[] = useMemo(() => {
    return chartData.map((point) => ({
      ...point,
      chargeLineCtKwh: batteryEnabled && point.chargeKwh > 0 ? point.priceCtKwh : null,
      dischargeLineCtKwh: batteryEnabled && point.dischargeKwh > 0 ? point.priceCtKwh : null,
      visibleSocPct: batteryEnabled ? point.socPct : 0,
      // Grid-view series: when battery off, collapse load coverage to "all grid"
      visibleGridImport: batteryEnabled ? point.gridImportKwh : point.gridWithoutBatteryKwh,
      visibleDischargeToLoad: batteryEnabled ? point.dischargeToLoadKwh : 0,
      visiblePvSelf: point.pvSelfKwh,
      visibleChargeFromGrid: batteryEnabled ? point.chargeFromGridKwh : 0,
    }))
  }, [batteryEnabled, chartData])

  const xAxisInterval = useMemo(
    () => Math.max(0, Math.floor(displayData.length / 8) - 1),
    [displayData.length],
  )

  if (!selectedDate || chartData.length === 0) {
    const msg = profilesError
      ? `Could not load profile data: ${profilesError}`
      : profilesLoading || loading
        ? 'Loading…'
        : !hasPriceData
          ? 'No price data available for this cycle window.'
          : 'Loading…'
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
              {chartMode === 'price'
                ? `Price + flows view · ${variant.shortLabel}`
                : `Grid draw view · ${variant.shortLabel}`}
            </p>
            <p className="text-[12px] text-gray-500 mt-1">
              {chartMode === 'price'
                ? 'Blue markers on the price line show grid charging; green markers show battery discharging to the household.'
                : 'Stacked by who serves the load: grid (gray), battery discharge (green), PV (amber). Blue on top is extra grid drawn to charge the battery.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center justify-end gap-1">
            {/* View mode */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              <button
                type="button"
                onClick={() => setChartMode('price')}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  chartMode === 'price' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Price view
              </button>
              <button
                type="button"
                onClick={() => setChartMode('grid')}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  chartMode === 'grid' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                }`}
              >
                Grid view
              </button>
            </div>
            {/* Resolution */}
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
                disabled={!hasQuarterHour}
                onClick={() => setResolution('quarterhour')}
                className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                  resolution === 'quarterhour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                } disabled:opacity-30 disabled:cursor-not-allowed`}
              >
                15 min
              </button>
            </div>
            {/* Battery on/off */}
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

      <CardContent className={`pt-4 ${loading ? 'animate-pulse' : ''}`}>
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

        <div className="relative h-[320px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={displayData} margin={{ top: 24, right: 48, bottom: 20, left: 20 }}>
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

              {chartMode === 'price' ? (
                <>
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
                </>
              ) : (
                <>
                  {/* Grid-view stack (bottom → top): grid→load, battery→load, PV→load, grid→battery */}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="visibleGridImport"
                    stackId="flow"
                    fill="#9CA3AF"
                    fillOpacity={0.65}
                    stroke="#6B7280"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                    name="Grid → load"
                  />
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="visibleDischargeToLoad"
                    stackId="flow"
                    fill="#10B981"
                    fillOpacity={0.7}
                    stroke="#059669"
                    strokeWidth={1}
                    dot={false}
                    isAnimationActive={false}
                    name="Battery → load"
                  />
                  {showPv && (
                    <Area
                      yAxisId="left"
                      type="monotone"
                      dataKey="visiblePvSelf"
                      stackId="flow"
                      fill="#FCD34D"
                      fillOpacity={0.75}
                      stroke="#F59E0B"
                      strokeWidth={1}
                      dot={false}
                      isAnimationActive={false}
                      name="PV → load"
                    />
                  )}
                  <Area
                    yAxisId="left"
                    type="monotone"
                    dataKey="visibleChargeFromGrid"
                    stackId="flow"
                    fill="#3B82F6"
                    fillOpacity={0.55}
                    stroke="#2563EB"
                    strokeWidth={1}
                    strokeDasharray="3 2"
                    dot={false}
                    isAnimationActive={false}
                    name="Grid → battery"
                  />
                  {/* Demand reference line (stays where it would be without battery) */}
                  <Line
                    yAxisId="left"
                    type="monotone"
                    dataKey="loadKwh"
                    stroke="#4B5563"
                    strokeWidth={1.25}
                    strokeDasharray="4 3"
                    dot={false}
                    isAnimationActive={false}
                    name="Household demand"
                  />
                  {/* Price on right axis */}
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
                </>
              )}

              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const point = payload[0].payload as BatteryChartPoint
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
                      {point.gridImportKwh > 0 && (
                        <p className="tabular-nums text-gray-700">
                          Grid → load: {point.gridImportKwh.toFixed(3)} kWh
                        </p>
                      )}
                      {point.dischargeToLoadKwh > 0 && (
                        <p className="tabular-nums text-emerald-600">
                          Battery → load: {point.dischargeToLoadKwh.toFixed(3)} kWh
                        </p>
                      )}
                      {point.chargeFromGridKwh > 0 && (
                        <p className="tabular-nums text-blue-600">
                          Grid → battery: {point.chargeFromGridKwh.toFixed(3)} kWh
                        </p>
                      )}
                      {point.chargeFromPvKwh > 0 && (
                        <p className="tabular-nums text-amber-700">
                          PV → battery: {point.chargeFromPvKwh.toFixed(3)} kWh
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
          {chartMode === 'price' ? (
            <>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#E5E7EB' }} />
                Household demand unchanged
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#2563EB' }} />
                Battery charging
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#10B981' }} />
                Battery discharging
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#EA1C0A' }} />
                Day-ahead price
              </span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#9CA3AF' }} />
                Grid → load
              </span>
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#10B981' }} />
                Battery → load
              </span>
              {showPv && (
                <span className="flex items-center gap-1">
                  <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#FCD34D' }} />
                  PV → load
                </span>
              )}
              <span className="flex items-center gap-1">
                <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#3B82F6', opacity: 0.65 }} />
                Grid → battery
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 inline-block border-t border-dashed" style={{ borderColor: '#4B5563' }} />
                Household demand
              </span>
              <span className="flex items-center gap-1">
                <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#EA1C0A' }} />
                Day-ahead price
              </span>
            </>
          )}
          <span className="text-gray-400">
            Profile: {loadProfile.label} · Battery cap {capPerSlotKwh.toFixed(2)} kWh/slot · {summary?.fullCycles.toFixed(2) ?? '0.00'} full cycles in {windowHours}h
          </span>
        </div>
      </CardContent>
    </Card>
  )
}
