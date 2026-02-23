'use client'

import { useMemo, useState, useCallback, useEffect, useRef } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, AVG_CONSUMPTION_KWH_PER_100KM, DEFAULT_CHARGE_POWER_KW, type ChargingScenario, type HourlyPrice, type DailySummary, type MonthlyStats } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea
} from 'recharts'

// German BEV mileage distribution (BEV alle — KBA 2024)
const MILEAGE_DIST = [
  { pct: 14, lo: 5000, hi: 10000 },
  { pct: 26, lo: 10000, hi: 15000 },
  { pct: 25, lo: 15000, hi: 20000 },
  { pct: 15, lo: 20000, hi: 25000 },
  { pct: 10, lo: 25000, hi: 30000 },
  { pct: 7, lo: 30000, hi: 40000 },
]
const MAX_DIST_PCT = 26
const SLIDER_MIN = 5000, SLIDER_MAX = 40000, SLIDER_RANGE = SLIDER_MAX - SLIDER_MIN
const DE_AVG_MILEAGE = 14000

// Chart margins — passed to Recharts (actual plot area measured from DOM)
const CHART_MARGIN = { top: 42, right: 15, bottom: 25, left: 50 }

interface PriceData {
  hourly: HourlyPrice[]
  daily: DailySummary[]
  monthly: MonthlyStats[]
  selectedDate: string
  setSelectedDate: (date: string) => void
  selectedDayPrices: HourlyPrice[]
  yearRange: { start: string; end: string }
}

interface Props {
  prices: PriceData
  scenario: ChargingScenario
  setScenario: (s: ChargingScenario) => void
  optimization: OptimizeResult | null
  onNext: () => void
  onBack: () => void
}

