'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import {
  ComposedChart, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import { computeWindowSavings } from '@/lib/charging-helpers'
import { DEFAULT_CHARGE_POWER_KW, deriveEnergyPerSession, type HourlyPrice } from '@/lib/v2-config'

// Typical EV plug-in time distribution (home charging, Germany)
const PLUGIN_TIME_DIST = [
  { hour: 14, pct: 2 },
  { hour: 15, pct: 4 },
  { hour: 16, pct: 9 },
  { hour: 17, pct: 21 },
  { hour: 18, pct: 27 },
  { hour: 19, pct: 18 },
  { hour: 20, pct: 11 },
  { hour: 21, pct: 5 },
  { hour: 22, pct: 3 },
]

// German yearly mileage distribution (KBA data, matches Step2 sliders)
const MILEAGE_DIST = [
  { pct: 14, avgKm: 7500, label: '5–10k' },
  { pct: 26, avgKm: 12500, label: '10–15k' },
  { pct: 25, avgKm: 17500, label: '15–20k' },
  { pct: 15, avgKm: 22500, label: '20–25k' },
  { pct: 10, avgKm: 27500, label: '25–30k' },
  { pct: 7, avgKm: 35000, label: '30–40k' },
]

/** Format large numbers: 1,476 → "1,476", 124,233 → "124k", 1,242,333 → "1.24M" */
function fmtEur(v: number): string {
  const abs = Math.abs(v)
  if (abs >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`
  if (abs >= 100_000) return `${Math.round(v / 1_000)}k`
  if (abs >= 10_000) return `${(v / 1_000).toFixed(1)}k`
  return v.toLocaleString('en-US')
}

interface Props {
  hourlyPrices: HourlyPrice[]
  selectedDate: string
  departureTime: number
  yearlyMileageKm: number
  weekdayPlugIns: number
  weekendPlugIns: number
  singleEvSavings: number
}

function nextDayStr(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

export function FleetPortfolioCard({
  hourlyPrices, selectedDate, departureTime,
  yearlyMileageKm, weekdayPlugIns, weekendPlugIns,
  singleEvSavings,
}: Props) {
  const [fleetSize, setFleetSize] = useState(100)
  const [distributeMileage, setDistributeMileage] = useState(true)

  // Logarithmic slider: 10 → 10,000
  const logMin = Math.log10(10)
  const logMax = Math.log10(10000)
  const logToFleet = (v: number) => Math.round(Math.pow(10, v))
  const fleetToLog = (f: number) => Math.log10(Math.max(10, f))

  const weeklyPlugIns = Math.max(1, weekdayPlugIns + weekendPlugIns)

  // Pre-index prices by date
  const pricesByDate = useMemo(() => {
    const m = new Map<string, HourlyPrice[]>()
    for (const p of hourlyPrices) {
      let arr = m.get(p.date)
      if (!arr) { arr = []; m.set(p.date, arr) }
      arr.push(p)
    }
    return m
  }, [hourlyPrices])

  // Mileage buckets: either use the distribution or a single bucket matching the user's slider
  const mileageBuckets = useMemo(() => {
    if (!distributeMileage) return [{ pct: 100, avgKm: yearlyMileageKm }]
    return MILEAGE_DIST.map(b => ({ pct: b.pct, avgKm: b.avgKm }))
  }, [distributeMileage, yearlyMileageKm])

  // Core computation (fleet-size independent): per-arrival-hour load profiles + annual averages
  const coreData = useMemo(() => {
    if (!selectedDate || hourlyPrices.length === 0) return null

    const kwhPerSlot = DEFAULT_CHARGE_POWER_KW
    const slotsPerHour = 1

    // For chart: use average energy (weighted across mileage buckets)
    const avgEnergy = mileageBuckets.reduce((s, b) =>
      s + (b.pct / 100) * deriveEnergyPerSession(b.avgKm, weekdayPlugIns, weekendPlugIns), 0)
    const avgSlotsNeeded = Math.ceil(avgEnergy / kwhPerSlot)

    const dayPrices = pricesByDate.get(selectedDate) || []
    const nd = nextDayStr(selectedDate)
    const nextDayPrices = pricesByDate.get(nd) || []

    if (dayPrices.length === 0 || nextDayPrices.length === 0) return null

    // Per-arrival-hour: optimized/baseline charging hours for the selected day
    const arrivalResults: { hour: number; pct: number; savingsEur: number; optHours: Set<number>; baseHours: Set<number> }[] = []

    for (const { hour, pct } of PLUGIN_TIME_DIST) {
      const eve = dayPrices.filter(p => p.hour >= hour)
      const morn = nextDayPrices.filter(p => p.hour < departureTime)
      const win = [...eve, ...morn]
      if (win.length === 0) continue

      // Weighted savings across mileage buckets
      let weightedSavings = 0
      for (const mb of mileageBuckets) {
        const eps = deriveEnergyPerSession(mb.avgKm, weekdayPlugIns, weekendPlugIns)
        const { savingsEur } = computeWindowSavings(win, eps, kwhPerSlot, slotsPerHour)
        weightedSavings += savingsEur * (mb.pct / 100)
      }

      const sorted = [...win].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
      const optHours = new Set(sorted.slice(0, avgSlotsNeeded).map(p => p.hour))
      const baseHours = new Set(win.slice(0, avgSlotsNeeded).map(p => p.hour))

      arrivalResults.push({ hour, pct, savingsEur: weightedSavings, optHours, baseHours })
    }

    // Build load chart data: per-EV fractions (scaled by fleetSize later)
    const allPrices = [...dayPrices, ...nextDayPrices]
      .filter(p => (p.date === selectedDate && p.hour >= 14) || (p.date === nd && p.hour <= 10))
      .sort((a, b) => a.date === b.date ? a.hour - b.hour : a.date < b.date ? -1 : 1)

    const loadPoints = allPrices.map((p, idx) => {
      let optFraction = 0
      let baseFraction = 0
      for (const r of arrivalResults) {
        if (p.date === selectedDate && p.hour < r.hour) continue
        const evFrac = r.pct / 100
        if (r.optHours.has(p.hour)) optFraction += evFrac * DEFAULT_CHARGE_POWER_KW
        if (r.baseHours.has(p.hour)) baseFraction += evFrac * DEFAULT_CHARGE_POWER_KW
      }
      return {
        idx,
        label: `${String(p.hour).padStart(2, '0')}:00`,
        price: Math.round((p.priceEurMwh / 10) * 100) / 100,
        optFractionKw: optFraction,
        baseFractionKw: baseFraction,
      }
    })

    // Annual savings: sampled (~50 dates)
    const allDates = [...pricesByDate.keys()].sort()
    const step = Math.max(1, Math.floor(allDates.length / 50))

    let singleSav = 0, singleDays = 0
    let distSav = 0, distDays = 0

    for (let i = 0; i < allDates.length; i += step) {
      const dDate = allDates[i]
      const dPrices = pricesByDate.get(dDate)
      const nDate = nextDayStr(dDate)
      const nPrices = pricesByDate.get(nDate)
      if (!dPrices || !nPrices || nPrices.length === 0) continue

      // Single arrival at 18h — weighted across mileage buckets
      const singleEve = dPrices.filter(p => p.hour >= 18)
      const singleMorn = nPrices.filter(p => p.hour < departureTime)
      const singleWin = [...singleEve, ...singleMorn]
      if (singleWin.length >= 2) {
        let wSav = 0
        for (const mb of mileageBuckets) {
          const eps = deriveEnergyPerSession(mb.avgKm, weekdayPlugIns, weekendPlugIns)
          const { savingsEur } = computeWindowSavings(singleWin, eps, kwhPerSlot, slotsPerHour)
          wSav += savingsEur * (mb.pct / 100)
        }
        singleSav += wSav
        singleDays++
      }

      // Distributed arrivals — weighted across mileage buckets
      let dayDistSav = 0
      for (const { hour, pct } of PLUGIN_TIME_DIST) {
        const eve = dPrices.filter(p => p.hour >= hour)
        const morn = nPrices.filter(p => p.hour < departureTime)
        const win = [...eve, ...morn]
        if (win.length < 2) continue
        let wSav = 0
        for (const mb of mileageBuckets) {
          const eps = deriveEnergyPerSession(mb.avgKm, weekdayPlugIns, weekendPlugIns)
          const { savingsEur } = computeWindowSavings(win, eps, kwhPerSlot, slotsPerHour)
          wSav += savingsEur * (mb.pct / 100)
        }
        dayDistSav += wSav * (pct / 100)
      }
      distSav += dayDistSav
      distDays++
    }

    const singleAvgDaily = singleDays > 0 ? singleSav / singleDays : 0
    const distAvgDaily = distDays > 0 ? distSav / distDays : 0
    const singleAnnualPerEv = singleAvgDaily * weeklyPlugIns * 52
    const distAnnualPerEv = distAvgDaily * weeklyPlugIns * 52

    return {
      arrivalResults,
      loadPoints,
      singleAnnualPerEv,
      distAnnualPerEv,
      avgEnergy,
    }
  }, [hourlyPrices, pricesByDate, selectedDate, departureTime, mileageBuckets, weekdayPlugIns, weekendPlugIns, weeklyPlugIns])

  // Fleet-size-DEPENDENT: scales load data + applies fleet-size portfolio scaling
  const fleetData = useMemo(() => {
    if (!coreData) return null

    const loadData = coreData.loadPoints.map(p => ({
      ...p,
      optimizedMw: Math.round(p.optFractionKw * fleetSize / 1000 * 100) / 100,
      baselineMw: Math.round(p.baseFractionKw * fleetSize / 1000 * 100) / 100,
    }))

    // Portfolio effect scales with fleet size:
    // Small fleets can't perfectly realize the distribution → less diversification benefit
    // At 10 EVs: ~30% of theoretical portfolio effect
    // At 100 EVs: ~75%
    // At 1000+: ~95%+
    const realizationFactor = 1 - Math.exp(-fleetSize / 150)

    const basePerEv = coreData.singleAnnualPerEv
    const fullDistPerEv = coreData.distAnnualPerEv
    const effectivePerEv = basePerEv + (fullDistPerEv - basePerEv) * realizationFactor
    const portfolioEffect = basePerEv > 0
      ? ((effectivePerEv - basePerEv) / basePerEv) * 100
      : 0

    return {
      loadData,
      annualFleet: Math.round(effectivePerEv * fleetSize),
      perEvSavings: Math.round(effectivePerEv),
      portfolioEffect: Math.round(portfolioEffect * 10) / 10,
    }
  }, [coreData, fleetSize])

  if (!fleetData) return null

  const maxDistPct = Math.max(...PLUGIN_TIME_DIST.map(d => d.pct))

  return (
    <Card className="overflow-hidden shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base font-bold text-[#313131]">Fleet Portfolio View</CardTitle>
          <div className="flex items-center gap-3">
            <span className="text-[11px] text-gray-400">Fleet size:</span>
            <input
              type="range"
              min={logMin} max={logMax} step={0.01}
              value={fleetToLog(fleetSize)}
              onChange={(e) => setFleetSize(logToFleet(Number(e.target.value)))}
              aria-label={`Fleet size: ${fleetSize} EVs`}
              className="w-32 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white"
            />
            <span className="text-sm font-bold text-[#313131] tabular-nums w-16 text-right">{fleetSize.toLocaleString()}</span>
            <span className="text-[11px] text-gray-400">EVs</span>
          </div>
        </div>
        <p className="text-[11px] text-gray-500 mt-1">
          Distributed arrival times · aggregated charging load · portfolio diversification effect
        </p>
      </CardHeader>
      <CardContent className="pt-5 space-y-8">
        {/* Load curve chart — two area curves: baseline (red) vs optimized (green) */}
        {fleetData.loadData.length > 0 && (
          <div className="h-[240px]">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={fleetData.loadData} margin={{ top: 10, right: 50, bottom: 2, left: 10 }}>
                <defs>
                  <linearGradient id="baselineGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#EF4444" stopOpacity={0.25} />
                    <stop offset="100%" stopColor="#EF4444" stopOpacity={0.05} />
                  </linearGradient>
                  <linearGradient id="optimizedGrad" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#10B981" stopOpacity={0.3} />
                    <stop offset="100%" stopColor="#10B981" stopOpacity={0.05} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                <YAxis yAxisId="load" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                  label={{ value: 'MW', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                <YAxis yAxisId="price" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                  label={{ value: 'ct/kWh', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                <Tooltip
                  content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload as (typeof fleetData.loadData)[number]
                    return (
                      <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                        <p className="text-gray-500 text-[10px]">{d.label}</p>
                        <p className="text-gray-600 tabular-nums">{d.price.toFixed(2)} ct/kWh</p>
                        <div className="flex items-center gap-1.5 mt-1">
                          <span className="w-2 h-0.5 bg-red-400 rounded inline-block" />
                          <span className="text-red-500 tabular-nums">{d.baselineMw.toFixed(2)} MW unmanaged</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          <span className="w-2 h-0.5 bg-emerald-500 rounded inline-block" />
                          <span className="text-emerald-600 tabular-nums font-semibold">{d.optimizedMw.toFixed(2)} MW optimized</span>
                        </div>
                      </div>
                    )
                  }} />
                {/* Baseline: unmanaged charging load — red area */}
                <Area yAxisId="load" dataKey="baselineMw" fill="url(#baselineGrad)" stroke="#EF4444"
                  strokeWidth={2} strokeDasharray="6 3" type="stepAfter" />
                {/* Optimized: shifted charging load — green area */}
                <Area yAxisId="load" dataKey="optimizedMw" fill="url(#optimizedGrad)" stroke="#10B981"
                  strokeWidth={2} type="stepAfter" />
                {/* Price line */}
                <Line yAxisId="price" dataKey="price" stroke="#94A3B8" strokeWidth={1.5} dot={false} type="monotone" />
              </ComposedChart>
            </ResponsiveContainer>
            {/* Legend */}
            <div className="flex items-center justify-center gap-5 mt-1 text-[10px] text-gray-500">
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-dashed border-red-400 inline-block" />
                Unmanaged (immediate)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t-2 border-emerald-500 inline-block" />
                Optimized (shifted)
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-4 border-t border-gray-400 inline-block" />
                Spot price
              </span>
            </div>
          </div>
        )}

        {/* Fleet stats + distributions */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          {/* Fleet savings summary */}
          <div className="space-y-3">
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Fleet Savings</p>
            <div>
              <p className="text-2xl font-extrabold text-emerald-700 tabular-nums">{fmtEur(fleetData.annualFleet)} <span className="text-sm font-normal text-gray-400">EUR/yr</span></p>
              <p className="text-[11px] text-gray-400 mt-0.5">{fleetSize.toLocaleString()} EVs total</p>
            </div>
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Per EV (avg)</p>
              <AnimatedNumber value={fleetData.perEvSavings} decimals={0} suffix=" EUR/yr" className="text-lg font-bold text-emerald-800 tabular-nums" />
              {coreData?.avgEnergy && (
                <p className="text-[9px] text-gray-400 mt-0.5">
                  ~{coreData.avgEnergy.toFixed(1)} kWh/session avg
                </p>
              )}
            </div>
            {fleetData.portfolioEffect !== 0 && (
              <div className="pt-2 border-t border-gray-100">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Portfolio Effect</p>
                <p className={`text-sm font-bold tabular-nums ${fleetData.portfolioEffect >= 0 ? 'text-emerald-600' : 'text-gray-500'}`}>
                  {fleetData.portfolioEffect > 0 ? '+' : ''}{fleetData.portfolioEffect.toFixed(1)}%
                  <span className="text-[10px] font-normal text-gray-400 ml-1">vs. single arrival</span>
                </p>
                <p className="text-[9px] text-gray-400 mt-0.5">
                  Diversification: {Math.round((1 - Math.exp(-fleetSize / 150)) * 100)}% realized
                </p>
              </div>
            )}
          </div>

          {/* Distributions: arrival + mileage */}
          <div className="md:col-span-2 space-y-4">
            {/* Arrival distribution — color gradient by hour */}
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">Arrival Distribution</p>
              <div className="space-y-1">
                {PLUGIN_TIME_DIST.map(({ hour, pct }) => {
                  const evCount = Math.round((pct / 100) * fleetSize)
                  const barPct = (pct / maxDistPct) * 100
                  return (
                    <div key={hour} className="flex items-center gap-2">
                      <span className="text-[10px] text-gray-500 tabular-nums w-10 text-right">{hour}:00</span>
                      <div className="flex-1 h-3.5 bg-gray-50 rounded overflow-hidden">
                        <div className="h-full rounded transition-all bg-[#313131]/20"
                          style={{ width: `${barPct}%` }} />
                      </div>
                      <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">{pct}%</span>
                      <span className="text-[10px] text-gray-500 tabular-nums w-16 text-right">{evCount.toLocaleString()} EVs</span>
                    </div>
                  )
                })}
              </div>
            </div>

            {/* Mileage distribution toggle + bars */}
            <div>
              <div className="flex items-center gap-2 mb-2">
                <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Mileage Distribution</p>
                <button
                  onClick={() => setDistributeMileage(!distributeMileage)}
                  className={`text-[9px] font-medium px-2 py-0.5 rounded-full border transition-colors ${
                    distributeMileage
                      ? 'bg-[#313131] text-white border-[#313131]'
                      : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                  }`}
                >
                  {distributeMileage ? 'Distributed' : 'Uniform'}
                </button>
                <span className="text-[9px] text-gray-400">
                  {distributeMileage ? 'Fleet uses KBA mileage mix' : `All EVs at ${yearlyMileageKm.toLocaleString()} km/yr`}
                </span>
              </div>
              {distributeMileage && (
                <div className="space-y-1">
                  {MILEAGE_DIST.map(({ pct, avgKm, label }) => {
                    const maxMilPct = Math.max(...MILEAGE_DIST.map(m => m.pct))
                    const barPct = (pct / maxMilPct) * 100
                    const eps = deriveEnergyPerSession(avgKm, weekdayPlugIns, weekendPlugIns)
                    return (
                      <div key={label} className="flex items-center gap-2">
                        <span className="text-[10px] text-gray-500 tabular-nums w-10 text-right">{label}</span>
                        <div className="flex-1 h-3.5 bg-gray-50 rounded overflow-hidden">
                          <div className="h-full rounded transition-all bg-gray-300"
                            style={{ width: `${barPct}%` }} />
                        </div>
                        <span className="text-[10px] text-gray-400 tabular-nums w-8 text-right">{pct}%</span>
                        <span className="text-[10px] text-gray-500 tabular-nums w-20 text-right">{eps.toFixed(1)} kWh</span>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
