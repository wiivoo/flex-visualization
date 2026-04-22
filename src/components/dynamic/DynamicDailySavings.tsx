'use client'

import { useMemo, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import type { DailyResult } from '@/lib/dynamic-tariff'

interface Props {
  dailyBreakdown: DailyResult[]
  selectedDate: string
  onSelect: (date: string) => void
  yearlyKwh: number
  fixedPrice: number
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const BUCKETS = [
  { color: '#86EFAC', test: (s: number) => s > 0.03, label: 'much cheaper' },
  { color: '#DCFCE7', test: (s: number) => s > 0.01 && s <= 0.03, label: 'slightly cheaper' },
  { color: '#FEF3C7', test: (s: number) => s > -0.01 && s <= 0.01, label: 'roughly equal' },
  { color: '#FED7AA', test: (s: number) => s > -0.03 && s <= -0.01, label: 'slightly more' },
  { color: '#FCA5A5', test: (s: number) => s <= -0.03, label: 'much more' },
]

function isoWeekday(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z').getUTCDay()
  return d === 0 ? 6 : d - 1
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

export function DynamicDailySavings({ dailyBreakdown, selectedDate, onSelect, yearlyKwh, fixedPrice }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [previewDate, setPreviewDate] = useState<string | null>(null)
  const [activeBuckets, setActiveBuckets] = useState<Set<number> | null>(null)

  // Build map for quick lookup
  const dayMap = useMemo(() => {
    const m = new Map<string, DailyResult>()
    for (const d of dailyBreakdown) m.set(d.date, d)
    return m
  }, [dailyBreakdown])

  // Grid layout
  const { grid, weeks, monthLabels, quarterWeeks } = useMemo(() => {
    if (dailyBreakdown.length === 0) return { grid: [], weeks: 0, monthLabels: [], quarterWeeks: new Set<number>() }

    const dates = [...dayMap.keys()].sort()
    const firstDate = dates[0]
    const lastDate = dates[dates.length - 1]

    const firstWd = isoWeekday(firstDate)
    const startDate = new Date(new Date(firstDate + 'T12:00:00Z').getTime() - firstWd * 86400000)
    const lastWd = isoWeekday(lastDate)
    const endDate = new Date(new Date(lastDate + 'T12:00:00Z').getTime() + (6 - lastWd) * 86400000)

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
    const totalWeeks = Math.ceil(totalDays / 7)

    const cells: { date: string; weekIdx: number; dayIdx: number }[] = []
    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getTime() + i * 86400000)
      cells.push({ date: d.toISOString().slice(0, 10), weekIdx: Math.floor(i / 7), dayIdx: i % 7 })
    }

    const labels: { label: string; weekIdx: number }[] = []
    let lastMonth = -1
    for (const cell of cells) {
      if (cell.dayIdx !== 0) continue
      const month = new Date(cell.date + 'T12:00:00Z').getUTCMonth()
      if (month !== lastMonth) {
        labels.push({ label: MONTHS_SHORT[month], weekIdx: cell.weekIdx })
        lastMonth = month
      }
    }

    const qWeeks = new Set<number>()
    for (const lbl of labels) {
      if (['Jan', 'Apr', 'Jul', 'Oct'].includes(lbl.label) && lbl.weekIdx > 0) qWeeks.add(lbl.weekIdx)
    }

    return { grid: cells, weeks: totalWeeks, monthLabels: labels, quarterWeeks: qWeeks }
  }, [dayMap, dailyBreakdown.length])

  const isFiltering = activeBuckets !== null
  const bucketCount = BUCKETS.length

  // Filtered data for stats
  const filteredBreakdown = useMemo(() => {
    if (!isFiltering) return dailyBreakdown
    return dailyBreakdown.filter(d => {
      const s = d.fixedCostEur - d.dynamicCostEur
      const idx = BUCKETS.findIndex(b => b.test(s))
      return idx >= 0 && activeBuckets!.has(idx)
    })
  }, [dailyBreakdown, isFiltering, activeBuckets])

  // Stats
  const stats = useMemo(() => {
    if (filteredBreakdown.length === 0) return { count: 0, totalDynamic: 0, totalFixed: 0, totalSavings: 0, avgDynamicCt: 0, daysGreen: 0, daysRed: 0 }
    const count = filteredBreakdown.length
    const totalDynamic = filteredBreakdown.reduce((s, d) => s + d.dynamicCostEur, 0)
    const totalFixed = filteredBreakdown.reduce((s, d) => s + d.fixedCostEur, 0)
    const totalKwh = filteredBreakdown.reduce((s, d) => s + d.consumptionKwh, 0)
    const avgDynamicCt = totalKwh > 0 ? (totalDynamic / totalKwh) * 100 : 0
    const daysGreen = filteredBreakdown.filter(d => d.dynamicCostEur <= d.fixedCostEur).length
    return {
      count, totalDynamic, totalFixed,
      totalSavings: totalFixed - totalDynamic,
      avgDynamicCt,
      daysGreen,
      daysRed: count - daysGreen,
    }
  }, [filteredBreakdown])

  const getBucketIdx = useCallback((date: string): number => {
    const entry = dayMap.get(date)
    if (!entry) return -1
    const s = entry.fixedCostEur - entry.dynamicCostEur
    return BUCKETS.findIndex(b => b.test(s))
  }, [dayMap])

  const bucketCounts = useMemo(() => {
    const counts = new Array(BUCKETS.length).fill(0)
    for (const d of dailyBreakdown) {
      const s = d.fixedCostEur - d.dynamicCostEur
      const idx = BUCKETS.findIndex(b => b.test(s))
      if (idx >= 0) counts[idx]++
    }
    return counts
  }, [dailyBreakdown])

  const toggleBucket = useCallback((idx: number) => {
    setActiveBuckets(prev => {
      if (prev === null) return new Set([idx])
      const next = new Set(prev)
      if (next.has(idx)) {
        next.delete(idx)
        return next.size === 0 ? null : next
      }
      next.add(idx)
      return next.size === bucketCount ? null : next
    })
  }, [bucketCount])

  const isInFilter = useCallback((date: string): boolean => {
    if (!isFiltering) return true
    const idx = getBucketIdx(date)
    return idx >= 0 && activeBuckets!.has(idx)
  }, [isFiltering, activeBuckets, getBucketIdx])

  const cellColor = useCallback((date: string): string => {
    const entry = dayMap.get(date)
    if (!entry) return '#F3F4F6'
    const savings = entry.fixedCostEur - entry.dynamicCostEur
    if (savings > 0.03) return '#86EFAC'
    if (savings > 0.01) return '#DCFCE7'
    if (savings > -0.01) return '#FEF3C7'
    if (savings > -0.03) return '#FED7AA'
    return '#FCA5A5'
  }, [dayMap])

  if (grid.length === 0) return null

  const cellSize = Math.max(12, Math.min(16, Math.floor(1000 / weeks)))
  const gap = 2

  const displayDate = hoveredDate ?? previewDate ?? selectedDate
  const displayEntry = dayMap.get(displayDate) ?? null
  const dataPointUnit = displayEntry?.hoursTotal === 96 ? 'slots' : 'h'

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-[#313131]">Daily Savings</CardTitle>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {yearlyKwh.toLocaleString()} kWh/yr · {stats.count} days · Fixed: {fixedPrice} ct/kWh
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[9px] text-gray-400">
            <span className="font-semibold uppercase tracking-wider mr-0.5">Dynamic vs. Fixed</span>
            <div className="flex gap-px">
              {BUCKETS.map((b, i) => {
                const active = !isFiltering || activeBuckets!.has(i)
                return (
                  <button key={i} onClick={() => toggleBucket(i)}
                    className="rounded-sm transition-all relative group cursor-pointer"
                    title={`${b.label} · ${bucketCounts[i]} days`}
                    style={{
                      width: cellSize + 4, height: cellSize + 4,
                      background: b.color,
                      opacity: active ? 1 : 0.2,
                      outline: isFiltering && active ? '2px solid #313131' : 'none',
                      outlineOffset: 1,
                    }}>
                    <span className="absolute -bottom-3.5 left-1/2 -translate-x-1/2 text-[7px] tabular-nums text-gray-500 font-semibold opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                      {bucketCounts[i]}
                    </span>
                  </button>
                )
              })}
            </div>
            <span className="text-[8px] text-gray-300 ml-0.5">cheaper → expensive</span>
            {isFiltering && (
              <button onClick={() => setActiveBuckets(null)}
                className="text-[9px] text-[#313131] hover:text-gray-600 transition-colors ml-1 underline underline-offset-2">
                all
              </button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4 pb-4">
        <div className="flex gap-5 items-start">
          {/* Heatmap grid */}
          <div className="flex-1 min-w-0">
            <div className="flex gap-1">
              <div className="flex flex-col justify-start pt-4" style={{ gap }}>
                {DAYS.map((d, i) => (
                  <div key={d} className="text-[9px] text-gray-400 text-right pr-1" style={{ height: cellSize, lineHeight: `${cellSize}px` }}>
                    {i % 2 === 0 ? d : ''}
                  </div>
                ))}
              </div>
              <div className="flex-1 overflow-x-auto" style={{ scrollbarWidth: 'thin', scrollbarColor: '#D1D5DB transparent' }}>
                <div className="relative" style={{ height: 14, width: weeks * (cellSize + gap) }}>
                  {monthLabels.map((m, i) => (
                    <span key={i} className={`text-[9px] absolute ${['Jan', 'Apr', 'Jul', 'Oct'].includes(m.label) ? 'text-gray-500 font-semibold' : 'text-gray-400'}`}
                      style={{ left: m.weekIdx * (cellSize + gap) + (quarterWeeks.has(m.weekIdx) ? 2 : 0) }}>
                      {m.label}
                    </span>
                  ))}
                </div>
                <TooltipProvider delayDuration={50}>
                  <div className="flex" style={{ gap }}>
                    {Array.from({ length: weeks }, (_, w) => (
                      <div key={w} className="flex flex-col" style={{
                        gap,
                        ...(quarterWeeks.has(w) ? { borderLeft: '1px solid #E5E7EB', paddingLeft: 1, marginLeft: 1 } : {})
                      }}>
                        {Array.from({ length: 7 }, (_, d) => {
                          const cell = grid[w * 7 + d]
                          if (!cell) return <div key={d} style={{ width: cellSize, height: cellSize }} />
                          const entry = dayMap.get(cell.date)
                          const isSelected = cell.date === selectedDate
                          const isPreviewed = cell.date === previewDate
                          return (
                            <UITooltip key={d}>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => {
                                    if (!entry) return
                                    if (previewDate === cell.date) {
                                      onSelect(cell.date)
                                      setPreviewDate(null)
                                    } else {
                                      setPreviewDate(cell.date)
                                    }
                                  }}
                                  onMouseEnter={() => setHoveredDate(cell.date)}
                                  onMouseLeave={() => setHoveredDate(null)}
                                  className="rounded-sm transition-all"
                                  style={{
                                    width: cellSize,
                                    height: cellSize,
                                    background: isFiltering && !isInFilter(cell.date) ? '#FAFAFA' : cellColor(cell.date),
                                    outline: isSelected ? '2px solid #313131' : isPreviewed ? '2px solid #6B7280' : 'none',
                                    outlineOffset: -1,
                                    cursor: entry ? 'pointer' : 'default',
                                    opacity: entry ? (isFiltering && !isInFilter(cell.date) ? 0.3 : 1) : 0.4,
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-left p-3 pointer-events-none">
                                <p className="text-[11px] font-semibold text-gray-700 mb-1.5">{fmtDate(cell.date)}</p>
                                {entry ? (
                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-400">Dynamic avg</span>
                                      <span className="font-mono text-blue-600 tabular-nums">{entry.avgEndPriceCtKwh.toFixed(2)} ct/kWh</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-400">Fixed</span>
                                      <span className="font-mono text-red-600 tabular-nums">{fixedPrice.toFixed(2)} ct/kWh</span>
                                    </div>
                                    <div className="flex justify-between gap-4 border-t border-gray-100 pt-1">
                                      <span className="text-gray-500 font-medium">Difference</span>
                                      <span className={`font-bold tabular-nums ${entry.fixedCostEur >= entry.dynamicCostEur ? 'text-emerald-700' : 'text-red-700'}`}>
                                        {entry.fixedCostEur >= entry.dynamicCostEur ? '+' : ''}{(entry.fixedCostEur - entry.dynamicCostEur).toFixed(4)} EUR
                                      </span>
                                    </div>
                                    <p className="text-[9px] text-gray-400 pt-0.5">
                                      {entry.consumptionKwh.toFixed(2)} kWh · Spot avg: {entry.avgSpotCtKwh.toFixed(2)} ct
                                      {entry.hoursWithData < entry.hoursTotal && (
                                        <span className="text-amber-500 ml-1">· {entry.hoursWithData}/{entry.hoursTotal}{dataPointUnit}</span>
                                      )}
                                    </p>
                                  </div>
                                ) : (
                                  <p className="text-[11px] text-gray-400">No data</p>
                                )}
                              </TooltipContent>
                            </UITooltip>
                          )
                        })}
                      </div>
                    ))}
                  </div>
                </TooltipProvider>
              </div>
            </div>
          </div>

          {/* RIGHT: stat cards */}
          <div className="w-[280px] flex-shrink-0 border-l border-gray-100 pl-5 flex flex-col gap-2">
            {/* Annual savings hero */}
            <div className={`rounded-lg border px-3.5 py-2.5 flex flex-col justify-center ${stats.totalSavings >= 0 ? 'bg-blue-50/70 border-blue-100' : 'bg-red-50/70 border-red-100'}`}>
              <p className={`text-[9px] font-semibold uppercase tracking-wider ${stats.totalSavings >= 0 ? 'text-blue-600/60' : 'text-red-600/60'}`}>
                {stats.totalSavings >= 0 ? 'Dynamic Saves' : 'Fixed Saves'} · {stats.count} Days
              </p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className={`text-[28px] font-bold tabular-nums leading-none tracking-tight ${stats.totalSavings >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                  {Math.abs(stats.totalSavings).toFixed(0)}
                </span>
                <span className={`text-sm font-semibold ${stats.totalSavings >= 0 ? 'text-blue-600' : 'text-red-600'}`}>EUR</span>
                <span className={`text-[10px] ml-auto ${stats.totalSavings >= 0 ? 'text-blue-500/80' : 'text-red-500/80'}`}>
                  /{stats.count} days
                </span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px]">
                <span className={stats.totalSavings >= 0 ? 'text-blue-600/70' : 'text-red-600/70'}>
                  avg {stats.avgDynamicCt.toFixed(2)} ct/kWh dynamic
                </span>
              </div>
            </div>

            {/* Day distribution */}
            <div className="rounded-lg bg-gray-50/60 border border-gray-100 px-3.5 py-2.5">
              <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-1.5">Day Distribution</p>
              <div className="flex items-center gap-2">
                <div className="flex-1 h-3 bg-gray-100 rounded-full overflow-hidden flex">
                  <div className="h-full bg-emerald-400 transition-all" style={{ width: `${stats.count > 0 ? (stats.daysGreen / stats.count) * 100 : 0}%` }} />
                  <div className="h-full bg-red-300 transition-all" style={{ width: `${stats.count > 0 ? (stats.daysRed / stats.count) * 100 : 0}%` }} />
                </div>
              </div>
              <div className="flex items-center justify-between mt-1.5 text-[10px]">
                <span className="text-emerald-600 font-semibold tabular-nums">{stats.daysGreen} days cheaper</span>
                <span className="text-red-500 font-semibold tabular-nums">{stats.daysRed} days more expensive</span>
              </div>
            </div>

            {/* Day detail */}
            {displayEntry ? (
              <div className={`rounded-lg border px-3.5 py-2.5 flex flex-col justify-center ${previewDate && !hoveredDate ? 'bg-blue-50/40 border-blue-200/60' : 'bg-gray-50/60 border-gray-100'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                    {fmtDate(displayDate)}
                    {previewDate && !hoveredDate && <span className="text-blue-400 ml-1.5 normal-case font-normal">click again to jump</span>}
                  </p>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-[10px]">
                  <span className="text-gray-400">
                    <span className="text-blue-600 font-mono tabular-nums">{displayEntry.avgEndPriceCtKwh.toFixed(2)}</span>
                    <span className="text-gray-300 mx-0.5">vs</span>
                    <span className="text-red-500 font-mono tabular-nums">{fixedPrice.toFixed(2)}</span> ct
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className={`font-semibold tabular-nums ${displayEntry.fixedCostEur >= displayEntry.dynamicCostEur ? 'text-emerald-700' : 'text-red-700'}`}>
                    {displayEntry.fixedCostEur >= displayEntry.dynamicCostEur ? '+' : ''}{(displayEntry.fixedCostEur - displayEntry.dynamicCostEur).toFixed(4)} EUR
                  </span>
                </div>
              </div>
            ) : (
              <div className="rounded-lg bg-gray-50/40 border border-gray-100/60 px-3.5 py-2.5 flex items-center justify-center">
                <p className="text-[10px] text-gray-300">Hover a day for details</p>
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
