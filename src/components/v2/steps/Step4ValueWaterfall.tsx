'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { COMPETITOR_BENCHMARKS, type ValueEstimates } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import {
  BarChart, Bar, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Cell, LabelList
} from 'recharts'

interface Props {
  annualDayAhead: number
  valueEstimates: ValueEstimates
  setValueEstimates: (v: ValueEstimates) => void
  optimization: OptimizeResult | null
  onNext: () => void
  onBack: () => void
}

type ViewMode = 'total' | 'split'

const LAYER_COLORS = {
  dayAhead: '#22C55E',
  forward: '#4ADE80',
  intraday: '#1D9E9E',
  portfolio: '#115BA7',
  gridFee: '#F59E0B',
  total: '#EA1C0A',
}

const LAYER_EXPLANATIONS = {
  dayAhead: 'We shift charging to the cheapest hours of the day. The price difference between "charge immediately" and "charge smart" is our steering value.',
  forward: 'We buy cheaper baseload futures on EEX instead of expensive peakload products. With flexible loads, we only need flat delivery (24/7) instead of peak delivery (daytime only). Spread: ~8-15 EUR/MWh.',
  intraday: 'After day-ahead procurement, we re-optimize as wind/solar forecasts update on the intraday market. Spreads can reach 1,000+ EUR/MWh on extreme days.',
  portfolio: 'With thousands of EVs, our load forecast becomes 95% accurate (law of large numbers). This cuts balancing energy costs by >70% (BCG estimate).',
  gridFee: 'Customers with wallboxes registered under \u00a714a EnWG receive ~165 EUR/year in reduced grid fees \u2014 a tangible, guaranteed benefit that helps acquire customers.',
}

// Mini-viz data for Forward Purchasing
const FORWARD_BARS = [
  { name: 'Base\n(24/7)', price: 50, fill: '#4ADE80' },
  { name: 'Peak\n(8-20h)', price: 65, fill: '#9CA3AF' },
]

// Mini-viz data for Intraday Optimization
const INTRADAY_BARS = [
  { hour: '10:00', forecast: 45, actual: 32, delta: -13 },
  { hour: '14:00', forecast: 38, actual: 15, delta: -23 },
  { hour: '18:00', forecast: 60, actual: 72, delta: 12 },
  { hour: '22:00', forecast: 42, actual: 28, delta: -14 },
]

// Mini-viz data for Portfolio Effect (forecasting accuracy)
const PORTFOLIO_ACCURACY = [
  { evs: '1', accuracy: 80 },
  { evs: '10', accuracy: 85 },
  { evs: '100', accuracy: 90 },
  { evs: '1k', accuracy: 95 },
  { evs: '10k', accuracy: 98 },
  { evs: '100k', accuracy: 99 },
]

