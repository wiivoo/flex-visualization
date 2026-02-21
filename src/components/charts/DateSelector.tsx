'use client'

import { ChevronLeft, ChevronRight, Calendar } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { format, addDays, subDays } from 'date-fns'
import { de } from 'date-fns/locale'

interface DateSelectorProps {
  selectedDate: Date
  onDateChange: (date: Date) => void
  isLoading?: boolean
}

export function DateSelector({ selectedDate, onDateChange, isLoading }: DateSelectorProps) {
  const goToPreviousDay = () => {
    onDateChange(subDays(selectedDate, 1))
  }

  const goToNextDay = () => {
    const tomorrow = addDays(new Date(), 1)
    if (addDays(selectedDate, 1) <= tomorrow) {
      onDateChange(addDays(selectedDate, 1))
    }
  }

  const goToToday = () => {
    onDateChange(new Date())
  }

  const isToday = selectedDate.toDateString() === new Date().toDateString()
  const isFuture = selectedDate > new Date()
  const canGoNext = addDays(selectedDate, 1) <= addDays(new Date(), 1)

  return (
    <div className="flex items-center gap-2">
      <Button
        variant="outline"
        size="icon"
        onClick={goToPreviousDay}
        disabled={isLoading}
        aria-label="Vorheriger Tag"
      >
        <ChevronLeft className="h-4 w-4" />
      </Button>

      <Button
        variant="outline"
        onClick={goToToday}
        disabled={isLoading || isToday}
        className="min-w-[120px]"
      >
        <Calendar className="mr-2 h-4 w-4" />
        {isToday ? 'Heute' : format(selectedDate, 'd. MMM', { locale: de })}
      </Button>

      <Button
        variant="outline"
        size="icon"
        onClick={goToNextDay}
        disabled={isLoading || !canGoNext}
        aria-label="Nachster Tag"
      >
        <ChevronRight className="h-4 w-4" />
      </Button>

      {isFuture && (
        <span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-xs font-medium text-amber-800 dark:bg-amber-900/30 dark:text-amber-400">
          Prognose
        </span>
      )}
    </div>
  )
}
