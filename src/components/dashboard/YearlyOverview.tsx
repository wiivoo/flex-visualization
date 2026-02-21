'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { TrendingDown, TrendingUp, Activity, Calendar, ArrowRight } from 'lucide-react'
import { PricePoint } from '@/lib/config'
import { format, startOfMonth, endOfMonth, differenceInDays } from 'date-fns'
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Cell
} from 'recharts'

interface YearlyOverviewProps {
  prices: PricePoint[]
  selectedYear: number
  onYearChange: (year: number) => void
  onDateSelect: (date: Date) => void
}

const MONTHS = [
  'Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'
]

export function YearlyOverview({ prices, selectedYear, onYearChange, onDateSelect }: YearlyOverviewProps) {
  // Aggregate by month
  const monthlyData = useMemo(() => {
    const monthlyMap = new Map<number, {
      prices: number[]
      count: number
      min: number
      max: number
    }>()

    prices.forEach(point => {
      const date = new Date(point.timestamp)
      if (date.getFullYear() !== selectedYear) return

      const month = date.getMonth()
      const price = point.price_ct_kwh

      if (!monthlyMap.has(month)) {
        monthlyMap.set(month, { prices: [], count: 0, min: price, max: price })
      }

      const data = monthlyMap.get(month)!
      data.prices.push(price)
      data.count++
      data.min = Math.min(data.min, price)
      data.max = Math.max(data.max, price)
    })

    return Array.from({ length: 12 }, (_, i) => {
      const data = monthlyMap.get(i)
      if (!data || data.prices.length === 0) {
        return {
          month: i,
          name: MONTHS[i],
          avg: 0,
          min: 0,
          max: 0,
          count: 0
        }
      }

      return {
        month: i,
        name: MONTHS[i],
        avg: data.prices.reduce((sum, p) => sum + p, 0) / data.prices.length,
        min: data.min,
        max: data.max,
        count: data.count
      }
    })
  }, [prices, selectedYear])

  // Year KPIs
  const yearKPIs = useMemo(() => {
    const validPrices = monthlyData.filter(d => d.count > 0)
    if (validPrices.length === 0) {
      return { avgPrice: 0, minMonth: null, maxMonth: null, volatility: 0 }
    }

    const allAvgs = validPrices.map(d => d.avg)
    const avgPrice = allAvgs.reduce((sum, p) => sum + p, 0) / allAvgs.length

    const minMonth = validPrices.reduce((min, d) => d.avg < min.avg ? d : min)
    const maxMonth = validPrices.reduce((max, d) => d.avg > max.avg ? d : max)

    const globalMin = Math.min(...validPrices.map(d => d.min))
    const globalMax = Math.max(...validPrices.map(d => d.max))
    const volatility = globalMax - globalMin

    return { avgPrice, minMonth, maxMonth, volatility }
  }, [monthlyData])

  // Daily volatility for highlights
  const dailyVolatility = useMemo(() => {
    const dailyMap = new Map<string, { prices: number[]; date: Date }>()

    prices.forEach(point => {
      const date = new Date(point.timestamp)
      if (date.getFullYear() !== selectedYear) return

      const dayKey = format(date, 'yyyy-MM-dd')
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, { prices: [], date })
      }
      dailyMap.get(dayKey)!.prices.push(point.price_ct_kwh)
    })

    return Array.from(dailyMap.values())
      .map(({ prices, date }) => ({
        date,
        min: Math.min(...prices),
        max: Math.max(...prices),
        volatility: Math.max(...prices) - Math.min(...prices),
        avg: prices.reduce((sum, p) => sum + p, 0) / prices.length
      }))
      .sort((a, b) => b.volatility - a.volatility)
      .slice(0, 5)
  }, [prices, selectedYear])

  // Days with negative prices
  const negativePriceDays = useMemo(() => {
    const dailyMap = new Map<string, { prices: number[]; date: Date }>()

    prices.forEach(point => {
      if (point.price_ct_kwh >= 0) return

      const date = new Date(point.timestamp)
      if (date.getFullYear() !== selectedYear) return

      const dayKey = format(date, 'yyyy-MM-dd')
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, { prices: [], date })
      }
      dailyMap.get(dayKey)!.prices.push(point.price_ct_kwh)
    })

    return Array.from(dailyMap.values())
      .map(({ prices, date }) => ({
        date,
        min: Math.min(...prices),
        count: prices.length
      }))
      .sort((a, b) => a.min - b.min)
      .slice(0, 3)
  }, [prices, selectedYear])

  // Get bar color based on price
  const getBarColor = (avg: number): string => {
    if (avg < 10) return '#22c55e' // Green - very cheap
    if (avg < 20) return '#86efac' // Light green
    if (avg < 30) return '#fbbf24' // Yellow
    if (avg < 50) return '#fb923c' // Orange
    return '#ef4444' // Red - expensive
  }

  const availableYears = useMemo(() => {
    const years = new Set<number>()
    prices.forEach(point => {
      years.add(new Date(point.timestamp).getFullYear())
    })
    return Array.from(years).sort((a, b) => b - a)
  }, [prices])

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>Jahresübersicht</CardTitle>
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Jahr:</span>
            <select
              value={selectedYear}
              onChange={(e) => onYearChange(parseInt(e.target.value))}
              className="rounded-md border bg-background px-3 py-1 text-sm"
            >
              {availableYears.map(year => (
                <option key={year} value={year}>{year}</option>
              ))}
            </select>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Year KPIs */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <Activity className="h-4 w-4" />
              <span className="text-xs">Ø Preis</span>
            </div>
            <p className="text-2xl font-bold">{yearKPIs.avgPrice.toFixed(1)} ct</p>
          </div>
          <div className="rounded-lg border bg-green-50 dark:bg-green-950/20 p-4">
            <div className="flex items-center gap-2 text-green-600 dark:text-green-400 mb-1">
              <TrendingDown className="h-4 w-4" />
              <span className="text-xs">Günstigster</span>
            </div>
            <p className="text-lg font-bold">{yearKPIs.minMonth?.name || '-'}</p>
            <p className="text-xs text-muted-foreground">{yearKPIs.minMonth?.avg.toFixed(1)} ct</p>
          </div>
          <div className="rounded-lg border bg-red-50 dark:bg-red-950/20 p-4">
            <div className="flex items-center gap-2 text-red-600 dark:text-red-400 mb-1">
              <TrendingUp className="h-4 w-4" />
              <span className="text-xs">Teuerster</span>
            </div>
            <p className="text-lg font-bold">{yearKPIs.maxMonth?.name || '-'}</p>
            <p className="text-xs text-muted-foreground">{yearKPIs.maxMonth?.avg.toFixed(1)} ct</p>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center gap-2 text-muted-foreground mb-1">
              <span className="text-xs">Volatilität</span>
            </div>
            <p className="text-2xl font-bold">{yearKPIs.volatility.toFixed(0)} ct</p>
          </div>
        </div>

        {/* Monthly Bar Chart */}
        <div>
          <h3 className="text-sm font-semibold mb-4">Monatliche Durchschnittspreise</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={monthlyData} margin={{ top: 5, right: 0, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.3} />
              <XAxis
                dataKey="name"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                width={40}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const data = payload[0].payload
                  return (
                    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg dark:bg-slate-900">
                      <p className="text-sm font-medium">{data.name}</p>
                      <p className="text-lg font-bold">{data.avg.toFixed(1)} ct/kWh</p>
                      <p className="text-xs text-muted-foreground">
                        Spanne: {data.min.toFixed(1)} - {data.max.toFixed(1)} ct
                      </p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="avg" radius={[4, 4, 0, 0]}>
                {monthlyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.count > 0 ? getBarColor(entry.avg) : '#e5e7eb'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Highlights */}
        <div className="grid sm:grid-cols-2 gap-4">
          {/* Top Volatile Days */}
          <div>
            <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
              <Activity className="h-4 w-4" />
              Volatilste Tage
            </h3>
            <div className="space-y-2">
              {dailyVolatility.slice(0, 3).map((day, i) => (
                <div
                  key={i}
                  className="flex items-center justify-between rounded-lg border bg-gradient-to-r from-amber-50 to-orange-50 p-3 dark:from-amber-950/20 dark:to-orange-950/20"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">#{i + 1}</Badge>
                    <div>
                      <p className="text-sm font-medium">
                        <Calendar className="inline h-3 w-3 mr-1" />
                        {format(day.date, 'MMM d, yyyy')}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        Spanne: {day.volatility.toFixed(0)} ct
                      </p>
                    </div>
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => onDateSelect(day.date)}
                  >
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              ))}
            </div>
          </div>

          {/* Negative Price Days */}
          {negativePriceDays.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-green-600" />
                Negative Preistage
              </h3>
              <div className="space-y-2">
                {negativePriceDays.map((day, i) => (
                  <div
                    key={i}
                    className="flex items-center justify-between rounded-lg border bg-green-50 p-3 dark:bg-green-950/20"
                  >
                    <div>
                      <p className="text-sm font-medium">
                        <Calendar className="inline h-3 w-3 mr-1" />
                        {format(day.date, 'MMM d, yyyy')}
                      </p>
                      <p className="text-xs text-green-600 font-medium">
                        Min: {day.min.toFixed(2)} ct/kWh
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => onDateSelect(day.date)}
                    >
                      <ArrowRight className="h-4 w-4" />
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
