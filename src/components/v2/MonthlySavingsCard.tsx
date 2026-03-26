'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'

const BAR_COLOR = '#10B981'  // emerald-500

export interface MonthlySavingsEntry {
  month: string
  label: string
  savings: number
  season: string
  year: number
  isProjected?: boolean
  loadShiftingEur?: number  // V2G: load shifting portion
  arbitrageEur?: number     // V2G: arbitrage portion
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
}

const MODE_LABELS: Record<string, string> = {
  overnight: '12h window',
  fullday: '24h window',
  threeday: '72h window',
}

export function MonthlySavingsCard({
  monthlySavingsData, weeklyPlugIns, energyPerSession,
  sessionsPerYear, rollingAvgSavings, monthlySavings, avgDailyEur, selectedDate,
  chargingMode = 'overnight', isV2G = false, v2gHasNetCharge = false,
}: Props) {
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

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">
          {isV2G ? (v2gHasNetCharge ? 'Monthly V2G Benefit' : 'Monthly Arbitrage') : 'Monthly Savings'} — Rolling 365-Day Average
        </CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          {weeklyPlugIns}x/week · {energyPerSession} kWh/session · {isV2G ? (v2gHasNetCharge ? 'load shifting + arbitrage' : 'pure arbitrage') : (MODE_LABELS[chargingMode] || 'day-ahead spot shifting')}
        </p>
      </CardHeader>
      <CardContent className="pt-5 space-y-4 flex-1 flex flex-col">
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

      </CardContent>
    </Card>
  )
}
