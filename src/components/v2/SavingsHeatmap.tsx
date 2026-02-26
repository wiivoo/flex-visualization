'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { ChargingScenario } from '@/lib/v2-config'

const PLUGIN_HOUR_MIN = 14
const PLUGIN_HOUR_MAX = 22

export interface HeatmapEntry {
  mileage: number
  plugIns: number
  savings: number
  spreadCt: number
  kwhPerSession: number
}

interface Props {
  heatmapData: HeatmapEntry[]
  scenario: ChargingScenario
  setScenario: (s: ChargingScenario) => void
  hasProjectedData?: boolean
}

const MILEAGES = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
const PLUGINS = [1, 2, 3, 4, 5, 6, 7]

export function SavingsHeatmap({ heatmapData, scenario, setScenario, hasProjectedData }: Props) {
  const [heatmapUnit, setHeatmapUnit] = useState<'eur' | 'ct'>('eur')

  const maxVal = Math.max(...heatmapData.map(d => heatmapUnit === 'eur' ? d.savings : d.spreadCt), 0.01)
  const heatColor = (val: number) => {
    const t = Math.min(val / maxVal, 1)
    return `rgba(16, 185, 129, ${0.06 + t * 0.54})`
  }
  const cellData = (mil: number, pi: number) => heatmapData.find(d => d.mileage === mil && d.plugIns === pi)

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">Savings Sensitivity</CardTitle>
          <div className="flex items-center gap-1.5 bg-gray-100 rounded-full p-0.5">
            <button onClick={() => setHeatmapUnit('eur')}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${heatmapUnit === 'eur' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              EUR/yr
            </button>
            <button onClick={() => setHeatmapUnit('ct')}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${heatmapUnit === 'ct' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              ct/kWh
            </button>
          </div>
        </div>
        <p className="text-[13px] text-gray-500 mt-1">
          {heatmapUnit === 'eur' ? 'Yearly savings (EUR/yr)' : 'Avg spread (ct/kWh)'} · mileage vs. charging frequency · adjust plug-in time below{hasProjectedData ? ' (includes projected prices)' : ''}
        </p>
      </CardHeader>
      <CardContent className="pt-5">
        <div className="flex gap-5 items-start">

          {/* Vertical plug-in time slider */}
          <div className="flex gap-2 shrink-0 select-none" style={{ height: `${MILEAGES.length * 40 + 24}px` }}>
            <div className="flex flex-col items-center gap-1 h-full">
              <span className="text-[10px] text-gray-400 tabular-nums">14:00</span>
              <input
                type="range" min={PLUGIN_HOUR_MIN} max={PLUGIN_HOUR_MAX} step={1}
                value={scenario.plugInTime}
                onChange={(e) => setScenario({ ...scenario, plugInTime: Number(e.target.value) })}
                aria-label={`Plug-in time: ${scenario.plugInTime}:00`}
                style={{ writingMode: 'vertical-lr' } as React.CSSProperties}
                className="flex-1 w-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                  [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                  [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                  [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                  [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              <span className="text-[10px] text-gray-400 tabular-nums">22:00</span>
            </div>
            <div className="flex flex-col justify-center">
              <span className="text-[11px] font-bold text-[#313131] tabular-nums -rotate-90 whitespace-nowrap origin-center">
                {String(scenario.plugInTime).padStart(2,'0')}:00
              </span>
            </div>
          </div>

          {/* Heatmap table */}
          <div className="flex-1 overflow-x-auto">
            <table className="w-full border-collapse text-center">
              <thead>
                <tr>
                  <th className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide p-2 text-left">km/yr</th>
                  {PLUGINS.map(pi => (
                    <th key={pi} className={`text-[11px] font-bold p-2 transition-colors ${pi === (scenario.weekdayPlugIns + scenario.weekendPlugIns) ? 'text-[#EA1C0A]' : 'text-gray-400'}`}>
                      {pi}x
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MILEAGES.map(mil => (
                  <tr key={mil}>
                    <td className={`text-[11px] font-semibold p-2 text-left tabular-nums transition-colors ${mil === scenario.yearlyMileageKm ? 'text-[#EA1C0A] font-bold' : 'text-gray-500'}`}>
                      {(mil / 1000).toFixed(0)}k
                    </td>
                    {PLUGINS.map(pi => {
                      const d = cellData(mil, pi)
                      const isActive = mil === scenario.yearlyMileageKm && pi === (scenario.weekdayPlugIns + scenario.weekendPlugIns)
                      return (
                        <td key={pi} className="p-1">
                          <div
                            className={`rounded-md px-1.5 py-2 tabular-nums text-[11px] font-semibold transition-all ${
                              isActive ? 'ring-2 ring-[#EA1C0A] ring-offset-1 scale-105' : ''
                            }`}
                            style={{ background: d ? heatColor(heatmapUnit === 'eur' ? d.savings : d.spreadCt) : '#f9fafb' }}
                            title={d ? `${mil.toLocaleString()} km, ${pi}x/wk, ${d.kwhPerSession} kWh/session → ${d.savings.toFixed(1)} EUR/yr · ${d.spreadCt.toFixed(1)} ct/kWh` : ''}>
                            <span className={d && (heatmapUnit === 'eur' ? d.savings : d.spreadCt) / maxVal > 0.7 ? 'text-white' : 'text-gray-700'}>
                              {d ? (heatmapUnit === 'eur' ? d.savings.toFixed(0) : d.spreadCt.toFixed(1)) : '-'}
                            </span>
                          </div>
                        </td>
                      )
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <div className="flex justify-end mt-4 px-2">
              <span className="text-[10px] text-gray-400 font-medium">Your profile highlighted · last 12 months</span>
            </div>
          </div>

        </div>
      </CardContent>
    </Card>
  )
}
