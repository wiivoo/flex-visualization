'use client'

import { useMemo, useState, useEffect } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer, Bar
} from 'recharts'
import type { HourlyPrice, DailySummary, MonthlyStats, GenerationData } from '@/lib/v2-config'

interface PriceData {
  hourly: HourlyPrice[]
  daily: DailySummary[]
  monthly: MonthlyStats[]
  loading: boolean
  error: string | null
  selectedDate: string
  setSelectedDate: (date: string) => void
  selectedDayPrices: HourlyPrice[]
  yearRange: { start: string; end: string }
  generation: GenerationData[]
  generationLoading: boolean
}

interface Props {
  prices: PriceData
  onNext: () => void
}

function MiniCalendar({ daily, selectedDate, onSelect }: {
  daily: DailySummary[]
  selectedDate: string
  onSelect: (date: string) => void
}) {
  // Compute the data range from daily array
  const dataRange = useMemo(() => {
    if (daily.length === 0) return { firstMonth: '', lastMonth: '' }
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    return {
      firstMonth: sorted[0].date.slice(0, 7),
      lastMonth: sorted[sorted.length - 1].date.slice(0, 7),
    }
  }, [daily])

  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) return selectedDate.slice(0, 7)
    if (dataRange.lastMonth) return dataRange.lastMonth
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  // Sync viewMonth when selectedDate changes (e.g., after data loads)
  useEffect(() => {
    if (selectedDate) {
      setViewMonth(selectedDate.slice(0, 7))
    }
  }, [selectedDate])

  const monthDays = useMemo(() => {
    const [year, month] = viewMonth.split('-').map(Number)
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1 // Monday start

    const dailyMap = new Map(daily.map(d => [d.date, d]))
    const days: (DailySummary | null)[] = []

    for (let i = 0; i < startPad; i++) days.push(null)
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push(dailyMap.get(dateStr) || null)
    }
    return days
  }, [viewMonth, daily])

  const monthLabel = (() => {
    const [y, m] = viewMonth.split('-').map(Number)
    return new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  })()

  const canGoBack = dataRange.firstMonth && viewMonth > dataRange.firstMonth
  const canGoForward = dataRange.lastMonth && viewMonth < dataRange.lastMonth

  function shiftMonth(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    // Constrain to data range
    if (dataRange.firstMonth && newMonth < dataRange.firstMonth) return
    if (dataRange.lastMonth && newMonth > dataRange.lastMonth) return
    setViewMonth(newMonth)
  }

  // Color scale based on spread
  function spreadColor(spread: number): string {
    if (spread > 200) return 'bg-red-500'
    if (spread > 150) return 'bg-orange-400'
    if (spread > 100) return 'bg-yellow-400'
    if (spread > 50) return 'bg-green-300'
    return 'bg-green-100'
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <button
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
          className={`px-2 py-1 text-sm rounded ${canGoBack ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
        >
          &larr;
        </button>
        <span className="font-semibold text-[#313131]">{monthLabel}</span>
        <button
          onClick={() => shiftMonth(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          className={`px-2 py-1 text-sm rounded ${canGoForward ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
        >
          &rarr;
        </button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
          <div key={d} className="text-center text-gray-400 font-medium py-1">{d}</div>
        ))}
        {monthDays.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />
          const dayNum = parseInt(day.date.split('-')[2])
          const isSelected = day.date === selectedDate
          return (
            <button
              key={day.date}
              onClick={() => onSelect(day.date)}
              className={`relative p-1 rounded text-center transition-all hover:ring-2 hover:ring-[#EA1C0A]/50 ${
                isSelected ? 'ring-2 ring-[#EA1C0A] bg-[#EA1C0A]/5' : ''
              }`}
              title={`${day.date}: Spread ${day.spread.toFixed(0)} EUR/MWh`}
            >
              <div className="text-[10px] text-gray-600">{dayNum}</div>
              <div className={`w-full h-1.5 rounded-full mt-0.5 ${spreadColor(day.spread)}`} />
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500">
        <span>Spread:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-100 rounded" />Low</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-yellow-400 rounded" />Med</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-500 rounded" />High</span>
      </div>
    </div>
  )
}