export function Step4ValueWaterfall({ annualDayAhead, valueEstimates, setValueEstimates, optimization, onNext, onBack }: Props) {
  const [viewMode, setViewMode] = useState<ViewMode>('total')
  const [expandedLayer, setExpandedLayer] = useState<string | null>(null)

  const totalValue = annualDayAhead + valueEstimates.forwardPurchasing + valueEstimates.intradayOptimization + valueEstimates.portfolioEffect + valueEstimates.gridFeeReduction
  const customerShare = valueEstimates.gridFeeReduction + Math.round(annualDayAhead * 0.35)
  const eonShare = totalValue - customerShare

  // Waterfall chart data
  const waterfallData = useMemo(() => {
    const cumulative = [0]
    const values = [
      annualDayAhead,
      valueEstimates.forwardPurchasing,
      valueEstimates.intradayOptimization,
      valueEstimates.portfolioEffect,
      valueEstimates.gridFeeReduction,
    ]
    for (let i = 0; i < values.length; i++) {
      cumulative.push(cumulative[i] + values[i])
    }

    return [
      { name: 'Day-Ahead\nLoad Shifting', value: annualDayAhead, base: 0, color: LAYER_COLORS.dayAhead, key: 'dayAhead' },
      { name: 'Forward\nPurchasing', value: valueEstimates.forwardPurchasing, base: cumulative[1], color: LAYER_COLORS.forward, key: 'forward' },
      { name: 'Intraday\nOptimization', value: valueEstimates.intradayOptimization, base: cumulative[2], color: LAYER_COLORS.intraday, key: 'intraday' },
      { name: 'Portfolio\nEffect', value: valueEstimates.portfolioEffect, base: cumulative[3], color: LAYER_COLORS.portfolio, key: 'portfolio' },
      { name: 'Grid Fee\nReduction', value: valueEstimates.gridFeeReduction, base: cumulative[4], color: LAYER_COLORS.gridFee, key: 'gridFee' },
      { name: 'Total', value: totalValue, base: 0, color: LAYER_COLORS.total, key: 'total' },
    ]
  }, [annualDayAhead, valueEstimates, totalValue])

  // Split view data
  const splitData = useMemo(() => [
    { name: 'Customer\nBenefit', value: customerShare, color: '#22C55E' },
    { name: 'E.ON\nMargin', value: eonShare, color: '#115BA7' },
  ], [customerShare, eonShare])

  // Render mini-visualization for each layer
  function renderMiniViz(key: string) {
    if (key === 'forward') {
      return (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">Forward Procurement Advantage</p>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={FORWARD_BARS} margin={{ top: 15, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="name" tick={{ fontSize: 10, fill: '#6B7280' }} interval={0} />
                <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} domain={[0, 80]} />
                <Bar dataKey="price" radius={[4, 4, 0, 0]}>
                  {FORWARD_BARS.map((entry, i) => (
                    <Cell key={i} fill={entry.fill} />
                  ))}
                  <LabelList dataKey="price" position="top" formatter={(v) => `${v} EUR/MWh`} style={{ fontSize: 9, fontWeight: 600, fill: '#313131' }} />
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
          <div className="flex items-center gap-2 mt-1 text-xs text-gray-600">
            <span className="text-green-600 font-semibold">With flex: buy base delivery</span>
            <span>&rarr;</span>
            <span>Save ~15 EUR/MWh on procurement</span>
          </div>
        </div>
      )
    }

    if (key === 'intraday') {
      return (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">Forecast vs. Actual — Intraday Opportunity</p>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={INTRADAY_BARS} margin={{ top: 15, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="hour" tick={{ fontSize: 10, fill: '#6B7280' }} />
                <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} />
                <Bar dataKey="forecast" fill="#9CA3AF" name="Forecast (EUR/MWh)" radius={[2, 2, 0, 0]} />
                <Bar dataKey="actual" fill="#1D9E9E" name="Actual (EUR/MWh)" radius={[2, 2, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            Deviations between forecast and actual prices create 5-10 EUR/MWh re-optimization value on volatile days.
          </p>
        </div>
      )
    }

    if (key === 'portfolio') {
      return (
        <div className="mt-3 p-3 bg-gray-50 rounded-lg">
          <p className="text-[10px] text-gray-400 uppercase tracking-wide mb-2">Forecasting Accuracy vs. Fleet Size (sqrt(N) effect)</p>
          <div className="h-[120px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={PORTFOLIO_ACCURACY} margin={{ top: 10, right: 10, bottom: 5, left: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                <XAxis dataKey="evs" tick={{ fontSize: 10, fill: '#6B7280' }} label={{ value: 'EVs', position: 'insideBottomRight', offset: -5, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                <YAxis tick={{ fontSize: 9, fill: '#9CA3AF' }} domain={[75, 100]} label={{ value: '%', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                <Tooltip contentStyle={{ borderRadius: 8, fontSize: 11 }} formatter={(v) => [`${v}%`, 'Accuracy']} />
                <Line type="monotone" dataKey="accuracy" stroke="#115BA7" strokeWidth={2} dot={{ fill: '#115BA7', r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-gray-600 mt-1">
            Better accuracy &rarr; lower balancing costs &rarr; higher margin. At 10,000 EVs, forecast accuracy reaches 98%.
          </p>
        </div>
      )
    }

    return null
  }

  return (
    <div className="space-y-6">
      <div className="text-center mb-6">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          The full value lever — more than just day-ahead
        </h2>
        <p className="text-lg text-gray-500 max-w-3xl mx-auto">
          Day-ahead load shifting is just Layer 1. The total annual value per EV is built from 5 concrete, explainable revenue streams.
        </p>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-3 gap-4">
        <Card className="border-[#EA1C0A]/20">
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Total Value per EV/Year</p>
            <AnimatedNumber value={totalValue} prefix="~" suffix=" EUR" className="text-3xl font-bold text-[#EA1C0A]" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">Customer Benefit</p>
            <AnimatedNumber value={customerShare} prefix="~" suffix=" EUR/yr" className="text-2xl font-bold text-green-600" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4 pb-3 text-center">
            <p className="text-xs text-gray-500 uppercase tracking-wide">E.ON Margin</p>
            <AnimatedNumber value={eonShare} prefix="~" suffix=" EUR/yr" className="text-2xl font-bold text-[#115BA7]" />
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Waterfall Chart */}
        <Card className="col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-lg">Annual Value per EV</CardTitle>
              <div className="flex gap-2">
                <button
                  onClick={() => setViewMode('total')}
                  className={`px-3 py-1 text-sm rounded-full transition ${viewMode === 'total' ? 'bg-[#EA1C0A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Value Stack
                </button>
                <button
                  onClick={() => setViewMode('split')}
                  className={`px-3 py-1 text-sm rounded-full transition ${viewMode === 'split' ? 'bg-[#EA1C0A] text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}
                >
                  Who Gets What
                </button>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                {viewMode === 'total' ? (
                  <BarChart data={waterfallData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis
                      dataKey="name"
                      tick={{ fontSize: 11, fill: '#6B7280' }}
                      interval={0}
                    />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} label={{ value: 'EUR/year', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                    <Tooltip
                      contentStyle={{ borderRadius: 8, fontSize: 13 }}
                      formatter={(val, name) => {
                        if (name === 'base' || val == null) return [null, null]
                        return [`${val} EUR/year`, 'Value']
                      }}
                    />
                    {/* Invisible base bar */}
                    <Bar dataKey="base" stackId="stack" fill="transparent" />
                    {/* Visible value bar */}
                    <Bar dataKey="value" stackId="stack" radius={[4, 4, 0, 0]}>
                      {waterfallData.map((entry) => (
                        <Cell key={entry.key} fill={entry.color} cursor="pointer" onClick={() => setExpandedLayer(expandedLayer === entry.key ? null : entry.key)} />
                      ))}
                      <LabelList dataKey="value" position="top" formatter={(v) => `${v} \u20AC`} style={{ fontSize: 12, fontWeight: 600, fill: '#313131' }} />
                    </Bar>
                  </BarChart>
                ) : (
                  <BarChart data={splitData} margin={{ top: 20, right: 20, bottom: 20, left: 0 }} layout="horizontal">
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                    <XAxis dataKey="name" tick={{ fontSize: 13, fill: '#6B7280' }} />
                    <YAxis tick={{ fontSize: 11, fill: '#9CA3AF' }} label={{ value: 'EUR/year', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                    <Tooltip contentStyle={{ borderRadius: 8, fontSize: 13 }} formatter={(val) => val != null ? [`${val} EUR/year`, 'Value'] : ['-', 'Value']} />
                    <Bar dataKey="value" radius={[4, 4, 0, 0]}>
                      {splitData.map((entry, i) => (
                        <Cell key={i} fill={entry.color} />
                      ))}
                      <LabelList dataKey="value" position="top" formatter={(v) => `${v} \u20AC`} style={{ fontSize: 14, fontWeight: 700, fill: '#313131' }} />
                    </Bar>
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Explanation Cards with Mini-Visualizations */}
        <div className="space-y-3 overflow-y-auto max-h-[600px]">
          {[
            { key: 'dayAhead', label: 'Day-Ahead Load Shifting', value: annualDayAhead, color: LAYER_COLORS.dayAhead, live: true },
            { key: 'forward', label: 'Forward Purchasing', value: valueEstimates.forwardPurchasing, color: LAYER_COLORS.forward },
            { key: 'intraday', label: 'Intraday Optimization', value: valueEstimates.intradayOptimization, color: LAYER_COLORS.intraday },
            { key: 'portfolio', label: 'Portfolio Effect', value: valueEstimates.portfolioEffect, color: LAYER_COLORS.portfolio },
            { key: 'gridFee', label: 'Grid Fee Reduction', value: valueEstimates.gridFeeReduction, color: LAYER_COLORS.gridFee },
          ].map(layer => (
            <button
              key={layer.key}
              onClick={() => setExpandedLayer(expandedLayer === layer.key ? null : layer.key)}
              className={`w-full text-left p-3 rounded-lg border transition-all ${
                expandedLayer === layer.key ? 'border-gray-400 bg-white shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
              }`}
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-3 h-3 rounded" style={{ backgroundColor: layer.color }} />
                  <span className="text-sm font-medium text-[#313131]">{layer.label}</span>
                  {layer.live && <span className="text-[10px] bg-green-100 text-green-700 px-1.5 py-0.5 rounded">LIVE</span>}
                </div>
                <span className="text-sm font-bold">{layer.value} \u20AC</span>
              </div>
              {expandedLayer === layer.key && (
                <div>
                  <p className="mt-2 text-xs text-gray-600 leading-relaxed">
                    {LAYER_EXPLANATIONS[layer.key as keyof typeof LAYER_EXPLANATIONS]}
                  </p>
                  {renderMiniViz(layer.key)}
                </div>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Competitor Comparison */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-lg">Market Comparison</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-end gap-4 h-[200px]">
            {/* Our value */}
            <div className="flex-1 text-center">
              <div
                className="mx-auto w-full max-w-[80px] rounded-t-lg bg-[#EA1C0A] relative transition-all"
                style={{ height: `${Math.min((totalValue / 700) * 160, 160)}px` }}
              >
                <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-sm font-bold text-[#EA1C0A]">~{totalValue} \u20AC</span>
              </div>
              <p className="text-xs font-semibold mt-2">E.ON (our target)</p>
              <p className="text-[10px] text-gray-400">Smart V1G</p>
            </div>
            {COMPETITOR_BENCHMARKS.map(comp => (
              <div key={comp.name} className="flex-1 text-center">
                <div
                  className="mx-auto w-full max-w-[80px] rounded-t-lg bg-gray-300 relative transition-all"
                  style={{ height: `${Math.min((comp.value / 700) * 160, 160)}px` }}
                >
                  <span className="absolute -top-6 left-1/2 -translate-x-1/2 text-sm font-bold text-gray-600">{comp.value} \u20AC</span>
                </div>
                <p className="text-xs font-semibold mt-2">{comp.name}</p>
                <p className="text-[10px] text-gray-400">{comp.type}</p>
              </div>
            ))}
          </div>
          <p className="text-sm text-gray-500 mt-4 text-center">
            Our ~{totalValue} EUR/year is competitive with Octopus (450 EUR) and above Sonnen (250 EUR) — without requiring bidirectional hardware like The Mobility House (650+ EUR).
          </p>
        </CardContent>
      </Card>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={onBack}>&larr; Back: Customer Behavior</Button>
        <p className="text-gray-500 text-sm">What happens with 10,000 or 100,000 vehicles?</p>
        <Button onClick={onNext} size="lg" className="bg-[#EA1C0A] hover:bg-[#C51608] text-white px-8">
          Next: Portfolio Scale &rarr;
        </Button>
      </div>
    </div>
  )
}
