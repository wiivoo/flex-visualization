'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import {
  ComposedChart,
  Line,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceDot,
  ReferenceLine,
  CartesianGrid,
  Label,
} from 'recharts'
import { computeElasticity, type SensitivitySeries, type SweepPoint, type PinnedDefaults } from '@/lib/insights-sweep'
import type { HourlyPrice } from '@/lib/v2-config'

interface Props {
  series: SensitivitySeries
  mode: 'single' | 'fleet'
  fleetSize: number
  hourlyQH: HourlyPrice[]
  pinned: PinnedDefaults
}

async function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

interface ChartProps {
  title: string
  subtitle: string
  data: SweepPoint[]
  pinnedX: number
  xLabel: string
  formatX: (v: number) => string
  unitLabel: string
  elasticityScale?: number
  actionVerb: string
}

function SensitivityChart({
  title,
  subtitle,
  data,
  pinnedX,
  xLabel,
  formatX,
  unitLabel,
  elasticityScale = 1,
  actionVerb,
}: ChartProps) {
  // Pinned point — exact match or nearest neighbour fallback.
  const pinnedPoint = useMemo(() => {
    if (data.length === 0) return undefined
    const exact = data.find(d => Math.abs(d.x - pinnedX) < 0.001)
    if (exact) return exact
    let best = data[0]
    let bestDist = Math.abs(best.x - pinnedX)
    for (const d of data) {
      const dist = Math.abs(d.x - pinnedX)
      if (dist < bestDist) {
        best = d
        bestDist = dist
      }
    }
    return best
  }, [data, pinnedX])

  const pinnedY = pinnedPoint?.yearlySavingsEur ?? 0
  const optimum = useMemo(
    () => data.reduce((a, b) => (b.yearlySavingsEur > a.yearlySavingsEur ? b : a), data[0]),
    [data],
  )
  const optimumDelta = (optimum?.yearlySavingsEur ?? 0) - pinnedY
  const slope = useMemo(() => computeElasticity(data, pinnedX), [data, pinnedX])

  const max = Math.max(...data.map(d => d.yearlySavingsEur))
  const min = Math.min(...data.map(d => d.yearlySavingsEur))
  const delta = max - min

  const yMin = Math.min(min, pinnedY) * 0.98
  const yMax = Math.max(max, pinnedY) * 1.02

  const chartData = useMemo(
    () =>
      data.map(d => ({
        ...d,
        gain: d.yearlySavingsEur >= pinnedY ? d.yearlySavingsEur : pinnedY,
        loss: d.yearlySavingsEur < pinnedY ? d.yearlySavingsEur : pinnedY,
      })),
    [data, pinnedY],
  )

  const scaledSlope = Math.round(slope * elasticityScale)
  const elasticityText =
    Math.abs(slope * elasticityScale) < 0.5
      ? `~€0/yr per ${unitLabel}`
      : `€${scaledSlope}/yr per ${unitLabel}`

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <CardTitle className="text-[13px] font-bold text-[#313131]">{title}</CardTitle>
        <p className="text-[10px] text-gray-500 mt-0.5">{subtitle}</p>
      </CardHeader>
      <CardContent className="pt-3 pb-3">
        <div style={{ height: 140 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 14, right: 12, left: -8, bottom: 4 }}>
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
                domain={[yMin, yMax]}
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
              <Area
                type="monotone"
                dataKey="gain"
                stroke="none"
                fill="#10b981"
                fillOpacity={0.14}
                baseValue={pinnedY}
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="loss"
                stroke="none"
                fill="#EA1C0A"
                fillOpacity={0.10}
                baseValue={pinnedY}
                isAnimationActive={false}
              />
              <ReferenceLine
                y={pinnedY}
                stroke="#9ca3af"
                strokeDasharray="3 3"
                strokeWidth={1}
              />
              <Line
                type="monotone"
                dataKey="yearlySavingsEur"
                stroke="#10b981"
                strokeWidth={2}
                dot={{ r: 2, fill: '#10b981' }}
                activeDot={{ r: 4 }}
                isAnimationActive={false}
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
              {optimum && optimumDelta > 0.5 && (
                <ReferenceDot
                  x={optimum.x}
                  y={optimum.yearlySavingsEur}
                  r={4}
                  fill="#059669"
                  stroke="#fff"
                  strokeWidth={2}
                >
                  <Label
                    value={`+€${Math.round(optimumDelta)}/yr`}
                    position="top"
                    fontSize={10}
                    fill="#059669"
                    fontWeight={600}
                  />
                </ReferenceDot>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        <div className="flex items-center justify-between text-[10px] text-gray-500 mt-1 px-1">
          <span>Range: €{min.toFixed(0)} – €{max.toFixed(0)}/yr</span>
          <span className="tabular-nums">
            Lever: <span className="font-semibold text-gray-700">€{delta.toFixed(0)}/yr</span>
          </span>
        </div>
        <div className="text-[10px] text-gray-500 tabular-nums px-1 mt-0.5">
          Elasticity: <span className="font-semibold text-gray-700">{elasticityText}</span>
        </div>
        {optimum && optimumDelta > 0.5 ? (
          <div className="text-[11px] text-emerald-700 font-medium mt-1 px-1">
            {actionVerb} {formatX(pinnedX)} → {formatX(optimum.x)} to gain €{Math.round(optimumDelta)}/yr
          </div>
        ) : (
          <div className="text-[11px] text-gray-500 mt-1 px-1">
            Already at the optimum for this lever
          </div>
        )}
      </CardContent>
    </Card>
  )
}

export function SensitivityCurves({ series, mode, fleetSize, hourlyQH, pinned: exportPinned }: Props) {
  const { pinned } = series
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      const { exportSensitivityXlsx } = await import('@/lib/excel-exports/sensitivity')
      const { blob, filename } = await exportSensitivityXlsx(hourlyQH, exportPinned)
      await triggerDownload(blob, filename)
      toast.success('Excel exported')
    } catch (e) {
      toast.error('Export failed: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">Sensitivity — which lever moves savings most</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
              {mode === 'fleet' ? `EUR/yr · ${fleetSize.toLocaleString()} vehicles` : 'EUR/yr per parameter'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={handleExport}
              className="h-7 px-2 text-[11px] text-gray-500 hover:text-[#313131]">
              <Download className="w-3.5 h-3.5 mr-1" />
              {busy ? 'Exporting…' : 'Export'}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Each chart varies one parameter; the others stay pinned at{' '}
          <span className="font-semibold text-gray-700 tabular-nums">
            {(pinned.yearlyMileageKm / 1000).toFixed(0)}k km/yr
          </span>,{' '}
          <span className="font-semibold text-gray-700 tabular-nums">
            {String(pinned.plugInTime).padStart(2, '0')}:00
          </span>{' '}plug-in,{' '}
          <span className="font-semibold text-gray-700 tabular-nums">
            {pinned.windowLengthHours}h window
          </span>,{' '}
          <span className="font-semibold text-gray-700 tabular-nums">
            {pinned.chargePowerKw} kW
          </span>. Red dot = current; dashed line = baseline; green area = gain, red area = loss; emerald dot = optimum. · {series.rangeLabel}
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <SensitivityChart
          title="Mileage"
          subtitle="How yearly savings scale with annual driving distance"
          data={series.mileage}
          pinnedX={pinned.yearlyMileageKm}
          xLabel="km/yr"
          formatX={(v) => `${(v / 1000).toFixed(0)}k`}
          unitLabel="1k km"
          elasticityScale={1000}
          actionVerb="Raise mileage"
        />
        <SensitivityChart
          title="Plug-in time"
          subtitle="When the EV plugs in (window length stays the same)"
          data={series.plugInTime}
          pinnedX={pinned.plugInTime}
          xLabel="hour"
          formatX={(v) => `${String(v).padStart(2, '0')}:00`}
          unitLabel="hour"
          actionVerb="Shift plug-in"
        />
        <SensitivityChart
          title="Plug-in window length"
          subtitle="Hours from plug-in to departure — the flexibility lever"
          data={series.windowLength}
          pinnedX={pinned.windowLengthHours}
          xLabel="hours"
          formatX={(v) => `${v}h`}
          unitLabel="hour of window"
          actionVerb="Extend window"
        />
        <SensitivityChart
          title="Charge power"
          subtitle="Wallbox capacity — fewer slots needed at higher kW"
          data={series.chargePower}
          pinnedX={pinned.chargePowerKw}
          xLabel="kW"
          formatX={(v) => `${v}`}
          unitLabel="kW"
          actionVerb="Upgrade power"
        />
        </div>
      </CardContent>
    </Card>
  )
}
