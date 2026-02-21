'use client'

import { useMemo } from 'react'
import {
  LineChart,
  Line,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine
} from 'recharts'
import { PricePoint } from '@/lib/config'
import { TrendingUp, TrendingDown } from 'lucide-react'
import { format, startOfDay, eachDayOfInterval, differenceInDays } from 'date-fns'
import type { TimeRange } from './TimeRangeSelector'

interface PriceChartProps {
  prices: PricePoint[]
  optimalStart?: string
  optimalEnd?: string
  avgPrice?: number // Average price WITHOUT optimization
  optimizedAvgPrice?: number // Average price WITH optimization
  isLoading?: boolean
  timeRange?: TimeRange
}

export function PriceChart({
  prices,
  optimalStart,
  optimalEnd,
  avgPrice,
  optimizedAvgPrice,
  isLoading,
  timeRange = 'day'
}: PriceChartProps) {
  // Transform and aggregate prices based on time range
  const chartData = useMemo(() => {
    if (prices.length === 0) return []

    // For day view: show hourly data
    if (timeRange === 'day') {
      return prices.map(point => {
        const date = new Date(point.timestamp)
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        return {
          time: `${hours}:${minutes}`,
          timeValue: date,
          price: point.price_ct_kwh,
          fullDate: point.timestamp
        }
      })
    }

    // For longer ranges: aggregate by day
    const dailyPrices = new Map<string, { prices: number[]; date: Date }>()

    prices.forEach(point => {
      const date = new Date(point.timestamp)
      const dayKey = format(date, 'MMM d')
      const dayStart = startOfDay(date)

      if (!dailyPrices.has(dayKey)) {
        dailyPrices.set(dayKey, { prices: [], date: dayStart })
      }
      dailyPrices.get(dayKey)!.prices.push(point.price_ct_kwh)
    })

    return Array.from(dailyPrices.entries())
      .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
      .map(([dayKey, data]) => {
        const avgPrice = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length
        const minPrice = Math.min(...data.prices)
        const maxPrice = Math.max(...data.prices)
        return {
          time: dayKey,
          timeValue: data.date,
          price: avgPrice,
          minPrice,
          maxPrice,
          fullDate: data.date.toISOString()
        }
      })
  }, [prices, timeRange])

  // Calculate optimal zone indices
  const optimalZone = useMemo(() => {
    if (!optimalStart || !optimalEnd || chartData.length === 0) return null

    const startIndex = chartData.findIndex(d => d.time >= optimalStart)
    const endIndex = chartData.findIndex(d => d.time >= optimalEnd)

    if (startIndex === -1 || endIndex === -1) return null

    return { startIndex, endIndex }
  }, [chartData, optimalStart, optimalEnd])

  // Find max price for Y-axis scaling
  const maxPrice = useMemo(() => {
    if (chartData.length === 0) return 50
    const max = Math.max(...chartData.map(d => d.price))
    return Math.max(50, Math.ceil(max / 50) * 50)
  }, [chartData])

  // Find min price for Y-axis scaling
  const minPrice = useMemo(() => {
    if (chartData.length === 0) return 0
    const min = Math.min(...chartData.map(d => d.price))
    return min < 0 ? Math.floor(min / 10) * 10 : 0
  }, [chartData])

  // Calculate savings percentage
  const savingsPercent = useMemo(() => {
    if (!avgPrice || !optimizedAvgPrice) return null
    return ((avgPrice - optimizedAvgPrice) / avgPrice * 100).toFixed(1)
  }, [avgPrice, optimizedAvgPrice])

  if (isLoading) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border bg-muted/20">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-primary border-t-transparent" />
          <p className="mt-2 text-sm text-muted-foreground">Preisdaten werden geladen...</p>
        </div>
      </div>
    )
  }

  if (chartData.length === 0) {
    return (
      <div className="flex h-[400px] items-center justify-center rounded-lg border bg-muted/20">
        <p className="text-muted-foreground">Keine Daten verfügbar</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Comparison Header - only show for day view */}
      {timeRange === 'day' && avgPrice && optimizedAvgPrice && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-gradient-to-r from-slate-50 to-blue-50 p-4 dark:from-slate-900 dark:to-blue-950">
          <div className="flex items-center gap-6">
            {/* Average of time window */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                <span className="text-lg font-bold text-slate-600 dark:text-slate-400">∅</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fenster-Durchschnitt</p>
                <p className="text-lg font-semibold text-slate-600 dark:text-slate-400">
                  {avgPrice.toFixed(2)} ct/kWh
                </p>
              </div>
            </div>

            {/* Arrow */}
            <div className="text-muted-foreground">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>

            {/* Optimized price */}
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <TrendingDown className="h-5 w-5 text-green-600 dark:text-green-400" />
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Optimales Laden</p>
                <p className="text-lg font-semibold text-green-600 dark:text-green-400">
                  {optimizedAvgPrice.toFixed(2)} ct/kWh
                </p>
              </div>
            </div>
          </div>

          {/* Savings Badge */}
          {savingsPercent && (
            <div className="flex items-center gap-2 rounded-full bg-green-500 px-4 py-2 text-white">
              <TrendingDown className="h-4 w-4" />
              <span className="font-semibold">{savingsPercent}% günstiger</span>
            </div>
          )}
        </div>
      )}

      <ResponsiveContainer width="100%" height={400}>
        <LineChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 20 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} />
          <XAxis
            dataKey="time"
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={{ stroke: '#e5e7eb' }}
            interval={timeRange === 'day' ? Math.ceil(chartData.length / 12) :
                       timeRange === 'month' ? Math.ceil(chartData.length / 10) :
                       Math.ceil(chartData.length / 8)}
          />
          <YAxis
            domain={[minPrice, maxPrice]}
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={{ stroke: '#e5e7eb' }}
            label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip content={<CustomTooltip avgPrice={avgPrice} timeRange={timeRange} />} />

          {/* Average price reference line (time window) */}
          {avgPrice && (
            <ReferenceLine
              y={avgPrice}
              stroke="#64748b"
              strokeDasharray="5 5"
              strokeWidth={2}
              label={{
                value: 'Ø Fenster',
                position: 'right',
                fill: '#64748b',
                fontSize: 11
              }}
            />
          )}

          {/* Optimized average price reference line */}
          {optimizedAvgPrice && (
            <ReferenceLine
              y={optimizedAvgPrice}
              stroke="#22c55e"
              strokeDasharray="5 5"
              strokeWidth={2}
              label={{
                value: 'Optimiert',
                position: 'left',
                fill: '#22c55e',
                fontSize: 11
              }}
            />
          )}

          {/* Optimal charging zone (green highlight) - only for day view */}
          {timeRange === 'day' && optimalZone && (
            <ReferenceArea
              x1={chartData[optimalZone.startIndex]?.time}
              x2={chartData[optimalZone.endIndex]?.time}
              fill="#22c55e"
              fillOpacity={0.15}
            />
          )}

          {/* Price line */}
          <Line
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            strokeWidth={timeRange === 'day' ? 3 : 2}
            dot={timeRange === 'day' ? false : chartData.length < 30}
            activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 2 }}
          />

          {/* Gradient fill below line */}
          {timeRange === 'day' && (
            <Area
              type="monotone"
              dataKey="price"
              stroke="#3b82f6"
              fill="url(#priceGradient)"
              fillOpacity={0.3}
            />
          )}
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
          </defs>
        </LineChart>
      </ResponsiveContainer>

      {/* Enhanced Legend */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-12 rounded bg-blue-500" />
          <span className="text-muted-foreground">
            {timeRange === 'day' ? 'Stundlicher Preis' : 'Tagesdurchschnitt'}
          </span>
        </div>
        {timeRange === 'day' && optimalZone && (
          <div className="flex items-center gap-2">
            <div className="h-3 w-12 rounded bg-green-500/25" />
            <span className="text-muted-foreground">Optimales Fenster</span>
          </div>
        )}
        {timeRange === 'day' && avgPrice && (
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-12 border-t-2 border-dashed border-slate-500" />
            <span className="text-muted-foreground">Ø Fenster</span>
          </div>
        )}
        {timeRange === 'day' && optimizedAvgPrice && (
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-12 border-t-2 border-dashed border-green-500" />
            <span className="text-muted-foreground">Optimiert</span>
          </div>
        )}
      </div>
    </div>
  )
}

