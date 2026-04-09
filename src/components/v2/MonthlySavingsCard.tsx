'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

const BAR_COLOR = '#10B981'  // emerald-500

export interface DaySavingsEntry {
  date: string
  dow: number
  dowLabel: string
  savingsEur: number
  dailySpreadCt: number
  windowSpreadCt: number
  savingsCtKwh: number
  isSelected: boolean
}

export interface MonthlySavingsEntry {
  month: string
  label: string
  savings: number
  season: string
  year: number
  isProjected?: boolean
  loadShiftingEur?: number  // V2G: load shifting portion
  arbitrageEur?: number     // V2G: arbitrage portion
  avgDailySpreadCt?: number    // avg daily max-min spread (full 24h)
  avgWindowSpreadCt?: number   // avg daily spread within charging window
  avgSavingsCtKwh?: number     // avg monetizable savings (ct/kWh)
  dayDetails?: DaySavingsEntry[]
}

interface Props {
  monthlySavingsData: MonthlySavingsEntry[]
  weeklyPlugIns: number
  energyPerSession: number
  sessionsPerYear: number
  rollingAvgSavings: number
  monthlySavings: number
  avgDailyEur: number
  selectedDate: string
  chargingMode?: 'overnight' | 'fullday' | 'threeday'
  isV2G?: boolean
  v2gHasNetCharge?: boolean
  plugInDays?: number[]
}

const MODE_LABELS: Record<string, string> = {
  overnight: '12h window',
  fullday: '24h window',
  threeday: '72h window',
}

