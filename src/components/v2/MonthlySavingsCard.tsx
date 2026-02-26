'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea,
} from 'recharts'

const SEASON_COLORS: Record<string, string> = {
  winter: '#7EB8E8',
  spring: '#6AC09A',
  summer: '#E8C94A',
  autumn: '#E8A066',
}

const SEASON_BG: Record<string, string> = {
  winter: '#EFF6FF', spring: '#F0FDF4', summer: '#FEFCE8', autumn: '#FFF7ED',
}

export interface MonthlySavingsEntry {
  month: string
  label: string
  savings: number
  season: string
  year: number
  isProjected?: boolean
  weekdaySavings?: number
  weekendSavings?: number
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
}

export function MonthlySavingsCard({
  monthlySavingsData, weeklyPlugIns, energyPerSession,
  sessionsPerYear, rollingAvgSavings, monthlySavings, avgDailyEur, selectedDate,
}: Props) {
  const [methodologyOpen, setMethodologyOpen] = useState(false)

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

  // Season background bands
  const bands: { x1: string; x2: string; season: string }[] = []
  let cur = '', start = ''
  for (let i = 0; i < last12c.length; i++) {
    const d = last12c[i]
    if (d.season !== cur) {
      if (cur && start) bands.push({ x1: start, x2: last12c[i - 1].displayLabel, season: cur })
      cur = d.season; start = d.displayLabel
    }
  }
  if (cur && start) bands.push({ x1: start, x2: last12c[last12c.length - 1].displayLabel, season: cur })

  const totalSum = last12c[last12c.length - 1]?.cumulative ?? 0

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">Monthly Savings — Rolling 365-Day Average</CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          {weeklyPlugIns}x/week · {energyPerSession} kWh/session · day-ahead spot shifting
        </p>
      </CardHeader>
      <CardContent className="pt-5 space-y-4 flex-1 flex flex-col">
        <div className="flex-1 min-h-[180px]">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={last12c} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
              {bands.map((b, i) => (
                <ReferenceArea key={i} x1={b.x1} x2={b.x2}
                  fill={SEASON_BG[b.season] || '#F9FAFB'} fillOpacity={1} ifOverflow="hidden" />
              ))}
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
                  const color = SEASON_COLORS[d.season] || '#6B7280'
                  return (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                      <p className="text-gray-500 text-[10px]">{d.month} · {d.season}</p>
                      <p className="font-semibold tabular-nums" style={{ color }}>{d.savings.toFixed(2)} EUR/mo</p>
                      {(d.weekdaySavings !== undefined && d.weekendSavings !== undefined) && (
                        <p className="text-gray-400 tabular-nums text-[10px]">
                          <span className="text-gray-500">{d.weekdaySavings.toFixed(2)}</span> weekday + <span className="text-gray-500">{d.weekendSavings.toFixed(2)}</span> weekend
                        </p>
                      )}
                      <p className="text-gray-400 tabular-nums text-[10px]">∑ {d.cumulative.toFixed(1)} EUR so far</p>
                    </div>
                  )
                }} />
              <Bar yAxisId="left" dataKey="savings" radius={[3, 3, 0, 0]} maxBarSize={28}
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                shape={((props: any) => {
                  const { x = 0, y = 0, width = 0, height = 0, season = '' } = props as { x: number; y: number; width: number; height: number; season: string }
                  const fill = SEASON_COLORS[season] || '#6B7280'
                  const h = Math.max(height, 0)
                  return (
                    <g>
                      <rect x={x} y={y} width={width} height={h} rx={3} ry={3} fill={fill} fillOpacity={0.75} />
                    </g>
                  )
                }) as any} />
              <Line yAxisId="right" dataKey="cumulative" type="monotone"
                stroke="#374151" strokeWidth={1.5} strokeDasharray="4 3"
                dot={false} activeDot={{ r: 3, fill: '#374151' }} />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
        {/* Season legend + cumulative note */}
        <div className="flex items-center justify-between text-[10px] text-gray-500 flex-wrap gap-2">
          <div className="flex items-center gap-3">
            {(['winter', 'spring', 'summer', 'autumn'] as const).map(s => (
              <span key={s} className="flex items-center gap-1 capitalize">
                <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SEASON_COLORS[s], opacity: 0.75 }} />
                {s}
              </span>
            ))}
          </div>
          <span className="flex items-center gap-1.5 text-gray-400">
            <span className="inline-block w-6 border-t border-dashed border-gray-400" />
            ∑ {totalSum.toFixed(0)} EUR ≈ {rollingAvgSavings.toFixed(0)} EUR/yr
          </span>
        </div>

        {/* Methodology — collapsible */}
        <div className="border border-gray-200/60 rounded-lg overflow-hidden">
          <button
            onClick={() => setMethodologyOpen(v => !v)}
            className="w-full flex items-center justify-between bg-gray-50/80 px-3.5 py-2 text-left hover:bg-gray-100/60 transition-colors">
            <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Methodology</span>
            <span className="text-[10px] text-gray-400 ml-2">{methodologyOpen ? '▲' : '▼'}</span>
          </button>
          {methodologyOpen && (
            <div className="px-3.5 py-3 text-[11px] space-y-1.5 bg-gray-50/40">
              <p className="text-gray-500">
                For each day, the optimal vs. baseline charging cost is computed from actual SMARD spot prices.
                Monthly bars show the sum of daily savings scaled to {weeklyPlugIns} sessions/week.
              </p>
              <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 border-t border-gray-200 pt-1.5 mt-1">
                <span className="text-gray-400 font-mono">avg savings / session</span>
                <span className="tabular-nums font-semibold text-gray-700 text-right">{avgDailyEur.toFixed(3)} EUR</span>
                <span className="text-gray-400 font-mono">× {sessionsPerYear} sessions/yr</span>
                <AnimatedNumber value={rollingAvgSavings} decimals={0} prefix="≈ " suffix=" EUR/yr" className="font-bold text-emerald-700 tabular-nums text-right" />
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  )
}
