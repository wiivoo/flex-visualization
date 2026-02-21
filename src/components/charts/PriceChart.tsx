'use client'

import { useMemo, useState } from 'react'
import {
  ComposedChart,
  Line,
  Area,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
  Brush,
  Cell
} from 'recharts'
import { PricePoint, ChargingBlock } from '@/lib/config'
import { TrendingDown } from 'lucide-react'
import { format, startOfDay } from 'date-fns'
import { de } from 'date-fns/locale'
import type { TimeRange } from './TimeRangeSelector'

interface PriceChartProps {
  prices: PricePoint[]
  optimalStart?: string
  optimalEnd?: string
  avgPrice?: number
  optimizedAvgPrice?: number
  chargingSchedule?: ChargingBlock[]
  isLoading?: boolean
  timeRange?: TimeRange
  onDataPointClick?: (dataPoint: ChartDataPoint) => void
}

export interface ChartDataPoint {
  time: string
  timeValue: Date
  price: number
  fullDate: string
  isCharging?: boolean
  chargingKwh?: number
  minPrice?: number
  maxPrice?: number
}

export function PriceChart({
  prices,
  optimalStart,
  optimalEnd,
  avgPrice,
  optimizedAvgPrice,
  chargingSchedule,
  isLoading,
  timeRange = 'day',
  onDataPointClick
}: PriceChartProps) {
  const [selectedPoint, setSelectedPoint] = useState<ChartDataPoint | null>(null)

  // Build a set of charging hours for overlay
  const chargingHours = useMemo(() => {
    if (!chargingSchedule || chargingSchedule.length === 0) return new Map<string, number>()
    const map = new Map<string, number>()
    chargingSchedule.forEach(block => {
      const [startH, startM] = block.start.split(':').map(Number)
      const [endH, endM] = block.end.split(':').map(Number)
      // Walk through 15-min intervals
      let h = startH
      let m = startM
      const kwhPerInterval = block.kwh / (
        ((endH * 60 + endM) - (startH * 60 + startM) + (endH < startH ? 24 * 60 : 0)) / 15
      )
      while (!(h === endH && m === endM)) {
        const key = `${h.toString().padStart(2, '0')}:${m.toString().padStart(2, '0')}`
        map.set(key, (map.get(key) || 0) + kwhPerInterval)
        m += 15
        if (m >= 60) { m = 0; h = (h + 1) % 24 }
        // Safety: break after 96 iterations (24h of 15-min)
        if (map.size > 96) break
      }
    })
    return map
  }, [chargingSchedule])

  // Transform and aggregate prices based on time range
  const chartData = useMemo(() => {
    if (prices.length === 0) return []

    if (timeRange === 'day') {
      return prices.map(point => {
        const date = new Date(point.timestamp)
        const hours = date.getHours().toString().padStart(2, '0')
        const minutes = date.getMinutes().toString().padStart(2, '0')
        const timeKey = `${hours}:${minutes}`
        const chargingKwh = chargingHours.get(timeKey) || 0
        return {
          time: timeKey,
          timeValue: date,
          price: point.price_ct_kwh,
          fullDate: point.timestamp,
          isCharging: chargingKwh > 0,
          chargingKwh,
          // Use price as bar height for charging overlay
          chargingBar: chargingKwh > 0 ? point.price_ct_kwh : 0
        }
      })
    }

    // For longer ranges: aggregate by day
    const dailyPrices = new Map<string, { prices: number[]; date: Date }>()

    prices.forEach(point => {
      const date = new Date(point.timestamp)
      const dayKey = format(date, 'd. MMM', { locale: de })
      const dayStart = startOfDay(date)

      if (!dailyPrices.has(dayKey)) {
        dailyPrices.set(dayKey, { prices: [], date: dayStart })
      }
      dailyPrices.get(dayKey)!.prices.push(point.price_ct_kwh)
    })

    return Array.from(dailyPrices.entries())
      .sort((a, b) => a[1].date.getTime() - b[1].date.getTime())
      .map(([dayKey, data]) => {
        const avg = data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length
        const minP = Math.min(...data.prices)
        const maxP = Math.max(...data.prices)
        return {
          time: dayKey,
          timeValue: data.date,
          price: avg,
          minPrice: minP,
          maxPrice: maxP,
          fullDate: data.date.toISOString(),
          isCharging: false,
          chargingKwh: 0,
          chargingBar: 0
        }
      })
  }, [prices, timeRange, chargingHours])

  // Calculate optimal zone indices
  const optimalZone = useMemo(() => {
    if (!optimalStart || !optimalEnd || chartData.length === 0) return null

    const startIndex = chartData.findIndex(d => d.time >= optimalStart)
    const endIndex = chartData.findIndex(d => d.time >= optimalEnd)

    if (startIndex === -1 || endIndex === -1) return null

    return { startIndex, endIndex }
  }, [chartData, optimalStart, optimalEnd])

  // Fix Y-axis scaling: use actual data range with 10-20% padding
  const yAxisDomain = useMemo(() => {
    if (chartData.length === 0) return [0, 20]
    const allPrices = chartData.map(d => d.price)
    const dataMin = Math.min(...allPrices)
    const dataMax = Math.max(...allPrices)
    const range = dataMax - dataMin
    const padding = Math.max(range * 0.15, 1) // at least 1 ct padding

    const yMin = dataMin < 0 ? Math.floor((dataMin - padding) / 5) * 5 : Math.max(0, Math.floor((dataMin - padding) / 5) * 5)
    const yMax = Math.ceil((dataMax + padding) / 5) * 5

    return [yMin, yMax]
  }, [chartData])

  // Find cheapest and most expensive hours for annotations
  const priceAnnotations = useMemo(() => {
    if (timeRange !== 'day' || chartData.length === 0) return { cheapest: null, expensive: null }

    // Only look at unique hourly prices (skip 15-min duplicates)
    const hourly = new Map<number, { time: string; price: number }>()
    chartData.forEach(d => {
      const hour = d.timeValue.getHours()
      if (!hourly.has(hour) || d.price < hourly.get(hour)!.price) {
        hourly.set(hour, { time: d.time, price: d.price })
      }
    })

    const sorted = Array.from(hourly.values()).sort((a, b) => a.price - b.price)
    if (sorted.length < 2) return { cheapest: null, expensive: null }

    return {
      cheapest: sorted[0],
      expensive: sorted[sorted.length - 1]
    }
  }, [chartData, timeRange])

  // Calculate savings percentage
  const savingsPercent = useMemo(() => {
    if (!avgPrice || !optimizedAvgPrice) return null
    return ((avgPrice - optimizedAvgPrice) / avgPrice * 100).toFixed(1)
  }, [avgPrice, optimizedAvgPrice])

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleChartClick = (data: any) => {
    if (data?.activePayload?.[0]?.payload) {
      const point = data.activePayload[0].payload as ChartDataPoint
      setSelectedPoint(point)
      onDataPointClick?.(point)
    }
  }

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
        <p className="text-muted-foreground">Keine Daten verfuegbar</p>
      </div>
    )
  }

  return (
    <div className="w-full">
      {/* Comparison Header - only show for day view */}
      {timeRange === 'day' && avgPrice && optimizedAvgPrice && (
        <div className="mb-4 flex flex-wrap items-center justify-between gap-4 rounded-lg border bg-gradient-to-r from-slate-50 to-blue-50 p-4 dark:from-slate-900 dark:to-blue-950">
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                <span className="text-lg font-bold text-slate-600 dark:text-slate-400">O/</span>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Fenster-Durchschnitt</p>
                <p className="text-lg font-semibold text-slate-600 dark:text-slate-400">
                  {avgPrice.toFixed(2)} ct/kWh
                </p>
              </div>
            </div>

            <div className="text-muted-foreground">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>

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

          {savingsPercent && (
            <div className="flex items-center gap-2 rounded-full bg-green-500 px-4 py-2 text-white">
              <TrendingDown className="h-4 w-4" />
              <span className="font-semibold">{savingsPercent}% guenstiger</span>
            </div>
          )}
        </div>
      )}

      {/* Selected point detail panel */}
      {selectedPoint && timeRange === 'day' && (
        <div className="mb-3 flex items-center justify-between rounded-lg border border-blue-200 bg-blue-50 px-4 py-2 dark:border-blue-800 dark:bg-blue-950/30">
          <div className="flex items-center gap-4 text-sm">
            <span className="font-medium">{selectedPoint.time} Uhr</span>
            <span className="text-lg font-bold">{selectedPoint.price.toFixed(2)} ct/kWh</span>
            {selectedPoint.isCharging && (
              <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700 dark:bg-green-900/30 dark:text-green-400">
                Laden aktiv ({selectedPoint.chargingKwh?.toFixed(1)} kWh)
              </span>
            )}
          </div>
          <button
            onClick={() => setSelectedPoint(null)}
            className="text-xs text-muted-foreground hover:text-foreground"
          >
            Schliessen
          </button>
        </div>
      )}

      <ResponsiveContainer width="100%" height={400}>
        <ComposedChart
          data={chartData}
          margin={{ top: 20, right: 30, left: 20, bottom: 20 }}
          onClick={handleChartClick}
        >
          <defs>
            <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="chargingGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#22c55e" stopOpacity={0.6} />
              <stop offset="95%" stopColor="#22c55e" stopOpacity={0.2} />
            </linearGradient>
          </defs>

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
            domain={yAxisDomain}
            tick={{ fill: '#6b7280', fontSize: 12 }}
            axisLine={{ stroke: '#e5e7eb' }}
            tickLine={{ stroke: '#e5e7eb' }}
            label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft' }}
          />
          <Tooltip content={<CustomTooltip avgPrice={avgPrice} timeRange={timeRange} />} />

          {/* Charging blocks overlay as bars */}
          {timeRange === 'day' && chargingSchedule && chargingSchedule.length > 0 && (
            <Bar
              dataKey="chargingBar"
              fill="url(#chargingGradient)"
              isAnimationActive={true}
              animationDuration={800}
              radius={[2, 2, 0, 0]}
            >
              {chartData.map((entry, index) => (
                <Cell
                  key={`cell-${index}`}
                  fill={entry.isCharging ? 'url(#chargingGradient)' : 'transparent'}
                  stroke={entry.isCharging ? '#22c55e' : 'none'}
                  strokeWidth={entry.isCharging ? 1 : 0}
                />
              ))}
            </Bar>
          )}

          {/* Average price reference line (time window) */}
          {avgPrice && (
            <ReferenceLine
              y={avgPrice}
              stroke="#64748b"
              strokeDasharray="5 5"
              strokeWidth={2}
              label={{
                value: 'O/ Fenster',
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

          {/* Cheapest hour annotation */}
          {priceAnnotations.cheapest && (
            <ReferenceLine
              x={priceAnnotations.cheapest.time}
              stroke="#22c55e"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: `Min: ${priceAnnotations.cheapest.price.toFixed(1)}`,
                position: 'top',
                fill: '#22c55e',
                fontSize: 10
              }}
            />
          )}

          {/* Most expensive hour annotation */}
          {priceAnnotations.expensive && (
            <ReferenceLine
              x={priceAnnotations.expensive.time}
              stroke="#ef4444"
              strokeDasharray="3 3"
              strokeWidth={1}
              label={{
                value: `Max: ${priceAnnotations.expensive.price.toFixed(1)}`,
                position: 'top',
                fill: '#ef4444',
                fontSize: 10
              }}
            />
          )}

          {/* Optimal charging zone (green highlight) - stronger opacity + border */}
          {timeRange === 'day' && optimalZone && (
            <ReferenceArea
              x1={chartData[optimalZone.startIndex]?.time}
              x2={chartData[optimalZone.endIndex]?.time}
              fill="#22c55e"
              fillOpacity={0.25}
              stroke="#22c55e"
              strokeOpacity={0.5}
              strokeWidth={1}
              label={{
                value: 'Ladefenster',
                position: 'insideTop',
                fill: '#16a34a',
                fontSize: 11,
                fontWeight: 600
              }}
            />
          )}

          {/* Gradient fill below line */}
          {timeRange === 'day' && (
            <Area
              type="monotone"
              dataKey="price"
              stroke="transparent"
              fill="url(#priceGradient)"
              fillOpacity={0.3}
              isAnimationActive={true}
              animationDuration={1000}
            />
          )}

          {/* Price line */}
          <Line
            type="monotone"
            dataKey="price"
            stroke="#3b82f6"
            strokeWidth={timeRange === 'day' ? 3 : 2}
            dot={timeRange === 'day' ? false : chartData.length < 30}
            activeDot={{ r: 6, fill: '#3b82f6', strokeWidth: 2, cursor: 'pointer' }}
            isAnimationActive={true}
            animationDuration={1000}
          />

          {/* Brush zoom for day view */}
          {timeRange === 'day' && chartData.length > 24 && (
            <Brush
              dataKey="time"
              height={30}
              stroke="#3b82f6"
              fill="#f8fafc"
              travellerWidth={10}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      {/* Enhanced Legend */}
      <div className="mt-4 flex flex-wrap items-center justify-center gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="h-3 w-12 rounded bg-blue-500" />
          <span className="text-muted-foreground">
            {timeRange === 'day' ? 'Stundlicher Preis' : 'Tagesdurchschnitt'}
          </span>
        </div>
        {timeRange === 'day' && chargingSchedule && chargingSchedule.length > 0 && (
          <div className="flex items-center gap-2">
            <div className="h-3 w-12 rounded bg-green-500/40" />
            <span className="text-muted-foreground">Laden aktiv</span>
          </div>
        )}
        {timeRange === 'day' && optimalZone && (
          <div className="flex items-center gap-2">
            <div className="h-3 w-12 rounded border border-green-500 bg-green-500/25" />
            <span className="text-muted-foreground">Ladefenster</span>
          </div>
        )}
        {timeRange === 'day' && avgPrice && (
          <div className="flex items-center gap-2">
            <div className="h-0.5 w-12 border-t-2 border-dashed border-slate-500" />
            <span className="text-muted-foreground">O/ Fenster</span>
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
    isCharging?: boolean
    chargingKwh?: number
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
      {data.isCharging && (
        <p className="mt-1 text-xs font-medium text-green-600 dark:text-green-400">
          Laden: {data.chargingKwh?.toFixed(1)} kWh
        </p>
      )}
      {timeRange === 'day' && vsAverage !== null && Math.abs(vsAverage) > 5 && (
        <p className={`mt-1 text-xs font-medium ${
          vsAverage < 0 ? 'text-green-600' : 'text-red-600'
        }`}>
          {vsAverage < 0 ? 'v' : '^'} {Math.abs(vsAverage).toFixed(0)}% vs Durchschnitt
        </p>
      )}
    </div>
  )
}
