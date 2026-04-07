'use client'

import { useMemo, useState, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'

export interface DailyEntry {
  savingsEur: number
  bAvg: number
  oAvg: number
  spreadCt: number
  windowHours: number
}

interface Props {
  dailySavingsMap: Map<string, DailyEntry>
  selectedDate: string
  onSelect: (date: string) => void
  energyPerSession: number
  chargingMode: 'overnight' | 'fullday' | 'threeday'
  rollingAvgSavings?: number
  sessionsPerYear?: number
  /** Live-computed cost for selected date (from chart's QH optimization) — overrides rolling scan values */
  selectedDayCost?: { baselineAvgCt: number; optimizedAvgCt: number; savingsEur: number } | null
  isFleet?: boolean
  /** Selected plug-in days (JS getUTCDay: 0=Sun..6=Sat). When set, non-matching days are dimmed. */
  plugInDays?: number[]
}

const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function isoWeekday(dateStr: string): number {
  const d = new Date(dateStr + 'T12:00:00Z').getUTCDay()
  return d === 0 ? 6 : d - 1
}

function fmtDate(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}

const BUCKET_COLORS = ['#DCFCE7', '#86EFAC', '#FACC15', '#FB923C', '#EF4444'] as const

/** Build 5 adaptive buckets from quintiles of the actual savings data */
function buildBuckets(savings: number[]): { min: number; max: number; color: string; label: string }[] {
  if (savings.length === 0) {
    return BUCKET_COLORS.map((c, i) => ({ min: i, max: i + 1, color: c, label: `${i}–${i + 1}` }))
  }
  const sorted = [...savings].sort((a, b) => a - b)
  const pct = (p: number) => sorted[Math.min(Math.floor(p * sorted.length), sorted.length - 1)]
  // Quintile boundaries, rounded to 1 decimal
  const raw = [0, pct(0.2), pct(0.4), pct(0.6), pct(0.8)]
  // Round to nice steps: <1 → 0.1, <10 → 0.5, else → 1
  const nice = (v: number) => {
    if (v <= 0) return 0
    if (v < 1) return Math.round(v * 10) / 10
    if (v < 10) return Math.round(v * 2) / 2
    return Math.round(v)
  }
  const edges = raw.map(nice)
  // Deduplicate: ensure strictly increasing
  for (let i = 1; i < edges.length; i++) {
    if (edges[i] <= edges[i - 1]) edges[i] = edges[i - 1] + (edges[i - 1] < 1 ? 0.1 : edges[i - 1] < 10 ? 0.5 : 1)
  }
  const fmt = (v: number) => v % 1 === 0 ? String(v) : v.toFixed(1)
  return edges.map((e, i) => {
    const max = i < edges.length - 1 ? edges[i + 1] : Infinity
    return {
      min: e,
      max,
      color: BUCKET_COLORS[i],
      label: max === Infinity ? `${fmt(e)}+` : `${fmt(e)}–${fmt(max)}`,
    }
  })
}

export function DailySavingsHeatmap({ dailySavingsMap, selectedDate, onSelect, energyPerSession, chargingMode, rollingAvgSavings, sessionsPerYear, selectedDayCost, isFleet = false, plugInDays }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  // Filter by spread: null = show all, Set = active bucket indices
  const [activeBuckets, setActiveBuckets] = useState<Set<number> | null>(null)
  // Preview date: first click selects, second click on same date navigates
  const [previewDate, setPreviewDate] = useState<string | null>(null)
  // Toggle: show only plug-in days or all days
  const [showPlugInOnly, setShowPlugInOnly] = useState(false)
  const hasPlugInFilter = plugInDays && plugInDays.length < 7

  const { grid, weeks, monthLabels, allEntries, quarterWeeks } = useMemo(() => {
    if (dailySavingsMap.size === 0) return { grid: [], weeks: 0, monthLabels: [], allEntries: [], quarterWeeks: new Set<number>() }

    const dates = [...dailySavingsMap.keys()].sort()
    const firstDate = dates[0]
    const lastDate = dates[dates.length - 1]

    const firstWd = isoWeekday(firstDate)
    const startDate = new Date(new Date(firstDate + 'T12:00:00Z').getTime() - firstWd * 86400000)
    const lastWd = isoWeekday(lastDate)
    const endDate = new Date(new Date(lastDate + 'T12:00:00Z').getTime() + (6 - lastWd) * 86400000)

    const totalDays = Math.round((endDate.getTime() - startDate.getTime()) / 86400000) + 1
    const totalWeeks = Math.ceil(totalDays / 7)

    const cells: { date: string; entry: DailyEntry | null; weekIdx: number; dayIdx: number }[] = []
    const entries: { date: string; entry: DailyEntry; ctSav: number }[] = []

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getTime() + i * 86400000)
      const dateStr = d.toISOString().slice(0, 10)
      const entry = dailySavingsMap.get(dateStr) ?? null
      if (entry) {
        const ctSav = entry.bAvg - entry.oAvg
        entries.push({ date: dateStr, entry, ctSav })
      }
      cells.push({ date: dateStr, entry, weekIdx: Math.floor(i / 7), dayIdx: i % 7 })
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

    const quarterWeeks = new Set<number>()
    for (const lbl of labels) {
      const qMonths = ['Jan', 'Apr', 'Jul', 'Oct']
      if (qMonths.includes(lbl.label) && lbl.weekIdx > 0) {
        quarterWeeks.add(lbl.weekIdx)
      }
    }

    return { grid: cells, weeks: totalWeeks, monthLabels: labels, allEntries: entries, quarterWeeks }
  }, [dailySavingsMap])

  // Filter entries by plug-in days when toggle is on
  const plugInFilteredEntries = useMemo(() => {
    if (!showPlugInOnly || !plugInDays) return allEntries
    return allEntries.filter(e => {
      const dow = new Date(e.date + 'T12:00:00Z').getUTCDay()
      return plugInDays.includes(dow)
    })
  }, [allEntries, showPlugInOnly, plugInDays])

  const isFiltering = activeBuckets !== null

  // Adaptive quintile-based buckets from actual savings data (use filtered set)
  const savingsBuckets = useMemo(() => buildBuckets(plugInFilteredEntries.map(e => e.ctSav)), [plugInFilteredEntries])

  // Count entries per bucket for badge display
  const bucketCounts = useMemo(() => {
    const counts = new Array(savingsBuckets.length).fill(0)
    for (const e of plugInFilteredEntries) {
      const bi = savingsBuckets.findIndex(b => e.ctSav >= b.min && e.ctSav < b.max)
      if (bi >= 0) counts[bi]++
      else if (e.ctSav >= savingsBuckets[savingsBuckets.length - 1].min) counts[savingsBuckets.length - 1]++
    }
    return counts
  }, [plugInFilteredEntries, savingsBuckets])

  const filtered = useMemo(() => {
    if (!isFiltering) return plugInFilteredEntries
    return plugInFilteredEntries.filter(e => {
      const bi = savingsBuckets.findIndex(b => e.ctSav >= b.min && e.ctSav < b.max)
      const idx = bi >= 0 ? bi : (e.ctSav >= savingsBuckets[savingsBuckets.length - 1].min ? savingsBuckets.length - 1 : -1)
      return idx >= 0 && activeBuckets!.has(idx)
    })
  }, [allEntries, isFiltering, activeBuckets, savingsBuckets])

  const stats = useMemo(() => {
    if (filtered.length === 0) return { count: 0, avgCt: 0, avgEur: 0, totalEur: 0, avgBAvg: 0, avgOAvg: 0, avgSpread: 0 }
    const count = filtered.length
    const avgCt = filtered.reduce((s, e) => s + e.ctSav, 0) / count
    const avgEur = filtered.reduce((s, e) => s + e.entry.savingsEur, 0) / count
    const totalEur = filtered.reduce((s, e) => s + e.entry.savingsEur, 0)
    const avgBAvg = filtered.reduce((s, e) => s + e.entry.bAvg, 0) / count
    const avgOAvg = filtered.reduce((s, e) => s + e.entry.oAvg, 0) / count
    const avgSpread = filtered.reduce((s, e) => s + e.entry.spreadCt, 0) / count
    return { count, avgCt, avgEur, totalEur, avgBAvg, avgOAvg, avgSpread }
  }, [filtered])

  const bucketCount = savingsBuckets.length
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

  if (grid.length === 0) return null

  const modeLabel = chargingMode === 'threeday' ? '72h' : chargingMode === 'fullday' ? '24h' : '12h'
  const annualSavings = rollingAvgSavings ?? stats.totalEur
  const avgPerSession = sessionsPerYear && sessionsPerYear > 0 ? annualSavings / sessionsPerYear : stats.avgEur

  function getBucketIdx(sav: number): number {
    const bi = savingsBuckets.findIndex(b => sav >= b.min && sav < b.max)
    return bi >= 0 ? bi : (sav >= savingsBuckets[savingsBuckets.length - 1].min ? savingsBuckets.length - 1 : -1)
  }

  function isInFilter(entry: DailyEntry | null): boolean {
    if (!entry) return false
    if (!isFiltering) return true
    const idx = getBucketIdx(entry.bAvg - entry.oAvg)
    return idx >= 0 && activeBuckets!.has(idx)
  }

  function cellColor(entry: DailyEntry | null, inFilter: boolean): string {
    if (!entry) return '#F3F4F6'
    const sav = entry.bAvg - entry.oAvg
    if (sav <= 0) return inFilter ? '#FEE2E2' : '#FAFAFA'
    const idx = getBucketIdx(sav)
    return idx >= 0 ? savingsBuckets[idx].color : '#DCFCE7'
  }

  const cellSize = Math.max(12, Math.min(16, Math.floor(1000 / weeks)))
  const gap = 2

  const hoveredEntry = hoveredDate ? dailySavingsMap.get(hoveredDate) : null
  const rawSelectedEntry = dailySavingsMap.get(selectedDate) ?? null
  // Override selected day with live chart cost (QH-accurate) when available
  const selectedEntry: DailyEntry | null = selectedDayCost && rawSelectedEntry
    ? { ...rawSelectedEntry, bAvg: selectedDayCost.baselineAvgCt, oAvg: selectedDayCost.optimizedAvgCt, savingsEur: selectedDayCost.savingsEur }
    : rawSelectedEntry
  const previewEntry = previewDate ? dailySavingsMap.get(previewDate) : null
  const displayEntry = hoveredEntry ?? previewEntry ?? selectedEntry
  const displayDateStr = hoveredDate ?? previewDate ?? selectedDate

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-bold text-[#313131]">Daily Savings</CardTitle>
              {hasPlugInFilter && (
                <div className="flex gap-0.5 bg-gray-100 rounded p-0.5">
                  <button
                    onClick={() => setShowPlugInOnly(false)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${!showPlugInOnly ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >All</button>
                  <button
                    onClick={() => setShowPlugInOnly(true)}
                    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${showPlugInOnly ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >Plug-in</button>
                </div>
              )}
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {modeLabel} · {energyPerSession} kWh · {showPlugInOnly && plugInDays ? plugInFilteredEntries.length : allEntries.length} days{showPlugInOnly && plugInDays ? ` (of ${allEntries.length})` : ''}
            </p>
          </div>
          <div className="flex items-center gap-1.5 text-[10px] text-gray-400">
            <span className="text-[9px] font-semibold uppercase tracking-wider mr-0.5">Saving</span>
            <div className="flex gap-px">
              {savingsBuckets.map((b, i) => {
                const active = !isFiltering || activeBuckets!.has(i)
                return (
                  <button key={i} onClick={() => toggleBucket(i)}
                    className="rounded-sm transition-all relative group cursor-pointer"
                    title={`${b.label} ct/kWh saving · ${bucketCounts[i]} days`}
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
            <span className="text-[8px] text-gray-300 ml-0.5">ct/kWh</span>
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
        {/* ── TOP ROW: Heatmap + 3 stat cards ── */}
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
              <div className="flex-1 overflow-x-auto">
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
                          const isSelected = cell.date === selectedDate
                          const isPreviewed = cell.date === previewDate
                          const entry = cell.entry
                          const inFilter = isInFilter(entry)
                          return (
                            <UITooltip key={d}>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => {
                                    if (!entry) return
                                    if (previewDate === cell.date) {
                                      // Second click on same date → navigate
                                      onSelect(cell.date)
                                      setPreviewDate(null)
                                    } else {
                                      // First click → preview only
                                      setPreviewDate(cell.date)
                                    }
                                  }}
                                  onMouseEnter={() => setHoveredDate(cell.date)}
                                  onMouseLeave={() => setHoveredDate(null)}
                                  className="rounded-sm transition-all"
                                  style={{
                                    width: cellSize,
                                    height: cellSize,
                                    background: cellColor(entry, inFilter),
                                    outline: isSelected ? '2px solid #313131' : isPreviewed ? '2px solid #6B7280' : 'none',
                                    outlineOffset: -1,
                                    cursor: entry ? 'pointer' : 'default',
                                    opacity: !entry ? 0.4 : (showPlugInOnly && plugInDays && !plugInDays.includes(new Date(cell.date + 'T12:00:00Z').getUTCDay())) ? 0.1 : (isFiltering && !inFilter ? 0.15 : 1),
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-left p-3 pointer-events-none">
                                <p className="text-[11px] font-semibold text-gray-700 mb-1.5">{fmtDate(cell.date)}</p>
                                {entry ? (
                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-400">Unmanaged</span>
                                      <span className="font-mono text-red-600 tabular-nums">{entry.bAvg.toFixed(2)} ct/kWh</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-400">Optimized</span>
                                      <span className="font-mono text-emerald-600 tabular-nums">{entry.oAvg.toFixed(2)} ct/kWh</span>
                                    </div>
                                    <div className="flex justify-between gap-4 border-t border-gray-100 pt-1">
                                      <span className="text-gray-500 font-medium">Saving</span>
                                      <span className="font-bold text-emerald-700 tabular-nums">{(entry.bAvg - entry.oAvg).toFixed(2)} ct/kWh</span>
                                    </div>
                                    <p className="text-[9px] text-gray-400 pt-0.5">
                                      ({entry.bAvg.toFixed(2)} − {entry.oAvg.toFixed(2)}) × {energyPerSession} kWh ÷ 100 = {entry.savingsEur.toFixed(2)} EUR
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
            {/* ── Spread filter summary under heatmap ── */}
            {isFiltering && (
              <div className="mt-2 pt-1.5 border-t border-gray-100 flex items-center gap-2 text-[9px] text-gray-400">
                <span className="font-semibold uppercase tracking-wider">Filtered</span>
                <span className="font-mono tabular-nums text-[#313131] font-semibold">{filtered.length}/{allEntries.length}</span>
                <span>days</span>
                <span className="text-gray-300">·</span>
                {[...activeBuckets!].sort().map(i => (
                  <span key={i} className="inline-flex items-center gap-0.5">
                    <span className="inline-block w-2 h-2 rounded-sm" style={{ background: savingsBuckets[i].color }} />
                    <span className="font-mono tabular-nums">{savingsBuckets[i].label}</span>
                  </span>
                ))}
              </div>
            )}
          </div>

          {/* RIGHT: 3 compact stat cards stacked */}
          <div className="w-[280px] flex-shrink-0 border-l border-gray-100 pl-5 flex flex-col gap-2">
            {/* 52-week hero */}
            <div className="rounded-lg bg-emerald-50/70 border border-emerald-100 px-3.5 py-2.5 flex flex-col justify-center">
              <p className="text-[9px] font-semibold text-emerald-600/60 uppercase tracking-wider">Projected Savings · 52 Weeks{isFleet ? ' · per EV' : ''}</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-[28px] font-bold tabular-nums text-emerald-700 leading-none tracking-tight">
                  {annualSavings.toFixed(0)}
                </span>
                <span className="text-sm font-semibold text-emerald-600">EUR{isFleet ? '/EV' : ''}</span>
                <span className="text-[10px] text-emerald-500/80 ml-auto">/year</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-emerald-600/70">
                <span>{avgPerSession.toFixed(2)} EUR/{isFleet ? 'EV/' : ''}session</span>
                {sessionsPerYear != null && <span className="text-emerald-500/50">·</span>}
                {sessionsPerYear != null && <span>{sessionsPerYear} sessions/yr</span>}
              </div>
            </div>

            {/* Averages */}
            <div className="rounded-lg bg-gray-50/60 border border-gray-100 px-3.5 py-2.5 flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                  {isFiltering ? `Filtered ${filtered.length}/${allEntries.length} Days` : 'Avg 52 Weeks'}
                </p>
                <span className="text-lg font-bold tabular-nums text-emerald-700 leading-none">{stats.avgCt.toFixed(2)} <span className="text-[10px] font-semibold text-gray-400">ct/kWh</span></span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-[10px]">
                <span className="text-gray-400">
                  <span className="text-red-500 font-mono tabular-nums">{stats.avgBAvg.toFixed(2)}</span> → <span className="text-emerald-600 font-mono tabular-nums">{stats.avgOAvg.toFixed(2)}</span> ct
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">{stats.avgSpread.toFixed(2)} ct spread</span>
              </div>
            </div>

            {/* Day detail */}
            {displayEntry ? (
              <div className={`rounded-lg border px-3.5 py-2.5 flex flex-col justify-center ${previewDate && !hoveredDate ? 'bg-blue-50/40 border-blue-200/60' : 'bg-gray-50/60 border-gray-100'}`}>
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                    {fmtDate(displayDateStr)}
                    {previewDate && !hoveredDate && <span className="text-blue-400 ml-1.5 normal-case font-normal">click again to jump</span>}
                  </p>
                  <span className="text-lg font-bold tabular-nums text-emerald-700 leading-none">{(displayEntry.bAvg - displayEntry.oAvg).toFixed(2)} <span className="text-[10px] font-semibold text-gray-400">ct/kWh</span></span>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-[10px]">
                  <span className="text-gray-400">
                    <span className="text-red-500 font-mono tabular-nums">{displayEntry.bAvg.toFixed(2)}</span> → <span className="text-emerald-600 font-mono tabular-nums">{displayEntry.oAvg.toFixed(2)}</span> ct
                  </span>
                  <span className="text-gray-300">·</span>
                  <span className="text-emerald-700 font-semibold tabular-nums">{displayEntry.savingsEur.toFixed(2)} EUR</span>
                  <span className="text-gray-300">·</span>
                  <span className="text-gray-400">{displayEntry.windowHours}h</span>
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
