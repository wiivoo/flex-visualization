'use client'

import { useMemo, useState, useCallback } from 'react'
import type { DailySummary } from '@/lib/v2-config'

interface MiniCalendarProps {
  daily: DailySummary[]
  selectedDate: string
  onSelect: (date: string) => void
  requireNextDay?: boolean
  compact?: boolean
}

const MONTH_NAMES_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export function MiniCalendar({ daily, selectedDate, onSelect, requireNextDay = true, compact = false }: MiniCalendarProps) {
  const [hoveredDay, setHoveredDay] = useState<DailySummary | null>(null)
  const [hoverPos, setHoverPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 })
  const dataRange = useMemo(() => {
    if (daily.length === 0) return { firstMonth: '', lastMonth: '', firstYear: 0, lastYear: 0 }
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    const firstMonth = sorted[0].date.slice(0, 7)
    const lastMonth = sorted[sorted.length - 1].date.slice(0, 7)
    return {
      firstMonth,
      lastMonth,
      firstYear: parseInt(firstMonth.slice(0, 4)),
      lastYear: parseInt(lastMonth.slice(0, 4)),
    }
  }, [daily])

  const selectedMonth = selectedDate ? selectedDate.slice(0, 7) : ''
  const [viewMonthState, setViewMonthState] = useState(() => {
    if (selectedMonth) return { month: selectedMonth, syncedSelectedMonth: selectedMonth }
    if (dataRange.lastMonth) {
      return { month: dataRange.lastMonth, syncedSelectedMonth: selectedMonth }
    }
    const now = new Date()
    return {
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`,
      syncedSelectedMonth: selectedMonth,
    }
  })
  const viewMonth = viewMonthState.syncedSelectedMonth === selectedMonth
    ? viewMonthState.month
    : (selectedMonth || viewMonthState.month)

  const [showMonthPicker, setShowMonthPicker] = useState(false)

  const viewYear = parseInt(viewMonth.slice(0, 4))
  const viewMonthNum = parseInt(viewMonth.slice(5, 7))

  // Set of all dates that have data — used to check t+1 availability
  const allDates = useMemo(() => new Set(daily.map(d => d.date)), [daily])

  const monthDays = useMemo(() => {
    const [year, month] = viewMonth.split('-').map(Number)
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
    const dailyMap = new Map(daily.map(d => [d.date, d]))
    const days: (DailySummary | null)[] = []
    for (let i = 0; i < startPad; i++) days.push(null)
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push(dailyMap.get(dateStr) || null)
    }
    return days
  }, [viewMonth, daily])

  const monthLabel = useMemo(() => {
    const [y, m] = viewMonth.split('-').map(Number)
    return new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'long' })
  }, [viewMonth])

  const canGoBack = dataRange.firstMonth && viewMonth > dataRange.firstMonth
  const canGoForward = dataRange.lastMonth && viewMonth < dataRange.lastMonth
  const canYearBack = dataRange.firstYear && viewYear > dataRange.firstYear
  const canYearForward = dataRange.lastYear && viewYear < dataRange.lastYear

  const shiftMonth = useCallback((delta: number) => {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (dataRange.firstMonth && newMonth < dataRange.firstMonth) return
    if (dataRange.lastMonth && newMonth > dataRange.lastMonth) return
    setViewMonthState({ month: newMonth, syncedSelectedMonth: selectedMonth })
  }, [viewMonth, dataRange, selectedMonth])

  function shiftYear(delta: number) {
    const newYear = viewYear + delta
    if (dataRange.firstYear && newYear < dataRange.firstYear) return
    if (dataRange.lastYear && newYear > dataRange.lastYear) return
    // Keep same month but clamp to data range
    const newMonth = `${newYear}-${String(viewMonthNum).padStart(2, '0')}`
    if (dataRange.firstMonth && newMonth < dataRange.firstMonth) {
      setViewMonthState({ month: dataRange.firstMonth, syncedSelectedMonth: selectedMonth })
    } else if (dataRange.lastMonth && newMonth > dataRange.lastMonth) {
      setViewMonthState({ month: dataRange.lastMonth, syncedSelectedMonth: selectedMonth })
    } else {
      setViewMonthState({ month: newMonth, syncedSelectedMonth: selectedMonth })
    }
  }

  function selectMonth(monthIdx: number) {
    const newMonth = `${viewYear}-${String(monthIdx + 1).padStart(2, '0')}`
    if (dataRange.firstMonth && newMonth < dataRange.firstMonth) return
    if (dataRange.lastMonth && newMonth > dataRange.lastMonth) return
    setViewMonthState({ month: newMonth, syncedSelectedMonth: selectedMonth })
    setShowMonthPicker(false)
  }

  function spreadColor(spread: number): string {
    if (spread > 200) return 'bg-red-500'
    if (spread > 150) return 'bg-orange-400'
    if (spread > 100) return 'bg-yellow-400'
    if (spread > 50) return 'bg-green-300'
    return 'bg-green-100'
  }

  function isMonthInRange(monthIdx: number): boolean {
    const m = `${viewYear}-${String(monthIdx + 1).padStart(2, '0')}`
    if (dataRange.firstMonth && m < dataRange.firstMonth) return false
    if (dataRange.lastMonth && m > dataRange.lastMonth) return false
    return true
  }

  function isCurrentViewMonth(monthIdx: number): boolean {
    return viewMonthNum === monthIdx + 1
  }

  return (
    <div className={compact ? 'w-[260px]' : 'w-full'}>
      {/* Year navigation row */}
      <div className={`flex items-center justify-between ${compact ? 'mb-0.5' : 'mb-1'}`}>
        <button
          onClick={() => shiftYear(-1)}
          disabled={!canYearBack}
          aria-label="Previous year"
          className={`px-1.5 py-0.5 text-[11px] rounded ${canYearBack ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
        >
          &lsaquo;
        </button>
        <button
          onClick={() => setShowMonthPicker(prev => !prev)}
          className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-[#313131] hover:text-[#EA1C0A] transition-colors cursor-pointer`}
          aria-label="Toggle month picker"
        >
          {viewYear}
        </button>
        <button
          onClick={() => shiftYear(1)}
          disabled={!canYearForward}
          aria-label="Next year"
          className={`px-1.5 py-0.5 text-[11px] rounded ${canYearForward ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
        >
          &rsaquo;
        </button>
      </div>

      {/* Month picker grid (3 cols x 4 rows) */}
      {showMonthPicker && (
        <div className={`grid grid-cols-3 ${compact ? 'gap-0.5 mb-1.5 p-1' : 'gap-1 mb-2 p-1.5'} bg-gray-50 rounded-lg border border-gray-100`}>
          {MONTH_NAMES_SHORT.map((name, idx) => {
            const inRange = isMonthInRange(idx)
            const isCurrent = isCurrentViewMonth(idx)
            return (
              <button
                key={name}
                onClick={() => inRange && selectMonth(idx)}
                disabled={!inRange}
                className={`text-[10px] py-1 px-1 rounded transition-all ${
                  !inRange
                    ? 'text-gray-300 cursor-not-allowed'
                    : isCurrent
                      ? 'bg-[#EA1C0A] text-white font-semibold'
                      : 'text-gray-600 hover:bg-gray-200'
                }`}
              >
                {name}
              </button>
            )
          })}
        </div>
      )}

      {/* Month navigation row */}
      <div className={`flex items-center justify-between ${compact ? 'mb-1' : 'mb-2'}`}>
        <button
          onClick={() => shiftMonth(-1)}
          disabled={!canGoBack}
          aria-label="Previous month"
          className={`${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'} rounded ${canGoBack ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
        >
          &larr;
        </button>
        <span className={`${compact ? 'text-xs' : 'text-sm'} font-bold text-[#313131]`}>{monthLabel}</span>
        <button
          onClick={() => shiftMonth(1)}
          disabled={!canGoForward}
          aria-label="Next month"
          className={`${compact ? 'px-1.5 py-0.5 text-xs' : 'px-2 py-1 text-sm'} rounded ${canGoForward ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}
        >
          &rarr;
        </button>
      </div>

      {/* Day grid */}
      <div className={`grid grid-cols-7 ${compact ? 'gap-0.5 text-[10px]' : 'gap-1 text-xs'}`}>
        {['Mo', 'Tu', 'We', 'Th', 'Fr'].map(d => (
          <div key={d} className={`text-center text-gray-400 font-medium ${compact ? 'py-0.5' : 'py-1'}`}>{d}</div>
        ))}
        {['Sa', 'Su'].map(d => (
          <div key={d} className={`text-center text-gray-400 font-medium ${compact ? 'py-0.5' : 'py-1'} bg-gray-50/50 rounded-t`}>{d}</div>
        ))}
        {monthDays.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />
          const dayNum = parseInt(day.date.split('-')[2])
          const isSelected = day.date === selectedDate
          // Check if t+1 data exists (required for overnight chart)
          const nd = new Date(day.date + 'T12:00:00Z')
          nd.setUTCDate(nd.getUTCDate() + 1)
          const nextDateStr = nd.toISOString().slice(0, 10)
          const hasNextDay = requireNextDay ? allDates.has(nextDateStr) : true
          return (
            <button
              key={day.date}
              onClick={() => hasNextDay && onSelect(day.date)}
              disabled={!hasNextDay}
              onMouseEnter={(e) => {
                if (!hasNextDay) return
                const rect = e.currentTarget.getBoundingClientRect()
                setHoveredDay(day)
                setHoverPos({ x: rect.left + rect.width / 2, y: rect.top })
              }}
              onMouseLeave={() => setHoveredDay(null)}
              className={`relative ${compact ? 'p-0.5' : 'p-1'} rounded text-center transition-all ${
                !hasNextDay
                  ? 'opacity-30 cursor-not-allowed'
                  : `hover:ring-2 hover:ring-[#EA1C0A]/50 ${isSelected ? 'ring-2 ring-[#EA1C0A] bg-[#EA1C0A]/5' : ''}`
              } ${(() => { const dow = new Date(day.date + 'T12:00:00Z').getUTCDay(); return dow === 0 || dow === 6 ? 'bg-gray-50' : '' })()}`}
            >
              <div className={`${compact ? 'text-[9px]' : 'text-[10px]'} text-gray-600`}>{dayNum}</div>
              <div className={`w-full ${compact ? 'h-1' : 'h-1.5'} rounded-full mt-0.5 ${hasNextDay ? spreadColor(day.spread) : 'bg-gray-200'}`} />
            </button>
          )
        })}
      </div>

      {/* Legend */}
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 ${compact ? 'mt-2' : 'mt-3'} text-[10px] text-gray-500`}>
        <span>Spread:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-100 rounded" />Low</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-yellow-400 rounded" />Med</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-500 rounded" />High</span>
      </div>

      {/* Day hover tooltip */}
      {hoveredDay && (
        <div
          className="fixed z-50 pointer-events-none"
          style={{ left: hoverPos.x, top: hoverPos.y - 4, transform: 'translate(-50%, -100%)' }}
        >
          <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] tabular-nums whitespace-nowrap">
            <p className="text-gray-500 text-[10px] font-medium mb-1">{hoveredDay.date}</p>
            <div className="space-y-0.5">
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">24h Spread</span>
                <span className="font-semibold text-gray-700">{(hoveredDay.spread / 10).toFixed(1)} ct/kWh</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Window Spread</span>
                <span className="font-semibold text-gray-700">{(hoveredDay.nightSpread / 10).toFixed(1)} ct/kWh</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Avg. Price</span>
                <span className="font-semibold text-gray-700">{hoveredDay.avgPrice.toFixed(1)} ct/kWh</span>
              </div>
              <div className="flex justify-between gap-4 border-t border-gray-100 pt-0.5 mt-0.5">
                <span className="text-gray-400">Day avg (6–22h)</span>
                <span className="font-medium text-gray-600">{(hoveredDay.dayAvgPrice / 10).toFixed(1)} ct</span>
              </div>
              <div className="flex justify-between gap-4">
                <span className="text-gray-400">Night avg (22–6h)</span>
                <span className="font-medium text-gray-600">{(hoveredDay.nightAvgPrice / 10).toFixed(1)} ct</span>
              </div>
              {hoveredDay.negativeHours > 0 && (
                <div className="flex justify-between gap-4">
                  <span className="text-gray-400">Negative hours</span>
                  <span className="font-medium text-red-500">{hoveredDay.negativeHours}h</span>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
