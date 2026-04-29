'use client'

import { useMemo } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import {
  ComposedChart, Bar, XAxis, YAxis, ResponsiveContainer, Cell,
} from 'recharts'
import type { WaterfallBar } from '@/lib/process-view'
import { UNCERTAINTY_SCENARIOS, type UncertaintyScenario } from '@/lib/process-view'

/* ── Props ── */

interface Props {
  waterfall: WaterfallBar[]
  fleetWaterfall: WaterfallBar[] | null
  showFleet: boolean
  perfectSavingsCtKwh: number
  realizedSavingsCtKwh: number
  uncertaintyScenario: UncertaintyScenario
}

/* ── Color mapping ── */

const SINGLE_COLORS: Record<string, string> = {
  emerald: '#10B981',
  red: '#EF4444',
  blue: '#60A5FA',
}

const FLEET_COLORS: Record<string, string> = {
  emerald: '#10B981',
  red: '#93C5FD',
  blue: '#60A5FA',
}

/* ── Chart data builder ── */

interface ChartDatum {
  label: string
  base: number
  absValue: number
  fill: string
  originalValue: number
  fleetBase: number
  fleetAbsValue: number
  fleetFill: string
  fleetOriginalValue: number
}

function buildChartData(waterfall: WaterfallBar[], fleetWaterfall: WaterfallBar[] | null): ChartDatum[] {
  // Use all unique labels from the single EV waterfall
  return waterfall.map(bar => {
    const fleetBar = fleetWaterfall?.find(fb => fb.label === bar.label)

    return {
      label: bar.label,
      base: bar.base,
      absValue: Math.abs(bar.value),
      fill: bar.isTotal ? SINGLE_COLORS.emerald : SINGLE_COLORS[bar.color] ?? SINGLE_COLORS.red,
      originalValue: bar.value,
      fleetBase: fleetBar?.base ?? 0,
      fleetAbsValue: fleetBar ? Math.abs(fleetBar.value) : 0,
      fleetFill: fleetBar
        ? (fleetBar.isTotal ? FLEET_COLORS.emerald : FLEET_COLORS[fleetBar.color] ?? FLEET_COLORS.blue)
        : 'transparent',
      fleetOriginalValue: fleetBar?.value ?? 0,
    }
  })
}

/* ── Custom bar label ── */

function renderBarLabel(props: { x?: number; y?: number; width?: number; height?: number; value?: number; originalValue?: number }) {
  const { x = 0, y = 0, width = 0, height = 0, originalValue } = props
  if (typeof originalValue !== 'number') return null
  const absVal = Math.abs(originalValue)
  if (absVal < 0.3) return null
  const labelText = `${originalValue > 0 ? '+' : ''}${originalValue.toFixed(1)}`

  return (
    <text
      x={x + width / 2}
      y={y + height / 2 + 4}
      textAnchor="middle"
      fill="#fff"
      fontSize={10}
      fontWeight={700}
      style={{ fontVariantNumeric: 'tabular-nums' }}
    >
      {labelText}
    </text>
  )
}

/* ── Component ── */

export function WaterfallCard({
  waterfall,
  fleetWaterfall,
  showFleet,
  perfectSavingsCtKwh,
  realizedSavingsCtKwh,
  uncertaintyScenario,
}: Props) {
  const chartData = useMemo(
    () => buildChartData(waterfall, showFleet ? fleetWaterfall : null),
    [waterfall, fleetWaterfall, showFleet],
  )

  const scenarioLabel = UNCERTAINTY_SCENARIOS.find(s => s.key === uncertaintyScenario)?.label ?? 'Realistic'

  if (waterfall.length === 0) return null

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardContent className="pt-4 pb-3 px-4 space-y-2">
        {/* Header */}
        <div>
          <div className="text-sm font-bold text-[#313131]">Value Breakdown</div>
          <span className="text-[10px] font-bold uppercase tracking-wider text-gray-400">{scenarioLabel}</span>
        </div>

        {/* Waterfall chart */}
        <div style={{ height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chartData} margin={{ top: 5, right: 5, bottom: 0, left: 0 }}>
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={{ stroke: '#E5E7EB' }}
              />
              <YAxis
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                width={35}
              />

              {/* Single EV bars */}
              <Bar
                dataKey="base"
                stackId="stack"
                fill="transparent"
                isAnimationActive={false}
              />
              <Bar
                dataKey="absValue"
                stackId="stack"
                isAnimationActive
                animationDuration={200}
                animationEasing="ease-out"
                label={(((props: any) => {
                  const { x, y, width: w, height: h, index } = props
                  const d = chartData[index]
                  if (!d) return null
                  return renderBarLabel({ x, y, width: w, height: h, originalValue: d.originalValue })
                }) as never)}
              >
                {chartData.map((entry, idx) => (
                  <Cell key={idx} fill={entry.fill} />
                ))}
              </Bar>

              {/* Fleet bars (grouped alongside single EV) */}
              {showFleet && fleetWaterfall && (
                <>
                  <Bar
                    dataKey="fleetBase"
                    stackId="fleetStack"
                    fill="transparent"
                    isAnimationActive={false}
                  />
                  <Bar
                    dataKey="fleetAbsValue"
                    stackId="fleetStack"
                    isAnimationActive
                    animationDuration={200}
                    animationEasing="ease-out"
                    label={(((props: any) => {
                      const { x, y, width: w, height: h, index } = props
                      const d = chartData[index]
                      if (!d) return null
                      return renderBarLabel({ x, y, width: w, height: h, originalValue: d.fleetOriginalValue })
                    }) as never)}
                  >
                    {chartData.map((entry, idx) => (
                      <Cell key={idx} fill={entry.fleetFill} />
                    ))}
                  </Bar>
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full bg-gray-400" />
              <span className="text-[10px] text-gray-500">Single EV</span>
            </div>
            {showFleet && fleetWaterfall && (
              <div className="flex items-center gap-1.5">
                <span className="inline-block w-2 h-2 rounded-full bg-blue-500" />
                <span className="text-[10px] text-gray-500">Fleet (per car)</span>
              </div>
            )}
          </div>
          <span className="text-[11px] tabular-nums text-gray-500">
            Realized: {realizedSavingsCtKwh.toFixed(1)} ct/kWh of {perfectSavingsCtKwh.toFixed(1)} ct/kWh perfect
          </span>
        </div>

        {/* Portfolio effect note */}
        {showFleet && fleetWaterfall && (
          <div className="text-[10px] text-blue-600">
            sqrt(N) portfolio effect reduces uncertainty per car
          </div>
        )}
      </CardContent>
    </Card>
  )
}
