'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ResponsiveContainer, Bar
} from 'recharts'
import type { HourlyPrice, DailySummary, MonthlyStats } from '@/lib/v2-config'

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
  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) return selectedDate.slice(0, 7)
    return new Date().toISOString().slice(0, 7)
  })

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

  const monthLabel = new Date(viewMonth + '-01').toLocaleDateString('en-US', { month: 'long', year: 'numeric' })

  function shiftMonth(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    setViewMonth(d.toISOString().slice(0, 7))
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
        <button onClick={() => shiftMonth(-1)} className="px-2 py-1 text-sm hover:bg-gray-100 rounded">&larr;</button>
        <span className="font-semibold text-[#313131]">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} className="px-2 py-1 text-sm hover:bg-gray-100 rounded">&rarr;</button>
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
  const { daily, selectedDate, setSelectedDate, selectedDayPrices, loading, error, monthly } = prices

  const dayStats = useMemo(() => {
    if (selectedDayPrices.length === 0) return null
    const eurPrices = selectedDayPrices.map(p => p.priceEurMwh)
    const min = Math.min(...eurPrices)
    const max = Math.max(...eurPrices)
    const avg = eurPrices.reduce((s, v) => s + v, 0) / eurPrices.length
    const minHour = selectedDayPrices.find(p => p.priceEurMwh === min)!
    const maxHour = selectedDayPrices.find(p => p.priceEurMwh === max)!
    const negHours = selectedDayPrices.filter(p => p.priceEurMwh < 0).length
    return { min, max, spread: max - min, avg, minHour, maxHour, negHours }
  }, [selectedDayPrices])

  // Year-level negative hours
  const yearNegHours = useMemo(() => {
    const currentYear = new Date().getFullYear()
    return daily
      .filter(d => d.date.startsWith(String(currentYear)))
      .reduce((sum, d) => sum + d.negativeHours, 0)
  }, [daily])

  const chartData = useMemo(() =>
    selectedDayPrices.map(p => ({
      hour: `${String(p.hour).padStart(2, '0')}:00`,
      price: Math.round(p.priceEurMwh * 10) / 10,
      priceCtKwh: p.priceCtKwh,
      isNeg: p.priceEurMwh < 0,
    })),
    [selectedDayPrices]
  )

  // Monthly volatility for seasonality view
  const monthlyChartData = useMemo(() =>
    monthly.map(m => ({
      month: new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      avgSpread: m.avgSpread,
      negativeHours: m.negativeHours,
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
        <div className="grid grid-cols-4 gap-4">
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
              <p className="text-xs text-gray-500 uppercase tracking-wide">Cheapest Hour</p>
              <p className="text-2xl font-bold text-green-600">{String(dayStats.minHour.hour).padStart(2, '0')}:00</p>
              <p className="text-xs text-gray-400">{dayStats.min.toFixed(1)} EUR/MWh</p>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="pt-4 pb-3 text-center">
              <p className="text-xs text-gray-500 uppercase tracking-wide">Negative Hours ({new Date().getFullYear()})</p>
              <AnimatedNumber value={yearNegHours} suffix="h" className="text-2xl font-bold text-[#115BA7]" />
            </CardContent>
          </Card>
        </div>
      )}

      {/* Main content: Chart + Calendar */}
      <div className="grid grid-cols-3 gap-6">
        {/* Price Chart */}
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">
                Day-Ahead Prices — {selectedDate ? new Date(selectedDate).toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : '...'}
              </CardTitle>
              <Badge variant="outline" className="text-xs">EPEX Spot DE-LU</Badge>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="priceGradient" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA1C0A" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#EA1C0A" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" label={{ value: 'EUR/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13 }}
                    formatter={(val) => val != null ? [`${Number(val).toFixed(1)} EUR/MWh (${(Number(val) / 10).toFixed(2)} ct/kWh)`, 'Price'] : ['-', 'Price']}
                  />
                  <Area type="monotone" dataKey="price" fill="url(#priceGradient)" stroke="none" />
                  <Line type="monotone" dataKey="price" stroke="#EA1C0A" strokeWidth={2.5} dot={false} />
                  {dayStats && (
                    <ReferenceLine
                      y={dayStats.avg}
                      stroke="#9CA3AF"
                      strokeDasharray="5 5"
                      label={{ value: `Avg: ${dayStats.avg.toFixed(0)}`, position: 'right', fontSize: 10, fill: '#9CA3AF' }}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {dayStats && dayStats.spread > 100 && (
              <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm">
                <strong>On this day, the price swing was {dayStats.spread.toFixed(0)} EUR/MWh</strong> — that&apos;s the difference between the cheapest and most expensive hour. This volatility is the raw material for flexibility monetization.
              </div>
            )}
            {dayStats && dayStats.negHours > 0 && (
              <div className="mt-2 p-3 bg-blue-50 border border-blue-200 rounded-lg text-sm">
                <strong>{dayStats.negHours} hours with negative prices</strong> — during these hours, consumers get paid to consume electricity. Perfect for opportunistic EV charging.
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
            <CardTitle className="text-lg">Volatility by Month — When Is the Opportunity Biggest?</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={monthlyChartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#9CA3AF" interval={2} />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" label={{ value: 'EUR/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                  <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                  <Bar dataKey="avgSpread" fill="#EA1C0A" opacity={0.7} name="Avg. Daily Spread" radius={[2, 2, 0, 0]} />
                  <Line type="monotone" dataKey="negativeHours" stroke="#115BA7" strokeWidth={2} name="Negative Price Hours" yAxisId={0} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <p className="text-sm text-gray-500 mt-3">
              Winter months (Oct–Mar) typically show the highest volatility — these are the months with the biggest optimization opportunity. Summer months offer frequent negative prices during midday solar surplus.
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
