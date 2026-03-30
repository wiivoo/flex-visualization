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
  DEFAULT_SURCHARGES, surchargesForYear, VAT_RATE, endCustomerPrice, totalSurchargesNetto,
  calculateYearlyCost, getDailyEndPrices,
  type Surcharges, type MonthlyResult,
} from '@/lib/dynamic-tariff'
import { getDayType, LOAD_PROFILES, type LoadProfile } from '@/lib/slp-h25'
import { DynamicDailySavings } from '@/components/dynamic/DynamicDailySavings'
import { MonthlyPriceTrend } from '@/components/dynamic/MonthlyPriceTrend'

export default function DynamicPage() {
  return <Suspense><DynamicInner /></Suspense>
}

/* ────── Constants ────── */
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
  const [surcharges, setSurcharges] = useState<Surcharges>(() => surchargesForYear(Number(searchParams.get('year')) >= 2020 ? Number(searchParams.get('year')) : 2025))
  const [showSurcharges, setShowSurcharges] = useState(false)
  const [plz, setPlz] = useState(() => searchParams.get('plz') || '')
  const [plzLocation, setPlzLocation] = useState('')
  const [plzLoading, setPlzLoading] = useState(false)
  const [plzSupplier, setPlzSupplier] = useState('')
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('quarterhour')
  const [showRenewable, setShowRenewable] = useState(false)
  const [standingCharge, setStandingCharge] = useState(() => {
    const v = Number(searchParams.get('grundpreis'))
    return v >= 0 ? v : 0
  })
  const [showCheaperBand, setShowCheaperBand] = useState(true)
  const [showExpensiveBand, setShowExpensiveBand] = useState(true)
  const [showMonthlyTable, setShowMonthlyTable] = useState(false)
  const [chartMode, setChartMode] = useState<'price' | 'cost'>('price')
  const [loadProfile, setLoadProfileRaw] = useState<LoadProfile>('H25')
  const setLoadProfile = useCallback((p: LoadProfile) => {
    // Auto-adjust kWh proportionally when switching profiles
    const ratios: Record<string, number> = { H25: 1, P25: 0.7, S25: 0.4 }
    const oldRatio = ratios[loadProfile] ?? 1
    const newRatio = ratios[p] ?? 1
    if (oldRatio !== newRatio) {
      setYearlyKwh(prev => Math.round(prev * newRatio / oldRatio / 100) * 100)
    }
    setLoadProfileRaw(p)
  }, [loadProfile])

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

  // Fetch regional tariff components when PLZ is entered
  useEffect(() => {
    if (!/^\d{5}$/.test(plz)) {
      setPlzLocation('')
      setPlzSupplier('')
      return
    }
    setPlzLoading(true)
    fetch(`/api/tariff-components?plz=${plz}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setPlzLocation(data.location || '')
        setPlzSupplier(data.defaultSupplier || '')
        // Apply regional grid fee and taxes breakdown
        // The taxes bundle includes a ~2.15 ct supplier margin — subtract it
        // so we don't double-count with our own margin field
        const SUPPLIER_MARKUP_IN_TAXES = 2.15
        setSurcharges(prev => ({
          ...prev,
          gridFee: data.gridFeeNetto,
          // Derive regional Konzessionsabgabe from the taxes total
          // taxes = stromsteuer + kwkg + offshore + par19 + konzessionsabgabe + supplier_markup
          konzessionsabgabe: Math.max(0,
            data.taxesNetto - SUPPLIER_MARKUP_IN_TAXES - prev.stromsteuer - prev.kwkg - prev.offshore - prev.par19
          ),
        }))
      })
      .catch(() => {})
      .finally(() => setPlzLoading(false))
  }, [plz]) // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-select today on initial load (dynamic page shows current date)
  const initialDateSet = useRef(false)
  useEffect(() => {
    if (initialDateSet.current || prices.daily.length === 0) return
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayEntry = prices.daily.find(d => d.date === today)
      ?? prices.daily.filter(d => d.date <= today).pop()
    if (todayEntry) {
      prices.setSelectedDate(todayEntry.date)
      initialDateSet.current = true
    }
  }, [prices.daily]) // eslint-disable-line react-hooks/exhaustive-deps

  // Yearly cost calculation
  const yearlyResult = useMemo(() => {
    if (prices.hourly.length === 0) return null
    return calculateYearlyCost(yearlyKwh, prices.hourly, surcharges, fixedPrice, selectedYear, loadProfile)
  }, [yearlyKwh, prices.hourly, surcharges, fixedPrice, selectedYear, loadProfile])

  // All daily breakdowns across all years
  const allDailyBreakdownFull = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const all: import('@/lib/dynamic-tariff').DailyResult[] = []
    for (const y of availableYears) {
      const result = calculateYearlyCost(yearlyKwh, prices.hourly, surcharges, fixedPrice, y, loadProfile)
      all.push(...result.dailyBreakdown)
    }
    all.sort((a, b) => a.date.localeCompare(b.date))
    return all
  }, [prices.hourly, availableYears, yearlyKwh, surcharges, fixedPrice, loadProfile])

  // 365 days ending at selected date — for heatmap
  const allDailyBreakdown = useMemo(() => {
    const endDate = prices.selectedDate
    const filtered = allDailyBreakdownFull.filter(d => d.date <= endDate)
    return filtered.slice(-365)
  }, [allDailyBreakdownFull, prices.selectedDate])

  // Per-date savings map for DateStrip coloring — uses ALL dates
  const dateSavingsMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of allDailyBreakdownFull) {
      const daysInMo = new Date(parseInt(d.date.slice(0, 4)), parseInt(d.date.slice(5, 7)), 0).getDate()
      m.set(d.date, d.fixedCostEur + standingCharge / 12 / daysInMo - d.dynamicCostEur)
    }
    return m
  }, [allDailyBreakdownFull, standingCharge])

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
    const mapped = raw.map((d, _i) => {
      const fixedCostCent = d.consumptionKwh * fixedPrice
      return {
        ...d,
        fixedPriceLine: fixedPrice,
        endPrice: d.isProjected ? null : d.endPriceCtKwh,
        endPriceForecast: d.isProjected ? d.endPriceCtKwh : null,
        spotPrice: d.isProjected ? null : d.spotCtKwh,
        spotForecast: d.isProjected ? d.spotCtKwh : null,
        greenBand: d.endPriceCtKwh < fixedPrice ? [d.endPriceCtKwh, fixedPrice] : [fixedPrice, fixedPrice],
        redBand: d.endPriceCtKwh > fixedPrice ? [fixedPrice, d.endPriceCtKwh] : [fixedPrice, fixedPrice],
        // Cost mode fields (cent)
        dynamicCost: d.isProjected ? null : d.costCent,
        dynamicCostForecast: d.isProjected ? d.costCent : null,
        fixedCostCent,
        costGreenBand: d.costCent < fixedCostCent ? [d.costCent, fixedCostCent] : [fixedCostCent, fixedCostCent],
        costRedBand: d.costCent > fixedCostCent ? [fixedCostCent, d.costCent] : [fixedCostCent, fixedCostCent],
      }
    })
    // Bridge: connect last real point to first forecast point
    const firstFcIdx = mapped.findIndex(d => d.isProjected)
    if (firstFcIdx > 0 && mapped[firstFcIdx - 1].endPrice !== null) {
      mapped[firstFcIdx - 1].endPriceForecast = mapped[firstFcIdx - 1].endPrice
      mapped[firstFcIdx - 1].spotForecast = mapped[firstFcIdx - 1].spotPrice
      mapped[firstFcIdx - 1].dynamicCostForecast = mapped[firstFcIdx - 1].dynamicCost
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
    // Add standing charge pro-rated per day
    const daysInMonth = prices.selectedDate ? new Date(
      parseInt(prices.selectedDate.slice(0, 4)),
      parseInt(prices.selectedDate.slice(5, 7)), 0
    ).getDate() : 30
    const fixedCost = totalConsumption * fixedPrice / 100 + standingCharge / 12 / daysInMonth
    const dayType = getDayType(prices.selectedDate)
    const expectedSlots = isQH ? 96 : 24
    return {
      dynamicCostEur: dynamicCost,
      fixedCostEur: fixedCost,
      savingsEur: fixedCost - dynamicCost,
      consumptionKwh: totalConsumption,
      dayType,
      isPartial: dailyChartData.length < expectedSlots,
      slotsAvailable: dailyChartData.length,
      slotsExpected: expectedSlots,
    }
  }, [dailyChartData, fixedPrice, prices.selectedDate, isQH, standingCharge])

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
    const monthMap = new Map<string, { dynamic: number; fixed: number; consumption: number; spotSum: number; endPriceSum: number; kwhSum: number; days: number }>()
    for (const d of allDailyBreakdown) {
      const m = d.date.slice(0, 7)
      if (!months.includes(m)) continue
      const entry = monthMap.get(m) || { dynamic: 0, fixed: 0, consumption: 0, spotSum: 0, endPriceSum: 0, kwhSum: 0, days: 0 }
      entry.dynamic += d.dynamicCostEur
      entry.fixed += d.fixedCostEur
      entry.consumption += d.consumptionKwh
      entry.spotSum += d.avgSpotCtKwh * d.consumptionKwh
      entry.endPriceSum += d.dynamicCostEur
      entry.kwhSum += d.consumptionKwh
      entry.days++
      monthMap.set(m, entry)
    }
    const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    let runSum = 0
    return months.filter(m => monthMap.has(m)).map(m => {
      const d = monthMap.get(m)!
      const fixedWithStanding = d.fixed + standingCharge / 12
      const savings = fixedWithStanding - d.dynamic
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
        avgSpotCtKwh: d.kwhSum > 0 ? d.spotSum / d.kwhSum : 0,
        avgEndPriceCtKwh: d.kwhSum > 0 ? (d.endPriceSum / d.kwhSum) * 100 : 0,
        dynamicCostEur: d.dynamic,
        fixedCostEur: fixedWithStanding,
        consumptionKwh: d.consumption,
      }
    })
  }, [allDailyBreakdown, prices.selectedDate, standingCharge])

  // Yearly savings per available year (for yearly bar chart)
  const yearlySavingsData = useMemo(() => {
    if (prices.hourly.length === 0) return []
    return availableYears.map(y => {
      const result = calculateYearlyCost(yearlyKwh, prices.hourly, surcharges, fixedPrice, y, loadProfile)
      // Add standing charge: pro-rate by months with data
      const monthsWithData = result.monthlyBreakdown.length
      const standingTotal = standingCharge / 12 * monthsWithData
      let cheaperDays = 0
      let expensiveDays = 0
      for (const d of result.dailyBreakdown) {
        // Per-day standing charge share
        const daysInMo = new Date(parseInt(d.date.slice(0, 4)), parseInt(d.date.slice(5, 7)), 0).getDate()
        const dayFixed = d.fixedCostEur + standingCharge / 12 / daysInMo
        if (d.dynamicCostEur < dayFixed) cheaperDays++
        else expensiveDays++
      }
      return {
        year: y,
        savings: result.savingsEur + standingTotal,
        dynamicCost: result.totalDynamicCostEur,
        fixedCost: result.totalFixedCostEur + standingTotal,
        avgDynamic: result.avgEffectivePriceCtKwh,
        daysWithData: result.daysWithData,
        kwhConsumed: result.totalKwhConsumed,
        cheaperDays,
        expensiveDays,
      }
    }).sort((a, b) => a.year - b.year)
  }, [prices.hourly, availableYears, yearlyKwh, surcharges, fixedPrice, loadProfile, standingCharge])

  // URL sync
  useEffect(() => {
    const p = new URLSearchParams()
    p.set('kwh', String(yearlyKwh))
    p.set('fixed', String(fixedPrice))
    p.set('year', String(selectedYear))
    if (prices.selectedDate) p.set('date', prices.selectedDate)
    if (plz.length === 5) p.set('plz', plz)
    if (standingCharge > 0) p.set('grundpreis', String(standingCharge))
    router.replace(`/dynamic?${p.toString()}`, { scroll: false })
  }, [yearlyKwh, fixedPrice, selectedYear, prices.selectedDate, plz, standingCharge]) // eslint-disable-line react-hooks/exhaustive-deps

  const surchargesTotal = totalSurchargesNetto(surcharges)
  const bruttoSurcharges = surchargesTotal * (1 + VAT_RATE / 100)

  // Format helpers
  const fmtEur = (n: number) => n.toFixed(2)
  const fmtCt = (n: number) => n.toFixed(2)
  const fmtPct = (n: number) => n.toFixed(1)

  // Edge-scroll: press & hold left/right to scrub through days (v2-style)
  const sortedDates = useMemo(() => prices.daily.map(d => d.date), [prices.daily])
  const sortedDatesRef = useRef(sortedDates)
  sortedDatesRef.current = sortedDates
  const selectedDateRef = useRef(prices.selectedDate)
  selectedDateRef.current = prices.selectedDate
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const startEdgeScroll = useCallback((dir: -1 | 1) => {
    const step = () => {
      const idx = sortedDatesRef.current.indexOf(selectedDateRef.current)
      if (idx < 0) return
      const next = sortedDatesRef.current[idx + dir]
      if (next) prices.setSelectedDate(next)
    }
    step()
    let speed = 400
    const tick = () => {
      step()
      speed = Math.max(120, speed * 0.85)
      scrollTimerRef.current = setTimeout(tick, speed)
    }
    scrollTimerRef.current = setTimeout(tick, speed)
  }, [prices.setSelectedDate])

  const stopEdgeScroll = useCallback(() => {
    if (scrollTimerRef.current) { clearTimeout(scrollTimerRef.current); scrollTimerRef.current = null }
  }, [])

  useEffect(() => () => stopEdgeScroll(), [stopEdgeScroll])

  // Draggable fixed price on chart
  const chartRef = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const yDomain = useMemo(() => {
    if (dailyChartData.length === 0) return [0, 60]
    if (chartMode === 'cost') {
      const allCosts = dailyChartData.map(d => Math.max(d.costCent, d.fixedCostCent))
      const max = Math.max(...allCosts)
      const step = max > 5 ? 2 : 0.5
      return [0, Math.ceil(max / step) * step + step]
    }
    const allPrices = dailyChartData.map(d => d.endPriceCtKwh)
    allPrices.push(fixedPrice)
    const max = Math.max(...allPrices)
    return [0, Math.ceil(max / 5) * 5 + 5]
  }, [dailyChartData, fixedPrice, chartMode])

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
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">
                      {loadProfile === 'H25' ? 'Yearly Consumption' : 'Yearly Grid Consumption'}
                    </p>
                    <span className="text-sm font-bold tabular-nums text-[#313131]">{yearlyKwh.toLocaleString()} kWh</span>
                  </div>
                  <input
                    type="range"
                    min={0}
                    max={10000}
                    step={100}
                    value={yearlyKwh}
                    onChange={e => setYearlyKwh(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                  />
                  {loadProfile !== 'H25' && (
                    <p className="text-[9px] text-gray-400">
                      Net grid draw after {loadProfile === 'P25' ? 'PV self-consumption (~30%)' : 'PV + battery self-consumption (~60%)'}
                    </p>
                  )}
                </div>

                {/* Fixed Price */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Fixed Price Comparison</p>
                    <span className="text-sm font-bold tabular-nums text-[#313131]">{fixedPrice} ct/kWh</span>
                  </div>
                  <input
                    type="range"
                    min={20}
                    max={45}
                    step={0.5}
                    value={fixedPrice}
                    onChange={e => setFixedPrice(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                  />
                  <p className="text-[9px] text-gray-400">Gross price incl. all taxes & VAT · drag chart line to adjust</p>
                  {/* Standing charge (Grundpreis) — EUR/year */}
                  <div className="space-y-1.5 pt-2 border-t border-gray-50">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-gray-500">Standing charge</span>
                      <span className="text-sm font-bold tabular-nums text-[#313131]">{standingCharge} EUR/yr</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={240}
                      step={6}
                      value={standingCharge}
                      onChange={e => setStandingCharge(Number(e.target.value))}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                    />
                    {standingCharge > 0 && (
                      <p className="text-[9px] text-gray-400">
                        = {(standingCharge / 12).toFixed(2)} EUR/mo · added to fixed tariff only
                      </p>
                    )}
                  </div>
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
                            ? 'bg-gray-500 text-white border-gray-500'
                            : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                        }`}
                      >
                        <span className="font-semibold">{p.description}</span>
                        <span className={`ml-1.5 ${loadProfile === p.id ? 'text-white/70' : 'text-gray-400'}`}>{p.label}</span>
                      </button>
                    ))}
                  </div>
                </div>

                {/* PLZ — regional tariff lookup */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Postal Code (PLZ)</p>
                  <div className="flex items-center gap-2">
                    <input
                      type="tel"
                      inputMode="numeric"
                      maxLength={5}
                      placeholder="e.g. 10115"
                      value={plz}
                      onChange={e => setPlz(e.target.value.replace(/\D/g, '').slice(0, 5))}
                      className="w-20 rounded border border-gray-200 px-2 py-1 text-[12px] tabular-nums text-[#313131] focus:outline-none focus:ring-1 focus:ring-[#EA1C0A]/30"
                    />
                    {plzLoading && <span className="text-[10px] text-gray-400">Loading...</span>}
                    {plzLocation && !plzLoading && (
                      <span className="text-[11px] text-gray-600 font-medium truncate">{plzLocation}</span>
                    )}
                  </div>
                  {plzLocation && plzSupplier && (
                    <p className="text-[9px] text-gray-400">
                      Regional grid fee applied ({plzSupplier} area)
                    </p>
                  )}
                  {!plz && (
                    <p className="text-[9px] text-gray-400">
                      Enter PLZ for regional grid fees. Default: national avg.
                    </p>
                  )}
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
                        onClick={() => setSurcharges(surchargesForYear(selectedYear))}
                        className="w-full text-[10px] text-gray-500 hover:text-[#EA1C0A] py-1 transition-colors"
                      >
                        Reset to {selectedYear} defaults
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
                <CardContent className="py-2 px-1">
                  <DateStrip
                    daily={prices.daily}
                    selectedDate={prices.selectedDate}
                    onSelect={prices.setSelectedDate}
                    requireNextDay={false}
                    colorFn={dateStripColorFn}
                    latestDate={(() => {
                      const now = new Date()
                      return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
                    })()}
                    forecastAfter={prices.lastRealDate || undefined}
                    colorLegend={{ label: 'Savings', colors: ['bg-emerald-400', 'bg-red-400'] }}
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
                      {chartMode === 'cost' ? `Hourly Cost (${loadProfile})` : 'Day-Ahead Spot Price & Household Consumption'} — {prices.selectedDate || '...'}
                    </CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {chartMode === 'cost' ? `Profile-weighted cost per hour (cent) · SLP ${loadProfile}` : `Hourly electricity prices (EPEX Spot) with SLP ${loadProfile} consumption profile`}
                      {selectedDayTotals && (
                        <>
                          {' · '}{selectedDayTotals.dayType === 'WT' ? 'Workday' : selectedDayTotals.dayType === 'SA' ? 'Saturday' : 'Sunday/Holiday'}
                          {' · '}{selectedDayTotals.consumptionKwh.toFixed(2)} kWh
                          {selectedDayTotals.isPartial && (
                            <span className="text-amber-500 ml-1">· partial ({selectedDayTotals.slotsAvailable}/{selectedDayTotals.slotsExpected} slots)</span>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {/* Price / Cost toggle */}
                    <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                      <button onClick={() => setChartMode('price')}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${chartMode === 'price' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                        Price
                      </button>
                      <button onClick={() => setChartMode('cost')}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${chartMode === 'cost' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                        Cost
                      </button>
                    </div>
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
                    className={`relative h-[320px] select-none ${chartMode === 'price' ? 'cursor-ns-resize' : ''}`}
                    onMouseDown={chartMode === 'price' ? handleChartMouseDown : undefined}
                    onMouseMove={chartMode === 'price' ? handleChartMouseMove : undefined}
                    onMouseUp={chartMode === 'price' ? handleChartMouseUp : undefined}
                    onMouseLeave={chartMode === 'price' ? handleChartMouseUp : undefined}
                  >
                    {/* Summary pill overlay — top-left inside chart */}
                    {selectedDayTotals && selectedDayTotals.consumptionKwh > 0 && (() => {
                      const dynamicAvg = selectedDayTotals.dynamicCostEur / selectedDayTotals.consumptionKwh * 100
                      const diffCt = fixedPrice - dynamicAvg
                      const diffEur = selectedDayTotals.savingsEur
                      const isCheaper = diffCt > 0
                      return (
                        <div className="absolute left-14 top-1 z-20 pointer-events-none flex items-center gap-1.5">
                          {chartMode === 'price' ? (
                            <div className={`backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5 ${isCheaper ? 'bg-emerald-50/80 border-emerald-300/50' : 'bg-red-50/80 border-red-300/50'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCheaper ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${isCheaper ? 'text-emerald-700' : 'text-red-700'}`}>
                                {isCheaper ? '▼' : '▲'} {Math.abs(diffCt).toFixed(1)} ct/kWh
                              </span>
                              <span className={`text-[9px] font-semibold tabular-nums whitespace-nowrap ${isCheaper ? 'text-emerald-600' : 'text-red-600'}`}>
                                dynamic {isCheaper ? 'cheaper' : 'more expensive'}
                              </span>
                            </div>
                          ) : (
                            <div className={`backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5 ${isCheaper ? 'bg-emerald-50/80 border-emerald-300/50' : 'bg-red-50/80 border-red-300/50'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCheaper ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${isCheaper ? 'text-emerald-700' : 'text-red-700'}`}>
                                {isCheaper ? '+' : ''}{diffEur.toFixed(2)} EUR
                              </span>
                              <span className={`text-[9px] font-semibold tabular-nums whitespace-nowrap ${isCheaper ? 'text-emerald-600' : 'text-red-600'}`}>
                                {isCheaper ? 'saved today' : 'extra cost today'}
                              </span>
                            </div>
                          )}
                          <span className="text-[9px] text-gray-400 tabular-nums">
                            {dynamicAvg.toFixed(1)} vs {fixedPrice.toFixed(1)} ct/kWh
                          </span>
                        </div>
                      )
                    })()}
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={dailyChartData} margin={{ top: 36, right: 40, bottom: 20, left: 10 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis
                          dataKey="label"
                          tick={{ fontSize: 11, fontWeight: 500 }}
                          tickLine={{ stroke: '#D1D5DB', strokeWidth: 1 }}
                          tickSize={6}
                          stroke="#9CA3AF"
                          interval={isQH ? 7 : 1}
                        />
                        <YAxis
                          yAxisId="price"
                          tick={{ fontSize: 11, fontWeight: 500 }}
                          stroke="#9CA3AF"
                          width={40}
                          domain={yDomain}
                          allowDecimals={chartMode === 'cost'}
                          label={chartMode === 'cost' ? { value: 'cent', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } } : undefined}
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
                              <div className="bg-white/95 backdrop-blur-sm rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] space-y-0.5">
                                <p className="text-gray-500 text-[10px]">{d.label}{isQH ? '' : ` – ${String(d.hour + 1).padStart(2, '0')}:00`}{d.isProjected && <span className="text-amber-600 ml-1">forecast</span>}</p>
                                {chartMode === 'price' ? (
                                  <>
                                    <p className="tabular-nums"><span className="text-gray-500">Spot:</span> <span className="font-semibold text-blue-600">{d.spotCtKwh.toFixed(2)} ct/kWh</span></p>
                                    <p className="tabular-nums"><span className="text-gray-500">End price:</span> <span className="font-semibold text-blue-600">{d.endPriceCtKwh.toFixed(2)} ct/kWh</span></p>
                                    <p className="tabular-nums"><span className="text-gray-500">Consumption:</span> <span className="font-medium">{d.consumptionKwh.toFixed(4)} kWh</span></p>
                                    <p className="tabular-nums"><span className="text-gray-500">Cost:</span> <span className="font-semibold text-emerald-600">{(d.costCent / 100).toFixed(4)} EUR</span></p>
                                  </>
                                ) : (
                                  <>
                                    <p className="tabular-nums"><span className="text-gray-500">Dynamic:</span> <span className="font-semibold text-blue-600">{d.costCent.toFixed(3)} ct</span></p>
                                    <p className="tabular-nums"><span className="text-gray-500">Fixed:</span> <span className="font-semibold text-red-600">{d.fixedCostCent.toFixed(3)} ct</span></p>
                                    <p className="tabular-nums"><span className="text-gray-500">Diff:</span> <span className={`font-semibold ${d.fixedCostCent - d.costCent >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{(d.fixedCostCent - d.costCent) >= 0 ? '+' : ''}{(d.fixedCostCent - d.costCent).toFixed(3)} ct</span></p>
                                    <p className="tabular-nums"><span className="text-gray-500">Consumption:</span> <span className="font-medium">{d.consumptionKwh.toFixed(4)} kWh</span></p>
                                  </>
                                )}
                                {d.renewableShare != null && (
                                  <p className="tabular-nums"><span className="text-gray-500">Renewable:</span> <span className="font-medium text-emerald-600">{d.renewableShare.toFixed(0)}%</span></p>
                                )}
                              </div>
                            )
                          }}
                        />
                        {/* === Price mode === */}
                        {chartMode === 'price' && (
                          <ReferenceLine
                            yAxisId="price"
                            y={fixedPrice}
                            stroke="#EA1C0A"
                            strokeDasharray="8 4"
                            strokeWidth={2}
                            label={{ value: `↕ Fixed: ${fixedPrice} ct/kWh`, position: 'insideLeft', dy: -9, style: { fontSize: 11, fill: '#EA1C0A', fontWeight: 600, cursor: 'ns-resize' } }}
                          />
                        )}
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
                        {chartMode === 'price' && showCheaperBand && (
                          <Area
                            yAxisId="price"
                            dataKey="greenBand"
                            type="monotone"
                            fill="#2563EB"
                            fillOpacity={0.12}
                            stroke="none"
                            isAnimationActive={false}
                          />
                        )}
                        {chartMode === 'price' && showExpensiveBand && (
                          <Area
                            yAxisId="price"
                            dataKey="redBand"
                            type="monotone"
                            fill="#EA1C0A"
                            fillOpacity={0.10}
                            stroke="none"
                            isAnimationActive={false}
                          />
                        )}
                        {chartMode === 'price' && (
                          <Line
                            yAxisId="price"
                            dataKey="spotPrice"
                            type="monotone"
                            stroke="#94A3B8"
                            strokeWidth={1.5}
                            dot={false}
                            activeDot={{ r: 3, fill: '#64748B' }}
                            connectNulls={false}
                            name="Spot"
                          />
                        )}
                        {chartMode === 'price' && hasForecastData && (
                          <Line
                            yAxisId="price"
                            dataKey="spotForecast"
                            type="monotone"
                            stroke="#94A3B8"
                            strokeWidth={1.5}
                            strokeDasharray="6 3"
                            dot={false}
                            connectNulls={false}
                            name="Spot (forecast)"
                          />
                        )}
                        {chartMode === 'price' && (
                          <Line
                            yAxisId="price"
                            dataKey="endPrice"
                            type="monotone"
                            stroke="#2563EB"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 4, fill: '#2563EB', stroke: '#fff', strokeWidth: 1.5 }}
                            connectNulls={false}
                            name="End Customer Price Dynamic"
                          />
                        )}
                        {chartMode === 'price' && hasForecastData && (
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
                        {/* === Cost mode === */}
                        {chartMode === 'cost' && (
                          <Line
                            yAxisId="price"
                            dataKey="fixedCostCent"
                            type="monotone"
                            stroke="#EA1C0A"
                            strokeDasharray="8 4"
                            strokeWidth={2}
                            dot={false}
                            name="Fixed cost"
                          />
                        )}
                        {chartMode === 'cost' && showCheaperBand && (
                          <Area
                            yAxisId="price"
                            dataKey="costGreenBand"
                            type="monotone"
                            fill="#2563EB"
                            fillOpacity={0.12}
                            stroke="none"
                            isAnimationActive={false}
                          />
                        )}
                        {chartMode === 'cost' && showExpensiveBand && (
                          <Area
                            yAxisId="price"
                            dataKey="costRedBand"
                            type="monotone"
                            fill="#EA1C0A"
                            fillOpacity={0.10}
                            stroke="none"
                            isAnimationActive={false}
                          />
                        )}
                        {chartMode === 'cost' && (
                          <Line
                            yAxisId="price"
                            dataKey="dynamicCost"
                            type="monotone"
                            stroke="#2563EB"
                            strokeWidth={2.5}
                            dot={false}
                            activeDot={{ r: 4, fill: '#2563EB', stroke: '#fff', strokeWidth: 1.5 }}
                            connectNulls={false}
                            name="Dynamic cost"
                          />
                        )}
                        {chartMode === 'cost' && hasForecastData && (
                          <Line
                            yAxisId="price"
                            dataKey="dynamicCostForecast"
                            type="monotone"
                            stroke="#D97706"
                            strokeWidth={2}
                            strokeDasharray="6 3"
                            dot={false}
                            connectNulls={false}
                            name="Dynamic cost (forecast)"
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
                            fill="#9CA3AF"
                            fillOpacity={0.20}
                            radius={[2, 2, 0, 0]}
                            maxBarSize={isQH ? 8 : 20}
                            name="Consumption"
                          />
                        )}
                      </ComposedChart>
                    </ResponsiveContainer>
                    {/* Edge-scroll zones — press & hold to scrub through days */}
                    <div
                      className="absolute left-0 top-0 w-12 h-full z-30 flex items-center justify-start pl-1 cursor-w-resize group"
                      onMouseDown={(e) => { e.preventDefault(); startEdgeScroll(-1) }}
                      onMouseUp={stopEdgeScroll}
                      onMouseLeave={stopEdgeScroll}
                      onTouchStart={(e) => { e.preventDefault(); startEdgeScroll(-1) }}
                      onTouchEnd={stopEdgeScroll}
                    >
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border border-gray-200/60">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 group-active:text-[#EA1C0A] transition-colors">
                          <polyline points="15 18 9 12 15 6"/>
                        </svg>
                      </div>
                    </div>
                    <div
                      className="absolute right-0 top-0 w-12 h-full z-30 flex items-center justify-end pr-1 cursor-e-resize group"
                      onMouseDown={(e) => { e.preventDefault(); startEdgeScroll(1) }}
                      onMouseUp={stopEdgeScroll}
                      onMouseLeave={stopEdgeScroll}
                      onTouchStart={(e) => { e.preventDefault(); startEdgeScroll(1) }}
                      onTouchEnd={stopEdgeScroll}
                    >
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border border-gray-200/60">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 group-active:text-[#EA1C0A] transition-colors">
                          <polyline points="9 18 15 12 9 6"/>
                        </svg>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-[320px] flex items-center justify-center text-gray-400 text-sm">
                    {prices.loading ? 'Loading prices...' : 'No price data for this date'}
                  </div>
                )}
                {/* Legend */}
                <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
                  {chartMode === 'price' ? (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-3 inline-block" style={{ height: 1.5, backgroundColor: '#94A3B8' }} /> Spot price
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#2563EB' }} /> End customer price (dynamic)
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 border-t-2 border-dashed border-[#EA1C0A] inline-block" /> Fixed price (draggable)
                      </span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1">
                        <span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#2563EB' }} /> Dynamic cost ({loadProfile})
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-3 border-t-2 border-dashed border-[#EA1C0A] inline-block" /> Fixed cost
                      </span>
                    </>
                  )}
                  <button onClick={() => setShowCheaperBand(v => !v)} className={`flex items-center gap-1 transition-opacity ${showCheaperBand ? '' : 'opacity-40'}`}>
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#2563EB', opacity: 0.12 }} /> Dynamic cheaper
                  </button>
                  <button onClick={() => setShowExpensiveBand(v => !v)} className={`flex items-center gap-1 transition-opacity ${showExpensiveBand ? '' : 'opacity-40'}`}>
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#EA1C0A', opacity: 0.10 }} /> Dynamic more expensive
                  </button>
                  {!showRenewable && (
                    <span className="flex items-center gap-1">
                      <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#9CA3AF', opacity: 0.20 }} /> Consumption
                    </span>
                  )}
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
                          {standingCharge > 0 && (
                            <div className="flex justify-between text-[12px] leading-snug">
                              <span className="text-gray-500">Standing charge</span>
                              <span className="tabular-nums font-medium text-gray-600">{fmtEur(standingCharge)} EUR/yr</span>
                            </div>
                          )}
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
              dailyBreakdown={standingCharge > 0
                ? allDailyBreakdown.map(d => {
                    const daysInMo = new Date(parseInt(d.date.slice(0, 4)), parseInt(d.date.slice(5, 7)), 0).getDate()
                    return { ...d, fixedCostEur: d.fixedCostEur + standingCharge / 12 / daysInMo }
                  })
                : allDailyBreakdown}
              selectedDate={prices.selectedDate}
              onSelect={prices.setSelectedDate}
              yearlyKwh={yearlyKwh}
              fixedPrice={fixedPrice}
            />
          </div>
        )}

        {/* Monthly Price Trend — line chart + heatmap table */}
        {allDailyBreakdownFull.length > 0 && (
          <div className="mt-4">
            <MonthlyPriceTrend
              dailyBreakdown={allDailyBreakdownFull}
              loadProfile={loadProfile}
            />
          </div>
        )}

        {/* Monthly Savings + Yearly Savings — v2-style cards side by side */}
        {(monthlyChartData.length > 0 || yearlySavingsData.length > 0) && (
          <div className="mt-4 grid grid-cols-2 gap-4">
            {/* Monthly Cost Comparison — grouped bars + savings line */}
            <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Monthly Costs — Last 12 Months</CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  {yearlyKwh.toLocaleString()} kWh/yr · {loadProfile}
                  {monthlyChartData.length > 0 && <> · {monthlyChartData[0]?.month} – {monthlyChartData[monthlyChartData.length - 1]?.month}</>}
                </p>
              </CardHeader>
              <CardContent className="pt-4 space-y-3 flex-1 flex flex-col">
                <div className="flex-1 min-h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={monthlyChartData} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                      <XAxis dataKey="displayLabel" tick={{ fontSize: 10, fontWeight: 500, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} />
                      <YAxis yAxisId="cost" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        label={{ value: 'EUR', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                      <YAxis yAxisId="savings" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        label={{ value: 'Savings EUR', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                      <Tooltip
                        content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload as (typeof monthlyChartData)[number]
                          return (
                            <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] space-y-1">
                              <p className="text-gray-500 text-[10px] font-medium">{d.month} · {d.daysWithData} days</p>
                              <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                                <span className="text-gray-400">Fixed cost</span>
                                <span className="tabular-nums font-semibold text-red-600 text-right">{d.fixedCostEur.toFixed(2)} EUR</span>
                                <span className="text-gray-400">Dynamic cost</span>
                                <span className="tabular-nums font-semibold text-blue-600 text-right">{d.dynamicCostEur.toFixed(2)} EUR</span>
                                <span className="text-gray-400">Savings</span>
                                <span className={`tabular-nums font-bold text-right ${d.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.savings >= 0 ? '+' : ''}{d.savings.toFixed(2)} EUR</span>
                              </div>
                              <div className="border-t border-gray-100 pt-1 mt-1">
                                <p className="text-[10px] text-gray-400 tabular-nums">Consumption: {d.consumptionKwh.toFixed(1)} kWh · Avg end: {d.avgEndPriceCtKwh.toFixed(2)} ct/kWh</p>
                              </div>
                            </div>
                          )
                        }}
                      />
                      <Bar yAxisId="cost" dataKey="fixedCostEur" radius={[3, 3, 0, 0]} maxBarSize={14}
                        fill="#EA1C0A" fillOpacity={0.25} name="Fixed" />
                      <Bar yAxisId="cost" dataKey="dynamicCostEur" radius={[3, 3, 0, 0]} maxBarSize={14}
                        fill="#2563EB" fillOpacity={0.45} name="Dynamic" />
                      <Line yAxisId="savings" dataKey="cumulative" type="monotone"
                        stroke="#059669" strokeWidth={2}
                        dot={{ r: 2.5, fill: '#059669' }} activeDot={{ r: 4, fill: '#059669' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                {/* Legend */}
                <div className="flex items-center gap-4 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#EA1C0A', opacity: 0.25 }} />
                    Fixed
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#2563EB', opacity: 0.45 }} />
                    Dynamic
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#059669' }} />
                    Cumul. savings
                  </span>
                  <span className="ml-auto tabular-nums font-semibold text-emerald-600">
                    ∑ {monthlyChartData[monthlyChartData.length - 1]?.cumulative.toFixed(0) ?? 0} EUR
                  </span>
                </div>
                {/* Monthly cost table — collapsible */}
                <div className="border-t border-gray-100 pt-2">
                  <button
                    onClick={() => setShowMonthlyTable(p => !p)}
                    className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-600 font-semibold transition-colors mb-2"
                  >
                    <span className="transition-transform inline-block" style={{ transform: showMonthlyTable ? 'rotate(90deg)' : 'rotate(0deg)' }}>▸</span>
                    Monthly breakdown
                  </button>
                  {showMonthlyTable && <table className="w-full text-[10px] tabular-nums">
                    <thead>
                      <tr className="text-gray-400 text-left">
                        <th className="font-medium py-0.5">Month</th>
                        <th className="font-medium py-0.5 text-right">Fixed</th>
                        <th className="font-medium py-0.5 text-right">Dynamic</th>
                        <th className="font-medium py-0.5 text-right">Saved</th>
                        <th className="font-medium py-0.5 text-right">kWh</th>
                      </tr>
                    </thead>
                    <tbody>
                      {monthlyChartData.map(d => (
                        <tr key={d.month} className="border-t border-gray-50 text-gray-600">
                          <td className="py-0.5 font-medium">{d.displayLabel}</td>
                          <td className="py-0.5 text-right text-red-600">{d.fixedCostEur.toFixed(2)}</td>
                          <td className="py-0.5 text-right text-blue-600">{d.dynamicCostEur.toFixed(2)}</td>
                          <td className={`py-0.5 text-right font-semibold ${d.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                            {d.savings >= 0 ? '+' : ''}{d.savings.toFixed(2)}
                          </td>
                          <td className="py-0.5 text-right text-gray-400">{d.consumptionKwh.toFixed(0)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-gray-200 font-bold text-[#313131]">
                        <td className="py-1">Total</td>
                        <td className="py-1 text-right text-red-700">{monthlyChartData.reduce((s, d) => s + d.fixedCostEur, 0).toFixed(2)}</td>
                        <td className="py-1 text-right text-blue-700">{monthlyChartData.reduce((s, d) => s + d.dynamicCostEur, 0).toFixed(2)}</td>
                        <td className={`py-1 text-right ${monthlyChartData[monthlyChartData.length - 1]?.cumulative >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                          {monthlyChartData[monthlyChartData.length - 1]?.cumulative >= 0 ? '+' : ''}{monthlyChartData[monthlyChartData.length - 1]?.cumulative.toFixed(2) ?? '0.00'}
                        </td>
                        <td className="py-1 text-right text-gray-500">{monthlyChartData.reduce((s, d) => s + d.consumptionKwh, 0).toFixed(0)}</td>
                      </tr>
                    </tfoot>
                  </table>}
                </div>
              </CardContent>
            </Card>

            {/* Yearly Savings — horizontal bar chart per year */}
            <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Yearly Savings</CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  {yearlyKwh.toLocaleString()} kWh/yr · dynamic vs. {fixedPrice} ct/kWh fixed{standingCharge > 0 ? ` + ${standingCharge} EUR/yr` : ''}
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
