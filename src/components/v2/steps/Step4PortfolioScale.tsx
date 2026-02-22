'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import type { ValueEstimates } from '@/lib/v2-config'
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine
} from 'recharts'

interface Props {
  annualDayAhead: number
  valueEstimates: ValueEstimates
  onNext: () => void
  onBack: () => void
}

const PRESETS = [1, 100, 1000, 10000, 50000, 100000]

const MILESTONES = [
  { evs: 1000, label: 'Reliable Forecasting', desc: 'Load prediction accuracy reaches 90%+, balancing costs drop significantly' },
  { evs: 10000, label: 'Market Access', desc: 'Qualify for direct participation in balancing energy markets (Regelenergiemarkt)' },
  { evs: 50000, label: 'Virtual Power Plant', desc: 'Equivalent to 200+ wind turbines in flexibility capacity — serious grid stabilization' },
  { evs: 100000, label: 'Market Leader', desc: 'Major market participant with significant pricing power and portfolio effects' },
]

export function Step4PortfolioScale({ annualDayAhead, valueEstimates, onNext, onBack }: Props) {
  const [numEVs, setNumEVs] = useState(10000)

  const perEvValue = annualDayAhead + valueEstimates.forwardPurchasing + valueEstimates.intradayOptimization + valueEstimates.portfolioEffect + valueEstimates.gridFeeReduction

  // Portfolio bonus: sqrt(N) effect on forecasting/balancing
  const portfolioBonus = (n: number) => Math.sqrt(n) * 2 // EUR bonus per EV that grows with scale

  const scaledValues = useMemo(() => ({
    total: numEVs * perEvValue + portfolioBonus(numEVs) * numEVs * 0.01,
    customerShare: numEVs * (valueEstimates.gridFeeReduction + Math.round(annualDayAhead * 0.35)),
    eonMargin: numEVs * (perEvValue - valueEstimates.gridFeeReduction - Math.round(annualDayAhead * 0.35)),
    capacityMW: numEVs * 11 / 1000, // avg 11kW wallbox
    windEquivalent: Math.round(numEVs * 11 / 3000), // ~3MW per wind turbine
  }), [numEVs, perEvValue, annualDayAhead, valueEstimates])

  // Chart data: value at different fleet sizes
  const chartData = useMemo(() => {
    const points = [1, 10, 50, 100, 500, 1000, 2500, 5000, 10000, 25000, 50000, 75000, 100000]
    return points.map(n => {
      const dayAhead = n * annualDayAhead
      const forward = n * valueEstimates.forwardPurchasing
      const intraday = n * valueEstimates.intradayOptimization
      const portfolio = n * valueEstimates.portfolioEffect + portfolioBonus(n) * n * 0.01
      const gridFee = n * valueEstimates.gridFeeReduction
      return {
        evs: n,
        label: n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n),
        dayAhead: Math.round(dayAhead),
        forward: Math.round(forward),
        intraday: Math.round(intraday),
        portfolio: Math.round(portfolio),
        gridFee: Math.round(gridFee),
        total: Math.round(dayAhead + forward + intraday + portfolio + gridFee),
      }
    })
  }, [annualDayAhead, valueEstimates])

  function formatEur(n: number): string {
    if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`
    if (n >= 1000) return `${(n / 1000).toFixed(0)}k`
    return String(Math.round(n))
  }

  // Slider position (logarithmic)
  const sliderToEvs = (pos: number) => Math.round(Math.pow(10, pos / 20))
  const evsToSlider = (evs: number) => Math.round(Math.log10(evs) * 20)

  const currentMilestone = MILESTONES.filter(m => numEVs >= m.evs).pop()

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          The scaling effect — from one car to a virtual power plant
        </h2>
        <p className="text-lg text-gray-500 max-w-3xl mx-auto">
          Drag the slider to see how the total annual value scales with fleet size.
        </p>
      </div>

      {/* Fleet Size Slider */}
      <Card className="border-[#EA1C0A]/20">
        <CardContent className="pt-6 pb-4">
          <div className="text-center mb-4">
            <p className="text-sm text-gray-500">Number of EVs in portfolio</p>
            <AnimatedNumber value={numEVs} className="text-5xl font-bold text-[#EA1C0A]" />
          </div>
          <input
            type="range"
            min={0}
            max={100}
            value={evsToSlider(numEVs)}
            onChange={(e) => setNumEVs(Math.max(1, sliderToEvs(Number(e.target.value))))}
            className="w-full h-3 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#EA1C0A]"
          />
          <div className="flex justify-between mt-2">
            {PRESETS.map(n => (
              <button
                key={n}
                onClick={() => setNumEVs(n)}
                className={`px-2 py-1 text-xs rounded transition ${
                  numEVs === n ? 'bg-[#EA1C0A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                }`}
              >
                {n >= 1000 ? `${n / 1000}k` : n}
              </button>
            ))}
          </div>
        </CardContent>
      </Card>

      {/* KPIs */}
      <div className="grid grid-cols-4 gap-4">
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Annual Total Value</p>
            <AnimatedNumber value={scaledValues.total} prefix="" suffix=" EUR" className="text-2xl font-bold text-[#EA1C0A]" />
            <p className="text-xs text-gray-400">{formatEur(scaledValues.total)} EUR</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer Benefit</p>
            <p className="text-2xl font-bold text-green-600">{formatEur(scaledValues.customerShare)} EUR</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Flexibility Capacity</p>
            <p className="text-2xl font-bold text-[#115BA7]">{scaledValues.capacityMW.toFixed(0)} MW</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Equivalent to</p>
            <p className="text-2xl font-bold text-[#1D9E9E]">{scaledValues.windEquivalent} wind turbines</p>
            <p className="text-xs text-gray-400">in flexibility capacity</p>
          </CardContent>
        </Card>
      </div>

      {/* Scaling Chart */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Revenue by Stream at Scale</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="h-[300px]">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData} margin={{ top: 10, right: 20, bottom: 0, left: 10 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                <YAxis
                  tick={{ fontSize: 11 }}
                  stroke="#9CA3AF"
                  tickFormatter={(v) => formatEur(Number(v))}
                  label={{ value: 'EUR/year', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }}
                />
                <Tooltip
                  contentStyle={{ borderRadius: 8, fontSize: 12 }}
                  formatter={(val, name) => val != null ? [formatEur(Number(val)) + ' EUR', String(name)] : ['-', String(name)]}
                  labelFormatter={(label) => `${label} EVs`}
                />
                <Area type="monotone" dataKey="gridFee" stackId="1" fill="#F59E0B" stroke="#F59E0B" fillOpacity={0.7} name="Grid Fee §14a" />
                <Area type="monotone" dataKey="portfolio" stackId="1" fill="#115BA7" stroke="#115BA7" fillOpacity={0.7} name="Portfolio Effect" />
                <Area type="monotone" dataKey="intraday" stackId="1" fill="#1D9E9E" stroke="#1D9E9E" fillOpacity={0.7} name="Intraday" />
                <Area type="monotone" dataKey="forward" stackId="1" fill="#4ADE80" stroke="#4ADE80" fillOpacity={0.7} name="Forward" />
                <Area type="monotone" dataKey="dayAhead" stackId="1" fill="#22C55E" stroke="#22C55E" fillOpacity={0.7} name="Day-Ahead" />
                {numEVs > 1 && (
                  <ReferenceLine
                    x={numEVs >= 1000 ? `${(numEVs / 1000).toFixed(numEVs >= 10000 ? 0 : 1)}k` : String(numEVs)}
                    stroke="#EA1C0A"
                    strokeDasharray="5 5"
                    label={{ value: 'Current selection', position: 'top', fontSize: 10, fill: '#EA1C0A' }}
                  />
                )}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </CardContent>
      </Card>

      {/* Milestone */}
      {currentMilestone && (
        <Card className="border-[#115BA7]/20 bg-[#115BA7]/[0.02]">
          <CardContent className="pt-4 pb-3">
            <div className="flex items-start gap-4">
              <div className="w-10 h-10 rounded-full bg-[#115BA7] flex items-center justify-center text-white font-bold text-sm shrink-0">
                {currentMilestone.evs >= 1000 ? `${currentMilestone.evs / 1000}k` : currentMilestone.evs}
              </div>
              <div>
                <p className="font-semibold text-[#313131]">Milestone: {currentMilestone.label}</p>
                <p className="text-sm text-gray-600">{currentMilestone.desc}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Market Context */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="bg-gray-50">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-3xl font-bold text-[#313131]">&lt;20%</p>
            <p className="text-xs text-gray-500 mt-1">of available flexibility is monetized today (BCG)</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-3xl font-bold text-[#313131]">~2.5M</p>
            <p className="text-xs text-gray-500 mt-1">BEVs registered in Germany (and growing)</p>
          </CardContent>
        </Card>
        <Card className="bg-gray-50">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-3xl font-bold text-[#313131]">500 MW</p>
            <p className="text-xs text-gray-500 mt-1">1KOMMA5&apos;s VPP — the competition is moving</p>
          </CardContent>
        </Card>
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={onBack}>&larr; Back: Value Waterfall</Button>
        <p className="text-gray-500 text-sm">Why now? The market is ready.</p>
        <Button onClick={onNext} size="lg" className="bg-[#EA1C0A] hover:bg-[#C51608] text-white px-8">
          Next: Market Context &rarr;
        </Button>
      </div>
    </div>
  )
}
