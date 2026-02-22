'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import type { DailySummary, MonthlyStats, HourlyPrice } from '@/lib/v2-config'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'

interface Props {
  monthly: MonthlyStats[]
  daily: DailySummary[]
  hourly: HourlyPrice[]
  onBack: () => void
  onRestart: () => void
}

const TIMELINE = [
  { year: '2024 Jan', event: '\u00a714a EnWG takes effect', desc: 'Controllable consumption devices get grid fee reduction' },
  { year: '2025 Jan', event: 'Dynamic tariffs mandatory', desc: 'All energy suppliers must offer hourly price tariffs' },
  { year: '2025 Oct', event: '15-min day-ahead products', desc: 'Quarter-hourly granularity on EPEX Spot \u2014 more optimization potential' },
  { year: '2026+', event: 'Smart meter rollout', desc: 'Accelerated iMSys deployment enables real-time optimization at scale' },
]

export function Step5MarketContext({ monthly, daily, hourly, onBack, onRestart }: Props) {
  // Yearly summaries with night spread
  const yearlyStats = useMemo(() => {
    const years = new Map<string, { spreads: number[]; negHours: number; prices: number[]; nightSpreads: number[] }>()
    for (const d of daily) {
      const year = d.date.slice(0, 4)
      const entry = years.get(year) || { spreads: [], negHours: 0, prices: [], nightSpreads: [] }
      entry.spreads.push(d.spread)
      entry.negHours += d.negativeHours
      if (d.dayNightSpread !== undefined) {
        entry.nightSpreads.push(d.dayNightSpread)
      }
      years.set(year, entry)
    }
    for (const p of hourly) {
      const year = p.date.slice(0, 4)
      const entry = years.get(year)
      if (entry) entry.prices.push(p.priceEurMwh)
    }
    return Array.from(years.entries()).map(([year, data]) => ({
      year,
      avgSpread: Math.round(data.spreads.reduce((s, v) => s + v, 0) / data.spreads.length),
      negativeHours: data.negHours,
      maxPrice: data.prices.length ? Math.round(data.prices.reduce((m, v) => v > m ? v : m, data.prices[0])) : 0,
      minPrice: data.prices.length ? Math.round(data.prices.reduce((m, v) => v < m ? v : m, data.prices[0])) : 0,
      avgPrice: data.prices.length ? Math.round(data.prices.reduce((s, v) => s + v, 0) / data.prices.length * 10) / 10 : 0,
      avgNightSpread: data.nightSpreads.length
        ? Math.round(data.nightSpreads.reduce((s, v) => s + v, 0) / data.nightSpreads.length * 10) / 10
        : 0,
    })).sort((a, b) => a.year.localeCompare(b.year))
  }, [daily, hourly])

  // Night spread insight: compute average from monthly data
  const avgNightSpreadOverall = useMemo(() => {
    const spreads = monthly.filter(m => m.avgNightSpread > 0).map(m => m.avgNightSpread)
    if (spreads.length === 0) return 0
    return Math.round(spreads.reduce((s, v) => s + v, 0) / spreads.length * 10) / 10
  }, [monthly])

  // Monthly trend chart with night spread
  const trendData = useMemo(() =>
    monthly.map(m => ({
      month: new Date(m.month + '-01').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }),
      avgSpread: m.avgSpread,
      negativeHours: m.negativeHours,
      avgPrice: m.avgPrice,
      nightSpread: m.avgNightSpread || 0,
    })),
    [monthly]
  )

  // Seasonal heatmap: avg price by month-of-year x hour
  const heatmapData = useMemo(() => {
    const grid = new Map<string, { sum: number; count: number }>()
    for (const p of hourly) {
      const month = new Date(p.timestamp).getMonth()
      const key = `${month}-${p.hour}`
      const entry = grid.get(key) || { sum: 0, count: 0 }
      entry.sum += p.priceEurMwh
      entry.count++
      grid.set(key, entry)
    }

    const result: { month: number; hour: number; avgPrice: number }[] = []
    for (const [key, data] of grid) {
      const [m, h] = key.split('-').map(Number)
      result.push({ month: m, hour: h, avgPrice: data.sum / data.count })
    }
    return result
  }, [hourly])

  // Price for heatmap cell color
  function priceColor(price: number): string {
    if (price < 0) return 'bg-blue-500'
    if (price < 30) return 'bg-green-400'
    if (price < 60) return 'bg-green-200'
    if (price < 90) return 'bg-yellow-200'
    if (price < 120) return 'bg-orange-300'
    return 'bg-red-400'
  }

  // Night window indicator (22-06)
  function isNightHour(h: number): boolean {
    return h >= 22 || h < 6
  }

  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          Why now? — The market is ready
        </h2>
        <p className="text-lg text-gray-500 max-w-3xl mx-auto">
          Volatility is increasing structurally. More renewables mean more price swings — and more value for flexibility.
        </p>
      </div>

      {/* Year-over-year comparison */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
        {yearlyStats.map(year => (
          <Card key={year.year}>
            <CardContent className="pt-4 pb-3">
              <div className="flex items-center justify-between mb-2">
                <span className="text-2xl font-bold text-[#313131]">{year.year}</span>
                <Badge variant="outline">{year.negativeHours}h negative</Badge>
              </div>
              <div className="space-y-1 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-500">Avg. daily spread</span>
                  <span className="font-semibold text-[#EA1C0A]">{year.avgSpread} EUR/MWh</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Price range</span>
                  <span className="font-semibold">{year.minPrice} to {year.maxPrice} EUR/MWh</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Average price</span>
                  <span className="font-semibold">{year.avgPrice} EUR/MWh</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-500">Avg. night spread</span>
                  <span className="font-semibold text-[#115BA7]">{year.avgNightSpread} EUR/MWh</span>
                </div>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Night Charging Insight */}
      <Card className="border-[#115BA7]/20 bg-[#115BA7]/[0.03]">
        <CardContent className="pt-4 pb-4">
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-[#115BA7] flex items-center justify-center text-white text-sm font-bold shrink-0">
              N
            </div>
            <div>
              <p className="font-semibold text-[#313131] mb-1">Night Charging Window (22:00-06:00)</p>
              <p className="text-sm text-gray-700 leading-relaxed">
                The average spread between the mean night price and the cheapest night hour is{' '}
                <span className="font-bold text-[#115BA7]">{avgNightSpreadOverall} EUR/MWh</span>.
                This is the core optimization potential for overnight EV charging. By shifting load
                to the cheapest 2-3 hours within the night window, we capture this spread as value.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Volatility Trend with Night Spread */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Volatility Trend — Average Daily Spread Over Time</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[280px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={trendData} margin={{ top: 10, right: 20, bottom: 0, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="month" tick={{ fontSize: 10 }} stroke="#9CA3AF" interval={2} />
                <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                <Area type="monotone" dataKey="avgSpread" fill="#EA1C0A" stroke="#EA1C0A" fillOpacity={0.15} strokeWidth={2} name="Avg. Daily Spread (EUR/MWh)" />
                <Line type="monotone" dataKey="nightSpread" stroke="#115BA7" strokeWidth={2} strokeDasharray="5 5" dot={false} name="Night Spread (EUR/MWh)" />
                <Bar dataKey="negativeHours" fill="#115BA7" opacity={0.25} name="Negative Price Hours" />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-gray-500">
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-[#EA1C0A] inline-block" /> Daily Spread
            </span>
            <span className="flex items-center gap-1">
              <span className="w-4 h-0.5 bg-[#115BA7] inline-block border-dashed" style={{ borderBottom: '2px dashed #115BA7', height: 0 }} /> Night Spread (22:00-06:00)
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-3 bg-[#115BA7] opacity-25 inline-block rounded-sm" /> Negative Hours
            </span>
          </div>
          <p className="text-sm text-gray-500 mt-3">
            The upward trend in volatility is structural: more solar and wind capacity means larger price swings — and more value for flexibility providers.
          </p>
        </CardContent>
      </Card>

      {/* Seasonal Heatmap with Night Window Highlighting */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Seasonal Price Patterns — When Is the Opportunity?</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <div className="min-w-[700px]">
              {/* Header: hours */}
              <div className="flex items-center gap-0.5 mb-1">
                <div className="w-10 shrink-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className={`flex-1 text-center text-[9px] ${
                      isNightHour(h) ? 'text-[#115BA7] font-bold' : 'text-gray-400'
                    }`}
                  >
                    {h}
                  </div>
                ))}
              </div>
              {/* Night window indicator bar */}
              <div className="flex items-center gap-0.5 mb-0.5">
                <div className="w-10 shrink-0" />
                {Array.from({ length: 24 }, (_, h) => (
                  <div
                    key={h}
                    className={`flex-1 h-1 rounded-full ${
                      isNightHour(h) ? 'bg-[#115BA7]' : 'bg-transparent'
                    }`}
                  />
                ))}
              </div>
              {/* Rows: months */}
              {months.map((label, m) => (
                <div key={m} className="flex items-center gap-0.5 mb-0.5">
                  <div className="w-10 shrink-0 text-xs text-gray-500 text-right pr-2">{label}</div>
                  {Array.from({ length: 24 }, (_, h) => {
                    const cell = heatmapData.find(c => c.month === m && c.hour === h)
                    const price = cell?.avgPrice ?? 50
                    const nightBorder = (h === 22 || h === 6) ? 'border-l-2 border-[#115BA7]/40' : ''
                    return (
                      <div
                        key={h}
                        className={`flex-1 h-5 rounded-sm ${priceColor(price)} ${nightBorder} transition-colors`}
                        title={`${label} ${h}:00 — Avg: ${price.toFixed(0)} EUR/MWh${isNightHour(h) ? ' (Night window)' : ''}`}
                      />
                    )
                  })}
                </div>
              ))}
              {/* Legend */}
              <div className="flex items-center gap-3 mt-3 text-[10px] text-gray-500 ml-10">
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-blue-500 rounded-sm" />&lt;0</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-400 rounded-sm" />0-30</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-green-200 rounded-sm" />30-60</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-yellow-200 rounded-sm" />60-90</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-orange-300 rounded-sm" />90-120</span>
                <span className="flex items-center gap-1"><span className="w-3 h-3 bg-red-400 rounded-sm" />&gt;120</span>
                <span className="ml-2">EUR/MWh</span>
                <span className="ml-3 flex items-center gap-1">
                  <span className="w-4 h-1 bg-[#115BA7] rounded-full" /> Night window (22-06)
                </span>
              </div>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-2 gap-4 text-sm">
            <div className="p-3 bg-green-50 rounded-lg border border-green-200">
              <strong>Summer midday (10:00-16:00):</strong> Low or negative prices due to solar surplus — ideal for opportunistic daytime charging at workplace.
            </div>
            <div className="p-3 bg-red-50 rounded-lg border border-red-200">
              <strong>Winter evenings (17:00-20:00):</strong> Highest prices of the year — this is exactly when uncontrolled EVs would charge. The spread is our revenue.
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Regulatory Timeline */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Regulatory Tailwinds</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="relative">
            <div className="absolute left-4 top-0 bottom-0 w-0.5 bg-gray-200" />
            {TIMELINE.map((item, i) => (
              <div key={i} className="relative pl-10 pb-6 last:pb-0">
                <div className="absolute left-2.5 w-3 h-3 rounded-full bg-[#EA1C0A] border-2 border-white" />
                <div>
                  <Badge variant="outline" className="text-xs mb-1">{item.year}</Badge>
                  <p className="font-semibold text-[#313131]">{item.event}</p>
                  <p className="text-sm text-gray-500">{item.desc}</p>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* Closing Statement */}
      <Card className="bg-[#313131] text-white border-none">
        <CardContent className="py-8 text-center">
          <h3 className="text-2xl font-bold mb-3">
            Flexibility is the next major value creation layer in the energy market.
          </h3>
          <p className="text-gray-300 max-w-2xl mx-auto mb-6">
            Less than 20% of available flexibility is monetized today (BCG). The regulatory framework is in place.
            Volatility is increasing structurally. The question is not if, but when — and who moves first.
          </p>
          <div className="flex gap-4 justify-center">
            <Button variant="outline" className="border-white text-white hover:bg-white/10" onClick={onRestart}>
              Restart from Step 1
            </Button>
            <Button className="bg-[#EA1C0A] hover:bg-[#C51608] text-white px-8" onClick={onRestart}>
              Explore Again
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={onBack}>&larr; Back: Value Waterfall</Button>
        <Button variant="outline" onClick={onRestart}>Restart from Step 1</Button>
      </div>
    </div>
  )
}
