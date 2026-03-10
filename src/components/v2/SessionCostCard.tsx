'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'

interface SessionCostData {
  baselineAvgCt: number
  optimizedAvgCt: number
  baselineEur: number
  optimizedEur: number
  savingsEur: number
  kwh: number
  baselineHours: { label: string; ct: number }[]
  optimizedHours: { label: string; ct: number }[]
}

interface Props {
  sessionCost: SessionCostData
  sessionsPerYear: number
  energyPerSession: number
  sessionHoursNeeded: number
  windowHours: number
  flexibilityHours: number
  baselineEndHour: number
  plugInTime: number
  isQH: boolean
  chargingMode: 'overnight' | 'fullday' | 'threeday'
  onModeChange: (mode: 'overnight' | 'fullday' | 'threeday') => void
  hasDate3Data?: boolean
}

export function SessionCostCard({
  sessionCost, sessionsPerYear, energyPerSession, sessionHoursNeeded,
  windowHours, flexibilityHours, baselineEndHour, plugInTime, isQH,
  chargingMode, onModeChange, hasDate3Data = true,
}: Props) {
  const [formulaOpen, setFormulaOpen] = useState(false)

  const modeLabel = chargingMode === 'threeday' ? '3-Day' : chargingMode === 'fullday' ? 'Full Day' : 'Overnight'

  return (
    <Card className="shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">Session Cost Breakdown</CardTitle>
        <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
          {modeLabel} · {sessionsPerYear} sessions/yr · {energyPerSession} kWh · {sessionHoursNeeded}h charge ·{' '}
          {windowHours}h window ·{' '}
          <span className={`font-semibold ${flexibilityHours > 3 ? 'text-emerald-600' : flexibilityHours > 0 ? 'text-amber-600' : 'text-red-500'}`}>
            {flexibilityHours}h flex
          </span>
        </p>
      </CardHeader>
      <CardContent className="pt-5 space-y-4 flex-1">

        {/* Hour-by-hour price table */}
        <div className="grid grid-cols-2 gap-3">
          {/* Immediate */}
          <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
            <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2.5">
              Unmanaged · first {isQH ? `${sessionHoursNeeded * 4} × 15 min` : `${sessionHoursNeeded}h`}
            </p>
            <div className="space-y-1">
              {sessionCost.baselineHours.map((h, i) => (
                <div key={i} className="flex justify-between text-[12px] leading-snug">
                  <span className="font-mono text-gray-500">{h.label}</span>
                  <span className="tabular-nums font-semibold text-red-700">{h.ct.toFixed(1)} ct</span>
                </div>
              ))}
            </div>
            <div className="border-t border-red-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
              <span className="text-gray-500 font-medium">avg</span>
              <span className="font-bold text-red-700 tabular-nums">{sessionCost.baselineAvgCt.toFixed(1)} ct/kWh</span>
            </div>
          </div>

          {/* Optimized */}
          <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-100/80">
            <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2.5">
              Optimized · cheapest {isQH ? `${sessionHoursNeeded * 4} × 15 min` : `${sessionHoursNeeded}h`}
            </p>
            <div className="space-y-1">
              {sessionCost.optimizedHours.map((h, i) => (
                <div key={i} className="flex justify-between text-[12px] leading-snug">
                  <span className="font-mono text-gray-500">{h.label}</span>
                  <span className="tabular-nums font-semibold text-emerald-700">{h.ct.toFixed(1)} ct</span>
                </div>
              ))}
            </div>
            <div className="border-t border-emerald-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
              <span className="text-gray-500 font-medium">avg</span>
              <span className="font-bold text-emerald-700 tabular-nums">{sessionCost.optimizedAvgCt.toFixed(1)} ct/kWh</span>
            </div>
          </div>
        </div>

        {/* Cost formula — collapsible */}
        <div className="border border-gray-200/60 rounded-lg overflow-hidden">
          <button
            onClick={() => setFormulaOpen(v => !v)}
            className="w-full flex items-center justify-between bg-gray-50/80 px-3.5 py-2 text-left hover:bg-gray-100/60 transition-colors">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Formula: avg ct × kWh ÷ 100 = EUR</span>
            <span className="text-[10px] text-gray-400 ml-2">{formulaOpen ? '▲' : '▼'}</span>
          </button>
          {formulaOpen && (
            <div className="px-3.5 py-3 text-[11px] space-y-1.5 bg-gray-50/40">
              <div className="flex justify-between text-gray-500">
                <span className="font-mono">{sessionCost.baselineAvgCt.toFixed(1)} ct × {sessionCost.kwh} kWh ÷ 100</span>
                <span className="font-semibold text-red-600 tabular-nums">{sessionCost.baselineEur.toFixed(2)} EUR</span>
              </div>
              <div className="flex justify-between text-gray-500">
                <span className="font-mono">{sessionCost.optimizedAvgCt.toFixed(1)} ct × {sessionCost.kwh} kWh ÷ 100</span>
                <span className="font-semibold text-emerald-600 tabular-nums">{sessionCost.optimizedEur.toFixed(2)} EUR</span>
              </div>
              <div className="flex justify-between items-center border-t border-gray-200 pt-1.5 mt-0.5">
                <span className="font-mono text-gray-400">
                  ({sessionCost.baselineAvgCt.toFixed(1)} − {sessionCost.optimizedAvgCt.toFixed(1)}) × {sessionCost.kwh} ÷ 100
                </span>
                <div className="flex items-center gap-2">
                  <span className="text-[11px] font-semibold text-emerald-600/70 tabular-nums">
                    {(sessionCost.baselineAvgCt - sessionCost.optimizedAvgCt).toFixed(1)} ct/kWh
                  </span>
                  <AnimatedNumber value={sessionCost.savingsEur} decimals={2} suffix=" EUR" className="font-bold text-emerald-700 tabular-nums" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Baseline end time note */}
        <p className="text-[10px] text-gray-400 leading-relaxed">
          Unmanaged: plug-in at{' '}
          <span className="font-mono">{String(plugInTime).padStart(2, '0')}:00</span> → done by{' '}
          <span className="font-mono">{String(baselineEndHour).padStart(2, '0')}:00</span>.
          Optimized shifts the same {sessionHoursNeeded}h to the cheapest slot in the {windowHours}h window.
        </p>

        {/* Scenario mode selector */}
        <div className="flex items-center justify-between pt-2 border-t border-gray-100">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Scenario</span>
          <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
            <button onClick={() => onModeChange('overnight')}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${chargingMode === 'overnight' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              Overnight
            </button>
            <button onClick={() => onModeChange('fullday')}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${chargingMode === 'fullday' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
              Full Day
            </button>
            <button onClick={() => onModeChange('threeday')}
              disabled={!hasDate3Data}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${chargingMode === 'threeday' ? 'bg-white text-[#313131] shadow-sm' : !hasDate3Data ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}>
              3 Days
            </button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
