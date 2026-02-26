'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { ChargingBlock } from '@/lib/config'

interface ChargingTimelineProps {
  schedule: ChargingBlock[]
  windowStart: string
  windowEnd: string
  isLoading?: boolean
}

export function ChargingTimeline({ schedule, windowStart, windowEnd, isLoading }: ChargingTimelineProps) {
  // Parse window hours
  const windowStartH = parseInt(windowStart.split(':')[0])
  const windowEndH = parseInt(windowEnd.split(':')[0])

  // Create array of hours in the window (handles overnight)
  const windowHours = useMemo(() => {
    const hours: number[] = []
    let h = windowStartH
    while (h !== windowEndH) {
      hours.push(h)
      h = (h + 1) % 24
    }
    hours.push(windowEndH) // Include end hour for display
    return hours
  }, [windowStartH, windowEndH])

  // Determine which hours have charging
  const chargingMap = useMemo(() => {
    const map = new Map<number, { active: boolean; price: number; kwh: number }>()
    schedule.forEach(block => {
      const [startH] = block.start.split(':').map(Number)
      const [endH] = block.end.split(':').map(Number)
      let h = startH
      const totalIntervals = block.kwh / (block.kwh / (
        ((endH * 60 + parseInt(block.end.split(':')[1])) -
         (startH * 60 + parseInt(block.start.split(':')[1])) +
         (endH < startH ? 24 * 60 : 0)) / 60
      ))
      while (h !== endH || (h === startH && startH === endH)) {
        map.set(h, {
          active: true,
          price: block.price_ct_kwh,
          kwh: block.kwh / Math.max(1, Math.abs(endH - startH) || 1)
        })
        h = (h + 1) % 24
        if (h === endH) break
      }
    })
    return map
  }, [schedule])

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Charging Timeline</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-12 animate-pulse rounded bg-muted" />
        </CardContent>
      </Card>
    )
  }

  if (schedule.length === 0) {
    return null
  }

  const totalKwh = schedule.reduce((sum, b) => sum + b.kwh, 0)
  const totalHours = schedule.reduce((sum, block) => {
    const [sH, sM] = block.start.split(':').map(Number)
    const [eH, eM] = block.end.split(':').map(Number)
    let diff = (eH * 60 + eM) - (sH * 60 + sM)
    if (diff < 0) diff += 24 * 60
    return sum + diff / 60
  }, 0)

  return (
    <Card>
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base">Charging Plan</CardTitle>
          <div className="flex items-center gap-2">
            <Badge variant="secondary" className="text-xs">
              {totalKwh.toFixed(1)} kWh
            </Badge>
            <Badge variant="outline" className="text-xs">
              {totalHours.toFixed(1)} hrs
            </Badge>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {/* Gantt-style timeline */}
        <div className="relative">
          {/* Hour labels */}
          <div className="flex">
            {windowHours.slice(0, -1).map((h) => (
              <div
                key={h}
                className="flex-1 text-center text-xs text-muted-foreground"
              >
                {h.toString().padStart(2, '0')}
              </div>
            ))}
          </div>

          {/* Timeline bar */}
          <div className="mt-1 flex h-8 overflow-hidden rounded-lg border">
            {windowHours.slice(0, -1).map((h) => {
              const isActive = chargingMap.has(h)
              return (
                <div
                  key={h}
                  className={`flex flex-1 items-center justify-center border-r last:border-r-0 text-xs font-medium transition-colors ${
                    isActive
                      ? 'bg-green-500/30 text-green-700 dark:bg-green-500/20 dark:text-green-400'
                      : 'bg-muted/30 text-muted-foreground'
                  }`}
                  title={isActive ? `${h}:00 - Charging active` : `${h}:00 - Not charging`}
                >
                  {isActive ? 'C' : ''}
                </div>
              )
            })}
          </div>

          {/* Legend */}
          <div className="mt-2 flex items-center gap-4 text-xs text-muted-foreground">
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-green-500/30 dark:bg-green-500/20" />
              <span>Charging active</span>
            </div>
            <div className="flex items-center gap-1">
              <div className="h-3 w-3 rounded bg-muted/30" />
              <span>Not charging</span>
            </div>
          </div>
        </div>

        {/* Charging blocks detail */}
        <div className="mt-3 space-y-1.5">
          {schedule.map((block, i) => (
            <div key={i} className="flex items-center justify-between rounded border bg-green-50/50 px-3 py-1.5 dark:bg-green-950/20">
              <span className="text-sm font-medium">{block.start} - {block.end}</span>
              <div className="flex items-center gap-2">
                <span className="text-xs text-muted-foreground">{block.kwh.toFixed(1)} kWh</span>
                <Badge variant="secondary" className="bg-green-100 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                  {block.price_ct_kwh.toFixed(2)} ct/kWh
                </Badge>
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
