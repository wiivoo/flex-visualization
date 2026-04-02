'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

export interface YearlySavingsEntry {
  year: number
  savings: number
  sessionsCount: number
  isProjected: boolean
  isPartial: boolean
  monthsCovered: number
  loadShiftingEur?: number  // V2G: load shifting portion
  arbitrageEur?: number     // V2G: arbitrage portion
}

interface Props {
  yearlySavingsData: YearlySavingsEntry[]
  weeklyPlugIns: number
  energyPerSession: number
  chargingMode?: 'overnight' | 'fullday' | 'threeday'
  isV2G?: boolean
  isFleet?: boolean
}

const MODE_LABELS: Record<string, string> = {
  overnight: 'overnight',
  fullday: 'full-day',
  threeday: '3-day',
}

export function YearlySavingsCard({ yearlySavingsData, weeklyPlugIns, energyPerSession, chargingMode = 'overnight', isV2G = false, isFleet = false }: Props) {
  if (!yearlySavingsData || yearlySavingsData.length === 0) return null

  const currentYear = new Date().getFullYear()

  // Show 2024, 2025, and current year
  const showYears = [2024, 2025, currentYear].filter((v, i, a) => a.indexOf(v) === i)
  const filtered = yearlySavingsData
    .filter(d => showYears.includes(d.year))
    .sort((a, b) => a.year - b.year)

  if (filtered.length === 0) return null

  // 2025 YTD reference for same-period comparison
  const entry2025 = yearlySavingsData.find(d => d.year === 2025)
  const currentYearEntry = filtered.find(d => d.year === currentYear)
  const currentYearMonths = currentYearEntry?.monthsCovered ?? 0

  let ytdRef2025 = 0
  if (entry2025 && entry2025.monthsCovered > 0 && currentYearMonths > 0 && currentYear > 2025) {
    const perMonthAvg2025 = entry2025.savings / entry2025.monthsCovered
    ytdRef2025 = Math.round(perMonthAvg2025 * currentYearMonths * 100) / 100
  }

  // Use max of all values including ytdRef for consistent bar scale
  const maxSavings = Math.max(...filtered.map(d => d.savings), ytdRef2025, 1)

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">Yearly Savings</CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          {isFleet ? '1,000 EVs · daily · ' : `${weeklyPlugIns}x/week · ${energyPerSession} kWh · `}{MODE_LABELS[chargingMode] || 'overnight'}
        </p>
      </CardHeader>
      <CardContent className="pt-4 flex-1 flex flex-col justify-center space-y-3">
        {filtered.map(d => {
          const isCurrent = d.year === currentYear
          const barPct = maxSavings > 0 ? Math.max((d.savings / maxSavings) * 100, 4) : 4
          const partial = d.isPartial ? `${d.monthsCovered} mo` : '12 mo'
          // Show 2025 reference overlay on the current year bar
          const refPct = isCurrent && ytdRef2025 > 0 && maxSavings > 0
            ? Math.max((ytdRef2025 / maxSavings) * 100, 4)
            : 0

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
                {/* 2025 same-period reference bar (behind) */}
                {refPct > 0 && (
                  <div
                    className="absolute inset-y-0 left-0 rounded-full bg-amber-300"
                    style={{ width: `${refPct}%`, opacity: 0.35 }}
                  />
                )}
                {/* V2G: stacked bar (green load shifting + blue arbitrage) */}
                {isV2G && d.loadShiftingEur !== undefined && d.arbitrageEur !== undefined && d.savings > 0 ? (
                  <div className="relative h-full flex" style={{ width: `${barPct}%` }}>
                    <div
                      className="h-full rounded-l-full bg-emerald-500"
                      style={{ width: `${(d.loadShiftingEur / d.savings) * 100}%`, opacity: isCurrent ? 0.75 : 0.4 }}
                    />
                    <div
                      className="h-full rounded-r-full bg-blue-500"
                      style={{ width: `${(d.arbitrageEur / d.savings) * 100}%`, opacity: isCurrent ? 0.75 : 0.4 }}
                    />
                  </div>
                ) : (
                <div
                  className={`relative h-full rounded-full transition-all ${isCurrent ? 'bg-emerald-500' : 'bg-emerald-300'}`}
                  style={{ width: `${barPct}%`, opacity: isCurrent ? 0.85 : 0.45 }}
                />
                )}
              </div>
              <div className="flex items-center justify-between text-[9px] text-gray-400 mt-0.5 tabular-nums">
                <span>{isFleet ? `${partial} · fleet €${Math.round(d.savings * 1000)}` : `${d.sessionsCount} sessions · ${partial}`}</span>
                {isV2G && d.loadShiftingEur !== undefined && d.arbitrageEur !== undefined ? (
                  <span>
                    <span className="text-emerald-500">{'\u20AC'}{Math.round(d.loadShiftingEur)} shift</span>
                    <span className="mx-1">+</span>
                    <span className="text-blue-500">{'\u20AC'}{Math.round(d.arbitrageEur)} arb</span>
                  </span>
                ) : (
                isCurrent && ytdRef2025 > 0 && (
                  <span className="text-amber-600/70">{'\u20AC'}{Math.round(ytdRef2025)} in &apos;25</span>
                )
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
      </CardContent>
    </Card>
  )
}
