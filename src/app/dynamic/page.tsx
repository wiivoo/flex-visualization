'use client'

import { useState, useMemo, useEffect, useCallback, useRef, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePrices } from '@/lib/use-prices'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { DateStrip } from '@/components/v2/DateStrip'
import {
  ComposedChart, Bar, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
} from 'recharts'
import {
  DEFAULT_SURCHARGES, VAT_RATE, endCustomerPrice, totalSurchargesNetto,
  calculateYearlyCost, getDailyEndPrices,
  type Surcharges, type MonthlyResult,
} from '@/lib/dynamic-tariff'
import { getDayType, LOAD_PROFILES, type LoadProfile } from '@/lib/slp-h25'
import { DynamicDailySavings } from '@/components/dynamic/DynamicDailySavings'

export default function DynamicPage() {
  return <Suspense><DynamicInner /></Suspense>
}

/* ────── Constants ────── */
const CONSUMPTION_PRESETS = [
  { label: '1 Person', kwh: 1500 },
  { label: '2 Persons', kwh: 2500 },
  { label: 'Family', kwh: 3500 },
  { label: 'Large Family', kwh: 5000 },
  { label: 'Heat Pump', kwh: 6000 },
]

const SURCHARGE_FIELDS: { key: keyof Surcharges; label: string; fixed?: boolean }[] = [
  { key: 'gridFee', label: 'Netzentgelte' },
  { key: 'stromsteuer', label: 'Stromsteuer', fixed: true },
  { key: 'konzessionsabgabe', label: 'Konzessionsabgabe' },
  { key: 'kwkg', label: 'KWKG-Umlage' },
  { key: 'offshore', label: 'Offshore-Netzumlage' },
  { key: 'par19', label: '§19 StromNEV-Umlage' },
  { key: 'margin', label: 'Supplier Margin' },
]

