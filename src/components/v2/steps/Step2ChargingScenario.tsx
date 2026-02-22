'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, type ChargingScenario, type HourlyPrice, AVG_CONSUMPTION_KWH_PER_100KM } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
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

function isHourInWindow(hour: number, start: number, end: number): boolean {
  if (start > end) return hour >= start || hour < end
  return hour >= start && hour < end
}

export function Step2ChargingScenario({ prices, scenario, setScenario, optimization, onNext, onBack }: Props) {
  const energyPerSession = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weeklyPlugIns)
  const kmPerCharge = Math.round(scenario.yearlyMileageKm / (scenario.weeklyPlugIns * 52))
  const sessionsPerYear = scenario.weeklyPlugIns * 52

  // Build chart data: price curve + baseline bars + optimized bars
  const chartData = useMemo(() => {
    if (prices.selectedDayPrices.length === 0) return []

    // Build sets of which hours have baseline/optimized charging
    const baselineHours = new Map<string, number>()
    const optimizedHours = new Map<string, number>()

    if (optimization) {
      for (const block of optimization.baseline_schedule) {
        const startH = parseInt(block.start.split(':')[0])
        const endH = parseInt(block.end.split(':')[0])
        for (let h = startH; h !== endH; h = (h + 1) % 24) {
          baselineHours.set(String(h).padStart(2, '0'), block.price_ct_kwh)
          if (baselineHours.size > 24) break
        }
      }
      for (const block of optimization.charging_schedule) {
        const startH = parseInt(block.start.split(':')[0])
        const endH = parseInt(block.end.split(':')[0])
        for (let h = startH; h !== endH; h = (h + 1) % 24) {
          optimizedHours.set(String(h).padStart(2, '0'), block.price_ct_kwh)
          if (optimizedHours.size > 24) break
        }
      }
    }

    // Reorder to show from plug-in time
    const allPrices = [...prices.selectedDayPrices].sort((a, b) => {
      const aAdj = a.hour < scenario.plugInTime ? a.hour + 24 : a.hour
      const bAdj = b.hour < scenario.plugInTime ? b.hour + 24 : b.hour
      return aAdj - bAdj
    })

    return allPrices.map(p => {
      const hourKey = String(p.hour).padStart(2, '0')
      const inWindow = isHourInWindow(p.hour, scenario.plugInTime, scenario.departureTime)
      return {
        hour: `${hourKey}:00`,
        hourNum: p.hour,
        price: Math.round(p.priceEurMwh * 10) / 10,
        baseline: baselineHours.has(hourKey) ? Math.round(p.priceEurMwh * 10) / 10 : null,
        optimized: optimizedHours.has(hourKey) ? Math.round(p.priceEurMwh * 10) / 10 : null,
        inWindow,
      }
    })
  }, [prices.selectedDayPrices, optimization, scenario.plugInTime, scenario.departureTime])

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
              <CardTitle className="text-lg">Baseline vs. Optimized Charging</CardTitle>
              <div className="flex gap-2">
                <Badge className="bg-red-100 text-red-700 border-red-200">Baseline (charge immediately)</Badge>
                <Badge className="bg-green-100 text-green-700 border-green-200">Optimized (cheapest hours)</Badge>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <div className="h-[380px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={{ top: 10, right: 10, bottom: 0, left: 0 }}>
                  <defs>
                    <linearGradient id="priceGrad2" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#115BA7" stopOpacity={0.1} />
                      <stop offset="100%" stopColor="#115BA7" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                  {/* Arrival-Departure window highlight — data is sorted from plugInTime, so first item is arrival, last is before departure */}
                  {chartData.length > 0 && (
                    <ReferenceArea
                      x1={chartData[0].hour}
                      x2={chartData[chartData.length - 1].hour}
                      fill="#FEF9C3"
                      fillOpacity={0.5}
                      label={{ value: 'Charging Window', position: 'insideTop', fontSize: 10, fill: '#92400E' }}
                    />
                  )}
                  <XAxis dataKey="hour" tick={{ fontSize: 11 }} stroke="#9CA3AF" />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF" label={{ value: 'EUR/MWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />
                  <Tooltip
                    contentStyle={{ borderRadius: 8, border: '1px solid #E5E7EB', fontSize: 13 }}
                    formatter={(val, name) => {
                      if (val == null) return ['-', String(name)]
                      const label = name === 'baseline' ? 'Baseline' : name === 'optimized' ? 'Optimized' : 'Price'
                      return [`${Number(val).toFixed(1)} EUR/MWh`, label]
                    }}
                  />
                  <Bar dataKey="baseline" fill="#EA1C0A" opacity={0.5} radius={[2, 2, 0, 0]} name="baseline" />
                  <Bar dataKey="optimized" fill="#22C55E" opacity={0.6} radius={[2, 2, 0, 0]} name="optimized" />
                  <Line type="monotone" dataKey="price" stroke="#115BA7" strokeWidth={2.5} dot={false} name="Price" />
                  {optimization && (
                    <>
                      <ReferenceLine
                        y={optimization.baseline_avg_price * 10}
                        stroke="#EA1C0A"
                        strokeDasharray="5 5"
                        label={{ value: `Baseline avg: ${(optimization.baseline_avg_price * 10).toFixed(0)}`, position: 'right', fontSize: 10, fill: '#EA1C0A' }}
                      />
                      <ReferenceLine
                        y={optimization.avg_price_with_flex * 10}
                        stroke="#22C55E"
                        strokeDasharray="5 5"
                        label={{ value: `Optimized avg: ${(optimization.avg_price_with_flex * 10).toFixed(0)}`, position: 'left', fontSize: 10, fill: '#22C55E' }}
                      />
                    </>
                  )}
                </ComposedChart>
              </ResponsiveContainer>
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
                <span className="inline-block w-3 h-3 bg-red-400 rounded mr-1 align-middle" /> <strong>Red bars</strong> show when charging would happen without optimization — starting immediately at plug-in time, hitting expensive peak hours.
              </p>
              <p className="mt-1">
                <span className="inline-block w-3 h-3 bg-green-500 rounded mr-1 align-middle" /> <strong>Green bars</strong> show our optimized schedule — charging shifted to the cheapest available hours within your window. Same energy, lower cost.
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
