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
  nlSurchargesForYear, NL_BTW_RATE, nlEndCustomerPrice, nlTotalSurchargesExBtw,
  nlCalculateYearlyCost, nlGetDailyEndPrices,
  type NlSurcharges,
} from '@/lib/nl-tariff'
import { NL_LOAD_PROFILES, type NlLoadProfile } from '@/lib/nl-slp'
import { DynamicDailySavings } from '@/components/dynamic/DynamicDailySavings'
import type { DailyResult } from '@/lib/dynamic-tariff'

export default function NlDynamicPage() {
  return <Suspense><NlDynamicInner /></Suspense>
}

/* ────── NL Provider Presets ────── */
interface NlProvider {
  name: string
  type: 'dynamic' | 'fixed'
  monthlyFeeEur: number
  marginCtKwh: number
  fixedCtKwh: number | null
}

const NL_PROVIDERS: NlProvider[] = [
  { name: 'Tibber', type: 'dynamic', monthlyFeeEur: 5.99, marginCtKwh: 0, fixedCtKwh: null },
  { name: 'Frank Energie', type: 'dynamic', monthlyFeeEur: 4.95, marginCtKwh: 0, fixedCtKwh: null },
  { name: 'ANWB Energie', type: 'dynamic', monthlyFeeEur: 4.95, marginCtKwh: 0, fixedCtKwh: null },
  { name: 'EasyEnergy', type: 'dynamic', monthlyFeeEur: 0, marginCtKwh: 0.45, fixedCtKwh: null },
]