export function Step1PriceExplorer({ prices, onNext }: Props) {
  const { daily, selectedDate, setSelectedDate, selectedDayPrices, loading, error, monthly, generation, generationLoading } = prices

  const dayStats = useMemo(() => {
    if (selectedDayPrices.length === 0) return null
    let min = selectedDayPrices[0].priceEurMwh, max = min
    let minHour = selectedDayPrices[0], maxHour = selectedDayPrices[0]
    let sum = 0, daySum = 0, nightSum = 0, dayCount = 0, nightCount = 0
    let priceAt18 = 0
    let cheapestNight = Infinity
    for (const p of selectedDayPrices) {
      if (p.priceEurMwh < min) { min = p.priceEurMwh; minHour = p }
      if (p.priceEurMwh > max) { max = p.priceEurMwh; maxHour = p }
      sum += p.priceEurMwh
      if (p.hour === 18) priceAt18 = p.priceEurMwh
      // Day: 6-22h, Night: 22-6h
      if (p.hour >= 6 && p.hour < 22) {
        daySum += p.priceEurMwh
        dayCount++
      } else {
        nightSum += p.priceEurMwh
        nightCount++
        if (p.priceEurMwh < cheapestNight) cheapestNight = p.priceEurMwh
      }
    }
    const avg = sum / selectedDayPrices.length
    const dayAvg = dayCount > 0 ? daySum / dayCount : 0
    const nightAvg = nightCount > 0 ? nightSum / nightCount : 0
    if (cheapestNight === Infinity) cheapestNight = nightAvg
    const nightSpread = priceAt18 - cheapestNight // the real opportunity
    return { min, max, spread: max - min, avg, minHour, maxHour, dayAvg, nightAvg, priceAt18, cheapestNight, nightSpread }
  }, [selectedDayPrices])

  // Build chart data with generation overlay
  const chartData = useMemo(() => {
    const genMap = new Map(generation.map(g => [g.hour, g]))
    return selectedDayPrices.map(p => {
      const gen = genMap.get(p.hour)
      return {
        hour: `${String(p.hour).padStart(2, '0')}:00`,
        hourNum: p.hour,
        price: Math.round(p.priceEurMwh * 10) / 10,
        priceCtKwh: p.priceCtKwh,
        isNeg: p.priceEurMwh < 0,
        renewableShare: gen ? Math.round(gen.renewableShare) : null,
        isDaytime: p.hour >= 6 && p.hour < 22,
      }
    })
  }, [selectedDayPrices, generation])

  // Monthly volatility with day-night spread
  const monthlyChartData = useMemo(() =>
    monthly.map(m => ({
      month: new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      avgSpread: Math.round(m.avgSpread),
      dayNightSpread: Math.round(m.avgNightSpread),
      avgPrice: m.avgPrice,
    })),
    [monthly]
  )

  if (loading) {
    return (
      <div className="flex items-center justify-center h-96">
        <div className="text-center">
          <div className="w-12 h-12 border-4 border-[#EA1C0A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
          <p className="text-gray-500">Loading 3 years of market data...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-16">
        <p className="text-red-500 mb-2">Failed to load price data</p>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center mb-8">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          Electricity prices fluctuate — every hour, every day
        </h2>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          Real EPEX Spot day-ahead prices for the German market. Select any day from the past 3 years to explore.
        </p>
      </div>

      {/* KPIs */}
      {dayStats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Daily Spread</p>
              <AnimatedNumber value={dayStats.spread} decimals={0} suffix=" EUR/MWh" className="text-2xl font-bold text-[#EA1C0A]" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Average Price</p>
              <AnimatedNumber value={dayStats.avg / 10} decimals={1} suffix=" ct/kWh" className="text-2xl font-bold text-[#313131]" />
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide flex items-center justify-center gap-1">
                <span>Day Avg</span>
                <span className="text-sm">&#9728;&#65039;</span>
                <span className="text-gray-300 mx-1">/</span>
                <span>Night Avg</span>
                <span className="text-sm">&#127769;</span>
              </p>
              <div className="flex items-center justify-center gap-2">
                <span className="text-lg font-bold text-amber-600">{(dayStats.dayAvg / 10).toFixed(1)}</span>
                <span className="text-gray-300">/</span>
                <span className="text-lg font-bold text-indigo-600">{(dayStats.nightAvg / 10).toFixed(1)}</span>
                <span className="text-xs text-gray-400">ct/kWh</span>
              </div>
            </CardContent>
          </Card>
          <Card className={dayStats.nightSpread > 0 ? 'border-green-200 bg-green-50/30' : ''}>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Night Spread (18h vs min)</p>
              <AnimatedNumber value={dayStats.nightSpread} decimals={0} suffix=" EUR/MWh" className="text-2xl font-bold text-green-600" />
              <p className="text-[10px] text-gray-400 mt-0.5">
                18:00: {dayStats.priceAt18.toFixed(0)} → cheapest: {dayStats.cheapestNight.toFixed(0)} EUR/MWh
              </p>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main content: Chart + Calendar */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Price Chart */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg">
                Day-Ahead Prices — {selectedDate ? new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '...'}
              </CardTitle>
              <div className="flex gap-2 items-center">
                {generation.length > 0 && !generationLoading && (
                  <Badge variant="outline" className="text-xs text-green-600 border-green-200">Renewables overlay</Badge>
                )}
                <Badge variant="outline" className="text-xs">EPEX Spot DE-LU</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 50, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA1C0A" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#EA1C0A" stopOpacity={0} />
                    </linearGradient>
                    <linearGradient id="renewableGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22C55E" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#22C55E" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  {/* Day/Night background shading */}
                  <ReferenceArea x1="00:00" x2="06:00" fill="#DBEAFE" fillOpacity={0.3} />
                  <ReferenceArea x1="06:00" x2="22:00" fill="#FEF9C3" fillOpacity={0.25} />
                  <ReferenceArea x1="22:00" x2="23:00" fill="#DBEAFE" fillOpacity={0.3} />
                  <XAxis
                    dataKey="hour"
                    tick={{ fontSize: 11 }}
                    stroke="#9CA3AF"
                    tickFormatter={(val) => {
                      const h = parseInt(val)
                      if (h === 3) return '🌙'
                      if (h === 12) return '☀️'
                      if (h === 23) return '🌙'
                      return val
                    }}
                  />
                  <YAxis
                    yAxisId="price"
                    tick={{ fontSize: 11 }}
                    stroke="#9CA3AF"
                    label={{ value: 'EUR/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }}
                  />
                  {generation.length > 0 && (
                    <YAxis
                      yAxisId="renewable"
                      orientation="right"
                      tick={{ fontSize: 10 }}
                      stroke="#22C55E"
                      domain={[0, 100]}
                      label={{ value: 'Renewable %', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#22C55E' } }}
                    />
                  )}
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13 }}
                    formatter={(val, name) => {
                      if (val == null) return ['-', String(name)]
                      if (name === 'renewableShare') return [`${val}%`, 'Renewable Share']
                      return [`${Number(val).toFixed(1)} EUR/MWh (${(Number(val) / 10).toFixed(2)} ct/kWh)`, 'Price']
                    }}
                    labelFormatter={(label) => {
                      const h = parseInt(label)
                      const icon = (h >= 6 && h < 22) ? '☀️' : '🌙'
                      return `${icon} ${label}`
                    }}
                  />
                  {/* Renewable share area (behind price) */}
                  {generation.length > 0 && (
                    <Area
                      type="monotone"
                      dataKey="renewableShare"
                      yAxisId="renewable"
                      fill="url(#renewableGradient)"
                      stroke="#22C55E"
                      strokeWidth={1}
                      strokeOpacity={0.4}
                      dot={false}
                    />
                  )}
                  <Area type="monotone" dataKey="price" yAxisId="price" fill="url(#priceGradient)" stroke="none" />
                  <Line type="monotone" dataKey="price" yAxisId="price" stroke="#EA1C0A" strokeWidth={2.5} dot={false} />
                  {dayStats && (
                    <>
                      <ReferenceLine
                        yAxisId="price"
                        y={dayStats.avg}
                        stroke="#9CA3AF"
                        strokeDasharray="5 5"
                        label={{ value: `Avg: ${dayStats.avg.toFixed(0)}`, position: 'right', fontSize: 10, fill: '#9CA3AF' }}
                      />
                      <ReferenceLine
                        yAxisId="price"
                        y={dayStats.dayAvg}
                        stroke="#D97706"
                        strokeDasharray="3 3"
                        label={{ value: `Day: ${dayStats.dayAvg.toFixed(0)}`, position: 'right', fontSize: 9, fill: '#D97706' }}
                      />
                      <ReferenceLine
                        yAxisId="price"
                        y={dayStats.nightAvg}
                        stroke="#4F46E5"
                        strokeDasharray="3 3"
                        label={{ value: `Night: ${dayStats.nightAvg.toFixed(0)}`, position: 'right', fontSize: 9, fill: '#4F46E5' }}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Annotations */}
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-[#FEF9C3]" />Daytime (6-22h)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-[#DBEAFE]" />Nighttime (22-6h)</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1 rounded bg-[#EA1C0A]" />Spot Price</span>
              {generation.length > 0 && (
                <span className="flex items-center gap-1"><span className="w-3 h-2 rounded bg-green-100 border border-green-300" />Renewable %</span>
              )}
            </div>
            {dayStats && dayStats.spread > 100 && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <strong>On this day, the price swing was {dayStats.spread.toFixed(0)} EUR/MWh</strong> — that&apos;s the difference between the cheapest and most expensive hour. This volatility is the raw material for flexibility monetization.
              </div>
            )}
            {dayStats && dayStats.nightSpread > 10 && (
              <div className="mt-2 p-3 bg-indigo-50 border border-indigo-200 rounded-lg text-sm">
                <strong>Night spread: {dayStats.nightSpread.toFixed(0)} EUR/MWh.</strong> The price at 18:00 ({dayStats.priceAt18.toFixed(0)} EUR/MWh) vs. the cheapest night hour ({dayStats.cheapestNight.toFixed(0)} EUR/MWh). The more you need to charge, the more night hours you use — so the effective spread narrows with higher energy demand.
              </div>
            )}
          </CardContent>
        </Card>

        {/* Calendar */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Select a Day</CardTitle>
          </CardHeader>
          <CardContent>
            <MiniCalendar
              daily={daily}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
            />
          </CardContent>
        </Card>
      </div>

      {/* Volatility Seasonality */}
      {monthlyChartData.length > 0 && (
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">Monthly Volatility — When Is the Opportunity Biggest?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyChartData} margin={{ top: 10, right: 30, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#9CA3AF" interval={2} />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" label={{ value: 'EUR/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, fontSize: 12 }}
                    formatter={(val, name) => {
                      if (name === 'dayNightSpread') return [`${val} EUR/MWh`, 'Night Spread (18h vs min)']
                      return [`${val} EUR/MWh`, 'Avg. Daily Spread']
                    }}
                  />
                  <Bar dataKey="avgSpread" fill="#EA1C0A" opacity={0.6} name="avgSpread" radius={[2, 2, 0, 0]} />
                  <Line type="monotone" dataKey="dayNightSpread" stroke="#4F46E5" strokeWidth={2.5} name="dayNightSpread" dot={{ r: 3, fill: '#4F46E5' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex flex-wrap gap-4 mt-3 text-xs text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3 h-3 rounded bg-[#EA1C0A] opacity-60" />Avg. Daily Spread</span>
              <span className="flex items-center gap-1"><span className="w-3 h-1 rounded bg-[#4F46E5]" />Night Spread (18h vs cheapest)</span>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Winter months (Oct-Mar) typically show the highest volatility — these are the months with the biggest optimization opportunity. The night spread shows the gap between the 18:00 price (when you plug in) and the cheapest night hour — the more you need to charge, the more hours you use, narrowing the effective spread.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Transition */}
      <div className="text-center py-6">
        <p className="text-lg text-gray-600 mb-4">
          What if we shift EV charging to the cheapest hours?
        </p>
        <Button onClick={onNext} size="lg" className="bg-[#EA1C0A] hover:bg-[#C51608] text-white px-8">
          Next: Smart Charging &rarr;
        </Button>
      </div>
    </div>
  )
}
