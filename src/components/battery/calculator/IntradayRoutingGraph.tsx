'use client'

import { useMemo, type ReactNode } from 'react'
import { Home } from 'lucide-react'
import { Card, CardContent } from '@/components/ui/card'
import type { PvBatterySlotResult } from '@/lib/pv-battery-calculator'
import { cn } from '@/lib/utils'

interface Props {
  slots: PvBatterySlotResult[]
  dayLabel: string
}

/**
 * GitHub-style contribution graph for household consumption.
 * Each cell represents one quarter-hour slot.
 * Color intensity shows consumption magnitude.
 */
export function IntradayRoutingGraph({ slots, dayLabel }: Props) {
  // Group slots into hours (4 quarter-hours per hour)
  const hours = useMemo(() => {
    const result: PvBatterySlotResult[][] = []
    for (let i = 0; i < slots.length; i += 4) {
      result.push(slots.slice(i, i + 4))
    }
    return result
  }, [slots])

  // Calculate consumption buckets for color scaling
  const { maxConsumption, consumptionLevels } = useMemo(() => {
    const consumptions = slots.map((slot) => slot.loadKwh)
    const max = Math.max(...consumptions, 0.1)

    // Define 5 color levels based on percentiles
    const sorted = [...consumptions].sort((a, b) => a - b)
    const p20 = sorted[Math.floor(sorted.length * 0.2)] ?? 0
    const p40 = sorted[Math.floor(sorted.length * 0.4)] ?? 0
    const p60 = sorted[Math.floor(sorted.length * 0.6)] ?? 0
    const p80 = sorted[Math.floor(sorted.length * 0.8)] ?? 0

    return {
      maxConsumption: max,
      consumptionLevels: [p20, p40, p60, p80, max],
    }
  }, [slots])

  // Get color intensity for a consumption value (0-4 scale)
  const getIntensity = (consumption: number): number => {
    if (consumption <= consumptionLevels[0]) return 0
    if (consumption <= consumptionLevels[1]) return 1
    if (consumption <= consumptionLevels[2]) return 2
    if (consumption <= consumptionLevels[3]) return 3
    return 4
  }

  // Color scale: from light gray to deep blue (like GitHub but blue theme)
  const intensityColors = [
    '#EBF1F7', // level 0 - very light
    '#B8D4EB', // level 1 - light blue
    '#7FB3E0', // level 2 - medium blue
    '#4A8FD4', // level 3 - strong blue
    '#1F6BC9', // level 4 - deep blue
  ]

  const hourLabels = ['00', '03', '06', '09', '12', '15', '18', '21']

  return (
    <Card className="overflow-hidden rounded-[24px] border-[#E5E7EB] bg-white shadow-sm">
      <CardContent className="p-6 sm:p-7">
        <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[#94A3B8]">Consumption pattern</p>
            <p className="mt-1 text-[24px] font-semibold tracking-tight text-[#171717]">Household load</p>
            <p className="mt-2 text-sm leading-6 text-[#6B7280]">
              {dayLabel}. Each square represents 15 minutes. Color intensity shows consumption.
            </p>
          </div>

          {/* Legend */}
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-medium text-[#64748B]">Low</span>
            <div className="flex gap-1">
              {intensityColors.map((color, index) => (
                <div
                  key={index}
                  className="h-3 w-3 rounded-[3px]"
                  style={{ backgroundColor: color }}
                />
              ))}
            </div>
            <span className="text-[10px] font-medium text-[#64748B]">High</span>
          </div>
        </div>

        {/* Graph container */}
        <div className="overflow-x-auto">
          <div className="inline-flex min-w-full items-end gap-2 py-4">
            {/* Hour labels (left side) */}
            <div className="flex flex-col gap-1 pr-2">
              <div className="h-[18px]" /> {/* Spacer for header */}
              {hours.map((_, hourIndex) => {
                const showLabel = hourIndex % 3 === 0
                return (
                  <div
                    key={`hour-label-${hourIndex}`}
                    className="flex h-8 items-center justify-end pr-2"
                  >
                    {showLabel && (
                      <span className="text-[10px] font-medium text-[#94A3B8]">
                        {hourLabels[Math.floor(hourIndex / 3)] || `${hourIndex}:00`}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>

            {/* Graph grid */}
            <div className="flex gap-1">
              {hours.map((hourSlots, hourIndex) => (
                <div
                  key={`hour-${hourIndex}`}
                  className="flex flex-col gap-1"
                >
                  {/* Quarter-hour cells for this hour */}
                  {hourSlots.map((slot, slotIndex) => {
                    const intensity = getIntensity(slot.loadKwh)
                    const globalSlotIndex = hourIndex * 4 + slotIndex

                    return (
                      <div
                        key={`slot-${globalSlotIndex}`}
                        className={cn(
                          'h-8 w-8 rounded-[4px] transition-all hover:ring-2 hover:ring-blue-400 hover:ring-offset-1',
                          'cursor-pointer'
                        )}
                        style={{
                          backgroundColor: intensityColors[intensity],
                        }}
                        title={`${slot.label} · ${slot.loadKwh.toFixed(3)} kWh`}
                      />
                    )
                  })}
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Summary stats */}
        <div className="mt-6 grid gap-3 sm:grid-cols-4">
          <StatTile
            label="Total consumption"
            value={`${slots.reduce((sum, slot) => sum + slot.loadKwh, 0).toFixed(2)} kWh`}
            icon={Home}
          />
          <StatTile
            label="Peak quarter-hour"
            value={`${Math.max(...slots.map((s) => s.loadKwh)).toFixed(3)} kWh`}
            icon={Home}
          />
          <StatTile
            label="Avg per quarter-hour"
            value={`${(slots.reduce((sum, slot) => sum + slot.loadKwh, 0) / slots.length).toFixed(3)} kWh`}
            icon={Home}
          />
          <StatTile
            label="Slots"
            value={`${slots.length}`}
            icon={Home}
          />
        </div>
      </CardContent>
    </Card>
  )
}

function StatTile({
  label,
  value,
  icon: Icon,
}: {
  label: string
  value: string
  icon: React.ElementType
}) {
  return (
    <div className="rounded-[16px] border border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3">
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[#64748B]">
            {label}
          </p>
          <p className="mt-1 text-lg font-semibold text-[#171717]">{value}</p>
        </div>
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white">
          <Icon className="h-4 w-4 text-[#64748B]" />
        </span>
      </div>
    </div>
  )
}
