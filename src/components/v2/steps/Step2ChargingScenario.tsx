'use client'

import { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, AVG_CONSUMPTION_KWH_PER_100KM, DEFAULT_CHARGE_POWER_KW, type ChargingScenario, type HourlyPrice, type DailySummary, type MonthlyStats } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
  Bar
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

// Typical EV plug-in time distribution (home charging, Germany)
// Based on smart-meter + BDEW load profile research: peak after-work return 17-18h
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
const MAX_PLUGIN_PCT = 27
const PLUGIN_HOUR_MIN = 14
const PLUGIN_HOUR_MAX = 22

// Chart margins — passed to Recharts (actual plot area measured from DOM)
const CHART_MARGIN = { top: 42, right: 15, bottom: 25, left: 50 }

interface PriceData {
  hourly: HourlyPrice[]
  hourlyQH: HourlyPrice[]
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

  // Set of all dates that have data — used to check t+1 availability
  const allDates = useMemo(() => new Set(daily.map(d => d.date)), [daily])

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
        <span className="text-sm font-bold text-[#313131]">{monthLabel}</span>
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
          // Check if t+1 data exists (required for overnight chart)
          const nd = new Date(day.date + 'T12:00:00Z')
          nd.setUTCDate(nd.getUTCDate() + 1)
          const nextDateStr = nd.toISOString().slice(0, 10)
          const hasNextDay = allDates.has(nextDateStr)
          return (
            <button key={day.date} onClick={() => hasNextDay && onSelect(day.date)}
              disabled={!hasNextDay}
              className={`relative p-1 rounded text-center transition-all ${
                !hasNextDay
                  ? 'opacity-30 cursor-not-allowed'
                  : `hover:ring-2 hover:ring-[#EA1C0A]/50 ${isSelected ? 'ring-2 ring-[#EA1C0A] bg-[#EA1C0A]/5' : ''}`
              }`}
              title={hasNextDay ? `${day.date}: Spread ${day.spread.toFixed(0)} EUR/MWh` : `${day.date}: no next-day data`}>
              <div className="text-[10px] text-gray-600">{dayNum}</div>
              <div className={`w-full h-1.5 rounded-full mt-0.5 ${hasNextDay ? spreadColor(day.spread) : 'bg-gray-200'}`} />
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

/**
 * Compute baseline vs optimized average price for a charging window.
 * Supports both hourly (slotsPerHour=1) and QH (slotsPerHour=4) modes.
 * In QH mode with hourly data, each hour counts as 4 slots at the same price,
 * allowing partial-hour charging (e.g. 6 slots = 1.5 hours at 7 kW = 10.5 kWh).
 */
function computeWindowSavings(
  windowPrices: HourlyPrice[],
  energyPerSession: number,
  kwhPerSlot: number,
  slotsPerHour: number,
): { bAvg: number; oAvg: number; savingsEur: number } {
  const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
  // Baseline: first N slots chronologically (each hour = slotsPerHour slots)
  let bSum = 0, bCount = 0
  for (const p of windowPrices) {
    const take = Math.min(slotsPerHour, slotsNeeded - bCount)
    if (take <= 0) break
    bSum += p.priceCtKwh * take
    bCount += take
  }
  // Optimized: cheapest N slots (sort by price, each hour = slotsPerHour slots)
  const sorted = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
  let oSum = 0, oCount = 0
  for (const p of sorted) {
    const take = Math.min(slotsPerHour, slotsNeeded - oCount)
    if (take <= 0) break
    oSum += p.priceCtKwh * take
    oCount += take
  }
  const bAvg = bCount > 0 ? bSum / bCount : 0
  const oAvg = oCount > 0 ? oSum / oCount : 0
  return { bAvg, oAvg, savingsEur: (bAvg - oAvg) * energyPerSession / 100 }
}


/* ────── Main Component ────── */
export function Step2ChargingScenario({ prices, scenario, setScenario }: Props) {
  const energyPerSession = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weeklyPlugIns)
  const kmPerCharge = Math.round(scenario.yearlyMileageKm / (scenario.weeklyPlugIns * 52))
  const sessionsPerYear = scenario.weeklyPlugIns * 52
  const kwhPerYear = Math.round(energyPerSession * sessionsPerYear)
  const sessionDurationHExact = energyPerSession / DEFAULT_CHARGE_POWER_KW
  const sessionHoursNeeded = Math.ceil(sessionDurationHExact)
  const sessionMinutes = Math.round(sessionDurationHExact * 60)
  const sessionH = Math.floor(sessionMinutes / 60)
  const sessionM = sessionMinutes % 60
  const sessionLabel = sessionH > 0 ? `${sessionH}h ${sessionM > 0 ? `${sessionM}m` : ''}` : `${sessionM}m`
  // Overnight window: spans midnight (plugInTime evening → departureTime morning)
  const windowHours = scenario.plugInTime < scenario.departureTime
    ? scenario.departureTime - scenario.plugInTime
    : (24 - scenario.plugInTime) + scenario.departureTime
  const flexibilityHours = windowHours - sessionHoursNeeded
  const baselineEndHour = (scenario.plugInTime + sessionHoursNeeded) % 24

  const chartRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<'arrival' | 'departure' | null>(null)
  const [heatmapUnit, setHeatmapUnit] = useState<'eur' | 'ct'>('eur')
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('hour')
  const [plotArea, setPlotArea] = useState<{ left: number; width: number; top: number; height: number } | null>(null)

  const date1 = prices.selectedDate
  const date2 = date1 ? nextDayStr(date1) : ''

  // Deferred scenario values — heavy computations (heatmap, monthly) use these
  // so they don't block the UI during handle dragging
  const deferredPlugInTime = useDeferredValue(scenario.plugInTime)
  const deferredDepartureTime = useDeferredValue(scenario.departureTime)
  const deferredWeeklyPlugIns = useDeferredValue(scenario.weeklyPlugIns)
  const deferredEnergyPerSession = useDeferredValue(energyPerSession)


  // ── Active price source for the chart (hourly or quarter-hourly) ──
  // SMARD filter 4169 provides real 15-min day-ahead prices; hourly = avg of 4 QH values
  const isQH = resolution === 'quarterhour'
  const chartPrices = isQH && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly

  // ── Build two-day overnight chart data ──
  const { chartData, sessionCost, rollingAvgSavings, monthlySavings } = useMemo(() => {
    if (chartPrices.length === 0 || !date1) {
      return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }
    }

    const day1Prices = chartPrices.filter(p => p.date === date1 && p.hour >= 14)
    const day2Prices = chartPrices.filter(p => p.date === date2 && p.hour <= 10)
    const merged = [...day1Prices, ...day2Prices]
    if (merged.length === 0) return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }

    // Each slot delivers: hourly = chargerKW * 1h, QH = chargerKW * 0.25h (=1.75 kWh at 7kW)
    const kwhPerSlot = isQH ? DEFAULT_CHARGE_POWER_KW * 0.25 : DEFAULT_CHARGE_POWER_KW
    const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)

    // Charging window prices
    const windowPrices = merged.filter(p => {
      if (p.date === date1) return p.hour >= scenario.plugInTime
      if (p.date === date2) return p.hour < scenario.departureTime
      return false
    })

    // Baseline: first N slots from plug-in
    const baselineKeys = new Set(windowPrices.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))
    // Optimized: cheapest N slots in window
    const sortedByPrice = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
    const optimizedKeys = new Set(sortedByPrice.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

    let idx = 0
    const data = merged.map(p => {
      const key = `${p.date}-${p.hour}-${p.minute ?? 0}`
      const ct = Math.round((p.priceEurMwh / 10) * 100) / 100
      const isInWindow = (p.date === date1 && p.hour >= scenario.plugInTime) ||
                         (p.date === date2 && p.hour < scenario.departureTime)
      const min = p.minute ?? 0
      return {
        idx: idx++,
        hour: p.hour,
        minute: min,
        date: p.date,
        label: `${String(p.hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
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
      baselineHours: windowPrices.slice(0, slotsNeeded).map(p => ({
        label: `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`,
        ct: Math.round((p.priceEurMwh / 10) * 100) / 100,
      })),
      optimizedHours: [...sortedByPrice.slice(0, slotsNeeded)]
        .sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0))
        .map(p => ({
          label: `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}`,
          ct: Math.round((p.priceEurMwh / 10) * 100) / 100,
        })),
    }

    // 365-day rolling average — uses hourly data with resolution-aware slot logic
    const rollKwhPerSlot = isQH ? DEFAULT_CHARGE_POWER_KW * 0.25 : DEFAULT_CHARGE_POWER_KW
    const rollSlotsPerHour = isQH ? 4 : 1
    const rollMinHours = Math.ceil(energyPerSession / DEFAULT_CHARGE_POWER_KW)
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
      if (win.length < rollMinHours) continue
      const { savingsEur } = computeWindowSavings(win, energyPerSession, rollKwhPerSlot, rollSlotsPerHour)
      totalSavings += savingsEur
      daysOk++
    }
    const avgDaily = daysOk > 0 ? totalSavings / daysOk : 0
    const plugDaysMonth = (scenario.weeklyPlugIns / 7) * 30.44
    const mSav = Math.round(avgDaily * plugDaysMonth * 100) / 100
    const rollSav = Math.round(avgDaily * scenario.weeklyPlugIns * 52 * 100) / 100

