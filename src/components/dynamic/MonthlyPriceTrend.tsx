'use client'

import { useMemo, useRef, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ComposedChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { DailyResult } from '@/lib/dynamic-tariff'

interface Props {
  dailyBreakdown: DailyResult[]
  loadProfile: string
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const YEAR_COLORS = ['#2563EB', '#059669', '#D97706', '#8B5CF6', '#E11D48', '#0891B2']

type TimeFilter = 'all' | 'peak' | 'offpeak'

interface PeriodAvg {
  year: number
  periodIdx: number
  avgSpot: number
  avgEnd: number
  costEur: number
  days: number
}

/** Smooth green→yellow→red gradient for prices (low=green, high=red) */
function priceColor(ct: number, min: number, max: number): string {
  if (max === min) return '#FEF9C3'
  const t = Math.max(0, Math.min(1, (ct - min) / (max - min)))
  // Green (low prices) → Yellow (mid) → Red (high prices)
  if (t < 0.25) return '#BBF7D0' // green-200
  if (t < 0.45) return '#D9F99D' // lime-200
  if (t < 0.55) return '#FEF9C3' // yellow-100
  if (t < 0.75) return '#FED7AA' // orange-200
  return '#FECACA'               // red-200
}

/** ISO week number (1-52), clamping week 53 to 52 for display */
function isoWeek(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z')
  const dayOfYear = Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86400000)
  const dow = d.getUTCDay() || 7
  const wk = Math.floor((dayOfYear + 10 - dow) / 7)
  if (wk < 1) return 52
  if (wk > 52) return 52 // clamp week 53 to 52 (last week of year)
  return wk
}

export function MonthlyPriceTrend({ dailyBreakdown, loadProfile }: Props) {
  const [metric, setMetric] = useState<'spot' | 'end' | 'cost'>('end')
  const [resolution, setResolution] = useState<'monthly' | 'weekly'>('monthly')
  const [hiddenYears, setHiddenYears] = useState<Set<number>>(new Set())
  const [timeFilter, setTimeFilter] = useState<TimeFilter>('all')
  const [showPeakInfo, setShowPeakInfo] = useState(false)
  const [weeklyHalf, setWeeklyHalf] = useState<'all' | 'h1' | 'h2'>('h1')
  const infoRef = useRef<HTMLDivElement>(null)

  const isWeekly = resolution === 'weekly'
  const allWeekLabels = Array.from({ length: 52 }, (_, i) => `W${i + 1}`)
  const periodLabels = isWeekly ? allWeekLabels : MONTHS_SHORT
  // Weekly heatmap: H1 = W1-W26, H2 = W27-W52
  const heatmapWeekRange: [number, number] = weeklyHalf === 'h1' ? [0, 26] : weeklyHalf === 'h2' ? [26, 52] : [0, 52]
  const heatmapWeekLabels = allWeekLabels.slice(heatmapWeekRange[0], heatmapWeekRange[1])

  // Aggregate by year-period with peak/off-peak support
  const { periodData, years, heatmapRange } = useMemo(() => {
    const map = new Map<string, {
      spotSum: number; costEur: number; kwh: number; count: number; spotHours: number
    }>()

    for (const d of dailyBreakdown) {
      const yr = parseInt(d.date.slice(0, 4))
      if (yr < 2025) continue
      const periodIdx = isWeekly ? isoWeek(d.date) - 1 : parseInt(d.month.slice(5, 7)) - 1
      const key = `${yr}-${periodIdx}`

      // Select cost/consumption based on time filter
      let cost: number, consumption: number, spotAvg: number, hours: number
      if (timeFilter === 'peak') {
        cost = d.peakDynamicCostEur
        consumption = d.peakConsumptionKwh
        spotAvg = d.peakHours > 0 ? d.peakSpotSum / d.peakHours : 0
        hours = d.peakHours
      } else if (timeFilter === 'offpeak') {
        cost = d.offPeakDynamicCostEur
        consumption = d.offPeakConsumptionKwh
        spotAvg = d.offPeakHours > 0 ? d.offPeakSpotSum / d.offPeakHours : 0
        hours = d.offPeakHours
      } else {
        cost = d.dynamicCostEur
        consumption = d.consumptionKwh
        spotAvg = d.avgSpotCtKwh
        hours = d.hoursWithData
      }

      if (hours === 0) continue

      const existing = map.get(key)
      if (existing) {
        existing.spotSum += spotAvg * hours
        existing.spotHours += hours
        existing.costEur += cost
        existing.kwh += consumption
        existing.count++
      } else {
        map.set(key, { spotSum: spotAvg * hours, spotHours: hours, costEur: cost, kwh: consumption, count: 1 })
      }
    }

    const result: PeriodAvg[] = []
    for (const [key, val] of map) {
      const [y, p] = key.split('-').map(Number)
      result.push({
        year: y,
        periodIdx: p,
        avgSpot: val.spotHours > 0 ? val.spotSum / val.spotHours : 0,
        avgEnd: val.kwh > 0 ? (val.costEur / val.kwh) * 100 : 0,
        costEur: val.costEur,
        days: val.count,
      })
    }

    const yrs = [...new Set(result.map(r => r.year))].sort()

    // Heatmap range — use all daily data across all time filters (peak/offpeak/all)
    // so the color scale stays consistent when toggling
    let min = 0, max = 1
    if (metric === 'cost') {
      // For cost (EUR), use aggregated period data (excluding 2022)
      const costVals = result.map(r => r.costEur)
      min = costVals.length > 0 ? Math.min(...costVals) : 0
      max = costVals.length > 0 ? Math.max(...costVals) : 1
    } else {
      const rangeVals: number[] = []
      for (const d of dailyBreakdown) {
        if (parseInt(d.date.slice(0, 4)) < 2025) continue
        if (metric === 'spot') {
          rangeVals.push(d.avgSpotCtKwh)
          if (d.peakHours > 0) rangeVals.push(d.peakSpotSum / d.peakHours)
          if (d.offPeakHours > 0) rangeVals.push(d.offPeakSpotSum / d.offPeakHours)
        } else {
          if (d.consumptionKwh > 0) rangeVals.push((d.dynamicCostEur / d.consumptionKwh) * 100)
          if (d.peakConsumptionKwh > 0) rangeVals.push((d.peakDynamicCostEur / d.peakConsumptionKwh) * 100)
          if (d.offPeakConsumptionKwh > 0) rangeVals.push((d.offPeakDynamicCostEur / d.offPeakConsumptionKwh) * 100)
        }
      }
      min = rangeVals.length > 0 ? Math.min(...rangeVals) : 0
      max = rangeVals.length > 0 ? Math.max(...rangeVals) : 1
    }

    return { periodData: result, years: yrs, heatmapRange: { min, max } }
  }, [dailyBreakdown, metric, isWeekly, timeFilter])

  // Chart data: x = period label, one key per year
  // When weekly + H1/H2 selected, filter chart to matching week range
  const chartPeriodLabels = isWeekly && weeklyHalf !== 'all'
    ? allWeekLabels.slice(heatmapWeekRange[0], heatmapWeekRange[1])
    : periodLabels
  const chartPeriodOffset = isWeekly && weeklyHalf !== 'all' ? heatmapWeekRange[0] : 0

  const chartData = useMemo(() => {
    return chartPeriodLabels.map((label, i) => {
      const pi = chartPeriodOffset + i
      const point: Record<string, string | number | null> = { period: label }
      for (const y of years) {
        const entry = periodData.find(m => m.year === y && m.periodIdx === pi)
        let val: number | null = null
        if (entry) {
          if (metric === 'spot') val = entry.avgSpot
          else if (metric === 'end') val = entry.avgEnd
          else val = entry.costEur
        }
        point[String(y)] = val !== null ? Math.round(val * 100) / 100 : null
      }
      return point
    })
  }, [periodData, years, metric, chartPeriodLabels, chartPeriodOffset])

  // Dynamic Y-axis domain based on visible years only
  const yDomain = useMemo(() => {
    const visibleYears = years.filter(y => !hiddenYears.has(y))
    if (visibleYears.length === 0) return [0, 50] as [number, number]

    const visibleVals: number[] = []
    for (const row of chartData) {
      for (const y of visibleYears) {
        const v = row[String(y)]
        if (v !== null && typeof v === 'number') visibleVals.push(v)
      }
    }

    if (visibleVals.length === 0) return [0, 50] as [number, number]

    const dataMin = Math.min(...visibleVals)
    const dataMax = Math.max(...visibleVals)
    const padding = (dataMax - dataMin) * 0.15 || 2
    const lo = Math.max(0, Math.floor((dataMin - padding) / 5) * 5)
    const hi = Math.ceil((dataMax + padding) / 5) * 5
    return [lo, hi] as [number, number]
  }, [chartData, years, hiddenYears])


  if (periodData.length === 0) return null

  const timeFilterLabel = timeFilter === 'peak' ? ' (peak)' : timeFilter === 'offpeak' ? ' (off-peak)' : ''

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <CardTitle className="text-base font-bold text-[#313131]">
              {isWeekly ? 'Weekly' : 'Monthly'} {metric === 'cost' ? 'Cost' : 'Price'} Trend
            </CardTitle>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {metric === 'cost'
                ? `Dynamic cost (${loadProfile})`
                : `Average ${metric === 'spot' ? 'spot' : `end-customer (${loadProfile})`} price`
              }{timeFilterLabel} by {isWeekly ? 'week' : 'month'} · {years[0]}–{years[years.length - 1]}
            </p>
          </div>
          <div className="flex gap-2 flex-wrap">
            {/* Resolution toggle — v2 pill style */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              <button
                onClick={() => setResolution('monthly')}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${!isWeekly ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Monthly
              </button>
              <button
                onClick={() => setResolution('weekly')}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${isWeekly ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Weekly
              </button>
            </div>
            {/* Metric toggle — v2 pill style */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              <button
                onClick={() => setMetric('spot')}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${metric === 'spot' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Spot
              </button>
              <button
                onClick={() => setMetric('end')}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${metric === 'end' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                End Customer
              </button>
              <button
                onClick={() => setMetric('cost')}
                className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${metric === 'cost' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
              >
                Cost (EUR)
              </button>
            </div>
            {/* Peak / Off-Peak toggle — v2 pill style */}
            <div className="relative flex items-center gap-1.5" ref={infoRef}>
              <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                <button
                  onClick={() => setTimeFilter('all')}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${timeFilter === 'all' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  All
                </button>
                <button
                  onClick={() => setTimeFilter('peak')}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${timeFilter === 'peak' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Peak
                </button>
                <button
                  onClick={() => setTimeFilter('offpeak')}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${timeFilter === 'offpeak' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  Off-Peak
                </button>
              </div>
              <div
                className="relative"
                onMouseEnter={() => setShowPeakInfo(true)}
                onMouseLeave={() => setShowPeakInfo(false)}
              >
                <div
                  className="w-4 h-4 rounded-full bg-gray-200 hover:bg-gray-300 text-gray-500 text-[10px] font-bold flex items-center justify-center transition-colors cursor-help"
                  aria-label="Peak/off-peak definition"
                >
                  ?
                </div>
              {showPeakInfo && (
                  <div className="absolute right-0 top-full mt-1.5 z-50 bg-white border border-gray-200 rounded-xl shadow-xl p-4 w-[280px] text-[11px] text-gray-600 leading-relaxed">
                    <div className="mb-3">
                      <span className="font-bold text-[13px] text-[#313131]">Peak / Off-Peak</span>
                    </div>
                    <div className="space-y-3">
                      <div className="flex gap-2">
                        <div className="w-1 rounded-full bg-amber-400 shrink-0" />
                        <div>
                          <p className="font-semibold text-[#313131] mb-0.5">Peak hours</p>
                          <p>Monday – Friday, 08:00 – 20:00</p>
                          <p className="text-gray-400 mt-0.5">Higher demand, typically higher prices</p>
                        </div>
                      </div>
                      <div className="flex gap-2">
                        <div className="w-1 rounded-full bg-blue-400 shrink-0" />
                        <div>
                          <p className="font-semibold text-[#313131] mb-0.5">Off-peak hours</p>
                          <p>Monday – Friday, 20:00 – 08:00</p>
                          <p>Saturdays, Sundays &amp; holidays (all day)</p>
                          <p className="text-gray-400 mt-0.5">Lower demand, typically lower prices</p>
                        </div>
                      </div>
                      <div className="border-t border-gray-100 pt-2 text-[10px] text-gray-400">
                        Based on BDEW day-type classification (WT/SA/SO). Holidays are treated as off-peak.
                      </div>
                    </div>
                  </div>
              )}
              </div>
          </div>
        </div>
      </div>
      </CardHeader>
      <CardContent className="pt-4 space-y-4">
        {/* Line chart */}
        <div className={isWeekly ? 'h-[260px]' : 'h-[220px]'}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 8, right: 12, bottom: 2, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="period"
                tick={{ fontSize: isWeekly ? 8 : 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                interval={isWeekly ? 3 : 0}
              />
              <YAxis
                domain={yDomain}
                tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                label={{ value: metric === 'cost' ? 'EUR' : 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }}
              />
              <Tooltip
                content={({ active, payload, label }) => {
                  if (!active || !payload?.length) return null
                  return (
                    <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-3 text-[11px]">
                      <p className="font-semibold text-gray-700 mb-1.5">{label}{timeFilterLabel}</p>
                      {payload.filter(p => p.value != null && !hiddenYears.has(Number(p.dataKey))).map(p => (
                        <div key={p.dataKey} className="flex justify-between gap-4">
                          <span style={{ color: p.color }}>{p.dataKey}</span>
                          <span className="tabular-nums font-mono font-semibold">{Number(p.value).toFixed(2)} {metric === 'cost' ? 'EUR' : 'ct'}</span>
                        </div>
                      ))}
                    </div>
                  )
                }}
              />
              {years.map((y, i) => {
                const hidden = hiddenYears.has(y)
                return (
                  <Line
                    key={y}
                    dataKey={String(y)}
                    type="monotone"
                    stroke={YEAR_COLORS[i % YEAR_COLORS.length]}
                    strokeWidth={hidden ? 0 : (y === years[years.length - 1] ? 3 : 2)}
                    strokeOpacity={hidden ? 0 : (y === years[years.length - 1] ? 1 : 0.7)}
                    dot={hidden ? false : (isWeekly ? false : { r: y === years[years.length - 1] ? 3.5 : 2.5, strokeWidth: 0, fill: YEAR_COLORS[i % YEAR_COLORS.length] })}
                    activeDot={hidden ? false : { r: 4 }}
                    connectNulls={false}
                    isAnimationActive={true}
                    animationDuration={400}
                    animationEasing="ease-in-out"
                  />
                )
              })}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Legend — click to toggle years */}
        <div className="flex items-center gap-1 text-[10px] text-gray-500">
          {years.map((y, i) => {
            const hidden = hiddenYears.has(y)
            return (
              <button
                key={y}
                onClick={() => setHiddenYears(prev => {
                  const next = new Set(prev)
                  if (next.has(y)) next.delete(y); else next.add(y)
                  return next
                })}
                className={`flex items-center gap-1 px-2 py-0.5 rounded-full border transition-all cursor-pointer ${
                  hidden
                    ? 'border-gray-200 bg-white opacity-40'
                    : 'border-transparent bg-gray-50 hover:bg-gray-100'
                }`}
              >
                <span
                  className="w-3 rounded-full transition-all"
                  style={{
                    height: 2.5,
                    backgroundColor: YEAR_COLORS[i % YEAR_COLORS.length],
                    opacity: hidden ? 0.3 : (y === years[years.length - 1] ? 1 : 0.7),
                  }}
                />
                <span className={`tabular-nums transition-opacity ${
                  hidden ? 'line-through text-gray-300' : (y === years[years.length - 1] ? 'font-semibold text-[#313131]' : '')
                }`}>{y}</span>
              </button>
            )
          })}
        </div>

        {/* Heatmap table — monthly view */}
        {!isWeekly && (
          <div className="overflow-x-auto">
            <table className="w-full text-[10px]">
              <thead>
                <tr>
                  <th className="text-left text-gray-400 font-semibold pr-2 pb-1">Year</th>
                  {MONTHS_SHORT.map(m => (
                    <th key={m} className="text-center text-gray-400 font-medium pb-1 px-0.5">{m}</th>
                  ))}
                  <th className="text-center text-gray-400 font-semibold pl-2 pb-1">{metric === 'cost' ? 'Total' : 'Avg'}</th>
                </tr>
              </thead>
              <tbody>
                {years.map(y => {
                  const yearEntries = periodData.filter(m => m.year === y)
                  const yearVals = yearEntries.map(e => metric === 'spot' ? e.avgSpot : metric === 'end' ? e.avgEnd : e.costEur)
                  const yearAvg = yearVals.length > 0 ? (metric === 'cost' ? yearVals.reduce((a, b) => a + b, 0) : yearVals.reduce((a, b) => a + b, 0) / yearVals.length) : 0
                  return (
                    <tr key={y}>
                      <td className="text-left font-semibold text-[#313131] pr-2 py-0.5 tabular-nums">{y}</td>
                      {MONTHS_SHORT.map((_, mi) => {
                        const entry = yearEntries.find(e => e.periodIdx === mi)
                        if (!entry) return <td key={mi} className="text-center px-0.5 py-0.5"><span className="text-gray-200">&mdash;</span></td>
                        const val = metric === 'spot' ? entry.avgSpot : metric === 'end' ? entry.avgEnd : entry.costEur
                        return (
                          <td key={mi} className="text-center px-0.5 py-0.5">
                            <span
                              className="inline-block rounded px-1 py-0.5 tabular-nums font-mono font-medium min-w-[36px]"
                              style={{ background: priceColor(val, heatmapRange.min, heatmapRange.max) }}
                            >
                              {metric === 'cost' ? val.toFixed(2) : val.toFixed(1)}
                            </span>
                          </td>
                        )
                      })}
                      <td className="text-center pl-2 py-0.5">
                        <span className="inline-block rounded px-1 py-0.5 tabular-nums font-mono font-bold min-w-[36px] bg-gray-100">
                          {metric === 'cost' ? yearAvg.toFixed(1) : yearAvg.toFixed(1)}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Heatmap table — weekly view with H1/H2 toggle */}
        {isWeekly && (
          <div className="space-y-2">
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5 w-fit">
              {(['h1', 'h2', 'all'] as const).map(h => (
                <button
                  key={h}
                  onClick={() => setWeeklyHalf(h)}
                  className={`text-[10px] font-semibold px-2.5 py-0.5 rounded-full transition-colors ${weeklyHalf === h ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                >
                  {h === 'h1' ? 'H1 (W1–26)' : h === 'h2' ? 'H2 (W27–52)' : 'Full Year'}
                </button>
              ))}
            </div>
            <div className="flex gap-0">
              {/* Sticky left: Year + Avg columns */}
              <table className="text-[9px] shrink-0">
                <thead>
                  <tr>
                    <th className="text-left text-gray-400 font-semibold pr-1.5 pb-1">Year</th>
                    <th className="text-center text-gray-400 font-semibold px-1 pb-1">Avg</th>
                  </tr>
                </thead>
                <tbody>
                  {years.map(y => {
                    const yearEntries = periodData.filter(m => m.year === y && m.periodIdx >= heatmapWeekRange[0] && m.periodIdx < heatmapWeekRange[1])
                    const yearVals = yearEntries.map(e => metric === 'spot' ? e.avgSpot : metric === 'end' ? e.avgEnd : e.costEur)
                    const yearAvg = yearVals.length > 0 ? (metric === 'cost' ? yearVals.reduce((a, b) => a + b, 0) : yearVals.reduce((a, b) => a + b, 0) / yearVals.length) : 0
                    return (
                      <tr key={y}>
                        <td className="text-left font-semibold text-[#313131] pr-1.5 py-0.5 tabular-nums">{y}</td>
                        <td className="text-center px-1 py-0.5">
                          <span className="inline-block rounded px-0.5 py-0.5 tabular-nums font-mono font-bold min-w-[26px] bg-gray-100">
                            {yearAvg.toFixed(1)}
                          </span>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {/* Scrollable weeks area */}
              <div className={`relative flex-1 min-w-0 ${weeklyHalf === 'all' ? 'overflow-x-auto scrollbar-thin' : ''}`}
                style={weeklyHalf === 'all' ? { scrollbarWidth: 'thin', scrollbarColor: '#D1D5DB transparent' } : undefined}
              >
                <table className={`text-[9px] ${weeklyHalf !== 'all' ? 'w-full' : ''}`}>
                  <thead>
                    <tr>
                      {heatmapWeekLabels.map(w => (
                        <th key={w} className="text-center text-gray-400 font-medium pb-1 px-0.5 min-w-[28px]">{w}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {years.map(y => {
                      const yearEntries = periodData.filter(m => m.year === y)
                      return (
                        <tr key={y}>
                          {heatmapWeekLabels.map((_, i) => {
                            const wi = heatmapWeekRange[0] + i
                            const entry = yearEntries.find(e => e.periodIdx === wi)
                            if (!entry) return <td key={wi} className="text-center px-0.5 py-0.5"><span className="text-gray-200">–</span></td>
                            const val = metric === 'spot' ? entry.avgSpot : metric === 'end' ? entry.avgEnd : entry.costEur
                            return (
                              <td key={wi} className="text-center px-0.5 py-0.5">
                                <span
                                  className="inline-block rounded px-0.5 py-0.5 tabular-nums font-mono font-medium min-w-[26px]"
                                  style={{ background: priceColor(val, heatmapRange.min, heatmapRange.max) }}
                                >
                                  {metric === 'cost' ? val.toFixed(1) : val.toFixed(1)}
                                </span>
                              </td>
                            )
                          })}
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
