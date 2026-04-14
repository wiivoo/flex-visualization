'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, ReferenceDot, CartesianGrid } from 'recharts'
import type { SensitivitySeries, SweepPoint } from '@/lib/insights-sweep'

interface Props {
  series: SensitivitySeries
}

interface ChartProps {
  title: string
  subtitle: string
  data: SweepPoint[]
  pinnedX: number
  xLabel: string
  formatX: (v: number) => string
}

function SensitivityChart({ title, subtitle, data, pinnedX, xLabel, formatX }: ChartProps) {
  const pinnedPoint = data.find(d => Math.abs(d.x - pinnedX) < 0.001)
  const max = Math.max(...data.map(d => d.yearlySavingsEur))
  const min = Math.min(...data.map(d => d.yearlySavingsEur))
  const delta = max - min

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <CardTitle className="text-[13px] font-bold text-[#313131]">{title}</CardTitle>
        <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent className="pt-3 pb-3">
        <div style={{ height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <LineChart data={data} margin={{ top: 8, right: 12, left: -8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="2 4" stroke="#f3f4f6" vertical={false} />
              <XAxis
                dataKey="x"
                tickFormatter={formatX}
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                label={{ value: xLabel, position: 'insideBottom', offset: -2, fontSize: 9, fill: '#9ca3af' }}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9ca3af' }}
                axisLine={false}
                tickLine={false}
                width={40}
                tickFormatter={(v) => `€${Math.round(v)}`}
              />
              <Tooltip
                contentStyle={{ fontSize: 11, borderRadius: 6, border: '1px solid #e5e7eb' }}
                formatter={(value) => [`€${Number(value).toFixed(0)}/yr`, 'Savings']}
                labelFormatter={(label) => `${xLabel}: ${formatX(Number(label))}`}
              />
              <Line
                type="monotone"
                dataKey="yearlySavingsEur"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 2.5, fill: '#10b981' }}
                activeDot={{ r: 4 }}
              />
              {pinnedPoint && (
                <ReferenceDot
                  x={pinnedPoint.x}
                  y={pinnedPoint.yearlySavingsEur}
                  r={5}
                  fill="#EA1C0A"
                  stroke="#fff"
                  strokeWidth={2}
                />
              )}
            </LineChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1 px-1">
          <span>Range: €{min.toFixed(0)} – €{max.toFixed(0)}/yr</span>
          <span className="tabular-nums">
            Lever: <span className="font-semibold text-gray-700">€{delta.toFixed(0)}/yr</span>
          </span>
        </div>
      </CardContent>
    </Card>
  )
}

export function SensitivityCurves({ series }: Props) {
  const { pinned } = series

  return (
    <div className="space-y-4">
      <div className="px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-200">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-gray-500">Pinned defaults</div>
        <div className="text-[11px] text-gray-700 mt-0.5 tabular-nums">
          {pinned.yearlyMileageKm.toLocaleString()} km/yr · plug-in {String(pinned.plugInTime).padStart(2, '0')}:00 ·{' '}
          {pinned.windowLengthHours}h window · {pinned.chargePowerKw} kW · {pinned.plugInsPerWeek}× / week
        </div>
        <div className="text-[10px] text-gray-400 mt-1 italic">
          Each chart varies one parameter; the others stay fixed at the values above. Red dot marks the pinned value.
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SensitivityChart
          title="Mileage"
          subtitle="How yearly savings scale with annual driving distance"
          data={series.mileage}
          pinnedX={pinned.yearlyMileageKm}
          xLabel="km/yr"
          formatX={(v) => `${(v / 1000).toFixed(0)}k`}
        />
        <SensitivityChart
          title="Plug-in time"
          subtitle="When the EV plugs in (window length stays the same)"
          data={series.plugInTime}
          pinnedX={pinned.plugInTime}
          xLabel="hour"
          formatX={(v) => `${String(v).padStart(2, '0')}:00`}
        />
        <SensitivityChart
          title="Plug-in window length"
          subtitle="Hours from plug-in to departure — the flexibility lever"
          data={series.windowLength}
          pinnedX={pinned.windowLengthHours}
          xLabel="hours"
          formatX={(v) => `${v}h`}
        />
        <SensitivityChart
          title="Charge power"
          subtitle="Wallbox capacity — fewer slots needed at higher kW"
          data={series.chargePower}
          pinnedX={pinned.chargePowerKw}
          xLabel="kW"
          formatX={(v) => `${v}`}
        />
      </div>
    </div>
  )
}
