'use client'

import { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, totalWeeklyPlugIns, AVG_CONSUMPTION_KWH_PER_100KM, DEFAULT_CHARGE_POWER_KW, type ChargingScenario, type HourlyPrice, type DailySummary, type MonthlyStats } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import { nextDayStr, fmtDateShort, computeWindowSavings, buildOvernightWindows, computeSpread, buildMultiDayWindow, addDaysStr } from '@/lib/charging-helpers'
import { DateStrip } from '@/components/v2/DateStrip'
import { SessionCostCard } from '@/components/v2/SessionCostCard'
import { MonthlySavingsCard } from '@/components/v2/MonthlySavingsCard'
// Disabled for performance: SavingsHeatmap, FleetPortfolioCard, SpreadIndicatorsCard, FlexibilityDemoChart
import { YearlySavingsCard, type YearlySavingsEntry } from '@/components/v2/YearlySavingsCard'
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

const PLUGIN_HOUR_MIN = 14
const PLUGIN_HOUR_MAX = 23

// Chart margins — passed to Recharts (actual plot area measured from DOM)
const CHART_MARGIN = { top: 42, right: 30, bottom: 25, left: 50 }

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
  // Window duration depends on mode
  const windowHours = scenario.chargingMode === 'threeday'
    ? (24 - scenario.plugInTime) + 48 + scenario.departureTime  // day1 remaining + 2 full days + day3 until departure
    : scenario.chargingMode === 'fullday'
      ? (24 - scenario.plugInTime) + scenario.departureTime  // day1 remaining + day2 until departure
      : scenario.plugInTime < scenario.departureTime
        ? scenario.departureTime - scenario.plugInTime
        : (24 - scenario.plugInTime) + scenario.departureTime
  const flexibilityHours = windowHours - sessionHoursNeeded
  const baselineEndHour = (scenario.plugInTime + sessionHoursNeeded) % 24

  const chartRef = useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = useState<'arrival' | 'departure' | null>(null)
  const [costDetailMode, setCostDetailMode] = useState<string | null>(null)
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('hour')
  const [plotArea, setPlotArea] = useState<{ left: number; width: number; top: number; height: number } | null>(null)
  const [showRenewable, setShowRenewable] = useState(false)
  const [renewableData, setRenewableData] = useState<Map<string, number>>(new Map())
  // Latest available date for "Jump to latest" button
  const latestAvailableDate = useMemo(() => {
    const now = new Date()
    now.setDate(now.getDate() - 1)
    const yesterdayStr = now.toISOString().slice(0, 10)
    return prices.daily.find(d => d.date === yesterdayStr)?.date
      ?? prices.daily.filter(d => d.date <= yesterdayStr).pop()?.date
  }, [prices.daily])

  const date1 = prices.selectedDate
  const date2 = date1 ? nextDayStr(date1) : ''
  const date3 = date2 ? nextDayStr(date2) : ''
  const date4 = date3 ? nextDayStr(date3) : ''
  const isThreeDay = scenario.chargingMode === 'threeday'

  // ── Fetch renewable generation share when date changes ──
  useEffect(() => {
    if (!date1) return
    const dates = isThreeDay
      ? [date1, date2, date3, date4].filter(Boolean)
      : [date1, date2].filter(Boolean)
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
  }, [date1, isThreeDay])

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
  const hasDate3Data = date3 ? chartPrices.some(p => p.date === date3) : false

  // ── Auto-fallback: if 3-day mode but no date3 data, switch to fullday ──
  useEffect(() => {
    if (isThreeDay && !hasDate3Data && chartPrices.length > 0) {
      setScenario({ ...scenario, chargingMode: 'fullday', departureTime: scenario.plugInTime })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isThreeDay, hasDate3Data, chartPrices.length])

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

  const isFullDay = scenario.chargingMode === 'fullday' || scenario.chargingMode === 'threeday'

  // ── Build chart data (overnight two-day or full-day single) ──
  const { chartData, sessionCost } = useMemo(() => {
    if (chartPrices.length === 0 || !date1) {
      return { chartData: [], sessionCost: null, rollingAvgSavings: 0, monthlySavings: 0 }
    }

    const kwhPerSlot = isQH ? chargePowerKw * 0.25 : chargePowerKw
    const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
    type ChartPoint = { idx: number; hour: number; minute: number; date: string; label: string; price: number | null; priceForecast: number | null; priceVal: number; baselinePrice: number | null; optimizedPrice: number | null; isInWindow: boolean; isProjected?: boolean; renewableShare?: number }
    type CostInfo = { baselineAvgCt: number; optimizedAvgCt: number; baselineEur: number; optimizedEur: number; savingsEur: number; kwh: number; baselineMidIdx: number; optimizedMidIdx: number; baselineHours: { label: string; ct: number }[]; optimizedHours: { label: string; ct: number }[] }
    let data: ChartPoint[]
    let cost: CostInfo

    // ── Unified chart data: all modes start at 14:00 of selected date ──
    // Overnight: 14:00 day1 → 10:00 day2 (~20h)
    // Full Day:  14:00 day1 → 24:00 day2  (~34h)
    // 3 Days:    14:00 day1 → 24:00 day4  (~82h)
    const CHART_START_HOUR = 14
    const endHour = isFullDay ? 24 : 10 // fullday/3day go to end of last date, overnight ends at 10:00
    // Last date in the chart window
    const lastDate = isThreeDay ? date4 : date2
    // Departure date for optimization window
    const depDate = isThreeDay ? date4 : date2
    // All dates that contribute data
    const allDates = isThreeDay
      ? [date1, date2, date3, date4]
      : [date1, date2]

    // Collect price data within the chart window
    const merged: HourlyPrice[] = []
    for (const p of chartPrices) {
      if (!allDates.includes(p.date)) continue
      if (p.date === date1 && p.hour < CHART_START_HOUR) continue
      if (p.date === lastDate && p.hour >= endHour) continue
      merged.push(p)
    }
    // Sort by date then time
    merged.sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1
      return a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0)
    })

    // Pad missing slots to ensure equal-width days and smooth curves
    const step = isQH ? 15 : 60
    const padded: HourlyPrice[] = []
    const existingMap = new Map<string, HourlyPrice>()
    for (const p of merged) existingMap.set(`${p.date}-${p.hour}-${p.minute ?? 0}`, p)

    let lastKnown: HourlyPrice | null = null
    for (const d of allDates) {
      const startMin = d === date1 ? CHART_START_HOUR * 60 : 0
      const endMin = d === lastDate ? endHour * 60 : 24 * 60
      for (let m = startMin; m < endMin; m += step) {
        const hour = Math.floor(m / 60)
        const minute = m % 60
        const key = `${d}-${hour}-${minute}`
        const found = existingMap.get(key)
        if (found) {
          padded.push(found)
          lastKnown = found
        } else if (lastKnown) {
          padded.push({ ...lastKnown, hour, minute, date: d, isProjected: true })
        }
      }
    }

    if (padded.length === 0) return { chartData: [], sessionCost: null }

    // Optimization window: plugInTime on day1 → departureTime on depDate
    const windowPrices = padded.filter(p => {
      if (p.date === date1) return p.hour >= scenario.plugInTime
      if (p.date === depDate) return p.hour < scenario.departureTime
      if (p.date > date1 && p.date < depDate) return true
      return false
    })
    const baselineKeys = new Set(windowPrices.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))
    const sortedByPrice = [...windowPrices].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
    const optimizedKeys = new Set(sortedByPrice.slice(0, slotsNeeded).map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))

    let idx = 0
    data = padded.map(p => {
      const key = `${p.date}-${p.hour}-${p.minute ?? 0}`
      const ct = Math.round((p.priceEurMwh / 10) * 100) / 100
      const isInWindow = windowPrices.length > 0 && (
        (p.date === date1 && p.hour >= scenario.plugInTime) ||
        (p.date === depDate && p.hour < scenario.departureTime) ||
        (p.date > date1 && p.date < depDate)
      )
      const min = p.minute ?? 0
      const projected = !!p.isProjected
      return {
        idx: idx++,
        hour: p.hour,
        minute: min,
        date: p.date,
        label: `${String(p.hour).padStart(2, '0')}:${String(min).padStart(2, '0')}`,
        price: projected ? null : ct,
        priceForecast: projected ? ct : null,
        priceVal: ct,
        baselinePrice: baselineKeys.has(key) ? ct : null,
        optimizedPrice: optimizedKeys.has(key) ? ct : null,
        isInWindow,
        isProjected: projected,
        renewableShare: renewableData.get(`${p.date}-${p.hour}`),
      }
    })
    // Bridge: give the last real point a priceForecast value so the dashed line connects seamlessly
    const firstFcIdx = data.findIndex(d => d.isProjected)
    if (firstFcIdx > 0 && data[firstFcIdx - 1].price !== null) {
      data[firstFcIdx - 1].priceForecast = data[firstFcIdx - 1].price
    }

    const bPts = data.filter(d => d.baselinePrice !== null)
    const oPts = data.filter(d => d.optimizedPrice !== null)
    const bAvg = bPts.length > 0 ? bPts.reduce((s, d) => s + d.priceVal, 0) / bPts.length : 0
    const oAvg = oPts.length > 0 ? oPts.reduce((s, d) => s + d.priceVal, 0) / oPts.length : 0
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

    return { chartData: data, sessionCost: cost }
  }, [chartPrices, date1, date2, date3, energyPerSession, scenario.plugInTime, scenario.departureTime, scenario.chargingMode, isQH, isFullDay, isThreeDay, chargePowerKw, renewableData])

  // ── 365-day rolling average — expensive scan over all hourly prices ──
  // Uses deferred plug-in/departure values so it doesn't block drag interactions
  // Mode-aware: builds appropriate windows for overnight/fullday/threeday
  const { rollingAvgSavings, monthlySavings } = useMemo(() => {
    if (!date1 || prices.hourly.length === 0) return { rollingAvgSavings: 0, monthlySavings: 0 }
    const rollKwhPerSlot = chargePowerKw
    const rollSlotsPerHour = 1
    const rollMinHours = Math.ceil(energyPerSession / chargePowerKw)
    const mode = scenario.chargingMode

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
    let wdSavings = 0, wdDays = 0, weSavings = 0, weDays = 0
    for (const [dDate, dPrices] of byDate) {
      let win: HourlyPrice[]
      if (mode === 'threeday') {
        const d2 = addDaysStr(dDate, 1), d3 = addDaysStr(dDate, 2), d4 = addDaysStr(dDate, 3)
        const p2 = byDate.get(d2)
        if (!p2 || p2.length === 0) continue
        win = [...dPrices.filter(p => p.hour >= deferredPlugInTime), ...p2]
        const p3 = byDate.get(d3)
        if (p3) win.push(...p3)
        const p4 = byDate.get(d4)
        if (p4) win.push(...p4.filter(p => p.hour < deferredPlugInTime))
      } else {
        const nd = nextDayStr(dDate)
        const nPrices = byDate.get(nd)
        if (!nPrices || nPrices.length === 0) continue
        const eve = dPrices.filter(p => p.hour >= deferredPlugInTime)
        const morn = nPrices.filter(p => p.hour < deferredDepartureTime)
        win = [...eve, ...morn]
      }
      if (win.length < rollMinHours) continue
      const { savingsEur } = computeWindowSavings(win, energyPerSession, rollKwhPerSlot, rollSlotsPerHour)
      const dow = new Date(dDate + 'T12:00:00Z').getUTCDay()
      const isWeekend = dow === 0 || dow === 6
      if (isWeekend) { weSavings += savingsEur; weDays++ }
      else { wdSavings += savingsEur; wdDays++ }
    }
    const avgWdSavings = wdDays > 0 ? wdSavings / wdDays : 0
    const avgWeSavings = weDays > 0 ? weSavings / weDays : 0
    const weeklySavings = avgWdSavings * deferredWeekdayPlugIns + avgWeSavings * deferredWeekendPlugIns
    const mSav = Math.round(weeklySavings * (30.44 / 7) * 100) / 100
    const rollSav = Math.round(weeklySavings * 52 * 100) / 100
    return { rollingAvgSavings: rollSav, monthlySavings: mSav }
  }, [prices.hourly, date1, energyPerSession, deferredPlugInTime, deferredDepartureTime, deferredWeekdayPlugIns, deferredWeekendPlugIns, chargePowerKw, scenario.chargingMode])

  // ── Per-mode rolling savings: 4 weeks + 52 weeks for overnight/fullday/threeday ──
  type ModeSavings = { ctKwh4w: number; eur4w: number; ctKwh52w: number; eur52w: number }
  const perModeSavings = useMemo((): Record<string, ModeSavings> => {
    if (!date1 || prices.hourly.length === 0) {
      const z: ModeSavings = { ctKwh4w: 0, eur4w: 0, ctKwh52w: 0, eur52w: 0 }
      return { overnight: z, fullday: z, threeday: z }
    }
    const kwhSlot = chargePowerKw
    const minH = Math.ceil(deferredEnergyPerSession / chargePowerKw)
    const end52 = date1
    const start52 = new Date(new Date(end52 + 'T12:00:00Z').getTime() - 364 * 86400000).toISOString().slice(0, 10)
    const start4w = new Date(new Date(end52 + 'T12:00:00Z').getTime() - 28 * 86400000).toISOString().slice(0, 10)

    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      if (p.date >= start52 && p.date <= end52) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
    }

    function calcMode(buildWindow: (dDate: string) => HourlyPrice[] | null): { s4w: number; d4w: number; s52w: number; d52w: number } {
      let s4w = 0, d4w = 0, s52w = 0, d52w = 0
      for (const dDate of byDate.keys()) {
        const win = buildWindow(dDate)
        if (!win || win.length < minH) continue
        const { savingsEur } = computeWindowSavings(win, deferredEnergyPerSession, kwhSlot, 1)
        s52w += savingsEur; d52w++
        if (dDate >= start4w) { s4w += savingsEur; d4w++ }
      }
      return { s4w, d4w, s52w, d52w }
    }

    // Each mode: use actual departure when active, canonical when inactive
    const curMode = scenario.chargingMode
    const overnightDep = curMode === 'overnight' ? deferredDepartureTime : (deferredPlugInTime + 12) % 24
    const fullDayDep = curMode === 'fullday' ? deferredDepartureTime : deferredPlugInTime
    const threeDayDep = curMode === 'threeday' ? deferredDepartureTime : deferredPlugInTime

    const overnight = calcMode((dDate) => {
      const nd = addDaysStr(dDate, 1)
      const nP = byDate.get(nd)
      if (!nP || nP.length === 0) return null
      const dP = byDate.get(dDate)
      if (!dP) return null
      return [...dP.filter(p => p.hour >= deferredPlugInTime), ...nP.filter(p => p.hour < overnightDep)]
    })

    const fullday = calcMode((dDate) => {
      const nd = addDaysStr(dDate, 1)
      const nP = byDate.get(nd)
      if (!nP || nP.length === 0) return null
      const dP = byDate.get(dDate)
      if (!dP) return null
      return [...dP.filter(p => p.hour >= deferredPlugInTime), ...nP.filter(p => p.hour < fullDayDep)]
    })

    const threeday = calcMode((dDate) => {
      const d2 = addDaysStr(dDate, 1), d3 = addDaysStr(dDate, 2), d4 = addDaysStr(dDate, 3)
      const dP = byDate.get(dDate), p2 = byDate.get(d2), p3 = byDate.get(d3)
      if (!dP || !p2) return null
      const all = [...dP.filter(p => p.hour >= deferredPlugInTime), ...p2]
      if (p3) all.push(...p3)
      const p4 = byDate.get(d4)
      if (p4) all.push(...p4.filter(p => p.hour < threeDayDep))
      return all
    })

    function toResult(r: { s4w: number; d4w: number; s52w: number; d52w: number }): ModeSavings {
      const avgPerDay4w = r.d4w > 0 ? r.s4w / r.d4w : 0
      const avgPerDay52w = r.d52w > 0 ? r.s52w / r.d52w : 0
      const weekly4w = avgPerDay4w * deferredWeeklyPlugIns
      const weekly52w = avgPerDay52w * deferredWeeklyPlugIns
      const eur4w = Math.round(weekly4w * 4 * 100) / 100 // 4 weeks
      const eur52w = Math.round(weekly52w * 52 * 100) / 100
      const ctKwh4w = deferredEnergyPerSession > 0 ? avgPerDay4w / deferredEnergyPerSession * 100 : 0
      const ctKwh52w = deferredEnergyPerSession > 0 ? avgPerDay52w / deferredEnergyPerSession * 100 : 0
      return { ctKwh4w, eur4w, ctKwh52w, eur52w }
    }

    return { overnight: toResult(overnight), fullday: toResult(fullday), threeday: toResult(threeday) }
  }, [prices.hourly, date1, deferredEnergyPerSession, deferredPlugInTime, deferredDepartureTime, deferredWeeklyPlugIns, chargePowerKw, scenario.chargingMode])

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
  // Track last drag hour to avoid redundant state updates
  const lastDragHour = useRef<number>(-1)

  const handleDrag = useCallback((e: React.MouseEvent | React.TouchEvent) => {
    if (!isDragging || !chartRef.current || chartData.length === 0 || !plotArea) return
    const rect = chartRef.current.getBoundingClientRect()
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX
    const relX = clientX - rect.left
    const dataFraction = (relX - plotArea.left) / plotArea.width
    const dataIdx = Math.round(Math.max(0, Math.min(1, dataFraction)) * (chartData.length - 1))
    const point = chartData[dataIdx]
    if (!point) return

    // Skip if same hour as last drag event (avoids redundant re-renders)
    if (point.hour === lastDragHour.current) return
    lastDragHour.current = point.hour

    if (isDragging === 'arrival') {
      if (isFullDay) {
        if (point.date === date1) {
          const newDeparture = Math.min(scenario.departureTime, point.hour)
          setScenario({ ...scenario, plugInTime: point.hour, departureTime: newDeparture })
        }
      } else {
        if (point.date === date1 && point.hour >= 14 && point.hour <= 23) {
          setScenario({ ...scenario, plugInTime: point.hour })
        }
      }
    } else if (isDragging === 'departure') {
      const depDate = isThreeDay ? date4 : date2
      if (isFullDay) {
        if (point.date === depDate) {
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
    const onUp = () => { setIsDragging(null); lastDragHour.current = -1 }
    window.addEventListener('mouseup', onUp)
    window.addEventListener('touchend', onUp)
    return () => { window.removeEventListener('mouseup', onUp); window.removeEventListener('touchend', onUp) }
  }, [isDragging])

  // Key indices — departure date depends on mode
  const departureDate = isThreeDay ? date4 : date2
  const arrivalIdx = chartData.findIndex(d => d.date === date1 && d.hour === scenario.plugInTime)
  const departureIdx = chartData.findIndex(d => d.date === departureDate && d.hour === scenario.departureTime)
  const N = chartData.length

  const arrivalLabel = `${String(scenario.plugInTime).padStart(2, '0')}:00`
  const departureLabel = `${String(scenario.departureTime).padStart(2, '0')}:00`
  const midnightIdx = chartData.findIndex(d => d.date === date2 && d.hour === 0)
  const hasForecastData = chartData.some(d => d.isProjected)
  const forecastStartIdx = hasForecastData ? chartData.findIndex(d => d.isProjected) : -1

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
  // Mode-aware: overnight/fullday use 2-day windows, threeday uses 4-day windows
  const overnightWindows = useMemo(() => {
    if (prices.hourly.length === 0) return []
    if (scenario.chargingMode === 'threeday') {
      const byDate = new Map<string, HourlyPrice[]>()
      for (const p of prices.hourly) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
      const windows: import('@/lib/charging-helpers').OvernightWindow[] = []
      for (const [dDate, dPrices] of byDate) {
        const d2 = addDaysStr(dDate, 1), d3 = addDaysStr(dDate, 2), d4 = addDaysStr(dDate, 3)
        const p2 = byDate.get(d2)
        if (!p2 || p2.length === 0) continue
        const all = [...dPrices.filter(p => p.hour >= deferredPlugInTime), ...p2]
        const p3 = byDate.get(d3)
        if (p3) all.push(...p3)
        const p4 = byDate.get(d4)
        if (p4) all.push(...p4.filter(p => p.hour < deferredPlugInTime))
        if (all.length === 0) continue
        const sorted = [...all].sort((a, b) => a.priceEurMwh - b.priceEurMwh)
        const dow = new Date(dDate + 'T12:00:00Z').getUTCDay()
        windows.push({ date: dDate, month: dDate.slice(0, 7), prices: all, sorted, isProjected: all.some(p => p.isProjected), isWeekend: dow === 0 || dow === 6 })
      }
      return windows
    }
    return buildOvernightWindows(prices.hourly, deferredPlugInTime, deferredDepartureTime)
  }, [prices.hourly, deferredPlugInTime, deferredDepartureTime, scenario.chargingMode])

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
    const prices = chartData.map(d => d.priceVal)
    const min = Math.min(...prices)
    const max = Math.max(...prices)
    const range = max - min || 1
    // Top padding 15% — keeps curve clear of date labels overlay
    // Bottom padding 5%
    return { min: min - range * 0.05, max: max + range * 0.15 }
  }, [chartData])

  const priceToY = (price: number) => {
    if (!plotArea) return CHART_MARGIN.top + 100
    const frac = (price - priceRange.min) / (priceRange.max - priceRange.min)
    return plotArea.top + (1 - frac) * plotArea.height
  }

  const mileageToPercent = (km: number) => ((km - SLIDER_MIN) / SLIDER_RANGE) * 100

  // X-axis tick — adaptive label interval based on chart width
  // Pre-compute midnight boundary indices (O(1) lookup)
  const midnightIdxSet = useMemo(() => {
    const set = new Set<number>()
    for (const d of chartData) {
      if (d.hour === 0 && d.minute === 0 && d.idx > 0) set.add(d.idx)
    }
    return set
  }, [chartData])

  // Compute label interval dynamically: ensure labels are ≥60px apart
  // A "HH:00" label is ~40px wide at 12px font, so 60px gives comfortable spacing
  const labelInterval = useMemo(() => {
    const chartWidth = plotArea?.width ?? 800
    const totalHours = chartData.length / (isQH ? 4 : 1)
    const pxPerHour = chartWidth / Math.max(totalHours, 1)
    const minPxBetweenLabels = 60
    // Round up to a "nice" interval: 2, 3, 4, 6, 8, 12
    const rawInterval = Math.ceil(minPxBetweenLabels / pxPerHour)
    const niceIntervals = [2, 3, 4, 6, 8, 12]
    return niceIntervals.find(n => n >= rawInterval) ?? 12
  }, [plotArea?.width, chartData.length, isQH])

  // Only emit ticks that will render (label positions + boundaries)
  const xTicks = useMemo(() => {
    return chartData
      .filter(d => d.minute === 0 && (midnightIdxSet.has(d.idx) || d.hour % labelInterval === 0))
      .map(d => d.idx)
  }, [chartData, midnightIdxSet, labelInterval])

  const renderXTick = useCallback((props: { x: number; y: number; payload: { value: number } }) => {
    const { x, y, payload } = props
    const pt = chartData[payload.value]
    if (!pt) return <g />
    const isDateBoundary = midnightIdxSet.has(pt.idx)

    // Suppress hour labels within ±1 interval of a midnight boundary to prevent overlap
    let isNearBoundary = false
    if (!isDateBoundary && pt.hour % labelInterval === 0) {
      const step = isQH ? 4 : 1
      for (const midIdx of midnightIdxSet) {
        if (Math.abs(pt.idx - midIdx) < step * labelInterval) { isNearBoundary = true; break }
      }
    }

    const showLabel = pt.hour % labelInterval === 0 && !isDateBoundary && !isNearBoundary
    const fontSize = labelInterval >= 6 ? 10 : 12
    return (
      <g transform={`translate(${x},${y})`}>
        <line x1={0} y1={0} x2={0} y2={isDateBoundary ? 8 : 6} stroke={isDateBoundary ? '#6B7280' : '#D1D5DB'} strokeWidth={isDateBoundary ? 1.5 : 1} />
        {showLabel && (
          <text x={0} y={0} dy={18} textAnchor="middle" fill="#6B7280" fontSize={fontSize} fontWeight={500}>
            {`${String(pt.hour).padStart(2, '0')}:00`}
          </text>
        )}
        {isDateBoundary && (
          <>
            <text x={0} y={0} dy={20} textAnchor="middle" fill="#374151" fontSize={fontSize} fontWeight={700}>
              00:00
            </text>
            <text x={0} y={0} dy={34} textAnchor="middle" fill="#6B7280" fontSize={Math.max(fontSize - 1, 9)} fontWeight={600}>
              {pt.date.slice(5)}
            </text>
          </>
        )}
      </g>
    )
  }, [chartData, midnightIdxSet, labelInterval, isQH])

  return (
    <div className="space-y-8">
      {/* ── Main two-column layout: LEFT sidebar + RIGHT content ── */}
      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">

      {/* ══ LEFT SIDEBAR — Customer Profile + Day Selector ══ */}
      <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
      <Card id="tour-customer-profile" className="overflow-hidden shadow-sm border-gray-200/80">
        <CardHeader className="pb-2 bg-gray-50/80 border-b border-gray-100">
          <CardTitle className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">Customer Profile</CardTitle>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          <div className="space-y-4">
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
              <div className="relative h-4">
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

            {/* Weekly plug-ins — single slider 1-7 */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between h-8">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Weekly Plug-ins</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{weeklyPlugIns}<span className="text-xs font-normal text-gray-400 ml-1">x / wk</span></span>
              </div>
              <div>
                <input type="range" min={1} max={7} step={1} value={weeklyPlugIns}
                  onChange={(e) => {
                    const total = Number(e.target.value)
                    const wd = Math.min(total, 5)
                    const we = Math.max(0, total - 5)
                    setScenario({ ...scenario, weekdayPlugIns: wd, weekendPlugIns: we })
                  }}
                  aria-label={`Weekly plug-ins: ${weeklyPlugIns}`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>1x</span>
                  <span>7x</span>
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
                  min={PLUGIN_HOUR_MIN}
                  max={PLUGIN_HOUR_MAX}
                  step={1}
                  value={scenario.plugInTime}
                  onChange={(e) => {
                    const newPlugIn = Number(e.target.value)
                    setScenario({ ...scenario, plugInTime: newPlugIn })
                  }}
                  aria-label={`Typical plug-in time: ${scenario.plugInTime}:00`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>{isFullDay ? '00:00' : '14:00'}</span>
                  <span>{isFullDay ? '23:00' : '22:00'}</span>
                </div>
              </div>
            </div>

            {/* Per Session — slider + display */}
            <div className="flex flex-col gap-2">
              <div className="flex items-baseline justify-between h-8">
                <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Per Session</span>
                <span className="text-2xl font-bold text-[#313131] tabular-nums">{energyPerSession}<span className="text-xs font-normal text-gray-400 ml-1">kWh</span></span>
              </div>
              <div>
                <input type="range" min={3} max={50} step={0.5}
                  value={energyPerSession}
                  onChange={(e) => {
                    const newKwh = Number(e.target.value)
                    const newMileage = Math.round(newKwh * sessionsPerYear * 100 / AVG_CONSUMPTION_KWH_PER_100KM / 1000) * 1000
                    const clampedMileage = Math.max(SLIDER_MIN, Math.min(SLIDER_MAX, newMileage))
                    setScenario({ ...scenario, yearlyMileageKm: clampedMileage })
                  }}
                  aria-label={`Energy per session: ${energyPerSession} kWh`}
                  className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                  <span>3 kWh</span>
                  <span>50 kWh</span>
                </div>
              </div>
              <p className="text-[10px] text-gray-400 text-center">~{kmPerCharge} km · {sessionsPerYear} sessions/yr</p>
            </div>

            {/* Session duration + charge power — bottom of card */}
            <div className="flex items-center justify-center gap-1.5 pt-2 border-t border-gray-100">
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
        </CardContent>
      </Card>

      </div>{/* end left sidebar */}

      {/* ══ RIGHT CONTENT — Calendar + Chart + Spread Indicators ══ */}
      <div className="lg:col-span-3 space-y-4">
        {/* Day Selector Strip */}
        <Card id="tour-day-selector" className="overflow-hidden shadow-sm border-gray-200/80">
          <CardContent className="py-2 px-3">
            <DateStrip
              daily={prices.daily}
              selectedDate={prices.selectedDate}
              onSelect={prices.setSelectedDate}
              requireNextDay={true}
              latestDate={latestAvailableDate}
            />
          </CardContent>
        </Card>
        <Card id="tour-price-chart" className="overflow-hidden shadow-sm border-gray-200/80">
          <CardHeader className="pb-3 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <CardTitle className="text-base font-bold text-[#313131]">
                  {isThreeDay ? '3-Day Price Curve' : isFullDay ? 'Full Day Price Curve' : 'Overnight Price Curve'}
                </CardTitle>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {isThreeDay
                    ? `${fmtDateShort(date1)} ${arrivalLabel} → ${fmtDateShort(date4)} 24:00`
                    : isFullDay
                      ? `${fmtDateShort(date1)} ${arrivalLabel} → ${fmtDateShort(date2)} 24:00`
                      : `${fmtDateShort(date1)} evening → ${fmtDateShort(date2)} morning`}
                  <span className="text-gray-300 ml-2">·</span>
                  <a href="https://www.smard.de" target="_blank" rel="noopener noreferrer" className="text-gray-300 hover:text-gray-500 underline underline-offset-2 ml-1">SMARD.de</a>
                  {hasForecastData && <span className="text-amber-400 ml-1">+ forecast</span>}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Mode toggle */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                  <button onClick={() => {
                    // Overnight default: plugIn 18:00, departure next day 06:00 (12h window)
                    const newPlugIn = Math.max(PLUGIN_HOUR_MIN, Math.min(PLUGIN_HOUR_MAX, scenario.plugInTime))
                    const depDefault = (newPlugIn + 12) % 24 // 18→6, 20→8, 22→10
                    setScenario({ ...scenario, chargingMode: 'overnight', plugInTime: newPlugIn, departureTime: depDefault })
                  }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${!isFullDay ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    Overnight
                  </button>
                  <button onClick={() => {
                    // Full day default: departure = same hour next day (24h window)
                    setScenario({ ...scenario, chargingMode: 'fullday', departureTime: scenario.plugInTime })
                  }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${scenario.chargingMode === 'fullday' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    Full Day
                  </button>
                  <button onClick={() => {
                    if (!hasDate3Data) return
                    // 3 days default: departure = same hour 3 days later (72h window)
                    setScenario({ ...scenario, chargingMode: 'threeday', departureTime: scenario.plugInTime })
                  }}
                    disabled={!hasDate3Data}
                    title={!hasDate3Data ? 'No price data available for day 3' : '3-day optimization window'}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${scenario.chargingMode === 'threeday' ? 'bg-white text-[#313131] shadow-sm' : !hasDate3Data ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}>
                    3 Days
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
                      <TooltipContent side="bottom" className="max-w-[220px] text-left p-3">
                        <p className="text-[11px] text-gray-500 leading-relaxed">
                          15-min data is missing — used hourly average
                        </p>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                )}
                {hasForecastData && (
                  <TooltipProvider delayDuration={100}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <span className="text-[10px] font-semibold text-amber-700 bg-amber-50 border border-amber-200 rounded-full px-2 py-0.5 cursor-help select-none">
                          Forecast
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[260px] text-left space-y-1.5 p-3">
                        <p className="font-semibold text-[12px]">Contains forecast prices</p>
                        <p className="text-[11px] text-gray-500 leading-relaxed">
                          The dashed portion of the chart uses predicted prices from EnergyForecast.de,
                          not yet published EPEX Spot auction results. Actual prices may differ.
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
          <CardContent className="pb-1">
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
                    <linearGradient id="forecastGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#D97706" stopOpacity={0.08} />
                      <stop offset="100%" stopColor="#D97706" stopOpacity={0} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

                  <XAxis dataKey="idx" type="number" domain={[0, Math.max(chartData.length - 1, 1)]}
                    ticks={xTicks} tick={renderXTick as never} tickLine={false}
                    stroke="#9CA3AF" interval={0} height={midnightIdxSet.size > 0 ? 48 : 32}
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
                          <p className="font-semibold tabular-nums">{d.priceVal.toFixed(2)} ct/kWh{d.isProjected && <span className="text-amber-600 text-[10px] font-normal ml-1">forecast</span>}</p>
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
                    const arrivalPrice = chartData[arrivalIdx]?.priceVal
                    const lowestWindowPrice = Math.min(...windowPts.map(d => d.priceVal))
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
                  {/* Forecast price — dashed amber line + matching area fill */}
                  {hasForecastData && (
                    <>
                      <Area type="monotone" dataKey="priceForecast" yAxisId="left" fill="url(#forecastGrad)" stroke="none" connectNulls={false} />
                      <Line type="monotone" dataKey="priceForecast" yAxisId="left" stroke="#D97706" strokeWidth={1.5}
                        strokeDasharray="6 3"
                        dot={isQH ? { r: 1.5, fill: '#D97706', stroke: 'none' } : false}
                        connectNulls={false} />
                    </>
                  )}

                  {/* Baseline dots — red, no connecting line for clarity on non-contiguous hours */}
                  <Line type="monotone" dataKey="baselinePrice" yAxisId="left" stroke="#EF4444" strokeWidth={isQH ? 2 : 3}
                    dot={isQH ? { r: 2, fill: '#EF4444', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#EF4444', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Optimized dots — green */}
                  <Line type="monotone" dataKey="optimizedPrice" yAxisId="left" stroke="#10B981" strokeWidth={isQH ? 2 : 3}
                    dot={isQH ? { r: 2, fill: '#10B981', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#10B981', stroke: '#fff', strokeWidth: 1.5 }}
                    connectNulls={false} />

                  {/* Forecast tint background */}
                  {forecastStartIdx >= 0 && (
                    <ReferenceArea x1={forecastStartIdx} x2={N - 1} yAxisId="left"
                      fill="#D97706" fillOpacity={0.03} stroke="none" ifOverflow="hidden" />
                  )}
                  {/* Arrival/departure/midnight lines rendered as HTML overlays below for guaranteed visibility */}
                </ComposedChart>
              </ResponsiveContainer>

              {/* ── Date labels — positioned between midnight boundaries ── */}
              {N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const pL = plotArea.left
                const pR = plotArea.left + plotArea.width
                // Collect all midnight boundaries
                const midnights: { date: string; x: number }[] = []
                for (const midIdx of midnightIdxSet) {
                  const pt = chartData[midIdx]
                  if (pt) midnights.push({ date: pt.date, x: idxToPx(midIdx) })
                }
                midnights.sort((a, b) => a.x - b.x)
                // Build day segments: [chartStart, mid1], [mid1, mid2], ..., [midN, chartEnd]
                const segments: { label: string; center: number }[] = []
                const edges = [pL, ...midnights.map(m => m.x), pR]
                // Day labels: date1, then each midnight's date
                const dayLabels = [date1, ...midnights.map(m => m.date)]
                for (let i = 0; i < dayLabels.length; i++) {
                  const left = edges[i]
                  const right = edges[i + 1] ?? pR
                  if (right - left > 30) { // only show if segment wide enough
                    segments.push({ label: fmtDateShort(dayLabels[i]), center: left + (right - left) / 2 })
                  }
                }
                return segments.map((seg, i) => (
                  <div key={i} className="absolute pointer-events-none z-[6] text-[12px] font-bold text-gray-500"
                    style={{ left: seg.center, top: plotArea.top + 4, transform: 'translateX(-50%)' }}>
                    {seg.label}
                  </div>
                ))
              })()}

              {/* ── Grey overlays OUTSIDE charging window ── */}
              {N > 1 && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const aX = arrivalIdx >= 0 ? idxToPx(arrivalIdx) : plotArea.left
                const dX = departureIdx >= 0 ? idxToPx(departureIdx) : plotArea.left + plotArea.width
                const fcIdx = forecastStartIdx >= 0 ? idxToPx(forecastStartIdx) : -1
                // All midnight divider x-positions
                const midXs = Array.from(midnightIdxSet).map(i => idxToPx(i))
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
                    {/* Midnight divider lines */}
                    {midXs.map((mx, i) => (
                      <div key={`mid-${i}`} className="absolute pointer-events-none z-[7]"
                        style={{ left: mx, top: plotArea.top, width: 1, height: plotArea.height, background: '#64748b', opacity: 0.4 }} />
                    ))}
                    {/* Plug-in line — red */}
                    {arrivalIdx >= 0 && (
                      <div className="absolute pointer-events-none z-[8]"
                        style={{ left: aX - 0.75, top: plotArea.top, width: 1.5, height: plotArea.height, background: '#EA1C0A', opacity: 0.6 }} />
                    )}
                    {/* Departure line — blue */}
                    {departureIdx >= 0 && (
                      <div className="absolute pointer-events-none z-[8]"
                        style={{ left: dX - 0.75, top: plotArea.top, width: 1.5, height: plotArea.height, background: '#2563EB', opacity: 0.6 }} />
                    )}
                    {/* Forecast start divider — dashed amber with label */}
                    {fcIdx >= 0 && (
                      <>
                        <div className="absolute pointer-events-none z-[7]"
                          style={{ left: fcIdx, top: plotArea.top, width: 0, height: plotArea.height, borderLeft: '1.5px dashed rgba(217, 119, 6, 0.45)' }} />
                        <div className="absolute pointer-events-none z-[7] text-[9px] font-semibold text-amber-600"
                          style={{ left: fcIdx + 4, top: plotArea.top + 2 }}>
                          Forecast
                        </div>
                      </>
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
                    <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                      style={{ left: bCenter, top: bYAdj, transform: 'translateX(-50%)' }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] font-bold text-red-500 uppercase tracking-wider">Immediate</span>
                        <div className="bg-red-50/95 backdrop-blur-sm border border-red-200/80 rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                          <span className="text-red-700 text-[13px] font-bold tabular-nums whitespace-nowrap">
                            {sessionCost.baselineAvgCt.toFixed(1)} ct/kWh
                          </span>
                          <span className="text-red-400 text-[10px] tabular-nums whitespace-nowrap">
                            {sessionCost.baselineEur.toFixed(2)} €
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Optimized */}
                    <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                      style={{ left: oCenter, top: oYAdj, transform: 'translateX(-50%)' }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Optimized</span>
                        <div className="bg-emerald-50/95 backdrop-blur-sm border border-emerald-200/80 rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0" />
                          <span className="text-emerald-700 text-[13px] font-bold tabular-nums whitespace-nowrap">
                            {sessionCost.optimizedAvgCt.toFixed(1)} ct/kWh
                          </span>
                          <span className="text-emerald-400 text-[10px] tabular-nums whitespace-nowrap">
                            {sessionCost.optimizedEur.toFixed(2)} €
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

          </CardContent>
        </Card>

      {/* ── Spread Indicators — horizontal row below chart ── */}
      {(() => {
        if (!date1 || chartData.length === 0) return null

        const fmtHour = (h: number) => `${String(h).padStart(2, '0')}:00`
        const mode = scenario.chargingMode
        // Each mode uses actual departureTime when active, canonical when inactive
        const overnightDep = mode === 'overnight' ? scenario.departureTime : (scenario.plugInTime + 12) % 24
        const fullDayDep = mode === 'fullday' ? scenario.departureTime : scenario.plugInTime
        const threeDayDep = mode === 'threeday' ? scenario.departureTime : scenario.plugInTime

        // Overnight: plug-in evening → next morning
        const overnightSpreadWin = buildMultiDayWindow(prices.hourly, date1, date2, scenario.plugInTime, overnightDep)
        const overnightSp = computeSpread(overnightSpreadWin, energyPerSession, chargePowerKw)

        // Full day: plug-in → departure on next day
        const fullDaySpreadWin = buildMultiDayWindow(prices.hourly, date1, date2, scenario.plugInTime, fullDayDep)
        const fullDaySp = computeSpread(fullDaySpreadWin, energyPerSession, chargePowerKw)

        // 3-day: plug-in → departure on day+3
        const threeDaySpreadWin = hasDate3Data
          ? buildMultiDayWindow(prices.hourly, date1, date4, scenario.plugInTime, threeDayDep) : []
        const threeDaySp = hasDate3Data ? computeSpread(threeDaySpreadWin, energyPerSession, chargePowerKw) : null
        const hasForecast3d = hasDate3Data && threeDaySpreadWin.some(p => p.isProjected)

        // Savings use the same windows
        const savingsOvernight = overnightSp
        const savingsFullDay = fullDaySp
        const savings3Day = threeDaySp

        // Determine which mode is currently active for highlight
        const activeMode = scenario.chargingMode === 'threeday' ? '3day' : scenario.chargingMode === 'fullday' ? 'fullday' : 'overnight'

        type SpreadRow = {
          key: string
          label: string
          tooltip: { title: string; desc: string; extra?: string }
          spread: ReturnType<typeof computeSpread>
          savings: ReturnType<typeof computeSpread>
          spreadRange: string
          savingsRange: string
          windowPrices: HourlyPrice[]
        }
        const rows: SpreadRow[] = []

        if (overnightSp) {
          rows.push({
            key: 'overnight',
            label: 'Overnight',
            tooltip: { title: 'Overnight window', desc: `${fmtHour(scenario.plugInTime)} → ${fmtHour(overnightDep)} next morning.` },
            spread: overnightSp, savings: savingsOvernight, windowPrices: overnightSpreadWin,
            spreadRange: `${fmtHour(scenario.plugInTime)} ${fmtDateShort(date1)} → ${fmtHour(overnightDep)} ${fmtDateShort(date2)}`,
            savingsRange: `${fmtHour(scenario.plugInTime)} → ${fmtHour(overnightDep)}`,
          })
        }
        if (fullDaySp) {
          rows.push({
            key: 'fullday',
            label: 'Full Day',
            tooltip: { title: 'Full day window', desc: `${fmtHour(scenario.plugInTime)} → ${fmtHour(fullDayDep)} next day.` },
            spread: fullDaySp, savings: savingsFullDay, windowPrices: fullDaySpreadWin,
            spreadRange: `${fmtHour(scenario.plugInTime)} ${fmtDateShort(date1)} → ${fmtHour(fullDayDep)} ${fmtDateShort(date2)}`,
            savingsRange: `${fmtHour(scenario.plugInTime)} → ${fmtHour(fullDayDep)}`,
          })
        }
        if (threeDaySp) {
          rows.push({
            key: '3day',
            label: '3-Day',
            tooltip: {
              title: '3-day window',
              desc: `${fmtHour(scenario.plugInTime)} → ${fmtHour(threeDayDep)} on ${fmtDateShort(date4)}.`,
              extra: hasForecast3d ? 'Includes forecast prices.' : undefined,
            },
            spread: threeDaySp, savings: savings3Day, windowPrices: threeDaySpreadWin,
            spreadRange: `${fmtHour(scenario.plugInTime)} ${fmtDateShort(date1)} → ${fmtHour(threeDayDep)} ${fmtDateShort(date4)}`,
            savingsRange: `${fmtHour(scenario.plugInTime)} → ${fmtHour(threeDayDep)}`,
          })
        }

        if (rows.length === 0) return null

        // Map row keys to perModeSavings keys
        const modeKeyMap: Record<string, string> = { overnight: 'overnight', fullday: 'fullday', '3day': 'threeday' }

        return (
          <div className={`grid gap-3 ${rows.length === 3 ? 'grid-cols-3' : rows.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {rows.map(row => {
              const isActive = row.key === activeMode
              const ms = perModeSavings[modeKeyMap[row.key]] ?? { ctKwh4w: 0, eur4w: 0, ctKwh52w: 0, eur52w: 0 }
              return (
                <div key={row.key}
                  onClick={() => {
                    const modeMap: Record<string, 'overnight' | 'fullday' | 'threeday'> = { overnight: 'overnight', fullday: 'fullday', '3day': 'threeday' }
                    const newMode = modeMap[row.key]
                    if (newMode && newMode !== scenario.chargingMode) {
                      if (newMode === 'overnight') {
                        const depDefault = (scenario.plugInTime + 12) % 24
                        setScenario({ ...scenario, chargingMode: 'overnight', departureTime: depDefault })
                      } else {
                        setScenario({ ...scenario, chargingMode: newMode, departureTime: scenario.plugInTime })
                      }
                    }
                    // Update detail panel to follow the clicked scenario
                    if (costDetailMode) setCostDetailMode(row.key)
                  }}
                  className={`rounded-lg border p-3 transition-all cursor-pointer ${
                    isActive
                      ? 'bg-white border-gray-300 shadow-sm ring-1 ring-gray-200'
                      : 'bg-gray-50/80 border-gray-200 hover:border-gray-300 hover:shadow-sm'
                  }`}>
                  <div className="mb-2">
                    <div className="flex items-center gap-2">
                      <TooltipProvider delayDuration={200}>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className={`text-[11px] font-semibold cursor-help ${isActive ? 'text-[#313131]' : 'text-gray-400'}`}>
                              {row.label}
                              {isActive && <span className="ml-1.5 text-[9px] font-bold text-emerald-600 bg-emerald-50 px-1.5 py-0.5 rounded-full">active</span>}
                              {row.key === '3day' && hasForecast3d && <span className="text-amber-600 text-[9px] ml-1">(forecast)</span>}
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[220px] text-left p-3 space-y-1">
                            <p className="font-semibold text-[12px]">{row.tooltip.title}</p>
                            <p className="text-[11px] text-gray-500 leading-relaxed">{row.tooltip.desc}</p>
                            {row.tooltip.extra && <p className="text-[11px] text-amber-600">{row.tooltip.extra}</p>}
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </div>
                    <p className={`text-[9px] font-mono mt-0.5 ${isActive ? 'text-gray-500' : 'text-gray-400'}`}>
                      {row.spreadRange}
                    </p>
                  </div>
                  {/* Selected day savings — avg ct/kWh prominent */}
                  {row.savings && (
                    <div className="mb-2">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Selected Day</p>
                      <span className={`text-xl font-extrabold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {row.savings.capturableSavingsCtKwh.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-400 ml-1">ct/kWh</span>
                      <p className={`text-[10px] mt-0.5 ${isActive ? 'text-emerald-600/70' : 'text-gray-400'}`}>
                        {(row.savings.capturableSavingsEur * 100).toFixed(1)} ct for {energyPerSession} kWh
                      </p>
                    </div>
                  )}
                  {/* Last 4 weeks + Last 52 weeks — per-mode calculation */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 mb-2">
                    <div>
                      <p className="text-[8px] text-gray-400 uppercase tracking-wide">Last 4 weeks</p>
                      <p className={`text-[13px] font-bold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {ms.ctKwh4w.toFixed(2)}<span className="text-[8px] font-normal text-gray-400 ml-0.5">ct/kWh</span>
                      </p>
                      <p className="text-[8px] text-gray-400">{ms.eur4w.toFixed(2)} EUR</p>
                    </div>
                    <div>
                      <p className="text-[8px] text-gray-400 uppercase tracking-wide">Last 52 weeks</p>
                      <p className={`text-[13px] font-bold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {ms.ctKwh52w.toFixed(2)}<span className="text-[8px] font-normal text-gray-400 ml-0.5">ct/kWh</span>
                      </p>
                      <p className="text-[8px] text-gray-400">{ms.eur52w.toFixed(0)} EUR/yr</p>
                    </div>
                  </div>
                  {/* Spread = min↔max */}
                  <div className="flex items-baseline justify-between pt-1.5 border-t border-gray-100">
                    <span className="text-[9px] text-gray-400 uppercase tracking-wide">Spread</span>
                    <span className={`text-[13px] font-bold tabular-nums ${isActive ? 'text-[#313131]' : 'text-gray-500'}`}>
                      {row.spread!.marketSpreadCtKwh.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">ct</span>
                    </span>
                  </div>
                  <p className="text-[8px] text-gray-400 font-mono leading-relaxed">
                    {row.spread!.cheapestHour} {row.spread!.minPriceCtKwh.toFixed(1)} ↔ {row.spread!.expensiveHour} {row.spread!.maxPriceCtKwh.toFixed(1)} ct
                  </p>
                  {/* Detail toggle */}
                  <button
                    onClick={(e) => { e.stopPropagation(); setCostDetailMode(costDetailMode === row.key ? null : row.key) }}
                    className="mt-2 w-full text-[9px] font-semibold text-gray-400 hover:text-gray-600 transition-colors flex items-center justify-center gap-1 pt-1.5 border-t border-gray-100"
                  >
                    {costDetailMode === row.key ? 'Hide' : 'Details'} {costDetailMode === row.key ? '▲' : '▼'}
                  </button>
                </div>
              )
            })}
          </div>
        )
      })()}

      {/* ── Session Cost Detail Panel ── */}
      {costDetailMode && (() => {
        const modeD = scenario.chargingMode
        const overnightDepD = modeD === 'overnight' ? scenario.departureTime : (scenario.plugInTime + 12) % 24
        const fullDayDepD = modeD === 'fullday' ? scenario.departureTime : scenario.plugInTime
        const threeDayDepD = modeD === 'threeday' ? scenario.departureTime : scenario.plugInTime
        // Use QH prices when in 15-min resolution
        const detailPrices = isQH && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
        const detailIsQH = isQH && prices.hourlyQH.length > 0
        const winMap: Record<string, { prices: HourlyPrice[]; label: string }> = {
          overnight: { prices: buildMultiDayWindow(detailPrices, date1, date2, scenario.plugInTime, overnightDepD), label: 'Overnight' },
          fullday: { prices: buildMultiDayWindow(detailPrices, date1, date2, scenario.plugInTime, fullDayDepD), label: 'Full Day' },
          '3day': { prices: hasDate3Data ? buildMultiDayWindow(detailPrices, date1, date4, scenario.plugInTime, threeDayDepD) : [], label: '3-Day' },
        }
        const detail = winMap[costDetailMode]
        if (!detail || detail.prices.length === 0) return null
        // QH: each slot = 15min = chargePowerKw * 0.25 kWh; Hourly: each slot = 1h = chargePowerKw kWh
        const kwhPerSlot = detailIsQH ? chargePowerKw * 0.25 : chargePowerKw
        const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
        const slotLabel = detailIsQH ? `${slotsNeeded} × 15 min` : `${slotsNeeded}h`
        const windowLabel = detailIsQH ? `${detail.prices.length} × 15 min` : `${detail.prices.length}h`
        const wp = detail.prices
        const baselineSlots = wp.slice(0, slotsNeeded)
        const optimizedSlots = [...wp].sort((a: HourlyPrice, b: HourlyPrice) => a.priceEurMwh - b.priceEurMwh).slice(0, slotsNeeded)
          .sort((a: HourlyPrice, b: HourlyPrice) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0))
        const bAvg = baselineSlots.length > 0 ? baselineSlots.reduce((s: number, p: HourlyPrice) => s + p.priceCtKwh, 0) / baselineSlots.length : 0
        const oAvg = optimizedSlots.length > 0 ? optimizedSlots.reduce((s: number, p: HourlyPrice) => s + p.priceCtKwh, 0) / optimizedSlots.length : 0
        const bEur = bAvg * energyPerSession / 100
        const oEur = oAvg * energyPerSession / 100
        const fmtSlot = (p: HourlyPrice) => {
          const d = p.date !== date1 ? ` ${p.date.slice(8, 10)}.` : ''
          return `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}${d}`
        }

        return (
          <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-[11px] font-bold text-[#313131]">
                Session Cost — {detail.label} · {fmtDateShort(date1)} {detailIsQH && <span className="text-[9px] text-gray-400 font-normal ml-1">(15 min)</span>}
              </p>
              <div className="flex items-center gap-3">
                <p className="text-[10px] text-gray-400">
                  {slotLabel} charge · {windowLabel} window · {energyPerSession} kWh
                </p>
                <button onClick={() => setCostDetailMode(null)} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              {/* Baseline = first N slots */}
              <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
                <p className="text-[10px] font-bold text-red-500 uppercase tracking-wider mb-2">
                  Unmanaged · first {slotLabel}
                </p>
                <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                  {baselineSlots.map((p: HourlyPrice, i: number) => (
                    <div key={i} className="flex justify-between text-[11px] leading-snug">
                      <span className="font-mono text-gray-500">{fmtSlot(p)}</span>
                      <span className="tabular-nums font-semibold text-red-700">{p.priceCtKwh.toFixed(1)} ct</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-red-200/80 mt-2 pt-1.5 flex justify-between text-[11px]">
                  <span className="text-gray-500 font-medium">avg</span>
                  <span className="font-bold text-red-700 tabular-nums">{bAvg.toFixed(2)} ct/kWh</span>
                </div>
                <div className="flex justify-between text-[10px] mt-0.5">
                  <span className="text-gray-400">cost</span>
                  <span className="font-semibold text-red-600 tabular-nums">{bEur.toFixed(2)} EUR</span>
                </div>
              </div>

              {/* Optimized = cheapest N hours */}
              <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-100/80">
                <p className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider mb-2">
                  Optimized · cheapest {slotLabel}
                </p>
                <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                  {optimizedSlots.map((p: HourlyPrice, i: number) => (
                    <div key={i} className="flex justify-between text-[11px] leading-snug">
                      <span className="font-mono text-gray-500">{fmtSlot(p)}</span>
                      <span className="tabular-nums font-semibold text-emerald-700">{p.priceCtKwh.toFixed(1)} ct</span>
                    </div>
                  ))}
                </div>
                <div className="border-t border-emerald-200/80 mt-2 pt-1.5 flex justify-between text-[11px]">
                  <span className="text-gray-500 font-medium">avg</span>
                  <span className="font-bold text-emerald-700 tabular-nums">{oAvg.toFixed(2)} ct/kWh</span>
                </div>
                <div className="flex justify-between text-[10px] mt-0.5">
                  <span className="text-gray-400">cost</span>
                  <span className="font-semibold text-emerald-600 tabular-nums">{oEur.toFixed(2)} EUR</span>
                </div>
              </div>
            </div>

            {/* Summary row */}
            <div className="flex items-center justify-between bg-gray-50 rounded-lg px-3 py-2 border border-gray-100">
              <div className="text-[10px] text-gray-500">
                <span className="font-mono">{bAvg.toFixed(2)} ct − {oAvg.toFixed(2)} ct = <strong className="text-emerald-600">{(bAvg - oAvg).toFixed(2)} ct/kWh</strong></span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-gray-400">savings </span>
                <span className="text-[13px] font-bold text-emerald-700 tabular-nums">{(bEur - oEur).toFixed(2)} EUR</span>
                <span className="text-[10px] text-gray-400 ml-1">/session</span>
              </div>
            </div>
          </div>
        )
      })()}

      </div>{/* end right content column */}
      </div>{/* end main two-column grid */}

      {/* Savings integrated into scenario cards above */}

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
            chargingMode={scenario.chargingMode}
          />
          {yearlySavingsData.length > 0 && (
            <YearlySavingsCard
              yearlySavingsData={yearlySavingsData}
              weeklyPlugIns={weeklyPlugIns}
              energyPerSession={energyPerSession}
              chargingMode={scenario.chargingMode}
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

      {/* ── Spread Indicators — disabled for performance ── */}
      {/* <SpreadIndicatorsCard ... /> */}

      {/* ── Flexibility Demo Chart — disabled for performance ── */}
      {/* <FlexibilityDemoChart /> */}

      {/* ── Behavior Heatmap — disabled for performance ── */}
      {/* <SavingsHeatmap ... /> */}

      {/* ── Fleet Portfolio View — disabled for performance ── */}
      {/* <FleetPortfolioCard ... /> */}

    </div>
  )
}