    return { chartData: data, sessionCost: cost, rollingAvgSavings: rollSav, monthlySavings: mSav }
  }, [chartPrices, prices.hourly, date1, date2, energyPerSession, scenario.plugInTime, scenario.departureTime, scenario.weeklyPlugIns, isQH])

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

  // ── Pre-compute overnight windows (shared by monthly + heatmap) ──
  // Uses deferred values so these heavy computations don't block during drag
  const overnightWindows = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      const arr = byDate.get(p.date) || []
      arr.push(p)
      byDate.set(p.date, arr)
    }
    const windows: { date: string; month: string; prices: HourlyPrice[]; sorted: HourlyPrice[] }[] = []
    for (const [dDate, dPrices] of byDate) {
      const nd = nextDayStr(dDate)
      const nPrices = byDate.get(nd)
      if (!nPrices || nPrices.length === 0) continue
      const eve = dPrices.filter(p => p.hour >= deferredPlugInTime)
      const morn = nPrices.filter(p => p.hour < deferredDepartureTime)
      const win = [...eve, ...morn]
      if (win.length === 0) continue
      const sorted = [...win].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
      windows.push({ date: dDate, month: dDate.slice(0, 7), prices: win, sorted })
    }
    return windows
  }, [prices.hourly, deferredPlugInTime, deferredDepartureTime])

  // ── Monthly savings breakdown for yearly chart ──
  const monthlySavingsData = useMemo(() => {
    if (overnightWindows.length === 0) return []
    const mKwhPerSlot = isQH ? DEFAULT_CHARGE_POWER_KW * 0.25 : DEFAULT_CHARGE_POWER_KW
    const mSlotsPerHour = isQH ? 4 : 1
    const minHours = Math.ceil(deferredEnergyPerSession / DEFAULT_CHARGE_POWER_KW)
    const monthMap = new Map<string, { totalSavings: number; days: number }>()
    for (const w of overnightWindows) {
      if (w.prices.length < minHours) continue
      const { savingsEur } = computeWindowSavings(w.prices, deferredEnergyPerSession, mKwhPerSlot, mSlotsPerHour)
      const entry = monthMap.get(w.month) || { totalSavings: 0, days: 0 }
      entry.totalSavings += savingsEur
      entry.days++
      monthMap.set(w.month, entry)
    }
    const plugDaysPerMonth = (deferredWeeklyPlugIns / 7) * 30.44
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const avgPerSession = data.days > 0 ? data.totalSavings / data.days : 0
        const monthlySav = Math.round(avgPerSession * plugDaysPerMonth * 100) / 100
        const [y, m] = month.split('-').map(Number)
        const label = new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'short' })
        const mNum = m
        const season: 'winter' | 'spring' | 'summer' | 'autumn' =
          mNum <= 2 || mNum === 12 ? 'winter' : mNum <= 5 ? 'spring' : mNum <= 8 ? 'summer' : 'autumn'
        return { month, label, savings: monthlySav, season, year: y }
      })
  }, [overnightWindows, deferredEnergyPerSession, deferredWeeklyPlugIns, isQH])

  // ── Separate overnight windows for heatmap (uses its own plug-in time slider) ──
  const heatmapOvernightWindows = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      const arr = byDate.get(p.date) || []
      arr.push(p)
      byDate.set(p.date, arr)
    }
    const windows: { date: string; month: string; prices: HourlyPrice[]; sorted: HourlyPrice[] }[] = []
    for (const [dDate, dPrices] of byDate) {
      const nd = nextDayStr(dDate)
      const nPrices = byDate.get(nd)
      if (!nPrices || nPrices.length === 0) continue
      const eve = dPrices.filter(p => p.hour >= deferredPlugInTime)
      const morn = nPrices.filter(p => p.hour < deferredDepartureTime)
      const win = [...eve, ...morn]
      if (win.length === 0) continue
      const sorted = [...win].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
      windows.push({ date: dDate, month: dDate.slice(0, 7), prices: win, sorted })
    }
    return windows
  }, [prices.hourly, deferredPlugInTime, deferredDepartureTime])

  // ── Heatmap data: savings for different mileage × plug-in combinations ──
  // Uses the same last-12-month window as the monthly savings chart for consistency
  const heatmapData = useMemo(() => {
    if (heatmapOvernightWindows.length === 0) return []
    const hKwhPerSlot = isQH ? DEFAULT_CHARGE_POWER_KW * 0.25 : DEFAULT_CHARGE_POWER_KW
    const hSlotsPerHour = isQH ? 4 : 1
    // Identify the same 12 months shown in the savings chart
    const allMonths = [...new Set(heatmapOvernightWindows.map(w => w.month))].sort()
    const last12Months = new Set(allMonths.slice(-12))
    const windows = heatmapOvernightWindows.filter(w => last12Months.has(w.month))
    const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
    const plugins = [1, 2, 3, 4, 5, 6, 7]
    const grid: { mileage: number; plugIns: number; savings: number; spreadCt: number; kwhPerSession: number }[] = []
    for (const mil of mileages) {
      for (const pi of plugins) {
        const eps = deriveEnergyPerSession(mil, pi)
        const minHours = Math.ceil(eps / DEFAULT_CHARGE_POWER_KW)
        let totalSav = 0, totalSpread = 0, days = 0
        for (const w of windows) {
          if (w.prices.length < minHours) continue
          const { bAvg, oAvg, savingsEur } = computeWindowSavings(w.prices, eps, hKwhPerSlot, hSlotsPerHour)
          totalSav += savingsEur
          totalSpread += bAvg - oAvg
          days++
        }
        const avgPerSession = days > 0 ? totalSav / days : 0
        const avgSpreadCt = days > 0 ? Math.round((totalSpread / days) * 100) / 100 : 0
        const plugDaysPerMonth = (pi / 7) * 30.44
        const yearlySav = Math.round(avgPerSession * plugDaysPerMonth * 12 * 100) / 100
        grid.push({ mileage: mil, plugIns: pi, savings: yearlySav, spreadCt: avgSpreadCt, kwhPerSession: eps })
      }
    }
    return grid
  }, [heatmapOvernightWindows, isQH])

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
    // For QH: tick line at every :00, label every 2 hours; for hourly: same as before
    const isOnHour = pt.minute === 0
    const showTick = isQH ? isOnHour : true
    const showLabel = isOnHour && pt.hour % 2 === 0
    if (!showTick) return <g />
    return (
      <g transform={`translate(${x},${y})`}>
        <line x1={0} y1={0} x2={0} y2={showLabel ? 6 : 4} stroke="#D1D5DB" strokeWidth={1} />
        {showLabel && (
          <text x={0} y={0} dy={18} textAnchor="middle" fill="#6B7280" fontSize={12} fontWeight={500}>
            {`${String(pt.hour).padStart(2, '0')}:00`}
          </text>
        )}
      </g>
    )
  }, [chartData, isQH])

  return (
    <div className="space-y-8">
      {/* ── Driving Profile ── */}
      <Card className="overflow-hidden shadow-sm border-gray-200/80">
        <CardHeader className="pb-3 bg-gray-50/80 border-b border-gray-100">
          <CardTitle className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">Your Driving Profile</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-6">
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 lg:gap-8">
            {/* Mileage slider — distribution subtly below */}
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Yearly Mileage</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.yearlyMileageKm.toLocaleString('en-US')}<span className="text-xs font-normal text-gray-400 ml-1">km</span></span>
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
              {/* Mileage distribution bars */}
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
              <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                {kwhPerYear.toLocaleString('en-US')} kWh/yr · {AVG_CONSUMPTION_KWH_PER_100KM} kWh/100km
              </p>
            </div>

            {/* Weekly plug-ins */}
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weekly Plug-ins</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.weeklyPlugIns}<span className="text-xs font-normal text-gray-400 ml-1">x / week</span></span>
              </div>
              <input type="range" min={1} max={7} step={1} value={scenario.weeklyPlugIns}
                onChange={(e) => setScenario({ ...scenario, weeklyPlugIns: Number(e.target.value) })}
                aria-label={`Weekly plug-ins: ${scenario.weeklyPlugIns}`}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>1x</span>
                <span>daily</span>
              </div>
              {/* Spacer to align with distribution bars in other columns */}
              <div className="h-6 mt-0.5 flex items-center justify-center gap-0.5">
                {Array.from({ length: 7 }, (_, i) => (
                  <div key={i} className={`h-4 flex-1 rounded-sm transition-colors ${i < scenario.weeklyPlugIns ? 'bg-[#313131]/20' : 'bg-gray-100'}`} />
                ))}
              </div>
              <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                ~{sessionLabel} per session · {DEFAULT_CHARGE_POWER_KW} kW wallbox
              </p>
            </div>

            {/* Typical Plug-in Time — with distribution */}
            <div className="space-y-2.5">
              <div className="flex items-baseline justify-between">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Plug-in Time</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{String(scenario.plugInTime).padStart(2, '0')}<span className="text-xs font-normal text-gray-400 ml-0.5">:00</span></span>
              </div>
              <input type="range" min={PLUGIN_HOUR_MIN} max={PLUGIN_HOUR_MAX} step={1}
                value={scenario.plugInTime}
                onChange={(e) => setScenario({ ...scenario, plugInTime: Number(e.target.value) })}
                aria-label={`Typical plug-in time: ${scenario.plugInTime}:00`}
                className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              <div className="flex justify-between text-[10px] text-gray-400">
                <span>14:00</span>
                <span>22:00</span>
              </div>
              {/* Plug-in time distribution bars (reference: typical German EV driver) */}
              <div className="relative h-6 mt-0.5 flex items-end gap-px">
                {PLUGIN_TIME_DIST.map((bin) => {
                  const heightPct = (bin.pct / MAX_PLUGIN_PCT) * 100
                  const isActive = bin.hour === scenario.plugInTime
                  return (
                    <div key={bin.hour} className="flex-1 rounded-sm transition-all"
                      style={{
                        height: `${heightPct}%`,
                        background: isActive ? 'rgba(0,0,0,0.25)' : 'rgba(0,0,0,0.06)',
                      }}
                      title={`${bin.hour}:00 — ${bin.pct}% of drivers`} />
                  )
                })}
              </div>
              <p className="text-[11px] text-gray-400 text-center leading-relaxed">
                Baseline arrival · also draggable on chart
              </p>
            </div>

            {/* Derived stats */}
            <div className="flex flex-col justify-center items-center p-5 bg-gray-50/80 rounded-xl border border-gray-200/60">
              <p className="text-[11px] font-semibold text-gray-400 uppercase tracking-widest mb-3">Per Session</p>
              <p className="text-4xl font-extrabold text-[#313131] tabular-nums leading-none">~{energyPerSession}</p>
              <p className="text-sm font-medium text-gray-500 mt-1">kWh</p>
              <div className="w-10 h-px bg-gray-200 my-3" />
              <p className="text-sm text-gray-600 font-medium">~{kmPerCharge} km range</p>
              <p className="text-xs text-gray-400 mt-1.5">{sessionsPerYear} sessions/year</p>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Chart + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Chart (3/4) */}
        <Card className="lg:col-span-3 overflow-hidden shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-[#313131]">Overnight Price Curve</CardTitle>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {isQH ? 'Day-Ahead 15-min Auction' : 'Day-Ahead Hourly Auction'}
                </p>
              </div>
              <div className="flex items-center gap-1.5 bg-gray-100 rounded-full p-0.5">
                <button onClick={() => setResolution('hour')}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'hour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                  60 min
                </button>
                <button onClick={() => setResolution('quarterhour')}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'quarterhour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                  15 min
                </button>
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
                  <YAxis tick={{ fontSize: 12, fontWeight: 500 }} stroke="#9CA3AF"
                    label={{ value: 'ct/kWh Day-Ahead Spot Price', angle: -90, position: 'insideLeft', offset: -8, style: { fontSize: 11, fill: '#6B7280', fontWeight: 400 } }} />

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
                  <Line type="monotone" dataKey="price" stroke="#94A3B8" strokeWidth={1.5}
                    dot={isQH ? { r: 1.5, fill: '#94A3B8', stroke: 'none' } : false}
                    activeDot={isQH ? { r: 4, fill: '#94A3B8', stroke: '#fff', strokeWidth: 2 } : undefined}
                    connectNulls />

                  {/* Baseline dots — red, no connecting line for clarity on non-contiguous hours */}
                  <Line type="monotone" dataKey="baselinePrice" stroke="#EF4444" strokeWidth={isQH ? 2 : 3}
                    dot={isQH ? { r: 2, fill: '#EF4444', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#EF4444', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Optimized dots — green */}
                  <Line type="monotone" dataKey="optimizedPrice" stroke="#10B981" strokeWidth={isQH ? 2 : 3}
                    dot={isQH ? { r: 2, fill: '#10B981', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#10B981', stroke: '#fff', strokeWidth: 1.5 }}
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

              {/* ── Date labels — centered over each day's half ── */}
              {N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const midX = midnightIdx >= 0 ? idxToPx(midnightIdx) : plotArea.left + plotArea.width / 2
                const day1Center = plotArea.left + (midX - plotArea.left) / 2
                const day2Center = midX + (plotArea.left + plotArea.width - midX) / 2
                return (
                  <>
                    <div className="absolute pointer-events-none z-[6] text-[11px] font-semibold text-gray-400"
                      style={{ left: day1Center, top: plotArea.top + 6, transform: 'translateX(-50%)' }}>
                      {fmtDateShort(date1)}
                    </div>
                    <div className="absolute pointer-events-none z-[6] text-[11px] font-semibold text-gray-400"
                      style={{ left: day2Center, top: plotArea.top + 6, transform: 'translateX(-50%)' }}>
                      {fmtDateShort(date2)}
                    </div>
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

              {/* ── Floating cost labels with type tag — track their lines ── */}
              {sessionCost && N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const bCenter = baselineRanges.length > 0
                  ? baselineRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / baselineRanges.length
                  : idxToPx(sessionCost.baselineMidIdx)
                const oCenter = optimizedRanges.length > 0
                  ? optimizedRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / optimizedRanges.length
                  : idxToPx(sessionCost.optimizedMidIdx)
                const bY = priceToY(sessionCost.baselineAvgCt)
                const oY = priceToY(sessionCost.optimizedAvgCt)
                // Position: baseline below its line, optimized above its line
                // Each pill is ~28px tall (label 14px + pill 14px gap), need 56px separation
                const minGap = 56
                let bYAdj = bY + 8, oYAdj = oY - 48
                if (bYAdj - oYAdj < minGap) {
                  const mid = (bYAdj + oYAdj) / 2
                  bYAdj = mid + minGap / 2
                  oYAdj = mid - minGap / 2
                }
                oYAdj = Math.max(plotArea.top + 2, Math.min(oYAdj, plotArea.top + plotArea.height - 48))
                bYAdj = Math.max(plotArea.top + 2, Math.min(bYAdj, plotArea.top + plotArea.height - 48))
                return (
                  <>
                    {/* Baseline (Immediate) */}
                    <div className="absolute pointer-events-none transition-all duration-300 ease-out z-10"
                      style={{ left: bCenter, top: bYAdj, transform: 'translateX(-50%)' }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">Immediate</span>
                        <div className="bg-red-50/95 backdrop-blur-sm border border-red-200/80 rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                          <span className="text-red-700 text-[12px] font-bold tabular-nums whitespace-nowrap">
                            <AnimatedNumber value={sessionCost.baselineEur} decimals={2} suffix=" €" />
                          </span>
                          <span className="text-red-400 text-[10px] tabular-nums whitespace-nowrap">
                            {sessionCost.baselineAvgCt.toFixed(1)} ct
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Optimized */}
                    <div className="absolute pointer-events-none transition-all duration-300 ease-out z-10"
                      style={{ left: oCenter, top: oYAdj, transform: 'translateX(-50%)' }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Optimized</span>
                        <div className="bg-emerald-50/95 backdrop-blur-sm border border-emerald-200/80 rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0" />
                          <span className="text-emerald-700 text-[12px] font-bold tabular-nums whitespace-nowrap">
                            <AnimatedNumber value={sessionCost.optimizedEur} decimals={2} suffix=" €" />
                          </span>
                          <span className="text-emerald-400 text-[10px] tabular-nums whitespace-nowrap">
                            {sessionCost.optimizedAvgCt.toFixed(1)} ct
                          </span>
                        </div>
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
                      <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap transition-all ${
                        isDragging === 'arrival' ? 'scale-105' : ''
                      }`} style={{ top: 4 }}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border transition-colors ${
                            isDragging === 'arrival'
                              ? 'text-white bg-[#EA1C0A] border-[#EA1C0A]'
                              : 'text-[#EA1C0A] bg-white/95 border-red-200 group-hover:bg-red-50'
                          }`}>
                            Plug-in {arrivalLabel}
                          </span>
                        </div>
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
                        <div className="flex flex-col items-center gap-0.5">
                          <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border transition-colors ${
                            isDragging === 'departure'
                              ? 'text-white bg-blue-600 border-blue-600'
                              : 'text-blue-600 bg-white/95 border-blue-200 group-hover:bg-blue-50'
                          }`}>
                            Departure {departureLabel}
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                </>
              )}
            </div>

            {/* SMARD source link */}
            {date1 && (() => {
              const d = new Date(date1 + 'T12:00:00Z')
              const day = d.getUTCDay()
              const mondayOffset = day === 0 ? -6 : 1 - day
              const monday = new Date(d)
              monday.setUTCDate(monday.getUTCDate() + mondayOffset)
              monday.setUTCHours(0, 0, 0, 0)
              const ts = monday.getTime()
              const smardPageUrl = `https://www.smard.de/home/marktdaten?marketDataAttributes=%7B%22resolution%22:%22hour%22,%22from%22:${ts},%22to%22:${ts + 7 * 86400000},%22moduleIds%22:%5B8004169%5D,%22selectedCategory%22:null,%22activeChart%22:true,%22style%22:%22color%22,%22categoriesModuleOrder%22:%7B%7D,%22region%22:%22DE%22%7D`
              return (
                <div className="flex items-center gap-3 mt-1 px-1 text-[10px] text-gray-400">
                  <span>Source:</span>
                  <a href={smardPageUrl} target="_blank" rel="noopener noreferrer"
                    className="hover:text-gray-600 underline underline-offset-2">
                    SMARD.de — Day-Ahead Prices
                  </a>
                </div>
              )
            })()}

          </CardContent>
        </Card>

        {/* ── Sidebar ── */}
        <div className="h-full">
          <Card className="h-full flex flex-col shadow-sm border-gray-200/80">
            <CardHeader className="pb-2 border-b border-gray-100">
              <CardTitle className="text-sm font-bold text-[#313131]">Select a Day</CardTitle>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <MiniCalendar daily={prices.daily} selectedDate={prices.selectedDate} onSelect={prices.setSelectedDate} />

              {/* Spread: arrival price vs. lowest night price */}
              {(() => {
                if (!date1 || chartData.length === 0) return null
                const arrivalPt = chartData.find(d => d.date === date1 && d.hour === scenario.plugInTime)
                const windowPts = chartData.filter(d => d.isInWindow)
                if (!arrivalPt || windowPts.length === 0) return null
                const lowestPrice = Math.min(...windowPts.map(d => d.price))
                const spread = Math.round((arrivalPt.price - lowestPrice) * 100) / 100
                return (
                  <div className="mt-4 pt-3 border-t border-gray-100">
                    <div className="flex items-baseline justify-between">
                      <span className="text-[11px] text-gray-500 font-medium">Spread</span>
                      <span className="text-lg font-bold tabular-nums text-[#313131]">
                        {spread.toFixed(2)}<span className="text-xs font-normal text-gray-400 ml-0.5">ct/kWh</span>
                      </span>
                    </div>
                    <p className="text-[10px] text-gray-400 mt-1 leading-relaxed">
                      Arrival ({arrivalPt.price.toFixed(1)} ct) vs. lowest night ({lowestPrice.toFixed(1)} ct)
                    </p>
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Session Cost Breakdown  +  Monthly Savings Potential ── */}
      {sessionCost && monthlySavingsData.length > 0 && (() => {
        const SEASON_COLORS: Record<string, string> = {
          winter: '#7EB8E8',
          spring: '#6AC09A',
          summer: '#E8C94A',
          autumn: '#E8A066',
        }
        // Derive avg-per-session from rolling annual figure for methodology display
        const avgDailyEur = sessionsPerYear > 0 ? rollingAvgSavings / sessionsPerYear : 0
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">

            {/* ── LEFT: Session Cost Breakdown ── */}
            <Card className="shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Session Cost Breakdown</CardTitle>
                <p className="text-[11px] text-gray-400 mt-1 leading-relaxed">
                  {sessionsPerYear} sessions/yr · {energyPerSession} kWh · {sessionHoursNeeded}h charge ·{' '}
                  {windowHours}h window ·{' '}
                  <span className={`font-semibold ${flexibilityHours > 3 ? 'text-emerald-600' : flexibilityHours > 0 ? 'text-amber-600' : 'text-red-500'}`}>
                    {flexibilityHours}h flex
                  </span>
                </p>
              </CardHeader>
              <CardContent className="pt-5 space-y-4 flex-1">

                {/* Hour-by-hour price table */}
                <div className="grid grid-cols-2 gap-3">
                  {/* Immediate */}
                  <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
                    <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2.5">
                      Immediate · first {isQH ? `${sessionHoursNeeded * 4} × 15 min` : `${sessionHoursNeeded}h`}
                    </p>
                    <div className="space-y-1">
                      {sessionCost.baselineHours.map((h, i) => (
                        <div key={i} className="flex justify-between text-[12px] leading-snug">
                          <span className="font-mono text-gray-500">{h.label}</span>
                          <span className="tabular-nums font-semibold text-red-700">{h.ct.toFixed(1)} ct</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-red-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
                      <span className="text-gray-500 font-medium">avg</span>
                      <span className="font-bold text-red-700 tabular-nums">{sessionCost.baselineAvgCt.toFixed(1)} ct/kWh</span>
                    </div>
                  </div>

                  {/* Optimized */}
                  <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-100/80">
                    <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2.5">
                      Optimized · cheapest {isQH ? `${sessionHoursNeeded * 4} × 15 min` : `${sessionHoursNeeded}h`}
                    </p>
                    <div className="space-y-1">
                      {sessionCost.optimizedHours.map((h, i) => (
                        <div key={i} className="flex justify-between text-[12px] leading-snug">
                          <span className="font-mono text-gray-500">{h.label}</span>
                          <span className="tabular-nums font-semibold text-emerald-700">{h.ct.toFixed(1)} ct</span>
                        </div>
                      ))}
                    </div>
                    <div className="border-t border-emerald-200/80 mt-2.5 pt-2 flex justify-between text-[12px]">
                      <span className="text-gray-500 font-medium">avg</span>
                      <span className="font-bold text-emerald-700 tabular-nums">{sessionCost.optimizedAvgCt.toFixed(1)} ct/kWh</span>
                    </div>
                  </div>
                </div>

                {/* Cost formula chain */}
                <div className="bg-gray-50/80 rounded-lg px-3.5 py-3 text-[11px] space-y-1.5 border border-gray-200/60">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">Formula: avg ct x kWh / 100 = EUR</p>
                  <div className="flex justify-between text-gray-500">
                    <span className="font-mono">{sessionCost.baselineAvgCt.toFixed(1)} ct × {sessionCost.kwh} kWh ÷ 100</span>
                    <span className="font-semibold text-red-600 tabular-nums">{sessionCost.baselineEur.toFixed(2)} EUR</span>
                  </div>
                  <div className="flex justify-between text-gray-500">
                    <span className="font-mono">{sessionCost.optimizedAvgCt.toFixed(1)} ct × {sessionCost.kwh} kWh ÷ 100</span>
                    <span className="font-semibold text-emerald-600 tabular-nums">{sessionCost.optimizedEur.toFixed(2)} EUR</span>
                  </div>
                  <div className="flex justify-between border-t border-gray-200 pt-1.5 mt-0.5">
                    <span className="font-mono text-gray-400">
                      ({sessionCost.baselineAvgCt.toFixed(1)} − {sessionCost.optimizedAvgCt.toFixed(1)}) × {sessionCost.kwh} ÷ 100
                    </span>
                    <AnimatedNumber value={sessionCost.savingsEur} decimals={2} suffix=" EUR" className="font-bold text-[#EA1C0A] tabular-nums" />
                  </div>
                </div>

                {/* Baseline end time note */}
                <p className="text-[10px] text-gray-400 leading-relaxed">
                  Immediate: plug-in at{' '}
                  <span className="font-mono">{String(scenario.plugInTime).padStart(2, '0')}:00</span> → done by{' '}
                  <span className="font-mono">{String(baselineEndHour).padStart(2, '0')}:00</span>.
                  Optimized shifts the same {sessionHoursNeeded}h to the cheapest slot in the {windowHours}h window.
                </p>
              </CardContent>
            </Card>

            {/* ── RIGHT: Monthly Savings Potential + rolling avg methodology ── */}
            <Card className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
              <CardHeader className="pb-3 border-b border-gray-100">
                <CardTitle className="text-base font-bold text-[#313131]">Monthly Savings Potential</CardTitle>
                <p className="text-[11px] text-gray-500 mt-1">
                  {scenario.weeklyPlugIns}x/week · {energyPerSession} kWh/session · day-ahead spot shifting
                </p>
              </CardHeader>
              <CardContent className="pt-5 space-y-4 flex-1 flex flex-col">
                {/* Bar chart — last 12 months of rolling window + cumulative line */}
                {(() => {
                  const SEASON_BG: Record<string, string> = {
                    winter: '#EFF6FF', spring: '#F0FDF4', summer: '#FEFCE8', autumn: '#FFF7ED',
                  }
                  // Last 12 months only (matches rolling 365-day avg)
                  const last12 = monthlySavingsData.slice(-12).map(d => ({
                    ...d,
                    displayLabel: d.label === 'Jan' ? `Jan '${String(d.year).slice(2)}` : d.label,
                  }))
                  // Add running cumulative sum for double-check line
                  let runSum = 0
                  const last12c = last12.map(d => { runSum += d.savings; return { ...d, cumulative: Math.round(runSum * 10) / 10 } })

                  // Season background bands
                  const bands: { x1: string; x2: string; season: string }[] = []
                  let cur = '', start = ''
                  for (let i = 0; i < last12c.length; i++) {
                    const d = last12c[i]
                    if (d.season !== cur) {
                      if (cur && start) bands.push({ x1: start, x2: last12c[i - 1].displayLabel, season: cur })
                      cur = d.season; start = d.displayLabel
                    }
                  }
                  if (cur && start) bands.push({ x1: start, x2: last12c[last12c.length - 1].displayLabel, season: cur })

                  const totalSum = last12c[last12c.length - 1]?.cumulative ?? 0

                  return (
                    <>
                      <div className="flex-1 min-h-[180px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <ComposedChart data={last12c} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
                            {/* Season background overlays */}
                            {bands.map((b, i) => (
                              <ReferenceArea key={i} x1={b.x1} x2={b.x2}
                                fill={SEASON_BG[b.season] || '#F9FAFB'} fillOpacity={1} ifOverflow="hidden" />
                            ))}
                            <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                            <XAxis dataKey="displayLabel" tick={{ fontSize: 11, fontWeight: 500, fill: '#6B7280' }} tickLine={false} axisLine={false} />
                            <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                              label={{ value: 'EUR/mo', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                            <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                              label={{ value: 'EUR cumul.', angle: 90, position: 'insideRight', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                            <Tooltip
                              content={({ active, payload }) => {
                                if (!active || !payload?.length) return null
                                const d = payload[0].payload as (typeof last12c)[number]
                                const color = SEASON_COLORS[d.season] || '#6B7280'
                                return (
                                  <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                                    <p className="text-gray-500 text-[10px]">{d.month} · {d.season}</p>
                                    <p className="font-semibold tabular-nums" style={{ color }}>{d.savings.toFixed(2)} EUR/mo</p>
                                    <p className="text-gray-400 tabular-nums text-[10px]">∑ {d.cumulative.toFixed(1)} EUR so far</p>
                                  </div>
                                )
                              }} />
                            <Bar yAxisId="left" dataKey="savings" radius={[3, 3, 0, 0]} maxBarSize={28}
                              // eslint-disable-next-line @typescript-eslint/no-explicit-any
                              shape={((props: any) => {
                                const { x = 0, y = 0, width = 0, height = 0, season = '' } = props as { x: number; y: number; width: number; height: number; season: string }
                                const fill = SEASON_COLORS[season] || '#6B7280'
                                return <rect x={x} y={y} width={width} height={Math.max(height, 0)} rx={3} ry={3} fill={fill} fillOpacity={0.75} />
                              }) as any} />
                            <Line yAxisId="right" dataKey="cumulative" type="monotone"
                              stroke="#374151" strokeWidth={1.5} strokeDasharray="4 3"
                              dot={false} activeDot={{ r: 3, fill: '#374151' }} />
                          </ComposedChart>
                        </ResponsiveContainer>
                      </div>
                      {/* Season legend + cumulative note */}
                      <div className="flex items-center justify-between text-[10px] text-gray-500 flex-wrap gap-2">
                        <div className="flex items-center gap-3">
                          {(['winter', 'spring', 'summer', 'autumn'] as const).map(s => (
                            <span key={s} className="flex items-center gap-1 capitalize">
                              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: SEASON_COLORS[s], opacity: 0.75 }} />
                              {s}
                            </span>
                          ))}
                        </div>
                        <span className="flex items-center gap-1.5 text-gray-400">
                          <span className="inline-block w-6 border-t border-dashed border-gray-400" />
                          ∑ {totalSum.toFixed(0)} EUR ≈ {rollingAvgSavings.toFixed(0)} EUR/yr
                        </span>
                      </div>
                    </>
                  )
                })()}

                {/* Rolling average methodology */}
                <div className="bg-gray-50/80 rounded-lg border border-gray-200/60 px-3.5 py-3 space-y-1.5">
                  <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Rolling 365-day average — how the yearly total is derived
                  </p>
                  <div className="grid grid-cols-[1fr_auto] gap-x-3 gap-y-1 text-[11px]">
                    <span className="text-gray-500 font-mono">avg savings / session</span>
                    <span className="tabular-nums font-semibold text-gray-700 text-right">{avgDailyEur.toFixed(3)} EUR</span>
                    <span className="text-gray-500 font-mono">× {scenario.weeklyPlugIns} plug-ins/wk × 52 wk</span>
                    <span className="tabular-nums font-semibold text-gray-700 text-right">= {sessionsPerYear} sessions</span>
                    <span className="text-gray-400 font-mono col-span-2 border-t border-gray-200 pt-1.5 mt-0.5 flex justify-between">
                      <span>{avgDailyEur.toFixed(3)} × {sessionsPerYear}</span>
                      <AnimatedNumber value={rollingAvgSavings} decimals={0} suffix=" EUR/yr" className="font-bold text-[#EA1C0A] tabular-nums" />
                    </span>
                  </div>
                  <p className="text-[10px] text-gray-400 pt-1">
                    ~{monthlySavings.toFixed(1)} EUR/month · day-ahead load shifting
                  </p>
                </div>
              </CardContent>
            </Card>

          </div>
        )
      })()}

      {/* loading state when sessionCost not yet ready */}
      {!sessionCost && monthlySavingsData.length === 0 && (
        <Card className="shadow-sm border-gray-200/80">
          <CardContent className="py-10 text-center">
            <div className="w-8 h-8 border-[3px] border-[#EA1C0A] border-t-transparent rounded-full animate-spin mx-auto mb-4" />
            <p className="text-sm text-gray-500 font-medium">Computing optimal schedule...</p>
          </CardContent>
        </Card>
      )}

      {/* ── Behavior Heatmap: Mileage × Plug-ins ── */}
      {heatmapData.length > 0 && (() => {
        const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
        const plugins = [1, 2, 3, 4, 5, 6, 7]
        const maxVal = Math.max(...heatmapData.map(d => heatmapUnit === 'eur' ? d.savings : d.spreadCt), 0.01)
        const heatColor = (val: number) => {
          const t = Math.min(val / maxVal, 1)
          return `rgba(16, 185, 129, ${0.06 + t * 0.54})`
        }
        const cellData = (mil: number, pi: number) => heatmapData.find(d => d.mileage === mil && d.plugIns === pi)

        return (
          <Card className="overflow-hidden shadow-sm border-gray-200/80">
            <CardHeader className="pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-[#313131]">Savings Sensitivity</CardTitle>
                <div className="flex items-center gap-1.5 bg-gray-100 rounded-full p-0.5">
                  <button onClick={() => setHeatmapUnit('eur')}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${heatmapUnit === 'eur' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    EUR/yr
                  </button>
                  <button onClick={() => setHeatmapUnit('ct')}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${heatmapUnit === 'ct' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    ct/kWh
                  </button>
                </div>
              </div>
              <p className="text-[13px] text-gray-500 mt-1">
                {heatmapUnit === 'eur' ? 'Yearly savings (EUR/yr)' : 'Avg spread (ct/kWh)'} · mileage vs. charging frequency · adjust plug-in time below
              </p>
            </CardHeader>
            <CardContent className="pt-5">
              <div className="flex gap-5 items-start">

                {/* ── Vertical plug-in time slider ── */}
                <div className="flex gap-2 shrink-0 select-none" style={{ height: `${mileages.length * 40 + 24}px` }}>
                  <div className="flex flex-col items-center gap-1 h-full">
                    <span className="text-[10px] text-gray-400 tabular-nums">14:00</span>
                    <input
                      type="range" min={PLUGIN_HOUR_MIN} max={PLUGIN_HOUR_MAX} step={1}
                      value={scenario.plugInTime}
                      onChange={(e) => setScenario({ ...scenario, plugInTime: Number(e.target.value) })}
                      aria-label={`Plug-in time: ${scenario.plugInTime}:00`}
                      style={{ writingMode: 'vertical-lr' } as React.CSSProperties}
                      className="flex-1 w-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer
                        [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-5 [&::-webkit-slider-thumb]:h-5
                        [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131]
                        [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer
                        [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <span className="text-[10px] text-gray-400 tabular-nums">22:00</span>
                  </div>
                  {/* Selected time label */}
                  <div className="flex flex-col justify-center">
                    <span className="text-[11px] font-bold text-[#313131] tabular-nums -rotate-90 whitespace-nowrap origin-center">
                      {String(scenario.plugInTime).padStart(2,'0')}:00
                    </span>
                  </div>
                </div>

                {/* ── Heatmap table ── */}
                <div className="flex-1 overflow-x-auto">
                  <table className="w-full border-collapse text-center">
                    <thead>
                      <tr>
                        <th className="text-[10px] text-gray-400 font-semibold uppercase tracking-wide p-2 text-left">km/yr</th>
                        {plugins.map(pi => (
                          <th key={pi} className={`text-[11px] font-bold p-2 transition-colors ${pi === scenario.weeklyPlugIns ? 'text-[#EA1C0A]' : 'text-gray-400'}`}>
                            {pi}x
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {mileages.map(mil => (
                        <tr key={mil}>
                          <td className={`text-[11px] font-semibold p-2 text-left tabular-nums transition-colors ${mil === scenario.yearlyMileageKm ? 'text-[#EA1C0A] font-bold' : 'text-gray-500'}`}>
                            {(mil / 1000).toFixed(0)}k
                          </td>
                          {plugins.map(pi => {
                            const d = cellData(mil, pi)
                            const isActive = mil === scenario.yearlyMileageKm && pi === scenario.weeklyPlugIns
                            return (
                              <td key={pi} className="p-1">
                                <div
                                  className={`rounded-md px-1.5 py-2 tabular-nums text-[11px] font-semibold transition-all ${
                                    isActive ? 'ring-2 ring-[#EA1C0A] ring-offset-1 scale-105' : ''
                                  }`}
                                  style={{ background: d ? heatColor(heatmapUnit === 'eur' ? d.savings : d.spreadCt) : '#f9fafb' }}
                                  title={d ? `${mil.toLocaleString()} km, ${pi}x/wk, ${d.kwhPerSession} kWh/session → ${d.savings.toFixed(1)} EUR/yr · ${d.spreadCt.toFixed(1)} ct/kWh` : ''}>
                                  <span className={d && (heatmapUnit === 'eur' ? d.savings : d.spreadCt) / maxVal > 0.7 ? 'text-white' : 'text-gray-700'}>
                                    {d ? (heatmapUnit === 'eur' ? d.savings.toFixed(0) : d.spreadCt.toFixed(1)) : '-'}
                                  </span>
                                </div>
                              </td>
                            )
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  <div className="flex justify-end mt-4 px-2">
                    <span className="text-[10px] text-gray-400 font-medium">Your profile highlighted · last 12 months</span>
                  </div>
                </div>

              </div>
            </CardContent>
          </Card>
        )
      })()}

    </div>
  )
}
