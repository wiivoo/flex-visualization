'use client'

import { ChevronLeft, ChevronRight, Calendar, BarChart3 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format, addDays, subDays, addMonths, subMonths, startOfMonth, endOfMonth, startOfQuarter, endOfQuarter, startOfYear, endOfYear } from 'date-fns'

export type TimeRange = 'day' | 'month' | 'quarter' | 'year'

interface TimeRangeSelectorProps {
  selectedRange: TimeRange
  selectedDate: Date
  onRangeChange: (range: TimeRange, date: Date) => void
  isLoading?: boolean
}

const RANGE_LABELS: Record<TimeRange, string> = {
  day: 'Tag',
  month: 'Monat',
  quarter: 'Quartal',
  year: 'Jahr'
}

export function TimeRangeSelector({
  selectedRange,
  selectedDate,
  onRangeChange,
  isLoading
}: TimeRangeSelectorProps) {
  const goBack = () => {
    let newDate: Date
    switch (selectedRange) {
      case 'day':
        newDate = subDays(selectedDate, 1)
        break
      case 'month':
        newDate = subMonths(selectedDate, 1)
        break
      case 'quarter':
        newDate = new Date(selectedDate)
        newDate.setMonth(newDate.getMonth() - 3)
        break
      case 'year':
        newDate = new Date(selectedDate)
        newDate.setFullYear(newDate.getFullYear() - 1)
        break
    }
    onRangeChange(selectedRange, newDate)
  }

  const goForward = () => {
    const now = new Date()
    let newDate: Date
    let maxDate: Date

    switch (selectedRange) {
      case 'day':
        newDate = addDays(selectedDate, 1)
        maxDate = addDays(now, 1)
        break
      case 'month':
        newDate = addMonths(selectedDate, 1)
        maxDate = now
        break
      case 'quarter':
        newDate = new Date(selectedDate)
        newDate.setMonth(newDate.getMonth() + 3)
        maxDate = now
        break
      case 'year':
        newDate = new Date(selectedDate)
        newDate.setFullYear(newDate.getFullYear() + 1)
        maxDate = now
        break
    }

    if (newDate <= maxDate) {
      onRangeChange(selectedRange, newDate)
    }
  }

  const goToCurrent = () => {
    onRangeChange(selectedRange, new Date())
  }

  const isCurrent = (() => {
    const now = new Date()
    switch (selectedRange) {
      case 'day':
        return selectedDate.toDateString() === now.toDateString()
      case 'month':
        return format(selectedDate, 'yyyy-MM') === format(now, 'yyyy-MM')
      case 'quarter':
        const currentQ = Math.floor(now.getMonth() / 3)
        const selectedQ = Math.floor(selectedDate.getMonth() / 3)
        return selectedQ === currentQ && selectedDate.getFullYear() === now.getFullYear()
      case 'year':
        return selectedDate.getFullYear() === now.getFullYear()
    }
  })()

  const getDisplayLabel = () => {
    switch (selectedRange) {
      case 'day':
        return format(selectedDate, 'dd.MM.yyyy')
      case 'month':
        return format(selectedDate, 'MMMM yyyy')
      case 'quarter':
        const q = Math.floor(selectedDate.getMonth() / 3) + 1
        return `Q${q} ${selectedDate.getFullYear()}`
      case 'year':
        return selectedDate.getFullYear().toString()
    }
  }

  const canGoForward = (() => {
    const now = new Date()
    switch (selectedRange) {
      case 'day':
        return addDays(selectedDate, 1) <= addDays(now, 1)
      case 'month':
        return addMonths(selectedDate, 1) <= now
      case 'quarter':
        const nextQ = new Date(selectedDate)
        nextQ.setMonth(nextQ.getMonth() + 3)
        return nextQ <= now
      case 'year':
        return selectedDate.getFullYear() < now.getFullYear()
    }
  })()

  return (
    <div className="flex flex-wrap items-center gap-3">
      {/* Range Buttons */}
      <div className="flex rounded-lg border bg-background p-1">
        {(Object.keys(RANGE_LABELS) as TimeRange[]).map((range) => (
          <button
            key={range}
            onClick={() => onRangeChange(range, selectedDate)}
            disabled={isLoading}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
              selectedRange === range
                ? 'bg-primary text-primary-foreground shadow'
                : 'text-muted-foreground hover:bg-muted'
            }`}
          >
            {RANGE_LABELS[range]}
          </button>
        ))}
      </div>

      {/* Navigation */}
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="icon"
          onClick={goBack}
          disabled={isLoading}
          aria-label="Zurück"
        >
          <ChevronLeft className="h-4 w-4" />
        </Button>

        <Button
          variant="outline"
          onClick={goToCurrent}
          disabled={isLoading || isCurrent}
          className="min-w-[140px]"
        >
          {selectedRange === 'day' ? (
            <Calendar className="mr-2 h-4 w-4" />
          ) : (
            <BarChart3 className="mr-2 h-4 w-4" />
          )}
          {isCurrent ? `Aktuell` : getDisplayLabel()}
        </Button>

        <Button
          variant="outline"
          size="icon"
          onClick={goForward}
          disabled={isLoading || !canGoForward}
          aria-label="Weiter"
        >
          <ChevronRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  )
}

// Helper to get date range for API calls
export function getDateRange(range: TimeRange, date: Date): { startDate: Date; endDate: Date } {
  switch (range) {
    case 'day':
      return { startDate: date, endDate: date }
    case 'month':
      return { startDate: startOfMonth(date), endDate: endOfMonth(date) }
    case 'quarter':
      return { startDate: startOfQuarter(date), endDate: endOfQuarter(date) }
    case 'year':
      return { startDate: startOfYear(date), endDate: endOfYear(date) }
  }
}
