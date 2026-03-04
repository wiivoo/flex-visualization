'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

/**
 * Conceptual management chart: one bar per horizon showing the
 * achievable avg charging price. Based on real SMARD data from
 * 2024-06-07 — a well-documented solar weekend with negative prices.
 *
 * Layout: grouped bar chart — one color bar per horizon.
 * Dashed baseline reference + spread brackets.
 */

// ── Real SMARD prices: week of 2025-04-18 18:00 → 2025-04-25 17:00 ──
// Source: SMARD day-ahead hourly, prices in ct/kWh
const WEEK: { day: string; hour: number; price: number }[] = [
  // Friday evening (plug-in)
  { day: 'Fri', hour: 18, price: 12.65 }, { day: 'Fri', hour: 19, price: 11.65 },
  { day: 'Fri', hour: 20, price: 10.64 }, { day: 'Fri', hour: 21, price: 9.91 },
  { day: 'Fri', hour: 22, price: 8.93 }, { day: 'Fri', hour: 23, price: 8.00 },
  // Saturday
  { day: 'Sat', hour: 0, price: 8.45 }, { day: 'Sat', hour: 1, price: 8.24 },
  { day: 'Sat', hour: 2, price: 8.50 }, { day: 'Sat', hour: 3, price: 9.06 },
  { day: 'Sat', hour: 4, price: 9.52 }, { day: 'Sat', hour: 5, price: 9.17 },
  { day: 'Sat', hour: 6, price: 8.39 }, { day: 'Sat', hour: 7, price: 7.64 },
  { day: 'Sat', hour: 8, price: 3.00 }, { day: 'Sat', hour: 9, price: 0.45 },
  { day: 'Sat', hour: 10, price: 0.00 }, { day: 'Sat', hour: 11, price: -0.30 },
  { day: 'Sat', hour: 12, price: -0.73 }, { day: 'Sat', hour: 13, price: -0.09 },
  { day: 'Sat', hour: 14, price: 0.02 }, { day: 'Sat', hour: 15, price: 6.40 },
  { day: 'Sat', hour: 16, price: 10.28 }, { day: 'Sat', hour: 17, price: 12.68 },
  { day: 'Sat', hour: 18, price: 14.27 }, { day: 'Sat', hour: 19, price: 12.74 },
  { day: 'Sat', hour: 20, price: 10.96 }, { day: 'Sat', hour: 21, price: 9.83 },
  { day: 'Sat', hour: 22, price: 10.04 }, { day: 'Sat', hour: 23, price: 9.49 },
  // Sunday
  { day: 'Sun', hour: 0, price: 9.90 }, { day: 'Sun', hour: 1, price: 9.74 },
  { day: 'Sun', hour: 2, price: 9.88 }, { day: 'Sun', hour: 3, price: 10.86 },
  { day: 'Sun', hour: 4, price: 10.94 }, { day: 'Sun', hour: 5, price: 9.43 },
  { day: 'Sun', hour: 6, price: 6.86 }, { day: 'Sun', hour: 7, price: 1.86 },
  { day: 'Sun', hour: 8, price: 0.00 }, { day: 'Sun', hour: 9, price: -0.57 },
  { day: 'Sun', hour: 10, price: -3.50 }, { day: 'Sun', hour: 11, price: -5.24 },
  { day: 'Sun', hour: 12, price: -4.00 }, { day: 'Sun', hour: 13, price: -0.48 },
  { day: 'Sun', hour: 14, price: 0.00 }, { day: 'Sun', hour: 15, price: 7.24 },
  { day: 'Sun', hour: 16, price: 10.68 }, { day: 'Sun', hour: 17, price: 11.99 },
  { day: 'Sun', hour: 18, price: 14.50 }, { day: 'Sun', hour: 19, price: 13.76 },
  { day: 'Sun', hour: 20, price: 12.18 }, { day: 'Sun', hour: 21, price: 11.07 },
  { day: 'Sun', hour: 22, price: 10.86 }, { day: 'Sun', hour: 23, price: 9.76 },
  // Monday → Friday (for weekly horizon)
  { day: 'Mon', hour: 0, price: 9.65 }, { day: 'Mon', hour: 1, price: 9.68 },
  { day: 'Mon', hour: 2, price: 9.80 }, { day: 'Mon', hour: 3, price: 9.85 },
  { day: 'Mon', hour: 4, price: 9.71 }, { day: 'Mon', hour: 5, price: 9.13 },
  { day: 'Mon', hour: 6, price: 8.85 }, { day: 'Mon', hour: 7, price: 8.80 },
  { day: 'Mon', hour: 8, price: 6.52 }, { day: 'Mon', hour: 9, price: 3.39 },
  { day: 'Mon', hour: 10, price: 1.72 }, { day: 'Mon', hour: 11, price: 0.89 },
  { day: 'Mon', hour: 12, price: 0.84 }, { day: 'Mon', hour: 13, price: 1.00 },
  { day: 'Mon', hour: 14, price: 5.01 }, { day: 'Mon', hour: 15, price: 8.88 },
  { day: 'Mon', hour: 16, price: 10.20 }, { day: 'Mon', hour: 17, price: 12.20 },
  { day: 'Mon', hour: 18, price: 13.91 }, { day: 'Mon', hour: 19, price: 13.21 },
  { day: 'Mon', hour: 20, price: 12.28 }, { day: 'Mon', hour: 21, price: 10.65 },
  { day: 'Mon', hour: 22, price: 9.62 }, { day: 'Mon', hour: 23, price: 8.88 },
  { day: 'Tue', hour: 0, price: 8.74 }, { day: 'Tue', hour: 1, price: 8.50 },
  { day: 'Tue', hour: 2, price: 8.46 }, { day: 'Tue', hour: 3, price: 9.74 },
  { day: 'Tue', hour: 4, price: 12.08 }, { day: 'Tue', hour: 5, price: 15.15 },
  { day: 'Tue', hour: 6, price: 14.70 }, { day: 'Tue', hour: 7, price: 11.19 },
  { day: 'Tue', hour: 8, price: 9.52 }, { day: 'Tue', hour: 9, price: 9.00 },
  { day: 'Tue', hour: 10, price: 7.99 }, { day: 'Tue', hour: 11, price: 6.77 },
  { day: 'Tue', hour: 12, price: 7.15 }, { day: 'Tue', hour: 13, price: 7.85 },
  { day: 'Tue', hour: 14, price: 8.31 }, { day: 'Tue', hour: 15, price: 10.00 },
  { day: 'Tue', hour: 16, price: 12.24 }, { day: 'Tue', hour: 17, price: 19.23 },
  { day: 'Tue', hour: 18, price: 26.32 }, { day: 'Tue', hour: 19, price: 15.73 },
  { day: 'Tue', hour: 20, price: 12.23 }, { day: 'Tue', hour: 21, price: 10.96 },
  { day: 'Tue', hour: 22, price: 10.67 }, { day: 'Tue', hour: 23, price: 9.94 },
  { day: 'Wed', hour: 0, price: 9.68 }, { day: 'Wed', hour: 1, price: 9.67 },
  { day: 'Wed', hour: 2, price: 10.12 }, { day: 'Wed', hour: 3, price: 10.82 },
  { day: 'Wed', hour: 4, price: 13.71 }, { day: 'Wed', hour: 5, price: 15.20 },
  { day: 'Wed', hour: 6, price: 12.88 }, { day: 'Wed', hour: 7, price: 10.00 },
  { day: 'Wed', hour: 8, price: 9.20 }, { day: 'Wed', hour: 9, price: 9.44 },
  { day: 'Wed', hour: 10, price: 8.10 }, { day: 'Wed', hour: 11, price: 8.03 },
  { day: 'Wed', hour: 12, price: 8.80 }, { day: 'Wed', hour: 13, price: 9.24 },
  { day: 'Wed', hour: 14, price: 9.90 }, { day: 'Wed', hour: 15, price: 10.83 },
  { day: 'Wed', hour: 16, price: 12.89 }, { day: 'Wed', hour: 17, price: 15.60 },
  { day: 'Wed', hour: 18, price: 14.87 }, { day: 'Wed', hour: 19, price: 12.61 },
  { day: 'Wed', hour: 20, price: 10.82 }, { day: 'Wed', hour: 21, price: 9.72 },
  { day: 'Wed', hour: 22, price: 9.42 }, { day: 'Wed', hour: 23, price: 8.83 },
  { day: 'Thu', hour: 0, price: 8.67 }, { day: 'Thu', hour: 1, price: 8.57 },
  { day: 'Thu', hour: 2, price: 8.43 }, { day: 'Thu', hour: 3, price: 9.09 },
  { day: 'Thu', hour: 4, price: 11.03 }, { day: 'Thu', hour: 5, price: 11.85 },
  { day: 'Thu', hour: 6, price: 11.77 }, { day: 'Thu', hour: 7, price: 10.89 },
  { day: 'Thu', hour: 8, price: 9.67 }, { day: 'Thu', hour: 9, price: 9.36 },
  { day: 'Thu', hour: 10, price: 8.16 }, { day: 'Thu', hour: 11, price: 7.90 },
  { day: 'Thu', hour: 12, price: 7.80 }, { day: 'Thu', hour: 13, price: 7.87 },
  { day: 'Thu', hour: 14, price: 8.34 }, { day: 'Thu', hour: 15, price: 9.54 },
  { day: 'Thu', hour: 16, price: 10.10 }, { day: 'Thu', hour: 17, price: 11.46 },
  { day: 'Thu', hour: 18, price: 12.16 }, { day: 'Thu', hour: 19, price: 11.45 },
  { day: 'Thu', hour: 20, price: 10.65 }, { day: 'Thu', hour: 21, price: 9.31 },
  { day: 'Thu', hour: 22, price: 9.10 }, { day: 'Thu', hour: 23, price: 8.29 },
  { day: 'Fri', hour: 0, price: 8.22 }, { day: 'Fri', hour: 1, price: 8.34 },
  { day: 'Fri', hour: 2, price: 8.50 }, { day: 'Fri', hour: 3, price: 9.46 },
  { day: 'Fri', hour: 4, price: 10.44 }, { day: 'Fri', hour: 5, price: 11.34 },
  { day: 'Fri', hour: 6, price: 11.10 }, { day: 'Fri', hour: 7, price: 9.94 },
  { day: 'Fri', hour: 8, price: 8.82 }, { day: 'Fri', hour: 9, price: 7.55 },
  { day: 'Fri', hour: 10, price: 6.66 }, { day: 'Fri', hour: 11, price: 4.80 },
  { day: 'Fri', hour: 12, price: 4.10 }, { day: 'Fri', hour: 13, price: 5.95 },
  { day: 'Fri', hour: 14, price: 7.30 }, { day: 'Fri', hour: 15, price: 8.42 },
  { day: 'Fri', hour: 16, price: 9.94 }, { day: 'Fri', hour: 17, price: 11.60 },
]