/* ────── Main Component ────── */
function DynamicInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // State from URL or defaults
  const [yearlyKwh, setYearlyKwh] = useState(() => {
    const v = Number(searchParams.get('kwh'))
    return v > 0 ? v : 3500
  })
  const [fixedPrice, setFixedPrice] = useState(() => {
    const v = Number(searchParams.get('fixed'))
    return v > 0 ? v : 32
  })
  const [selectedYear, setSelectedYear] = useState(() => {
    const v = Number(searchParams.get('year'))
    return v >= 2020 ? v : 2025
  })
  const [surcharges, setSurcharges] = useState<Surcharges>({ ...DEFAULT_SURCHARGES })
  const [showSurcharges, setShowSurcharges] = useState(false)
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('quarterhour')
  const [showRenewable, setShowRenewable] = useState(false)
  const [loadProfile, setLoadProfile] = useState<LoadProfile>('H25')

  const prices = usePrices('DE')
  const isQH = resolution === 'quarterhour'

  // Available years from price data
  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const p of prices.hourly) {
      const y = parseInt(p.date.slice(0, 4))
      if (y >= 2020) years.add(y)
    }
    return [...years].sort((a, b) => b - a)
  }, [prices.hourly])

  // Auto-select latest available year
  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0])
    }
  }, [availableYears, selectedYear])

  // Yearly cost calculation
  const yearlyResult = useMemo(() => {
    if (prices.hourly.length === 0) return null
    return calculateYearlyCost(yearlyKwh, prices.hourly, surcharges, fixedPrice, selectedYear, loadProfile)
  }, [yearlyKwh, prices.hourly, surcharges, fixedPrice, selectedYear, loadProfile])

  // All daily breakdowns across all years — reactive to fixed price
  const allDailyBreakdown = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const all: import('@/lib/dynamic-tariff').DailyResult[] = []
    for (const y of availableYears) {
      const result = calculateYearlyCost(yearlyKwh, prices.hourly, surcharges, fixedPrice, y, loadProfile)
      all.push(...result.dailyBreakdown)
    }
    // Sort by date ascending, take last 365
    all.sort((a, b) => a.date.localeCompare(b.date))
    return all.slice(-365)
  }, [prices.hourly, availableYears, yearlyKwh, surcharges, fixedPrice, loadProfile])

  // Per-date savings map for DateStrip coloring
  const dateSavingsMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of allDailyBreakdown) {
      m.set(d.date, d.fixedCostEur - d.dynamicCostEur)
    }
    return m
  }, [allDailyBreakdown])

  const dateStripColorFn = useCallback((date: string): string => {
    const savings = dateSavingsMap.get(date)
    if (savings === undefined) return 'bg-gray-200'
    if (savings > 0.02) return 'bg-emerald-400'   // dynamic clearly cheaper
    if (savings > 0) return 'bg-emerald-200'       // dynamic slightly cheaper
    if (savings > -0.02) return 'bg-orange-300'    // roughly equal / slightly more expensive
    return 'bg-red-400'                             // dynamic more expensive
  }, [dateSavingsMap])

  // Generation data for renewable overlay
  const generationForDate = useMemo(() => {
    if (!showRenewable || !prices.selectedDate || !prices.generation) return undefined
    const dayGen = prices.generation.filter((g: { hour: number; renewableShare: number; timestamp: number }) => {
      const d = new Date(g.timestamp)
      return d.toISOString().slice(0, 10) === prices.selectedDate
    })
    if (dayGen.length === 0) return undefined
    return dayGen.map((g: { hour: number; renewableShare: number }) => ({
      hour: g.hour,
      renewableShare: g.renewableShare,
    }))
  }, [showRenewable, prices.selectedDate, prices.generation])

  // Daily chart data for selected date (with green/red shading fields)
  const chartPrices = isQH && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
  const dailyChartData = useMemo(() => {
    if (chartPrices.length === 0 || !prices.selectedDate) return []
    const raw = getDailyEndPrices(chartPrices, prices.selectedDate, surcharges, yearlyKwh, isQH && prices.hourlyQH.length > 0, generationForDate, loadProfile)
    // Split into solid + forecast lines, add shading fields
    const mapped = raw.map((d, _i) => ({
      ...d,
      fixedPriceLine: fixedPrice,
      endPrice: d.isProjected ? null : d.endPriceCtKwh,
      endPriceForecast: d.isProjected ? d.endPriceCtKwh : null,
      spotPrice: d.isProjected ? null : d.spotCtKwh,
      spotForecast: d.isProjected ? d.spotCtKwh : null,
      greenBand: d.endPriceCtKwh < fixedPrice ? [d.endPriceCtKwh, fixedPrice] : [fixedPrice, fixedPrice],
      redBand: d.endPriceCtKwh > fixedPrice ? [fixedPrice, d.endPriceCtKwh] : [fixedPrice, fixedPrice],
    }))
    // Bridge: connect last real point to first forecast point
    const firstFcIdx = mapped.findIndex(d => d.isProjected)
    if (firstFcIdx > 0 && mapped[firstFcIdx - 1].endPrice !== null) {
      mapped[firstFcIdx - 1].endPriceForecast = mapped[firstFcIdx - 1].endPrice
      mapped[firstFcIdx - 1].spotForecast = mapped[firstFcIdx - 1].spotPrice
    }
    return mapped
  }, [chartPrices, prices.selectedDate, surcharges, yearlyKwh, isQH, prices.hourlyQH.length, generationForDate, fixedPrice, loadProfile])

  // Forecast detection
  const hasForecastData = dailyChartData.some(d => d.isProjected)
  const forecastStartIdx = hasForecastData ? dailyChartData.findIndex(d => d.isProjected) : -1

  // Daily totals for selected date
  const selectedDayTotals = useMemo(() => {
    if (dailyChartData.length === 0) return null
    const dynamicCost = dailyChartData.reduce((s, d) => s + d.costCent, 0) / 100
    const totalConsumption = dailyChartData.reduce((s, d) => s + d.consumptionKwh, 0)
    const fixedCost = totalConsumption * fixedPrice / 100
    const dayType = getDayType(prices.selectedDate)
    return {
      dynamicCostEur: dynamicCost,
      fixedCostEur: fixedCost,
      savingsEur: fixedCost - dynamicCost,
      consumptionKwh: totalConsumption,
      dayType,
    }
  }, [dailyChartData, fixedPrice, prices.selectedDate])

  // Monthly chart data — rolling 12 months ending at selected date
  const monthlyChartData = useMemo(() => {
    if (allDailyBreakdown.length === 0) return []
    // Determine end month from selected date or latest available
    const endDate = prices.selectedDate || allDailyBreakdown[allDailyBreakdown.length - 1]?.date
    if (!endDate) return []
    const endMonth = endDate.slice(0, 7) // YYYY-MM
    // Build 12 months ending at endMonth
    const endY = parseInt(endMonth.slice(0, 4))
    const endM = parseInt(endMonth.slice(5, 7))
    const months: string[] = []
    for (let i = 11; i >= 0; i--) {
      let m = endM - i
      let y = endY
      while (m <= 0) { m += 12; y-- }
      months.push(`${y}-${String(m).padStart(2, '0')}`)
    }
    // Aggregate daily data by month
    const monthMap = new Map<string, { dynamic: number; fixed: number; consumption: number; spotSum: number; endPriceSum: number; hours: number; days: number }>()
    for (const d of allDailyBreakdown) {
      const m = d.date.slice(0, 7)
      if (!months.includes(m)) continue
      const entry = monthMap.get(m) || { dynamic: 0, fixed: 0, consumption: 0, spotSum: 0, endPriceSum: 0, hours: 0, days: 0 }
      entry.dynamic += d.dynamicCostEur
      entry.fixed += d.fixedCostEur
      entry.consumption += d.consumptionKwh
      entry.spotSum += d.avgSpotCtKwh * d.hoursWithData
      entry.endPriceSum += d.avgEndPriceCtKwh * d.hoursWithData
      entry.hours += d.hoursWithData
      entry.days++
      monthMap.set(m, entry)
    }
    const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    let runSum = 0
    return months.filter(m => monthMap.has(m)).map(m => {
      const d = monthMap.get(m)!
      const savings = d.fixed - d.dynamic
      runSum += savings
      const mNum = parseInt(m.slice(5, 7))
      const mYear = parseInt(m.slice(0, 4))
      const label = LABELS[mNum - 1]
      return {
        month: m,
        label,
        displayLabel: label === 'Jan' ? `Jan '${String(mYear).slice(2)}` : label,
        year: mYear,
        savings,
        cumulative: Math.round(runSum * 10) / 10,
        daysWithData: d.days,
        avgSpotCtKwh: d.hours > 0 ? d.spotSum / d.hours : 0,
        avgEndPriceCtKwh: d.hours > 0 ? d.endPriceSum / d.hours : 0,
        dynamicCostEur: d.dynamic,
        fixedCostEur: d.fixed,
        consumptionKwh: d.consumption,
      }
    })
  }, [allDailyBreakdown, prices.selectedDate])

  // Yearly savings per available year (for yearly bar chart)
  const yearlySavingsData = useMemo(() => {
    if (prices.hourly.length === 0) return []
    return availableYears.map(y => {
      const result = calculateYearlyCost(yearlyKwh, prices.hourly, surcharges, fixedPrice, y, loadProfile)
      let cheaperDays = 0
      let expensiveDays = 0
      for (const d of result.dailyBreakdown) {
        if (d.dynamicCostEur < d.fixedCostEur) cheaperDays++
        else expensiveDays++
      }
      return {
        year: y,
        savings: result.savingsEur,
        dynamicCost: result.totalDynamicCostEur,
        fixedCost: result.totalFixedCostEur,
        avgDynamic: result.avgEffectivePriceCtKwh,
        daysWithData: result.daysWithData,
        kwhConsumed: result.totalKwhConsumed,
        cheaperDays,
        expensiveDays,
      }
    }).sort((a, b) => a.year - b.year)
  }, [prices.hourly, availableYears, yearlyKwh, surcharges, fixedPrice, loadProfile])

  // URL sync
  useEffect(() => {
    const p = new URLSearchParams()
    p.set('kwh', String(yearlyKwh))
    p.set('fixed', String(fixedPrice))
    p.set('year', String(selectedYear))
    if (prices.selectedDate) p.set('date', prices.selectedDate)
    router.replace(`/dynamic?${p.toString()}`, { scroll: false })
  }, [yearlyKwh, fixedPrice, selectedYear, prices.selectedDate]) // eslint-disable-line react-hooks/exhaustive-deps

  const surchargesTotal = totalSurchargesNetto(surcharges)
  const bruttoSurcharges = surchargesTotal * (1 + VAT_RATE / 100)

  // Format helpers
  const fmtEur = (n: number) => n.toFixed(2)
  const fmtCt = (n: number) => n.toFixed(2)
  const fmtPct = (n: number) => n.toFixed(1)

  // Draggable fixed price on chart
  const chartRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const yDomain = useMemo(() => {
    if (dailyChartData.length === 0) return [0, 60]
    const allPrices = dailyChartData.map(d => d.endPriceCtKwh)
    allPrices.push(fixedPrice)
    const max = Math.max(...allPrices)
    return [0, Math.ceil(max / 5) * 5 + 5]
  }, [dailyChartData, fixedPrice])

  const handleChartMouseDown = useCallback((e: React.MouseEvent) => {
    if (!chartRef.current) return
    const rect = chartRef.current.getBoundingClientRect()
    // Chart area: left margin ~50px, right margin ~40px, top ~10px, bottom ~40px
    const plotTop = 10
    const plotBottom = rect.height - 40
    const plotHeight = plotBottom - plotTop
    const mouseY = e.clientY - rect.top
    const priceFraction = 1 - (mouseY - plotTop) / plotHeight
    const priceAtMouse = yDomain[0] + priceFraction * (yDomain[1] - yDomain[0])
    // Only start drag if near the fixed price line (within 3 ct)
    if (Math.abs(priceAtMouse - fixedPrice) < 3) {
      dragging.current = true
      e.preventDefault()
    }
  }, [fixedPrice, yDomain])

  const handleChartMouseMove = useCallback((e: React.MouseEvent) => {
    if (!dragging.current || !chartRef.current) return
    const rect = chartRef.current.getBoundingClientRect()
    const plotTop = 10
    const plotBottom = rect.height - 40
    const plotHeight = plotBottom - plotTop
    const mouseY = e.clientY - rect.top
    const priceFraction = 1 - (mouseY - plotTop) / plotHeight
    const newPrice = yDomain[0] + priceFraction * (yDomain[1] - yDomain[0])
    setFixedPrice(Math.max(1, Math.min(80, Math.round(newPrice * 2) / 2)))
  }, [yDomain])

  const handleChartMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
          <h1 className="text-sm font-semibold text-gray-400">Flex Visualization — Dynamic Tariff Calculator</h1>
          <a href="/v2" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
            ← Charging View
          </a>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6">
        {/* Two-column layout */}
        <div className="flex gap-6">
          {/* ── Left Sidebar: Settings (single card, sticky) ── */}
          <div className="w-[300px] flex-shrink-0 sticky top-6 self-start">
            <Card className="shadow-sm border-gray-200/80">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-bold text-[#313131]">Settings</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Consumption */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Yearly Consumption</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      value={yearlyKwh}
                      onChange={e => setYearlyKwh(Math.max(100, Number(e.target.value) || 0))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm tabular-nums font-medium text-[#313131] focus:outline-none focus:ring-2 focus:ring-[#EA1C0A]/30"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">kWh/yr</span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {CONSUMPTION_PRESETS.map(p => (
                      <button
                        key={p.kwh}
                        onClick={() => setYearlyKwh(p.kwh)}
                        className={`text-[10px] font-semibold px-2 py-1 rounded-md border transition-colors ${
                          yearlyKwh === p.kwh
                            ? 'bg-[#EA1C0A] text-white border-[#EA1C0A]'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        {p.label} ({p.kwh.toLocaleString()})
                      </button>
                    ))}
                  </div>
                </div>

                {/* Fixed Price */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fixed Price Comparison</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="number"
                      step="0.5"
                      value={fixedPrice}
                      onChange={e => setFixedPrice(Math.max(0, Number(e.target.value) || 0))}
                      className="w-full rounded-lg border border-gray-200 px-3 py-1.5 text-sm tabular-nums font-medium text-[#313131] focus:outline-none focus:ring-2 focus:ring-[#EA1C0A]/30"
                    />
                    <span className="text-xs text-gray-500 whitespace-nowrap">ct/kWh</span>
                  </div>
                  <p className="text-[10px] text-gray-400">Gross price incl. all taxes & VAT</p>
                </div>

                {/* Load Profile */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Load Profile (BDEW)</p>
                  <div className="flex flex-col gap-1.5">
                    {LOAD_PROFILES.map(p => (
                      <button
                        key={p.id}
                        onClick={() => setLoadProfile(p.id)}
                        className={`text-left text-[11px] px-2.5 py-1.5 rounded-md border transition-colors ${
                          loadProfile === p.id
                            ? 'bg-[#EA1C0A] text-white border-[#EA1C0A]'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-semibold">{p.label}</span>
                        <span className={`ml-1.5 ${loadProfile === p.id ? 'text-white/80' : 'text-gray-400'}`}>{p.description}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* Surcharges */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <button onClick={() => setShowSurcharges(!showSurcharges)} className="w-full flex items-center justify-between">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Price Components</p>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${showSurcharges ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">Total surcharges (netto)</span>
                    <span className="font-semibold tabular-nums text-[#313131]">{fmtCt(surchargesTotal)} ct/kWh</span>
                  </div>
                  <div className="flex justify-between text-[11px]">
                    <span className="text-gray-500">+ 19% VAT</span>
                    <span className="font-semibold tabular-nums text-[#313131]">{fmtCt(bruttoSurcharges)} ct/kWh</span>
                  </div>

                  {showSurcharges && (
                    <div className="pt-2 border-t border-gray-100 space-y-2">
                      <p className="text-[10px] text-gray-400">endPrice = (spot + surcharges) x 1.19</p>
                      {SURCHARGE_FIELDS.map(f => (
                        <div key={f.key} className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-gray-600 flex-1">{f.label}</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number"
                              step="0.01"
                              value={surcharges[f.key]}
                              disabled={f.fixed}
                              onChange={e => {
                                const val = Number(e.target.value)
                                if (!isNaN(val)) setSurcharges(s => ({ ...s, [f.key]: val }))
                              }}
                              className={`w-16 rounded border px-1.5 py-0.5 text-[11px] tabular-nums text-right ${
                                f.fixed ? 'bg-gray-50 text-gray-400 border-gray-100' : 'border-gray-200 text-[#313131] focus:outline-none focus:ring-1 focus:ring-[#EA1C0A]/30'
                              }`}
                            />
                            <span className="text-[9px] text-gray-400">ct</span>
                          </div>
                        </div>
                      ))}
                      <button
                        onClick={() => setSurcharges({ ...DEFAULT_SURCHARGES })}
                        className="w-full text-[10px] text-gray-500 hover:text-[#EA1C0A] py-1 transition-colors"
                      >
                        Reset to 2025 defaults
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>
          </div>

          {/* ── Right Panel ── */}
          <div className="flex-1 min-w-0 space-y-4">
            {/* Date Strip */}
            {prices.daily.length > 0 && (
              <Card className="shadow-sm border-gray-200/80 overflow-hidden">
                <CardContent className="py-2 px-3">
                  <DateStrip
                    daily={prices.daily}
                    selectedDate={prices.selectedDate}
                    onSelect={prices.setSelectedDate}
                    requireNextDay={false}
                    colorFn={dateStripColorFn}
                    latestDate={prices.daily.length > 0 ? prices.daily[prices.daily.length - 1]?.date : undefined}
                    forecastAfter={prices.lastRealDate || undefined}
                    colorLegend={{ label: 'Dynamic saves', colors: ['bg-emerald-400', 'bg-red-400'] }}
                  />
                </CardContent>
              </Card>
            )}

            {/* Price Chart for selected day */}
            <Card className="shadow-sm border-gray-200/80">
              <CardHeader className="pb-2 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold text-[#313131]">
                      Day-Ahead Spot Price & Household Consumption — {prices.selectedDate || '...'}
                    </CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      Hourly electricity prices (EPEX Spot) with SLP {loadProfile} consumption profile
                      {selectedDayTotals && (
                        <> · {selectedDayTotals.dayType === 'WT' ? 'Workday' : selectedDayTotals.dayType === 'SA' ? 'Saturday' : 'Sunday/Holiday'} · {selectedDayTotals.consumptionKwh.toFixed(2)} kWh</>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1.5 bg-gray-100 rounded-full p-0.5">
                      <button onClick={() => setResolution('hour')}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'hour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                        60 min
                      </button>
                      <button onClick={() => setResolution('quarterhour')}
                        disabled={prices.hourlyQH.length === 0}
                        title={prices.hourlyQH.length === 0 ? 'No 15-min data available' : '15-minute resolution'}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'quarterhour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                        15 min
                      </button>
                    </div>
                    <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                      <button
                        onClick={() => setShowRenewable(v => !v)}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${showRenewable ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                        title="Toggle renewable generation overlay (solar + wind)"
                      >
                        {'\u2600\uFE0E'} Renew.
                      </button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="pt-4">
                {dailyChartData.length > 0 ? (
                  <div
                    ref={chartRef}
                    className="h-[320px] cursor-ns-resize select-none"
                    onMouseDown={handleChartMouseDown}
                    onMouseMove={handleChartMouseMove}
                    onMouseUp={handleChartMouseUp}
                    onMouseLeave={handleChartMouseUp}
                  >
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={dailyChartData} margin={{ top: 10, right: 40, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fontWeight: 500 }}
                          tickLine={false}
                          stroke="#9CA3AF"
                          interval={isQH ? 7 : 1}
                        />
                        <YAxis
                          yAxisId="price"
                          tick={{ fontSize: 11, fontWeight: 500 }}
                          stroke="#9CA3AF"
                          width={40}
                          domain={yDomain}
                          allowDecimals={false}
                        />
                        {showRenewable && (
                          <YAxis yAxisId="renew" orientation="right" domain={[0, 100]} hide />
                        )}
                        {!showRenewable && (
                          <YAxis
                            yAxisId="cost"
                            orientation="right"
                            tick={{ fontSize: 11, fontWeight: 500 }}
                            stroke="#9CA3AF"
                            width={45}
                            label={{ value: 'kWh', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }}
                          />
                        )}
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const d = payload[0].payload as (typeof dailyChartData)[number]
                            return (
                              <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] space-y-0.5">
                                <p className="text-gray-500 text-[10px]">{d.label}{isQH ? '' : ` – ${String(d.hour + 1).padStart(2, '0')}:00`}{d.isProjected && <span className="text-amber-600 ml-1">forecast</span>}</p>
                                <p className="tabular-nums"><span className="text-gray-500">Spot:</span> <span className="font-semibold text-blue-600">{d.spotCtKwh.toFixed(2)} ct/kWh</span></p>
                                <p className="tabular-nums"><span className="text-gray-500">End price:</span> <span className="font-semibold text-blue-600">{d.endPriceCtKwh.toFixed(2)} ct/kWh</span></p>
                                <p className="tabular-nums"><span className="text-gray-500">Consumption:</span> <span className="font-medium">{d.consumptionKwh.toFixed(4)} kWh</span></p>
                                <p className="tabular-nums"><span className="text-gray-500">Cost:</span> <span className="font-semibold text-emerald-600">{(d.costCent / 100).toFixed(4)} EUR</span></p>
                                {d.renewableShare != null && (
                                  <p className="tabular-nums"><span className="text-gray-500">Renewable:</span> <span className="font-medium text-emerald-600">{d.renewableShare.toFixed(0)}%</span></p>
                                )}
                              </div>
                            )
                          }}
                        />
                        <ReferenceLine
                          yAxisId="price"
                          y={fixedPrice}
                          stroke="#EA1C0A"
                          strokeDasharray="8 4"
                          strokeWidth={2}
                          label={{ value: `Fixed: ${fixedPrice} ct/kWh`, position: 'right', style: { fontSize: 11, fill: '#EA1C0A', fontWeight: 600 } }}
                        />
                        {showRenewable && (
                          <Area
                            yAxisId="renew"
                            dataKey="renewableShare"
                            type="monotone"
                            fill="#10B981"
                            fillOpacity={0.12}
                            stroke="#10B981"
                            strokeWidth={1}
                            strokeOpacity={0.4}
                            dot={false}
                            name="Renewable %"
                          />
                        )}
                        {/* Blue tint: dynamic below fixed (cheaper = good) */}
                        <Area
                          yAxisId="price"
                          dataKey="greenBand"
                          type="monotone"
                          fill="#3B82F6"
                          fillOpacity={0.15}
                          stroke="none"
                          isAnimationActive={false}
                        />
                        {/* Red tint: dynamic above fixed (more expensive) */}
                        <Area
                          yAxisId="price"
                          dataKey="redBand"
                          type="monotone"
                          fill="#EA1C0A"
                          fillOpacity={0.12}
                          stroke="none"
                          isAnimationActive={false}
                        />
                        {/* Solid spot line (real data only) */}
                        <Line
                          yAxisId="price"
                          dataKey="spotPrice"
                          type="monotone"
                          stroke="#D1D5DB"
                          strokeWidth={1.5}
                          dot={false}
                          activeDot={{ r: 3, fill: '#9CA3AF' }}
                          connectNulls={false}
                          name="Spot"
                        />
                        {/* Forecast spot — dashed grey */}
                        {hasForecastData && (
                          <Line
                            yAxisId="price"
                            dataKey="spotForecast"
                            type="monotone"
                            stroke="#D1D5DB"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            dot={false}
                            connectNulls={false}
                            name="Spot (forecast)"
                          />
                        )}
                        {/* Solid end-customer price (real data only) */}
                        <Line
                          yAxisId="price"
                          dataKey="endPrice"
                          type="monotone"
                          stroke="#3B82F6"
                          strokeWidth={2.5}
                          dot={isQH ? false : { r: 2, fill: '#3B82F6' }}
                          activeDot={{ r: 4 }}
                          connectNulls={false}
                          name="End Customer Price Dynamic"
                        />
                        {/* Forecast end-customer price — dashed amber */}
                        {hasForecastData && (
                          <Line
                            yAxisId="price"
                            dataKey="endPriceForecast"
                            type="monotone"
                            stroke="#D97706"
                            strokeWidth={2}
                            strokeDasharray="6 3"
                            dot={false}
                            connectNulls={false}
                            name="End Price (forecast)"
                          />
                        )}
                        {/* Forecast tint background */}
                        {forecastStartIdx >= 0 && (
                          <ReferenceArea
                            x1={forecastStartIdx}
                            x2={dailyChartData.length - 1}
                            yAxisId="price"
                            fill="#F59E0B"
                            fillOpacity={0.04}
                            stroke="none"
                          />
                        )}
                        {!showRenewable && (
                          <Bar
                            yAxisId="cost"
                            dataKey="consumptionKwh"
                            fill="#10B981"
                            fillOpacity={0.3}
                            radius={[2, 2, 0, 0]}
                            maxBarSize={isQH ? 8 : 20}
                            name="Consumption"
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <div className="h-[320px] flex items-center justify-center text-gray-400 text-sm">
                    {prices.loading ? 'Loading prices...' : 'No price data for this date'}
                  </div>
                )}
                {/* Legend */}
                <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="w-3 h-0.5 bg-gray-300 inline-block" /> Spot price
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#3B82F6' }} /> End customer price (dynamic)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-3 border-t-2 border-dashed border-[#EA1C0A] inline-block" /> Fixed price (draggable)
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 bg-blue-500 rounded-sm inline-block" style={{ opacity: 0.15 }} /> Dynamic cheaper
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="w-2.5 h-2.5 bg-[#EA1C0A] rounded-sm inline-block" style={{ opacity: 0.12 }} /> Dynamic more expensive
                  </span>
                  {showRenewable && (
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 bg-emerald-500 rounded-sm inline-block" style={{ opacity: 0.15 }} /> Renewable %
                    </span>
                  )}
                  {hasForecastData && (
                    <span className="flex items-center gap-1">
                      <svg className="inline -mt-px mr-0.5" width="16" height="2" viewBox="0 0 16 2"><line x1="0" y1="1" x2="16" y2="1" stroke="#D97706" strokeWidth="1.5" strokeDasharray="3 2"/></svg>
                      <span className="text-[10px] text-amber-600">Forecast</span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Daily Cost Breakdown — v2-style two-panel */}
            {selectedDayTotals && (() => {
              const dynamicAvgCt = selectedDayTotals.consumptionKwh > 0
                ? selectedDayTotals.dynamicCostEur / selectedDayTotals.consumptionKwh * 100
                : 0
              const savings = selectedDayTotals.savingsEur
              const savingsCt = fixedPrice - dynamicAvgCt
              return (
                <Card className="shadow-sm border-gray-200/80">
                  <CardHeader className="pb-3 border-b border-gray-100">
                    <CardTitle className="text-base font-bold text-[#313131]">Daily Cost Breakdown</CardTitle>
                    <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                      {prices.selectedDate} · {selectedDayTotals.dayType === 'WT' ? 'Workday' : selectedDayTotals.dayType === 'SA' ? 'Saturday' : 'Sunday/Holiday'} · {selectedDayTotals.consumptionKwh.toFixed(2)} kWh consumption
                    </p>
                  </CardHeader>
                  <CardContent className="pt-5 space-y-4">

                    {/* Two-panel comparison */}
                    <div className="grid grid-cols-2 gap-3">
                      {/* Fixed tariff panel */}
                      <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2.5">
                          Fixed Tariff
                        </p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[12px] leading-snug">
                            <span className="text-gray-500">Price</span>
                            <span className="tabular-nums font-semibold text-red-700">{fmtCt(fixedPrice)} ct/kWh</span>
                          </div>
                          <div className="flex justify-between text-[12px] leading-snug">
                            <span className="text-gray-500">Consumption</span>
                            <span className="tabular-nums font-medium text-gray-600">{selectedDayTotals.consumptionKwh.toFixed(2)} kWh</span>
                          </div>
                        </div>
                        <div className="border-t border-red-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
                          <span className="text-gray-500 font-medium">Daily cost</span>
                          <span className="font-bold text-red-700 tabular-nums">{fmtEur(selectedDayTotals.fixedCostEur)} EUR</span>
                        </div>
                      </div>

                      {/* Dynamic tariff panel */}
                      <div className="bg-blue-50/60 rounded-lg p-3 border border-blue-100/80">
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-2.5">
                          Dynamic Tariff · SLP {loadProfile}
                        </p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[12px] leading-snug">
                            <span className="text-gray-500">Avg price</span>
                            <span className="tabular-nums font-semibold text-blue-700">{fmtCt(dynamicAvgCt)} ct/kWh</span>
                          </div>
                          <div className="flex justify-between text-[12px] leading-snug">
                            <span className="text-gray-500">Consumption</span>
                            <span className="tabular-nums font-medium text-gray-600">{selectedDayTotals.consumptionKwh.toFixed(2)} kWh</span>
                          </div>
                        </div>
                        <div className="border-t border-blue-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
                          <span className="text-gray-500 font-medium">Daily cost</span>
                          <span className="font-bold text-blue-700 tabular-nums">{fmtEur(selectedDayTotals.dynamicCostEur)} EUR</span>
                        </div>
                      </div>
                    </div>

                    {/* Savings summary */}
                    <div className="border border-gray-200/60 rounded-lg overflow-hidden">
                      <div className="flex items-center justify-between bg-gray-50/80 px-3.5 py-2.5">
                        <span className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                          {savings >= 0 ? 'Dynamic saves' : 'Fixed saves'}
                        </span>
                        <div className="flex items-center gap-3">
                          <span className={`text-[11px] font-semibold tabular-nums ${savings >= 0 ? 'text-blue-600/70' : 'text-red-600/70'}`}>
                            {savingsCt >= 0 ? '+' : ''}{fmtCt(savingsCt)} ct/kWh
                          </span>
                          <span className={`text-sm font-bold tabular-nums ${savings >= 0 ? 'text-blue-700' : 'text-red-700'}`}>
                            {savings >= 0 ? '+' : ''}{fmtEur(savings)} EUR/day
                          </span>
                        </div>
                      </div>
                    </div>

                    <p className="text-[10px] text-gray-400 leading-relaxed">
                      Drag the dashed fixed-price line on the chart to adjust the comparison price.
                      Consumption weighted by BDEW {loadProfile} Standard Load Profile.
                    </p>
                  </CardContent>
                </Card>
              )
            })()}

          </div>
        </div>

        {/* ── Full-width sections below two-column layout ── */}

        {/* Daily Savings Heatmap — last 365 days */}
        {allDailyBreakdown.length > 0 && (
          <div className="mt-4">
            <DynamicDailySavings
              dailyBreakdown={allDailyBreakdown}
              selectedDate={prices.selectedDate}
              onSelect={prices.setSelectedDate}
              yearlyKwh={yearlyKwh}
              fixedPrice={fixedPrice}
            />
          </div>
        )}

        {/* Monthly Savings + Yearly Savings — v2-style cards side by side */}
        {(monthlyChartData.length > 0 || yearlySavingsData.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* Monthly Savings — bars + cumulative line (v2 style) */}
            <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Monthly Savings — Last 12 Months</CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  dynamic vs. fixed · {yearlyKwh.toLocaleString()} kWh/yr
                  {monthlyChartData.length > 0 && <> · {monthlyChartData[0]?.month} – {monthlyChartData[monthlyChartData.length - 1]?.month}</>}
                </p>
              </CardHeader>
              <CardContent className="pt-5 space-y-4 flex-1 flex flex-col">
                <div className="flex-1 min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyChartData} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                      <XAxis dataKey="displayLabel" tick={{ fontSize: 10, fontWeight: 500, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} />
                      <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        label={{ value: 'EUR/mo', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                      <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        label={{ value: 'EUR cumul.', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload as (typeof monthlyChartData)[number]
                          return (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                              <p className="text-gray-500 text-[10px]">{d.month} ({d.daysWithData} days)</p>
                              <p className={`font-semibold tabular-nums ${d.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.savings >= 0 ? '+' : ''}{d.savings.toFixed(2)} EUR/mo</p>
                              <p className="text-gray-400 tabular-nums text-[10px]">∑ {d.cumulative.toFixed(1)} EUR so far</p>
                              <p className="tabular-nums text-[10px]"><span className="text-gray-400">Avg spot: {d.avgSpotCtKwh.toFixed(2)} ct · End: {d.avgEndPriceCtKwh.toFixed(2)} ct</span></p>
                            </div>
                          )
                        }}
                      />
                      <Bar yAxisId="left" dataKey="savings" radius={[3, 3, 0, 0]} maxBarSize={28}
                        fill="#10B981" fillOpacity={0.7} />
                      <Line yAxisId="right" dataKey="cumulative" type="monotone"
                        stroke="#374151" strokeWidth={1.5} strokeDasharray="4 3"
                        dot={false} activeDot={{ r: 3, fill: '#374151' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center justify-between text-[10px] text-gray-500 flex-wrap gap-2">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm bg-emerald-500" style={{ opacity: 0.7 }} />
                    Monthly savings
                  </span>
                  <span className="flex items-center gap-1.5 text-gray-400">
                    <span className="inline-block w-6 border-t border-dashed border-gray-400" />
                    ∑ {monthlyChartData[monthlyChartData.length - 1]?.cumulative.toFixed(0) ?? 0} EUR (12 mo)
                  </span>
                </div>
              </CardContent>
            </Card>

            {/* Yearly Savings — horizontal bar chart per year */}
            <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Yearly Savings</CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  {yearlyKwh.toLocaleString()} kWh/yr · dynamic vs. {fixedPrice} ct/kWh fixed
                </p>
              </CardHeader>
              <CardContent className="pt-4 flex-1 flex flex-col justify-center space-y-3">
                {yearlySavingsData.map(d => {
                  const maxSavings = Math.max(...yearlySavingsData.map(y => Math.abs(y.savings)), 1)
                  const barPct = Math.max((Math.abs(d.savings) / maxSavings) * 100, 4)
                  const isCurrent = d.year === new Date().getFullYear()
                  const isPartial = d.daysWithData < 360
                  return (
                    <div key={d.year}>
                      <div className="flex items-baseline justify-between mb-1">
                        <span className={`text-[11px] font-semibold ${isCurrent ? 'text-[#313131]' : 'text-gray-400'}`}>
                          {d.year}{isPartial ? ' YTD' : ''}
                        </span>
                        <span className={`text-[12px] tabular-nums font-bold ${d.savings >= 0 ? (isCurrent ? 'text-emerald-700' : 'text-gray-500') : 'text-red-600'}`}>
                          {d.savings >= 0 ? '+' : ''}{'\u20AC'}{Math.round(d.savings)}
                        </span>
                      </div>
                      <div className="relative w-full h-3 bg-gray-100 rounded-full overflow-hidden">
                        <div
                          className={`relative h-full rounded-full transition-all ${d.savings >= 0 ? (isCurrent ? 'bg-emerald-500' : 'bg-emerald-300') : 'bg-red-400'}`}
                          style={{ width: `${barPct}%`, opacity: isCurrent ? 0.85 : 0.45 }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-[9px] text-gray-400 mt-0.5 tabular-nums">
                        <span>{d.daysWithData} days · {d.kwhConsumed.toFixed(0)} kWh</span>
                        <span>
                          <span className="text-emerald-500">{d.cheaperDays}d cheaper</span>
                          {' · '}
                          <span className="text-red-400">{d.expensiveDays}d more expensive</span>
                        </span>
                      </div>
                    </div>
                  )
                })}
              </CardContent>
            </Card>
          </div>
        )}
      </main>
    </div>
  )
}
