'use client'

import { useMemo, useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ComposedChart,
  Line,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts'
import { ArrowRight, PiggyBank, Calendar, Zap, TrendingUp } from 'lucide-react'
import { PricePoint, OptimizationResult, ChargingBlock, ConfigState, VEHICLE_PROFILES } from '@/lib/config'
import { getDateRange } from '@/components/charts/TimeRangeSelector'
import type { TimeRange } from '@/components/charts/TimeRangeSelector'
import { format } from 'date-fns'

interface LoadShiftingComparisonProps {
  prices: PricePoint[]
  optimization: OptimizationResult | null
  config: ConfigState
  timeRange: TimeRange
  selectedDate: Date
  isLoading?: boolean
}

interface ShiftDataPoint {
  time: string
  price: number
  baseline: number | null
  optimized: number | null
}

interface BatchDayResult {
  date: string
  cost_baseline_eur: number
  cost_optimized_eur: number
  savings_eur: number
  energy_kwh: number
}

interface BatchResult {
  daily_results: BatchDayResult[]
  totals: {
    total_cost_baseline_eur: number
    total_cost_optimized_eur: number
    total_savings_eur: number
    avg_savings_per_day_eur: number
    days_analyzed: number
    total_energy_kwh: number
  }
}

const RANGE_LABELS: Record<TimeRange, string> = {
  day: 'Day',
  month: 'Month',
  quarter: 'Quarter',
  year: 'Year'
}

function mapScheduleToHours(schedule: ChargingBlock[]): Map<number, number> {
  const map = new Map<number, number>()
  if (!schedule || schedule.length === 0) return map

  schedule.forEach(block => {
    const [startH] = block.start.split(':').map(Number)
    const [endH] = block.end.split(':').map(Number)
    const hours = endH > startH
      ? endH - startH
      : (24 - startH) + endH
    const kwhPerHour = block.kwh / Math.max(hours, 1)

    let h = startH
    for (let i = 0; i < Math.max(hours, 1); i++) {
      map.set(h % 24, (map.get(h % 24) || 0) + kwhPerHour)
      h = (h + 1) % 24
    }
  })
  return map
}

export function LoadShiftingComparison({
  prices,
  optimization,
  config,
  timeRange,
  selectedDate,
  isLoading
}: LoadShiftingComparisonProps) {
  const [batchResults, setBatchResults] = useState<BatchResult | null>(null)
  const [batchLoading, setBatchLoading] = useState(false)

  // Fetch batch data for multi-day views
  useEffect(() => {
    if (timeRange === 'day') {
      setBatchResults(null)
      return
    }

    const fetchBatch = async () => {
      setBatchLoading(true)
      try {
        const { startDate, endDate } = getDateRange(timeRange, selectedDate)
        const vehicle = VEHICLE_PROFILES[config.vehicle]
        const res = await fetch('/api/optimize/batch', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            startDate: format(startDate, 'yyyy-MM-dd'),
            endDate: format(endDate, 'yyyy-MM-dd'),
            vehicle: {
              battery_kwh: vehicle.battery_kwh,
              charge_power_kw: vehicle.charge_power_kw,
              start_level_percent: config.start_level_percent
            },
            config: {
              window_start: config.window_start,
              window_end: config.window_end,
              target_level_percent: 100,
              base_price_ct_kwh: config.base_price_ct_kwh,
              margin_ct_kwh: config.margin_ct_kwh,
              customer_discount_ct_kwh: config.customer_discount_ct_kwh
            },
            dso: config.dso
          })
        })
        if (res.ok) {
          setBatchResults(await res.json())
        }
      } catch {
        // Silently fail - component shows empty state
      } finally {
        setBatchLoading(false)
      }
    }
    fetchBatch()
  }, [timeRange, selectedDate, config])

  // Day view: build shift data from optimization
  const shiftData = useMemo((): ShiftDataPoint[] => {
    if (timeRange !== 'day' || !optimization || prices.length === 0) return []

    const baselineMap = mapScheduleToHours(optimization.baseline_schedule || [])
    const optimizedMap = mapScheduleToHours(optimization.charging_schedule)

    // Build hourly price map
    const hourlyPrices = new Map<number, number>()
    prices.forEach(p => {
      const h = new Date(p.timestamp).getHours()
      if (!hourlyPrices.has(h)) {
        hourlyPrices.set(h, p.price_ct_kwh)
      }
    })

    const data: ShiftDataPoint[] = []
    for (let h = 0; h < 24; h++) {
      data.push({
        time: `${h.toString().padStart(2, '0')}:00`,
        price: hourlyPrices.get(h) || 0,
        baseline: baselineMap.has(h) ? (baselineMap.get(h) || 0) : null,
        optimized: optimizedMap.has(h) ? (optimizedMap.get(h) || 0) : null
      })
    }
    return data
  }, [timeRange, optimization, prices])

  // Derive shift label
  const shiftLabel = useMemo(() => {
    if (!optimization) return null
    const baselineStart = optimization.baseline_schedule?.[0]?.start
    const baselineEnd = optimization.baseline_schedule?.[optimization.baseline_schedule.length - 1]?.end
    const optStart = optimization.charging_schedule?.[0]?.start
    const optEnd = optimization.charging_schedule?.[optimization.charging_schedule.length - 1]?.end

    if (!baselineStart || !optStart) return null
    if (baselineStart === optStart) return null
    return `${baselineStart}\u2013${baselineEnd} \u2192 ${optStart}\u2013${optEnd}`
  }, [optimization])

  // Multi-day chart data
  const multiDayData = useMemo(() => {
    if (!batchResults?.daily_results) return []
    let cumSavings = 0
    return batchResults.daily_results.map(d => {
      cumSavings += d.savings_eur
      return {
        date: d.date,
        dateLabel: format(new Date(d.date), 'MMM d'),
        baseline: d.cost_baseline_eur,
        optimized: d.cost_optimized_eur,
        savings: d.savings_eur,
        cumSavings: Math.round(cumSavings * 100) / 100
      }
    })
  }, [batchResults])

  // Loading state
  if (isLoading || (timeRange !== 'day' && batchLoading)) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-64" />
          <Skeleton className="mt-1 h-4 w-40" />
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[1, 2, 3, 4].map(i => (
              <Skeleton key={i} className="h-20 rounded-lg" />
            ))}
          </div>
          <Skeleton className="h-[300px] rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  // Empty state
  if (timeRange === 'day' && !optimization) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-5 w-5" />
            Baseline vs. Load Shifting
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No optimization data available. Please check configuration.
          </p>
        </CardContent>
      </Card>
    )
  }

  if (timeRange !== 'day' && !batchResults) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Zap className="h-5 w-5" />
            Baseline vs. Load Shifting
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No batch data available for this period.
          </p>
        </CardContent>
      </Card>
    )
  }

  // ========== DAY VIEW ==========
  if (timeRange === 'day' && optimization) {
    const baselineCost = optimization.cost_without_flex_eur
    const optimizedCost = optimization.cost_with_flex_eur
    const savings = optimization.savings_eur
    const maxCost = Math.max(baselineCost, optimizedCost)

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5" />
              Baseline vs. Load Shifting
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {RANGE_LABELS[timeRange]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Comparison: immediate charging vs. price-optimized charging
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Chart */}
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={shiftData} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="baselineGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.2} />
                </linearGradient>
                <linearGradient id="optimizedGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#22c55e" stopOpacity={0.7} />
                  <stop offset="95%" stopColor="#22c55e" stopOpacity={0.2} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
              <XAxis
                dataKey="time"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                interval={2}
              />
              <YAxis
                yAxisId="price"
                orientation="left"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', fontSize: 10 }}
              />
              <YAxis
                yAxisId="kwh"
                orientation="right"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                label={{ value: 'kWh', angle: 90, position: 'insideRight', fontSize: 10 }}
              />
              <Tooltip content={<DayTooltip />} />

              {/* Baseline charging bars */}
              <Bar
                yAxisId="kwh"
                dataKey="baseline"
                fill="url(#baselineGrad)"
                radius={[2, 2, 0, 0]}
                barSize={12}
                name="Baseline"
              >
                {shiftData.map((entry, index) => (
                  <Cell
                    key={`bl-${index}`}
                    fill={entry.baseline !== null ? 'url(#baselineGrad)' : 'transparent'}
                  />
                ))}
              </Bar>

              {/* Optimized charging bars */}
              <Bar
                yAxisId="kwh"
                dataKey="optimized"
                fill="url(#optimizedGrad)"
                radius={[2, 2, 0, 0]}
                barSize={12}
                name="Optimized"
              >
                {shiftData.map((entry, index) => (
                  <Cell
                    key={`op-${index}`}
                    fill={entry.optimized !== null ? 'url(#optimizedGrad)' : 'transparent'}
                  />
                ))}
              </Bar>

              {/* Price line */}
              <Line
                yAxisId="price"
                type="monotone"
                dataKey="price"
                stroke="#3b82f6"
                strokeWidth={2.5}
                dot={false}
                activeDot={{ r: 5, fill: '#3b82f6' }}
                name="Price"
              />
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-blue-500" />
              <span>Electricity Price</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-red-500/60" />
              <span>Baseline (immediate)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-green-500/60" />
              <span>Optimized</span>
            </div>
          </div>

          {/* Shift indicator */}
          {shiftLabel && (
            <div className="flex items-center justify-center gap-2 rounded-lg border border-blue-200/60 bg-blue-50 px-4 py-2 text-sm dark:border-blue-900/60 dark:bg-blue-950/20">
              <ArrowRight className="h-4 w-4 text-blue-600" />
              <span className="text-muted-foreground">Charging shifted:</span>
              <span className="font-semibold text-blue-700 dark:text-blue-400">{shiftLabel}</span>
            </div>
          )}

          {/* Cost comparison bars */}
          <div className="space-y-3">
            <h4 className="text-sm font-semibold">Cost Comparison</h4>

            {/* Baseline bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Baseline (immediate)</span>
                <span className="font-semibold">{baselineCost.toFixed(2)} EUR</span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-full bg-muted/30">
                <div
                  className="flex h-full items-center justify-end rounded-full bg-red-500/70 px-3 text-xs font-medium text-white transition-all duration-700"
                  style={{ width: maxCost > 0 ? `${Math.max((baselineCost / maxCost) * 100, 15)}%` : '0%' }}
                >
                  {baselineCost.toFixed(2)} EUR
                </div>
              </div>
            </div>

            {/* Optimized bar */}
            <div className="space-y-1">
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Optimized (Load Shifting)</span>
                <span className="font-semibold text-green-600">{optimizedCost.toFixed(2)} EUR</span>
              </div>
              <div className="h-6 w-full overflow-hidden rounded-full bg-muted/30">
                <div
                  className="flex h-full items-center justify-end rounded-full bg-green-500/70 px-3 text-xs font-medium text-white transition-all duration-700"
                  style={{ width: maxCost > 0 ? `${Math.max((optimizedCost / maxCost) * 100, 15)}%` : '0%' }}
                >
                  {optimizedCost.toFixed(2)} EUR
                </div>
              </div>
            </div>

            {/* Savings badge */}
            {savings > 0 && (
              <div className="flex justify-end">
                <Badge className="bg-green-600 text-sm text-white hover:bg-green-700">
                  <PiggyBank className="mr-1.5 h-3.5 w-3.5" />
                  Savings: {savings.toFixed(2)} EUR
                </Badge>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    )
  }

  // ========== MULTI-DAY VIEW ==========
  if (timeRange !== 'day' && batchResults) {
    const { totals } = batchResults

    return (
      <Card>
        <CardHeader className="pb-3">
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2 text-base">
              <Zap className="h-5 w-5" />
              Baseline vs. Load Shifting
            </CardTitle>
            <Badge variant="outline" className="text-xs">
              {RANGE_LABELS[timeRange]}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground">
            Aggregated savings from optimized charging
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* KPI Cards */}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-green-200/60 bg-gradient-to-br from-green-50 to-emerald-50 p-3 transition-all duration-200 hover:shadow-md dark:border-green-900/60 dark:from-green-950/20 dark:to-emerald-950/20">
              <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
                <PiggyBank className="h-3.5 w-3.5" />
                Total Saved
              </div>
              <p className="mt-1 text-2xl font-bold text-green-700 dark:text-green-300">
                {totals.total_savings_eur.toFixed(2)} EUR
              </p>
            </div>

            <div className="rounded-lg border border-blue-200/60 bg-gradient-to-br from-blue-50 to-indigo-50 p-3 transition-all duration-200 hover:shadow-md dark:border-blue-900/60 dark:from-blue-950/20 dark:to-indigo-950/20">
              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                <TrendingUp className="h-3.5 w-3.5" />
                Avg. Savings/Day
              </div>
              <p className="mt-1 text-2xl font-bold text-blue-700 dark:text-blue-300">
                {totals.avg_savings_per_day_eur.toFixed(2)} EUR
              </p>
            </div>

            <div className="rounded-lg border border-slate-200/60 bg-gradient-to-br from-slate-50 to-gray-50 p-3 transition-all duration-200 hover:shadow-md dark:border-slate-800/60 dark:from-slate-950/20 dark:to-gray-950/20">
              <div className="flex items-center gap-1.5 text-xs text-slate-600 dark:text-slate-400">
                <Calendar className="h-3.5 w-3.5" />
                Days Analyzed
              </div>
              <p className="mt-1 text-2xl font-bold">{totals.days_analyzed}</p>
            </div>

            <div className="rounded-lg border border-purple-200/60 bg-gradient-to-br from-purple-50 to-violet-50 p-3 transition-all duration-200 hover:shadow-md dark:border-purple-900/60 dark:from-purple-950/20 dark:to-violet-950/20">
              <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
                <Zap className="h-3.5 w-3.5" />
                Total Shifted
              </div>
              <p className="mt-1 text-2xl font-bold text-purple-700 dark:text-purple-300">
                {totals.total_energy_kwh.toFixed(0)} kWh
              </p>
            </div>
          </div>

          {/* Multi-day chart */}
          {multiDayData.length > 0 && (
            <ResponsiveContainer width="100%" height={300}>
              <ComposedChart data={multiDayData} margin={{ top: 10, right: 15, left: 0, bottom: 5 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                  interval={Math.max(0, Math.ceil(multiDayData.length / 10) - 1)}
                />
                <YAxis
                  yAxisId="cost"
                  orientation="left"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                  width={50}
                  label={{ value: 'EUR', angle: -90, position: 'insideLeft', fontSize: 10 }}
                />
                <YAxis
                  yAxisId="cum"
                  orientation="right"
                  tick={{ fill: '#6b7280', fontSize: 11 }}
                  axisLine={{ stroke: '#e5e7eb' }}
                  tickLine={false}
                  width={50}
                  label={{ value: 'EUR cum.', angle: 90, position: 'insideRight', fontSize: 10 }}
                />
                <Tooltip content={<MultiDayTooltip />} />

                {/* Baseline cost bars */}
                <Bar
                  yAxisId="cost"
                  dataKey="baseline"
                  fill="#ef4444"
                  radius={[2, 2, 0, 0]}
                  barSize={8}
                  name="Baseline"
                  opacity={0.7}
                />

                {/* Optimized cost bars */}
                <Bar
                  yAxisId="cost"
                  dataKey="optimized"
                  fill="#22c55e"
                  radius={[2, 2, 0, 0]}
                  barSize={8}
                  name="Optimized"
                  opacity={0.7}
                />

                {/* Cumulative savings line */}
                <Line
                  yAxisId="cum"
                  type="monotone"
                  dataKey="cumSavings"
                  stroke="#3b82f6"
                  strokeWidth={2.5}
                  dot={multiDayData.length < 20}
                  activeDot={{ r: 5, fill: '#3b82f6' }}
                  name="Cumulative Savings"
                />
              </ComposedChart>
            </ResponsiveContainer>
          )}

          {/* Legend */}
          <div className="flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-red-500/70" />
              <span>Baseline Cost</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-green-500/70" />
              <span>Optimized Cost</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-blue-500" />
              <span>Cumulative Savings</span>
            </div>
          </div>
        </CardContent>
      </Card>
    )
  }

  return null
}

// ========== TOOLTIPS ==========

function DayTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: ShiftDataPoint; name: string; color: string }>
}) {
  if (!active || !payload?.length) return null
  const data = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200/60 bg-white/95 px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-900/95">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">{data.time}</p>
      <p className="mt-0.5 text-sm font-semibold text-blue-600">Price: {data.price.toFixed(2)} ct/kWh</p>
      {data.baseline !== null && (
        <p className="text-xs text-red-600">Baseline: {data.baseline.toFixed(1)} kWh</p>
      )}
      {data.optimized !== null && (
        <p className="text-xs text-green-600">Optimized: {data.optimized.toFixed(1)} kWh</p>
      )}
    </div>
  )
}

interface MultiDayChartPoint {
  date: string
  dateLabel: string
  baseline: number
  optimized: number
  savings: number
  cumSavings: number
}

function MultiDayTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: MultiDayChartPoint }>
}) {
  if (!active || !payload?.length) return null
  const data = payload[0].payload

  return (
    <div className="rounded-lg border border-slate-200/60 bg-white/95 px-3 py-2.5 shadow-[var(--shadow-lg)] backdrop-blur-sm dark:border-slate-700/60 dark:bg-slate-900/95">
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {format(new Date(data.date), 'MM/dd/yyyy')}
      </p>
      <div className="mt-1.5 space-y-0.5 text-xs">
        <p className="text-red-600">Baseline: {data.baseline.toFixed(2)} EUR</p>
        <p className="text-green-600">Optimized: {data.optimized.toFixed(2)} EUR</p>
        <p className="border-t border-slate-200/60 pt-1 font-semibold text-blue-600 dark:border-slate-700/60">
          Savings: {data.savings.toFixed(2)} EUR
        </p>
      </div>
    </div>
  )
}