const ENERGY = 20 // kWh
const POWER = 7   // kW
const SLOTS = Math.ceil(ENERGY / POWER) // 3h

// Horizon definitions — endIdx is inclusive into WEEK array
const DEFS = [
  { key: 'baseline', label: 'Baseline', sub: 'Charge immediately', color: '#DC2626', endIdx: 2, mode: 'first' as const },
  { key: 'overnight', label: 'Overnight', sub: 'Fri 18h → Sat 07h', color: '#2563EB', endIdx: 13, mode: 'opt' as const },
  { key: 'day24', label: '24 Hours', sub: 'Fri 18h → Sat 18h', color: '#7C3AED', endIdx: 30, mode: 'opt' as const },
  { key: 'weekend', label: 'Weekend', sub: 'Fri 18h → Sun 24h', color: '#059669', endIdx: 53, mode: 'opt' as const },
  { key: 'weekly', label: '7 Days', sub: 'Fri 18h → Fri 18h', color: '#0891B2', endIdx: WEEK.length - 1, mode: 'opt' as const },
]

// Chart dimensions
const W = 760
const LEFT = 44, RIGHT = 20, TOP = 20, CHART_H = 280, AXIS_H = 80, BOT = 4
const P_MIN = -6, P_MAX = 14

function yOf(v: number) {
  return TOP + CHART_H * (1 - (v - P_MIN) / (P_MAX - P_MIN))
}

