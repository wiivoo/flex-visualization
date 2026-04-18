'use client'

import { useMemo } from 'react'
import {
  ComposedChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  LabelList,
} from 'recharts'
import type { YoyDatum } from '@/lib/management-config'

/**
 * Management Dashboard — Year-over-year grouped bar chart (PROJ-40).
 *
 * Two Bar series per month:
 *   - yearA (prior) → muted gray `#9CA3AF`
 *   - yearB (current) → brand red `#EA1C0A`
 *
 * Δ% labels render above yearB bars: `+12.3%` in emerald when positive,
 * `−4.1%` in red when negative, muted when zero.
 *
 * Spec: features/PROJ-40-management-dashboard.md (Month-on-Month Change Panel).
 */

interface YoyBarChartProps {
  /** One entry per month (Jan..Dec). Fewer than 12 entries render as-is. */
  data: YoyDatum[]
  /** Label for the prior-year series (e.g. "2025"). */
  yearALabel: string
  /** Label for the current-year series (e.g. "2026"). */
  yearBLabel: string
  /** Chart body height in pixels. Defaults to 220. */
  height?: number
}

const MONTH_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

interface ChartRow {
  monthShort: string
  valueA: number
  valueB: number
  deltaPct: number | null
}

const EUR_FMT = new Intl.NumberFormat('de-DE', {
  style: 'currency',
  currency: 'EUR',
  maximumFractionDigits: 0,
})

const YAXIS_FMT = new Intl.NumberFormat('de-DE', { maximumFractionDigits: 0 })

// Recharts passes (x, y, width, value, ...) via LabelList content prop. Typed
// loosely because Recharts' Label prop type accepts string | number for value.
interface DeltaLabelProps {
  x?: number | string
  y?: number | string
  width?: number | string
  value?: number | string | null
}

function DeltaLabel(props: DeltaLabelProps) {
  const { x, y, width, value } = props
  if (value === null || value === undefined) return null
  const numeric = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(numeric)) return null
  const cx = Number(x) + Number(width) / 2
  const cy = Number(y) - 6
  if (!Number.isFinite(cx) || !Number.isFinite(cy)) return null

  const v = numeric
  let color = '#6B7280' // muted gray for zero
  let prefix = ''
  if (v > 0) {
    color = '#059669' // emerald-600
    prefix = '+'
  } else if (v < 0) {
    color = '#DC2626' // red-600
    prefix = '\u2212' // en-dash minus (U+2212)
  }

  const abs = Math.abs(v).toFixed(1)
  return (
    <text
      x={cx}
      y={cy}
      fill={color}
      fontSize={10}
      textAnchor="middle"
      className="tabular-nums"
    >
      {`${prefix}${abs}%`}
    </text>
  )
}

interface TooltipEntryPayload {
  monthShort: string
  valueA: number
  valueB: number
  deltaPct: number | null
}

interface CustomTooltipProps {
  active?: boolean
  payload?: Array<{ payload: TooltipEntryPayload }>
  yearALabel: string
  yearBLabel: string
}

function CustomTooltip({ active, payload, yearALabel, yearBLabel }: CustomTooltipProps) {
  if (!active || !payload || payload.length === 0) return null
  const d = payload[0].payload
  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] tabular-nums space-y-0.5">
      <p className="text-gray-500 text-[10px] font-medium">{d.monthShort}</p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-sm bg-gray-400" />
        <span className="text-gray-500">{yearALabel}</span>
        <span className="ml-auto font-semibold text-gray-700">{EUR_FMT.format(d.valueA)}</span>
      </p>
      <p className="flex items-center gap-2">
        <span className="inline-block w-2 h-2 rounded-sm" style={{ backgroundColor: '#EA1C0A' }} />
        <span className="text-gray-500">{yearBLabel}</span>
        <span className="ml-auto font-semibold" style={{ color: '#EA1C0A' }}>{EUR_FMT.format(d.valueB)}</span>
      </p>
      {d.deltaPct !== null && d.deltaPct !== undefined && Number.isFinite(d.deltaPct) ? (
        <p className="text-gray-500 pt-0.5 border-t border-gray-100">
          Δ {d.deltaPct > 0 ? '+' : d.deltaPct < 0 ? '\u2212' : ''}
          {Math.abs(d.deltaPct).toFixed(1)}%
        </p>
      ) : null}
    </div>
  )
}

export const YoyBarChart = ({
  data,
  yearALabel,
  yearBLabel,
  height = 220,
}: YoyBarChartProps) => {
  const rows: ChartRow[] = useMemo(() => {
    if (!data || data.length === 0) return []
    return data.map((d) => {
      // monthKey is "YYYY-MM"; map to short label via month number.
      const monthNum = parseInt(d.monthKey.slice(5, 7), 10)
      const monthShort = MONTH_SHORT[(monthNum - 1) % 12] ?? d.monthKey.slice(5, 7)
      return {
        monthShort,
        valueA: Number.isFinite(d.valueA) ? d.valueA : 0,
        valueB: Number.isFinite(d.valueB) ? d.valueB : 0,
        deltaPct: d.deltaPct,
      }
    })
  }, [data])

  if (rows.length === 0) {
    return (
      <div className="flex items-center justify-center h-[220px] text-sm text-muted-foreground">
        No year-over-year data
      </div>
    )
  }

  return (
    <div className="flex flex-col">
      <div style={{ width: '100%', height }}>
        <ResponsiveContainer width="100%" height={height}>
          <ComposedChart data={rows} margin={{ top: 20, right: 16, bottom: 4, left: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
            <XAxis
              dataKey="monthShort"
              tick={{ fontSize: 10, fill: '#6B7280' }}
              tickLine={false}
              axisLine={false}
            />
            <YAxis
              tick={{ fontSize: 10, fill: '#9CA3AF' }}
              tickFormatter={(v: number) => YAXIS_FMT.format(v)}
              tickLine={false}
              axisLine={false}
              label={{
                value: 'EUR',
                angle: -90,
                position: 'insideLeft',
                style: { fontSize: 10, fill: '#9CA3AF' },
              }}
            />
            <Tooltip
              content={(props: unknown) => (
                <CustomTooltip
                  {...(props as CustomTooltipProps)}
                  yearALabel={yearALabel}
                  yearBLabel={yearBLabel}
                />
              )}
            />
            <Bar
              dataKey="valueA"
              name={yearALabel}
              fill="#9CA3AF"
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
            />
            <Bar
              dataKey="valueB"
              name={yearBLabel}
              fill="#EA1C0A"
              radius={[3, 3, 0, 0]}
              maxBarSize={18}
            >
              {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
              <LabelList dataKey="deltaPct" content={DeltaLabel as any} />
            </Bar>
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="flex items-center gap-3 mt-1">
        <span className="flex items-center gap-1 text-[10px] text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#9CA3AF' }} />
          {yearALabel}
        </span>
        <span className="flex items-center gap-1 text-[10px] text-gray-500">
          <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#EA1C0A' }} />
          {yearBLabel}
        </span>
      </div>
    </div>
  )
}