interface TooltipPayload {
  payload: {
    time: string
    price: number
    minPrice?: number
    maxPrice?: number
  }
}

function CustomTooltip({ active, payload, avgPrice, timeRange }: {
  active?: boolean
  payload?: TooltipPayload[]
  avgPrice?: number
  timeRange?: TimeRange
}) {
  if (!active || !payload?.length) return null

  const data = payload[0].payload
  const price = data.price
  const isCheap = price < 15
  const isExpensive = price > 30
  const vsAverage = avgPrice ? ((price - avgPrice) / avgPrice * 100) : null

  return (
    <div className="rounded-lg border bg-white px-4 py-3 shadow-lg dark:bg-slate-900">
      <p className="text-sm font-medium text-muted-foreground">{data.time}</p>
      <p className="text-2xl font-bold">
        {price.toFixed(2)} ct/kWh
      </p>
      {data.minPrice !== undefined && data.maxPrice !== undefined && (
        <p className="mt-1 text-xs text-muted-foreground">
          Spanne: {data.minPrice.toFixed(1)} - {data.maxPrice.toFixed(1)} ct/kWh
        </p>
      )}
      {timeRange === 'day' && vsAverage !== null && Math.abs(vsAverage) > 5 && (
        <p className={`mt-1 text-xs font-medium ${
          vsAverage < 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          {vsAverage < 0 ? '↓' : '↑'} {Math.abs(vsAverage).toFixed(0)}% vs Durchschnitt
        </p>
      )}
      {timeRange === 'day' && isCheap && (
        <p className="mt-1 text-xs font-medium text-green-600">
          Günstig – Gute Ladezeit!
        </p>
      )}
      {timeRange === 'day' && isExpensive && (
        <p className="mt-1 text-xs font-medium text-red-600">
          Teuer!
        </p>
      )}
    </div>
  )
}
