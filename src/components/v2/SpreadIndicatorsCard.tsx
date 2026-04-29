'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell,
} from 'recharts'
import type { HourlyPrice } from '@/lib/v2-config'
import {
  computeSpread, buildMultiDayWindow, addDaysStr, getDow,
  nextDayStr,
  type SpreadResult,
} from '@/lib/charging-helpers'

interface Props {
  hourlyPrices: HourlyPrice[]
  selectedDate: string
  plugInTime: number
  departureTime: number
  energyPerSession: number
  chargePowerKw: number
}

interface MonthlySpreadEntry {
  month: string
  label: string
  overnightSpread: number
  weekendSpread: number | null
  weeklySpread: number
  overnightSavingsCtKwh: number
  weekendSavingsCtKwh: number | null
  weeklySavingsCtKwh: number
  days: number
  season: string
  year: number
}

const SEASON_COLORS: Record<string, string> = {
  winter: '#7EB8E8', spring: '#6AC09A', summer: '#E8C94A', autumn: '#E8A066',
}
const SEASON_BG: Record<string, string> = {
  winter: '#EFF6FF', spring: '#F0FDF4', summer: '#FEFCE8', autumn: '#FFF7ED',
}

function getSeason(m: number): 'winter' | 'spring' | 'summer' | 'autumn' {
  return m <= 2 || m === 12 ? 'winter' : m <= 5 ? 'spring' : m <= 8 ? 'summer' : 'autumn'
}

function SpreadTile({ label, spread, sublabel, na }: {
  label: string
  spread: SpreadResult | null
  sublabel?: string
  na?: string
}) {
  if (na || !spread) {
    return (
      <div className="flex-1 min-w-[140px] rounded-lg border border-gray-200 bg-gray-50/60 px-3 py-2.5">
        <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
        <p className="text-lg font-bold text-gray-300 tabular-nums">N/A</p>
        {na && <p className="text-[10px] text-gray-400 mt-0.5">{na}</p>}
      </div>
    )
  }
  return (
    <TooltipProvider delayDuration={200}>
      <UITooltip>
        <TooltipTrigger asChild>
          <div className="flex-1 min-w-[140px] rounded-lg border border-gray-200 bg-white px-3 py-2.5 cursor-default hover:border-gray-300 transition-colors">
            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-1">{label}</p>
            <div className="flex items-baseline gap-2">
              <AnimatedNumber value={spread.marketSpreadCtKwh} decimals={1} suffix=" ct" className="text-lg font-extrabold text-[#313131] tabular-nums leading-none" />
              <span className="text-[11px] font-semibold text-emerald-600 tabular-nums">
                {spread.capturableSavingsCtKwh.toFixed(1)} ct savings
              </span>
            </div>
            {sublabel && <p className="text-[10px] text-gray-400 mt-1">{sublabel}</p>}
          </div>
        </TooltipTrigger>
        <TooltipContent side="bottom" className="text-[11px] space-y-0.5 max-w-[220px]">
          <p>Cheapest: <span className="font-semibold">{spread.cheapestHour}</span>{spread.cheapestDate ? ` (${spread.cheapestDate})` : ''} — {spread.minPriceCtKwh.toFixed(1)} ct</p>
          <p>Most expensive: <span className="font-semibold">{spread.expensiveHour}</span>{spread.expensiveDate ? ` (${spread.expensiveDate})` : ''} — {spread.maxPriceCtKwh.toFixed(1)} ct</p>
          <p className="text-gray-400">{spread.hoursInWindow} hours in window</p>
        </TooltipContent>
      </UITooltip>
    </TooltipProvider>
  )
}

