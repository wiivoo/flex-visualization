'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { HourlyPrice } from '@/lib/v2-config'
import { computeMonthlyQhAverages } from '@/lib/price-patterns'

interface Props {
  hourlyQH: HourlyPrice[]
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** Sequential emerald → amber → red interpolator in [0, 1]. */
function heatColor(t: number): string {
  const clamped = Math.max(0, Math.min(1, t))
  // Stops: 0 emerald-50 (#ecfdf5) → 0.5 amber-300 (#fcd34d) → 1 red-500 (#ef4444)
  const lerp = (a: number, b: number, k: number) => Math.round(a + (b - a) * k)
  if (clamped < 0.5) {
    const k = clamped / 0.5
    const r = lerp(0xec, 0xfc, k)
    const g = lerp(0xfd, 0xd3, k)
    const b = lerp(0xf5, 0x4d, k)
    return `rgb(${r}, ${g}, ${b})`
  }
  const k = (clamped - 0.5) / 0.5
  const r = lerp(0xfc, 0xef, k)
  const g = lerp(0xd3, 0x44, k)
  const b = lerp(0x4d, 0x44, k)
  return `rgb(${r}, ${g}, ${b})`
}

export function PricePatternsHeatmap({ hourlyQH }: Props) {
  const matrix = useMemo(() => computeMonthlyQhAverages(hourlyQH), [hourlyQH])

  if (matrix.sampleCount === 0) {
    return (
      <Card className="overflow-hidden shadow-sm border-gray-200/80">
        <CardHeader className="pb-3 border-b border-gray-100">
          <CardTitle className="text-base font-bold text-[#313131]">Price Patterns</CardTitle>
          <p className="text-[11px] text-gray-500 mt-1">No QH price data available.</p>
        </CardHeader>
      </Card>
    )
  }

  const { cells, p5, p95, min, max } = matrix
  const range = Math.max(0.0001, p95 - p5)

  // X-axis labels every 3 hours (qh indices 0, 12, 24, ... 84). Total 8 labels.
  const hourTicks: { qh: number; label: string }[] = []
  for (let h = 0; h < 24; h += 3) hourTicks.push({ qh: h * 4, label: `${String(h).padStart(2, '0')}` })

  // Legend gradient stops (5 ticks from p5 to p95)
  const legendStops = [0, 0.25, 0.5, 0.75, 1].map(t => ({ t, value: p5 + t * (p95 - p5) }))

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">Price Patterns — when power is cheap</CardTitle>
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide tabular-nums">
            avg ct/kWh · month × time of day
          </span>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Quarter-hourly SMARD day-ahead prices averaged per month and time slot.
          Color scale clamped to p5–p95 ({p5.toFixed(1)}–{p95.toFixed(1)} ct/kWh) so seasonal outliers don&apos;t wash out the pattern.
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="overflow-x-auto">
          <table className="border-collapse" style={{ minWidth: 680 }}>
            <thead>
              <tr>
                <th className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide pr-2 text-left w-10">Mo</th>
                {Array.from({ length: 96 }).map((_, q) => {
                  const tick = hourTicks.find(t => t.qh === q)
                  return (
                    <th key={q} className="text-[10px] font-semibold text-gray-400 tabular-nums" style={{ width: 7, padding: 0 }}>
                      {tick ? tick.label : ''}
                    </th>
                  )
                })}
              </tr>
            </thead>
            <tbody>
              {cells.map((row, m) => (
                <tr key={m}>
                  <td className="text-[11px] font-semibold pr-2 text-left tabular-nums text-gray-500 w-10">
                    {MONTH_LABELS[m]}
                  </td>
                  {row.map((v, q) => {
                    if (Number.isNaN(v)) {
                      return (
                        <td key={q} style={{ width: 7, height: 18, padding: 0 }}>
                          <div style={{ width: '100%', height: '100%', background: '#f3f4f6' }} />
                        </td>
                      )
                    }
                    const t = (v - p5) / range
                    const hh = Math.floor(q / 4)
                    const mm = (q % 4) * 15
                    return (
                      <td
                        key={q}
                        style={{ width: 7, height: 18, padding: 0 }}
                        title={`${MONTH_LABELS[m]} ${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')} — ${v.toFixed(1)} ct/kWh`}
                      >
                        <div style={{ width: '100%', height: '100%', background: heatColor(t) }} />
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Legend strip */}
        <div className="mt-4 flex items-center gap-3">
          <span className="text-[10px] text-gray-500 tabular-nums">min {min.toFixed(1)}</span>
          <div className="flex-1 h-3 rounded-sm overflow-hidden flex">
            {Array.from({ length: 40 }).map((_, i) => (
              <div key={i} style={{ flex: 1, background: heatColor(i / 39) }} />
            ))}
          </div>
          <span className="text-[10px] text-gray-500 tabular-nums">max {max.toFixed(1)}</span>
        </div>
        <div className="mt-1 flex justify-between text-[10px] text-gray-400 tabular-nums px-10">
          {legendStops.map((s, i) => (
            <span key={i}>{s.value.toFixed(1)}</span>
          ))}
        </div>
      </CardContent>
    </Card>
  )
}
