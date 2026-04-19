'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { getPriceUnits, type Country } from '@/lib/v2-config'

export interface YearlySavingsEntry {
  year: number
  savings: number
  sessionsCount: number
  isProjected: boolean
  isPartial: boolean
  monthsCovered: number
  loadShiftingEur?: number
  arbitrageEur?: number
}

export interface QuarterlyEntry {
  label: string
  savings: number
  year: number
  quarter: number
}

interface Props {
  yearlySavingsData: YearlySavingsEntry[]
  weeklyPlugIns: number
  energyPerSession: number
  chargingMode?: 'overnight' | 'fullday' | 'threeday'
  isV2G?: boolean
  isFleet?: boolean
  quarterlyData?: QuarterlyEntry[]
  avgWindowSpreadCt?: number
  avgSavingsCtKwh?: number
  bestMonth?: { label: string; savings: number }
  worstMonth?: { label: string; savings: number }
  country?: Country
}

const MODE_LABELS: Record<string, string> = {
  overnight: 'overnight',
  fullday: 'full-day',
  threeday: '3-day',
}

export function YearlySavingsCard({
  yearlySavingsData, weeklyPlugIns, energyPerSession,
  chargingMode = 'overnight', isV2G = false, isFleet = false,
  quarterlyData, avgWindowSpreadCt, avgSavingsCtKwh,
  bestMonth, worstMonth, country = 'DE',
}: Props) {
  const units = getPriceUnits(country)
  const [selectedYear, setSelectedYear] = useState<number | null>(null)

  if (!yearlySavingsData || yearlySavingsData.length === 0) return null

  const currentYear = new Date().getFullYear()
  const showYears = [2024, 2025, currentYear].filter((v, i, a) => a.indexOf(v) === i)
  const filtered = yearlySavingsData
    .filter(d => showYears.includes(d.year))
    .sort((a, b) => a.year - b.year)

  if (filtered.length === 0) return null

  const currentYearEntry = filtered.find(d => d.year === currentYear)
  const maxSavings = Math.max(...filtered.map(d => d.savings), 1)

  // Quarterly data for selected year (or current year by default)
  const activeYear = selectedYear ?? currentYear
  const activeQuarters = quarterlyData?.filter(q => q.year === activeYear) ?? []
  const maxQ = activeQuarters.length > 0 ? Math.max(...activeQuarters.map(q => q.savings), 1) : 1

  // Efficiency + equivalent discount
  const efficiency = avgWindowSpreadCt && avgWindowSpreadCt > 0 && avgSavingsCtKwh
    ? Math.min(100, Math.round(avgSavingsCtKwh / avgWindowSpreadCt * 100))
    : null


  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">Savings Overview</CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          {isFleet ? '1,000 EVs · ' : ''}{weeklyPlugIns}x/week · {energyPerSession} kWh · {MODE_LABELS[chargingMode] || 'overnight'}
        </p>
      </CardHeader>
      <CardContent className="pt-4 flex-1 flex flex-col justify-center space-y-3">
        {/* Yearly bars — clickable to select year for quarterly view */}
        {filtered.map(d => {
          const isCurrent = d.year === currentYear
          const isSelected = d.year === activeYear
          const barPct = maxSavings > 0 ? Math.max((d.savings / maxSavings) * 100, 4) : 4
          const partial = d.isPartial ? `${d.monthsCovered} mo` : '12 mo'

          return (
            <div key={d.year}
              onClick={() => setSelectedYear(d.year === selectedYear ? null : d.year)}
              className={`cursor-pointer rounded-lg px-2 py-1.5 -mx-2 transition-colors ${isSelected ? 'bg-gray-50' : 'hover:bg-gray-50/50'}`}
            >
              <div className="flex items-baseline justify-between mb-1">
                <span className={`text-[11px] font-semibold ${isSelected ? 'text-[#313131]' : 'text-gray-400'}`}>
                  {d.year}{d.isPartial ? ' YTD' : ''}
                  {isSelected && <span className="ml-1 text-[8px] text-emerald-500 font-normal">selected</span>}
                </span>
                <span className={`text-[12px] tabular-nums font-bold ${isCurrent ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {'\u20AC'}{Math.round(d.savings)}{isFleet ? '/EV' : ''}
                </span>
              </div>
              <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                {isV2G && d.loadShiftingEur !== undefined && d.arbitrageEur !== undefined && d.savings > 0 ? (
                  <div className="relative h-full flex" style={{ width: `${barPct}%` }}>
                    <div className="h-full rounded-l-full bg-emerald-500"
                      style={{ width: `${(d.loadShiftingEur / d.savings) * 100}%`, opacity: isSelected ? 0.75 : 0.4 }} />
                    <div className="h-full rounded-r-full bg-blue-500"
                      style={{ width: `${(d.arbitrageEur / d.savings) * 100}%`, opacity: isSelected ? 0.75 : 0.4 }} />
                  </div>
                ) : (
                  <div className={`relative h-full rounded-full transition-all ${isSelected ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                    style={{ width: `${barPct}%`, opacity: isSelected ? 0.85 : 0.45 }} />
                )}
              </div>
              <div className="flex items-center justify-between text-[9px] text-gray-400 mt-0.5 tabular-nums">
                <span>{isFleet ? `${partial} · fleet \u20AC${Math.round(d.savings * 1000)}` : `${d.sessionsCount} sessions · ${partial}`}</span>
              </div>
            </div>
          )
        })}

        {/* Quarterly breakdown for selected year */}
        {activeQuarters.length > 0 && (
          <div className="border-t border-gray-100 pt-3">
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              {activeYear} Quarters
            </p>
            <div className="flex items-end gap-1.5 h-[52px]">
              {[1, 2, 3, 4].map(q => {
                const entry = activeQuarters.find(e => e.quarter === q)
                const sav = entry?.savings ?? 0
                const h = maxQ > 0 ? Math.max(4, (sav / maxQ) * 100) : 4
                const isWinter = q === 1 || q === 4
                return (
                  <div key={q} className="flex-1 flex flex-col items-center gap-0.5">
                    <span className="text-[9px] font-bold tabular-nums text-gray-500">
                      {sav > 0 ? `${Math.round(sav)}` : '–'}
                    </span>
                    <div className="w-full flex items-end" style={{ height: 32 }}>
                      <div
                        className={`w-full rounded-t-sm transition-all ${isWinter ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                        style={{ height: `${h}%`, opacity: sav > 0 ? (isWinter ? 0.7 : 0.45) : 0.15 }}
                      />
                    </div>
                    <span className="text-[8px] text-gray-400 font-mono">Q{q}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}

        {/* Flexibility utilization + Best/Worst month */}
        {(efficiency !== null || bestMonth || worstMonth) && (
          <div className="border-t border-gray-100 pt-3 space-y-2.5">
            {efficiency !== null && (
              <div>
                <div className="flex items-center justify-between mb-1">
                  <p className="text-[8px] text-gray-400 uppercase tracking-wide">Flexibility Utilization</p>
                  <span className="text-[11px] font-bold tabular-nums text-emerald-700">{efficiency}%</span>
                </div>
                <div className="w-full h-2 bg-gray-100 rounded-full overflow-hidden">
                  <div className="h-full rounded-full bg-emerald-500 transition-all"
                    style={{ width: `${efficiency}%`, opacity: 0.7 }} />
                </div>
                <p className="text-[8px] text-gray-400 mt-0.5">of available price spread monetized</p>
              </div>
            )}
            {(bestMonth || worstMonth) && (
              <div className="flex gap-3">
                {bestMonth && (
                  <div className="flex-1">
                    <p className="text-[8px] text-gray-400 uppercase tracking-wide">Best Month</p>
                    <p className="text-[12px] font-bold tabular-nums text-emerald-700 mt-0.5">
                      {bestMonth.label}
                      <span className="text-[9px] font-normal text-emerald-500 ml-1">{bestMonth.savings.toFixed(1)} {units.currency}</span>
                    </p>
                  </div>
                )}
                {worstMonth && (
                  <div className="flex-1">
                    <p className="text-[8px] text-gray-400 uppercase tracking-wide">Worst Month</p>
                    <p className="text-[12px] font-bold tabular-nums text-gray-500 mt-0.5">
                      {worstMonth.label}
                      <span className="text-[9px] font-normal text-gray-400 ml-1">{worstMonth.savings.toFixed(1)} {units.currency}</span>
                    </p>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