export function MonthlySavingsCard({
  monthlySavingsData, weeklyPlugIns, energyPerSession,
  sessionsPerYear, rollingAvgSavings, monthlySavings, avgDailyEur, selectedDate,
  chargingMode = 'overnight', isV2G = false, v2gHasNetCharge = false, plugInDays,
}: Props) {
  const [viewMode, setViewMode] = useState<'month' | 'day'>('month')
  const [dayViewMonth, setDayViewMonth] = useState<string | undefined>(undefined)

  const selectedMonth = selectedDate ? selectedDate.slice(0, 7) : undefined
  const filteredMonths = selectedMonth
    ? monthlySavingsData.filter(d => d.month <= selectedMonth)
    : monthlySavingsData
  const last12 = filteredMonths.slice(-12).map(d => ({
    ...d,
    displayLabel: d.label === 'Jan' ? `Jan '${String(d.year).slice(2)}` : d.label,
  }))
  let runSum = 0
  const last12c = last12.map(d => { runSum += d.savings; return { ...d, cumulative: Math.round(runSum * 10) / 10 } })

  const totalSum = last12c[last12c.length - 1]?.cumulative ?? 0

  // Day view: find the active month's day details
  const activeMonth = dayViewMonth ?? selectedMonth
  const dayViewData = useMemo(() => {
    if (viewMode !== 'day') return null
    const entry = monthlySavingsData.find(d => d.month === activeMonth)
    return entry?.dayDetails ?? null
  }, [viewMode, activeMonth, monthlySavingsData])

  // Available months for day view navigation
  const availableMonths = useMemo(() =>
    last12.map(d => d.month), [last12])

  const navigateMonth = (dir: -1 | 1) => {
    const idx = availableMonths.indexOf(activeMonth ?? '')
    const next = idx + dir
    if (next >= 0 && next < availableMonths.length) {
      setDayViewMonth(availableMonths[next])
    }
  }

  const dayViewTotal = dayViewData?.filter(d => d.isSelected).reduce((s, d) => s + d.savingsEur, 0) ?? 0

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">
            {isV2G ? (v2gHasNetCharge ? 'Monthly V2G Benefit' : 'Monthly Arbitrage') : 'Monthly Savings'} — Rolling 365-Day Average
          </CardTitle>
          <div className="flex gap-0.5 bg-gray-100 rounded p-0.5">
            <button
              onClick={() => setViewMode('month')}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'month' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >Month</button>
            <button
              onClick={() => { setViewMode('day'); setDayViewMonth(selectedMonth) }}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'day' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
            >Day</button>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          {weeklyPlugIns}x/week · {energyPerSession} kWh/session · {isV2G ? (v2gHasNetCharge ? 'load shifting + arbitrage' : 'pure arbitrage') : (MODE_LABELS[chargingMode] || 'day-ahead spot shifting')}
        </p>
      </CardHeader>
      <CardContent className="pt-5 space-y-4 flex-1 flex flex-col">
        {viewMode === 'day' && dayViewData ? (
          <>
            {/* Day view header with month nav */}
            <div className="flex items-center justify-between">
              <button onClick={() => navigateMonth(-1)} className="text-gray-400 hover:text-gray-600 text-sm px-1" disabled={availableMonths.indexOf(activeMonth ?? '') <= 0}>&#9664;</button>
              <span className="text-xs font-semibold text-gray-600">{activeMonth}</span>
              <button onClick={() => navigateMonth(1)} className="text-gray-400 hover:text-gray-600 text-sm px-1" disabled={availableMonths.indexOf(activeMonth ?? '') >= availableMonths.length - 1}>&#9654;</button>
            </div>
            <div className="overflow-y-auto max-h-[320px] -mx-1">
              <table className="w-full text-[10px] tabular-nums">
                <thead className="sticky top-0 bg-white">
                  <tr className="text-gray-400 text-left">
                    <th className="font-semibold pb-1 pl-1 pr-2">Date</th>
                    <th className="font-semibold pb-1 pr-2">Day</th>
                    <th className="font-semibold pb-1 pr-2 text-right">Avg. 24h Spread</th>
                    <th className="font-semibold pb-1 pr-2 text-right">Avg. Window Spread</th>
                    <th className="font-semibold pb-1 text-right pr-1">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {dayViewData.map(d => (
                    <tr key={d.date} className={`border-t border-gray-50 ${d.isSelected ? '' : 'opacity-30'}`}>
                      <td className="py-0.5 pl-1 pr-2 text-gray-500 font-mono">{d.date.slice(5)}</td>
                      <td className="py-0.5 pr-2 text-gray-500">{d.dowLabel}</td>
                      <td className="py-0.5 pr-2 text-right text-gray-500">{d.dailySpreadCt.toFixed(1)} ct</td>
                      <td className="py-0.5 pr-2 text-right text-gray-500">{d.windowSpreadCt.toFixed(1)} ct</td>
                      <td className={`py-0.5 text-right pr-1 font-semibold ${d.savingsEur >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>{d.savingsEur.toFixed(2)} EUR</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot className="border-t-2 border-gray-200">
                  <tr className="font-semibold">
                    <td colSpan={4} className="py-1 pl-1 text-gray-600">Total ({dayViewData.filter(d => d.isSelected).length} sessions)</td>
                    <td className="py-1 text-right pr-1 text-emerald-700">{dayViewTotal.toFixed(2)} EUR</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        ) : (
        <>
        <div className="flex-1 min-h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={last12c} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis dataKey="displayLabel" tick={{ fontSize: 10, fontWeight: 500, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                label={{ value: 'EUR/mo', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                label={{ value: 'EUR cumul.', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const d = payload[0].payload as (typeof last12c)[number]
                  return (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                      <p className="text-gray-500 text-[10px]">{d.month}</p>
                      <p className="font-semibold tabular-nums text-emerald-600">{d.savings.toFixed(2)} EUR/mo</p>
                      {isV2G && d.loadShiftingEur !== undefined && d.arbitrageEur !== undefined && (
                        <div className="text-[10px] space-y-0.5 mt-0.5">
                          {(v2gHasNetCharge || d.loadShiftingEur > 0) && (
                            <p className="text-emerald-600 tabular-nums flex items-center gap-1">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-sm inline-block flex-shrink-0" />
                              Load shifting: {d.loadShiftingEur.toFixed(2)} EUR
                            </p>
                          )}
                          <p className="text-blue-600 tabular-nums flex items-center gap-1">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-sm inline-block flex-shrink-0" />
                            Arbitrage: {d.arbitrageEur.toFixed(2)} EUR
                          </p>
                        </div>
                      )}
                      <p className="text-gray-400 tabular-nums text-[10px]">∑ {d.cumulative.toFixed(1)} EUR so far</p>
                    </div>
                  )
                }} />
              {isV2G ? (
                <>
                  <Bar yAxisId="left" dataKey="loadShiftingEur" stackId="v2g" radius={[0, 0, 0, 0]} maxBarSize={28} fill="#10B981" fillOpacity={0.65} />
                  <Bar yAxisId="left" dataKey="arbitrageEur" stackId="v2g" radius={[3, 3, 0, 0]} maxBarSize={28} fill="#3B82F6" fillOpacity={0.65} />
                </>
              ) : (
              <Bar yAxisId="left" dataKey="savings" radius={[3, 3, 0, 0]} maxBarSize={28}
                fill={BAR_COLOR} fillOpacity={0.7} />
              )}
              <Line yAxisId="right" dataKey="cumulative" type="monotone"
                stroke="#374151" strokeWidth={1.5} strokeDasharray="4 3"
                dot={false} activeDot={{ r: 3, fill: '#374151' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Season legend + cumulative note */}
        <div className="flex items-center justify-between text-[10px] text-gray-500 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {isV2G ? (
              <>
                {v2gHasNetCharge && (
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" style={{ opacity: 0.65 }} />
                  Load Shifting
                </span>
                )}
                <span className="flex items-center gap-1">
                  <span className="inline-block w-2.5 h-2.5 rounded-sm bg-blue-500" style={{ opacity: 0.65 }} />
                  Arbitrage
                </span>
              </>
            ) : (
              <span className="flex items-center gap-1">
                <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" style={{ opacity: 0.7 }} />
                Monthly savings
              </span>
            )}
          </div>
          <span className="flex items-center gap-1.5 text-gray-400">
            <span className="inline-block w-6 border-t border-dashed border-gray-400" />
            ∑ {totalSum.toFixed(0)} EUR ≈ {rollingAvgSavings.toFixed(0)} EUR/yr
          </span>
        </div>

        {/* Spread & savings breakdown table */}
        {last12.some(d => d.avgDailySpreadCt != null) && (() => {
          // Detect partial months: compare day count vs expected days in month
          const daysInMonth = (ym: string) => new Date(parseInt(ym.slice(0, 4)), parseInt(ym.slice(5, 7)), 0).getDate()
          // Quarter grouping
          const quarters = new Map<string, { label: string; spread24: number[]; spreadWin: number[]; savings: number[]; savingsEur: number }>()
          last12.forEach(d => {
            const q = `Q${Math.ceil(parseInt(d.month.slice(5, 7)) / 3)} ${d.month.slice(0, 4)}`
            if (!quarters.has(q)) quarters.set(q, { label: q, spread24: [], spreadWin: [], savings: [], savingsEur: 0 })
            const qd = quarters.get(q)!
            if (d.avgDailySpreadCt != null) qd.spread24.push(d.avgDailySpreadCt)
            if (d.avgWindowSpreadCt != null) qd.spreadWin.push(d.avgWindowSpreadCt)
            if (d.avgSavingsCtKwh != null) qd.savings.push(d.avgSavingsCtKwh)
            qd.savingsEur += d.savings
          })
          const quarterRows = [...quarters.entries()].map(([, v]) => ({
            label: v.label,
            spread24: v.spread24.length > 0 ? v.spread24.reduce((a, b) => a + b, 0) / v.spread24.length : null,
            spreadWin: v.spreadWin.length > 0 ? v.spreadWin.reduce((a, b) => a + b, 0) / v.spreadWin.length : null,
            savingsCtKwh: v.savings.length > 0 ? v.savings.reduce((a, b) => a + b, 0) / v.savings.length : null,
            savingsEur: v.savingsEur,
          }))
          return (
          <div className="border-t border-gray-100 pt-3 mt-1">
            <p className="text-[9px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Spread &amp; Savings Breakdown</p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] tabular-nums">
                <thead>
                  <tr className="text-gray-400 text-left">
                    <th className="font-semibold pb-1 pr-2">Month</th>
                    <th className="font-semibold pb-1 pr-2 text-right">Avg. 24h Spread</th>
                    <th className="font-semibold pb-1 pr-2 text-right">Avg. Window Spread</th>
                    <th className="font-semibold pb-1 text-right">Savings</th>
                  </tr>
                </thead>
                <tbody>
                  {last12.map(d => {
                    const totalDays = daysInMonth(d.month)
                    const dataDays = d.dayDetails?.length ?? totalDays
                    const isPartial = dataDays < totalDays
                    return (
                    <tr key={d.month} className={`border-t border-gray-50 ${d.month === selectedMonth ? 'bg-emerald-50/30' : ''}`}>
                      <td className="py-0.5 pr-2 text-gray-500">
                        {d.displayLabel}
                        {isPartial && <span className="text-[8px] text-amber-500 ml-0.5" title={`${dataDays}/${totalDays} days`}>({dataDays}d)</span>}
                      </td>
                      <td className="py-0.5 pr-2 text-right text-gray-500">{d.avgDailySpreadCt?.toFixed(1) ?? '–'} ct</td>
                      <td className="py-0.5 pr-2 text-right text-gray-500">{d.avgWindowSpreadCt?.toFixed(1) ?? '–'} ct</td>
                      <td className="py-0.5 text-right font-semibold text-emerald-600">{d.avgSavingsCtKwh?.toFixed(2) ?? '–'} ct/kWh</td>
                    </tr>
                    )
                  })}
                </tbody>
                {quarterRows.length > 1 && (
                  <tfoot>
                    <tr><td colSpan={4} className="pt-2 pb-1"><span className="text-[8px] font-semibold text-gray-400 uppercase tracking-wider">Quarterly</span></td></tr>
                    {quarterRows.map(q => (
                      <tr key={q.label} className="border-t border-gray-100 bg-gray-50/40">
                        <td className="py-0.5 pr-2 font-semibold text-gray-600">{q.label}</td>
                        <td className="py-0.5 pr-2 text-right text-gray-500">{q.spread24?.toFixed(1) ?? '–'} ct</td>
                        <td className="py-0.5 pr-2 text-right text-gray-500">{q.spreadWin?.toFixed(1) ?? '–'} ct</td>
                        <td className="py-0.5 text-right font-semibold text-emerald-600">{q.savingsCtKwh?.toFixed(2) ?? '–'} ct/kWh</td>
                      </tr>
                    ))}
                  </tfoot>
                )}
              </table>
            </div>
          </div>
          )
        })()}
        </>
        )}

      </CardContent>
    </Card>
  )
}
