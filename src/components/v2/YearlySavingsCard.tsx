'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

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
  label: string   // "Q1 '25"
  savings: number
}

interface Props {
  yearlySavingsData: YearlySavingsEntry[]
  weeklyPlugIns: number
  energyPerSession: number
  chargingMode?: 'overnight' | 'fullday' | 'threeday'
  isV2G?: boolean
  isFleet?: boolean
  quarterlyData?: QuarterlyEntry[]
  avgWindowSpreadCt?: number   // avg daily window spread for efficiency calc
  avgSavingsCtKwh?: number     // avg actual savings for efficiency calc
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
}: Props) {
  if (!yearlySavingsData || yearlySavingsData.length === 0) return null

  const currentYear = new Date().getFullYear()
  const showYears = [2024, 2025, currentYear].filter((v, i, a) => a.indexOf(v) === i)
  const filtered = yearlySavingsData
    .filter(d => showYears.includes(d.year))
    .sort((a, b) => a.year - b.year)

  if (filtered.length === 0) return null

  const entry2025 = yearlySavingsData.find(d => d.year === 2025)
  const currentYearEntry = filtered.find(d => d.year === currentYear)
  const currentYearMonths = currentYearEntry?.monthsCovered ?? 0

  let ytdRef2025 = 0
  if (entry2025 && entry2025.monthsCovered > 0 && currentYearMonths > 0 && currentYear > 2025) {
    const perMonthAvg2025 = entry2025.savings / entry2025.monthsCovered
    ytdRef2025 = Math.round(perMonthAvg2025 * currentYearMonths * 100) / 100
  }

  const maxSavings = Math.max(...filtered.map(d => d.savings), ytdRef2025, 1)

  // Savings efficiency: what % of the theoretical window spread do we actually capture?
  const efficiency = avgWindowSpreadCt && avgWindowSpreadCt > 0 && avgSavingsCtKwh
    ? Math.min(100, Math.round(avgSavingsCtKwh / avgWindowSpreadCt * 100))
    : null

  // Equivalent tariff discount: annual savings / annual kWh
  const sessionsPerYear = weeklyPlugIns * 52
  const annualKwh = sessionsPerYear * energyPerSession
  const latestSavings = currentYearEntry?.savings ?? filtered[filtered.length - 1]?.savings ?? 0
  const tariffDiscount = annualKwh > 0
    ? Math.round(latestSavings / annualKwh * 10000) / 100 // EUR to ct/kWh
    : null

  // Quarterly bars
  const hasQuarterly = quarterlyData && quarterlyData.length > 0
  const maxQ = hasQuarterly ? Math.max(...quarterlyData.map(q => q.savings), 1) : 1

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">Yearly Savings</CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          {isFleet ? '1,000 EVs · ' : ''}{weeklyPlugIns}x/week · {energyPerSession} kWh · {MODE_LABELS[chargingMode] || 'overnight'}
        </p>
      </CardHeader>
      <CardContent className="pt-4 flex-1 flex flex-col justify-center space-y-3">
        {/* Yearly bars */}
        {filtered.map(d => {
          const isCurrent = d.year === currentYear
          const barPct = maxSavings > 0 ? Math.max((d.savings / maxSavings) * 100, 4) : 4
          const partial = d.isPartial ? `${d.monthsCovered} mo` : '12 mo'
          const refPct = isCurrent && ytdRef2025 > 0 && maxSavings > 0
            ? Math.max((ytdRef2025 / maxSavings) * 100, 4) : 0

          return (
            <div key={d.year}>
              <div className="flex items-baseline justify-between mb-1">
                <span className={`text-[11px] font-semibold ${isCurrent ? 'text-[#313131]' : 'text-gray-400'}`}>
                  {d.year}{d.isPartial ? ' YTD' : ''}
                </span>
                <span className={`text-[12px] tabular-nums font-bold ${isCurrent ? 'text-emerald-700' : 'text-gray-500'}`}>
                  {'\u20AC'}{Math.round(d.savings)}{isFleet ? '/EV' : ''}
                </span>
              </div>
              <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                {refPct > 0 && (
                  <div className="absolute inset-y-0 left-0 rounded-full bg-amber-300"
                    style={{ width: `${refPct}%`, opacity: 0.35 }} />
                )}
                {isV2G && d.loadShiftingEur !== undefined && d.arbitrageEur !== undefined && d.savings > 0 ? (
                  <div className="relative h-full flex" style={{ width: `${barPct}%` }}>
                    <div className="h-full rounded-l-full bg-emerald-500"
                      style={{ width: `${(d.loadShiftingEur / d.savings) * 100}%`, opacity: isCurrent ? 0.75 : 0.4 }} />
                    <div className="h-full rounded-r-full bg-blue-500"
                      style={{ width: `${(d.arbitrageEur / d.savings) * 100}%`, opacity: isCurrent ? 0.75 : 0.4 }} />
                  </div>
                ) : (
                  <div className={`relative h-full rounded-full transition-all ${isCurrent ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                    style={{ width: `${barPct}%`, opacity: isCurrent ? 0.85 : 0.45 }} />
                )}
              </div>
              <div className="flex items-center justify-between text-[9px] text-gray-400 mt-0.5 tabular-nums">
                <span>{isFleet ? `${partial} · fleet \u20AC${Math.round(d.savings * 1000)}` : `${d.sessionsCount} sessions · ${partial}`}</span>
                {isCurrent && ytdRef2025 > 0 && (
                  <span className="text-amber-600/70">{'\u20AC'}{Math.round(ytdRef2025)} in &apos;25</span>
                )}
              </div>
            </div>
          )
        })}

        {/* YoY comparison */}
        {ytdRef2025 > 0 && currentYearEntry && currentYearEntry.savings > 0 && (
          <div className="border-t border-gray-100 pt-2 mt-1 text-center">
            <span className={`text-[11px] font-semibold tabular-nums ${currentYearEntry.savings >= ytdRef2025 ? 'text-emerald-600' : 'text-gray-500'}`}>
              {currentYearEntry.savings >= ytdRef2025 ? '+' : ''}{Math.round(((currentYearEntry.savings - ytdRef2025) / ytdRef2025) * 100)}% vs 2025 same period
            </span>
          </div>
        )}

        {/* Quarterly breakdown */}
        {hasQuarterly && (
          <div className="border-t border-gray-100 pt-3 mt-1">
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Quarterly Breakdown</p>
            <div className="flex items-end gap-1 h-[48px]">
              {quarterlyData.map((q, i) => {
                const h = Math.max(4, (q.savings / maxQ) * 100)
                const isWinter = q.label.startsWith('Q1') || q.label.startsWith('Q4')
                return (
                  <div key={i} className="flex-1 flex flex-col items-center gap-0.5">
                    <div className="w-full flex items-end" style={{ height: 36 }}>
                      <div
                        className={`w-full rounded-t-sm ${isWinter ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                        style={{ height: `${h}%`, opacity: isWinter ? 0.7 : 0.45 }}
                        title={`${q.label}: ${q.savings.toFixed(0)} EUR`}
                      />
                    </div>
                    <span className="text-[8px] text-gray-400 font-mono leading-none">{q.label}</span>
                  </div>
                )
              })}
            </div>
            <p className="text-[9px] text-gray-400 text-center mt-1">
              Winter quarters (Q1, Q4) typically show higher savings
            </p>
          </div>
        )}

        {/* Efficiency + Equivalent discount */}
        {(efficiency !== null || tariffDiscount !== null) && (
          <div className="border-t border-gray-100 pt-3 mt-1 grid grid-cols-2 gap-3">
            {efficiency !== null && (
              <div>
                <p className="text-[8px] text-gray-400 uppercase tracking-wide">Capture Efficiency</p>
                <div className="flex items-center gap-2 mt-1">
                  <div className="flex-1 h-2 bg-gray-100 rounded-full overflow-hidden">
                    <div className="h-full rounded-full bg-emerald-500"
                      style={{ width: `${efficiency}%`, opacity: 0.7 }} />
                  </div>
                  <span className="text-[12px] font-bold tabular-nums text-emerald-700">{efficiency}%</span>
                </div>
                <p className="text-[8px] text-gray-400 mt-0.5">of window spread captured</p>
              </div>
            )}
            {tariffDiscount !== null && tariffDiscount > 0 && (
              <div>
                <p className="text-[8px] text-gray-400 uppercase tracking-wide">Equivalent Discount</p>
                <p className="text-[16px] font-bold tabular-nums text-emerald-700 mt-0.5">
                  {tariffDiscount.toFixed(1)}<span className="text-[10px] font-normal text-gray-400 ml-0.5">ct/kWh</span>
                </p>
                <p className="text-[8px] text-gray-400 mt-0.5">effective tariff reduction</p>
              </div>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