/* ────── Main Component ────── */
function NlDynamicInner() {
  const router = useRouter()
  const searchParams = useSearchParams()

  // State from URL or defaults
  const [yearlyKwh, setYearlyKwh] = useState(() => {
    const v = Number(searchParams.get('kwh'))
    return v > 0 ? v : 3500
  })
  const [fixedPrice, setFixedPrice] = useState(() => {
    const raw = searchParams.get('fixed')
    return raw !== null && Number(raw) > 0 ? Number(raw) : 32
  })
  const [selectedYear, setSelectedYear] = useState(() => {
    const v = Number(searchParams.get('year'))
    return v >= 2020 ? v : 2025
  })
  const [surcharges, setSurcharges] = useState<NlSurcharges>(() =>
    nlSurchargesForYear(Number(searchParams.get('year')) >= 2020 ? Number(searchParams.get('year')) : 2025)
  )
  const [showSurcharges, setShowSurcharges] = useState(false)
  const [postcode, setPostcode] = useState(() => searchParams.get('postcode') || '')
  const [postcodeCity, setPostcodeCity] = useState('')
  const [postcodeProvince, setPostcodeProvince] = useState('')
  const [postcodeDso, setPostcodeDso] = useState<{ name: string; monthlyFee: number } | null>(null)
  const [postcodeLoading, setPostcodeLoading] = useState(false)
  const [showCheaperBand, setShowCheaperBand] = useState(true)
  const [showExpensiveBand, setShowExpensiveBand] = useState(true)
  const [showMonthlyTable, setShowMonthlyTable] = useState(false)
  const [chartMode, setChartMode] = useState<'price' | 'cost'>('price')

  // Dynamic fee model
  const [dynamicFeeType, setDynamicFeeType] = useState<'margin' | 'monthly'>('monthly')
  const [dynamicMonthlyFee, setDynamicMonthlyFee] = useState(5.99)
  const [standingCharge, setStandingCharge] = useState(() => {
    const raw = searchParams.get('standing')
    return raw !== null ? Number(raw) : 84 // EUR/yr typical NL
  })

  // NL grid fee is monthly capacity-based (not per-kWh)
  const [monthlyGridFee, setMonthlyGridFee] = useState(27) // EUR/mo typical 3x25A
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('quarterhour')
  const [loadProfile, setLoadProfile] = useState<NlLoadProfile>('E1A')

  const prices = usePrices('NL')
  const isQH = resolution === 'quarterhour'

  // Effective surcharges
  const effectiveSurcharges = useMemo(() => {
    if (dynamicFeeType === 'monthly') return { ...surcharges, margin: 0 }
    return surcharges
  }, [surcharges, dynamicFeeType])
  const dynamicMonthlyFeeActive = dynamicFeeType === 'monthly' ? dynamicMonthlyFee : 0

  // Available years
  const availableYears = useMemo(() => {
    const years = new Set<number>()
    for (const p of prices.hourly) {
      const y = parseInt(p.date.slice(0, 4))
      if (y >= 2020) years.add(y)
    }
    return [...years].sort((a, b) => b - a)
  }, [prices.hourly])

  useEffect(() => {
    if (availableYears.length > 0 && !availableYears.includes(selectedYear)) {
      setSelectedYear(availableYears[0])
    }
  }, [availableYears, selectedYear])

  // Sync surcharges when year changes
  useEffect(() => {
    setSurcharges(nlSurchargesForYear(selectedYear))
  }, [selectedYear])

  // Fetch NL postcode info
  useEffect(() => {
    const normalized = postcode.replace(/\s/g, '').toUpperCase()
    if (!/^\d{4}[A-Z]{2}$/.test(normalized)) {
      setPostcodeCity('')
      setPostcodeProvince('')
      setPostcodeDso(null)
      return
    }
    setPostcodeLoading(true)
    fetch(`/api/nl-tariff-components?postcode=${normalized}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => {
        if (!data) return
        setPostcodeCity(data.city || '')
        setPostcodeProvince(data.province || '')
        if (data.dso) {
          setPostcodeDso({ name: data.dso.name, monthlyFee: data.dso.monthlyGridFee3x25A })
          setMonthlyGridFee(data.dso.monthlyGridFee3x25A)
        }
      })
      .catch(() => {})
      .finally(() => setPostcodeLoading(false))
  }, [postcode])

  // Auto-select today
  const initialDateSet = useRef(false)
  useEffect(() => {
    if (initialDateSet.current || prices.daily.length === 0) return
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const todayHasData = prices.hourly.some(p => p.date === today)
    if (todayHasData) {
      prices.setSelectedDate(today)
    } else {
      const fallback = prices.lastRealDate || prices.daily.filter(d => d.date <= today).pop()?.date
      if (fallback) prices.setSelectedDate(fallback)
    }
    initialDateSet.current = true
  }, [prices.daily, prices.hourly, prices.lastRealDate]) // eslint-disable-line react-hooks/exhaustive-deps

  // All daily breakdowns across all years
  const allDailyBreakdownFull = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const all: ReturnType<typeof nlCalculateYearlyCost>['dailyBreakdown'] = []
    for (const y of availableYears) {
      const result = nlCalculateYearlyCost(yearlyKwh, prices.hourly, effectiveSurcharges, fixedPrice, y, true, loadProfile)
      all.push(...result.dailyBreakdown)
    }
    all.sort((a, b) => a.date.localeCompare(b.date))
    return all
  }, [prices.hourly, availableYears, yearlyKwh, effectiveSurcharges, fixedPrice, loadProfile])

  // 365 days ending at selected date
  const allDailyBreakdown = useMemo(() => {
    const endDate = prices.selectedDate
    const filtered = allDailyBreakdownFull.filter(d => d.date <= endDate)
    return filtered.slice(-365)
  }, [allDailyBreakdownFull, prices.selectedDate])

  // DailyResult-compatible adapter for shared components
  const allDailyBreakdownCompat: DailyResult[] = useMemo(() =>
    allDailyBreakdown.map(d => ({
      ...d,
      peakDynamicCostEur: 0, peakConsumptionKwh: 0, peakSpotSum: 0, peakHours: 0,
      offPeakDynamicCostEur: 0, offPeakConsumptionKwh: 0, offPeakSpotSum: 0, offPeakHours: 0,
    })),
  [allDailyBreakdown])

  // Per-date savings map for DateStrip coloring
  const dateSavingsMap = useMemo(() => {
    const m = new Map<string, number>()
    for (const d of allDailyBreakdownFull) {
      const daysInMo = new Date(parseInt(d.date.slice(0, 4)), parseInt(d.date.slice(5, 7)), 0).getDate()
      m.set(d.date, d.fixedCostEur + standingCharge / 12 / daysInMo - d.dynamicCostEur - dynamicMonthlyFeeActive / daysInMo)
    }
    return m
  }, [allDailyBreakdownFull, standingCharge, dynamicMonthlyFeeActive])

  const dateStripColorFn = useCallback((date: string): string => {
    const savings = dateSavingsMap.get(date)
    if (savings === undefined) return 'bg-gray-200'
    if (savings > 0.02) return 'bg-emerald-400'
    if (savings > 0) return 'bg-emerald-200'
    if (savings > -0.02) return 'bg-orange-300'
    return 'bg-red-400'
  }, [dateSavingsMap])

  // Daily chart data
  const chartPrices = isQH && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly

  const dailyChartData = useMemo(() => {
    if (chartPrices.length === 0 || !prices.selectedDate) return []
    const useQH = isQH && prices.hourlyQH.length > 0
    const raw = nlGetDailyEndPrices(chartPrices, prices.selectedDate, effectiveSurcharges, yearlyKwh, useQH, true, loadProfile)
    return raw.map(d => {
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
        dynamicCost: d.isProjected ? null : d.costCent,
        dynamicCostForecast: d.isProjected ? d.costCent : null,
        fixedCostCent,
        costGreenBand: d.costCent < fixedCostCent ? [d.costCent, fixedCostCent] : [fixedCostCent, fixedCostCent],
        costRedBand: d.costCent > fixedCostCent ? [fixedCostCent, d.costCent] : [fixedCostCent, fixedCostCent],
      }
    })
  }, [chartPrices, prices.selectedDate, effectiveSurcharges, yearlyKwh, fixedPrice, isQH, prices.hourlyQH.length, loadProfile])

  const hasForecastData = dailyChartData.some(d => d.isProjected)
  const forecastStartIdx = hasForecastData ? dailyChartData.findIndex(d => d.isProjected) : -1

  // Daily totals
  const selectedDayTotals = useMemo(() => {
    if (dailyChartData.length === 0) return null
    const dynamicCostEnergy = dailyChartData.reduce((s, d) => s + d.costCent, 0) / 100
    const totalConsumption = dailyChartData.reduce((s, d) => s + d.consumptionKwh, 0)
    const daysInMonth = prices.selectedDate ? new Date(
      parseInt(prices.selectedDate.slice(0, 4)),
      parseInt(prices.selectedDate.slice(5, 7)), 0
    ).getDate() : 30
    const dynamicCost = dynamicCostEnergy + dynamicMonthlyFeeActive / daysInMonth
    const fixedCost = totalConsumption * fixedPrice / 100 + standingCharge / 12 / daysInMonth
    return {
      dynamicCostEur: dynamicCost,
      fixedCostEur: fixedCost,
      savingsEur: fixedCost - dynamicCost,
      consumptionKwh: totalConsumption,
      isPartial: dailyChartData.length < 24,
      slotsAvailable: dailyChartData.length,
      slotsExpected: 24,
    }
  }, [dailyChartData, fixedPrice, prices.selectedDate, standingCharge, dynamicMonthlyFeeActive])

  // Monthly chart data
  const monthlyChartData = useMemo(() => {
    if (allDailyBreakdown.length === 0) return []
    const endDate = prices.selectedDate || allDailyBreakdown[allDailyBreakdown.length - 1]?.date
    if (!endDate) return []
    const endMonth = endDate.slice(0, 7)
    const endY = parseInt(endMonth.slice(0, 4))
    const endM = parseInt(endMonth.slice(5, 7))
    const months: string[] = []
    for (let i = 11; i >= 0; i--) {
      let m = endM - i
      let y = endY
      while (m <= 0) { m += 12; y-- }
      months.push(`${y}-${String(m).padStart(2, '0')}`)
    }
    const monthMap = new Map<string, { dynamic: number; fixed: number; consumption: number; spotSum: number; kwhSum: number; days: number }>()
    for (const d of allDailyBreakdown) {
      const m = d.date.slice(0, 7)
      if (!months.includes(m)) continue
      const entry = monthMap.get(m) || { dynamic: 0, fixed: 0, consumption: 0, spotSum: 0, kwhSum: 0, days: 0 }
      entry.dynamic += d.dynamicCostEur
      entry.fixed += d.fixedCostEur
      entry.consumption += d.consumptionKwh
      entry.spotSum += d.avgSpotCtKwh * d.consumptionKwh
      entry.kwhSum += d.consumptionKwh
      entry.days++
      monthMap.set(m, entry)
    }
    const LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
    let runSum = 0
    return months.filter(m => monthMap.has(m)).map(m => {
      const d = monthMap.get(m)!
      const fixedWithStanding = d.fixed + standingCharge / 12
      const dynamicWithFee = d.dynamic + dynamicMonthlyFeeActive
      const savings = fixedWithStanding - dynamicWithFee
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
        dynamicCostEur: dynamicWithFee,
        fixedCostEur: fixedWithStanding,
        consumptionKwh: d.consumption,
      }
    })
  }, [allDailyBreakdown, prices.selectedDate, standingCharge, dynamicMonthlyFeeActive])

  // Yearly savings
  const yearlySavingsData = useMemo(() => {
    if (prices.hourly.length === 0) return []
    return availableYears.map(y => {
      const result = nlCalculateYearlyCost(yearlyKwh, prices.hourly, effectiveSurcharges, fixedPrice, y, true, loadProfile)
      const monthsWithData = result.monthlyBreakdown.length
      const standingTotal = standingCharge / 12 * monthsWithData
      const dynamicFeeTotal = dynamicMonthlyFeeActive * monthsWithData
      let cheaperDays = 0
      let expensiveDays = 0
      for (const d of result.dailyBreakdown) {
        const daysInMo = new Date(parseInt(d.date.slice(0, 4)), parseInt(d.date.slice(5, 7)), 0).getDate()
        const dayFixed = d.fixedCostEur + standingCharge / 12 / daysInMo
        const dayDynamic = d.dynamicCostEur + dynamicMonthlyFeeActive / daysInMo
        if (dayDynamic < dayFixed) cheaperDays++
        else expensiveDays++
      }
      return {
        year: y,
        savings: result.savingsEur + standingTotal - dynamicFeeTotal,
        dynamicCost: result.totalDynamicCostEur + dynamicFeeTotal,
        fixedCost: result.totalFixedCostEur + standingTotal,
        avgDynamic: result.avgEffectivePriceCtKwh,
        daysWithData: result.daysWithData,
        kwhConsumed: result.totalKwhConsumed,
        cheaperDays,
        expensiveDays,
      }
    }).sort((a, b) => a.year - b.year)
  }, [prices.hourly, availableYears, yearlyKwh, effectiveSurcharges, fixedPrice, standingCharge, dynamicMonthlyFeeActive, loadProfile])

  // URL sync
  useEffect(() => {
    const p = new URLSearchParams()
    p.set('kwh', String(yearlyKwh))
    p.set('fixed', String(fixedPrice))
    p.set('year', String(selectedYear))
    if (prices.selectedDate) p.set('date', prices.selectedDate)
    if (postcode.length >= 6) p.set('postcode', postcode)
    if (standingCharge > 0) p.set('standing', String(standingCharge))
    router.replace(`/dynamic/nl?${p.toString()}`, { scroll: false })
  }, [yearlyKwh, fixedPrice, selectedYear, prices.selectedDate, postcode, standingCharge]) // eslint-disable-line react-hooks/exhaustive-deps

  const surchargesTotal = nlTotalSurchargesExBtw(effectiveSurcharges)
  const bruttoSurcharges = surchargesTotal * (1 + NL_BTW_RATE / 100)

  const fmtEur = (n: number) => n.toFixed(2)
  const fmtCt = (n: number) => n.toFixed(2)

  // Edge-scroll
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
    const plotTop = 10
    const plotBottom = rect.height - 40
    const plotHeight = plotBottom - plotTop
    const mouseY = e.clientY - rect.top
    const priceFraction = 1 - (mouseY - plotTop) / plotHeight
    const priceAtMouse = yDomain[0] + priceFraction * (yDomain[1] - yDomain[0])
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
    setFixedPrice(Math.max(1, Math.min(80, Math.round(newPrice * 10) / 10)))
  }, [yDomain])

  const handleChartMouseUp = useCallback(() => {
    dragging.current = false
  }, [])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* Header */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <h1 className="text-sm font-semibold text-gray-400">Dynamic Tariff Calculator</h1>
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              <a href="/dynamic"
                className="text-[11px] font-semibold px-2 py-1 rounded-full transition-colors flex items-center gap-1 text-gray-400 hover:text-gray-600">
                <svg width="14" height="10" viewBox="0 0 14 10" className="rounded-[1px]"><rect width="14" height="3.33" fill="#000"/><rect y="3.33" width="14" height="3.34" fill="#D00"/><rect y="6.67" width="14" height="3.33" fill="#FC0"/></svg>
                DE
              </a>
              <button
                className="text-[11px] font-semibold px-2 py-1 rounded-full transition-colors flex items-center gap-1 bg-white text-[#313131] shadow-sm">
                <svg width="14" height="10" viewBox="0 0 14 10" className="rounded-[1px]"><rect width="14" height="3.33" fill="#AE1C28"/><rect y="3.33" width="14" height="3.34" fill="#FFF"/><rect y="6.67" width="14" height="3.33" fill="#21468B"/></svg>
                NL
              </button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6">
        <div className="flex gap-6">
          {/* ── Left Sidebar: Settings ── */}
          <div className="w-[300px] flex-shrink-0 sticky top-6 self-start space-y-3">
            {/* Section 1: Location */}
            <Card className="shadow-sm border-gray-200/80">
              <CardHeader className="pb-1.5">
                <CardTitle className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Location</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <input
                      type="text"
                      maxLength={6}
                      placeholder="e.g. 1012AB"
                      value={postcode}
                      onChange={e => setPostcode(e.target.value.replace(/[^0-9A-Za-z]/g, '').slice(0, 6))}
                      className="w-24 rounded border border-gray-200 px-2 py-1.5 text-[13px] tabular-nums text-[#313131] uppercase focus:outline-none focus:ring-1 focus:ring-orange-400/30"
                    />
                    {postcodeLoading && <span className="text-[10px] text-gray-400">Loading...</span>}
                    {postcodeCity && !postcodeLoading && (
                      <div className="flex flex-col min-w-0">
                        <span className="text-[12px] text-gray-700 font-semibold truncate">{postcodeCity}</span>
                        {postcodeProvince && <span className="text-[10px] text-gray-400 truncate">{postcodeProvince}</span>}
                      </div>
                    )}
                  </div>
                  {postcodeDso && (
                    <div className="bg-orange-50/60 border border-orange-100/80 rounded-md px-2 py-1.5 space-y-0.5">
                      <p className="text-[10px] font-semibold text-orange-700">Grid: {postcodeDso.name}</p>
                      <p className="text-[10px] text-gray-500 tabular-nums">{postcodeDso.monthlyFee.toFixed(2)} EUR/mo (3x25A capacity)</p>
                    </div>
                  )}
                  {!postcode && (
                    <p className="text-[9px] text-gray-400">
                      Enter Dutch postcode for DSO grid fees & location.
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 2: Tariffs */}
            <Card className="shadow-sm border-gray-200/80">
              <CardHeader className="pb-1.5">
                <CardTitle className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Tariffs</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                {/* Fixed tariff */}
                <div className="space-y-2">
                  <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">Fixed Tariff</p>
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Energy price (incl. BTW)</span>
                    <span className="text-sm font-bold tabular-nums text-[#313131]">{fixedPrice.toFixed(1)} ct/kWh</span>
                  </div>
                  <input
                    type="range" min={15} max={50} step={0.1} value={fixedPrice}
                    onChange={e => setFixedPrice(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                  />
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-gray-500">Standing charge</span>
                    <span className="text-sm font-bold tabular-nums text-[#313131]">{standingCharge} EUR/yr</span>
                  </div>
                  <input
                    type="range" min={0} max={200} step={1} value={standingCharge}
                    onChange={e => setStandingCharge(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                  />
                  <p className="text-[9px] text-gray-400">Gross incl. energiebelasting & 21% BTW · drag chart line to adjust</p>
                </div>

                {/* Dynamic tariff */}
                <div className="space-y-2 pt-3 border-t border-gray-200">
                  <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider">Dynamic Tariff</p>
                  <p className="text-[9px] text-gray-400">EPEX Spot + energiebelasting + supplier fee + 21% BTW</p>
                  {/* Provider presets */}
                  <div className="flex flex-col gap-1">
                    {NL_PROVIDERS.map(prov => {
                      const isActive = dynamicFeeType === (prov.marginCtKwh > 0 ? 'margin' : 'monthly')
                        && (prov.marginCtKwh > 0
                          ? Math.abs(surcharges.margin - prov.marginCtKwh) < 0.1
                          : Math.abs(dynamicMonthlyFee - prov.monthlyFeeEur) < 0.1)
                      return (
                        <button
                          key={prov.name}
                          onClick={() => {
                            if (prov.marginCtKwh > 0) {
                              setDynamicFeeType('margin')
                              setSurcharges(s => ({ ...s, margin: prov.marginCtKwh }))
                            } else {
                              setDynamicFeeType('monthly')
                              setDynamicMonthlyFee(prov.monthlyFeeEur)
                              setSurcharges(s => ({ ...s, margin: 0 }))
                            }
                          }}
                          className={`text-left text-[10px] px-2 py-1.5 rounded border transition-colors ${
                            isActive
                              ? 'bg-blue-50 border-blue-300/50 text-[#313131]'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <span className="font-semibold">{prov.name}</span>
                          <span className="float-right tabular-nums font-medium">
                            {prov.monthlyFeeEur > 0 ? `${prov.monthlyFeeEur.toFixed(2)} EUR/mo` : `+${prov.marginCtKwh} ct/kWh`}
                          </span>
                        </button>
                      )
                    })}
                  </div>
                  {/* Fee type toggle */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                    <button
                      onClick={() => setDynamicFeeType('monthly')}
                      className={`flex-1 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${dynamicFeeType === 'monthly' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      Monthly fee
                    </button>
                    <button
                      onClick={() => setDynamicFeeType('margin')}
                      className={`flex-1 text-[10px] font-semibold px-2 py-1 rounded-full transition-colors ${dynamicFeeType === 'margin' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    >
                      Margin ct/kWh
                    </button>
                  </div>
                  {dynamicFeeType === 'monthly' ? (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">Monthly fee</span>
                        <span className="text-sm font-bold tabular-nums text-[#313131]">{dynamicMonthlyFee.toFixed(2)} EUR/mo</span>
                      </div>
                      <input
                        type="range" min={0} max={15} step={0.01} value={dynamicMonthlyFee}
                        onChange={e => setDynamicMonthlyFee(Number(e.target.value))}
                        className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-500 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                      />
                    </div>
                  ) : (
                    <div className="space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-gray-500">Supplier margin</span>
                        <span className="text-sm font-bold tabular-nums text-[#313131]">{surcharges.margin.toFixed(2)} ct/kWh</span>
                      </div>
                      <input
                        type="range" min={0} max={5} step={0.1} value={surcharges.margin}
                        onChange={e => setSurcharges(s => ({ ...s, margin: Number(e.target.value) }))}
                        className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-blue-500 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                      />
                    </div>
                  )}
                </div>

                {/* Surcharges */}
                <div className="space-y-2 pt-3 border-t border-gray-200">
                  <button onClick={() => setShowSurcharges(!showSurcharges)} className="w-full flex items-center justify-between">
                    <p className="text-[10px] font-semibold text-gray-500">Surcharges & taxes</p>
                    <svg className={`w-4 h-4 text-gray-400 transition-transform ${showSurcharges ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>
                  {showSurcharges && (
                    <div className="pt-2 space-y-2">
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Total (excl. BTW)</span>
                        <span className="font-semibold tabular-nums text-[#313131]">{fmtCt(surchargesTotal)} ct/kWh</span>
                      </div>
                      <div className="flex justify-between text-[11px]">
                        <span className="text-gray-500">Total (incl. 21% BTW)</span>
                        <span className="font-semibold tabular-nums text-[#313131]">{fmtCt(bruttoSurcharges)} ct/kWh</span>
                      </div>
                      <div className="flex items-center justify-between gap-2 mt-2">
                        <span className="text-[10px] text-gray-600">Energiebelasting</span>
                        <div className="flex items-center gap-1">
                          <input
                            type="number" step="0.01" value={surcharges.energiebelasting}
                            onChange={e => { const val = Number(e.target.value); if (!isNaN(val)) setSurcharges(s => ({ ...s, energiebelasting: val })) }}
                            className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] tabular-nums text-right text-[#313131] focus:outline-none focus:ring-1 focus:ring-orange-400/30"
                          />
                          <span className="text-[9px] text-gray-400">ct</span>
                        </div>
                      </div>
                      {dynamicFeeType === 'margin' && (
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-[10px] text-gray-600">Supplier margin</span>
                          <div className="flex items-center gap-1">
                            <input
                              type="number" step="0.01" value={surcharges.margin}
                              onChange={e => { const val = Number(e.target.value); if (!isNaN(val)) setSurcharges(s => ({ ...s, margin: val })) }}
                              className="w-16 rounded border border-gray-200 px-1.5 py-0.5 text-[11px] tabular-nums text-right text-[#313131] focus:outline-none focus:ring-1 focus:ring-orange-400/30"
                            />
                            <span className="text-[9px] text-gray-400">ct</span>
                          </div>
                        </div>
                      )}
                      <p className="text-[9px] text-gray-400 mt-1">
                        NL grid fees are capacity-based ({monthlyGridFee.toFixed(2)} EUR/mo), not per-kWh.
                        They are NOT included in the dynamic price above.
                      </p>
                      <button
                        onClick={() => setSurcharges(nlSurchargesForYear(selectedYear))}
                        className="w-full text-[10px] text-gray-500 hover:text-orange-600 py-1 transition-colors"
                      >
                        Reset to {selectedYear} defaults
                      </button>
                    </div>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Section 3: Consumption */}
            <Card className="shadow-sm border-gray-200/80">
              <CardHeader className="pb-1.5">
                <CardTitle className="text-[11px] font-bold text-gray-400 uppercase tracking-wider">Consumption</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 pt-0">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-500">Yearly consumption</span>
                    <span className="text-sm font-bold tabular-nums text-[#313131]">{yearlyKwh.toLocaleString()} kWh</span>
                  </div>
                  <input
                    type="range" min={500} max={10000} step={100} value={yearlyKwh}
                    onChange={e => setYearlyKwh(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                  />
                  {/* Load profile selector */}
                  <div className="space-y-1.5 pt-2 border-t border-gray-100">
                    <p className="text-[10px] font-semibold text-gray-500">Load profile (NEDU 2025)</p>
                    <div className="flex flex-col gap-1">
                      {NL_LOAD_PROFILES.map(p => (
                        <button
                          key={p.id}
                          onClick={() => setLoadProfile(p.id)}
                          className={`text-left text-[10px] px-2 py-1.5 rounded border transition-colors ${
                            loadProfile === p.id
                              ? 'bg-orange-50 border-orange-300/50 text-[#313131]'
                              : 'bg-white border-gray-200 text-gray-600 hover:bg-gray-50'
                          }`}
                        >
                          <span className="font-semibold font-mono">{p.label}</span>
                          <span className="ml-1.5 text-gray-400">{p.description}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Monthly grid fee */}
                <div className="space-y-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-semibold text-gray-500">Monthly grid fee</span>
                    <span className="text-sm font-bold tabular-nums text-[#313131]">{monthlyGridFee.toFixed(2)} EUR/mo</span>
                  </div>
                  <input
                    type="range" min={10} max={60} step={0.5} value={monthlyGridFee}
                    onChange={e => setMonthlyGridFee(Number(e.target.value))}
                    className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-orange-500 [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:shadow-md [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-[#313131] [&::-moz-range-thumb]:border-0"
                  />
                  <p className="text-[9px] text-gray-400">
                    Capacity-based (ACM tariff) · same for fixed & dynamic · {postcodeDso ? postcodeDso.name : 'auto-detected from postcode'}
                  </p>
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

            {/* Price Chart */}
            <Card className="shadow-sm border-gray-200/80">
              <CardHeader className="pb-2 border-b border-gray-100">
                <div className="flex items-center justify-between">
                  <div>
                    <CardTitle className="text-sm font-bold text-[#313131]">
                      {chartMode === 'cost' ? 'Hourly Cost' : 'Day-Ahead Spot Price (NL)'} — {prices.selectedDate || '...'}
                    </CardTitle>
                    <p className="text-[10px] text-gray-400 mt-0.5">
                      {chartMode === 'cost' ? '{loadProfile}-weighted cost per hour (cent)' : 'EPEX Spot NL prices + energiebelasting + BTW'}
                      {selectedDayTotals && (
                        <>
                          {' · '}{selectedDayTotals.consumptionKwh.toFixed(2)} kWh
                          {selectedDayTotals.isPartial && (
                            <span className="text-amber-500 ml-1">· partial ({selectedDayTotals.slotsAvailable}/{selectedDayTotals.slotsExpected} slots)</span>
                          )}
                        </>
                      )}
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                      <button onClick={() => setResolution('hour')}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'hour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                        Hour
                      </button>
                      <button onClick={() => setResolution('quarterhour')}
                        disabled={prices.hourlyQH.length === 0}
                        title={prices.hourlyQH.length === 0 ? 'No 15-min data available' : '15-minute resolution'}
                        className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'quarterhour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                        15min
                      </button>
                    </div>
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
                    {/* Summary pill */}
                    {selectedDayTotals && selectedDayTotals.consumptionKwh > 0 && yearlyKwh > 0 && (() => {
                      const dynamicAvg = selectedDayTotals.consumptionKwh > 0 ? selectedDayTotals.dynamicCostEur / selectedDayTotals.consumptionKwh * 100 : 0
                      const diffCt = fixedPrice - dynamicAvg
                      const diffEur = selectedDayTotals.savingsEur
                      const isCheaper = diffCt > 0
                      return (
                        <div className="absolute left-14 top-1 z-20 pointer-events-none flex items-center gap-1.5">
                          {chartMode === 'price' ? (
                            <div className={`backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5 ${isCheaper ? 'bg-emerald-50/80 border-emerald-300/50' : 'bg-red-50/80 border-red-300/50'}`}>
                              <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${isCheaper ? 'bg-emerald-500' : 'bg-red-500'}`} />
                              <span className={`text-[12px] font-bold tabular-nums whitespace-nowrap ${isCheaper ? 'text-emerald-700' : 'text-red-700'}`}>
                                {isCheaper ? '\u25BC' : '\u25B2'} {Math.abs(diffCt).toFixed(1)} ct/kWh
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
                        <XAxis dataKey="label" tick={{ fontSize: 11, fontWeight: 500 }} tickLine={{ stroke: '#D1D5DB', strokeWidth: 1 }} tickSize={6} stroke="#9CA3AF" interval={isQH ? 7 : 1} />
                        <YAxis yAxisId="price" tick={{ fontSize: 11, fontWeight: 500 }} stroke="#9CA3AF" width={40} domain={yDomain}
                          allowDecimals={chartMode === 'cost'}
                          label={chartMode === 'cost' ? { value: 'cent', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } } : undefined} />
                        <YAxis yAxisId="cost" orientation="right" tick={{ fontSize: 11, fontWeight: 500 }} stroke="#9CA3AF" width={45}
                          label={{ value: 'kWh', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const d = payload[0].payload as (typeof dailyChartData)[number]
                            return (
                              <div className="bg-white/95 backdrop-blur-sm rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] space-y-0.5">
                                <p className="text-gray-500 text-[10px]">{d.label} – {String(d.hour + 1).padStart(2, '0')}:00{d.isProjected && <span className="text-amber-600 ml-1">forecast</span>}</p>
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
                                  </>
                                )}
                              </div>
                            )
                          }}
                        />
                        {/* Price mode */}
                        {chartMode === 'price' && (
                          <ReferenceLine yAxisId="price" y={fixedPrice} stroke="#EA1C0A" strokeDasharray="8 4" strokeWidth={2}
                            label={{ value: `Fixed: ${fixedPrice} ct/kWh`, position: 'insideLeft', dy: -9, style: { fontSize: 11, fill: '#EA1C0A', fontWeight: 600, cursor: 'ns-resize' } }} />
                        )}
                        {chartMode === 'price' && showCheaperBand && (
                          <Area yAxisId="price" dataKey="greenBand" type="monotone" fill="#2563EB" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                        )}
                        {chartMode === 'price' && showExpensiveBand && (
                          <Area yAxisId="price" dataKey="redBand" type="monotone" fill="#EA1C0A" fillOpacity={0.10} stroke="none" isAnimationActive={false} />
                        )}
                        {chartMode === 'price' && (
                          <Line yAxisId="price" dataKey="spotPrice" type="monotone" stroke="#94A3B8" strokeWidth={1.5} dot={false} activeDot={{ r: 3, fill: '#64748B' }} connectNulls={false} name="Spot" />
                        )}
                        {chartMode === 'price' && hasForecastData && (
                          <Line yAxisId="price" dataKey="spotForecast" type="monotone" stroke="#94A3B8" strokeWidth={1.5} strokeDasharray="6 3" dot={false} connectNulls={false} name="Spot (forecast)" />
                        )}
                        {chartMode === 'price' && (
                          <Line yAxisId="price" dataKey="endPrice" type="monotone" stroke="#2563EB" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#2563EB', stroke: '#fff', strokeWidth: 1.5 }} connectNulls={false} name="End Customer Price" />
                        )}
                        {chartMode === 'price' && hasForecastData && (
                          <Line yAxisId="price" dataKey="endPriceForecast" type="monotone" stroke="#D97706" strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} name="End Price (forecast)" />
                        )}
                        {/* Cost mode */}
                        {chartMode === 'cost' && (
                          <Line yAxisId="price" dataKey="fixedCostCent" type="monotone" stroke="#EA1C0A" strokeDasharray="8 4" strokeWidth={2} dot={false} name="Fixed cost" />
                        )}
                        {chartMode === 'cost' && showCheaperBand && (
                          <Area yAxisId="price" dataKey="costGreenBand" type="monotone" fill="#2563EB" fillOpacity={0.12} stroke="none" isAnimationActive={false} />
                        )}
                        {chartMode === 'cost' && showExpensiveBand && (
                          <Area yAxisId="price" dataKey="costRedBand" type="monotone" fill="#EA1C0A" fillOpacity={0.10} stroke="none" isAnimationActive={false} />
                        )}
                        {chartMode === 'cost' && (
                          <Line yAxisId="price" dataKey="dynamicCost" type="monotone" stroke="#2563EB" strokeWidth={2.5} dot={false} activeDot={{ r: 4, fill: '#2563EB', stroke: '#fff', strokeWidth: 1.5 }} connectNulls={false} name="Dynamic cost" />
                        )}
                        {chartMode === 'cost' && hasForecastData && (
                          <Line yAxisId="price" dataKey="dynamicCostForecast" type="monotone" stroke="#D97706" strokeWidth={2} strokeDasharray="6 3" dot={false} connectNulls={false} name="Dynamic cost (forecast)" />
                        )}
                        {forecastStartIdx >= 0 && (
                          <ReferenceArea x1={forecastStartIdx} x2={dailyChartData.length - 1} yAxisId="price" fill="#F59E0B" fillOpacity={0.04} stroke="none" />
                        )}
                        <Bar yAxisId="cost" dataKey="consumptionKwh" fill="#9CA3AF" fillOpacity={0.20} radius={[2, 2, 0, 0]} maxBarSize={isQH ? 8 : 20} name="Consumption" />
                      </ComposedChart>
                    </ResponsiveContainer>
                    {/* Edge-scroll zones */}
                    <div className="absolute left-0 top-0 w-12 h-full z-30 flex items-center justify-start pl-1 cursor-w-resize group"
                      onMouseDown={(e) => { e.preventDefault(); startEdgeScroll(-1) }} onMouseUp={stopEdgeScroll} onMouseLeave={stopEdgeScroll}
                      onTouchStart={(e) => { e.preventDefault(); startEdgeScroll(-1) }} onTouchEnd={stopEdgeScroll}>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border border-gray-200/60">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 group-active:text-orange-500 transition-colors"><polyline points="15 18 9 12 15 6"/></svg>
                      </div>
                    </div>
                    <div className="absolute right-0 top-0 w-12 h-full z-30 flex items-center justify-end pr-1 cursor-e-resize group"
                      onMouseDown={(e) => { e.preventDefault(); startEdgeScroll(1) }} onMouseUp={stopEdgeScroll} onMouseLeave={stopEdgeScroll}
                      onTouchStart={(e) => { e.preventDefault(); startEdgeScroll(1) }} onTouchEnd={stopEdgeScroll}>
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity duration-200 bg-white/80 backdrop-blur-sm rounded-full p-1.5 shadow-sm border border-gray-200/60">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="text-gray-400 group-active:text-orange-500 transition-colors"><polyline points="9 18 15 12 9 6"/></svg>
                      </div>
                    </div>
                  </div>
                ) : (
                  <div className="h-[320px] flex items-center justify-center text-gray-400 text-sm">
                    {prices.loading ? 'Loading NL prices...' : 'No price data for this date'}
                  </div>
                )}
                {/* Legend */}
                <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
                  {chartMode === 'price' ? (
                    <>
                      <span className="flex items-center gap-1"><span className="w-3 inline-block" style={{ height: 1.5, backgroundColor: '#94A3B8' }} /> Spot price</span>
                      <span className="flex items-center gap-1"><span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#2563EB' }} /> End price (dynamic)</span>
                      <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-[#EA1C0A] inline-block" /> Fixed price (draggable)</span>
                    </>
                  ) : (
                    <>
                      <span className="flex items-center gap-1"><span className="w-3 inline-block" style={{ height: 2, backgroundColor: '#2563EB' }} /> Dynamic cost</span>
                      <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-[#EA1C0A] inline-block" /> Fixed cost</span>
                    </>
                  )}
                  <button onClick={() => setShowCheaperBand(v => !v)} className={`flex items-center gap-1 transition-opacity ${showCheaperBand ? '' : 'opacity-40'}`}>
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#2563EB', opacity: 0.12 }} /> Dynamic cheaper
                  </button>
                  <button onClick={() => setShowExpensiveBand(v => !v)} className={`flex items-center gap-1 transition-opacity ${showExpensiveBand ? '' : 'opacity-40'}`}>
                    <span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#EA1C0A', opacity: 0.10 }} /> Dynamic more expensive
                  </button>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm inline-block" style={{ backgroundColor: '#9CA3AF', opacity: 0.20 }} /> Consumption</span>
                  {hasForecastData && (
                    <span className="flex items-center gap-1">
                      <svg className="inline -mt-px mr-0.5" width="16" height="2" viewBox="0 0 16 2"><line x1="0" y1="1" x2="16" y2="1" stroke="#D97706" strokeWidth="1.5" strokeDasharray="3 2"/></svg>
                      <span className="text-[10px] text-amber-600">Forecast</span>
                    </span>
                  )}
                </div>
              </CardContent>
            </Card>

            {/* Daily Cost Breakdown */}
            {selectedDayTotals && (() => {
              const dynamicAvgCt = selectedDayTotals.consumptionKwh > 0 ? selectedDayTotals.dynamicCostEur / selectedDayTotals.consumptionKwh * 100 : 0
              const savings = selectedDayTotals.savingsEur
              const savingsCt = fixedPrice - dynamicAvgCt
              return (
                <Card className="shadow-sm border-gray-200/80">
                  <CardHeader className="pb-3 border-b border-gray-100">
                    <CardTitle className="text-base font-bold text-[#313131]">Daily Cost Breakdown</CardTitle>
                    <p className="text-[11px] text-gray-400 mt-1">{prices.selectedDate} · {selectedDayTotals.consumptionKwh.toFixed(2)} kWh · {loadProfile} profile</p>
                  </CardHeader>
                  <CardContent className="pt-5 space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
                        <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2.5">Fixed Tariff</p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[12px]"><span className="text-gray-500">Price</span><span className="tabular-nums font-semibold text-red-700">{fmtCt(fixedPrice)} ct/kWh</span></div>
                          <div className="flex justify-between text-[12px]"><span className="text-gray-500">Consumption</span><span className="tabular-nums font-medium text-gray-600">{selectedDayTotals.consumptionKwh.toFixed(2)} kWh</span></div>
                          {standingCharge > 0 && (() => {
                            const daysInMo = prices.selectedDate ? new Date(parseInt(prices.selectedDate.slice(0, 4)), parseInt(prices.selectedDate.slice(5, 7)), 0).getDate() : 30
                            return <div className="flex justify-between text-[12px]"><span className="text-gray-500">Standing charge</span><span className="tabular-nums font-medium text-gray-600">{fmtEur(standingCharge / 12 / daysInMo)} EUR/day</span></div>
                          })()}
                        </div>
                        <div className="border-t border-red-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
                          <span className="text-gray-500 font-medium">Daily cost</span>
                          <span className="font-bold text-red-700 tabular-nums">{fmtEur(selectedDayTotals.fixedCostEur)} EUR</span>
                        </div>
                      </div>
                      <div className="bg-blue-50/60 rounded-lg p-3 border border-blue-100/80">
                        <p className="text-[10px] font-bold text-blue-600 uppercase tracking-wider mb-2.5">Dynamic Tariff</p>
                        <div className="space-y-1.5">
                          <div className="flex justify-between text-[12px]"><span className="text-gray-500">Avg price</span><span className="tabular-nums font-semibold text-blue-700">{fmtCt(dynamicAvgCt)} ct/kWh</span></div>
                          <div className="flex justify-between text-[12px]"><span className="text-gray-500">Consumption</span><span className="tabular-nums font-medium text-gray-600">{selectedDayTotals.consumptionKwh.toFixed(2)} kWh</span></div>
                          {dynamicMonthlyFeeActive > 0 && (() => {
                            const daysInMo = prices.selectedDate ? new Date(parseInt(prices.selectedDate.slice(0, 4)), parseInt(prices.selectedDate.slice(5, 7)), 0).getDate() : 30
                            return <div className="flex justify-between text-[12px]"><span className="text-gray-500">Monthly fee</span><span className="tabular-nums font-medium text-gray-600">{fmtEur(dynamicMonthlyFeeActive / daysInMo)} EUR/day</span></div>
                          })()}
                        </div>
                        <div className="border-t border-blue-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
                          <span className="text-gray-500 font-medium">Daily cost</span>
                          <span className="font-bold text-blue-700 tabular-nums">{fmtEur(selectedDayTotals.dynamicCostEur)} EUR</span>
                        </div>
                      </div>
                    </div>
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
                    <p className="text-[10px] text-gray-400">
                      Drag the dashed fixed-price line on the chart to adjust. Flat consumption profile (equal kWh per hour).
                      Grid fee ({monthlyGridFee.toFixed(2)} EUR/mo) applies equally to both tariffs and is excluded from the chart.
                    </p>
                  </CardContent>
                </Card>
              )
            })()}
          </div>
        </div>

        {/* Full-width sections */}
        {allDailyBreakdownCompat.length > 0 && (
          <div className="mt-4">
            <DynamicDailySavings
              dailyBreakdown={(standingCharge > 0 || dynamicMonthlyFeeActive > 0)
                ? allDailyBreakdownCompat.map(d => {
                    const daysInMo = new Date(parseInt(d.date.slice(0, 4)), parseInt(d.date.slice(5, 7)), 0).getDate()
                    return { ...d, fixedCostEur: d.fixedCostEur + standingCharge / 12 / daysInMo, dynamicCostEur: d.dynamicCostEur + dynamicMonthlyFeeActive / daysInMo }
                  })
                : allDailyBreakdownCompat}
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
            {/* Monthly Cost Comparison — grouped bars + savings line */}
            <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Monthly Costs — Last 12 Months</CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  {yearlyKwh.toLocaleString()} kWh/yr · {loadProfile} profile
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
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload as (typeof monthlyChartData)[number]
                        return (
                          <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[11px] space-y-1">
                            <p className="text-gray-500 text-[10px] font-medium">{d.month} · {d.daysWithData} days</p>
                            <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                              <span className="text-gray-400">Fixed cost</span><span className="tabular-nums font-semibold text-red-600 text-right">{d.fixedCostEur.toFixed(2)} EUR</span>
                              <span className="text-gray-400">Dynamic cost</span><span className="tabular-nums font-semibold text-blue-600 text-right">{d.dynamicCostEur.toFixed(2)} EUR</span>
                              <span className="text-gray-400">Savings</span><span className={`tabular-nums font-bold text-right ${d.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.savings >= 0 ? '+' : ''}{d.savings.toFixed(2)} EUR</span>
                            </div>
                          </div>
                        )
                      }} />
                      <Bar yAxisId="cost" dataKey="fixedCostEur" radius={[3, 3, 0, 0]} maxBarSize={14} fill="#EA1C0A" fillOpacity={0.25} name="Fixed" />
                      <Bar yAxisId="cost" dataKey="dynamicCostEur" radius={[3, 3, 0, 0]} maxBarSize={14} fill="#2563EB" fillOpacity={0.45} name="Dynamic" />
                      <Line yAxisId="savings" dataKey="cumulative" type="monotone" stroke="#059669" strokeWidth={2}
                        dot={{ r: 2.5, fill: '#059669' }} activeDot={{ r: 4, fill: '#059669' }} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center gap-4 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#EA1C0A', opacity: 0.25 }} /> Fixed</span>
                  <span className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#2563EB', opacity: 0.45 }} /> Dynamic</span>
                  <span className="flex items-center gap-1.5"><span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: '#059669' }} /> Cumul. savings</span>
                  <span className="ml-auto tabular-nums font-semibold text-emerald-600">
                    {'\u2211'} {monthlyChartData[monthlyChartData.length - 1]?.cumulative.toFixed(0) ?? 0} EUR
                  </span>
                </div>
                {/* Monthly table */}
                <div className="border-t border-gray-100 pt-2">
                  <button onClick={() => setShowMonthlyTable(p => !p)}
                    className="flex items-center gap-1.5 text-[10px] text-gray-400 hover:text-gray-600 font-semibold transition-colors mb-2">
                    <span className="transition-transform inline-block" style={{ transform: showMonthlyTable ? 'rotate(90deg)' : 'rotate(0deg)' }}>{'\u25B8'}</span>
                    Monthly breakdown
                  </button>
                  {showMonthlyTable && <table className="w-full text-[10px] tabular-nums">
                    <thead><tr className="text-gray-400 text-left">
                      <th className="font-medium py-0.5">Month</th><th className="font-medium py-0.5 text-right">Fixed</th>
                      <th className="font-medium py-0.5 text-right">Dynamic</th><th className="font-medium py-0.5 text-right">Saved</th>
                      <th className="font-medium py-0.5 text-right">kWh</th>
                    </tr></thead>
                    <tbody>{monthlyChartData.map(d => (
                      <tr key={d.month} className="border-t border-gray-50 text-gray-600">
                        <td className="py-0.5 font-medium">{d.displayLabel}</td>
                        <td className="py-0.5 text-right text-red-600">{d.fixedCostEur.toFixed(2)}</td>
                        <td className="py-0.5 text-right text-blue-600">{d.dynamicCostEur.toFixed(2)}</td>
                        <td className={`py-0.5 text-right font-semibold ${d.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>{d.savings >= 0 ? '+' : ''}{d.savings.toFixed(2)}</td>
                        <td className="py-0.5 text-right text-gray-400">{d.consumptionKwh.toFixed(1)}</td>
                      </tr>
                    ))}</tbody>
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
