'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, DEFAULT_CHARGE_POWER_KW, type ChargingScenario, type HourlyPrice } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ReferenceLine, ReferenceArea, ResponsiveContainer
} from 'recharts'

interface PriceData {
  selectedDate: string
  selectedDayPrices: HourlyPrice[]
}

interface Props {
  prices: PriceData
  scenario: ChargingScenario
  setScenario: (s: ChargingScenario) => void
  optimization: OptimizeResult | null
  onNext: () => void
  onBack: () => void
}

function SliderInput({ label, value, min, max, step, unit, onChange, formatValue }: {
  label: string; value: number; min: number; max: number; step: number; unit: string
  onChange: (v: number) => void; formatValue?: (v: number) => string
}) {
  const displayValue = formatValue ? formatValue(value) : `${value}${unit}`
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-sm">
        <span className="text-gray-600">{label}</span>
        <span className="font-semibold text-[#313131]">{displayValue}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={`${label}: ${displayValue}`}
        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#EA1C0A]"
      />
      <div className="flex justify-between text-[10px] text-gray-400">
        <span>{min}{unit}</span>
        <span>{max}{unit}</span>
      </div>
    </div>
  )
}

export function Step2ChargingScenario({ prices, scenario, setScenario, optimization, onNext, onBack }: Props) {
  const energyPerSession = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weeklyPlugIns)
  const kmPerCharge = Math.round(scenario.yearlyMileageKm / (scenario.weeklyPlugIns * 52))
  const sessionsPerYear = scenario.weeklyPlugIns * 52

  // Build chart data: compute charging hours directly from hourly prices
  const { chartData, baselineAnnotation, optimizedAnnotation } = useMemo(() => {
    if (prices.selectedDayPrices.length === 0) return { chartData: [], baselineAnnotation: null, optimizedAnnotation: null }

    // How many full hours of charging needed?
    const hoursNeeded = Math.ceil(energyPerSession / DEFAULT_CHARGE_POWER_KW)

    // Sort prices in plug-in order (18:00 → 17:00 next day)
    const allPrices = [...prices.selectedDayPrices].sort((a, b) => {
      const aAdj = a.hour < scenario.plugInTime ? a.hour + 24 : a.hour
      const bAdj = b.hour < scenario.plugInTime ? b.hour + 24 : b.hour
      return aAdj - bAdj
    })

    // Filter to charging window only (plug-in to departure)
    const windowPrices = allPrices.filter(p => {
      const adj = p.hour < scenario.plugInTime ? p.hour + 24 : p.hour
      const depAdj = scenario.departureTime < scenario.plugInTime ? scenario.departureTime + 24 : scenario.departureTime
      return adj >= scenario.plugInTime && adj < depAdj
    })

    // Baseline: first N hours from plug-in (charge immediately)
    const baselineHours = new Set(windowPrices.slice(0, hoursNeeded).map(p => p.hour))

    // Optimized: cheapest N hours in window
    const sortedByPrice = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
    const optimizedHours = new Set(sortedByPrice.slice(0, hoursNeeded).map(p => p.hour))

    // Compute avg prices for annotations
    const baselinePrices = windowPrices.filter(p => baselineHours.has(p.hour))
    const optimizedPrices = windowPrices.filter(p => optimizedHours.has(p.hour))
    const baselineAvg = baselinePrices.length > 0 ? baselinePrices.reduce((s, p) => s + p.priceCtKwh, 0) / baselinePrices.length : 0
    const optimizedAvg = optimizedPrices.length > 0 ? optimizedPrices.reduce((s, p) => s + p.priceCtKwh, 0) / optimizedPrices.length : 0
    const baselineCost = baselineAvg * energyPerSession / 100
    const optimizedCost = optimizedAvg * energyPerSession / 100

    const data = allPrices.map(p => {
      const hourKey = String(p.hour).padStart(2, '0')
      const isBaseline = baselineHours.has(p.hour)
      const isOptimized = optimizedHours.has(p.hour)
      const priceVal = Math.round(p.priceEurMwh * 10) / 10
      return {
        hour: `${hourKey}:00`,
        hourNum: p.hour,
        price: priceVal,
        baselinePrice: isBaseline ? priceVal : null,
        optimizedPrice: isOptimized ? priceVal : null,
        isBaseline,
        isOptimized,
      }
    })

    // Annotations
    const bPoints = data.filter(d => d.isBaseline)
    const oPoints = data.filter(d => d.isOptimized)
    const bAnno = bPoints.length > 0 ? {
      kwh: energyPerSession,
      ctKwh: Math.round(baselineAvg * 10) / 10,
      costEur: Math.round(baselineCost * 100) / 100,
    } : null
    const oAnno = oPoints.length > 0 ? {
      kwh: energyPerSession,
      ctKwh: Math.round(optimizedAvg * 10) / 10,
      costEur: Math.round(optimizedCost * 100) / 100,
    } : null

    return { chartData: data, baselineAnnotation: bAnno, optimizedAnnotation: oAnno }
  }, [prices.selectedDayPrices, energyPerSession, scenario.plugInTime, scenario.departureTime])

  // Compute arrival/departure labels for chart
  const arrivalLabel = `${String(scenario.plugInTime).padStart(2, '0')}:00`
  const departureLabel = `${String(scenario.departureTime).padStart(2, '0')}:00`

  const annualSavings = optimization ? Math.round(optimization.savings_eur * sessionsPerYear) : 0
  const annualBaseline = optimization ? Math.round(optimization.cost_without_flex_eur * sessionsPerYear) : 0
  const annualOptimized = optimization ? Math.round(optimization.cost_with_flex_eur * sessionsPerYear) : 0

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center mb-6">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          Charge when electricity is cheap
        </h2>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          Your car is plugged in for hours overnight. Smart charging shifts consumption to the cheapest windows — same energy, lower cost.
        </p>
      </div>

      {/* Driving Profile */}
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm">Your Driving Profile</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <SliderInput
              label="Yearly Mileage"
              value={scenario.yearlyMileageKm}
              min={5000} max={40000} step={1000} unit=" km"
              formatValue={(v) => `${v.toLocaleString('en-US')} km`}
              onChange={(v) => setScenario({ ...scenario, yearlyMileageKm: v })}
            />
            <SliderInput
              label="Weekly Plug-Ins"
              value={scenario.weeklyPlugIns}
              min={2} max={7} step={1} unit="x"
              formatValue={(v) => `${v}x per week`}
              onChange={(v) => setScenario({ ...scenario, weeklyPlugIns: v })}
            />
            <div className="flex flex-col justify-center text-center p-3 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">Derived per Session</p>
              <p className="text-xl font-bold text-[#313131]">~{energyPerSession} kWh</p>
              <p className="text-xs text-gray-400">~{kmPerCharge} km per charge</p>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Chart (2/3) */}
        <Card className="lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <CardTitle className="text-lg">Charging on the Price Curve</CardTitle>
              <div className="flex gap-2">
                <Badge className="bg-red-100 text-red-700 border-red-200">Baseline</Badge>
                <Badge className="bg-green-100 text-green-700 border-green-200">Optimized</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[380px] relative">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 40, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="baselineGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA1C0A" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#EA1C0A" stopOpacity={0.02} />
                    </linearGradient>
                    <linearGradient id="optimizedGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22C55E" stopOpacity={0.15} />
                      <stop offset="100%" stopColor="#22C55E" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  {/* Charging window background */}
                  {chartData.length > 0 && (
                    <ReferenceArea
                      x1={chartData[0].hour}
                      x2={chartData[chartData.length - 1].hour}
                      fill="#F3F4F6"
                      fillOpacity={0.6}
                    />
                  )}
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" label={{ value: 'EUR/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13 }}
                    formatter={(val, name) => {
                      if (val == null) return [null, null]
                      if (name === 'baselinePrice') return [`${Number(val).toFixed(1)} EUR/MWh`, 'Baseline Charging']
                      if (name === 'optimizedPrice') return [`${Number(val).toFixed(1)} EUR/MWh`, 'Optimized Charging']
                      return [`${Number(val).toFixed(1)} EUR/MWh (${(Number(val) / 10).toFixed(2)} ct/kWh)`, 'Spot Price']
                    }}
                  />
                  {/* Base price line — thin, gray */}
                  <Line type="monotone" dataKey="price" stroke="#9CA3AF" strokeWidth={1.5} dot={false} name="price" connectNulls />
                  {/* Baseline charging segment — thick red, directly on the price line */}
                  <Line type="monotone" dataKey="baselinePrice" stroke="#EA1C0A" strokeWidth={5} dot={false} name="baselinePrice" connectNulls={false} />
                  <Area type="monotone" dataKey="baselinePrice" fill="url(#baselineGrad)" stroke="none" connectNulls={false} />
                  {/* Optimized charging segment — thick green, directly on the price line */}
                  <Line type="monotone" dataKey="optimizedPrice" stroke="#22C55E" strokeWidth={5} dot={false} name="optimizedPrice" connectNulls={false} />
                  <Area type="monotone" dataKey="optimizedPrice" fill="url(#optimizedGrad)" stroke="none" connectNulls={false} />
                  {/* Average reference lines */}
                  {baselineAnnotation && (
                    <ReferenceLine
                      y={baselineAnnotation.ctKwh * 10}
                      stroke="#EA1C0A"
                      strokeDasharray="5 5"
                      strokeOpacity={0.6}
                    />
                  )}
                  {optimizedAnnotation && (
                    <ReferenceLine
                      y={optimizedAnnotation.ctKwh * 10}
                      stroke="#22C55E"
                      strokeDasharray="5 5"
                      strokeOpacity={0.6}
                    />
                  )}
                </ComposedChart>
              </ResponsiveContainer>
              {/* Annotation badges — positioned above the chart */}
              {baselineAnnotation && (
                <div className="absolute top-1 left-[15%] flex items-center gap-1 bg-red-50 border border-red-200 rounded-lg px-2 py-1 shadow-sm">
                  <span className="text-red-600 text-xs font-bold">Baseline:</span>
                  <span className="text-red-700 text-xs">{baselineAnnotation.kwh} kWh</span>
                  <span className="text-red-400 text-xs">@</span>
                  <span className="text-red-700 text-xs font-semibold">{baselineAnnotation.ctKwh.toFixed(1)} ct/kWh</span>
                  <span className="text-red-500 text-xs">=</span>
                  <span className="text-red-700 text-xs font-bold">{baselineAnnotation.costEur.toFixed(2)} €</span>
                </div>
              )}
              {optimizedAnnotation && (
                <div className="absolute top-1 right-[5%] flex items-center gap-1 bg-green-50 border border-green-200 rounded-lg px-2 py-1 shadow-sm">
                  <span className="text-green-600 text-xs font-bold">Optimized:</span>
                  <span className="text-green-700 text-xs">{optimizedAnnotation.kwh} kWh</span>
                  <span className="text-green-400 text-xs">@</span>
                  <span className="text-green-700 text-xs font-semibold">{optimizedAnnotation.ctKwh.toFixed(1)} ct/kWh</span>
                  <span className="text-green-500 text-xs">=</span>
                  <span className="text-green-700 text-xs font-bold">{optimizedAnnotation.costEur.toFixed(2)} €</span>
                </div>
              )}
            </div>

            {/* Dual-thumb arrival/departure sliders */}
            <div className="mt-4 p-4 bg-gray-50 rounded-lg">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-3">Charging Window</p>
              <div className="grid grid-cols-2 gap-6">
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Arrival (Plug-in)</span>
                    <span className="font-semibold text-[#313131]">{arrivalLabel}</span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={23}
                    step={1}
                    value={scenario.plugInTime}
                    onChange={(e) => setScenario({ ...scenario, plugInTime: Number(e.target.value) })}
                    aria-label={`Arrival time: ${arrivalLabel}`}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#EA1C0A]"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>14:00</span>
                    <span>23:00</span>
                  </div>
                </div>
                <div className="space-y-1">
                  <div className="flex justify-between text-sm">
                    <span className="text-gray-600">Departure</span>
                    <span className="font-semibold text-[#313131]">{departureLabel}</span>
                  </div>
                  <input
                    type="range"
                    min={4}
                    max={10}
                    step={1}
                    value={scenario.departureTime}
                    onChange={(e) => setScenario({ ...scenario, departureTime: Number(e.target.value) })}
                    aria-label={`Departure time: ${departureLabel}`}
                    className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-[#115BA7]"
                  />
                  <div className="flex justify-between text-[10px] text-gray-400">
                    <span>04:00</span>
                    <span>10:00</span>
                  </div>
                </div>
              </div>
              <p className="text-xs text-gray-400 mt-2 text-center">
                Available window: {arrivalLabel} - {departureLabel} ({
                  scenario.plugInTime > scenario.departureTime
                    ? (24 - scenario.plugInTime + scenario.departureTime)
                    : (scenario.departureTime - scenario.plugInTime)
                } hours)
              </p>
            </div>

            {/* Explanation */}
            <div className="mt-4 p-4 bg-gray-50 rounded-lg text-sm text-gray-700">
              <p>
                <span className="inline-block w-8 h-1 bg-red-500 rounded mr-1 align-middle" /> <strong>Red line</strong> = baseline charging (start at plug-in, charge until full — hits peak prices).
              </p>
              <p className="mt-1">
                <span className="inline-block w-8 h-1 bg-green-500 rounded mr-1 align-middle" /> <strong>Green line</strong> = optimized charging (cheapest hours selected). More energy needed → more hours used → spread advantage narrows.
              </p>
              <p className="mt-1">
                <span className="inline-block w-8 h-0.5 bg-gray-400 rounded mr-1 align-middle" /> Thin gray = full price curve for reference.
              </p>
            </div>
          </CardContent>
        </Card>

        {/* Results (1/3) */}
        <div className="space-y-4">
          {/* Cost Comparison */}
          {optimization && (
            <Card className="border-[#EA1C0A]/20 bg-[#EA1C0A]/[0.02]">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Cost Comparison</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Baseline cost</span>
                  <span className="font-semibold text-red-600">{optimization.cost_without_flex_eur.toFixed(2)} EUR</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Optimized cost</span>
                  <span className="font-semibold text-green-600">{optimization.cost_with_flex_eur.toFixed(2)} EUR</span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold">Savings per session</span>
                    <AnimatedNumber value={optimization.savings_eur} decimals={2} suffix=" EUR" className="text-xl font-bold text-[#EA1C0A]" />
                  </div>
                </div>
                <div className="border-t pt-2 text-sm space-y-1">
                  <div className="flex justify-between text-gray-600">
                    <span>Energy charged</span>
                    <span>{optimization.energy_charged_kwh} kWh</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Avg. price baseline</span>
                    <span>{optimization.baseline_avg_price.toFixed(1)} ct/kWh</span>
                  </div>
                  <div className="flex justify-between text-gray-600">
                    <span>Avg. price optimized</span>
                    <span>{optimization.avg_price_with_flex.toFixed(1)} ct/kWh</span>
                  </div>
                </div>
                <div className="bg-[#EA1C0A]/5 rounded-lg p-3 text-center border border-[#EA1C0A]/10">
                  <p className="text-xs text-gray-500 mb-1">Annual projection (~{sessionsPerYear} sessions)</p>
                  <AnimatedNumber value={annualSavings} suffix=" EUR/year" className="text-2xl font-bold text-[#EA1C0A]" />
                  <div className="flex justify-between text-xs text-gray-400 mt-2 px-2">
                    <span>Baseline: ~{annualBaseline} EUR</span>
                    <span>Optimized: ~{annualOptimized} EUR</span>
                  </div>
                  <p className="text-xs text-gray-400 mt-1">Day-ahead load shifting only — Layer 1 of 5</p>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Empty state when no optimization */}
          {!optimization && (
            <Card className="border-gray-200">
              <CardContent className="pt-6 pb-6 text-center">
                <div className="w-10 h-10 border-4 border-[#EA1C0A] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">Calculating optimal charging schedule...</p>
              </CardContent>
            </Card>
          )}

          {/* How it works */}
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">How It Works</CardTitle>
            </CardHeader>
            <CardContent className="text-sm text-gray-600 space-y-2">
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#EA1C0A]/10 text-[#EA1C0A] flex items-center justify-center text-xs font-bold">1</span>
                <span>You plug in your EV in the evening as usual</span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#EA1C0A]/10 text-[#EA1C0A] flex items-center justify-center text-xs font-bold">2</span>
                <span>Our algorithm finds the cheapest hours within your window</span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#EA1C0A]/10 text-[#EA1C0A] flex items-center justify-center text-xs font-bold">3</span>
                <span>Your car charges at the optimal times overnight</span>
              </div>
              <div className="flex gap-2">
                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-[#EA1C0A]/10 text-[#EA1C0A] flex items-center justify-center text-xs font-bold">4</span>
                <span>Full battery by departure, lowest possible cost</span>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Navigation */}
      <div className="flex justify-between items-center pt-4">
        <Button variant="outline" onClick={onBack}>&larr; Back: Price Explorer</Button>
        <p className="text-gray-500 text-sm">
          But day-ahead is just the beginning — there are more value drivers.
        </p>
        <Button onClick={onNext} size="lg" className="bg-[#EA1C0A] hover:bg-[#C51608] text-white px-8">
          Next: Value Waterfall &rarr;
        </Button>
      </div>
    </div>
  )
}