/* ────── MiniCalendar ────── */
function MiniCalendar({ daily, selectedDate, onSelect }: {
  daily: DailySummary[]
  selectedDate: string
  onSelect: (date: string) => void
}) {
  const dataRange = useMemo(() => {
    if (daily.length === 0) return { firstMonth: '', lastMonth: '' }
    const sorted = [...daily].sort((a, b) => a.date.localeCompare(b.date))
    return { firstMonth: sorted[0].date.slice(0, 7), lastMonth: sorted[sorted.length - 1].date.slice(0, 7) }
  }, [daily])

  const [viewMonth, setViewMonth] = useState(() => {
    if (selectedDate) return selectedDate.slice(0, 7)
    if (dataRange.lastMonth) return dataRange.lastMonth
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
  })

  useEffect(() => {
    if (selectedDate) setViewMonth(selectedDate.slice(0, 7))
  }, [selectedDate])

  const monthDays = useMemo(() => {
    const [year, month] = viewMonth.split('-').map(Number)
    const firstDay = new Date(year, month - 1, 1)
    const lastDay = new Date(year, month, 0)
    const startPad = firstDay.getDay() === 0 ? 6 : firstDay.getDay() - 1
    const dailyMap = new Map(daily.map(d => [d.date, d]))
    const days: (DailySummary | null)[] = []
    for (let i = 0; i < startPad; i++) days.push(null)
    for (let d = 1; d <= lastDay.getDate(); d++) {
      const dateStr = `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
      days.push(dailyMap.get(dateStr) || null)
    }
    return days
  }, [viewMonth, daily])

  const monthLabel = (() => {
    const [y, m] = viewMonth.split('-').map(Number)
    return new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
  })()

  const canGoBack = dataRange.firstMonth && viewMonth > dataRange.firstMonth
  const canGoForward = dataRange.lastMonth && viewMonth < dataRange.lastMonth

  function shiftMonth(delta: number) {
    const [y, m] = viewMonth.split('-').map(Number)
    const d = new Date(y, m - 1 + delta, 1)
    const newMonth = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    if (dataRange.firstMonth && newMonth < dataRange.firstMonth) return
    if (dataRange.lastMonth && newMonth > dataRange.lastMonth) return
    setViewMonth(newMonth)
  }

  function spreadColor(spread: number): string {
    if (spread > 200) return 'bg-red-500'
    if (spread > 150) return 'bg-orange-400'
    if (spread > 100) return 'bg-yellow-400'
    if (spread > 50) return 'bg-green-300'
    return 'bg-green-100'
  }

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-3">
        <button onClick={() => shiftMonth(-1)} disabled={!canGoBack} aria-label="Previous month"
          className={`px-2 py-1 text-sm rounded ${canGoBack ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}>&larr;</button>
        <span className="font-semibold text-[#313131]">{monthLabel}</span>
        <button onClick={() => shiftMonth(1)} disabled={!canGoForward} aria-label="Next month"
          className={`px-2 py-1 text-sm rounded ${canGoForward ? 'hover:bg-gray-100 text-gray-700' : 'text-gray-300 cursor-not-allowed'}`}>&rarr;</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-xs">
        {['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'].map(d => (
          <div key={d} className="text-center text-gray-400 font-medium py-1">{d}</div>
        ))}
        {monthDays.map((day, i) => {
          if (!day) return <div key={`pad-${i}`} />
          const dayNum = parseInt(day.date.split('-')[2])
          const isSelected = day.date === selectedDate
          return (
            <button key={day.date} onClick={() => onSelect(day.date)}
              className={`relative p-1 rounded text-center transition-all hover:ring-2 hover:ring-[#EA1C0A]/50 ${isSelected ? 'ring-2 ring-[#EA1C0A] bg-[#EA1C0A]/5' : ''}`}
              title={`${day.date}: Spread ${day.spread.toFixed(0)} EUR/MWh`}>
              <div className="text-[10px] text-gray-600">{dayNum}</div>
              <div className={`w-full h-1.5 rounded-full mt-0.5 ${spreadColor(day.spread)}`} />
            </button>
          )
        })}
      </div>
      <div className="flex items-center gap-2 mt-3 text-[10px] text-gray-500">
        <span>Spread:</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-green-100 rounded" />Low</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-yellow-400 rounded" />Med</span>
        <span className="flex items-center gap-1"><span className="w-3 h-2 bg-red-500 rounded" />High</span>
      </div>
    </div>
  )
}

/* ────── Helpers ────── */
function nextDayStr(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

function fmtDateShort(dateStr: string): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}


/* ────── Main Component ────── */
export function Step2ChargingScenario({ prices, scenario, setScenario, optimization, onNext, onBack }: Props) {
  const energyPerSession = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weeklyPlugIns)
  const kmPerCharge = Math.round(scenario.yearlyMileageKm / (scenario.weeklyPlugIns * 52))
  const sessionsPerYear = scenario.weeklyPlugIns * 52
  const kwhPerYear = Math.round(energyPerSession * sessionsPerYear)
  const sessionMinutes = Math.round((energyPerSession / DEFAULT_CHARGE_POWER_KW) * 60)
  const sessionH = Math.floor(sessionMinutes / 60)
  const sessionM = sessionMinutes % 60
  const sessionLabel = sessionH > 0 ? `${sessionH}h ${sessionM > 0 ? `${sessionM}m` : ''}` : `${sessionM}m`

  const chartRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<'arrival' | 'departure' | null>(null)
  const [plotArea, setPlotArea] = useState<{ left: number; width: number; top: number; height: number } | null>(null)

  const date1 = prices.selectedDate
  const date2 = date1 ? nextDayStr(date1) : ''

  // ── Build two-day overnight chart data ──
  const { chartData, sessionCost, rollingAvgSavings, monthlySavings } = useMemo(() => {
    if (prices.hourly.length === 0 || !date1) {
      return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }
    }

    const day1Prices = prices.hourly.filter(p => p.date === date1 && p.hour >= 14)
    const day2Prices = prices.hourly.filter(p => p.date === date2 && p.hour <= 10)
    const merged = [...day1Prices, ...day2Prices]
    if (merged.length === 0) return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }

    const hoursNeeded = Math.ceil(energyPerSession / DEFAULT_CHARGE_POWER_KW)

    // Charging window prices
    const windowPrices = merged.filter(p => {
      if (p.date === date1) return p.hour >= scenario.plugInTime
      if (p.date === date2) return p.hour < scenario.departureTime
      return false
    })

    // Baseline: first N hours from plug-in
    const baselineKeys = new Set(windowPrices.slice(0, hoursNeeded).map(p => `${p.date}-${p.hour}`))
    // Optimized: cheapest N hours in window
    const sortedByPrice = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
    const optimizedKeys = new Set(sortedByPrice.slice(0, hoursNeeded).map(p => `${p.date}-${p.hour}`))

    let idx = 0
    const data = merged.map(p => {
      const key = `${p.date}-${p.hour}`
      const ct = Math.round((p.priceEurMwh / 10) * 100) / 100
      const isInWindow = (p.date === date1 && p.hour >= scenario.plugInTime) ||
                         (p.date === date2 && p.hour < scenario.departureTime)
      return {
        idx: idx++,
        hour: p.hour,
        date: p.date,
        label: `${String(p.hour).padStart(2, '0')}:00`,
        price: ct,
        baselinePrice: baselineKeys.has(key) ? ct : null,
        optimizedPrice: optimizedKeys.has(key) ? ct : null,
        isInWindow,
      }
    })

    // Compute costs
    const bPts = data.filter(d => d.baselinePrice !== null)
    const oPts = data.filter(d => d.optimizedPrice !== null)
    const bAvg = bPts.length > 0 ? bPts.reduce((s, d) => s + d.price, 0) / bPts.length : 0
    const oAvg = oPts.length > 0 ? oPts.reduce((s, d) => s + d.price, 0) / oPts.length : 0
    const cost = {
      baselineAvgCt: Math.round(bAvg * 100) / 100,
      optimizedAvgCt: Math.round(oAvg * 100) / 100,
      baselineEur: Math.round(bAvg * energyPerSession) / 100,
      optimizedEur: Math.round(oAvg * energyPerSession) / 100,
      savingsEur: Math.round((bAvg - oAvg) * energyPerSession) / 100,
      kwh: energyPerSession,
      baselineMidIdx: bPts.length > 0 ? bPts[Math.floor(bPts.length / 2)].idx : 0,
      optimizedMidIdx: oPts.length > 0 ? oPts[Math.floor(oPts.length / 2)].idx : 0,
    }

    // 365-day rolling average
    let totalSavings = 0, daysOk = 0
    const endDate = date1
    const startRoll = new Date(new Date(endDate + 'T12:00:00Z').getTime() - 365 * 86400000).toISOString().slice(0, 10)
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      if (p.date >= startRoll && p.date <= endDate) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
    }
    for (const [dDate, dPrices] of byDate) {
      const nd = nextDayStr(dDate)
      const nPrices = byDate.get(nd)
      if (!nPrices || nPrices.length === 0) continue
      const eve = dPrices.filter(p => p.hour >= scenario.plugInTime)
      const morn = nPrices.filter(p => p.hour < scenario.departureTime)
      const win = [...eve, ...morn]
      if (win.length < hoursNeeded) continue
      const bH = win.slice(0, hoursNeeded)
      const oH = [...win].sort((a, b) => a.priceEurMwh - b.priceEurMwh).slice(0, hoursNeeded)
      const bA = bH.reduce((s, p) => s + p.priceCtKwh, 0) / bH.length
      const oA = oH.reduce((s, p) => s + p.priceCtKwh, 0) / oH.length
      totalSavings += (bA - oA) * energyPerSession / 100
      daysOk++
    }
    const avgDaily = daysOk > 0 ? totalSavings / daysOk : 0
    const plugDaysMonth = (scenario.weeklyPlugIns / 7) * 30.44
    const mSav = Math.round(avgDaily * plugDaysMonth * 100) / 100
    const rollSav = Math.round(avgDaily * scenario.weeklyPlugIns * 52 * 100) / 100

    return { chartData: data, sessionCost: cost, rollingAvgSavings: rollSav, monthlySavings: mSav }
  }, [prices.hourly, date1, date2, energyPerSession, scenario.plugInTime, scenario.departureTime, scenario.weeklyPlugIns])

  // ── Measure actual plot area from rendered CartesianGrid ──
  useEffect(() => {
    const container = chartRef.current
    if (!container || chartData.length === 0) return
    function measure() {
      const grid = container!.querySelector('.recharts-cartesian-grid')
      if (!grid) return
      const gridRect = grid.getBoundingClientRect()
      const containerRect = container!.getBoundingClientRect()
      setPlotArea({
        left: gridRect.left - containerRect.left,
        width: gridRect.width,
        top: gridRect.top - containerRect.top,
        height: gridRect.height,
      })
    }
    const raf = requestAnimationFrame(measure)
    const ro = new ResizeObserver(measure)
    ro.observe(container)
    return () => { cancelAnimationFrame(raf); ro.disconnect() }
  }, [chartData])

  /** Convert a data index to a CSS left pixel position, aligned with Recharts */
  const getLeft = useCallback((idx: number, total: number): string => {
    if (!plotArea || total <= 1) return `${CHART_MARGIN.left}px`
    return `${plotArea.left + (idx / (total - 1)) * plotArea.width}px`
  }, [plotArea])

  // ── Drag logic ──
  const handleDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !chartRef.current || chartData.length === 0 || !plotArea) return
    const rect = chartRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const relX = clientX - rect.left
    const dataFraction = (relX - plotArea.left) / plotArea.width
    const dataIdx = Math.round(Math.max(0, Math.min(1, dataFraction)) * (chartData.length - 1))
    const point = chartData[dataIdx]
    if (!point) return

    if (isDragging === 'arrival' && point.date === date1 && point.hour >= 14 && point.hour <= 23) {
      setScenario({ ...scenario, plugInTime: point.hour })
    } else if (isDragging === 'departure' && point.date === date2 && point.hour >= 4 && point.hour <= 10) {
      setScenario({ ...scenario, departureTime: point.hour })
    }
  }, [isDragging, chartData, date1, date2, scenario, setScenario, plotArea])

  useEffect(() => {
    if (!isDragging) return
    const onUp = () => setIsDragging(null)
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('touchend', onUp) }
  }, [isDragging])

  // Key indices
  const arrivalIdx = chartData.findIndex(d => d.date === date1 && d.hour === scenario.plugInTime)
  const departureIdx = chartData.findIndex(d => d.date === date2 && d.hour === scenario.departureTime)
  const N = chartData.length

  const arrivalLabel = `${String(scenario.plugInTime).padStart(2, '0')}:00`
  const departureLabel = `${String(scenario.departureTime).padStart(2, '0')}:00`
  const midnightIdx = chartData.findIndex(d => d.date === date2 && d.hour === 0)

  // Compute charging blocks (contiguous hour ranges) for clear visualization
  // Band for hour at index i spans [i, i+1], clamped to [arrivalIdx, departureIdx]
  const { baselineRanges, optimizedRanges } = useMemo(() => {
    const aIdx = arrivalIdx >= 0 ? arrivalIdx : 0
    const dIdx = departureIdx >= 0 ? departureIdx : N - 1
    function findRanges(key: 'baselinePrice' | 'optimizedPrice') {
      const ranges: { x1: number; x2: number; startLabel: string; endHour: number; hours: number }[] = []
      let start: number | null = null, end: number | null = null, startLbl = '', count = 0
      for (const d of chartData) {
        if (d[key] !== null) {
          if (start === null) { start = d.idx; startLbl = d.label }
          end = d.idx; count++
        } else if (start !== null) {
          const endPt = chartData[end!]
          ranges.push({ x1: Math.max(start, aIdx), x2: Math.min(end! + 1, dIdx), startLabel: startLbl, endHour: (endPt.hour + 1) % 24, hours: count })
          start = null; end = null; count = 0
        }
      }
      if (start !== null) {
        const endPt = chartData[end!]
        ranges.push({ x1: Math.max(start, aIdx), x2: Math.min(end! + 1, dIdx), startLabel: startLbl, endHour: (endPt.hour + 1) % 24, hours: count })
      }
      return ranges
    }
    return { baselineRanges: findRanges('baselinePrice'), optimizedRanges: findRanges('optimizedPrice') }
  }, [chartData, arrivalIdx, departureIdx, N])

  const priceRange = useMemo(() => {
    if (chartData.length === 0) return { min: 0, max: 10 }
    const prices = chartData.map(d => d.price)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const pad = (max - min) * 0.05
    return { min: min - pad, max: max + pad }
  }, [chartData])

  const priceToY = (price: number) => {
    if (!plotArea) return CHART_MARGIN.top + 100
    const frac = (price - priceRange.min) / (priceRange.max - priceRange.min)
    return plotArea.top + (1 - frac) * plotArea.height
  }

  const mileageToPercent = (km: number) => ((km - SLIDER_MIN) / SLIDER_RANGE) * 100

  // X-axis tick
  // Explicit tick values — one per data point so Recharts places them at exact linear positions
  const xTicks = useMemo(() => chartData.map(d => d.idx), [chartData])

  const renderXTick = useCallback((props: { x: number; y: number; payload: { value: number } }) => {
    const { x, y, payload } = props
    const pt = chartData[payload.value]
    if (!pt) return <g />
    // Small tick line at every hour, label text every 2 hours
    const showLabel = pt.hour % 2 === 0
    return (
      <g transform={`translate(${x},${y})`}>
        <line x1={0} y1={0} x2={0} y2={showLabel ? 6 : 4} stroke="#D1D5DB" strokeWidth={1} />
        {showLabel && (
          <text x={0} y={0} dy={18} textAnchor="middle" fill="#9CA3AF" fontSize={11}>{pt.label}</text>
        )}
      </g>
    )
  }, [chartData])

  return (
    <div className="space-y-6">
      {/* Hero */}
      <div className="text-center mb-4">
        <h2 className="text-4xl font-bold text-[#313131] mb-2">
          Charge when electricity is cheap
        </h2>
        <p className="text-lg text-gray-500 max-w-2xl mx-auto">
          Your car is plugged in for hours overnight. Smart charging shifts consumption to the cheapest windows — same energy, lower cost.
        </p>
      </div>

      {/* ── Driving Profile ── */}
      <Card className="overflow-hidden">
        <CardHeader className="pb-3 bg-gradient-to-r from-gray-50 to-white border-b border-gray-100">
          <CardTitle className="text-sm font-semibold tracking-wide uppercase text-gray-500">Your Driving Profile</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-5">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* Mileage slider — distribution subtly below */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-gray-700">Yearly Mileage</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.yearlyMileageKm.toLocaleString('en-US')}<span className="text-sm font-normal text-gray-400 ml-1">km</span></span>
              </div>
              <input type="range" min={SLIDER_MIN} max={SLIDER_MAX} step={1000}
                value={scenario.yearlyMileageKm}
                onChange={(e) => setScenario({ ...scenario, yearlyMileageKm: Number(e.target.value) })}
                aria-label={`Yearly mileage: ${scenario.yearlyMileageKm} km`}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>5,000 km</span>
                <span>40,000 km</span>
              </div>
              {/* Subtle distribution bars below slider */}
              <div className="relative h-6 mt-0.5">
                {MILEAGE_DIST.map((bin, i) => {
                  const leftPct = ((bin.lo - SLIDER_MIN) / SLIDER_RANGE) * 100
                  const widthPct = ((bin.hi - bin.lo) / SLIDER_RANGE) * 100
                  const heightPct = (bin.pct / MAX_DIST_PCT) * 100
                  const isActive = scenario.yearlyMileageKm >= bin.lo && scenario.yearlyMileageKm <= bin.hi
                  return (
                    <div key={i} className="absolute bottom-0 rounded-sm transition-colors"
                      style={{
                        left: `${leftPct}%`, width: `calc(${widthPct}% - 1px)`, height: `${heightPct}%`,
                        background: isActive ? 'rgba(49,49,49,0.12)' : 'rgba(0,0,0,0.03)',
                      }} />
                  )
                })}
                <div className="absolute bottom-0 w-px h-full bg-gray-300" style={{ left: `${mileageToPercent(DE_AVG_MILEAGE)}%` }}>
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[8px] text-gray-400 font-medium whitespace-nowrap">avg</span>
                </div>
              </div>
              <p className="text-xs text-gray-400 text-center">
                {kwhPerYear.toLocaleString('en-US')} kWh/yr &middot; {AVG_CONSUMPTION_KWH_PER_100KM} kWh/100km
              </p>
            </div>

            {/* Weekly plug-ins — clean slider only */}
            <div className="space-y-2">
              <div className="flex items-baseline justify-between">
                <span className="text-sm font-medium text-gray-700">Weekly Plug-ins</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.weeklyPlugIns}<span className="text-sm font-normal text-gray-400 ml-1">x / week</span></span>
              </div>
              <input type="range" min={1} max={7} step={1} value={scenario.weeklyPlugIns}
                onChange={(e) => setScenario({ ...scenario, weeklyPlugIns: Number(e.target.value) })}
                aria-label={`Weekly plug-ins: ${scenario.weeklyPlugIns}`}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>1x</span>
                <span>daily</span>
              </div>
              <p className="text-xs text-gray-400 text-center">
                ~{sessionLabel} per session &middot; {DEFAULT_CHARGE_POWER_KW} kW wallbox
              </p>
            </div>

            {/* Derived stats */}
            <div className="flex flex-col justify-center items-center p-5 bg-gradient-to-br from-gray-50 to-gray-100/50 rounded-xl border border-gray-100">
              <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Per Charge Session</p>
              <p className="text-4xl font-bold text-[#313131] tabular-nums">~{energyPerSession}</p>
              <p className="text-sm text-gray-500 mt-0.5">kWh</p>
              <div className="w-12 h-px bg-gray-200 my-3" />
              <p className="text-sm text-gray-500">~{kmPerCharge} km range</p>
              <p className="text-xs text-gray-400 mt-1">{sessionsPerYear} sessions/year</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Chart + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Chart (3/4) */}
        <Card className="lg:col-span-3 overflow-hidden">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <CardTitle className="text-lg">Overnight Price Curve</CardTitle>
                <p className="text-sm text-gray-500 mt-0.5">
                  {date1 ? (
                    <>
                      <span className="font-medium text-gray-700">{fmtDateShort(date1)}</span>
                      <span className="text-gray-400"> 14:00</span>
                      <span className="text-gray-400 mx-1">&rarr;</span>
                      <span className="font-medium text-gray-700">{fmtDateShort(date2)}</span>
                      <span className="text-gray-400"> 10:00</span>
                    </>
                  ) : 'Select a date'}
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            {/* ── Chart container ── */}
            <div className="relative h-[400px] select-none"
              ref={chartRef}
              onMouseMove={isDragging ? handleDrag : undefined}
              onTouchMove={isDragging ? handleDrag : undefined}
              style={{ cursor: isDragging ? 'ew-resize' : undefined }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} margin={CHART_MARGIN}>
                  <defs>
                    <linearGradient id="priceGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#94A3B8" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="#94A3B8" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

                  <XAxis dataKey="idx" type="number" domain={[0, Math.max(chartData.length - 1, 1)]}
                    ticks={xTicks} tick={renderXTick as never} tickLine={false}
                    stroke="#9CA3AF" interval={0} height={40}
                    allowDecimals={false} />
                  <YAxis tick={{ fontSize: 11 }} stroke="#9CA3AF"
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 11, fill: '#9CA3AF' } }} />

                  {/* Custom tooltip — shows price once, indicates charging type */}
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const d = chartData[Number(label)]
                      if (!d) return null
                      return (
                        <div className="bg-white rounded-xl border border-gray-200 shadow-lg px-3 py-2 text-[13px]">
                          <p className="text-gray-500 text-xs mb-1">{fmtDateShort(d.date)} {d.label}</p>
                          <p className="font-semibold tabular-nums">{d.price.toFixed(2)} ct/kWh</p>
                          {d.baselinePrice !== null && (
                            <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-0.5 bg-red-500 rounded inline-block" /> Immediate charging
                            </p>
                          )}
                          {d.optimizedPrice !== null && (
                            <p className="text-emerald-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-0.5 bg-emerald-500 rounded inline-block" /> Optimized charging
                            </p>
                          )}
                        </div>
                      )
                    }} />

                  {/* Charging hour bands — clear colored backgrounds per block */}
                  {baselineRanges.map((r, i) => (
                    <ReferenceArea key={`b-${i}`} x1={r.x1} x2={r.x2} fill="#EF4444" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}
                  {optimizedRanges.map((r, i) => (
                    <ReferenceArea key={`o-${i}`} x1={r.x1} x2={r.x2} fill="#10B981" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}

                  {/* Base price curve — subtle gray */}
                  <Area type="monotone" dataKey="price" fill="url(#priceGrad)" stroke="none" />
                  <Line type="monotone" dataKey="price" stroke="#94A3B8" strokeWidth={1.5} dot={false} connectNulls />

                  {/* Baseline dots — red, no connecting line for clarity on non-contiguous hours */}
                  <Line type="monotone" dataKey="baselinePrice" stroke="#EF4444" strokeWidth={3}
                    dot={{ r: 3.5, fill: '#EF4444', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Optimized dots — green */}
                  <Line type="monotone" dataKey="optimizedPrice" stroke="#10B981" strokeWidth={3}
                    dot={{ r: 3.5, fill: '#10B981', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Midnight boundary — subtle solid line */}
                  {midnightIdx >= 0 && (
                    <ReferenceLine x={midnightIdx} stroke="#D1D5DB" strokeWidth={1.5} strokeDasharray="" />
                  )}

                  {/* Arrival reference line */}
                  {arrivalIdx >= 0 && (
                    <ReferenceLine x={arrivalIdx} stroke="#EA1C0A"
                      strokeWidth={isDragging === 'arrival' ? 4 : 3}
                      strokeOpacity={isDragging === 'arrival' ? 1 : 0.6} />
                  )}
                  {/* Departure reference line */}
                  {departureIdx >= 0 && (
                    <ReferenceLine x={departureIdx} stroke="#2563EB"
                      strokeWidth={isDragging === 'departure' ? 4 : 3}
                      strokeOpacity={isDragging === 'departure' ? 1 : 0.6} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>

              {/* ── Date labels at top, centered for each day's portion ── */}
              {N > 1 && plotArea && midnightIdx > 0 && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const midX = idxToPx(midnightIdx)
                const day1CenterX = (plotArea.left + midX) / 2
                const day2CenterX = (midX + plotArea.left + plotArea.width) / 2
                return (
                  <>
                    <div className="absolute pointer-events-none z-10 text-[11px] font-semibold text-gray-400"
                      style={{ left: day1CenterX, top: plotArea.top - 18, transform: 'translateX(-50%)' }}>
                      {fmtDateShort(date1)}
                    </div>
                    <div className="absolute pointer-events-none z-10 text-[11px] font-semibold text-gray-400"
                      style={{ left: day2CenterX, top: plotArea.top - 18, transform: 'translateX(-50%)' }}>
                      {fmtDateShort(date2)}
                    </div>
                  </>
                )
              })()}

              {/* ── Charging window labels at top, centered over respective areas ── */}
              {N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                // "Immediate" label centered over baseline charging area
                const bCenterX = baselineRanges.length > 0
                  ? baselineRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / baselineRanges.length
                  : null
                // "Optimized" label centered over optimized charging area
                const oCenterX = optimizedRanges.length > 0
                  ? optimizedRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / optimizedRanges.length
                  : null
                return (
                  <>
                    {bCenterX !== null && (
                      <div className="absolute pointer-events-none z-10 text-[10px] font-bold text-red-500/80"
                        style={{ left: bCenterX, top: plotArea.top - 30, transform: 'translateX(-50%)' }}>
                        Immediate
                      </div>
                    )}
                    {oCenterX !== null && (
                      <div className="absolute pointer-events-none z-10 text-[10px] font-bold text-emerald-500/80"
                        style={{ left: oCenterX, top: plotArea.top - 30, transform: 'translateX(-50%)' }}>
                        Optimized
                      </div>
                    )}
                  </>
                )
              })()}

              {/* ── Grey overlays OUTSIDE charging window ── */}
              {N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const aX = arrivalIdx >= 0 ? idxToPx(arrivalIdx) : plotArea.left
                const dX = departureIdx >= 0 ? idxToPx(departureIdx) : plotArea.left + plotArea.width
                return (
                  <>
                    {arrivalIdx > 0 && (
                      <div className="absolute pointer-events-none z-[5]"
                        style={{ left: plotArea.left, width: aX - plotArea.left, top: plotArea.top, height: plotArea.height, background: 'rgba(148, 163, 184, 0.13)' }} />
                    )}
                    {departureIdx >= 0 && departureIdx < N - 1 && (
                      <div className="absolute pointer-events-none z-[5]"
                        style={{ left: dX, width: plotArea.left + plotArea.width - dX, top: plotArea.top, height: plotArea.height, background: 'rgba(148, 163, 184, 0.13)' }} />
                    )}
                  </>
                )
              })()}

              {/* ── Floating cost labels — centered in charging area, close to line ── */}
              {sessionCost && N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                // Center X of baseline/optimized charging areas
                const bCenter = baselineRanges.length > 0
                  ? baselineRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / baselineRanges.length
                  : idxToPx(sessionCost.baselineMidIdx)
                const oCenter = optimizedRanges.length > 0
                  ? optimizedRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / optimizedRanges.length
                  : idxToPx(sessionCost.optimizedMidIdx)
                return (
                  <>
                    <div className="absolute pointer-events-none transition-all duration-300 ease-out z-10"
                      style={{ left: bCenter, top: priceToY(sessionCost.baselineAvgCt) + 14, transform: 'translateX(-50%)' }}>
                      <div className="bg-red-50/95 backdrop-blur-sm border border-red-200/80 rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                        <span className="text-red-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                          <AnimatedNumber value={sessionCost.baselineEur} decimals={2} suffix=" €" />
                        </span>
                        <span className="text-red-400 text-[9px] tabular-nums whitespace-nowrap">
                          {sessionCost.baselineAvgCt.toFixed(1)} ct
                        </span>
                      </div>
                    </div>
                    <div className="absolute pointer-events-none transition-all duration-300 ease-out z-10"
                      style={{ left: oCenter, top: priceToY(sessionCost.optimizedAvgCt) + 2, transform: 'translateX(-50%)' }}>
                      <div className="bg-emerald-50/95 backdrop-blur-sm border border-emerald-200/80 rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0" />
                        <span className="text-emerald-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                          <AnimatedNumber value={sessionCost.optimizedEur} decimals={2} suffix=" €" />
                        </span>
                        <span className="text-emerald-400 text-[9px] tabular-nums whitespace-nowrap">
                          {sessionCost.optimizedAvgCt.toFixed(1)} ct
                        </span>
                      </div>
                    </div>
                  </>
                )
              })()}

              {/* ── Drag handles — invisible touch targets + label pills ── */}
              {N > 1 && (
                <>
                  {/* ARRIVAL HANDLE */}
                  <div className="absolute transition-[left] duration-100 z-20" style={{
                    left: getLeft(arrivalIdx >= 0 ? arrivalIdx : 0, N),
                    top: 0, height: '100%', transform: 'translateX(-50%)',
                  }}>
                    <div className="relative h-full flex justify-center cursor-col-resize group"
                      style={{ width: 28 }}
                      onMouseDown={(e) => { e.preventDefault(); setIsDragging('arrival') }}
                      onTouchStart={(e) => { e.preventDefault(); setIsDragging('arrival') }}>
                      {/* Label above chart */}
                      <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap transition-all ${
                        isDragging === 'arrival' ? 'scale-105' : ''
                      }`} style={{ top: 4 }}>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border transition-colors ${
                          isDragging === 'arrival'
                            ? 'text-white bg-[#EA1C0A] border-[#EA1C0A]'
                            : 'text-[#EA1C0A] bg-white/95 border-red-200 group-hover:bg-red-50'
                        }`}>
                          {arrivalLabel}
                        </span>
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
                        style={{ bottom: 2 }}>
                        <span className="text-[9px] font-medium text-[#EA1C0A]/70">Plug-in</span>
                      </div>
                    </div>
                  </div>

                  {/* DEPARTURE HANDLE */}
                  <div className="absolute transition-[left] duration-100 z-20" style={{
                    left: getLeft(departureIdx >= 0 ? departureIdx : N - 1, N),
                    top: 0, height: '100%', transform: 'translateX(-50%)',
                  }}>
                    <div className="relative h-full flex justify-center cursor-col-resize group"
                      style={{ width: 28 }}
                      onMouseDown={(e) => { e.preventDefault(); setIsDragging('departure') }}
                      onTouchStart={(e) => { e.preventDefault(); setIsDragging('departure') }}>
                      <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap transition-all ${
                        isDragging === 'departure' ? 'scale-105' : ''
                      }`} style={{ top: 4 }}>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border transition-colors ${
                          isDragging === 'departure'
                            ? 'text-white bg-blue-600 border-blue-600'
                            : 'text-blue-600 bg-white/95 border-blue-200 group-hover:bg-blue-50'
                        }`}>
                          {departureLabel}
                        </span>
                      </div>
                      <div className="absolute left-1/2 -translate-x-1/2 whitespace-nowrap pointer-events-none"
                        style={{ bottom: 2 }}>
                        <span className="text-[9px] font-medium text-blue-500/70">Departure</span>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* Legend + charging schedule */}
            <div className="mt-2 flex flex-wrap items-center gap-x-5 gap-y-1 text-xs text-gray-500 px-1">
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-0.5 bg-gray-400 inline-block rounded" /> Spot price
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-1 bg-red-500 inline-block rounded" /> Immediate
              </span>
              <span className="flex items-center gap-1.5">
                <span className="w-5 h-1 bg-emerald-500 inline-block rounded" /> Optimized
              </span>
              <span className="text-gray-300">|</span>
              <span className="text-gray-400 italic ml-auto">Drag handles to adjust</span>
            </div>
            {/* Charging schedule blocks */}
            <div className="mt-1.5 flex flex-wrap gap-x-6 gap-y-1 text-[11px] px-1">
              {baselineRanges.length > 0 && (
                <span className="text-red-600">
                  Immediate: {baselineRanges.map(r => `${r.startLabel}–${String(r.endHour).padStart(2, '0')}:00 (${r.hours}h)`).join(', ')}
                </span>
              )}
              {optimizedRanges.length > 0 && (
                <span className="text-emerald-600">
                  Optimized: {optimizedRanges.map(r => `${r.startLabel}–${String(r.endHour).padStart(2, '0')}:00 (${r.hours}h)`).join(', ')}
                </span>
              )}
            </div>
          </CardContent>
        </Card>

        {/* ── Sidebar ── */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Select a Day</CardTitle>
            </CardHeader>
            <CardContent>
              <MiniCalendar daily={prices.daily} selectedDate={prices.selectedDate} onSelect={prices.setSelectedDate} />
            </CardContent>
          </Card>

          {sessionCost && (
            <Card className="border-[#EA1C0A]/20 bg-gradient-to-b from-white to-red-50/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">This Session</CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Immediate</span>
                  <span className="font-semibold text-red-600 tabular-nums">{sessionCost.baselineEur.toFixed(2)} EUR</span>
                </div>
                <div className="flex justify-between text-sm">
                  <span className="text-gray-600">Optimized</span>
                  <span className="font-semibold text-emerald-600 tabular-nums">{sessionCost.optimizedEur.toFixed(2)} EUR</span>
                </div>
                <div className="border-t pt-2">
                  <div className="flex justify-between items-center">
                    <span className="font-semibold text-sm">Savings</span>
                    <AnimatedNumber value={sessionCost.savingsEur} decimals={2} suffix=" EUR" className="text-xl font-bold text-[#EA1C0A] tabular-nums" />
                  </div>
                </div>
                <div className="text-xs text-gray-500 space-y-0.5 border-t pt-2">
                  <div className="flex justify-between"><span>Energy</span><span className="tabular-nums">{sessionCost.kwh} kWh</span></div>
                  <div className="flex justify-between"><span>Avg. immediate</span><span className="tabular-nums">{sessionCost.baselineAvgCt.toFixed(1)} ct/kWh</span></div>
                  <div className="flex justify-between"><span>Avg. optimized</span><span className="tabular-nums">{sessionCost.optimizedAvgCt.toFixed(1)} ct/kWh</span></div>
                </div>

                <div className="bg-[#EA1C0A]/5 rounded-xl p-3 text-center border border-[#EA1C0A]/10">
                  <p className="text-[10px] text-gray-500 uppercase tracking-wider mb-1">365-day avg &times; {sessionsPerYear} sessions</p>
                  <AnimatedNumber value={rollingAvgSavings} suffix=" EUR/yr" className="text-2xl font-bold text-[#EA1C0A] tabular-nums" />
                  <p className="text-xs text-gray-400 mt-1">~{monthlySavings.toFixed(1)} EUR/month</p>
                  <p className="text-[10px] text-gray-400 mt-1">Day-ahead load shifting — Layer 1 of 5</p>
                </div>
              </CardContent>
            </Card>
          )}

          {!sessionCost && (
            <Card className="border-gray-200">
              <CardContent className="pt-6 pb-6 text-center">
                <div className="w-10 h-10 border-4 border-[#EA1C0A] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
                <p className="text-sm text-gray-500">Computing optimal schedule...</p>
              </CardContent>
            </Card>
          )}
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