export function FlexibilityDemoChart() {
  const horizons = useMemo(() =>
    DEFS.map(d => {
      const win = WEEK.slice(0, d.endIdx + 1)
      const selIdx = d.mode === 'first'
        ? [0, 1, 2]
        : [...win.map((p, i) => ({ v: p.price, i }))]
            .sort((a, b) => a.v - b.v).slice(0, SLOTS).map(s => s.i)
      const avg = selIdx.reduce((s, i) => s + WEEK[i].price, 0) / SLOTS
      const slots = selIdx.sort((a, b) => a - b).map(i => WEEK[i])
      const spread = Math.max(...win.map(p => p.price)) - Math.min(...win.map(p => p.price))
      return { ...d, avg: Math.round(avg * 100) / 100, spread: Math.round(spread * 100) / 100, slots, hours: win.length }
    }), [])

  const nGroups = horizons.length
  const cW = W - LEFT - RIGHT
  const H = TOP + CHART_H + AXIS_H + BOT

  // Bar layout — each group is a single wide bar
  const groupGap = 24
  const barW = (cW - (nGroups - 1) * groupGap) / nGroups

  const baseAvg = horizons[0].avg
  const zeroY = yOf(0)

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <CardTitle className="text-base font-bold text-[#313131]">
          Flexibility Value — Longer Plug-in = More Savings
        </CardTitle>
        <p className="text-[11px] text-gray-500 mt-1">
          Real SMARD data · Week of April 18, 2025 · 20 kWh charge · 7 kW wallbox · {SLOTS}h needed
        </p>
      </CardHeader>
      <CardContent className="pt-5 space-y-4">
        <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="block mx-auto w-full" preserveAspectRatio="xMidYMid meet">
          {/* ── Y grid ── */}
          {[-4, -2, 0, 2, 4, 6, 8, 10, 12].map(v => (
            <g key={v}>
              <line x1={LEFT} y1={yOf(v)} x2={LEFT + cW} y2={yOf(v)}
                stroke={v === 0 ? '#CBD5E1' : '#F1F5F9'} strokeWidth={v === 0 ? 0.8 : 0.5} />
              <text x={LEFT - 4} y={yOf(v) + 3} textAnchor="end" fontSize={8} fill="#94A3B8">{v}</text>
            </g>
          ))}
          <text x={6} y={TOP + CHART_H / 2} textAnchor="middle" fontSize={8} fill="#94A3B8"
            transform={`rotate(-90,6,${TOP + CHART_H / 2})`}>ct/kWh</text>

          {/* ── Baseline dashed reference line ── */}
          <line x1={LEFT} y1={yOf(baseAvg)} x2={LEFT + cW} y2={yOf(baseAvg)}
            stroke="#DC2626" strokeWidth={1.2} strokeDasharray="8 5" opacity={0.4} />

          {/* ── Bars + annotations ── */}
          {horizons.map((hz, gi) => {
            const gx = LEFT + gi * (barW + groupGap)
            const midX = gx + barW / 2
            const avgY = yOf(hz.avg)
            const baseY = yOf(baseAvg)
            const labelY = TOP + CHART_H + 6
            const isBase = hz.key === 'baseline'
            const saving = baseAvg - hz.avg

            // Bar from zero line to avg (or from avg to zero if negative avg)
            const barTop = Math.min(avgY, zeroY)
            const barBot = Math.max(avgY, zeroY)
            const barH = Math.max(barBot - barTop, 2)

            return (
              <g key={hz.key}>
                {/* Main bar */}
                <rect x={gx} y={barTop} width={barW} height={barH}
                  rx={4} fill={hz.color} opacity={0.8} />

                {/* Avg value inside/above bar */}
                <text x={midX} y={avgY - 8} textAnchor="middle"
                  fontSize={14} fontWeight={800} fill={hz.color}>
                  {hz.avg.toFixed(1)}
                </text>
                <text x={midX} y={avgY - 22} textAnchor="middle"
                  fontSize={8} fill={hz.color} opacity={0.7}>
                  ct/kWh
                </text>

                {/* Spread bracket from bar top to baseline — only for non-baseline */}
                {!isBase && saving > 0.5 && (() => {
                  const bracketX = gx + barW + 5
                  const topTick = baseY
                  const botTick = avgY
                  return (
                    <g>
                      <line x1={bracketX} y1={topTick} x2={bracketX} y2={botTick}
                        stroke={hz.color} strokeWidth={1.5} strokeDasharray="4 3" opacity={0.5} />
                      <line x1={bracketX - 3} y1={topTick} x2={bracketX + 3} y2={topTick}
                        stroke={hz.color} strokeWidth={1} opacity={0.5} />
                      <line x1={bracketX - 3} y1={botTick} x2={bracketX + 3} y2={botTick}
                        stroke={hz.color} strokeWidth={1} opacity={0.5} />
                      <text x={bracketX + 2} y={(topTick + botTick) / 2 + 3} textAnchor="middle"
                        fontSize={9} fontWeight={700} fill={hz.color}
                        transform={`rotate(-90,${bracketX + 2},${(topTick + botTick) / 2 + 3})`}>
                        −{saving.toFixed(1)} ct
                      </text>
                    </g>
                  )
                })()}

                {/* ── Labels below ── */}
                <text x={midX} y={labelY + 10} textAnchor="middle"
                  fontSize={12} fontWeight={700} fill={hz.color}>{hz.label}</text>
                <text x={midX} y={labelY + 22} textAnchor="middle"
                  fontSize={8} fill="#94A3B8">{hz.sub}</text>
                <text x={midX} y={labelY + 34} textAnchor="middle"
                  fontSize={8} fill="#64748B">{hz.hours}h window</text>

                {/* Charging hours detail */}
                <text x={midX} y={labelY + 48} textAnchor="middle"
                  fontSize={7.5} fill="#94A3B8">
                  {hz.slots.map(s => `${s.day} ${String(s.hour).padStart(2, '0')}h`).join(' · ')}
                </text>

                {/* Spread */}
                <text x={midX} y={labelY + 60} textAnchor="middle"
                  fontSize={8} fill="#64748B">
                  spread: {hz.spread.toFixed(1)} ct
                </text>

                {/* Savings vs baseline */}
                {!isBase && (
                  <text x={midX} y={labelY + 72} textAnchor="middle"
                    fontSize={9} fontWeight={700} fill={hz.color}>
                    saves {saving.toFixed(1)} ct/kWh = {(saving * ENERGY / 100).toFixed(2)} EUR
                  </text>
                )}
              </g>
            )
          })}
        </svg>

        {/* ── Key takeaway ── */}
        <div className="flex items-start gap-3 bg-emerald-50 border border-emerald-200 rounded-lg px-4 py-3">
          <div className="text-emerald-700 mt-0.5 shrink-0">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </div>
          <div className="text-[11px] text-gray-600 space-y-0.5">
            <p className="font-bold text-emerald-800 text-[12px]">Real example: April 18, 2025 — spring solar weekend with negative prices</p>
            <p>
              <strong className="text-red-600">Baseline</strong> charges Friday evening at {baseAvg.toFixed(1)} ct/kWh.
              {' '}<strong className="text-blue-600">Overnight</strong> picks cheaper night hours at {horizons[1].avg.toFixed(1)} ct.
              {' '}<strong className="text-purple-600">24h</strong> captures Saturday&apos;s solar midday dip at {horizons[2].avg.toFixed(1)} ct.
              {' '}<strong className="text-emerald-600">Weekend</strong> finds Sunday&apos;s deep solar trough at {horizons[3].avg.toFixed(1)} ct.
              {' '}<strong className="text-cyan-600">7 Days</strong> confirms {horizons[4].avg.toFixed(1)} ct — the weekend solar dip was the cheapest window all week.
            </p>
            <p className="text-[10px] text-gray-400 pt-0.5">
              At 20 kWh, 4x/week, 52 weeks: weekend flexibility saves ~{((baseAvg - horizons[3].avg) * ENERGY / 100 * 4 * 52).toFixed(0)} EUR/year vs immediate charging.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