export function SpreadIndicatorsCard({
  hourlyPrices, selectedDate, plugInTime, departureTime,
  energyPerSession, chargePowerKw,
}: Props) {
  // ── Overnight Spread (selected date) ──
  const overnightSpread = useMemo(() => {
    const nd = nextDayStr(selectedDate)
    const window = buildMultiDayWindow(hourlyPrices, selectedDate, nd, plugInTime, departureTime)
    return computeSpread(window, energyPerSession, chargePowerKw)
  }, [hourlyPrices, selectedDate, plugInTime, departureTime, energyPerSession, chargePowerKw])

  // ── Weekend Spread (only if Friday) ──
  const isFriday = getDow(selectedDate) === 5
  const weekendSpread = useMemo(() => {
    if (!isFriday) return null
    const mondayDate = addDaysStr(selectedDate, 3)
    const window = buildMultiDayWindow(hourlyPrices, selectedDate, mondayDate, plugInTime, departureTime)
    if (window.length < 2) return null
    return computeSpread(window, energyPerSession, chargePowerKw)
  }, [hourlyPrices, selectedDate, plugInTime, departureTime, energyPerSession, chargePowerKw, isFriday])

  // ── Weekly Spread (7-day rolling from plugInTime) ──
  const weeklySpread = useMemo(() => {
    const endDate = addDaysStr(selectedDate, 7)
    const window = buildMultiDayWindow(hourlyPrices, selectedDate, endDate, plugInTime, departureTime)
    if (window.length < 24) return null // need at least ~1 day of data
    return computeSpread(window, energyPerSession, chargePowerKw)
  }, [hourlyPrices, selectedDate, plugInTime, departureTime, energyPerSession, chargePowerKw])

  // ── Weekly Price Curve with 3 Horizons ──
  const weeklyPriceData = useMemo(() => {
    if (hourlyPrices.length === 0) return null
    const endDate = addDaysStr(selectedDate, 7)
    // All hourly prices for the 7-day window
    const weekPrices = hourlyPrices
      .filter(p => p.date >= selectedDate && p.date <= endDate)
      .sort((a, b) => a.timestamp - b.timestamp)
    if (weekPrices.length < 24) return null

    const chargeSlotsNeeded = Math.ceil(energyPerSession / chargePowerKw)
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

    // Build chart points
    const points = weekPrices.map((p, idx) => {
      const dow = new Date(p.timestamp).getUTCDay()
      return {
        idx,
        timestamp: p.timestamp,
        date: p.date,
        hour: p.hour,
        price: p.priceCtKwh,
        label: `${dayNames[dow]} ${String(p.hour).padStart(2, '0')}:00`,
        dayLabel: idx % 24 === 0 ? dayNames[dow] : '',
      }
    })

    // Define horizons
    type Horizon = {
      name: string; color: string; bgColor: string
      prices: typeof weekPrices
      optimalIndices: Set<number>
      spread: SpreadResult | null
    }

    function buildHorizon(
      name: string, color: string, bgColor: string,
      windowPrices: HourlyPrice[],
    ): Horizon {
      const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
      const optimal = new Set(sorted.slice(0, chargeSlotsNeeded).map(p => p.timestamp))
      const spread = computeSpread(windowPrices, energyPerSession, chargePowerKw)
      return { name, color, bgColor, prices: windowPrices, optimalIndices: optimal, spread }
    }

    // Overnight: plugInTime → departureTime next day
    const nd = nextDayStr(selectedDate)
    const overnightWin = buildMultiDayWindow(hourlyPrices, selectedDate, nd, plugInTime, departureTime)
    const overnight = buildHorizon('Overnight', '#3B82F6', '#DBEAFE', overnightWin)

    // 24h: plugInTime → plugInTime+24h (next day same time)
    const fullDayWin = weekPrices.filter(p => {
      if (p.date === selectedDate) return p.hour >= plugInTime
      if (p.date === nd) return p.hour < plugInTime
      return false
    })
    const fullDay = buildHorizon('24 Hours', '#8B5CF6', '#EDE9FE', fullDayWin)

    // Weekend: if Friday, plugInTime → Monday departureTime
    let weekend: Horizon | null = null
    if (isFriday) {
      const mondayDate = addDaysStr(selectedDate, 3)
      const weekendWin = buildMultiDayWindow(hourlyPrices, selectedDate, mondayDate, plugInTime, departureTime)
      if (weekendWin.length > 0) {
        weekend = buildHorizon('Weekend', '#F59E0B', '#FEF3C7', weekendWin)
      }
    }

    // Full week: plugInTime → day+7 departureTime
    const fullWeekWin = buildMultiDayWindow(hourlyPrices, selectedDate, endDate, plugInTime, departureTime)
    const fullWeek = buildHorizon('Full Week', '#10B981', '#D1FAE5', fullWeekWin)

    // Mark optimal hours on chart points for each horizon
    const chartPoints = points.map(p => {
      const ts = weekPrices[p.idx]?.timestamp
      return {
        ...p,
        overnightOptimal: overnight.optimalIndices.has(ts) ? p.price : null,
        fullDayOptimal: fullDay.optimalIndices.has(ts) ? p.price : null,
        weekendOptimal: weekend?.optimalIndices.has(ts) ? p.price : null,
        fullWeekOptimal: fullWeek.optimalIndices.has(ts) ? p.price : null,
      }
    })

    return { chartPoints, horizons: [overnight, fullDay, ...(weekend ? [weekend] : []), fullWeek] }
  }, [hourlyPrices, selectedDate, plugInTime, departureTime, energyPerSession, chargePowerKw, isFriday])

  // ── 12-Month Historical Breakdown ──
  const monthlySpreadData = useMemo(() => {
    if (hourlyPrices.length === 0) return []
    const startRoll = addDaysStr(selectedDate, -365)
    const relevantPrices = hourlyPrices.filter(p => p.date >= startRoll && p.date <= selectedDate)
    if (relevantPrices.length === 0) return []

    // Index prices by date
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of relevantPrices) {
      const arr = byDate.get(p.date) || []
      arr.push(p)
      byDate.set(p.date, arr)
    }

    // For each date, compute overnight spread + savings
    const monthMap = new Map<string, {
      oSpreads: number[]; oSavingsCtKwh: number[]
      weSpreads: number[]; weSavingsCtKwh: number[]
      wkSpreads: number[]; wkSavingsCtKwh: number[]
    }>()

    const dates = [...byDate.keys()].sort()
    for (const dDate of dates) {
      const month = dDate.slice(0, 7)
      const entry = monthMap.get(month) || {
        oSpreads: [], oSavingsCtKwh: [],
        weSpreads: [], weSavingsCtKwh: [],
        wkSpreads: [], wkSavingsCtKwh: [],
      }

      // Overnight
      const nd = nextDayStr(dDate)
      const ndPrices = byDate.get(nd)
      if (ndPrices && ndPrices.length > 0) {
        const dPrices = byDate.get(dDate) || []
        const eve = dPrices.filter(p => p.hour >= plugInTime)
        const morn = ndPrices.filter(p => p.hour < departureTime)
        const oWin = [...eve, ...morn]
        if (oWin.length >= 2) {
          const sp = computeSpread(oWin, energyPerSession, chargePowerKw)
          if (sp) {
            entry.oSpreads.push(sp.marketSpreadCtKwh)
            entry.oSavingsCtKwh.push(sp.capturableSavingsCtKwh)
          }
        }
      }

      // Weekend (Friday only)
      const dow = getDow(dDate)
      if (dow === 5) {
        const mondayDate = addDaysStr(dDate, 3)
        const weWin = buildMultiDayWindow(relevantPrices, dDate, mondayDate, plugInTime, departureTime)
        if (weWin.length >= 2) {
          const sp = computeSpread(weWin, energyPerSession, chargePowerKw)
          if (sp) {
            entry.weSpreads.push(sp.marketSpreadCtKwh)
            entry.weSavingsCtKwh.push(sp.capturableSavingsCtKwh)
          }
        }
      }

      // Weekly (every day — from plugInTime, 7 days forward)
      const endWk = addDaysStr(dDate, 7)
      const wkWin = buildMultiDayWindow(relevantPrices, dDate, endWk, plugInTime, departureTime)
      if (wkWin.length >= 24) {
        const sp = computeSpread(wkWin, energyPerSession, chargePowerKw)
        if (sp) {
          entry.wkSpreads.push(sp.marketSpreadCtKwh)
          entry.wkSavingsCtKwh.push(sp.capturableSavingsCtKwh)
        }
      }

      monthMap.set(month, entry)
    }

    const avg = (arr: number[]) => arr.length > 0 ? arr.reduce((s, v) => s + v, 0) / arr.length : 0

    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-12)
      .map(([month, data]): MonthlySpreadEntry => {
        const [y, m] = month.split('-').map(Number)
        const label = new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'short' })
        return {
          month, label,
          overnightSpread: Math.round(avg(data.oSpreads) * 100) / 100,
          weekendSpread: data.weSpreads.length > 0 ? Math.round(avg(data.weSpreads) * 100) / 100 : null,
          weeklySpread: Math.round(avg(data.wkSpreads) * 100) / 100,
          overnightSavingsCtKwh: Math.round(avg(data.oSavingsCtKwh) * 100) / 100,
          weekendSavingsCtKwh: data.weSavingsCtKwh.length > 0 ? Math.round(avg(data.weSavingsCtKwh) * 100) / 100 : null,
          weeklySavingsCtKwh: Math.round(avg(data.wkSavingsCtKwh) * 100) / 100,
          days: data.oSpreads.length,
          season: getSeason(m),
          year: y,
        }
      })
  }, [hourlyPrices, selectedDate, plugInTime, departureTime, energyPerSession, chargePowerKw])

  const last12 = monthlySpreadData.map(d => ({
    ...d,
    displayLabel: d.label === 'Jan' ? `Jan '${String(d.year).slice(2)}` : d.label,
  }))

  // Yearly averages
  const yearlyAvgSpread = last12.length > 0
    ? Math.round(last12.reduce((s, d) => s + d.overnightSpread, 0) / last12.length * 100) / 100
    : 0

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">Spread Indicators</CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          Market spread (max−min) and capturable savings for different charging windows
        </p>
      </CardHeader>
      <CardContent className="pt-4 space-y-5">
        {/* ── KPI Tiles ── */}
        <div className="flex gap-3 flex-wrap">
          <SpreadTile
            label="Overnight"
            spread={overnightSpread}
            sublabel={overnightSpread ? `${plugInTime}:00 → ${departureTime}:00` : undefined}
          />
          <SpreadTile
            label="Weekend"
            spread={weekendSpread}
            na={!isFriday ? 'Select a Friday' : weekendSpread ? undefined : 'Data not available'}
            sublabel={weekendSpread ? `Fri ${plugInTime}:00 → Mon ${departureTime}:00` : undefined}
          />
          <SpreadTile
            label="7-Day Rolling"
            spread={weeklySpread}
            na={!weeklySpread ? 'Insufficient data' : undefined}
            sublabel={weeklySpread?.cheapestDate && weeklySpread.expensiveDate
              ? `Cheapest: ${weeklySpread.cheapestDate.slice(5)} ${weeklySpread.cheapestHour} · Peak: ${weeklySpread.expensiveDate.slice(5)} ${weeklySpread.expensiveHour}`
              : undefined}
          />
        </div>

        {/* ── Weekly Price Curve with Horizons ── */}
        {weeklyPriceData && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-500">Weekly Price Curve — Charging Horizons</p>
              <p className="text-[10px] text-gray-400">
                {selectedDate} · plug-in {plugInTime}:00
              </p>
            </div>
            {/* Horizon summary cards */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-3">
              {weeklyPriceData.horizons.map(h => (
                <div key={h.name} className="rounded-md border px-2.5 py-2" style={{ borderColor: h.color + '40', background: h.bgColor + '60' }}>
                  <div className="flex items-center gap-1.5 mb-1">
                    <span className="w-2 h-2 rounded-full" style={{ background: h.color }} />
                    <span className="text-[10px] font-bold uppercase tracking-wider" style={{ color: h.color }}>{h.name}</span>
                  </div>
                  {h.spread ? (
                    <>
                      <p className="text-[13px] font-extrabold text-[#313131] tabular-nums leading-tight">
                        {h.spread.marketSpreadCtKwh.toFixed(1)} <span className="text-[10px] font-semibold text-gray-400">ct spread</span>
                      </p>
                      <p className="text-[11px] font-semibold tabular-nums" style={{ color: h.color }}>
                        {h.spread.capturableSavingsCtKwh.toFixed(1)} ct savings
                      </p>
                      <p className="text-[9px] text-gray-400 mt-0.5">
                        Best: {h.spread.cheapestHour}{h.spread.cheapestDate !== selectedDate ? ` (${h.spread.cheapestDate?.slice(5)})` : ''}
                      </p>
                    </>
                  ) : (
                    <p className="text-[11px] text-gray-400">N/A</p>
                  )}
                </div>
              ))}
            </div>
            {/* Price curve */}
            <div className="h-[220px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={weeklyPriceData.chartPoints} margin={{ top: 8, right: 12, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis
                    dataKey="idx"
                    tick={((props: any) => {
                      const { x, y, payload } = props as { x: number; y: number; payload: { value: number } }
                      const pt = weeklyPriceData.chartPoints[payload.value]
                      if (!pt || pt.hour !== 0) return <g />
                      const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
                      const dow = new Date(pt.timestamp).getUTCDay()
                      return (
                        <text x={x} y={y + 12} textAnchor="middle" fontSize={9} fontWeight={600} fill="#6B7280">
                          {dayNames[dow]}
                        </text>
                      )
                    }) as any}
                    tickLine={false} axisLine={false} interval={0}
                  />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as (typeof weeklyPriceData.chartPoints)[number]
                      const parts: string[] = []
                      if (d.overnightOptimal !== null) parts.push('Overnight optimal')
                      if (d.fullDayOptimal !== null) parts.push('24h optimal')
                      if (d.weekendOptimal !== null) parts.push('Weekend optimal')
                      if (d.fullWeekOptimal !== null) parts.push('Week optimal')
                      return (
                        <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                          <p className="text-gray-500 text-[10px]">{d.label}</p>
                          <p className="font-semibold tabular-nums text-[#313131]">{d.price.toFixed(2)} ct/kWh</p>
                          {parts.length > 0 && (
                            <p className="text-[10px] text-emerald-600 font-medium">{parts.join(' · ')}</p>
                          )}
                        </div>
                      )
                    }}
                  />
                  {/* Price line */}
                  <Line type="monotone" dataKey="price" stroke="#9CA3AF" strokeWidth={1.5} dot={false} activeDot={{ r: 3 }} />
                  {/* Optimal charging dots for each horizon */}
                  <Line type="monotone" dataKey="overnightOptimal" stroke="none"
                    dot={((p: any) => {
                      const { cx, cy, value } = p
                      return value != null ? <circle cx={cx} cy={cy} r={3.5} fill="#3B82F6" stroke="#fff" strokeWidth={1.5} /> : <g />
                    }) as any} activeDot={false} />
                  <Line type="monotone" dataKey="fullDayOptimal" stroke="none"
                    dot={((p: any) => {
                      const { cx, cy, value } = p
                      return value != null ? <circle cx={cx} cy={cy} r={3} fill="#8B5CF6" stroke="#fff" strokeWidth={1.5} /> : <g />
                    }) as any} activeDot={false} />
                  {weeklyPriceData.horizons.some(h => h.name === 'Weekend') && (
                    <Line type="monotone" dataKey="weekendOptimal" stroke="none"
                      dot={((p: any) => {
                        const { cx, cy, value } = p
                        return value != null ? <circle cx={cx} cy={cy} r={3} fill="#F59E0B" stroke="#fff" strokeWidth={1.5} /> : <g />
                      }) as any} activeDot={false} />
                  )}
                  <Line type="monotone" dataKey="fullWeekOptimal" stroke="none"
                    dot={((p: any) => {
                      const { cx, cy, value } = p
                      return value != null ? <circle cx={cx} cy={cy} r={2.5} fill="#10B981" stroke="#fff" strokeWidth={1} /> : <g />
                    }) as any} activeDot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex items-center gap-4 text-[10px] text-gray-500 mt-2 flex-wrap">
              <span className="flex items-center gap-1">
                <span className="inline-block w-6 border-t border-gray-400" />
                Price
              </span>
              {weeklyPriceData.horizons.map(h => (
                <span key={h.name} className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ background: h.color }} />
                  {h.name} optimal hours
                </span>
              ))}
            </div>
          </div>
        )}

        {/* ── 12-Month Chart ── */}
        {last12.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-gray-500">12-Month Overnight Spread — Rolling Average</p>
              <p className="text-[10px] text-gray-400 tabular-nums">Avg {yearlyAvgSpread.toFixed(1)} ct/kWh</p>
            </div>
            <div className="h-[180px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={last12} margin={{ top: 8, right: 42, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="displayLabel" tick={{ fontSize: 10, fontWeight: 500, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                  <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct savings', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload as (typeof last12)[number]
                      return (
                        <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                          <p className="text-gray-500 text-[10px]">{d.month} · {d.season} · {d.days} nights</p>
                          <p className="font-semibold tabular-nums text-[#313131]">Overnight: {d.overnightSpread.toFixed(1)} ct spread <span className="text-emerald-600">({d.overnightSavingsCtKwh.toFixed(1)} ct savings)</span></p>
                          {d.weekendSpread !== null && (
                            <p className="text-gray-600 tabular-nums">Weekend: {d.weekendSpread.toFixed(1)} ct spread <span className="text-emerald-600">({d.weekendSavingsCtKwh!.toFixed(1)} ct savings)</span></p>
                          )}
                          {d.weeklySpread > 0 && (
                            <p className="text-gray-600 tabular-nums">Weekly: {d.weeklySpread.toFixed(1)} ct spread <span className="text-emerald-600">({d.weeklySavingsCtKwh.toFixed(1)} ct savings)</span></p>
                          )}
                        </div>
                      )
                    }}
                  />
                  <Bar yAxisId="left" dataKey="overnightSpread" radius={[3, 3, 0, 0]} maxBarSize={28}>
                    {last12.map((d, i) => (
                      <Cell key={i} fill={SEASON_COLORS[d.season] || '#6B7280'} fillOpacity={0.75} />
                    ))}
                  </Bar>
                  <Line yAxisId="right" dataKey="overnightSavingsCtKwh" type="monotone"
                    stroke="#10B981" strokeWidth={1.5} strokeDasharray="4 3"
                    dot={false} activeDot={{ r: 3, fill: '#10B981' }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Legend */}
            <div className="flex items-center justify-between text-[10px] text-gray-500 mt-2 flex-wrap gap-2">
              <div className="flex items-center gap-3">
                {(['winter', 'spring', 'summer', 'autumn'] as const).map(s => (
                  <span key={s} className="flex items-center gap-1 capitalize">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SEASON_COLORS[s], opacity: 0.75 }} />
                    {s}
                  </span>
                ))}
              </div>
              <span className="flex items-center gap-1.5 text-gray-400">
                <span className="inline-block w-6 border-t border-dashed" style={{ borderColor: '#10B981' }} />
                Capturable savings (ct/kWh)
              </span>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
