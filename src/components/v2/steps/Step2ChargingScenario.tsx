'use client'

import { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, totalWeeklyPlugIns, AVG_CONSUMPTION_KWH_PER_100KM, DEFAULT_CHARGE_POWER_KW, type ChargingScenario, type HourlyPrice, type DailySummary, type MonthlyStats } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import { nextDayStr, fmtDateShort, computeWindowSavings, buildOvernightWindows } from '@/lib/charging-helpers'
import { MiniCalendar } from '@/components/v2/MiniCalendar'
import { SessionCostCard } from '@/components/v2/SessionCostCard'
import { MonthlySavingsCard } from '@/components/v2/MonthlySavingsCard'
import { SavingsHeatmap } from '@/components/v2/SavingsHeatmap'
import { YearlySavingsCard, type YearlySavingsEntry } from '@/components/v2/YearlySavingsCard'
import { FleetPortfolioCard } from '@/components/v2/FleetPortfolioCard'
import {
  ComposedChart, Line, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea,
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
  lastRealDate: string
}

interface Props {
  prices: PriceData
  scenario: ChargingScenario
  setScenario: (s: ChargingScenario) => void
  optimization: OptimizeResult | null
}

/* ────── Main Component ────── */
export function Step2ChargingScenario({ prices, scenario, setScenario }: Props) {
  const chargePowerKw = scenario.chargePowerKw ?? DEFAULT_CHARGE_POWER_KW
  const weeklyPlugIns = Math.max(1, totalWeeklyPlugIns(scenario))
  const energyPerSession = deriveEnergyPerSession(scenario.yearlyMileageKm, scenario.weekdayPlugIns, scenario.weekendPlugIns)
  const kmPerCharge = Math.round(scenario.yearlyMileageKm / (weeklyPlugIns * 52))
  const sessionsPerYear = weeklyPlugIns * 52
  const kwhPerYear = Math.round(energyPerSession * sessionsPerYear)
  const sessionDurationHExact = energyPerSession / chargePowerKw
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
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('hour')
  const [plotArea, setPlotArea] = useState<{ left: number; width: number; top: number; height: number } | null>(null)
  const [showRenewable, setShowRenewable] = useState(false)
  const [renewableData, setRenewableData] = useState<Map<string, number>>(new Map())

  const date1 = prices.selectedDate
  const date2 = date1 ? nextDayStr(date1) : ''

  // ── Fetch renewable generation share when date changes ──
  useEffect(() => {
    if (!date1) return
    const dates = [date1, nextDayStr(date1)]
    const controller = new AbortController()
    Promise.all(
      dates.map(d =>
        fetch(`/api/generation?date=${d}`, { signal: controller.signal })
          .then(r => r.ok ? r.json() : null)
          .catch(() => null)
      )
    ).then(results => {
      const map = new Map<string, number>()
      for (const result of results) {
        if (!result?.hourly) continue
        for (const h of result.hourly) {
          map.set(`${result.date}-${h.hour}`, h.renewableShare)
        }
      }
      setRenewableData(map)
    })
    return () => controller.abort()
  }, [date1])

  // Deferred scenario values — heavy computations (heatmap, monthly) use these
  // so they don't block the UI during handle dragging
  const deferredPlugInTime = useDeferredValue(scenario.plugInTime)
  const deferredDepartureTime = useDeferredValue(scenario.departureTime)
  const deferredWeekdayPlugIns = useDeferredValue(scenario.weekdayPlugIns)
  const deferredWeekendPlugIns = useDeferredValue(scenario.weekendPlugIns)
  const deferredWeeklyPlugIns = useDeferredValue(weeklyPlugIns)
  const deferredEnergyPerSession = useDeferredValue(energyPerSession)


  // ── Active price source for the chart (hourly or quarter-hourly) ──
  // SMARD filter 4169 provides real 15-min day-ahead prices; hourly = avg of 4 QH values
  const isQH = resolution === 'quarterhour'
  const chartPrices = isQH && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly

  // Detect whether QH data for the chart window is synthesized (hourly × 4) vs real SMARD QH.
  // The chart spans TWO days (date1 evening → date2 morning), so both must have real QH data.
  // Real QH: prices differ across the 4 slots within an hour.
  // Synthesized: all 4 slots have the same price, OR no QH data exists for that date.
  const isQHSynthesized = useMemo(() => {
    if (!date1 || prices.hourlyQH.length === 0) return false
    function checkDate(d: string): boolean {
      const dayQH = prices.hourlyQH.filter(p => p.date === d)
      if (dayQH.length < 4) return true // missing → synthesized
      const firstHour = dayQH[0].hour
      const firstHourSlots = dayQH.filter(p => p.hour === firstHour)
      if (firstHourSlots.length < 4) return false
      const firstPrice = firstHourSlots[0].priceEurMwh
      return firstHourSlots.every(p => Math.abs(p.priceEurMwh - firstPrice) < 0.001)
    }
    // Badge shows if EITHER day in the overnight window is synthesized
    return checkDate(date1) || checkDate(date2)
  }, [prices.hourlyQH, date1, date2])

  const isFullDay = scenario.chargingMode === 'fullday'

  // ── Build chart data (overnight two-day or full-day single) ──
  const { chartData, sessionCost, rollingAvgSavings, monthlySavings } = useMemo(() => {
    if (chartPrices.length === 0 || !date1) {
      return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }
    }

    const kwhPerSlot = isQH ? chargePowerKw * 0.25 : chargePowerKw
    const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
    const rollKwhPerSlot = chargePowerKw  // rolling avg always uses hourly
    const rollSlotsPerHour = 1
    const rollMinHours = Math.ceil(energyPerSession / chargePowerKw)

    type ChartPoint = { idx: number; hour: number; minute: number; date: string; label: string; price: number; baselinePrice: number | null; optimizedPrice: number | null; isInWindow: boolean; renewableShare?: number }
    type CostInfo = { baselineAvgCt: number; optimizedAvgCt: number; baselineEur: number; optimizedEur: number; savingsEur: number; kwh: number; baselineMidIdx: number; optimizedMidIdx: number; baselineHours: { label: string; ct: number }[]; optimizedHours: { label: string; ct: number }[] }
    let data: ChartPoint[]
    let cost: CostInfo

    if (isFullDay) {
      // ── Full Day: TWO complete days (0:00–23:59 each), max 24h window ──
      const day1AllPrices = [...chartPrices.filter(p => p.date === date1)]
        .sort((a, b) => a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0))
      const day2AllPrices = [...chartPrices.filter(p => p.date === date2)]
        .sort((a, b) => a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0))
      const merged = [...day1AllPrices, ...day2AllPrices]
      if (merged.length === 0) return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }

      // Window: plugInTime on day1 → departureTime on day2 (max 24h enforced by departure ≤ plugInTime)
      const windowPrices = merged.filter(p => {
        if (p.date === date1) return p.hour >= scenario.plugInTime
        if (p.date === date2) return p.hour < scenario.departureTime
        return false
      })
      const baselineKeys = new Set(windowPrices.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))
      const sortedByPrice = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
      const optimizedKeys = new Set(sortedByPrice.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

      let idx = 0
      data = merged.map(p => {
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
          renewableShare: renewableData.get(`${p.date}-${p.hour}`),
        }
      })

      const bPts = data.filter(d => d.baselinePrice !== null)
      const oPts = data.filter(d => d.optimizedPrice !== null)
      const bAvg = bPts.length > 0 ? bPts.reduce((s, d) => s + d.price, 0) / bPts.length : 0
      const oAvg = oPts.length > 0 ? oPts.reduce((s, d) => s + d.price, 0) / oPts.length : 0
      cost = {
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
    } else {
      // ── Overnight: two-day window day1 14:00 → day2 10:00 ──
      const day1Prices = chartPrices.filter(p => p.date === date1 && p.hour >= 14)
      const day2Prices = chartPrices.filter(p => p.date === date2 && p.hour <= 10)
      const merged = [...day1Prices, ...day2Prices]
      if (merged.length === 0) return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }

      const windowPrices = merged.filter(p => {
        if (p.date === date1) return p.hour >= scenario.plugInTime
        if (p.date === date2) return p.hour < scenario.departureTime
        return false
      })
      const baselineKeys = new Set(windowPrices.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))
      const sortedByPrice = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
      const optimizedKeys = new Set(sortedByPrice.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

      let idx = 0
      data = merged.map(p => {
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
          renewableShare: renewableData.get(`${p.date}-${p.hour}`),
        }
      })

      const bPts = data.filter(d => d.baselinePrice !== null)
      const oPts = data.filter(d => d.optimizedPrice !== null)
      const bAvg = bPts.length > 0 ? bPts.reduce((s, d) => s + d.price, 0) / bPts.length : 0
      const oAvg = oPts.length > 0 ? oPts.reduce((s, d) => s + d.price, 0) / oPts.length : 0
      cost = {
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
    }

    // ── 365-day rolling average ──
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
    // Separate weekday vs weekend savings for accurate weighting
    let wdSavings = 0, wdDays = 0, weSavings = 0, weDays = 0
    for (const [dDate, dPrices] of byDate) {
      const nd = nextDayStr(dDate)
      const nPrices = byDate.get(nd)
      if (!nPrices || nPrices.length === 0) continue
      const eve = dPrices.filter(p => p.hour >= scenario.plugInTime)
      const morn = nPrices.filter(p => p.hour < scenario.departureTime)
      const win = [...eve, ...morn]
      if (win.length < rollMinHours) continue
      const { savingsEur } = computeWindowSavings(win, energyPerSession, rollKwhPerSlot, rollSlotsPerHour)
      // Day-of-week of plug-in date (0=Sun, 6=Sat)
      const dow = new Date(dDate + 'T12:00:00Z').getUTCDay()
      const isWeekend = dow === 0 || dow === 6
      if (isWeekend) { weSavings += savingsEur; weDays++ }
      else { wdSavings += savingsEur; wdDays++ }
    }
    const avgWdSavings = wdDays > 0 ? wdSavings / wdDays : 0
    const avgWeSavings = weDays > 0 ? weSavings / weDays : 0
    // Weekly savings = (weekday avg × weekday plug-ins) + (weekend avg × weekend plug-ins)
    const weeklySavings = avgWdSavings * scenario.weekdayPlugIns + avgWeSavings * scenario.weekendPlugIns
    const mSav = Math.round(weeklySavings * (30.44 / 7) * 100) / 100
    const rollSav = Math.round(weeklySavings * 52 * 100) / 100

    return { chartData: data, sessionCost: cost, rollingAvgSavings: rollSav, monthlySavings: mSav }
  }, [chartPrices, prices.hourly, date1, date2, energyPerSession, scenario.plugInTime, scenario.departureTime, scenario.weekdayPlugIns, scenario.weekendPlugIns, weeklyPlugIns, scenario.chargingMode, isQH, isFullDay, chargePowerKw, renewableData])

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

    if (isDragging === 'arrival') {
      if (isFullDay) {
        if (point.date === date1) {
          // Clamp departure to ≤ new plugInTime to enforce max 24h window
          const newDeparture = Math.min(scenario.departureTime, point.hour)
          setScenario({ ...scenario, plugInTime: point.hour, departureTime: newDeparture })
        }
      } else {
        if (point.date === date1 && point.hour >= 14 && point.hour <= 23) {
          setScenario({ ...scenario, plugInTime: point.hour })
        }
      }
    } else if (isDragging === 'departure') {
      if (isFullDay) {
        // Max 24h: departure must be ≤ plugInTime on day2
        if (point.date === date2 && point.hour <= scenario.plugInTime) {
          setScenario({ ...scenario, departureTime: point.hour })
        }
      } else {
        if (point.date === date2 && point.hour >= 4 && point.hour <= 10) {
          setScenario({ ...scenario, departureTime: point.hour })
        }
      }
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
    return buildOvernightWindows(prices.hourly, deferredPlugInTime, deferredDepartureTime)
  }, [prices.hourly, deferredPlugInTime, deferredDepartureTime])

  // ── Monthly savings breakdown for yearly chart ──
  // Split weekday vs weekend savings for accurate weighting
  const monthlySavingsData = useMemo(() => {
    if (overnightWindows.length === 0) return []
    const mKwhPerSlot = isQH ? chargePowerKw * 0.25 : chargePowerKw
    const mSlotsPerHour = isQH ? 4 : 1
    const minHours = Math.ceil(deferredEnergyPerSession / chargePowerKw)
    // weekdayScale: fraction of weekdays user plugs in (e.g. 3/5 = 60%)
    const weekdayScale = deferredWeekdayPlugIns / 5
    const weekendScale = deferredWeekendPlugIns / 2
    const monthMap = new Map<string, { wdSavings: number; wdDays: number; weSavings: number; weDays: number }>()
    for (const w of overnightWindows) {
      if (w.prices.length < minHours) continue
      const { savingsEur } = computeWindowSavings(w.prices, deferredEnergyPerSession, mKwhPerSlot, mSlotsPerHour)
      const entry = monthMap.get(w.month) || { wdSavings: 0, wdDays: 0, weSavings: 0, weDays: 0 }
      if (w.isWeekend) {
        entry.weSavings += savingsEur
        entry.weDays++
      } else {
        entry.wdSavings += savingsEur
        entry.wdDays++
      }
      monthMap.set(w.month, entry)
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        // Weighted savings: avg weekday savings × weekday scale × weekdays/month + same for weekend
        const wdAvg = data.wdDays > 0 ? data.wdSavings / data.wdDays : 0
        const weAvg = data.weDays > 0 ? data.weSavings / data.weDays : 0
        const wdMonthly = wdAvg * weekdayScale * 21.74  // ~21.74 weekdays/month
        const weMonthly = weAvg * weekendScale * 8.70    // ~8.70 weekend days/month
        const monthlySav = Math.round((wdMonthly + weMonthly) * 100) / 100
        const [y, m] = month.split('-').map(Number)
        const label = new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'short' })
        const mNum = m
        const season: 'winter' | 'spring' | 'summer' | 'autumn' =
          mNum <= 2 || mNum === 12 ? 'winter' : mNum <= 5 ? 'spring' : mNum <= 8 ? 'summer' : 'autumn'
        return {
          month, label, savings: monthlySav, season, year: y,
          weekdaySavings: Math.round(wdMonthly * 100) / 100,
          weekendSavings: Math.round(weMonthly * 100) / 100,
        }
      })
  }, [overnightWindows, deferredEnergyPerSession, deferredWeekdayPlugIns, deferredWeekendPlugIns, isQH, chargePowerKw])

  // ── Quarterly rollup for Outcome Box ──
  const quarterlyData = useMemo(() => {
    if (monthlySavingsData.length === 0) return []
    const qMap = new Map<string, { savings: number; label: string }>()
    for (const m of monthlySavingsData) {
      const yr = m.month.slice(0, 4)
      const mo = parseInt(m.month.slice(5, 7))
      const q = Math.ceil(mo / 3)
      const key = `${yr}-Q${q}`
      const label = `Q${q} '${yr.slice(2)}`
      const ex = qMap.get(key)
      qMap.set(key, { savings: (ex?.savings ?? 0) + m.savings, label })
    }
    return [...qMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-5) // 5 quarters = covers full trailing 365 days when current Q is partial
      .map(([, v]) => v)
  }, [monthlySavingsData])

  // ── Heatmap data: savings for different mileage × plug-in combinations ──
  // Uses the same last-12-month window as the monthly savings chart for consistency
  const heatmapData = useMemo(() => {
    if (overnightWindows.length === 0) return []
    const hKwhPerSlot = isQH ? chargePowerKw * 0.25 : chargePowerKw
    const hSlotsPerHour = isQH ? 4 : 1
    // Identify the same 12 months shown in the savings chart
    const allMonths = [...new Set(overnightWindows.map(w => w.month))].sort()
    const last12Months = new Set(allMonths.slice(-12))
    const windows = overnightWindows.filter(w => last12Months.has(w.month))
    const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
    const plugins = [1, 2, 3, 4, 5, 6, 7]
    const grid: { mileage: number; plugIns: number; savings: number; spreadCt: number; kwhPerSession: number }[] = []
    for (const mil of mileages) {
      for (const pi of plugins) {
        const eps = deriveEnergyPerSession(mil, pi, 0)
        const minHours = Math.ceil(eps / chargePowerKw)
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
  }, [overnightWindows, isQH, chargePowerKw])

  // ── Yearly savings data (2022-2030) ──
  const yearlySavingsData = useMemo((): YearlySavingsEntry[] => {
    if (overnightWindows.length === 0) return []
    const yKwhPerSlot = isQH ? chargePowerKw * 0.25 : chargePowerKw
    const ySlotsPerHour = isQH ? 4 : 1
    const minHours = Math.ceil(deferredEnergyPerSession / chargePowerKw)
    const weekdayScale = deferredWeekdayPlugIns / 5
    const weekendScale = deferredWeekendPlugIns / 2

    // Group windows by year, split weekday/weekend
    const yearMap = new Map<number, { wdSavings: number; wdDays: number; weSavings: number; weDays: number; months: Set<string> }>()
    for (const w of overnightWindows) {
      if (w.prices.length < minHours) continue
      const yr = parseInt(w.date.slice(0, 4))
      const entry = yearMap.get(yr) || { wdSavings: 0, wdDays: 0, weSavings: 0, weDays: 0, months: new Set<string>() }
      const { savingsEur } = computeWindowSavings(w.prices, deferredEnergyPerSession, yKwhPerSlot, ySlotsPerHour)
      if (w.isWeekend) { entry.weSavings += savingsEur; entry.weDays++ }
      else { entry.wdSavings += savingsEur; entry.wdDays++ }
      entry.months.add(w.month)
      yearMap.set(yr, entry)
    }

    return [...yearMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, data]) => {
        const monthsCovered = data.months.size
        const wdAvg = data.wdDays > 0 ? data.wdSavings / data.wdDays : 0
        const weAvg = data.weDays > 0 ? data.weSavings / data.weDays : 0
        const wdYearly = wdAvg * weekdayScale * 21.74 * monthsCovered
        const weYearly = weAvg * weekendScale * 8.70 * monthsCovered
        const yearlySav = Math.round((wdYearly + weYearly) * 100) / 100
        const plugDaysPerMonth = (deferredWeeklyPlugIns / 7) * 30.44
        return {
          year,
          savings: yearlySav,
          sessionsCount: Math.round(plugDaysPerMonth * monthsCovered),
          isProjected: false,
          isPartial: monthsCovered < 12,
          monthsCovered,
        }
      })
  }, [overnightWindows, deferredEnergyPerSession, deferredWeekdayPlugIns, deferredWeekendPlugIns, deferredWeeklyPlugIns, isQH, chargePowerKw])

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
    // For QH: tick line at every :00, label every 2h (overnight) or 4h (full day)
    // Full day spans 48 data points → label every 4h gives 12 labels total (readable)
    const isOnHour = pt.minute === 0
    const showTick = isQH ? isOnHour : true
    const labelInterval = isFullDay ? 4 : 2
    const showLabel = isOnHour && pt.hour % labelInterval === 0
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
  }, [chartData, isQH, isFullDay])

  return (
    <div className="space-y-8">
      {/* ── Top row: Customer Profile + Outcome Box ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
      <Card id="tour-customer-profile" className="lg:col-span-3 overflow-hidden shadow-sm border-gray-200/80">
        <CardHeader className="pb-3 bg-gray-50/80 border-b border-gray-100">
          <CardTitle className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">Customer Profile</CardTitle>
        </CardHeader>
        <CardContent className="pt-6 pb-6">
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 lg:gap-8 items-start">
            {/* Mileage slider */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between h-8">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Yearly Mileage</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.yearlyMileageKm.toLocaleString('en-US')}<span className="text-xs font-normal text-gray-400 ml-1">km</span></span>
              </div>
              <div>
                <input type="range" min={SLIDER_MIN} max={SLIDER_MAX} step={1000}
                  value={scenario.yearlyMileageKm}
                  onChange={(e) => setScenario({ ...scenario, yearlyMileageKm: Number(e.target.value) })}
                  aria-label={`Yearly mileage: ${scenario.yearlyMileageKm} km`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>5,000 km</span>
                  <span>40,000 km</span>
                </div>
              </div>
              {/* Mileage distribution bars */}
              <div className="relative h-6">
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
                  <span className="absolute -top-3 left-1/2 -translate-x-1/2 text-[9px] text-gray-400 font-medium whitespace-nowrap">avg</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 text-center">
                {kwhPerYear.toLocaleString('en-US')} kWh/yr · {AVG_CONSUMPTION_KWH_PER_100KM} kWh/100km
              </p>
            </div>

            {/* Weekly plug-ins — weekday/weekend split */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between h-8">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weekly Plug-ins</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{weeklyPlugIns}<span className="text-xs font-normal text-gray-400 ml-1">x / wk</span></span>
              </div>
              {/* Weekday slider */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium text-gray-500">Mon – Fri</span>
                  <span className="text-[10px] font-bold text-[#313131] tabular-nums">{scenario.weekdayPlugIns}x</span>
                </div>
                <input type="range" min={0} max={5} step={1} value={scenario.weekdayPlugIns}
                  onChange={(e) => setScenario({ ...scenario, weekdayPlugIns: Number(e.target.value) })}
                  aria-label={`Weekday plug-ins: ${scenario.weekdayPlugIns}`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              </div>
              {/* Weekend slider */}
              <div>
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-[10px] font-medium text-gray-400">Sat – Sun</span>
                  <span className="text-[10px] font-bold text-[#313131] tabular-nums">{scenario.weekendPlugIns}x</span>
                </div>
                <input type="range" min={0} max={2} step={1} value={scenario.weekendPlugIns}
                  onChange={(e) => setScenario({ ...scenario, weekendPlugIns: Number(e.target.value) })}
                  aria-label={`Weekend plug-ins: ${scenario.weekendPlugIns}`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
              </div>
              {/* Day blocks visual */}
              <div className="flex items-end justify-center gap-0.5">
                {['Mo','Tu','We','Th','Fr'].map((d, i) => (
                  <div key={d} className="flex flex-col items-center gap-0.5 flex-1">
                    <div className={`h-3 w-full rounded-sm transition-colors ${i < scenario.weekdayPlugIns ? 'bg-[#313131]/20' : 'bg-gray-100'}`} />
                    <span className="text-[9px] text-gray-400 leading-none">{d}</span>
                  </div>
                ))}
                <div className="w-px h-3.5 bg-gray-200 mx-0.5" />
                {['Sa','Su'].map((d, i) => (
                  <div key={d} className="flex flex-col items-center gap-0.5 flex-1">
                    <div className={`h-3 w-full rounded-sm transition-colors ${i < scenario.weekendPlugIns ? 'bg-gray-400/30' : 'bg-gray-100'}`} />
                    <span className="text-[9px] text-gray-400 leading-none">{d}</span>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-center gap-1.5">
                <span className="text-[10px] text-gray-400">~{sessionLabel}/session ·</span>
                <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
                  <button
                    onClick={() => setScenario({ ...scenario, chargePowerKw: 7 })}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${chargePowerKw === 7 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >7 kW</button>
                  <button
                    onClick={() => setScenario({ ...scenario, chargePowerKw: 11 })}
                    className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${chargePowerKw === 11 ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  >11 kW</button>
                </div>
              </div>
            </div>

            {/* Typical Plug-in Time */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between h-8">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Plug-in Time</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{String(scenario.plugInTime).padStart(2, '0')}<span className="text-xs font-normal text-gray-400 ml-0.5">:00</span></span>
              </div>
              <div>
                <input type="range"
                  min={isFullDay ? 0 : PLUGIN_HOUR_MIN}
                  max={isFullDay ? 23 : PLUGIN_HOUR_MAX}
                  step={1}
                  value={scenario.plugInTime}
                  onChange={(e) => {
                    const newPlugIn = Number(e.target.value)
                    const newDeparture = isFullDay ? Math.min(scenario.departureTime, newPlugIn) : scenario.departureTime
                    setScenario({ ...scenario, plugInTime: newPlugIn, departureTime: newDeparture })
                  }}
                  aria-label={`Typical plug-in time: ${scenario.plugInTime}:00`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>{isFullDay ? '00:00' : '14:00'}</span>
                  <span>{isFullDay ? '23:00' : '22:00'}</span>
                </div>
              </div>
              {/* Plug-in time distribution bars */}
              <div className="relative h-6 flex items-end gap-px">
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
              <p className="text-[10px] text-gray-400 text-center">
                Baseline arrival · also draggable on chart
              </p>
            </div>

            {/* Per Session stats */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between h-8">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Per Session</span>
              </div>
              <div className="flex flex-col gap-1.5 p-3 bg-gray-50/80 rounded-lg border border-gray-200/60">
                <div className="flex items-baseline gap-1">
                  <span className="text-2xl font-bold text-[#313131] tabular-nums">~{energyPerSession}</span>
                  <span className="text-xs text-gray-400">kWh</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-sm font-medium text-gray-600 tabular-nums">~{kmPerCharge}</span>
                  <span className="text-xs text-gray-400">km range</span>
                </div>
                <p className="text-[10px] text-gray-400">{sessionsPerYear} sessions/yr</p>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ── Outcome Box (Savings Potential) ── */}
      <Card id="tour-savings-potential" className="overflow-hidden shadow-sm border-gray-200/80 flex flex-col">
        <CardHeader className="pb-3 border-b border-gray-100">
          <CardTitle className="text-base font-bold text-[#313131]">Savings Potential</CardTitle>
          <p className="text-[11px] text-gray-400 mt-0.5">
            {isFullDay ? 'Full day · ' : 'Overnight · '}Rolling 12 months · {sessionsPerYear} sessions/yr
          </p>
        </CardHeader>
        <CardContent className="flex-1 pt-4 space-y-5">
          {/* Annual EUR — hero number */}
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Annual Savings</p>
            <AnimatedNumber value={rollingAvgSavings} decimals={0} suffix=" EUR" className="text-4xl font-extrabold text-emerald-700 tabular-nums leading-none" />
            <p className="text-[10px] text-gray-400 mt-0.5">per year</p>
          </div>
          {/* Rolling avg ct/kWh spread — consistent with annual EUR */}
          {sessionsPerYear > 0 && energyPerSession > 0 && rollingAvgSavings > 0 && (
            <div>
              <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-1">Avg Monetizable Spread</p>
              <p className="text-2xl font-bold text-emerald-600 tabular-nums">
                {((rollingAvgSavings / sessionsPerYear) / energyPerSession * 100).toFixed(1)}
                <span className="text-sm font-normal text-gray-400 ml-1">ct/kWh</span>
              </p>
              <p className="text-[10px] text-gray-400 mt-0.5">12-month rolling avg</p>
            </div>
          )}
          {rollingAvgSavings === 0 && (
            <p className="text-[11px] text-gray-400 leading-relaxed">Select a date above to calculate savings.</p>
          )}
        </CardContent>
      </Card>
      </div>{/* end top row */}

      {/* ── Chart + Sidebar ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Chart (3/4) */}
        <Card id="tour-price-chart" className="lg:col-span-3 overflow-hidden shadow-sm border-gray-200/80">
          <CardHeader className="pb-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-[#313131]">
                  {isFullDay ? 'Full Day Price Curve' : 'Overnight Price Curve'}
                </CardTitle>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {isFullDay
                    ? `Two days · plug-in ${arrivalLabel} → departure ${departureLabel} · max 24h window`
                    : isQH
                      ? isQHSynthesized
                        ? 'Hourly avg (real 15-min not yet published by SMARD)'
                        : 'Day-Ahead 15-min Auction'
                      : 'Day-Ahead Hourly Auction'}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Mode toggle */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                  <button onClick={() => {
                    // Clamp plug-in and departure to overnight-valid ranges when switching back
                    const newPlugIn = Math.max(PLUGIN_HOUR_MIN, Math.min(PLUGIN_HOUR_MAX, scenario.plugInTime))
                    const newDeparture = Math.max(4, Math.min(10, scenario.departureTime))
                    setScenario({ ...scenario, chargingMode: 'overnight', plugInTime: newPlugIn, departureTime: newDeparture })
                  }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${!isFullDay ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    Overnight
                  </button>
                  <button onClick={() => {
                    // Ensure departure ≤ plugInTime (max 24h window) when switching to full day
                    const newDeparture = Math.min(scenario.departureTime, scenario.plugInTime)
                    setScenario({ ...scenario, chargingMode: 'fullday', departureTime: newDeparture })
                  }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${isFullDay ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    Full Day
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
                {/* Renewable overlay toggle */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                  <button
                    onClick={() => setShowRenewable(v => !v)}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${showRenewable ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                    title="Toggle renewable generation overlay (solar + wind)"
                  >
                    {'\u2600\uFE0E'} Renew.
                  </button>
                </div>
                {isQH && isQHSynthesized && (
                  <TooltipProvider delayDuration={100}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] font-semibold text-amber-600 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 cursor-help select-none">
                          ≈ hourly avg
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[260px] text-left space-y-1.5 p-3">
                        <p className="font-semibold text-[12px]">15-min data not yet published</p>
                        <p className="text-[11px] text-gray-500 leading-relaxed">
                          SMARD releases quarterhour prices with a 1–2 day delay.
                          The chart currently shows each hourly price repeated × 4 — no intra-hour variation.
                        </p>
                        <p className="text-[11px] text-gray-400 font-mono">
                          node scripts/download-smard.mjs
                        </p>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                )}
                <div className="flex items-center gap-1.5 bg-gray-100 rounded-full p-0.5">
                  <button onClick={() => setResolution('hour')}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'hour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    60 min
                  </button>
                  <button onClick={() => setResolution('quarterhour')}
                    disabled={prices.hourlyQH.length === 0}
                    title={prices.hourlyQH.length === 0 ? 'No 15-min data available — run: node scripts/download-smard.mjs' : isQHSynthesized ? 'Showing hourly avg × 4 — SMARD 15-min data not yet published for this day' : '15-minute SMARD resolution'}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${resolution === 'quarterhour' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                    15 min
                  </button>
                </div>
              </div>
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
                    <linearGradient id="renewGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#22C55E" stopOpacity={0.10} />
                      <stop offset="100%" stopColor="#22C55E" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

                  <XAxis dataKey="idx" type="number" domain={[0, Math.max(chartData.length - 1, 1)]}
                    ticks={xTicks} tick={renderXTick as never} tickLine={false}
                    stroke="#9CA3AF" interval={0} height={40}
                    allowDecimals={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 12, fontWeight: 500 }} stroke="#9CA3AF"
                    label={{ value: 'ct/kWh Day-Ahead Spot Price', angle: -90, position: 'insideLeft', offset: -8, style: { fontSize: 11, fill: '#6B7280', fontWeight: 400 } }} />
                  {showRenewable && (
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} hide />
                  )}

                  {/* Custom tooltip — shows price once, indicates charging type */}
                  <Tooltip
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const d = chartData[Number(label)]
                      if (!d) return null
                      return (
                        <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[13px]">
                          <p className="text-gray-500 text-xs mb-1">{fmtDateShort(d.date)} {d.label}</p>
                          <p className="font-semibold tabular-nums">{d.price.toFixed(2)} ct/kWh</p>
                          {d.baselinePrice !== null && (
                            <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-0.5 bg-red-500 rounded inline-block" /> Unmanaged charging
                            </p>
                          )}
                          {d.optimizedPrice !== null && (
                            <p className="text-emerald-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-0.5 bg-emerald-500 rounded inline-block" /> Optimized charging
                            </p>
                          )}
                          {showRenewable && d.renewableShare != null && (
                            <p className="text-emerald-500/70 text-xs mt-1">{d.renewableShare.toFixed(1)}% renewable</p>
                          )}
                        </div>
                      )
                    }} />

                  {/* ── Overnight spread corridor — very subtle background band ── */}
                  {(() => {
                    if (arrivalIdx < 0) return null
                    const windowPts = chartData.filter(d => d.isInWindow)
                    if (windowPts.length === 0) return null
                    const arrivalPrice = chartData[arrivalIdx]?.price
                    const lowestWindowPrice = Math.min(...windowPts.map(d => d.price))
                    if (arrivalPrice === undefined || arrivalPrice <= lowestWindowPrice) return null
                    return (
                      <>
                        {/* Faint band between arrival price and cheapest window price */}
                        <ReferenceArea y1={lowestWindowPrice} y2={arrivalPrice} yAxisId="left"
                          fill="#F59E0B" fillOpacity={0.04} stroke="none" ifOverflow="hidden" />
                        {/* Thin dashed line at arrival price */}
                        <ReferenceLine y={arrivalPrice} yAxisId="left"
                          stroke="#EA1C0A" strokeOpacity={0.18} strokeWidth={1} strokeDasharray="4 8"
                          label={{ value: `${arrivalPrice.toFixed(1)}`, position: 'insideRight', fill: '#EA1C0A', fillOpacity: 0.45, fontSize: 9, dy: -8 }} />
                        {/* Thin dashed line at cheapest window price */}
                        <ReferenceLine y={lowestWindowPrice} yAxisId="left"
                          stroke="#10B981" strokeOpacity={0.18} strokeWidth={1} strokeDasharray="4 8"
                          label={{ value: `${lowestWindowPrice.toFixed(1)}`, position: 'insideRight', fill: '#10B981', fillOpacity: 0.45, fontSize: 9, dy: 10 }} />
                      </>
                    )
                  })()}

                  {/* Charging hour bands — clear colored backgrounds per block */}
                  {baselineRanges.map((r, i) => (
                    <ReferenceArea key={`b-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#EF4444" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}
                  {optimizedRanges.map((r, i) => (
                    <ReferenceArea key={`o-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#10B981" fillOpacity={0.08} ifOverflow="hidden" />
                  ))}

                  {/* Renewable generation share — very subtle background area */}
                  {showRenewable && (
                    <Area type="monotone" dataKey="renewableShare" yAxisId="right"
                      fill="url(#renewGrad)" stroke="#22C55E" strokeWidth={0.5} strokeOpacity={0.25}
                      connectNulls dot={false} />
                  )}

                  {/* Base price curve — subtle gray */}
                  <Area type="monotone" dataKey="price" yAxisId="left" fill="url(#priceGrad)" stroke="none" />
                  <Line type="monotone" dataKey="price" yAxisId="left" stroke="#94A3B8" strokeWidth={1.5}
                    dot={isQH ? { r: 1.5, fill: '#94A3B8', stroke: 'none' } : false}
                    activeDot={isQH ? { r: 4, fill: '#94A3B8', stroke: '#fff', strokeWidth: 2 } : undefined}
                    connectNulls />

                  {/* Baseline dots — red, no connecting line for clarity on non-contiguous hours */}
                  <Line type="monotone" dataKey="baselinePrice" yAxisId="left" stroke="#EF4444" strokeWidth={isQH ? 2 : 3}
                    dot={isQH ? { r: 2, fill: '#EF4444', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#EF4444', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Optimized dots — green */}
                  <Line type="monotone" dataKey="optimizedPrice" yAxisId="left" stroke="#10B981" strokeWidth={isQH ? 2 : 3}
                    dot={isQH ? { r: 2, fill: '#10B981', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#10B981', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Midnight boundary — both modes (overnight and full day both span two days) */}
                  {midnightIdx >= 0 && (
                    <ReferenceLine x={midnightIdx} stroke="#D1D5DB" strokeWidth={1.5} strokeDasharray="" />
                  )}

                  {/* Arrival reference line */}
                  {arrivalIdx >= 0 && (
                    <ReferenceLine x={arrivalIdx} stroke="#EA1C0A"
                      strokeWidth={isDragging === 'arrival' ? 4 : 3}
                      strokeOpacity={isDragging === 'arrival' ? 1 : 0.6} />
                  )}
                  {/* Departure reference line — both modes */}
                  {departureIdx >= 0 && (
                    <ReferenceLine x={departureIdx} stroke="#2563EB"
                      strokeWidth={isDragging === 'departure' ? 4 : 3}
                      strokeOpacity={isDragging === 'departure' ? 1 : 0.6} />
                  )}
                </ComposedChart>
              </ResponsiveContainer>

              {/* ── Date labels ── */}
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

                  {/* DEPARTURE HANDLE — both modes */}
                  {(
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
                  )}
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
                  <span className="text-gray-300">·</span>
                  <span className="italic">
                    {isFullDay
                      ? `${date1 && fmtDateShort(date1)} plug-in ${arrivalLabel} → ${date2 && fmtDateShort(date2)} departure ${departureLabel}`
                      : `${date1 && fmtDateShort(date1)} evening (plug-in) → overnight → ${date2 && fmtDateShort(date2)} morning (departure)`}
                  </span>
                </div>
              )
            })()}

          </CardContent>
        </Card>

        {/* ── Sidebar ── */}
        <div className="h-full">
          <Card id="tour-day-selector" className="h-full flex flex-col overflow-hidden shadow-sm border-gray-200/80">
            <CardHeader className="pb-3 border-b border-gray-100">
              <div className="flex items-center justify-between">
                <CardTitle className="text-base font-bold text-[#313131]">Select a Day</CardTitle>
                {(() => {
                  // "Today" = yesterday (t-1), because we need t+1 data for the overnight chart
                  const now = new Date()
                  now.setDate(now.getDate() - 1)
                  const yesterdayStr = now.toISOString().slice(0, 10)
                  const latestDate = prices.daily.find(d => d.date === yesterdayStr)?.date
                    ?? prices.daily.filter(d => d.date <= yesterdayStr).pop()?.date
                  if (!latestDate || prices.selectedDate === latestDate) return null
                  return (
                    <button
                      onClick={() => prices.setSelectedDate(latestDate)}
                      className="text-[11px] font-semibold text-[#EA1C0A] hover:text-[#EA1C0A]/80 transition-colors flex items-center gap-1">
                      <span>↓</span> Latest
                    </button>
                  )
                })()}
              </div>
            </CardHeader>
            <CardContent className="flex-1 overflow-auto">
              <MiniCalendar daily={prices.daily} selectedDate={prices.selectedDate} onSelect={prices.setSelectedDate} requireNextDay={true} />

              {/* Spread: arrival price vs. lowest night price */}
              {(() => {
                if (!date1 || chartData.length === 0) return null
                const arrivalPt = chartData.find(d => d.date === date1 && d.hour === scenario.plugInTime)
                const windowPts = chartData.filter(d => d.isInWindow)
                if (!arrivalPt || windowPts.length === 0) return null
                const lowestPrice = Math.min(...windowPts.map(d => d.price))
                const lowestPt = windowPts.reduce((m, d) => d.price < m.price ? d : m, windowPts[0])
                const spread = Math.round((arrivalPt.price - lowestPrice) * 100) / 100

                // Full Day Spread: find exact hour of max/min across full date1 24h
                const dailySummary = prices.daily.find(d => d.date === date1)
                const maxSpreadCt = dailySummary ? Math.round((dailySummary.spread / 10) * 100) / 100 : null
                const maxPriceCt = dailySummary ? Math.round((dailySummary.maxPrice / 10) * 100) / 100 : null
                const minPriceCt = dailySummary ? Math.round((dailySummary.minPrice / 10) * 100) / 100 : null
                const date1Hourly = prices.hourly.filter(p => p.date === date1)
                const maxHourlyPt = date1Hourly.length > 0
                  ? date1Hourly.reduce((m, p) => p.priceEurMwh > m.priceEurMwh ? p : m, date1Hourly[0])
                  : null
                const minHourlyPt = date1Hourly.length > 0
                  ? date1Hourly.reduce((m, p) => p.priceEurMwh < m.priceEurMwh ? p : m, date1Hourly[0])
                  : null
                const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`

                const arrivalLabel = arrivalPt.label  // already HH:MM
                const lowestLabel = lowestPt.label     // HH:MM of cheapest slot
                const lowestDateLabel = lowestPt.date === date2 ? fmtDateShort(date2) : fmtDateShort(date1)

                return (
                  <div className="mt-4 pt-3 border-t border-gray-100 space-y-3">
                    <div>
                      <div className="flex items-baseline justify-between">
                        <TooltipProvider delayDuration={200}>
                          <UITooltip>
                            <TooltipTrigger asChild>
                              <span className="text-[11px] text-gray-500 font-medium cursor-help underline decoration-dotted underline-offset-2">Overnight Spread</span>
                            </TooltipTrigger>
                            <TooltipContent side="left" className="max-w-[220px] text-left p-3 space-y-1">
                              <p className="font-semibold text-[12px]">Arrival vs. cheapest window slot</p>
                              <p className="text-[11px] text-gray-500 leading-relaxed">Price difference between plug-in time and the lowest-price hour in tonight's charging window — the arbitrage available by shifting load.</p>
                            </TooltipContent>
                          </UITooltip>
                        </TooltipProvider>
                        <span className="text-lg font-bold tabular-nums text-[#313131]">
                          {spread.toFixed(2)}<span className="text-xs font-normal text-gray-400 ml-0.5">ct/kWh</span>
                        </span>
                      </div>
                      <p className="text-[10px] text-gray-400 mt-1 leading-relaxed font-mono">
                        {arrivalLabel} {arrivalPt.price.toFixed(1)} ct → {lowestLabel} {lowestPrice.toFixed(1)} ct
                        <span className="font-sans ml-1 not-italic">({lowestDateLabel})</span>
                      </p>
                    </div>
                    {maxSpreadCt !== null && maxPriceCt !== null && minPriceCt !== null && (
                      <div>
                        <div className="flex items-baseline justify-between">
                          <TooltipProvider delayDuration={200}>
                            <UITooltip>
                              <TooltipTrigger asChild>
                                <span className="text-[11px] text-gray-500 font-medium cursor-help underline decoration-dotted underline-offset-2">Full Day Spread</span>
                              </TooltipTrigger>
                              <TooltipContent side="left" className="max-w-[220px] text-left p-3 space-y-1">
                                <p className="font-semibold text-[12px]">24-hour high vs. low</p>
                                <p className="text-[11px] text-gray-500 leading-relaxed">Maximum price range across all hours of the day — the theoretical maximum arbitrage if charging could be placed at the single cheapest hour.</p>
                              </TooltipContent>
                            </UITooltip>
                          </TooltipProvider>
                          <span className="text-lg font-bold tabular-nums text-[#313131]">
                            {maxSpreadCt.toFixed(2)}<span className="text-xs font-normal text-gray-400 ml-0.5">ct/kWh</span>
                          </span>
                        </div>
                        <p className="text-[10px] text-gray-400 mt-1 leading-relaxed font-mono">
                          {maxHourlyPt ? fmtHour(maxHourlyPt.hour) : '—'} {maxPriceCt.toFixed(1)} ct
                          {' '}↔{' '}
                          {minHourlyPt ? fmtHour(minHourlyPt.hour) : '—'} {minPriceCt.toFixed(1)} ct
                        </p>
                      </div>
                    )}
                  </div>
                )
              })()}
            </CardContent>
          </Card>
        </div>
      </div>

      {/* ── Session Cost Breakdown (full width) ── */}
      {sessionCost && (
        <SessionCostCard
          sessionCost={sessionCost}
          sessionsPerYear={sessionsPerYear}
          energyPerSession={energyPerSession}
          sessionHoursNeeded={sessionHoursNeeded}
          windowHours={windowHours}
          flexibilityHours={flexibilityHours}
          baselineEndHour={baselineEndHour}
          plugInTime={scenario.plugInTime}
          isQH={isQH}
        />
      )}

      {/* ── Monthly Savings (3/4) + Yearly Savings (1/4) ── */}
      {monthlySavingsData.length > 0 && (
        <div id="tour-monthly-savings" className="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-6">
          <MonthlySavingsCard
            monthlySavingsData={monthlySavingsData}
            weeklyPlugIns={weeklyPlugIns}
            energyPerSession={energyPerSession}
            sessionsPerYear={sessionsPerYear}
            rollingAvgSavings={rollingAvgSavings}
            monthlySavings={monthlySavings}
            avgDailyEur={sessionsPerYear > 0 ? rollingAvgSavings / sessionsPerYear : 0}
            selectedDate={date1}
          />
          {yearlySavingsData.length > 0 && (
            <YearlySavingsCard
              yearlySavingsData={yearlySavingsData}
              weeklyPlugIns={weeklyPlugIns}
              energyPerSession={energyPerSession}
            />
          )}
        </div>
      )}

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
      {heatmapData.length > 0 && (
        <SavingsHeatmap heatmapData={heatmapData} scenario={scenario} setScenario={setScenario} />
      )}

      {/* ── Fleet Portfolio View ── */}
      {prices.hourly.length > 0 && prices.selectedDate && (
        <FleetPortfolioCard
          hourlyPrices={prices.hourly}
          selectedDate={prices.selectedDate}
          departureTime={scenario.departureTime}
          yearlyMileageKm={scenario.yearlyMileageKm}
          weekdayPlugIns={scenario.weekdayPlugIns}
          weekendPlugIns={scenario.weekendPlugIns}
          singleEvSavings={rollingAvgSavings}
        />
      )}

    </div>
  )
}
