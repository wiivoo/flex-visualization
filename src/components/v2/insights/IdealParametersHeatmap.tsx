'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download } from 'lucide-react'
import { toast } from 'sonner'
import type { MileageWindowGrid, PinnedDefaults } from '@/lib/insights-sweep'
import { findBestCell } from '@/lib/insights-sweep'
import type { HourlyPrice } from '@/lib/v2-config'

interface Props {
  grid: MileageWindowGrid
  mode: 'single' | 'fleet'
  fleetSize: number
  hourlyQH: HourlyPrice[]
  pinned: PinnedDefaults
}

async function triggerDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

export function IdealParametersHeatmap({ grid, mode, fleetSize, hourlyQH, pinned }: Props) {
  const allCells = grid.cells.flat()
  const maxVal = Math.max(...allCells.map(c => c.yearlySavingsEur), 0.01)
  const best = findBestCell(grid)
  const [busy, setBusy] = useState(false)

  const handleExport = async () => {
    setBusy(true)
    try {
      const { exportIdealParametersXlsx } = await import('@/lib/excel-exports/ideal-parameters')
      const { blob, filename } = await exportIdealParametersXlsx(hourlyQH, pinned, grid.mileages, grid.windowLengths)
      await triggerDownload(blob, filename)
      toast.success('Excel exported')
    } catch (e) {
      toast.error('Export failed: ' + (e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const heatColor = (val: number) => {
    const t = Math.min(val / maxVal, 1)
    return `rgba(16, 185, 129, ${0.06 + t * 0.6})`
  }

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">
            {mode === 'fleet' ? 'Fleet Savings Heatmap' : 'Target Customer Heatmap'}
          </CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-[10px] text-gray-400 font-medium uppercase tracking-wide">
              {mode === 'fleet' ? `EUR/yr fleet total · ${fleetSize.toLocaleString()} vehicles` : 'EUR/yr savings'}
            </span>
            <Button
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={handleExport}
              className="h-7 px-2 text-[11px] text-gray-500 hover:text-[#313131]">
              <Download className="w-3.5 h-3.5 mr-1" />
              {busy ? 'Exporting…' : 'Export'}
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Mileage × plug-in window length · pinned: arrival {String(grid.pinnedPlugInTime).padStart(2, '0')}:00, {grid.pinnedChargePowerKw} kW, {grid.pinnedPlugInsPerWeek}× / week · {grid.rangeLabel}
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
