'use client'

import { useMemo, useState, useEffect } from 'react'
import type { DailySummary } from '@/lib/v2-config'

interface MiniCalendarProps {
  daily: DailySummary[]
  selectedDate: string
  onSelect: (date: string) => void
  requireNextDay?: boolean
}

export function MiniCalendar({ daily, selectedDate, onSelect, requireNextDay = true }: MiniCalendarProps) {
  const dataRange = useMemo(() => {
    if (daily.length === 0) return { firstMonth: '', lastMonth: '' }
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    return { firstMonth: sorted[0].date.slice(0, 7), lastMonth: sorted[sorted.length - 1].date.slice(0, 7) }
  }, [daily])

  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) return selectedDate.slice(0, 7)
    if (dataRange.lastMonth) return dataRange.lastMonth
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    if (selectedDate) setViewMonth(selectedDate.slice(0, 7))
  }, [selectedDate])

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
    if (dataRange.firstMonth && newMonth < dataRange.firstMonth) return
    if (dataRange.lastMonth && newMonth > dataRange.lastMonth) return
    setViewMonth(newMonth)
  }

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
        <button onClick={() => shiftMonth(-1)} disabled={!canGoBack} aria-label="Previous month"
          className={`px-2 py-1 text-sm rounded ${canGoBack ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}>&larr;</button>
        <span className="text-sm font-bold text-[#313131]">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} disabled={!canGoForward} aria-label="Next month"
          className={`px-2 py-1 text-sm rounded ${canGoForward ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}>&rarr;</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
          <div key={d} className="text-center text-gray-400 font-medium py-1">{d}</div>
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
            <button key={day.date} onClick={() => hasNextDay && onSelect(day.date)}
              disabled={!hasNextDay}
              className={`relative p-1 rounded text-center transition-all ${
                !hasNextDay
                  ? 'opacity-30 cursor-not-allowed'
                  : `hover:ring-2 hover:ring-[#EA1C0A]/50 ${isSelected ? 'ring-2 ring-[#EA1C0A] bg-[#EA1C0A]/5' : ''}`
              }`}
              title={hasNextDay ? `${day.date}: Spread ${day.spread.toFixed(0)} EUR/MWh` : `${day.date}: no next-day data`}>
              <div className="text-[10px] text-gray-600">{dayNum}</div>
              <div className={`w-full h-1.5 rounded-full mt-0.5 ${hasNextDay ? spreadColor(day.spread) : 'bg-gray-200'}`} />
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
