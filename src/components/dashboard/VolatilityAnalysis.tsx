'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Activity, TrendingUp, Calendar, Zap } from 'lucide-react'
import { PricePoint } from '@/lib/config'
import { format } from 'date-fns'
import { de } from 'date-fns/locale'
import {
  ComposedChart,
  Area,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  Cell
} from 'recharts'

interface VolatilityAnalysisProps {
  prices: PricePoint[]
}

interface DailySpread {
  date: Date
  dateLabel: string
  min: number
  max: number
  avg: number
  spread: number
  count: number
}

export function VolatilityAnalysis({ prices }: VolatilityAnalysisProps) {
  // Aggregate prices by day
  const dailyData = useMemo(() => {
    if (prices.length === 0) return []

    const dailyMap = new Map<string, { prices: number[]; date: Date }>()

    prices.forEach(point => {
      const date = new Date(point.timestamp)
      const dayKey = format(date, 'yyyy-MM-dd')
      if (!dailyMap.has(dayKey)) {
        dailyMap.set(dayKey, { prices: [], date })
      }
      dailyMap.get(dayKey)!.prices.push(point.price_ct_kwh)
    })

    return Array.from(dailyMap.entries())
      .map(([, { prices: dayPrices, date }]) => {
        const min = Math.min(...dayPrices)
        const max = Math.max(...dayPrices)
        return {
          date,
          dateLabel: format(date, 'd. MMM', { locale: de }),
          min: Math.round(min * 10) / 10,
          max: Math.round(max * 10) / 10,
          avg: Math.round((dayPrices.reduce((s, p) => s + p, 0) / dayPrices.length) * 10) / 10,
          spread: Math.round((max - min) * 10) / 10,
          count: dayPrices.length
        } as DailySpread
      })
      .sort((a, b) => a.date.getTime() - b.date.getTime())
  }, [prices])

  // KPIs
  const kpis = useMemo(() => {
    if (dailyData.length === 0) {
      return { avgSpread: 0, bestDay: null as DailySpread | null, arbitrageDays: 0, maxSpread: 0 }
    }

    const spreads = dailyData.map(d => d.spread)
    const avgSpread = spreads.reduce((s, v) => s + v, 0) / spreads.length
    const maxSpread = Math.max(...spreads)
    const bestDay = dailyData.find(d => d.spread === maxSpread) || null
    const arbitrageDays = dailyData.filter(d => d.spread > 15).length

    return { avgSpread, bestDay, arbitrageDays, maxSpread }
  }, [dailyData])

  // Color for spread bars
  const getSpreadColor = (spread: number): string => {
    if (spread >= 20) return '#22c55e' // Green - great potential
    if (spread >= 10) return '#fbbf24' // Yellow - good potential
    return '#94a3b8' // Gray - low potential
  }

  if (dailyData.length < 2) return null

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Volatilitäts-Analyse
          </CardTitle>
          <Badge variant="outline" className="text-xs">
            {dailyData.length} Tage
          </Badge>
        </div>
        <p className="text-sm text-muted-foreground">
          Tägliche Preisspanne (Spread) – je größer der Spread, desto höher das Arbitrage-Potenzial
        </p>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* KPI Cards */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-indigo-50 p-3 dark:from-blue-950/20 dark:to-indigo-950/20">
            <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
              <Activity className="h-3.5 w-3.5" />
              Ø Täglicher Spread
            </div>
            <p className="mt-1 text-2xl font-bold">{kpis.avgSpread.toFixed(1)} ct</p>
          </div>

          <div className="rounded-lg border bg-gradient-to-br from-green-50 to-emerald-50 p-3 dark:from-green-950/20 dark:to-emerald-950/20">
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <TrendingUp className="h-3.5 w-3.5" />
              Max. Spread
            </div>
            <p className="mt-1 text-2xl font-bold">{kpis.maxSpread.toFixed(1)} ct</p>
            {kpis.bestDay && (
              <p className="text-xs text-muted-foreground">
                {format(kpis.bestDay.date, 'd. MMM', { locale: de })}
              </p>
            )}
          </div>

          <div className="rounded-lg border bg-gradient-to-br from-amber-50 to-orange-50 p-3 dark:from-amber-950/20 dark:to-orange-950/20">
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <Zap className="h-3.5 w-3.5" />
              Arbitrage-Tage
            </div>
            <p className="mt-1 text-2xl font-bold">{kpis.arbitrageDays}</p>
            <p className="text-xs text-muted-foreground">
              Spread &gt; 15 ct
            </p>
          </div>

          <div className="rounded-lg border bg-gradient-to-br from-purple-50 to-violet-50 p-3 dark:from-purple-950/20 dark:to-violet-950/20">
            <div className="flex items-center gap-1.5 text-xs text-purple-600 dark:text-purple-400">
              <Calendar className="h-3.5 w-3.5" />
              Analysierte Tage
            </div>
            <p className="mt-1 text-2xl font-bold">{dailyData.length}</p>
            <p className="text-xs text-muted-foreground">
              {kpis.arbitrageDays > 0
                ? `${Math.round((kpis.arbitrageDays / dailyData.length) * 100)}% lohnend`
                : 'Keine lohnenden Tage'}
            </p>
          </div>
        </div>

        {/* Spread Band Chart - Min/Max area with avg line */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Preis-Bandbreite (Min ↔ Max pro Tag)</h3>
          <ResponsiveContainer width="100%" height={250}>
            <ComposedChart data={dailyData} margin={{ top: 10, right: 10, left: 0, bottom: 5 }}>
              <defs>
                <linearGradient id="spreadGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.3} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                interval={Math.max(0, Math.ceil(dailyData.length / 10) - 1)}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                width={45}
                label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as DailySpread
                  return (
                    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg dark:bg-slate-900">
                      <p className="text-sm font-medium">
                        {format(d.date, 'd. MMMM yyyy', { locale: de })}
                      </p>
                      <div className="mt-1 space-y-0.5 text-xs">
                        <p>Ø Preis: <span className="font-semibold">{d.avg.toFixed(1)} ct/kWh</span></p>
                        <p className="text-green-600">Min: {d.min.toFixed(1)} ct/kWh</p>
                        <p className="text-red-600">Max: {d.max.toFixed(1)} ct/kWh</p>
                        <p className="mt-1 font-semibold">
                          Spread: {d.spread.toFixed(1)} ct
                          {d.spread >= 20 && ' 🟢 Super'}
                          {d.spread >= 10 && d.spread < 20 && ' 🟡 Gut'}
                          {d.spread < 10 && ' ⚪ Gering'}
                        </p>
                      </div>
                    </div>
                  )
                }}
              />
              {/* Min-Max band */}
              <Area
                type="monotone"
                dataKey="max"
                stroke="none"
                fill="url(#spreadGradient)"
                fillOpacity={1}
              />
              <Area
                type="monotone"
                dataKey="min"
                stroke="none"
                fill="#ffffff"
                fillOpacity={1}
              />
              {/* Average line */}
              <Line
                type="monotone"
                dataKey="avg"
                stroke="#3b82f6"
                strokeWidth={2}
                dot={dailyData.length < 15}
                activeDot={{ r: 5, fill: '#3b82f6' }}
              />
              {/* Min line */}
              <Line
                type="monotone"
                dataKey="min"
                stroke="#22c55e"
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
              />
              {/* Max line */}
              <Line
                type="monotone"
                dataKey="max"
                stroke="#ef4444"
                strokeWidth={1}
                strokeDasharray="4 4"
                dot={false}
              />
            </ComposedChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-0.5 w-6 bg-blue-500" />
              <span>Ø Preis</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-0.5 w-6 border-t border-dashed border-green-500" />
              <span>Min</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-0.5 w-6 border-t border-dashed border-red-500" />
              <span>Max</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-blue-500/20" />
              <span>Bandbreite</span>
            </div>
          </div>
        </div>

        {/* Spread Bar Chart */}
        <div>
          <h3 className="mb-3 text-sm font-semibold">Täglicher Spread (Arbitrage-Potenzial)</h3>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={dailyData} margin={{ top: 5, right: 10, left: 0, bottom: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.3} />
              <XAxis
                dataKey="dateLabel"
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                interval={Math.max(0, Math.ceil(dailyData.length / 10) - 1)}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                width={40}
                label={{ value: 'ct', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as DailySpread
                  return (
                    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg dark:bg-slate-900">
                      <p className="text-sm font-medium">
                        {format(d.date, 'd. MMMM yyyy', { locale: de })}
                      </p>
                      <p className="mt-1 text-lg font-bold">{d.spread.toFixed(1)} ct Spread</p>
                      <p className="text-xs text-muted-foreground">
                        {d.min.toFixed(1)} → {d.max.toFixed(1)} ct/kWh
                      </p>
                    </div>
                  )
                }}
              />
              <ReferenceLine
                y={kpis.avgSpread}
                stroke="#6b7280"
                strokeDasharray="5 5"
                strokeWidth={1.5}
                label={{
                  value: `Ø ${kpis.avgSpread.toFixed(0)} ct`,
                  position: 'right',
                  fill: '#6b7280',
                  fontSize: 10
                }}
              />
              <Bar dataKey="spread" radius={[3, 3, 0, 0]}>
                {dailyData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={getSpreadColor(entry.spread)} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-[#22c55e]" />
              <span>&gt; 20 ct (Super)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-[#fbbf24]" />
              <span>10–20 ct (Gut)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-3 rounded-sm bg-[#94a3b8]" />
              <span>&lt; 10 ct (Gering)</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
