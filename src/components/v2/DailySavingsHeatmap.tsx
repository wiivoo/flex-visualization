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

export function DailySavingsHeatmap({ dailySavingsMap, selectedDate, onSelect, energyPerSession, chargingMode, rollingAvgSavings, sessionsPerYear, selectedDayCost }: Props) {
  const [hoveredDate, setHoveredDate] = useState<string | null>(null)
  const [rangeMin, setRangeMin] = useState(0)
  const [rangeMax, setRangeMax] = useState(100)

  const { grid, weeks, maxSavingsCt, monthLabels, allEntries, quarterWeeks } = useMemo(() => {
    if (dailySavingsMap.size === 0) return { grid: [], weeks: 0, maxSavingsCt: 0, monthLabels: [], allEntries: [], quarterWeeks: new Set<number>() }

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
    let maxCt = 0
    const entries: { date: string; entry: DailyEntry; ctSav: number }[] = []

    for (let i = 0; i < totalDays; i++) {
      const d = new Date(startDate.getTime() + i * 86400000)
      const dateStr = d.toISOString().slice(0, 10)
      const entry = dailySavingsMap.get(dateStr) ?? null
      if (entry) {
        const ctSav = entry.bAvg - entry.oAvg
        if (ctSav > maxCt) maxCt = ctSav
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

    // Detect quarter boundaries (weeks where month transitions to Jan/Apr/Jul/Oct)
    const quarterWeeks = new Set<number>()
    for (const lbl of labels) {
      const qMonths = ['Jan', 'Apr', 'Jul', 'Oct']
      if (qMonths.includes(lbl.label) && lbl.weekIdx > 0) {
        quarterWeeks.add(lbl.weekIdx)
      }
    }

    return { grid: cells, weeks: totalWeeks, maxSavingsCt: maxCt, monthLabels: labels, allEntries: entries, quarterWeeks }
  }, [dailySavingsMap])

  const filterMinCt = (rangeMin / 100) * maxSavingsCt
  const filterMaxCt = (rangeMax / 100) * maxSavingsCt
  const isFiltering = rangeMin > 0 || rangeMax < 100

  const filtered = useMemo(() => {
    return allEntries.filter(e => e.ctSav >= filterMinCt && e.ctSav <= filterMaxCt)
  }, [allEntries, filterMinCt, filterMaxCt])

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

  const handleMinChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRangeMin(Math.min(Number(e.target.value), rangeMax - 1))
  }, [rangeMax])
  const handleMaxChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRangeMax(Math.max(Number(e.target.value), rangeMin + 1))
  }, [rangeMin])

  if (grid.length === 0) return null

  const modeLabel = chargingMode === 'threeday' ? '72h' : chargingMode === 'fullday' ? '24h' : 'Overnight'
  const annualSavings = rollingAvgSavings ?? stats.totalEur
  const avgPerSession = sessionsPerYear && sessionsPerYear > 0 ? annualSavings / sessionsPerYear : stats.avgEur

  function isInFilter(entry: DailyEntry | null): boolean {
    if (!entry) return false
    const ct = entry.bAvg - entry.oAvg
    return ct >= filterMinCt && ct <= filterMaxCt
  }

  function cellColor(entry: DailyEntry | null, inFilter: boolean): string {
    if (!entry) return '#F3F4F6'
    const ctSav = entry.bAvg - entry.oAvg
    if (ctSav <= 0) return inFilter ? '#FEE2E2' : '#FAFAFA'
    const t = Math.min(ctSav / Math.max(maxSavingsCt, 0.01), 1)
    const r = Math.round(220 - t * (220 - 22))
    const g = Math.round(252 - t * (252 - 163))
    const b = Math.round(231 - t * (231 - 74))
    return `rgb(${r},${g},${b})`
  }

  const cellSize = Math.max(12, Math.min(16, Math.floor(1000 / weeks)))
  const gap = 2

  const hoveredEntry = hoveredDate ? dailySavingsMap.get(hoveredDate) : null
  const rawSelectedEntry = dailySavingsMap.get(selectedDate) ?? null
  // Override selected day with live chart cost (QH-accurate) when available
  const selectedEntry: DailyEntry | null = selectedDayCost && rawSelectedEntry
    ? { ...rawSelectedEntry, bAvg: selectedDayCost.baselineAvgCt, oAvg: selectedDayCost.optimizedAvgCt, savingsEur: selectedDayCost.savingsEur }
    : rawSelectedEntry
  const displayEntry = hoveredEntry ?? selectedEntry
  const displayDateStr = hoveredDate ?? selectedDate

  // Slider thumb styles — pointer-events:none on track, auto on thumb so both inputs are draggable
  const thumbClass = 'pointer-events-none [&::-webkit-slider-thumb]:pointer-events-auto [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-emerald-600 [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:relative [&::-webkit-slider-thumb]:z-10'

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-base font-bold text-[#313131]">Daily Savings</CardTitle>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {modeLabel} · {energyPerSession} kWh · {allEntries.length} days
            </p>
          </div>
          <div className="flex items-center gap-2 text-[10px] text-gray-400">
            <span>0</span>
            <div className="flex gap-px">
              {[0, 0.2, 0.4, 0.6, 0.8, 1].map((t, i) => {
                const r = Math.round(220 - t * (220 - 22))
                const g = Math.round(252 - t * (252 - 163))
                const b = Math.round(231 - t * (231 - 74))
                return <div key={i} className="rounded-sm" style={{ width: cellSize, height: cellSize, background: `rgb(${r},${g},${b})` }} />
              })}
            </div>
            <span>{maxSavingsCt.toFixed(1)} ct/kWh</span>
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
                          const entry = cell.entry
                          const inFilter = isInFilter(entry)
                          return (
                            <UITooltip key={d}>
                              <TooltipTrigger asChild>
                                <button
                                  onClick={() => { if (entry) onSelect(cell.date) }}
                                  onMouseEnter={() => setHoveredDate(cell.date)}
                                  onMouseLeave={() => setHoveredDate(null)}
                                  className="rounded-sm transition-all"
                                  style={{
                                    width: cellSize,
                                    height: cellSize,
                                    background: cellColor(entry, inFilter),
                                    outline: isSelected ? '2px solid #313131' : 'none',
                                    outlineOffset: -1,
                                    cursor: entry ? 'pointer' : 'default',
                                    opacity: !entry ? 0.4 : (isFiltering && !inFilter ? 0.15 : 1),
                                  }}
                                />
                              </TooltipTrigger>
                              <TooltipContent side="top" className="max-w-[240px] text-left p-3">
                                <p className="text-[11px] font-semibold text-gray-700 mb-1.5">{fmtDate(cell.date)}</p>
                                {entry ? (
                                  <div className="space-y-1 text-[11px]">
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-400">Unmanaged</span>
                                      <span className="font-mono text-red-600 tabular-nums">{entry.bAvg.toFixed(1)} ct/kWh</span>
                                    </div>
                                    <div className="flex justify-between gap-4">
                                      <span className="text-gray-400">Optimized</span>
                                      <span className="font-mono text-emerald-600 tabular-nums">{entry.oAvg.toFixed(1)} ct/kWh</span>
                                    </div>
                                    <div className="flex justify-between gap-4 border-t border-gray-100 pt-1">
                                      <span className="text-gray-500 font-medium">Saving</span>
                                      <span className="font-bold text-emerald-700 tabular-nums">{(entry.bAvg - entry.oAvg).toFixed(1)} ct/kWh</span>
                                    </div>
                                    <p className="text-[9px] text-gray-400 pt-0.5">
                                      ({entry.bAvg.toFixed(1)} − {entry.oAvg.toFixed(1)}) × {energyPerSession} kWh ÷ 100 = {entry.savingsEur.toFixed(2)} EUR
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
            {/* ── Slider directly under heatmap grid ── */}
            {(() => {
              const tickCount = 5
              const ticks = Array.from({ length: tickCount + 1 }, (_, i) => {
                const pct = (i / tickCount) * 100
                const val = (pct / 100) * maxSavingsCt
                return { pct, val }
              })
              return (
                <div className="mt-3 pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">Filter</span>
                    <span className="text-[10px] font-mono tabular-nums text-emerald-700 font-semibold">
                      {filterMinCt.toFixed(1)} – {filterMaxCt.toFixed(1)}
                    </span>
                    <span className="text-[9px] text-gray-400">ct/kWh</span>
                    {isFiltering && (
                      <>
                        <span className="text-[9px] text-gray-300 ml-1">·</span>
                        <span className="text-[9px] text-gray-400">{filtered.length}/{allEntries.length} days</span>
                        <button onClick={() => { setRangeMin(0); setRangeMax(100) }}
                          className="text-[9px] text-emerald-600 hover:text-emerald-700 transition-colors ml-auto underline underline-offset-2">
                          reset
                        </button>
                      </>
                    )}
                  </div>
                  <div className="relative h-6 flex items-center">
                    {/* Track bg */}
                    <div className="absolute inset-x-0 h-1.5 rounded-full bg-gray-100 border border-gray-200/60" />
                    {/* Active range fill */}
                    <div className="absolute h-1.5 rounded-full bg-emerald-400/50 border-y border-emerald-500/20"
                      style={{ left: `${rangeMin}%`, right: `${100 - rangeMax}%` }} />
                    {/* Tick marks */}
                    {ticks.map((tick, i) => (
                      <div key={i} className="absolute flex flex-col items-center" style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}>
                        <div className="w-px h-2 bg-gray-300 mt-3" />
                      </div>
                    ))}
                    {/* Min thumb */}
                    <input type="range" min={0} max={100} value={rangeMin} onChange={handleMinChange}
                      className={`absolute inset-x-0 w-full h-1.5 appearance-none bg-transparent ${thumbClass}`} />
                    {/* Max thumb */}
                    <input type="range" min={0} max={100} value={rangeMax} onChange={handleMaxChange}
                      className={`absolute inset-x-0 w-full h-1.5 appearance-none bg-transparent ${thumbClass}`} />
                  </div>
                  {/* Tick labels */}
                  <div className="relative h-3 mt-0.5">
                    {ticks.map((tick, i) => (
                      <span key={i} className="absolute text-[8px] text-gray-400 tabular-nums"
                        style={{ left: `${tick.pct}%`, transform: 'translateX(-50%)' }}>
                        {tick.val.toFixed(0)}
                      </span>
                    ))}
                  </div>
                </div>
              )
            })()}
          </div>

          {/* RIGHT: 3 compact stat cards stacked */}
          <div className="w-[280px] flex-shrink-0 border-l border-gray-100 pl-5 flex flex-col gap-2">
            {/* 52-week hero */}
            <div className="rounded-lg bg-emerald-50/70 border border-emerald-100 px-3.5 py-2.5 flex flex-col justify-center">
              <p className="text-[9px] font-semibold text-emerald-600/60 uppercase tracking-wider">52-Week Savings</p>
              <div className="flex items-baseline gap-1.5 mt-0.5">
                <span className="text-[28px] font-bold tabular-nums text-emerald-700 leading-none tracking-tight">
                  {annualSavings.toFixed(0)}
                </span>
                <span className="text-sm font-semibold text-emerald-600">EUR</span>
                <span className="text-[10px] text-emerald-500/80 ml-auto">/year</span>
              </div>
              <div className="flex items-center gap-3 mt-1.5 text-[10px] text-emerald-600/70">
                <span>{avgPerSession.toFixed(2)} EUR/session</span>
                {sessionsPerYear != null && <span className="text-emerald-500/50">·</span>}
                {sessionsPerYear != null && <span>{sessionsPerYear} sessions/yr</span>}
              </div>
            </div>

            {/* Averages */}
            <div className="rounded-lg bg-gray-50/60 border border-gray-100 px-3.5 py-2.5 flex flex-col justify-center">
              <div className="flex items-center justify-between">
                <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">
                  {isFiltering ? `${filtered.length}/${allEntries.length} days` : `${allEntries.length} days avg`}
                </p>
                <span className="text-lg font-bold tabular-nums text-emerald-700 leading-none">{stats.avgCt.toFixed(1)} <span className="text-[10px] font-semibold text-gray-400">ct/kWh</span></span>
              </div>
              <div className="flex items-center gap-4 mt-1.5 text-[10px]">
                <span className="text-gray-400">
                  <span className="text-red-500 font-mono tabular-nums">{stats.avgBAvg.toFixed(1)}</span> → <span className="text-emerald-600 font-mono tabular-nums">{stats.avgOAvg.toFixed(1)}</span> ct
                </span>
                <span className="text-gray-300">·</span>
                <span className="text-gray-400">{stats.avgSpread.toFixed(1)} ct spread</span>
              </div>
            </div>

            {/* Day detail */}
            {displayEntry ? (
              <div className="rounded-lg bg-gray-50/60 border border-gray-100 px-3.5 py-2.5 flex flex-col justify-center">
                <div className="flex items-center justify-between">
                  <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider">{fmtDate(displayDateStr)}</p>
                  <span className="text-lg font-bold tabular-nums text-emerald-700 leading-none">{(displayEntry.bAvg - displayEntry.oAvg).toFixed(1)} <span className="text-[10px] font-semibold text-gray-400">ct/kWh</span></span>
                </div>
                <div className="flex items-center gap-4 mt-1.5 text-[10px]">
                  <span className="text-gray-400">
                    <span className="text-red-500 font-mono tabular-nums">{displayEntry.bAvg.toFixed(1)}</span> → <span className="text-emerald-600 font-mono tabular-nums">{displayEntry.oAvg.toFixed(1)}</span> ct
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
