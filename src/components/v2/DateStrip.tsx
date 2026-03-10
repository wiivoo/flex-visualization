'use client'

import { useMemo, useRef, useEffect, useCallback, useState } from 'react'
import type { DailySummary } from '@/lib/v2-config'

interface DateStripProps {
  daily: DailySummary[]
  selectedDate: string
  onSelect: (date: string) => void
  requireNextDay?: boolean
  latestDate?: string | undefined
}

function spreadColor(spread: number): string {
  if (spread > 200) return 'bg-red-500'
  if (spread > 150) return 'bg-orange-400'
  if (spread > 100) return 'bg-yellow-400'
  if (spread > 50) return 'bg-green-300'
  return 'bg-green-100'
}

const DAY_NAMES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa']
const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function DateStrip({ daily, selectedDate, onSelect, requireNextDay = true, latestDate }: DateStripProps) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const allDates = useMemo(() => new Set(daily.map(d => d.date)), [daily])

  const sortedDays = useMemo(() => {
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    if (!requireNextDay) return sorted
    return sorted.filter(d => {
      const nd = new Date(d.date + 'T12:00:00Z')
      nd.setUTCDate(nd.getUTCDate() + 1)
      return allDates.has(nd.toISOString().slice(0, 10))
    })
  }, [daily, allDates, requireNextDay])

  // Available months for quick-jump
  const availableMonths = useMemo(() => {
    const months = new Map<string, { label: string; firstDate: string }>()
    for (const d of sortedDays) {
      const key = d.date.slice(0, 7)
      if (!months.has(key)) {
        const dt = new Date(d.date + 'T12:00:00Z')
        months.set(key, {
          label: `${MONTH_NAMES_SHORT[dt.getUTCMonth()]} ${dt.getUTCFullYear()}`,
          firstDate: d.date,
        })
      }
    }
    return [...months.entries()]
  }, [sortedDays])

  // Current month key from selected date
  const currentMonthKey = selectedDate?.slice(0, 7) ?? ''

  // Scroll selected date into view
  useEffect(() => {
    if (!scrollRef.current || !selectedDate) return
    const el = scrollRef.current.querySelector(`[data-date="${selectedDate}"]`) as HTMLElement
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'center' })
    }
  }, [selectedDate, sortedDays.length])

  const scrollToDate = useCallback((date: string) => {
    if (!scrollRef.current) return
    const el = scrollRef.current.querySelector(`[data-date="${date}"]`) as HTMLElement
    if (el) {
      el.scrollIntoView({ behavior: 'instant', block: 'nearest', inline: 'start' })
    }
  }, [])

  const scroll = useCallback((dir: number) => {
    if (!scrollRef.current) return
    scrollRef.current.scrollBy({ left: dir * 200, behavior: 'smooth' })
  }, [])

  // Jump to prev/next month
  const jumpMonth = useCallback((dir: number) => {
    const idx = availableMonths.findIndex(([k]) => k === currentMonthKey)
    const target = availableMonths[idx + dir]
    if (target) {
      onSelect(target[1].firstDate)
      scrollToDate(target[1].firstDate)
    }
  }, [availableMonths, currentMonthKey, onSelect, scrollToDate])

  // Available years
  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const [key] of availableMonths) years.add(parseInt(key.slice(0, 4)))
    return [...years].sort()
  }, [availableMonths])

  const currentYear = selectedDate ? parseInt(selectedDate.slice(0, 4)) : availableYears[availableYears.length - 1] ?? new Date().getFullYear()

  // Months for current year only
  const yearMonths = useMemo(() =>
    availableMonths.filter(([key]) => key.startsWith(String(currentYear))),
    [availableMonths, currentYear]
  )

  const jumpYear = useCallback((dir: number) => {
    const idx = availableYears.indexOf(currentYear)
    const targetYear = availableYears[idx + dir]
    if (targetYear == null) return
    const targetMonths = availableMonths.filter(([k]) => k.startsWith(String(targetYear)))
    if (targetMonths.length > 0) {
      const first = dir > 0 ? targetMonths[0] : targetMonths[targetMonths.length - 1]
      onSelect(first[1].firstDate)
      scrollToDate(first[1].firstDate)
    }
  }, [availableYears, currentYear, availableMonths, onSelect, scrollToDate])

  if (sortedDays.length === 0) return null

  // Month break markers
  const monthBreaks = new Set<string>()
  const weekLabels = new Map<string, number>() // date → ISO week number
  let prevMonth = ''
  for (const d of sortedDays) {
    const month = d.date.slice(0, 7)
    if (month !== prevMonth) {
      monthBreaks.add(d.date)
      prevMonth = month
    }
    // Mark Mondays with ISO week number
    const dt = new Date(d.date + 'T12:00:00Z')
    if (dt.getUTCDay() === 1) {
      const jan4 = new Date(Date.UTC(dt.getUTCFullYear(), 0, 4))
      const dayOfYear = Math.floor((dt.getTime() - jan4.getTime()) / 86400000) + 4
      const weekNum = Math.ceil(dayOfYear / 7)
      weekLabels.set(d.date, weekNum)
    }
  }

  const canPrevYear = availableYears.indexOf(currentYear) > 0
  const canNextYear = availableYears.indexOf(currentYear) < availableYears.length - 1

  return (
    <div className="flex flex-col gap-1">
      {/* Top row: year + month pills + latest + legend */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {/* Year nav */}
          <button
            onClick={() => jumpYear(-1)}
            disabled={!canPrevYear}
            className={`p-0.5 rounded transition-colors ${canPrevYear ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'}`}
            aria-label="Previous year"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="15 18 9 12 15 6"/>
            </svg>
          </button>
          <span className="text-[11px] font-bold text-[#313131] tabular-nums min-w-[32px] text-center">{currentYear}</span>
          <button
            onClick={() => jumpYear(1)}
            disabled={!canNextYear}
            className={`p-0.5 rounded transition-colors ${canNextYear ? 'text-gray-500 hover:text-gray-700 hover:bg-gray-100' : 'text-gray-300 cursor-not-allowed'}`}
            aria-label="Next year"
          >
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="9 18 15 12 9 6"/>
            </svg>
          </button>

          {/* Month pills for current year */}
          <div className="flex items-center gap-0.5 ml-1.5 pl-1.5 border-l border-gray-200">
            {yearMonths.map(([key, { firstDate }]) => {
              const monthIdx = parseInt(key.slice(5, 7)) - 1
              return (
                <button
                  key={key}
                  onClick={() => { onSelect(firstDate); scrollToDate(firstDate) }}
                  className={`text-[9px] px-1.5 py-0.5 rounded-full transition-colors ${
                    key === currentMonthKey
                      ? 'bg-[#EA1C0A] text-white font-semibold'
                      : 'text-gray-400 hover:text-gray-600 hover:bg-gray-100'
                  }`}
                >
                  {MONTH_NAMES_SHORT[monthIdx]}
                </button>
              )
            })}
          </div>
        </div>
        <div className="flex items-center gap-2">
          {latestDate && selectedDate !== latestDate && (
            <button
              onClick={() => { onSelect(latestDate); scrollToDate(latestDate) }}
              className="text-[10px] font-semibold text-[#EA1C0A] hover:text-[#EA1C0A]/80 transition-colors flex items-center gap-1 bg-red-50 rounded-full px-2 py-0.5"
            >
              <span>↓</span> Latest
            </button>
          )}
          <div className="flex items-center gap-1">
            <span className="w-2.5 h-1 bg-green-100 rounded-full" />
            <span className="w-2.5 h-1 bg-yellow-400 rounded-full" />
            <span className="w-2.5 h-1 bg-red-500 rounded-full" />
            <span className="text-[9px] text-gray-400">Spread</span>
          </div>
        </div>
      </div>

      {/* Bottom row: scrollable date pills */}
      <div className="flex items-center gap-1">
        <button
          onClick={() => scroll(-1)}
          className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Scroll left"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>

        <div
          ref={scrollRef}
          className="flex-1 overflow-x-auto flex items-end gap-px"
          style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
        >
          {sortedDays.map((day) => {
            const dt = new Date(day.date + 'T12:00:00Z')
            const dayNum = dt.getUTCDate()
            const dow = dt.getUTCDay()
            const isWeekend = dow === 0 || dow === 6
            const isSelected = day.date === selectedDate
            const showMonth = monthBreaks.has(day.date)
            const monthIdx = dt.getUTCMonth()
            const wkLabel = weekLabels.get(day.date)

            return (
              <div key={day.date} className="shrink-0 flex flex-col items-center" style={{ minWidth: 28 }}>
                {wkLabel !== undefined && (
                  <span className="text-[7px] font-medium text-gray-300 leading-none mb-px">W{wkLabel}</span>
                )}
              <button
                data-date={day.date}
                onClick={() => onSelect(day.date)}
                title={`${day.date} (${DAY_NAMES[dow]}): Spread ${day.spread.toFixed(0)} EUR/MWh`}
                className={`w-full flex flex-col items-center px-1 py-0.5 rounded-md transition-colors ${
                  isSelected
                    ? 'bg-[#EA1C0A]/10 ring-1 ring-[#EA1C0A]'
                    : isWeekend
                      ? 'hover:bg-gray-200/60 bg-gray-100/80'
                      : 'hover:bg-gray-100'
                }`}
              >
                {showMonth ? (
                  <span className="text-[7px] font-bold text-[#EA1C0A] tracking-wide uppercase leading-none mb-px">
                    {MONTH_NAMES_SHORT[monthIdx]}
                  </span>
                ) : (
                  <span className={`text-[7px] leading-none mb-px ${isSelected ? 'text-[#EA1C0A] font-medium' : isWeekend ? 'text-gray-500 font-medium' : 'text-gray-400'}`}>
                    {DAY_NAMES[dow]}
                  </span>
                )}
                <span className={`text-[11px] font-semibold tabular-nums leading-none ${
                  isSelected ? 'text-[#EA1C0A]' : 'text-gray-700'
                }`}>
                  {dayNum}
                </span>
                <div className={`w-3.5 h-[3px] rounded-full mt-0.5 ${spreadColor(day.spread)}`} />
              </button>
              </div>
            )
          })}
        </div>

        <button
          onClick={() => scroll(1)}
          className="shrink-0 p-0.5 rounded text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors"
          aria-label="Scroll right"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="9 18 15 12 9 6"/>
          </svg>
        </button>
      </div>
    </div>
  )
}
