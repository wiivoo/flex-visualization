'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { MileageWindowGrid } from '@/lib/insights-sweep'
import { findBestCell } from '@/lib/insights-sweep'

interface Props {
  grid: MileageWindowGrid
}

export function IdealParametersHeatmap({ grid }: Props) {
  const allCells = grid.cells.flat()
  const maxVal = Math.max(...allCells.map(c => c.yearlySavingsEur), 0.01)
  const best = findBestCell(grid)

  const heatColor = (val: number) => {
    const t = Math.min(val / maxVal, 1)
    return `rgba(16, 185, 129, ${0.06 + t * 0.6})`
  }

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">Target Customer Heatmap</CardTitle>
          <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">EUR/yr savings</span>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Mileage × plug-in window length · pinned: plug-in {String(grid.pinnedPlugInTime).padStart(2, '0')}:00, {grid.pinnedChargePowerKw} kW, {grid.pinnedPlugInsPerWeek}× / week · last 12 months
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-center">
            <thead>
              <tr>
                <th className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide p-2 text-left">km/yr</th>
                {grid.windowLengths.map(len => (
                  <th key={len} className="text-[11px] font-bold p-2 text-gray-500 tabular-nums">
                    {len}h
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {grid.mileages.map((mil, i) => (
                <tr key={mil}>
                  <td className="text-[11px] font-semibold p-2 text-left tabular-nums text-gray-500">
                    {(mil / 1000).toFixed(0)}k
                  </td>
                  {grid.windowLengths.map((len, j) => {
                    const c = grid.cells[i][j]
                    const isBest = best && best.mileage === mil && best.windowLengthHours === len
                    return (
                      <td key={len} className="p-1">
                        <div
                          className={`rounded-md px-1.5 py-2 tabular-nums text-[11px] font-semibold transition-all ${
                            isBest ? 'ring-2 ring-[#EA1C0A] ring-offset-1 scale-105' : ''
                          }`}
                          style={{ background: heatColor(c.yearlySavingsEur) }}
                          title={`${mil.toLocaleString()} km/yr, ${len}h window, ${c.energyPerSessionKwh.toFixed(1)} kWh/session → €${c.yearlySavingsEur.toFixed(0)}/yr (${c.daysSampled} days sampled)`}>
                          <span className={c.yearlySavingsEur / maxVal > 0.7 ? 'text-white' : 'text-gray-700'}>
                            {c.yearlySavingsEur.toFixed(0)}
                          </span>
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {best && (
          <div className="mt-5 px-3 py-2.5 rounded-lg bg-emerald-50 border border-emerald-100">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Best segment</div>
            <div className="text-[12px] text-gray-700 mt-0.5">
              <span className="font-bold tabular-nums">{best.mileage.toLocaleString()} km/yr</span> drivers with a{' '}
              <span className="font-bold tabular-nums">{best.windowLengthHours}h</span> plug-in window unlock{' '}
              <span className="font-bold text-emerald-700 tabular-nums">€{best.yearlySavingsEur.toFixed(0)}/yr</span>.
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
