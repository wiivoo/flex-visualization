'use client'

import { useMemo, useState, useCallback, useEffect, useRef, useDeferredValue } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tooltip as UITooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { AnimatedNumber } from '@/components/v2/AnimatedNumber'
import { deriveEnergyPerSession, totalWeeklyPlugIns, AVG_CONSUMPTION_KWH_PER_100KM, DEFAULT_CHARGE_POWER_KW, type ChargingScenario, type HourlyPrice, type DailySummary, type MonthlyStats } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
import { nextDayStr, fmtDateShort, computeWindowSavings, buildOvernightWindows, computeSpread, buildMultiDayWindow, addDaysStr, computeV2gWindowSavings, type V2gResult } from '@/lib/charging-helpers'
import { VEHICLE_PRESETS, ENABLE_V2G } from '@/lib/v2-config'
import { DateStrip } from '@/components/v2/DateStrip'
import { SessionCostCard } from '@/components/v2/SessionCostCard'
import { MonthlySavingsCard } from '@/components/v2/MonthlySavingsCard'
import { DailySavingsHeatmap } from '@/components/v2/DailySavingsHeatmap'
// Disabled for performance: SavingsHeatmap, FleetPortfolioCard, SpreadIndicatorsCard, FlexibilityDemoChart
import { YearlySavingsCard, type YearlySavingsEntry } from '@/components/v2/YearlySavingsCard'
import { generateAndDownloadExcel, type EnrichedWindow } from '@/lib/excel-export'
import { DEFAULT_FLEET_CONFIG, type FleetConfig, type FleetOptimizationResult } from '@/lib/v2-config'
import { computeFlexBand, optimizeFleetSchedule, computeFleetEnergyKwh, deriveFleetDistributions } from '@/lib/fleet-optimizer'
import { FleetConfigPanel } from '@/components/v2/FleetConfigPanel'
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
const CHART_MARGIN = { top: 42, right: 30, bottom: 25, left: 20 }

interface PriceData {
  hourly: HourlyPrice[]
  hourlyQH: HourlyPrice[]
  daily: DailySummary[]
  monthly: MonthlyStats[]
  loading: boolean
  error: string | null
  selectedDate: string
  setSelectedDate: (date: string) => void
  selectedDayPrices: HourlyPrice[]
  yearRange: { start: string; end: string }
  lastRealDate: string
  intradayId3?: HourlyPrice[]
}

interface Props {
  prices: PriceData
  scenario: ChargingScenario
  setScenario: (s: ChargingScenario) => void
  optimization: OptimizeResult | null
  country?: 'DE' | 'NL'
  setCountry?: (c: 'DE' | 'NL') => void
  onExportReady?: (fn: (() => void) | null) => void
}

/* ────── Main Component ────── */
export function Step2ChargingScenario({ prices, scenario, setScenario, country = 'DE', setCountry, onExportReady }: Props) {
  const chargePowerKw = scenario.chargePowerKw ?? DEFAULT_CHARGE_POWER_KW
  const isV2G = scenario.gridMode === 'v2g'
  // V2G: does the battery need net charging? (startSoC < targetSoC)
  const v2gHasNetCharge = isV2G && scenario.v2gStartSoc < scenario.v2gTargetSoc
  const vehiclePreset = VEHICLE_PRESETS.find(v => v.id === scenario.vehicleId) ?? VEHICLE_PRESETS[1]
  const batteryKwh = isV2G ? (scenario.v2gBatteryKwh ?? 60) : vehiclePreset.battery_kwh
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
  const [isDragging, setIsDragging] = useState<'arrival' | 'departure' | 'fleetArrival' | 'fleetDeparture' | null>(null)
  const [costDetailMode, setCostDetailMode] = useState<string | null>(null)
  const [resolution, setResolution] = useState<'hour' | 'quarterhour'>('hour')
  const [plotArea, setPlotArea] = useState<{ left: number; width: number; top: number; height: number } | null>(null)
  const [showRenewable, setShowRenewable] = useState(false)
  const [showIntraday, setShowIntraday] = useState(false)
  const [renewableData, setRenewableData] = useState<Map<string, number>>(new Map())
  // Fleet flex band state (PROJ-35/36/37)
  const [showFleet, setShowFleet] = useState(false)
  const [fleetView, setFleetView] = useState<'single' | 'fleet'>('fleet')
  const [fleetConfig, setFleetConfig] = useState<FleetConfig>(DEFAULT_FLEET_CONFIG)
  const deferredFleetConfig = useDeferredValue(fleetConfig)

  // ── Edge-scroll: navigate days by pressing/holding chart edges ──
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const selectedDateRef = useRef(prices.selectedDate)
  selectedDateRef.current = prices.selectedDate

  const sortedDates = useMemo(() => {
    const dates = prices.daily.map(d => d.date).sort()
    const dateSet = new Set(dates)
    return dates.filter(d => {
      const nd = new Date(d + 'T12:00:00Z')
      nd.setUTCDate(nd.getUTCDate() + 1)
      return dateSet.has(nd.toISOString().slice(0, 10))
    })
  }, [prices.daily])

  const sortedDatesRef = useRef(sortedDates)
  sortedDatesRef.current = sortedDates

  const startEdgeScroll = useCallback((dir: -1 | 1) => {
    const step = () => {
      const idx = sortedDatesRef.current.indexOf(selectedDateRef.current)
      if (idx < 0) return
      const next = sortedDatesRef.current[idx + dir]
      if (next) prices.setSelectedDate(next)
    }
    step() // immediate first step
    let speed = 400
    const tick = () => {
      step()
      speed = Math.max(120, speed * 0.85)
      scrollTimerRef.current = setTimeout(tick, speed)
    }
    scrollTimerRef.current = setTimeout(tick, speed)
  }, [prices.setSelectedDate])

  const stopEdgeScroll = useCallback(() => {
    if (scrollTimerRef.current) {
      clearTimeout(scrollTimerRef.current)
      scrollTimerRef.current = null
    }
  }, [])

  useEffect(() => () => stopEdgeScroll(), [stopEdgeScroll])

  // Latest available date for "Jump to latest" button
  const latestAvailableDate = useMemo(() => {
    const now = new Date()
    now.setUTCDate(now.getUTCDate() - 1)
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
  const { chartData, sessionCost, v2gResult, hasIntraday, intradayUpliftCt, intradayUpliftEur, id3DaScheduleAvgCt, id3OptScheduleAvgCt } = useMemo(() => {
    if (chartPrices.length === 0 || !date1) {
      return { chartData: [], sessionCost: null, v2gResult: null, rollingAvgSavings: 0, monthlySavings: 0, hasIntraday: false, intradayUpliftCt: 0, intradayUpliftEur: 0, id3DaScheduleAvgCt: 0, id3OptScheduleAvgCt: 0 }
    }

    const kwhPerSlot = isQH ? chargePowerKw * 0.25 : chargePowerKw
    const slotsNeeded = Math.ceil(energyPerSession / kwhPerSlot)
    type ChartPoint = { idx: number; hour: number; minute: number; date: string; label: string; price: number | null; priceForecast: number | null; priceVal: number; baselinePrice: number | null; optimizedPrice: number | null; daSoldPrice: number | null; dischargePrice: number | null; netChargePrice: number | null; arbChargePrice: number | null; intradayId3Price: number | null; id3OptimizedPrice: number | null; isInWindow: boolean; isProjected?: boolean; renewableShare?: number; greedyKw?: number | null; lazyKw?: number | null; optimizedKw?: number | null; greedyScheduleKw?: number | null; fleetChargePrice?: number | null; fleetBaselinePrice?: number | null; fleetChargeIntensity?: number }
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
          padded.push({ ...lastKnown, hour, minute, date: d, isProjected: !!lastKnown.isProjected })
        }
      }
    }

    if (padded.length === 0) return { chartData: [], sessionCost: null }

    // Build ID3 intraday price map
    // ID3 data is always QH (96 pts/day). When chart is hourly, aggregate to hourly avg.
    const id3Map = new Map<string, number>()
    if (prices.intradayId3) {
      if (isQH) {
        for (const p of prices.intradayId3) {
          id3Map.set(`${p.date}-${p.hour}-${p.minute ?? 0}`, p.priceCtKwh)
        }
      } else {
        // Aggregate QH → hourly: average the 4 quarter-hour prices per hour
        const hourBuckets = new Map<string, number[]>()
        for (const p of prices.intradayId3) {
          const hKey = `${p.date}-${p.hour}-0`
          const arr = hourBuckets.get(hKey) || []
          arr.push(p.priceCtKwh)
          hourBuckets.set(hKey, arr)
        }
        for (const [hKey, vals] of hourBuckets) {
          id3Map.set(hKey, Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100)
        }
      }
    }

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

    // V2G: compute discharge slots
    let v2gDischargeKeys = new Set<string>()
    let v2gChargeKeys = new Set<string>()
    let v2gNetChargeKeys = new Set<string>()
    let v2gArbChargeKeys = new Set<string>()
    let v2g: ReturnType<typeof computeV2gWindowSavings> | null = null
    if (isV2G && windowPrices.length > 0) {
      v2g = computeV2gWindowSavings(
        windowPrices, batteryKwh, chargePowerKw, scenario.dischargePowerKw,
        scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent,
        scenario.roundTripEfficiency, scenario.degradationCtKwh, kwhPerSlot,
      )
      v2gDischargeKeys = v2g.dischargeKeys
      v2gChargeKeys = v2g.chargeKeys
      v2gNetChargeKeys = v2g.netChargeKeys
      v2gArbChargeKeys = v2g.arbChargeKeys
    }

    // Intraday ID3 re-optimization uplift (computed before chart mapping so keys are available)
    // ID3 data is usable if enough slots have prices for re-optimization (>= slotsNeeded)
    const id3WindowPricesAll = windowPrices.filter(p => id3Map.has(`${p.date}-${p.hour}-${p.minute ?? 0}`))
    const hasIntradayData = id3WindowPricesAll.length >= slotsNeeded
    let intradayUpliftEurVal = 0
    let intradayUpliftCtVal = 0
    let id3OptimizedKeys = new Set<string>()
    let id3DaScheduleAvgCtVal = 0
    let id3OptScheduleAvgCtVal = 0
    if (hasIntradayData && windowPrices.length >= slotsNeeded) {
      const daOptSlots = sortedByPrice.slice(0, slotsNeeded)
      id3DaScheduleAvgCtVal = daOptSlots.reduce((s, p) => {
        const key = `${p.date}-${p.hour}-${p.minute ?? 0}`
        return s + (id3Map.get(key) ?? p.priceCtKwh)
      }, 0) / daOptSlots.length

      const id3WindowPrices = windowPrices.filter(p => id3Map.has(`${p.date}-${p.hour}-${p.minute ?? 0}`))
      if (id3WindowPrices.length >= slotsNeeded) {
        const id3Sorted = [...id3WindowPrices].sort((a, b) => {
          const aKey = `${a.date}-${a.hour}-${a.minute ?? 0}`
          const bKey = `${b.date}-${b.hour}-${b.minute ?? 0}`
          return (id3Map.get(aKey) ?? 0) - (id3Map.get(bKey) ?? 0)
        })
        const id3OptSlots = id3Sorted.slice(0, slotsNeeded)
        id3OptScheduleAvgCtVal = id3OptSlots.reduce((s, p) => {
          const key = `${p.date}-${p.hour}-${p.minute ?? 0}`
          return s + (id3Map.get(key) ?? 0)
        }, 0) / slotsNeeded

        id3OptimizedKeys = new Set(id3OptSlots.map(p => `${p.date}-${p.hour}-${p.minute ?? 0}`))
        intradayUpliftCtVal = Math.round((id3DaScheduleAvgCtVal - id3OptScheduleAvgCtVal) * 100) / 100
        intradayUpliftEurVal = Math.round(intradayUpliftCtVal * energyPerSession) / 100
      }
    }

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
      // V2G: override optimized keys with V2G charge keys
      const optKey = isV2G ? v2gChargeKeys.has(key) : optimizedKeys.has(key)
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
        optimizedPrice: optKey ? ct : null,
        daSoldPrice: (optimizedKeys.has(key) && !id3OptimizedKeys.has(key) && hasIntradayData) ? ct : null,
        dischargePrice: v2gDischargeKeys.has(key) ? ct : null,
        netChargePrice: v2gNetChargeKeys.has(key) ? ct : null,
        arbChargePrice: v2gArbChargeKeys.has(key) ? ct : null,
        intradayId3Price: id3Map.get(key) ?? null,
        id3OptimizedPrice: id3OptimizedKeys.has(key) && !optimizedKeys.has(key) ? (id3Map.get(key) ?? null) : null,
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
    // Use raw priceCtKwh from windowPrices for accurate averages (no per-slot rounding)
    const baselineSlots = windowPrices.slice(0, slotsNeeded)
    const optimizedSlots = sortedByPrice.slice(0, slotsNeeded)
    const bAvg = baselineSlots.length > 0 ? baselineSlots.reduce((s, p) => s + p.priceCtKwh, 0) / baselineSlots.length : 0
    const oAvg = optimizedSlots.length > 0 ? optimizedSlots.reduce((s, p) => s + p.priceCtKwh, 0) / optimizedSlots.length : 0
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

    return { chartData: data, sessionCost: cost, v2gResult: v2g, hasIntraday: hasIntradayData, intradayUpliftCt: intradayUpliftCtVal, intradayUpliftEur: intradayUpliftEurVal, id3DaScheduleAvgCt: id3DaScheduleAvgCtVal, id3OptScheduleAvgCt: id3OptScheduleAvgCtVal }
  }, [chartPrices, date1, date2, date3, energyPerSession, scenario.plugInTime, scenario.departureTime, scenario.chargingMode, isQH, isFullDay, isThreeDay, chargePowerKw, renewableData, isV2G, batteryKwh, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.dischargePowerKw, scenario.roundTripEfficiency, scenario.degradationCtKwh, prices.intradayId3])

  // ── Fleet flex band + optimization (PROJ-36/37) ──
  const isFleetActive = showFleet && fleetView === 'fleet' && !isFullDay
  const { flexBand, fleetOptResult } = useMemo(() => {
    if (!isFleetActive || chartData.length === 0) return { flexBand: null, fleetOptResult: null }
    // Use ALL chart data slots (14:00→09:00) — fleet arrivals may start before the
    // single-EV plugInTime, and departures may extend past single-EV departureTime
    const windowPrices: HourlyPrice[] = chartData
      .map(d => ({
        timestamp: 0,
        priceEurMwh: d.priceVal * 10,
        priceCtKwh: d.priceVal,
        hour: d.hour,
        minute: d.minute,
        date: d.date,
      }))
    if (windowPrices.length === 0) return { flexBand: null, fleetOptResult: null }

    const derived = deriveFleetDistributions(fleetConfig)
    const band = computeFlexBand(derived, windowPrices, isQH)
    const totalEnergy = computeFleetEnergyKwh(derived)
    const optResult = optimizeFleetSchedule(band, windowPrices, totalEnergy, isQH)
    return { flexBand: band, fleetOptResult: optResult }
  }, [isFleetActive, chartData, fleetConfig, isQH])

  // Merge fleet band + schedule data into chartData for Recharts
  const enrichedChartData = useMemo(() => {
    if (!isFleetActive || !flexBand || !fleetOptResult) return chartData
    const bandMap = new Map<string, { greedy: number; lazy: number; optimized: number; greedySchedule: number }>()
    for (let i = 0; i < flexBand.length; i++) {
      const s = flexBand[i]
      const opt = fleetOptResult.schedule[i]
      bandMap.set(`${s.date}-${s.hour}-${s.minute}`, {
        greedy: s.greedyKw,
        lazy: s.lazyKw,
        optimized: opt?.optimizedKw ?? 0,
        greedySchedule: s.greedyScheduleKw,
      })
    }
    const maxOptKw = Math.max(...fleetOptResult.schedule.map(s => s.optimizedKw), 1)
    return chartData.map(d => {
      const key = `${d.date}-${d.hour}-${d.minute}`
      const band = bandMap.get(key)
      if (!band) return { ...d, greedyKw: null, lazyKw: null, optimizedKw: null, greedyScheduleKw: null, fleetChargePrice: null, fleetBaselinePrice: null, fleetChargeIntensity: 0 }
      return {
        ...d,
        greedyKw: band.greedy, lazyKw: band.lazy, optimizedKw: band.optimized,
        greedyScheduleKw: band.greedySchedule,
        fleetChargePrice: band.optimized > 0.1 ? d.priceVal : null,
        fleetBaselinePrice: band.greedySchedule > 0.1 ? d.priceVal : null,
        fleetChargeIntensity: band.optimized / maxOptKw,
      }
    })
  }, [chartData, isFleetActive, flexBand, fleetOptResult])

  // Fleet Y-axis max for auto-scaling
  const fleetYMax = useMemo(() => {
    if (!isFleetActive || !flexBand) return 100
    const max = Math.max(...flexBand.map(s => s.greedyKw), 1)
    return Math.ceil(max * 1.1 / 10) * 10 // round up to nearest 10, +10% headroom
  }, [isFleetActive, flexBand])

  // Auto-disable ID overlay when coverage is insufficient (e.g., mode change to 3-day without data)
  useEffect(() => {
    if (showIntraday && !hasIntraday) setShowIntraday(false)
  }, [hasIntraday, showIntraday])

  // ── 365-day rolling average — expensive scan over all hourly prices ──
  // Uses deferred plug-in/departure values so it doesn't block drag interactions
  // Mode-aware: builds appropriate windows for overnight/fullday/threeday
  const { rollingAvgSavings, monthlySavings, dailySavingsMap } = useMemo(() => {
    if (!date1 || prices.hourly.length === 0) return { rollingAvgSavings: 0, monthlySavings: 0, dailySavingsMap: new Map<string, { savingsEur: number; bAvg: number; oAvg: number; spreadCt: number; windowHours: number }>() }
    const mode = scenario.chargingMode

    const endDate = date1
    const startRoll = new Date(new Date(endDate + 'T12:00:00Z').getTime() - 365 * 86400000).toISOString().slice(0, 10)

    // Build per-date lookup for hourly data
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      if (p.date >= startRoll && p.date <= endDate) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
    }
    // Build per-date lookup for QH data (when available)
    const byDateQH = new Map<string, HourlyPrice[]>()
    if (isQH && prices.hourlyQH.length > 0) {
      for (const p of prices.hourlyQH) {
        if (p.date >= startRoll && p.date <= endDate) {
          const arr = byDateQH.get(p.date) || []
          arr.push(p)
          byDateQH.set(p.date, arr)
        }
      }
    }

    let wdSavings = 0, wdDays = 0, weSavings = 0, weDays = 0
    const perDay = new Map<string, { savingsEur: number; bAvg: number; oAvg: number; spreadCt: number; windowHours: number }>()
    for (const [dDate, dPricesH] of byDate) {
      // Use QH data for this day if available, otherwise hourly
      const dPricesQH = byDateQH.get(dDate)
      const useQH = !!dPricesQH && dPricesQH.length > 0
      const dPrices = useQH ? dPricesQH : dPricesH
      const kwhPerSlot = useQH ? chargePowerKw * 0.25 : chargePowerKw
      // Each entry in win is one slot (1 hour or 1 quarter-hour), so slotsPerHour=1
      const slotsPerHour = 1
      const minSlots = Math.ceil(energyPerSession / kwhPerSlot)

      let win: HourlyPrice[]
      if (mode === 'threeday') {
        const d2 = addDaysStr(dDate, 1), d3 = addDaysStr(dDate, 2), d4 = addDaysStr(dDate, 3)
        const p2Raw = useQH ? byDateQH.get(d2) : byDate.get(d2)
        if (!p2Raw || p2Raw.length === 0) continue
        win = [...dPrices.filter(p => p.hour >= deferredPlugInTime), ...p2Raw]
        const p3 = useQH ? byDateQH.get(d3) : byDate.get(d3)
        if (p3) win.push(...p3)
        const p4 = useQH ? byDateQH.get(d4) : byDate.get(d4)
        if (p4) win.push(...p4.filter(p => p.hour < deferredPlugInTime))
      } else {
        const nd = nextDayStr(dDate)
        const nPrices = useQH ? byDateQH.get(nd) : byDate.get(nd)
        if (!nPrices || nPrices.length === 0) continue
        const eve = dPrices.filter(p => p.hour >= deferredPlugInTime)
        const morn = nPrices.filter(p => p.hour < deferredDepartureTime)
        win = [...eve, ...morn]
      }
      if (win.length < minSlots) continue
      let savEur: number, bAvg: number, oAvg: number
      if (isV2G) {
        const v2gRes = computeV2gWindowSavings(win, batteryKwh, chargePowerKw, scenario.dischargePowerKw, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.roundTripEfficiency, scenario.degradationCtKwh, kwhPerSlot)
        savEur = v2gRes.profitEur
        bAvg = 0; oAvg = 0
      } else {
        const res = computeWindowSavings(win, energyPerSession, kwhPerSlot, slotsPerHour)
        savEur = res.savingsEur; bAvg = res.bAvg; oAvg = res.oAvg
      }
      let spreadMin = Infinity, spreadMax = -Infinity
      for (const p of win) { if (p.priceCtKwh < spreadMin) spreadMin = p.priceCtKwh; if (p.priceCtKwh > spreadMax) spreadMax = p.priceCtKwh }
      const spreadCt = spreadMax - spreadMin
      perDay.set(dDate, { savingsEur: Math.round(savEur * 100) / 100, bAvg: Math.round(bAvg * 100) / 100, oAvg: Math.round(oAvg * 100) / 100, spreadCt: Math.round(spreadCt * 100) / 100, windowHours: win.length / slotsPerHour })
      const dow = new Date(dDate + 'T12:00:00Z').getUTCDay()
      const isWeekend = dow === 0 || dow === 6
      if (isWeekend) { weSavings += savEur; weDays++ }
      else { wdSavings += savEur; wdDays++ }
    }
    const avgWdSavings = wdDays > 0 ? wdSavings / wdDays : 0
    const avgWeSavings = weDays > 0 ? weSavings / weDays : 0
    const weeklySavings = avgWdSavings * deferredWeekdayPlugIns + avgWeSavings * deferredWeekendPlugIns
    const mSav = Math.round(weeklySavings * (30.44 / 7) * 100) / 100
    const rollSav = Math.round(weeklySavings * 52 * 100) / 100
    return { rollingAvgSavings: rollSav, monthlySavings: mSav, dailySavingsMap: perDay }
  }, [prices.hourly, prices.hourlyQH, isQH, date1, energyPerSession, deferredPlugInTime, deferredDepartureTime, deferredWeekdayPlugIns, deferredWeekendPlugIns, chargePowerKw, scenario.chargingMode, isV2G, batteryKwh, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.dischargePowerKw, scenario.roundTripEfficiency, scenario.degradationCtKwh])

  // ── Per-mode rolling savings: 4 weeks + 52 weeks for overnight/fullday/threeday ──
  type ModeSavings = { ctKwh4w: number; eur4w: number; ctKwh52w: number; eur52w: number }
  const perModeSavings = useMemo((): Record<string, ModeSavings> => {
    if (!date1 || prices.hourly.length === 0) {
      const z: ModeSavings = { ctKwh4w: 0, eur4w: 0, ctKwh52w: 0, eur52w: 0 }
      return { overnight: z, fullday: z, threeday: z }
    }
    const end52 = date1
    const start52 = new Date(new Date(end52 + 'T12:00:00Z').getTime() - 365 * 86400000).toISOString().slice(0, 10)
    const start4w = new Date(new Date(end52 + 'T12:00:00Z').getTime() - 28 * 86400000).toISOString().slice(0, 10)

    // Build per-date lookup for hourly data
    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      if (p.date >= start52 && p.date <= end52) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
    }
    // Build per-date lookup for QH data (when available)
    const byDateQH = new Map<string, HourlyPrice[]>()
    if (isQH && prices.hourlyQH.length > 0) {
      for (const p of prices.hourlyQH) {
        if (p.date >= start52 && p.date <= end52) {
          const arr = byDateQH.get(p.date) || []
          arr.push(p)
          byDateQH.set(p.date, arr)
        }
      }
    }

    function calcMode(buildWindow: (dDate: string, useQH: boolean, lookup: Map<string, HourlyPrice[]>) => HourlyPrice[] | null): { wdS4w: number; wdD4w: number; weS4w: number; weD4w: number; wdS52w: number; wdD52w: number; weS52w: number; weD52w: number } {
      let wdS4w = 0, wdD4w = 0, weS4w = 0, weD4w = 0
      let wdS52w = 0, wdD52w = 0, weS52w = 0, weD52w = 0
      for (const dDate of byDate.keys()) {
        // Use QH data for this day if available, otherwise hourly
        const dPricesQH = byDateQH.get(dDate)
        const useQH = !!dPricesQH && dPricesQH.length > 0
        const lookup = useQH ? byDateQH : byDate
        const kwhSlot = useQH ? chargePowerKw * 0.25 : chargePowerKw
        const minSlots = Math.ceil(deferredEnergyPerSession / kwhSlot)
        const win = buildWindow(dDate, useQH, lookup)
        if (!win || win.length < minSlots) continue
        let savEur: number
        if (isV2G) {
          savEur = computeV2gWindowSavings(win, batteryKwh, chargePowerKw, scenario.dischargePowerKw, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.roundTripEfficiency, scenario.degradationCtKwh, kwhSlot).profitEur
        } else {
          savEur = computeWindowSavings(win, deferredEnergyPerSession, kwhSlot, 1).savingsEur
        }
        const dow = new Date(dDate + 'T12:00:00Z').getUTCDay()
        const isWe = dow === 0 || dow === 6
        if (isWe) { weS52w += savEur; weD52w++; if (dDate >= start4w) { weS4w += savEur; weD4w++ } }
        else { wdS52w += savEur; wdD52w++; if (dDate >= start4w) { wdS4w += savEur; wdD4w++ } }
      }
      return { wdS4w, wdD4w, weS4w, weD4w, wdS52w, wdD52w, weS52w, weD52w }
    }

    // Each mode: use actual departure when active, canonical when inactive
    const curMode = scenario.chargingMode
    const overnightDep = curMode === 'overnight' ? deferredDepartureTime : (deferredPlugInTime + 12) % 24
    const fullDayDep = curMode === 'fullday' ? deferredDepartureTime : deferredPlugInTime
    const threeDayDep = curMode === 'threeday' ? deferredDepartureTime : deferredPlugInTime

    const overnight = calcMode((dDate, _useQH, lookup) => {
      const nd = addDaysStr(dDate, 1)
      const nP = lookup.get(nd)
      if (!nP || nP.length === 0) return null
      const dP = lookup.get(dDate)
      if (!dP) return null
      return [...dP.filter(p => p.hour >= deferredPlugInTime), ...nP.filter(p => p.hour < overnightDep)]
    })

    const fullday = calcMode((dDate, _useQH, lookup) => {
      const nd = addDaysStr(dDate, 1)
      const nP = lookup.get(nd)
      if (!nP || nP.length === 0) return null
      const dP = lookup.get(dDate)
      if (!dP) return null
      return [...dP.filter(p => p.hour >= deferredPlugInTime), ...nP.filter(p => p.hour < fullDayDep)]
    })

    const threeday = calcMode((dDate, _useQH, lookup) => {
      const d2 = addDaysStr(dDate, 1), d3 = addDaysStr(dDate, 2), d4 = addDaysStr(dDate, 3)
      const dP = lookup.get(dDate), p2 = lookup.get(d2), p3 = lookup.get(d3)
      if (!dP || !p2) return null
      const all = [...dP.filter(p => p.hour >= deferredPlugInTime), ...p2]
      if (p3) all.push(...p3)
      const p4 = lookup.get(d4)
      if (p4) all.push(...p4.filter(p => p.hour < threeDayDep))
      return all
    })

    function toResult(r: { wdS4w: number; wdD4w: number; weS4w: number; weD4w: number; wdS52w: number; wdD52w: number; weS52w: number; weD52w: number }): ModeSavings {
      // Weekday/weekend weighted average — same method as rollingAvgSavings
      const avgWd4w = r.wdD4w > 0 ? r.wdS4w / r.wdD4w : 0
      const avgWe4w = r.weD4w > 0 ? r.weS4w / r.weD4w : 0
      const weekly4w = avgWd4w * deferredWeekdayPlugIns + avgWe4w * deferredWeekendPlugIns
      const avgWd52w = r.wdD52w > 0 ? r.wdS52w / r.wdD52w : 0
      const avgWe52w = r.weD52w > 0 ? r.weS52w / r.weD52w : 0
      const weekly52w = avgWd52w * deferredWeekdayPlugIns + avgWe52w * deferredWeekendPlugIns
      const eur4w = Math.round(weekly4w * 4 * 100) / 100
      const eur52w = Math.round(weekly52w * 52 * 100) / 100
      // ct/kWh: weighted average savings per session ÷ energy
      const avgSavPerSession4w = (r.wdD4w + r.weD4w) > 0 ? (r.wdS4w + r.weS4w) / (r.wdD4w + r.weD4w) : 0
      const avgSavPerSession52w = (r.wdD52w + r.weD52w) > 0 ? (r.wdS52w + r.weS52w) / (r.wdD52w + r.weD52w) : 0
      const ctKwh4w = deferredEnergyPerSession > 0 ? avgSavPerSession4w / deferredEnergyPerSession * 100 : 0
      const ctKwh52w = deferredEnergyPerSession > 0 ? avgSavPerSession52w / deferredEnergyPerSession * 100 : 0
      return { ctKwh4w, eur4w, ctKwh52w, eur52w }
    }

    return { overnight: toResult(overnight), fullday: toResult(fullday), threeday: toResult(threeday) }
  }, [prices.hourly, prices.hourlyQH, isQH, date1, deferredEnergyPerSession, deferredPlugInTime, deferredDepartureTime, deferredWeekdayPlugIns, deferredWeekendPlugIns, chargePowerKw, scenario.chargingMode, isV2G, batteryKwh, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.dischargePowerKw, scenario.roundTripEfficiency, scenario.degradationCtKwh])

  // ── Fleet rolling savings (PROJ-37): runs fleet optimizer per-day over 365 days ──
  const { fleetRollingSavings, fleetMonthlySavings, fleetDailySavingsMap, fleetPerModeSavings } = useMemo(() => {
    const empty = { fleetRollingSavings: 0, fleetMonthlySavings: 0, fleetDailySavingsMap: new Map<string, { savingsEur: number; bAvg: number; oAvg: number; spreadCt: number; windowHours: number }>(), fleetPerModeSavings: { ctKwh4w: 0, eur4w: 0, ctKwh52w: 0, eur52w: 0 } }
    if (!showFleet || !date1 || prices.hourly.length === 0) return empty

    const endDate = date1
    const start52 = new Date(new Date(endDate + 'T12:00:00Z').getTime() - 365 * 86400000).toISOString().slice(0, 10)
    const start4w = new Date(new Date(endDate + 'T12:00:00Z').getTime() - 28 * 86400000).toISOString().slice(0, 10)

    const byDate = new Map<string, HourlyPrice[]>()
    for (const p of prices.hourly) {
      if (p.date >= start52 && p.date <= endDate) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
    }

    const derivedRoll = deriveFleetDistributions(deferredFleetConfig)
    const totalEnergy = computeFleetEnergyKwh(derivedRoll)
    let wdS = 0, wdD = 0, weS = 0, weD = 0
    let wdS4w = 0, wdD4w = 0, weS4w = 0, weD4w = 0
    const perDay = new Map<string, { savingsEur: number; bAvg: number; oAvg: number; spreadCt: number; windowHours: number }>()

    for (const [dDate, dPrices] of byDate) {
      const nd = nextDayStr(dDate)
      const nPrices = byDate.get(nd)
      if (!nPrices || nPrices.length === 0) continue
      // Build overnight window: 14:00 → 09:00 (full chart range for fleet)
      const win = [
        ...dPrices.filter(p => p.hour >= 14),
        ...nPrices.filter(p => p.hour < 10),
      ]
      if (win.length < 4) continue

      const band = computeFlexBand(derivedRoll, win, false)
      if (band.length === 0) continue
      const opt = optimizeFleetSchedule(band, win, totalEnergy, false)
      const savEur = Math.abs(opt.savingsEur)

      let spreadMin = Infinity, spreadMax = -Infinity
      for (const p of win) { if (p.priceCtKwh < spreadMin) spreadMin = p.priceCtKwh; if (p.priceCtKwh > spreadMax) spreadMax = p.priceCtKwh }
      perDay.set(dDate, { savingsEur: Math.round(savEur * 100) / 100, bAvg: Math.round(opt.baselineAvgCtKwh * 100) / 100, oAvg: Math.round(opt.optimizedAvgCtKwh * 100) / 100, spreadCt: Math.round((spreadMax - spreadMin) * 100) / 100, windowHours: win.length })

      const dow = new Date(dDate + 'T12:00:00Z').getUTCDay()
      const isWe = dow === 0 || dow === 6
      if (isWe) { weS += savEur; weD++; if (dDate >= start4w) { weS4w += savEur; weD4w++ } }
      else { wdS += savEur; wdD++; if (dDate >= start4w) { wdS4w += savEur; wdD4w++ } }
    }

    // Fleet charges every day (7x/week), not based on single-EV plug-in frequency
    const avgDaily = (wdD + weD) > 0 ? (wdS + weS) / (wdD + weD) : 0
    const avgDaily4w = (wdD4w + weD4w) > 0 ? (wdS4w + weS4w) / (wdD4w + weD4w) : 0

    return {
      fleetRollingSavings: Math.round(avgDaily * 365 * 100) / 100,
      fleetMonthlySavings: Math.round(avgDaily * 30.44 * 100) / 100,
      fleetDailySavingsMap: perDay,
      fleetPerModeSavings: {
        ctKwh4w: totalEnergy > 0 ? Math.round(Math.abs(avgDaily4w) * 100 / totalEnergy * 100) / 100 : 0,
        eur4w: Math.round(Math.abs(avgDaily4w) * 28 * 100) / 100,
        ctKwh52w: totalEnergy > 0 ? Math.round(Math.abs(avgDaily) * 100 / totalEnergy * 100) / 100 : 0,
        eur52w: Math.round(Math.abs(avgDaily) * 365),
      },
    }
  }, [showFleet, date1, prices.hourly, deferredFleetConfig])

  // ── Active savings values (fleet or single-EV) ──
  const activeRollingSavings = showFleet ? fleetRollingSavings : rollingAvgSavings
  const activeMonthlySavings = showFleet ? fleetMonthlySavings : monthlySavings
  const activeDailySavingsMap = showFleet ? fleetDailySavingsMap : dailySavingsMap

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
    } else if (isDragging === 'fleetArrival') {
      if (point.date === date1 && point.hour >= 14 && point.hour <= 23) {
        setFleetConfig(c => ({
          ...c,
          arrivalAvg: point.hour,
          arrivalMin: Math.min(c.arrivalMin, point.hour),
          arrivalMax: Math.max(c.arrivalMax, point.hour),
        }))
      }
    } else if (isDragging === 'fleetDeparture') {
      if (point.date === date2 && point.hour >= 5 && point.hour <= 9) {
        setFleetConfig(c => ({
          ...c,
          departureAvg: point.hour,
          departureMin: Math.min(c.departureMin, point.hour),
          departureMax: Math.max(c.departureMax, point.hour),
        }))
      }
    }
  }, [isDragging, chartData, date1, date2, date4, scenario, setScenario, setFleetConfig, plotArea, isFullDay, isThreeDay])

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
  const { baselineRanges, optimizedRanges, daSoldRanges, id3BoughtRanges, dischargeRanges, netChargeRanges, arbChargeRanges } = useMemo(() => {
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
    function findRangesGeneric(key: string) {
      const ranges: { x1: number; x2: number }[] = []
      let start: number | null = null, end: number | null = null
      for (const d of chartData) {
        if ((d as Record<string, unknown>)[key] !== null) {
          if (start === null) start = d.idx
          end = d.idx
        } else if (start !== null) {
          ranges.push({ x1: Math.max(start, aIdx), x2: Math.min(end! + 1, dIdx) })
          start = null; end = null
        }
      }
      if (start !== null) ranges.push({ x1: Math.max(start, aIdx), x2: Math.min(end! + 1, dIdx) })
      return ranges
    }
    return {
      baselineRanges: findRanges('baselinePrice'),
      optimizedRanges: findRanges('optimizedPrice'),
      daSoldRanges: findRangesGeneric('daSoldPrice'),
      id3BoughtRanges: findRangesGeneric('id3OptimizedPrice'),
      dischargeRanges: findRangesGeneric('dischargePrice'),
      netChargeRanges: findRangesGeneric('netChargePrice'),
      arbChargeRanges: findRangesGeneric('arbChargePrice'),
    }
  }, [chartData, arrivalIdx, departureIdx, N])

  // ── Pre-compute overnight windows with savings + prefix sums ──
  // Single pass: builds windows, computes savings for current energyPerSession,
  // and adds prefix sums for O(1) heatmap lookups with different energy amounts.
  // Mode-aware: overnight/fullday use 2-day windows, threeday uses 4-day windows
  type EnrichedWindow = import('@/lib/charging-helpers').OvernightWindow & {
    savingsEur: number; bAvg: number; oAvg: number; spreadCt: number
    v2gProfit?: number; v2gLS?: number; v2gArb?: number
    /** Prefix sums for O(1) savings lookup: chronPrefixCt[i] = sum of first i slots' priceCtKwh */
    chronPrefixCt: number[]
    /** Prefix sums sorted ascending: sortedPrefixCt[i] = sum of cheapest i slots' priceCtKwh */
    sortedPrefixCt: number[]
  }
  const overnightWindows = useMemo((): EnrichedWindow[] => {
    if (prices.hourly.length === 0) return []
    const kwhSlot = chargePowerKw
    const minSlots = Math.ceil(deferredEnergyPerSession / kwhSlot)

    // Build raw windows (mode-dependent)
    let rawWindows: import('@/lib/charging-helpers').OvernightWindow[]
    if (scenario.chargingMode === 'threeday') {
      const byDate = new Map<string, HourlyPrice[]>()
      for (const p of prices.hourly) {
        const arr = byDate.get(p.date) || []
        arr.push(p)
        byDate.set(p.date, arr)
      }
      rawWindows = []
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
        rawWindows.push({ date: dDate, month: dDate.slice(0, 7), prices: all, sorted, isProjected: all.some(p => p.isProjected), isWeekend: dow === 0 || dow === 6 })
      }
    } else {
      rawWindows = buildOvernightWindows(prices.hourly, deferredPlugInTime, deferredDepartureTime)
    }

    // Enrich: pre-compute savings + prefix sums (one pass, no redundant work)
    return rawWindows.map(w => {
      // Prefix sums: chronological order
      const chronPrefixCt: number[] = [0]
      for (let i = 0; i < w.prices.length; i++) {
        chronPrefixCt.push(chronPrefixCt[i] + w.prices[i].priceCtKwh)
      }
      // Prefix sums: sorted ascending (w.sorted already exists)
      const sortedPrefixCt: number[] = [0]
      for (let i = 0; i < w.sorted.length; i++) {
        sortedPrefixCt.push(sortedPrefixCt[i] + w.sorted[i].priceCtKwh)
      }

      // Pre-compute savings for current energyPerSession
      let savingsEur = 0, bAvg = 0, oAvg = 0, v2gProfit: number | undefined, v2gLS: number | undefined, v2gArb: number | undefined
      if (w.prices.length >= minSlots) {
        if (isV2G) {
          const v2gR = computeV2gWindowSavings(
            w.prices, batteryKwh, chargePowerKw, scenario.dischargePowerKw,
            scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent,
            scenario.roundTripEfficiency, scenario.degradationCtKwh, kwhSlot,
          )
          savingsEur = v2gR.profitEur; v2gProfit = v2gR.profitEur
          v2gLS = v2gR.loadShiftingBenefitEur; v2gArb = v2gR.arbitrageUpliftEur
        } else {
          bAvg = minSlots > 0 ? chronPrefixCt[minSlots] / minSlots : 0
          oAvg = minSlots > 0 ? sortedPrefixCt[minSlots] / minSlots : 0
          savingsEur = (bAvg - oAvg) * deferredEnergyPerSession / 100
        }
      }

      // Spread: use loop instead of Math.max(...spread)
      let minP = Infinity, maxP = -Infinity
      for (const p of w.prices) {
        if (p.priceCtKwh < minP) minP = p.priceCtKwh
        if (p.priceCtKwh > maxP) maxP = p.priceCtKwh
      }
      const spreadCt = maxP - minP

      return {
        ...w,
        savingsEur: Math.round(savingsEur * 100) / 100,
        bAvg: Math.round(bAvg * 100) / 100,
        oAvg: Math.round(oAvg * 100) / 100,
        spreadCt: Math.round(spreadCt * 100) / 100,
        v2gProfit, v2gLS, v2gArb,
        chronPrefixCt, sortedPrefixCt,
      }
    })
  }, [prices.hourly, deferredPlugInTime, deferredDepartureTime, scenario.chargingMode, deferredEnergyPerSession, chargePowerKw, isV2G, batteryKwh, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.dischargePowerKw, scenario.roundTripEfficiency, scenario.degradationCtKwh])

  // ── Expose Excel export handler to parent ──
  useEffect(() => {
    if (!onExportReady) return
    if (overnightWindows.length === 0) { onExportReady(null); return }
    onExportReady(() => {
      generateAndDownloadExcel({ scenario, overnightWindows, country })
    })
    return () => onExportReady(null)
  }, [onExportReady, overnightWindows, scenario, country])

  // ── Monthly savings breakdown for yearly chart ──
  // Uses pre-computed savings from enriched overnightWindows (no redundant computation)
  const monthlySavingsData = useMemo(() => {
    if (overnightWindows.length === 0) return []
    const minSlots = Math.ceil(deferredEnergyPerSession / chargePowerKw)
    const weekdayScale = deferredWeekdayPlugIns / 5
    const weekendScale = deferredWeekendPlugIns / 2
    const monthMap = new Map<string, { wdSavings: number; wdDays: number; weSavings: number; weDays: number; wdLS: number; weLS: number; wdArb: number; weArb: number }>()
    for (const w of overnightWindows) {
      if (w.prices.length < minSlots) continue
      if (w.isProjected) continue  // exclude forecast data from monthly trend
      const entry = monthMap.get(w.month) || { wdSavings: 0, wdDays: 0, weSavings: 0, weDays: 0, wdLS: 0, weLS: 0, wdArb: 0, weArb: 0 }
      if (w.isWeekend) {
        entry.weSavings += w.savingsEur; entry.weDays++
        entry.weLS += w.v2gLS ?? 0; entry.weArb += w.v2gArb ?? 0
      } else {
        entry.wdSavings += w.savingsEur; entry.wdDays++
        entry.wdLS += w.v2gLS ?? 0; entry.wdArb += w.v2gArb ?? 0
      }
      monthMap.set(w.month, entry)
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const wdAvg = data.wdDays > 0 ? data.wdSavings / data.wdDays : 0
        const weAvg = data.weDays > 0 ? data.weSavings / data.weDays : 0
        const wdMonthly = wdAvg * weekdayScale * 21.74
        const weMonthly = weAvg * weekendScale * 8.70
        const monthlySav = Math.round((wdMonthly + weMonthly) * 100) / 100
        const wdLSAvg = data.wdDays > 0 ? data.wdLS / data.wdDays : 0
        const weLSAvg = data.weDays > 0 ? data.weLS / data.weDays : 0
        const wdArbAvg = data.wdDays > 0 ? data.wdArb / data.wdDays : 0
        const weArbAvg = data.weDays > 0 ? data.weArb / data.weDays : 0
        const lsMonthly = Math.round((wdLSAvg * weekdayScale * 21.74 + weLSAvg * weekendScale * 8.70) * 100) / 100
        const arbMonthly = Math.round((wdArbAvg * weekdayScale * 21.74 + weArbAvg * weekendScale * 8.70) * 100) / 100
        const [y, m] = month.split('-').map(Number)
        const label = new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'short' })
        const mNum = m
        const season: 'winter' | 'spring' | 'summer' | 'autumn' =
          mNum <= 2 || mNum === 12 ? 'winter' : mNum <= 5 ? 'spring' : mNum <= 8 ? 'summer' : 'autumn'
        return {
          month, label, savings: monthlySav, season, year: y,
          ...(isV2G ? { loadShiftingEur: lsMonthly, arbitrageEur: arbMonthly } : {}),
        }
      })
  }, [overnightWindows, deferredEnergyPerSession, deferredWeekdayPlugIns, deferredWeekendPlugIns, chargePowerKw, isV2G])

  // ── Fleet monthly savings — derived from fleetDailySavingsMap ──
  const fleetMonthlySavingsData = useMemo(() => {
    if (!showFleet || fleetDailySavingsMap.size === 0) return []
    // Fleet charges every day, so no weekday/weekend scaling — just aggregate by month
    const monthMap = new Map<string, { totalSav: number; days: number }>()
    for (const [dDate, entry] of fleetDailySavingsMap) {
      const month = dDate.slice(0, 7)
      const m = monthMap.get(month) || { totalSav: 0, days: 0 }
      m.totalSav += Math.abs(entry.savingsEur)
      m.days++
      monthMap.set(month, m)
    }
    return [...monthMap.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, data]) => {
        const avgDaily = data.days > 0 ? data.totalSav / data.days : 0
        const monthlySav = Math.round(avgDaily * 30.44 * 100) / 100
        const [y, m] = month.split('-').map(Number)
        const label = new Date(y, m - 1, 15).toLocaleDateString('en-US', { month: 'short' })
        const mNum = m
        const season: 'winter' | 'spring' | 'summer' | 'autumn' =
          mNum <= 2 || mNum === 12 ? 'winter' : mNum <= 5 ? 'spring' : mNum <= 8 ? 'summer' : 'autumn'
        return { month, label, savings: monthlySav, season, year: y }
      })
  }, [showFleet, fleetDailySavingsMap])

  // ── Fleet yearly savings — derived from fleetDailySavingsMap ──
  const fleetYearlySavingsData = useMemo((): YearlySavingsEntry[] => {
    if (!showFleet || fleetDailySavingsMap.size === 0) return []
    const yearMap = new Map<number, { totalSav: number; days: number; months: Set<string> }>()
    for (const [dDate, entry] of fleetDailySavingsMap) {
      const yr = parseInt(dDate.slice(0, 4))
      const m = yearMap.get(yr) || { totalSav: 0, days: 0, months: new Set<string>() }
      m.totalSav += Math.abs(entry.savingsEur)
      m.days++
      m.months.add(dDate.slice(0, 7))
      yearMap.set(yr, m)
    }
    return [...yearMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([year, data]) => {
        const avgDaily = data.days > 0 ? data.totalSav / data.days : 0
        const yearlySav = Math.round(avgDaily * 365 * 100) / 100
        return {
          year,
          savings: yearlySav,
          sessionsCount: data.days,
          isProjected: false,
          isPartial: data.months.size < 12,
          monthsCovered: data.months.size,
        }
      })
  }, [showFleet, fleetDailySavingsMap])

  // ── Active monthly data (fleet or single-EV) ──
  const activeMonthlySavingsData = showFleet ? fleetMonthlySavingsData : monthlySavingsData

  // ── Quarterly rollup for Outcome Box ──
  const quarterlyData = useMemo(() => {
    if (activeMonthlySavingsData.length === 0) return []
    const qMap = new Map<string, { savings: number; label: string }>()
    for (const m of activeMonthlySavingsData) {
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
  }, [activeMonthlySavingsData])

  // ── Heatmap data: savings for different mileage × plug-in combinations ──
  // Uses prefix sums from enriched windows for O(1) lookups per cell
  // Previously: 20,000+ computeWindowSavings calls (8 mileages × 7 plugins × 365 days)
  // Now: 20,000 O(1) prefix-sum lookups (no sorting, no array copies)
  const heatmapData = useMemo(() => {
    if (overnightWindows.length === 0) return []
    const allMonths = [...new Set(overnightWindows.map(w => w.month))].sort()
    const last12Months = new Set(allMonths.slice(-12))
    const windows = overnightWindows.filter(w => last12Months.has(w.month))
    const mileages = [5000, 10000, 15000, 20000, 25000, 30000, 35000, 40000]
    const plugins = [1, 2, 3, 4, 5, 6, 7]
    const grid: { mileage: number; plugIns: number; savings: number; spreadCt: number; kwhPerSession: number }[] = []
    for (const mil of mileages) {
      for (const pi of plugins) {
        const eps = deriveEnergyPerSession(mil, pi, 0)
        const slotsNeeded = Math.ceil(eps / chargePowerKw)
        let totalSav = 0, totalSpread = 0, days = 0
        for (const w of windows) {
          if (w.prices.length < slotsNeeded) continue
          if (isV2G) {
            // V2G can't use prefix sums (SoC constraints), use pre-computed value
            totalSav += w.v2gProfit ?? 0
            totalSpread += 0
          } else {
            // O(1) lookup via prefix sums — no sort, no array copy
            const bAvg = w.chronPrefixCt[slotsNeeded] / slotsNeeded
            const oAvg = w.sortedPrefixCt[slotsNeeded] / slotsNeeded
            const savEur = (bAvg - oAvg) * eps / 100
            totalSav += savEur
            totalSpread += bAvg - oAvg
          }
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
  }, [overnightWindows, chargePowerKw, isV2G])

  // ── Yearly savings data (2022-2030) ──
  // Uses pre-computed savings from enriched windows (no redundant computation)
  const yearlySavingsData = useMemo((): YearlySavingsEntry[] => {
    if (overnightWindows.length === 0) return []
    const minSlots = Math.ceil(deferredEnergyPerSession / chargePowerKw)
    const weekdayScale = deferredWeekdayPlugIns / 5
    const weekendScale = deferredWeekendPlugIns / 2

    const yearMap = new Map<number, { wdSavings: number; wdDays: number; weSavings: number; weDays: number; months: Set<string>; wdLS: number; weLS: number; wdArb: number; weArb: number }>()
    for (const w of overnightWindows) {
      if (w.prices.length < minSlots) continue
      const yr = parseInt(w.date.slice(0, 4))
      const entry = yearMap.get(yr) || { wdSavings: 0, wdDays: 0, weSavings: 0, weDays: 0, months: new Set<string>(), wdLS: 0, weLS: 0, wdArb: 0, weArb: 0 }
      if (w.isWeekend) {
        entry.weSavings += w.savingsEur; entry.weDays++
        entry.weLS += w.v2gLS ?? 0; entry.weArb += w.v2gArb ?? 0
      } else {
        entry.wdSavings += w.savingsEur; entry.wdDays++
        entry.wdLS += w.v2gLS ?? 0; entry.wdArb += w.v2gArb ?? 0
      }
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
        const wdLSAvg = data.wdDays > 0 ? data.wdLS / data.wdDays : 0
        const weLSAvg = data.weDays > 0 ? data.weLS / data.weDays : 0
        const wdArbAvg = data.wdDays > 0 ? data.wdArb / data.wdDays : 0
        const weArbAvg = data.weDays > 0 ? data.weArb / data.weDays : 0
        const lsYearly = Math.round((wdLSAvg * weekdayScale * 21.74 + weLSAvg * weekendScale * 8.70) * monthsCovered * 100) / 100
        const arbYearly = Math.round((wdArbAvg * weekdayScale * 21.74 + weArbAvg * weekendScale * 8.70) * monthsCovered * 100) / 100
        const plugDaysPerMonth = (deferredWeeklyPlugIns / 7) * 30.44
        return {
          year,
          savings: yearlySav,
          sessionsCount: Math.round(plugDaysPerMonth * monthsCovered),
          isProjected: false,
          isPartial: monthsCovered < 12,
          monthsCovered,
          ...(isV2G ? { loadShiftingEur: lsYearly, arbitrageEur: arbYearly } : {}),
        }
      })
  }, [overnightWindows, deferredEnergyPerSession, deferredWeekdayPlugIns, deferredWeekendPlugIns, deferredWeeklyPlugIns, chargePowerKw, isV2G])

  // ── Active yearly data (fleet or single-EV) ──
  const activeYearlySavingsData = showFleet ? fleetYearlySavingsData : yearlySavingsData

  const priceRange = useMemo(() => {
    if (chartData.length === 0) return { min: 0, max: 10 }
    const allPrices = chartData.map(d => d.priceVal)
    // Include ID3 prices in Y-axis range when visible
    if (showIntraday) {
      for (const d of chartData) {
        if (d.intradayId3Price !== null) allPrices.push(d.intradayId3Price)
      }
    }
    const min = Math.min(...allPrices)
    const max = Math.max(...allPrices)
    const range = max - min || 1
    // Top padding 15% — keeps curve clear of date labels overlay
    // Bottom padding 5%
    return { min: min - range * 0.05, max: max + range * 0.15 }
  }, [chartData, showIntraday])

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
          <div className="flex items-center justify-between">
            <CardTitle className="text-[11px] font-semibold tracking-widest uppercase text-gray-400">EV Charging Profile</CardTitle>
            <div className="flex items-center gap-1.5">
              {/* 1 Car / Fleet toggle */}
              <div className="flex items-center gap-0.5 bg-gray-200/60 rounded-full p-0.5">
                <button
                  onClick={() => setShowFleet(false)}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                    !showFleet ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >Single</button>
                <button
                  onClick={() => { setShowFleet(true); setFleetView('fleet') }}
                  title={isFullDay ? 'Fleet view available in overnight mode' : 'Configure fleet parameters'}
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                    showFleet ? 'bg-white text-blue-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >Fleet</button>
              </div>
              {ENABLE_V2G && !showFleet && (
              <div className="flex items-center gap-0.5 bg-gray-200/60 rounded-full p-0.5">
                <button
                  onClick={() => setScenario({ ...scenario, gridMode: 'v1g' })}
                  title="V1G: Smart charging — shift your charge to the cheapest hours"
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                    scenario.gridMode === 'v1g' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >V1G</button>
                <button
                  onClick={() => setScenario({ ...scenario, gridMode: 'v2g' })}
                  title="V2G: Bidirectional — load shifting + sell energy back at peak prices"
                  className={`text-[10px] font-bold px-2 py-0.5 rounded-full transition-colors ${
                    scenario.gridMode === 'v2g' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
                  }`}
                >V2G</button>
              </div>
              )}
            </div>
          </div>
        </CardHeader>
        <CardContent className="pt-4 pb-4">
          {/* Fleet config — replaces single-car controls */}
          {showFleet ? (
            <div>
              {isFullDay && (
                <p className="text-[10px] text-amber-600 mb-3">Fleet view available in overnight mode</p>
              )}
              <FleetConfigPanel
                config={fleetConfig}
                onChange={setFleetConfig}
              />
            </div>
          ) : (
          <div className="space-y-4">
            {/* V1G-only settings: Mileage, Weekly Plug-ins */}
            {!isV2G && (
            <>
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
            </>
            )}

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

            {/* V1G-only: Per Session + Session duration + charge power */}
            {!isV2G && (
            <>
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
            </>
            )}

            {/* V2G Settings — conditional, same visual style as V1G sliders */}
            {isV2G && (
              <div className="space-y-4">
                {/* Battery Size — continuous 10 kWh steps */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between h-8">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500">Battery</span>
                    <span className="text-2xl font-bold text-[#313131] tabular-nums">{batteryKwh}<span className="text-xs font-normal text-gray-400 ml-1">kWh</span></span>
                  </div>
                  <div>
                    <input type="range" min={20} max={120} step={10}
                      value={batteryKwh}
                      onChange={(e) => setScenario({ ...scenario, v2gBatteryKwh: Number(e.target.value) })}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>20 kWh</span>
                      <span>120 kWh</span>
                    </div>
                  </div>
                  <p className="text-[10px] text-gray-400 text-center">
                    {Math.round(batteryKwh * (scenario.v2gTargetSoc - scenario.v2gStartSoc) / 100)} kWh net charge ({scenario.v2gStartSoc}% → {scenario.v2gTargetSoc}%)
                    {scenario.v2gStartSoc >= scenario.v2gTargetSoc && <span className="text-amber-500 ml-1">· no net charge needed</span>}
                  </p>
                </div>

                {/* Start SoC */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between h-8">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500" title="Battery level when you plug in the car">Start SoC</span>
                    <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.v2gStartSoc}<span className="text-xs font-normal text-gray-400 ml-1">% · {Math.round(batteryKwh * scenario.v2gStartSoc / 100)} kWh</span></span>
                  </div>
                  <div>
                    <input type="range" min={10} max={90} step={5}
                      value={scenario.v2gStartSoc}
                      onChange={(e) => setScenario({ ...scenario, v2gStartSoc: Number(e.target.value) })}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>10%</span>
                      <span>90%</span>
                    </div>
                  </div>
                </div>

                {/* Target SoC */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between h-8">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500" title="Required battery level at departure time">Target SoC</span>
                    <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.v2gTargetSoc}<span className="text-xs font-normal text-gray-400 ml-1">% · {Math.round(batteryKwh * scenario.v2gTargetSoc / 100)} kWh</span></span>
                  </div>
                  <div>
                    <input type="range" min={50} max={100} step={5}
                      value={scenario.v2gTargetSoc}
                      onChange={(e) => setScenario({ ...scenario, v2gTargetSoc: Number(e.target.value) })}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>50%</span>
                      <span>100%</span>
                    </div>
                  </div>
                </div>

                {/* Min SoC */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between h-8">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500" title="Floor SoC — battery will never discharge below this level">Min Battery</span>
                    <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.minSocPercent}<span className="text-xs font-normal text-gray-400 ml-1">% · {Math.round(batteryKwh * scenario.minSocPercent / 100)} kWh</span></span>
                  </div>
                  <div>
                    <input type="range" min={10} max={40} step={5}
                      value={scenario.minSocPercent}
                      onChange={(e) => setScenario({ ...scenario, minSocPercent: Number(e.target.value) })}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>10%</span>
                      <span>40%</span>
                    </div>
                  </div>
                </div>

                {/* SoC context summary */}
                <div className="rounded-md bg-gray-50 border border-gray-100 px-3 py-2 text-[10px] text-gray-500 space-y-0.5">
                  {scenario.v2gStartSoc < scenario.v2gTargetSoc ? (
                    <>
                      <p><span className="font-semibold text-emerald-600">Load shifting</span>: {Math.round(batteryKwh * (scenario.v2gTargetSoc - scenario.v2gStartSoc) / 100)} kWh net charge ({scenario.v2gStartSoc}% → {scenario.v2gTargetSoc}%) shifted to cheapest slots</p>
                      <p><span className="font-semibold text-blue-600">Arbitrage</span>: additional charge/discharge cycles for profit within {scenario.minSocPercent}%–100% range</p>
                    </>
                  ) : (
                    <>
                      <p><span className="font-semibold text-amber-600">Pure arbitrage</span>: no net charge needed (Start {scenario.v2gStartSoc}% ≥ Target {scenario.v2gTargetSoc}%)</p>
                      <p>Battery cycles between {scenario.minSocPercent}% and 100% — buy low, sell high</p>
                    </>
                  )}
                </div>

                {/* Round-trip Efficiency */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between h-8">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500" title="Energy lost in each charge/discharge cycle (AC→DC→AC)">Round-trip Eff.</span>
                    <span className="text-2xl font-bold text-[#313131] tabular-nums">{Math.round(scenario.roundTripEfficiency * 100)}<span className="text-xs font-normal text-gray-400 ml-1">%</span></span>
                  </div>
                  <div>
                    <input type="range" min={80} max={95} step={1}
                      value={Math.round(scenario.roundTripEfficiency * 100)}
                      onChange={(e) => setScenario({ ...scenario, roundTripEfficiency: Number(e.target.value) / 100 })}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>80%</span>
                      <span>95%</span>
                    </div>
                  </div>
                </div>

                {/* Degradation Cost */}
                <div className="flex flex-col gap-2">
                  <div className="flex items-baseline justify-between h-8">
                    <span className="text-xs font-semibold uppercase tracking-wide text-gray-500" title="Battery wear cost per kWh discharged — accounts for reduced battery lifespan from V2G cycling">Degradation</span>
                    <span className="text-2xl font-bold text-[#313131] tabular-nums">{scenario.degradationCtKwh.toFixed(1)}<span className="text-xs font-normal text-gray-400 ml-1">ct/kWh</span></span>
                  </div>
                  <div>
                    <input type="range" min={1} max={8} step={0.5}
                      value={scenario.degradationCtKwh}
                      onChange={(e) => setScenario({ ...scenario, degradationCtKwh: Number(e.target.value) })}
                      className="w-full h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:shadow-md [&::-webkit-slider-thumb]:cursor-pointer [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-white" />
                    <div className="flex justify-between text-[10px] text-gray-400 mt-1">
                      <span>1 ct</span>
                      <span>8 ct</span>
                    </div>
                  </div>
                </div>

                {/* Charge + Discharge Power — bottom of card */}
                <div className="flex items-center justify-center gap-2 pt-2 border-t border-gray-100">
                  <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
                    {[7, 11].map(kw => (
                      <button key={kw}
                        onClick={() => setScenario({ ...scenario, chargePowerKw: kw })}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${chargePowerKw === kw ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      >{kw} kW ↑</button>
                    ))}
                  </div>
                  <div className="flex items-center gap-0.5 bg-gray-100 rounded-full p-0.5">
                    {[5, 7, 11].map(kw => (
                      <button key={kw}
                        onClick={() => setScenario({ ...scenario, dischargePowerKw: kw })}
                        className={`text-[10px] font-semibold px-2 py-0.5 rounded-full transition-colors ${scenario.dischargePowerKw === kw ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      >{kw} kW ↓</button>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>
          )}
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
                  Price Curve
                  <span className="text-xs font-normal text-gray-400 ml-2">Shift EV charging to cheapest hours</span>
                </CardTitle>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  {isThreeDay
                    ? `${fmtDateShort(date1)} ${arrivalLabel} → ${fmtDateShort(date4)} 24:00`
                    : isFullDay
                      ? `${fmtDateShort(date1)} ${arrivalLabel} → ${fmtDateShort(date2)} 24:00`
                      : `${fmtDateShort(date1)} evening → ${fmtDateShort(date2)} morning`}
                  <span className="text-gray-300 ml-2">·</span>
                  <span className="text-gray-400 ml-1">ct/kWh</span>
                  <span className="text-gray-300 ml-2">·</span>
                  <TooltipProvider delayDuration={100}>
                    <UITooltip>
                      <TooltipTrigger asChild>
                        <span className="text-gray-400 ml-1 cursor-help">
                          <svg className="inline -mt-px mr-0.5" width="16" height="2" viewBox="0 0 16 2"><line x1="0" y1="1" x2="16" y2="1" stroke="#6B7280" strokeWidth="1.5"/></svg>
                          <span className="text-[10px]">DA</span>
                        </span>
                      </TooltipTrigger>
                      <TooltipContent side="bottom" className="max-w-[220px] text-left p-3">
                        <p className="text-[11px] text-gray-500 leading-relaxed">
                          Day-Ahead · EPEX SPOT SE auction, published daily ~12:15 CET via{' '}
                          {country === 'DE' ? (
                            date1 && (isThreeDay ? date4 : date2) ? (
                              <a href={`https://www.smard.de/home/marktdaten?marketDataAttributes=${encodeURIComponent(JSON.stringify({resolution:"hour",from:new Date(date1+'T00:00:00').getTime(),to:new Date((isThreeDay?date4:date2)+'T23:59:59').getTime(),moduleIds:[8004169],selectedCategory:null,activeChart:true,style:"color",categoriesModuleOrder:{},region:"DE"}))}`} target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">SMARD.de</a>
                            ) : 'SMARD.de'
                          ) : (
                            <a href="https://transparency.entsoe.eu/" target="_blank" rel="noopener noreferrer" className="underline hover:text-gray-700">ENTSO-E</a>
                          )}
                        </p>
                      </TooltipContent>
                    </UITooltip>
                  </TooltipProvider>
                  {showIntraday && hasIntraday && (
                    <>
                      <span className="text-gray-300 ml-1">·</span>
                      <TooltipProvider delayDuration={100}>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className="text-gray-400 ml-1 cursor-help">
                              <svg className="inline -mt-px mr-0.5" width="16" height="2" viewBox="0 0 16 2"><line x1="0" y1="1" x2="16" y2="1" stroke="#374151" strokeWidth="1.5" strokeDasharray="4 2"/></svg>
                              <span className="text-[10px]">ID</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[260px] text-left p-3">
                            <p className="text-[11px] text-gray-500 leading-relaxed">
                              Intraday ID3 index · volume-weighted avg of the last 3h of continuous trading before delivery (EPEX SPOT)
                            </p>
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </>
                  )}
                  {hasForecastData && (
                    <>
                      <span className="text-gray-300 ml-1">·</span>
                      <TooltipProvider delayDuration={100}>
                        <UITooltip>
                          <TooltipTrigger asChild>
                            <span className="text-gray-400 ml-1 cursor-help">
                              <svg className="inline -mt-px mr-0.5" width="16" height="2" viewBox="0 0 16 2"><line x1="0" y1="1" x2="16" y2="1" stroke="#D97706" strokeWidth="1.5" strokeDasharray="3 2"/></svg>
                              <span className="text-[10px] text-amber-600">Forecast</span>
                            </span>
                          </TooltipTrigger>
                          <TooltipContent side="bottom" className="max-w-[260px] text-left space-y-1.5 p-3">
                            <p className="font-semibold text-[12px]">Forecast prices</p>
                            <p className="text-[11px] text-gray-500 leading-relaxed">
                              The dashed amber portion uses predicted prices from EnergyForecast.de,
                              not yet published EPEX Spot auction results. Actual prices may differ.
                            </p>
                          </TooltipContent>
                        </UITooltip>
                      </TooltipProvider>
                    </>
                  )}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {/* Data source toggle: DA / DA+ID */}
                {hasIntraday && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                    <button
                      onClick={() => setShowIntraday(false)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${!showIntraday ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                      DA
                    </button>
                    <button
                      onClick={() => setShowIntraday(true)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${showIntraday ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                      DA+ID
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                  <button
                    onClick={() => setCountry?.('DE')}
                    title="Germany (DE-LU bidding zone)"
                    className={`text-[11px] font-semibold px-2 py-1 rounded-full transition-colors flex items-center gap-1 ${country === 'DE' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    <svg width="14" height="10" viewBox="0 0 14 10" className="rounded-[1px]"><rect width="14" height="3.33" fill="#000"/><rect y="3.33" width="14" height="3.34" fill="#D00"/><rect y="6.67" width="14" height="3.33" fill="#FC0"/></svg>
                    DE
                  </button>
                  <button
                    onClick={() => { if (!prices.loading) setCountry?.('NL') }}
                    disabled={prices.loading && country !== 'NL'}
                    title={prices.loading && country !== 'NL' ? 'Loading...' : 'Netherlands (NL bidding zone) — ENTSO-E'}
                    className={`text-[11px] font-semibold px-2 py-1 rounded-full transition-colors flex items-center gap-1 ${country === 'NL' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'} disabled:opacity-30 disabled:cursor-not-allowed`}>
                    <svg width="14" height="10" viewBox="0 0 14 10" className="rounded-[1px]"><rect width="14" height="3.33" fill="#AE1C28"/><rect y="3.33" width="14" height="3.34" fill="#FFF"/><rect y="6.67" width="14" height="3.33" fill="#21468B"/></svg>
                    NL
                  </button>
                </div>
                {/* Mode toggle */}
                <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                  <button onClick={() => {
                    // Overnight default: plugIn 18:00, departure next day 06:00 (12h window)
                    const newPlugIn = Math.max(PLUGIN_HOUR_MIN, Math.min(PLUGIN_HOUR_MAX, scenario.plugInTime))
                    const depDefault = (newPlugIn + 12) % 24 // 18→6, 20→8, 22→10
                    setScenario({ ...scenario, chargingMode: 'overnight', plugInTime: newPlugIn, departureTime: depDefault })
                  }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${!isFullDay ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    12h
                  </button>
                  <button onClick={() => {
                    // Full day default: departure = same hour next day (24h window)
                    setScenario({ ...scenario, chargingMode: 'fullday', departureTime: scenario.plugInTime })
                  }}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${scenario.chargingMode === 'fullday' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
                    24h
                  </button>
                  <button onClick={() => {
                    if (!hasDate3Data) return
                    // 3 days default: departure = same hour 3 days later (72h window)
                    setScenario({ ...scenario, chargingMode: 'threeday', departureTime: scenario.plugInTime })
                  }}
                    disabled={!hasDate3Data}
                    title={!hasDate3Data ? 'No price data available for day 3' : '72h optimization window'}
                    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${scenario.chargingMode === 'threeday' ? 'bg-white text-[#313131] shadow-sm' : !hasDate3Data ? 'text-gray-300 cursor-not-allowed' : 'text-gray-400 hover:text-gray-600'}`}>
                    72h
                  </button>
                </div>
                <div className="flex items-center gap-1.5">
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
                {/* Forecast pill removed — forecast is auto-shown and labeled in the legend below */}
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
                {/* Renewable overlay toggle (DE only — SMARD generation data) */}
                {country === 'DE' && (
                  <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
                    <button
                      onClick={() => setShowRenewable(v => !v)}
                      className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${showRenewable ? 'bg-white text-emerald-700 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                      title="Toggle renewable generation overlay (solar + wind)"
                    >
                      {'\u2600\uFE0E'} Renew.
                    </button>
                  </div>
                )}
                {/* Fleet toggle is in Customer Profile sidebar — no chart toolbar pill */}
              </div>
            </div>
          </div>
          </CardHeader>
          <CardContent className="pb-1">
            {/* ── Chart container ── */}
            <div className="relative h-[400px] select-none outline-none"
              ref={chartRef}
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'ArrowLeft') { e.preventDefault(); const idx = sortedDatesRef.current.indexOf(selectedDateRef.current); const prev = sortedDatesRef.current[idx - 1]; if (prev) prices.setSelectedDate(prev) }
                if (e.key === 'ArrowRight') { e.preventDefault(); const idx = sortedDatesRef.current.indexOf(selectedDateRef.current); const next = sortedDatesRef.current[idx + 1]; if (next) prices.setSelectedDate(next) }
              }}
              onMouseMove={isDragging ? handleDrag : undefined}
              onTouchMove={isDragging ? handleDrag : undefined}
              style={{ cursor: isDragging ? 'ew-resize' : undefined }}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={enrichedChartData} margin={CHART_MARGIN}>
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
                    <linearGradient id="fleetBandGrad" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#FDBA74" stopOpacity={0.18} />
                      <stop offset="100%" stopColor="#FED7AA" stopOpacity={0.06} />
                    </linearGradient>
                  </defs>

                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />

                  <XAxis dataKey="idx" type="number" domain={[0, Math.max(enrichedChartData.length - 1, 1)]}
                    ticks={xTicks} tick={renderXTick as never} tickLine={false}
                    stroke="#9CA3AF" interval={0} height={midnightIdxSet.size > 0 ? 48 : 32}
                    allowDecimals={false} />
                  <YAxis yAxisId="left" tick={{ fontSize: 11, fontWeight: 500 }} stroke="#9CA3AF" width={35}
                    domain={[priceRange.min, priceRange.max]} allowDataOverflow allowDecimals={false} />
                  {showRenewable && (
                    <YAxis yAxisId="right" orientation="right" domain={[0, 100]} hide />
                  )}
                  {isFleetActive && (
                    <YAxis yAxisId="fleet" orientation="right" domain={[0, fleetYMax]}
                      tick={{ fontSize: 10, fill: '#93C5FD' }} stroke="#93C5FD" width={40}
                      tickFormatter={(v: number) => v >= 1000 ? `${(v / 1000).toFixed(1)}MW` : `${v}kW`}
                    />
                  )}

                  {/* Custom tooltip — shows price + role of each slot */}
                  <Tooltip isAnimationActive={!isDragging}
                    content={({ active, payload, label }) => {
                      if (!active || !payload?.length) return null
                      const d = enrichedChartData[Number(label)]
                      if (!d) return null
                      return (
                        <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[13px] max-w-[260px]">
                          <p className="text-gray-500 text-xs mb-1">{fmtDateShort(d.date)} {d.label}</p>
                          <p className="font-semibold tabular-nums">{d.priceVal.toFixed(2)} ct/kWh <span className="text-gray-400 font-normal">DA</span>{d.isProjected && <span className="text-amber-600 text-[10px] font-normal ml-1">forecast</span>}</p>
                          {showIntraday && d.intradayId3Price !== null && (
                            <p className="text-sky-600 text-[12px] tabular-nums">{d.intradayId3Price.toFixed(2)} ct/kWh <span className="font-normal">ID3</span>
                              {d.id3OptimizedPrice !== null && <span className="text-sky-500 text-[10px] font-bold ml-1">← new slot</span>}
                              {d.daSoldPrice !== null && <span className="text-red-400 text-[10px] font-bold ml-1">→ sold</span>}
                            </p>
                          )}
                          {d.baselinePrice !== null && (
                            <p className="text-red-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-2 bg-red-500 rounded-full inline-block flex-shrink-0" style={isV2G ? { opacity: 0.4 } : undefined} />
                              {isV2G ? 'Baseline — unmanaged charge at plug-in time' : 'Charge now — starts immediately at plug-in'}
                            </p>
                          )}
                          {d.netChargePrice !== null && (
                            <p className="text-emerald-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-2 bg-emerald-500 rounded-full inline-block flex-shrink-0" />
                              Load shifting — net charge moved to cheapest slot
                            </p>
                          )}
                          {d.arbChargePrice !== null && (
                            <p className="text-blue-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-2 bg-blue-500 rounded-full inline-block flex-shrink-0" />
                              Arb recharge — buy low to sell back later
                            </p>
                          )}
                          {!isV2G && d.optimizedPrice !== null && (
                            <p className="text-blue-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-2 bg-blue-500 rounded-full inline-block flex-shrink-0" />
                              Smart charging — cheapest available slot
                            </p>
                          )}
                          {isV2G && d.dischargePrice !== null && (
                            <p className="text-amber-600 text-xs mt-1 flex items-center gap-1">
                              <span className="w-2 h-2 bg-amber-500 rounded-full inline-block flex-shrink-0" />
                              Sell high — discharge at peak price
                            </p>
                          )}
                          {showRenewable && d.renewableShare != null && (
                            <p className="text-emerald-500/70 text-xs mt-1">{d.renewableShare.toFixed(1)}% renewable</p>
                          )}
                          {isFleetActive && d.greedyKw != null && (
                            <div className="border-t border-gray-100 mt-1.5 pt-1.5">
                              <p className="text-blue-600 text-xs tabular-nums">
                                Fleet: <span className="font-semibold">{d.optimizedKw?.toFixed(0) ?? 0} kW</span>
                                <span className="text-gray-400 ml-1">({d.lazyKw?.toFixed(0)}–{d.greedyKw?.toFixed(0)} kW)</span>
                              </p>
                              <p className="text-[10px] text-gray-400">
                                {d.optimizedKw != null && d.lazyKw != null && d.greedyKw != null
                                  ? d.optimizedKw <= d.lazyKw + 0.1 ? (d.lazyKw === 0 ? 'Idle' : 'Mandatory')
                                    : d.optimizedKw >= d.greedyKw - 0.1 ? 'Max charge'
                                    : 'Flexible'
                                  : ''}
                              </p>
                            </div>
                          )}
                        </div>
                      )
                    }} />

                  {/* ── Overnight spread corridor — hidden in fleet mode ── */}
                  {!isFleetActive && (() => {
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

                  {/* Charging hour bands — hidden in fleet mode (fleet uses flex band fills instead) */}
                  {!isFleetActive && (
                    <>
                      {/* Baseline bands — red */}
                      {(!isV2G || v2gHasNetCharge) && baselineRanges.map((r, i) => (
                        <ReferenceArea key={`b-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#EF4444" fillOpacity={isV2G ? 0.05 : 0.08} ifOverflow="hidden" />
                      ))}
                      {/* V2G: separate load shifting (green) and arbitrage charge (blue) bands */}
                      {isV2G ? (
                        <>
                          {netChargeRanges.map((r, i) => (
                            <ReferenceArea key={`nc-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#10B981" fillOpacity={0.10} ifOverflow="hidden" />
                          ))}
                          {arbChargeRanges.map((r, i) => (
                            <ReferenceArea key={`ac-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#3B82F6" fillOpacity={0.08} ifOverflow="hidden" />
                          ))}
                        </>
                      ) : (
                        optimizedRanges.map((r, i) => (
                          <ReferenceArea key={`o-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#3B82F6" fillOpacity={0.08} ifOverflow="hidden" />
                        ))
                      )}
                      {/* DA sold position bands */}
                      {showIntraday && hasIntraday && daSoldRanges.map((r, i) => (
                        <ReferenceArea key={`sold-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#EF4444" fillOpacity={0.08} ifOverflow="hidden" />
                      ))}
                      {/* ID3 bought position bands */}
                      {showIntraday && hasIntraday && id3BoughtRanges.map((r, i) => (
                        <ReferenceArea key={`id3b-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#0EA5E9" fillOpacity={0.10} ifOverflow="hidden" />
                      ))}
                      {/* V2G discharge bands */}
                      {dischargeRanges.map((r, i) => (
                        <ReferenceArea key={`d-${i}`} x1={r.x1} x2={r.x2} yAxisId="left" fill="#F59E0B" fillOpacity={0.10} ifOverflow="hidden" />
                      ))}
                    </>
                  )}

                  {/* Fleet flex band overlay (PROJ-36) — rendered behind price curve */}
                  {isFleetActive && (
                    <>
                      {/* 1. Band envelope (very light orange) — full flexibility range */}
                      <Area type="stepAfter" dataKey="greedyKw" yAxisId="fleet"
                        fill="url(#fleetBandGrad)" stroke="none"
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      {/* 2. Greedy baseline (red fill) — actual ASAP charging schedule */}
                      <Area type="stepAfter" dataKey="greedyScheduleKw" yAxisId="fleet"
                        fill="#EF4444" fillOpacity={0.18} stroke="none"
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      {/* 3. Optimized schedule (blue fill) — price-optimal charging */}
                      <Area type="stepAfter" dataKey="optimizedKw" yAxisId="fleet"
                        fill="#3B82F6" fillOpacity={0.22} stroke="none"
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      {/* 4. White cutout below lazy bound */}
                      <Area type="stepAfter" dataKey="lazyKw" yAxisId="fleet"
                        fill="#FFFFFF" stroke="none"
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      {/* Band boundary lines (light orange) */}
                      <Line type="stepAfter" dataKey="greedyKw" yAxisId="fleet"
                        stroke="#FDBA74" strokeWidth={1} strokeOpacity={0.5}
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      <Line type="stepAfter" dataKey="lazyKw" yAxisId="fleet"
                        stroke="#FDBA74" strokeWidth={1} strokeOpacity={0.5}
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      {/* Greedy baseline line (red dashed) */}
                      <Line type="stepAfter" dataKey="greedyScheduleKw" yAxisId="fleet"
                        stroke="#EF4444" strokeWidth={1.5} strokeOpacity={0.6} strokeDasharray="4 3"
                        connectNulls={false} dot={false} isAnimationActive={false} />
                      {/* Optimized schedule line (blue solid) */}
                      <Line type="stepAfter" dataKey="optimizedKw" yAxisId="fleet"
                        stroke="#3B82F6" strokeWidth={2} strokeOpacity={0.7}
                        connectNulls={false} dot={false} isAnimationActive={false} />
                    </>
                  )}

                  {/* Renewable generation share — very subtle background area */}
                  {showRenewable && (
                    <Area type="monotone" dataKey="renewableShare" yAxisId="right"
                      fill="url(#renewGrad)" stroke="#22C55E" strokeWidth={0.5} strokeOpacity={0.25}
                      connectNulls dot={false} isAnimationActive={!isDragging} />
                  )}

                  {/* Base price curve — subtle gray (faded when ID3 overlay active) */}
                  <Area type="monotone" dataKey="price" yAxisId="left" fill="url(#priceGrad)" stroke="none"
                    fillOpacity={showIntraday && hasIntraday ? 0.3 : 1} isAnimationActive={!isDragging} />
                  <Line type="monotone" dataKey="price" yAxisId="left" stroke="#94A3B8" strokeWidth={1.5}
                    strokeOpacity={showIntraday && hasIntraday ? 0.35 : 1}
                    dot={isQH ? { r: 1.5, fill: '#94A3B8', stroke: 'none', fillOpacity: showIntraday && hasIntraday ? 0.3 : 1 } : false}
                    activeDot={isQH ? { r: 4, fill: '#94A3B8', stroke: '#fff', strokeWidth: 2 } : undefined}
                    connectNulls isAnimationActive={!isDragging} />
                  {/* Forecast price — dashed amber line + matching area fill */}
                  {hasForecastData && (
                    <>
                      <Area type="monotone" dataKey="priceForecast" yAxisId="left" fill="url(#forecastGrad)" stroke="none" connectNulls={false} isAnimationActive={!isDragging} />
                      <Line type="monotone" dataKey="priceForecast" yAxisId="left" stroke="#D97706" strokeWidth={1.5}
                        strokeDasharray="6 3"
                        dot={isQH ? { r: 1.5, fill: '#D97706', stroke: 'none' } : false}
                        connectNulls={false} isAnimationActive={!isDragging} />
                    </>
                  )}

                  {/* Baseline + optimized dots — hidden when fleet view is active */}
                  {!isFleetActive && (
                    <>
                      {/* Baseline dots — red (V1G: prominent, V2G: subtle reference, hidden if pure arbitrage) */}
                      {(!isV2G || v2gHasNetCharge) && (
                        <Line type="monotone" dataKey="baselinePrice" yAxisId="left" stroke="#EF4444" strokeWidth={isV2G ? 1 : (isQH ? 2 : 3)}
                          strokeOpacity={isV2G ? 0.4 : 1}
                          dot={isV2G
                            ? { r: isQH ? 1.5 : 2.5, fill: '#EF4444', fillOpacity: 0.4, stroke: '#fff', strokeWidth: 1 }
                            : (isQH ? { r: 2, fill: '#EF4444', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#EF4444', stroke: '#fff', strokeWidth: 1.5 })}
                          connectNulls={false} isAnimationActive={!isDragging} />
                      )}

                      {/* V2G: separate net charge (green) and arb charge (blue) dots */}
                      {isV2G ? (
                        <>
                          <Line type="monotone" dataKey="netChargePrice" yAxisId="left" stroke="#10B981" strokeWidth={isQH ? 2 : 3}
                            dot={isQH ? { r: 2, fill: '#10B981', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#10B981', stroke: '#fff', strokeWidth: 1.5 }}
                            connectNulls={false} isAnimationActive={!isDragging} />
                          <Line type="monotone" dataKey="arbChargePrice" yAxisId="left" stroke="#3B82F6" strokeWidth={isQH ? 2 : 3}
                            dot={isQH ? { r: 2, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1.5 }}
                            connectNulls={false} isAnimationActive={!isDragging} />
                        </>
                      ) : (
                        <Line type="monotone" dataKey="optimizedPrice" yAxisId="left" stroke="#3B82F6" strokeWidth={isQH ? 2 : 3}
                          connectNulls={false} isAnimationActive={!isDragging}
                          dot={isQH
                            ? { r: 2, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1 }
                            : { r: 3.5, fill: '#3B82F6', stroke: '#fff', strokeWidth: 1.5 }} />
                      )}
                    </>
                  )}
                  {/* Fleet price curve overlay — dots on price line where fleet charges */}
                  {isFleetActive && (
                    <>
                      {/* Baseline (greedy) dots on price — red, visible */}
                      <Line type="monotone" dataKey="fleetBaselinePrice" yAxisId="left"
                        stroke="#EF4444" strokeWidth={isQH ? 2 : 3} strokeOpacity={0.7}
                        dot={isQH
                          ? { r: 2, fill: '#EF4444', stroke: '#fff', strokeWidth: 1 }
                          : { r: 3.5, fill: '#EF4444', stroke: '#fff', strokeWidth: 1.5 }}
                        connectNulls={false} isAnimationActive={false} />
                      {/* Optimized dots on price — blue, prominent, size = charge intensity */}
                      <Line type="monotone" dataKey="fleetChargePrice" yAxisId="left"
                        stroke="#3B82F6" strokeWidth={isQH ? 2 : 3}
                        dot={(props: { cx?: number; cy?: number; payload?: Record<string, unknown>; index?: number }) => {
                          const { cx, cy, payload } = props
                          if (cx == null || cy == null || !payload) return <circle key={props.index} r={0} />
                          const intensity = (payload.fleetChargeIntensity as number) ?? 0
                          const r = isQH ? 1.5 + intensity * 2 : 2.5 + intensity * 3
                          return <circle key={props.index} cx={cx} cy={cy} r={r} fill="#3B82F6" stroke="#fff" strokeWidth={1} />
                        }}
                        connectNulls={false} isAnimationActive={false} />
                    </>
                  )}
                  {/* DA sold positions — faded blue dots with red outline (positions being exited) */}
                  {showIntraday && hasIntraday && (
                    <Line type="monotone" dataKey="daSoldPrice" yAxisId="left" stroke="none" strokeWidth={0}
                      dot={isQH
                        ? { r: 2.5, fill: '#3B82F6', stroke: '#EF4444', strokeWidth: 1.5, fillOpacity: 0.25 }
                        : { r: 4, fill: '#3B82F6', stroke: '#EF4444', strokeWidth: 2, fillOpacity: 0.25 }}
                      connectNulls={false} isAnimationActive={!isDragging} />
                  )}

                  {/* V2G discharge dots — amber */}
                  {isV2G && (
                    <Line type="monotone" dataKey="dischargePrice" yAxisId="left" stroke="#F59E0B" strokeWidth={isQH ? 2 : 3}
                      dot={isQH ? { r: 2, fill: '#F59E0B', stroke: '#fff', strokeWidth: 1 } : { r: 3.5, fill: '#F59E0B', stroke: '#fff', strokeWidth: 1.5 }}
                      connectNulls={false} isAnimationActive={!isDragging} />
                  )}

                  {/* Intraday ID3 price line — dark gray dashed */}
                  {showIntraday && chartData.some(d => d.intradayId3Price !== null) && (
                    <>
                      <Line type="monotone" dataKey="intradayId3Price" yAxisId="left"
                        stroke="#374151" strokeWidth={1.5} strokeDasharray="5 3"
                        dot={false} connectNulls={true} name="ID3 Intraday" isAnimationActive={!isDragging} />
                      {/* ID3 re-optimized slots — prominent sky dots (new positions bought) */}
                      <Line type="monotone" dataKey="id3OptimizedPrice" yAxisId="left" stroke="#0EA5E9" strokeWidth={0}
                        dot={isQH ? { r: 3, fill: '#0EA5E9', stroke: '#fff', strokeWidth: 1.5 } : { r: 4.5, fill: '#0EA5E9', stroke: '#fff', strokeWidth: 2 }}
                        connectNulls={false} isAnimationActive={!isDragging} />
                    </>
                  )}

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

              {/* ── Grey overlays OUTSIDE charging window (hidden in fleet mode) ── */}
              {N > 1 && plotArea && !isFleetActive && (() => {
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

              {/* ── Floating cost labels with type tag (hidden in fleet mode) ── */}
              {sessionCost && N > 1 && plotArea && !isFleetActive && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const bCenter = baselineRanges.length > 0
                  ? baselineRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / baselineRanges.length
                  : idxToPx(sessionCost.baselineMidIdx)
                const oCenter = optimizedRanges.length > 0
                  ? optimizedRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / optimizedRanges.length
                  : idxToPx(sessionCost.optimizedMidIdx)
                const bY = priceToY(sessionCost.baselineAvgCt)
                const oY = priceToY(sessionCost.optimizedAvgCt)
                const chartTop = plotArea.top
                const chartBottom = plotArea.top + plotArea.height
                const PILL_H = 36  // label pill height
                const GAP = 6     // minimum gap between labels

                // Compute savings using same method as the cards (computeWindowSavings)
                const pillUseQH = isQH && prices.hourlyQH.length > 0
                const pillPrices = pillUseQH ? prices.hourlyQH : prices.hourly
                const pillKwhPerSlot = pillUseQH ? chargePowerKw * 0.25 : chargePowerKw
                const depDatePill = isThreeDay ? date4 : date2
                const pillWindow = buildMultiDayWindow(pillPrices, date1, depDatePill, scenario.plugInTime, scenario.departureTime)
                const pillSavings = computeWindowSavings(pillWindow, energyPerSession, pillKwhPerSlot, 1)
                const savingsCt = Math.round((pillSavings.bAvg - pillSavings.oAvg) * 100) / 100
                const savingsEur = Math.round(pillSavings.savingsEur * 100) / 100
                // V2G: compute pill-level V2G result for the savings display
                const pillV2g = isV2G ? computeV2gWindowSavings(
                  pillWindow, batteryKwh, chargePowerKw, scenario.dischargePowerKw,
                  scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent,
                  scenario.roundTripEfficiency, scenario.degradationCtKwh, pillKwhPerSlot,
                ) : null
                const totalSavingsCt = isV2G && pillV2g ? pillV2g.profitCtKwh : savingsCt
                const totalSavingsEur = isV2G && pillV2g ? Math.round(pillV2g.profitEur * 100) / 100 : savingsEur
                // V2G: compute centers for net charge and arb charge labels
                const ncCenter = netChargeRanges.length > 0
                  ? netChargeRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / netChargeRanges.length
                  : oCenter
                const acCenter = arbChargeRanges.length > 0
                  ? arbChargeRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / arbChargeRanges.length
                  : null
                // V2G discharge label center
                const dCenter = dischargeRanges.length > 0
                  ? dischargeRanges.reduce((s, r) => s + (idxToPx(r.x1) + idxToPx(r.x2)) / 2, 0) / dischargeRanges.length
                  : null

                // V2G arb charge avg price
                const acAvgCt = pillV2g && pillV2g.arbChargeKeys.size > 0
                  ? [...pillV2g.arbChargeKeys].reduce((s, k) => {
                      const pt = chartData.find(d => `${d.date}-${d.hour}-${d.minute}` === k)
                      return s + (pt?.priceVal ?? 0)
                    }, 0) / pillV2g.arbChargeKeys.size
                  : 0

                // ── Collision-free label positioning ──
                // Collect all active labels with ideal Y and X center
                type LabelSlot = { id: string; x: number; idealY: number; y: number }
                const labels: LabelSlot[] = []

                if (isV2G && pillV2g) {
                  // V2G labels
                  if (v2gHasNetCharge) {
                    labels.push({ id: 'baseline', x: bCenter, idealY: bY + 16, y: 0 })
                    if (pillV2g.netChargeKeys.size > 0) {
                      labels.push({ id: 'netCharge', x: ncCenter, idealY: oY - PILL_H - 8, y: 0 })
                    }
                  }
                  if (acCenter && pillV2g.arbChargeKeys.size > 0) {
                    labels.push({ id: 'arbCharge', x: acCenter, idealY: priceToY(acAvgCt) - PILL_H - 8, y: 0 })
                  }
                  if (dCenter && pillV2g.dischargeSlots.length > 0) {
                    labels.push({ id: 'discharge', x: dCenter, idealY: priceToY(pillV2g.dischargeAvgCt) + 16, y: 0 })
                  }
                } else {
                  // V1G labels
                  labels.push({ id: 'baseline', x: bCenter, idealY: bY + 16, y: 0 })
                  labels.push({ id: 'netCharge', x: oCenter, idealY: oY - PILL_H - 8, y: 0 })
                }

                // Clamp ideal Y to chart bounds
                for (const l of labels) {
                  l.y = Math.max(chartTop + 22, Math.min(chartBottom - PILL_H - 4, l.idealY))
                }

                // Resolve overlaps: for labels whose X centers are within 100px, ensure no vertical overlap
                // Sort by Y, then push overlapping ones apart
                const X_OVERLAP_THRESHOLD = 100
                for (let pass = 0; pass < 4; pass++) {
                  labels.sort((a, b) => a.y - b.y)
                  for (let i = 0; i < labels.length - 1; i++) {
                    for (let j = i + 1; j < labels.length; j++) {
                      if (Math.abs(labels[i].x - labels[j].x) > X_OVERLAP_THRESHOLD) continue
                      const overlap = (labels[i].y + PILL_H + GAP) - labels[j].y
                      if (overlap > 0) {
                        // Push them apart symmetrically
                        const shift = overlap / 2
                        labels[i].y -= shift
                        labels[j].y += shift
                        // Re-clamp
                        labels[i].y = Math.max(chartTop + 22, labels[i].y)
                        labels[j].y = Math.min(chartBottom - PILL_H - 4, labels[j].y)
                      }
                    }
                  }
                }

                // Extract resolved positions
                const pos = (id: string) => labels.find(l => l.id === id)?.y ?? 0
                const bYAdj = pos('baseline')
                const oYAdj = pos('netCharge')
                const acYAdj = pos('arbCharge')
                const dYAdj = pos('discharge')
                return (
                  <>
                    {/* Single-EV pill labels — hidden when fleet view active */}
                    {!isFleetActive && <>
                    {/* Baseline (Charge now) — shown when there's net charge to shift */}
                    {(!isV2G || v2gHasNetCharge) && (
                    <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                      style={{ left: bCenter, top: bYAdj, transform: 'translateX(-50%)', opacity: isV2G ? 0.55 : 1 }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[8px] font-bold text-red-500 uppercase tracking-wider">{isV2G ? 'Baseline' : 'Charge now'}</span>
                        <div className="bg-red-50/40 backdrop-blur-[2px] border border-red-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                          <span className="text-red-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                            {pillSavings.bAvg.toFixed(1)} ct/kWh
                          </span>
                          <span className="text-red-400 text-[9px] tabular-nums whitespace-nowrap">
                            {(pillSavings.bAvg * energyPerSession / 100).toFixed(2)} €
                          </span>
                        </div>
                      </div>
                    </div>
                    )}
                    {/* V2G: separate load shifting (green) and arb charge (blue) labels */}
                    {isV2G && pillV2g ? (
                      <>
                        {/* Load shifting charge — green (only when net charge exists) */}
                        {v2gHasNetCharge && pillV2g.netChargeKeys.size > 0 && (
                        <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                          style={{ left: ncCenter, top: oYAdj, transform: 'translateX(-50%)' }}>
                          <div className="flex flex-col items-center gap-0.5">
                            <span className="text-[8px] font-bold text-emerald-500 uppercase tracking-wider">Load Shifting</span>
                            <div className="bg-emerald-50/40 backdrop-blur-[2px] border border-emerald-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                              <span className="w-1.5 h-1.5 bg-emerald-500 rounded-full flex-shrink-0" />
                              <span className="text-emerald-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                                {pillV2g.optimizedChargeCostEur > 0 ? (pillV2g.optimizedChargeCostEur * 100 / (pillV2g.totalChargedKwh - pillV2g.totalDischargedKwh || 1)).toFixed(1) : pillSavings.oAvg.toFixed(1)} ct/kWh
                              </span>
                              <span className="text-emerald-400 text-[9px] tabular-nums whitespace-nowrap">
                                {pillV2g.loadShiftingBenefitEur.toFixed(2)} € saved
                              </span>
                            </div>
                          </div>
                        </div>
                        )}
                        {/* Arb charge — blue (only if arb slots exist) */}
                        {acCenter && pillV2g.arbChargeKeys.size > 0 && (
                          <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                            style={{ left: acCenter, top: acYAdj, transform: 'translateX(-50%)' }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className="text-[8px] font-bold text-blue-500 uppercase tracking-wider">Buy Low</span>
                              <div className="bg-blue-50/40 backdrop-blur-[2px] border border-blue-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                                <span className="text-blue-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                                  {acAvgCt.toFixed(1)} ct/kWh
                                </span>
                                <span className="text-blue-400 text-[9px] tabular-nums whitespace-nowrap">
                                  arb recharge
                                </span>
                              </div>
                            </div>
                          </div>
                        )}
                      </>
                    ) : (
                      /* V1G: Smart charging — blue label */
                      <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                        style={{ left: oCenter, top: oYAdj, transform: 'translateX(-50%)' }}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[8px] font-bold text-blue-500 uppercase tracking-wider">Smart charging</span>
                          <div className="bg-blue-50/40 backdrop-blur-[2px] border border-blue-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                            <span className="text-blue-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                              {pillSavings.oAvg.toFixed(1)} ct/kWh
                            </span>
                            <span className="text-blue-400 text-[9px] tabular-nums whitespace-nowrap">
                              {(pillSavings.oAvg * energyPerSession / 100).toFixed(2)} €
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* V2G discharge label — amber, on the discharge dots */}
                    {isV2G && pillV2g && dCenter && pillV2g.dischargeSlots.length > 0 && (
                      <div className="absolute pointer-events-none transition-[left,top] duration-100 ease-out z-10"
                        style={{ left: dCenter, top: dYAdj, transform: 'translateX(-50%)' }}>
                        <div className="flex flex-col items-center gap-0.5">
                          <span className="text-[8px] font-bold text-amber-500 uppercase tracking-wider">Sell High</span>
                          <div className="bg-amber-50/40 backdrop-blur-[2px] border border-amber-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                            <span className="w-1.5 h-1.5 bg-amber-500 rounded-full flex-shrink-0" />
                            <span className="text-amber-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                              {pillV2g.dischargeAvgCt.toFixed(1)} ct/kWh
                            </span>
                            <span className="text-amber-400 text-[9px] tabular-nums whitespace-nowrap">
                              +{pillV2g.dischargeRevenueEur.toFixed(2)} €
                            </span>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* Savings pill — top center */}
                    {totalSavingsCt > 0 && (
                      <div className="absolute pointer-events-none z-10"
                        style={{ left: '50%', top: 4, transform: 'translateX(-50%)' }}>
                        <div className="flex items-center gap-1.5">
                          <div className="backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1 bg-emerald-50/80 border-emerald-300/50">
                            <span className="text-[12px] font-bold tabular-nums whitespace-nowrap text-emerald-700">
                              {isV2G ? '+' : '▼'} {totalSavingsCt.toFixed(1)} ct/kWh
                            </span>
                            <span className="text-[9px] font-semibold tabular-nums whitespace-nowrap text-emerald-600">
                              {totalSavingsEur.toFixed(2)} € {isV2G ? (v2gHasNetCharge ? 'benefit' : 'arbitrage') : 'saved'}
                            </span>
                          </div>
                          {showIntraday && hasIntraday && intradayUpliftEur > 0 && (
                            <div className="backdrop-blur-sm border rounded-full px-2 py-0.5 shadow-sm flex items-center gap-1 bg-sky-50/80 border-sky-300/50">
                              <span className="text-[11px] font-bold tabular-nums whitespace-nowrap text-sky-700">
                                +{intradayUpliftCt.toFixed(1)} ct
                              </span>
                              <span className="text-[9px] font-semibold tabular-nums whitespace-nowrap text-sky-600">
                                {intradayUpliftEur.toFixed(2)} € ID3
                              </span>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </>}
                  </>
                )
              })()}

              {/* ── Fleet floating pills — same style as single-car ── */}
              {isFleetActive && fleetOptResult && plotArea && (() => {
                const idxToPx = (idx: number) => plotArea.left + (idx / (N - 1)) * plotArea.width
                const fleetArrIdx = chartData.findIndex(d => d.date === date1 && d.hour === fleetConfig.arrivalAvg)
                const fleetDepIdx = chartData.findIndex(d => d.date === date2 && d.hour === fleetConfig.departureAvg)
                const bCenter = fleetArrIdx >= 0 ? idxToPx(fleetArrIdx) + 40 : plotArea.left + 40
                const oCenter = fleetDepIdx >= 0 ? idxToPx(fleetDepIdx) - 40 : plotArea.left + plotArea.width - 40
                return (
                  <>
                    {/* Savings pill — top center */}
                    <div className="absolute pointer-events-none z-10"
                      style={{ left: '50%', top: plotArea.top + 4, transform: 'translateX(-50%)' }}>
                      <div className="backdrop-blur-sm border rounded-full px-2.5 py-0.5 shadow-sm flex items-center gap-1 bg-emerald-50/80 border-emerald-300/50">
                        <span className="text-[12px] font-bold tabular-nums whitespace-nowrap text-emerald-700">
                          ▼ {Math.abs(fleetOptResult.baselineAvgCtKwh - fleetOptResult.optimizedAvgCtKwh).toFixed(1)} ct/kWh
                        </span>
                        <span className="text-[9px] font-semibold tabular-nums whitespace-nowrap text-emerald-600">
                          {(Math.abs(fleetOptResult.savingsEur) / 1000).toFixed(2)} €/EV saved
                        </span>
                      </div>
                    </div>
                    {/* Baseline pill — near arrival handle */}
                    <div className="absolute pointer-events-none z-10"
                      style={{ left: bCenter, top: plotArea.top + 28, transform: 'translateX(-50%)' }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[8px] font-bold text-red-500 uppercase tracking-wider">Charge ASAP</span>
                        <div className="bg-red-50/40 backdrop-blur-[2px] border border-red-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-red-500 rounded-full flex-shrink-0" />
                          <span className="text-red-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                            {fleetOptResult.baselineAvgCtKwh.toFixed(1)} ct/kWh
                          </span>
                        </div>
                      </div>
                    </div>
                    {/* Optimized pill — near departure handle */}
                    <div className="absolute pointer-events-none z-10"
                      style={{ left: oCenter, top: plotArea.top + 28, transform: 'translateX(-50%)' }}>
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="text-[8px] font-bold text-blue-500 uppercase tracking-wider">Smart charging</span>
                        <div className="bg-blue-50/40 backdrop-blur-[2px] border border-blue-200/30 rounded-full px-2 py-px flex items-center gap-1.5">
                          <span className="w-1.5 h-1.5 bg-blue-500 rounded-full flex-shrink-0" />
                          <span className="text-blue-700 text-[11px] font-bold tabular-nums whitespace-nowrap">
                            {fleetOptResult.optimizedAvgCtKwh.toFixed(1)} ct/kWh
                          </span>
                        </div>
                      </div>
                    </div>
                  </>
                )
              })()}

              {/* ── Drag handles — invisible touch targets + label pills (hidden in fleet mode) ── */}
              {N > 1 && !isFleetActive && (
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

              {/* ── Fleet drag handles — avg arrival + avg departure ── */}
              {N > 1 && isFleetActive && plotArea && (() => {
                const fleetArrIdx = chartData.findIndex(d => d.date === date1 && d.hour === fleetConfig.arrivalAvg)
                const fleetDepIdx = chartData.findIndex(d => d.date === date2 && d.hour === fleetConfig.departureAvg)
                const fleetArrLabel = `${String(fleetConfig.arrivalAvg).padStart(2, '0')}:00`
                const fleetDepLabel = `${String(fleetConfig.departureAvg).padStart(2, '0')}:00`
                return (
                  <>
                    {/* FLEET ARRIVAL HANDLE */}
                    {fleetArrIdx >= 0 && (
                      <div className="absolute transition-[left] duration-100 z-20" style={{
                        left: getLeft(fleetArrIdx, N),
                        top: 0, height: '100%', transform: 'translateX(-50%)',
                      }}>
                        <div className="relative h-full flex justify-center cursor-col-resize group"
                          style={{ width: 28 }}
                          onMouseDown={(e) => { e.preventDefault(); setIsDragging('fleetArrival') }}
                          onTouchStart={(e) => { e.preventDefault(); setIsDragging('fleetArrival') }}>
                          <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap transition-all ${
                            isDragging === 'fleetArrival' ? 'scale-105' : ''
                          }`} style={{ top: 4 }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border transition-colors ${
                                isDragging === 'fleetArrival'
                                  ? 'text-white bg-[#EA1C0A] border-[#EA1C0A]'
                                  : 'text-[#EA1C0A] bg-white/95 border-red-200 group-hover:bg-red-50'
                              }`}>
                                Avg Arrival {fleetArrLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                    {/* FLEET DEPARTURE HANDLE */}
                    {fleetDepIdx >= 0 && (
                      <div className="absolute transition-[left] duration-100 z-20" style={{
                        left: getLeft(fleetDepIdx, N),
                        top: 0, height: '100%', transform: 'translateX(-50%)',
                      }}>
                        <div className="relative h-full flex justify-center cursor-col-resize group"
                          style={{ width: 28 }}
                          onMouseDown={(e) => { e.preventDefault(); setIsDragging('fleetDeparture') }}
                          onTouchStart={(e) => { e.preventDefault(); setIsDragging('fleetDeparture') }}>
                          <div className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap transition-all ${
                            isDragging === 'fleetDeparture' ? 'scale-105' : ''
                          }`} style={{ top: 4 }}>
                            <div className="flex flex-col items-center gap-0.5">
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full shadow-sm border transition-colors ${
                                isDragging === 'fleetDeparture'
                                  ? 'text-white bg-blue-600 border-blue-600'
                                  : 'text-blue-600 bg-white/95 border-blue-200 group-hover:bg-blue-50'
                              }`}>
                                Avg Departure {fleetDepLabel}
                              </span>
                            </div>
                          </div>
                        </div>
                      </div>
                    )}
                  </>
                )
              })()}

              {/* ── Edge-scroll zones — press & hold to scrub through days ── */}
              {!isDragging && (
                <>
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
                </>
              )}
            </div>

          {/* legend removed — colors explained via tooltip + drag handle labels */}

          {/* Fleet config is in the sidebar (Customer Profile card) */}
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

        // Use QH prices when 15-min resolution is active, otherwise hourly
        // QH data: each entry = 1 QH slot (0.25h), slotsPerHour=1, kwhPerSlot = chargePowerKw * 0.25
        // Hourly data: each entry = 1 hour slot, slotsPerHour=1, kwhPerSlot = chargePowerKw
        const useQH = isQH && prices.hourlyQH.length > 0
        const spreadPrices = useQH ? prices.hourlyQH : prices.hourly
        const spreadKwhPerSlot = useQH ? chargePowerKw * 0.25 : chargePowerKw

        // Overnight: plug-in evening → next morning
        const overnightSpreadWin = buildMultiDayWindow(spreadPrices, date1, date2, scenario.plugInTime, overnightDep)
        const overnightSp = computeSpread(overnightSpreadWin, energyPerSession, chargePowerKw, 1, spreadKwhPerSlot)

        // Full day: plug-in → departure on next day
        const fullDaySpreadWin = buildMultiDayWindow(spreadPrices, date1, date2, scenario.plugInTime, fullDayDep)
        const fullDaySp = computeSpread(fullDaySpreadWin, energyPerSession, chargePowerKw, 1, spreadKwhPerSlot)

        // 3-day: plug-in → departure on day+3
        const threeDaySpreadWin = hasDate3Data
          ? buildMultiDayWindow(spreadPrices, date1, date4, scenario.plugInTime, threeDayDep) : []
        const threeDaySp = hasDate3Data ? computeSpread(threeDaySpreadWin, energyPerSession, chargePowerKw, 1, spreadKwhPerSlot) : null
        const hasForecast3d = hasDate3Data && threeDaySpreadWin.some(p => p.isProjected)

        // Savings use the same windows
        const savingsOvernight = overnightSp
        const savingsFullDay = fullDaySp
        const savings3Day = threeDaySp

        // V2G profit for each window
        const v2gOvernightProfit = isV2G ? computeV2gWindowSavings(overnightSpreadWin, batteryKwh, chargePowerKw, scenario.dischargePowerKw, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.roundTripEfficiency, scenario.degradationCtKwh, spreadKwhPerSlot) : null
        const v2gFullDayProfit = isV2G ? computeV2gWindowSavings(fullDaySpreadWin, batteryKwh, chargePowerKw, scenario.dischargePowerKw, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.roundTripEfficiency, scenario.degradationCtKwh, spreadKwhPerSlot) : null
        const v2gThreeDayProfit = isV2G && threeDaySpreadWin.length > 0 ? computeV2gWindowSavings(threeDaySpreadWin, batteryKwh, chargePowerKw, scenario.dischargePowerKw, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.roundTripEfficiency, scenario.degradationCtKwh, spreadKwhPerSlot) : null

        // Determine which mode is currently active for highlight
        const activeMode = scenario.chargingMode === 'threeday' ? '3day' : scenario.chargingMode === 'fullday' ? 'fullday' : 'overnight'

        type SpreadRow = {
          key: string
          label: string
          tooltip: { title: string; desc: string; extra?: string }
          spread: ReturnType<typeof computeSpread>
          savings: ReturnType<typeof computeSpread>
          v2gProfit: V2gResult | null
          spreadRange: string
          savingsRange: string
          windowPrices: HourlyPrice[]
        }
        const rows: SpreadRow[] = []

        if (overnightSp) {
          rows.push({
            key: 'overnight',
            label: '12h',
            tooltip: { title: '12h window', desc: `${fmtHour(scenario.plugInTime)} → ${fmtHour(overnightDep)} next morning.` },
            spread: overnightSp, savings: savingsOvernight, v2gProfit: v2gOvernightProfit, windowPrices: overnightSpreadWin,
            spreadRange: `${fmtHour(scenario.plugInTime)} ${fmtDateShort(date1)} → ${fmtHour(overnightDep)} ${fmtDateShort(date2)}`,
            savingsRange: `${fmtHour(scenario.plugInTime)} → ${fmtHour(overnightDep)}`,
          })
        }
        if (fullDaySp && !showFleet) {
          rows.push({
            key: 'fullday',
            label: '24h',
            tooltip: { title: '24h window', desc: `${fmtHour(scenario.plugInTime)} → ${fmtHour(fullDayDep)} next day.` },
            spread: fullDaySp, savings: savingsFullDay, v2gProfit: v2gFullDayProfit, windowPrices: fullDaySpreadWin,
            spreadRange: `${fmtHour(scenario.plugInTime)} ${fmtDateShort(date1)} → ${fmtHour(fullDayDep)} ${fmtDateShort(date2)}`,
            savingsRange: `${fmtHour(scenario.plugInTime)} → ${fmtHour(fullDayDep)}`,
          })
        }
        if (threeDaySp && !showFleet) {
          rows.push({
            key: '3day',
            label: '72h',
            tooltip: {
              title: '72h window',
              desc: `${fmtHour(scenario.plugInTime)} → ${fmtHour(threeDayDep)} on ${fmtDateShort(date4)}.`,
              extra: hasForecast3d ? 'Includes forecast prices.' : undefined,
            },
            spread: threeDaySp, savings: savings3Day, v2gProfit: v2gThreeDayProfit, windowPrices: threeDaySpreadWin,
            spreadRange: `${fmtHour(scenario.plugInTime)} ${fmtDateShort(date1)} → ${fmtHour(threeDayDep)} ${fmtDateShort(date4)}`,
            savingsRange: `${fmtHour(scenario.plugInTime)} → ${fmtHour(threeDayDep)}`,
          })
        }

        if (rows.length === 0) return null

        // Map row keys to perModeSavings keys
        const modeKeyMap: Record<string, string> = { overnight: 'overnight', fullday: 'fullday', '3day': 'threeday' }

        return (
          <div id="tour-scenario-cards" className={`grid gap-3 ${rows.length === 3 ? 'grid-cols-3' : rows.length === 2 ? 'grid-cols-2' : 'grid-cols-1'}`}>
            {rows.map(row => {
              const isActive = row.key === activeMode
              const ms = showFleet && row.key === 'overnight' ? fleetPerModeSavings : (perModeSavings[modeKeyMap[row.key]] ?? { ctKwh4w: 0, eur4w: 0, ctKwh52w: 0, eur52w: 0 })
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
                  {/* Selected day — Fleet / V2G / V1G savings */}
                  {showFleet && row.key === 'overnight' && fleetOptResult ? (() => {
                    const fleetSavingsCtKwh = Math.abs(fleetOptResult.baselineAvgCtKwh - fleetOptResult.optimizedAvgCtKwh)
                    const fleetSavingsEur = Math.abs(fleetOptResult.savingsEur)
                    const perEvSavingsEur = fleetSavingsEur / 1000
                    const perEvKwh = fleetOptResult.totalEnergyKwh / 1000
                    return (
                    <div className="mb-2">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Savings on selected day</p>
                      <span className={`text-xl font-extrabold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {fleetSavingsCtKwh.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-400 ml-1">ct/kWh cheaper</span>
                      <p className={`text-[10px] mt-0.5 ${isActive ? 'text-emerald-600/70' : 'text-gray-400'}`}>
                        = {(perEvSavingsEur * 100).toFixed(1)} ct saved per EV on {perEvKwh.toFixed(1)} kWh session
                      </p>
                      <p className="text-[8px] text-gray-400 mt-0.5">
                        Fleet total: {fleetSavingsEur.toFixed(2)} EUR · 1,000 EVs
                      </p>
                    </div>
                    )
                  })() : isV2G && row.v2gProfit ? (
                    <div className="mb-2">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">
                        {v2gHasNetCharge ? 'V2G benefit' : 'Arbitrage'} on selected day
                      </p>
                      <span className={`text-xl font-extrabold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {row.v2gProfit.profitEur.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-400 ml-1">EUR</span>
                      <div className="flex gap-3 mt-1 text-[9px]">
                        {v2gHasNetCharge && <span className="text-emerald-500">Shift: {row.v2gProfit.loadShiftingBenefitEur.toFixed(2)} €</span>}
                        <span className="text-blue-500">Arb: {row.v2gProfit.arbitrageUpliftEur.toFixed(2)} €</span>
                        <span className="text-gray-400">Wear: {row.v2gProfit.degradationCostEur.toFixed(2)} €</span>
                      </div>
                    </div>
                  ) : row.savings && (
                    <div className="mb-2">
                      <p className="text-[9px] text-gray-400 uppercase tracking-wide mb-0.5">Savings on selected day</p>
                      <span className={`text-xl font-extrabold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {row.savings.capturableSavingsCtKwh.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-gray-400 ml-1">ct/kWh cheaper</span>
                      <p className={`text-[10px] mt-0.5 ${isActive ? 'text-emerald-600/70' : 'text-gray-400'}`}>
                        = {(row.savings.capturableSavingsEur * 100).toFixed(1)} ct saved on {energyPerSession} kWh session
                      </p>
                    </div>
                  )}
                  {/* Last 4 weeks + Last 52 weeks — per-mode calculation */}
                  <div className="grid grid-cols-2 gap-2 pt-2 border-t border-gray-100 mb-2">
                    <div>
                      <p className="text-[8px] text-gray-400 uppercase tracking-wide">{isV2G ? 'Avg profit' : 'Avg savings'} 4 wk</p>
                      <p className={`text-[13px] font-bold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {isV2G ? ms.eur4w.toFixed(2) : ms.ctKwh4w.toFixed(2)}<span className="text-[8px] font-normal text-gray-400 ml-0.5">{isV2G ? 'EUR' : 'ct/kWh'}</span>
                      </p>
                      <p className="text-[8px] text-gray-400">
                        {showFleet ? `${(ms.eur4w / 1000).toFixed(2)} EUR/EV · ${ms.eur4w.toFixed(0)} EUR fleet` : `${ms.eur4w.toFixed(2)} EUR total`}
                      </p>
                    </div>
                    <div>
                      <p className="text-[8px] text-gray-400 uppercase tracking-wide">{isV2G ? 'Avg profit' : 'Avg savings'} 52 wk</p>
                      <p className={`text-[13px] font-bold tabular-nums ${isActive ? 'text-emerald-600' : 'text-gray-500'}`}>
                        {isV2G ? ms.eur52w.toFixed(0) : ms.ctKwh52w.toFixed(2)}<span className="text-[8px] font-normal text-gray-400 ml-0.5">{isV2G ? 'EUR/yr' : 'ct/kWh'}</span>
                      </p>
                      <p className="text-[8px] text-gray-400">
                        {showFleet ? `${(ms.eur52w / 1000).toFixed(0)} EUR/EV/yr · ${ms.eur52w.toFixed(0)} EUR fleet` : `${ms.eur52w.toFixed(0)} EUR/yr`}
                      </p>
                    </div>
                  </div>
                  {/* Market range = min↔max price in window */}
                  <div className="flex items-baseline justify-between pt-1.5 border-t border-gray-100">
                    <span className="text-[9px] text-gray-400 uppercase tracking-wide">Market range</span>
                    <span className={`text-[13px] font-bold tabular-nums ${isActive ? 'text-[#313131]' : 'text-gray-500'}`}>
                      {row.spread!.marketSpreadCtKwh.toFixed(2)}<span className="text-[9px] font-normal text-gray-400 ml-0.5">ct</span>
                    </span>
                  </div>
                  <p className="text-[8px] text-gray-400 font-mono leading-relaxed">
                    cheapest {row.spread!.cheapestHour} {row.spread!.minPriceCtKwh.toFixed(1)} ↔ costliest {row.spread!.expensiveHour} {row.spread!.maxPriceCtKwh.toFixed(1)} ct
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
        const detailPrices = isQH && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly
        const detailIsQH = isQH && prices.hourlyQH.length > 0
        const winMap: Record<string, { prices: HourlyPrice[]; label: string }> = {
          overnight: { prices: buildMultiDayWindow(detailPrices, date1, date2, scenario.plugInTime, overnightDepD), label: '12h' },
          fullday: { prices: buildMultiDayWindow(detailPrices, date1, date2, scenario.plugInTime, fullDayDepD), label: '24h' },
          '3day': { prices: hasDate3Data ? buildMultiDayWindow(detailPrices, date1, date4, scenario.plugInTime, threeDayDepD) : [], label: '72h' },
        }
        const detail = winMap[costDetailMode]
        if (!detail || detail.prices.length === 0) return null
        const kwhPerSlot = detailIsQH ? chargePowerKw * 0.25 : chargePowerKw
        const fmtSlot = (p: HourlyPrice) => {
          const d = p.date !== date1 ? ` ${p.date.slice(8, 10)}.` : ''
          return `${String(p.hour).padStart(2, '0')}:${String(p.minute ?? 0).padStart(2, '0')}${d}`
        }

        // V2G detail panel
        if (isV2G) {
          const v2gDetail = computeV2gWindowSavings(detail.prices, batteryKwh, chargePowerKw, scenario.dischargePowerKw, scenario.v2gStartSoc, scenario.v2gTargetSoc, scenario.minSocPercent, scenario.roundTripEfficiency, scenario.degradationCtKwh, kwhPerSlot)
          const chargeSlotsSorted = [...v2gDetail.chargeSlots].sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0))
          const dischargeSlotsSorted = [...v2gDetail.dischargeSlots].sort((a, b) => a.date !== b.date ? (a.date < b.date ? -1 : 1) : a.hour !== b.hour ? a.hour - b.hour : (a.minute ?? 0) - (b.minute ?? 0))
          return (
            <div className="mt-3 rounded-lg border border-gray-200 bg-white p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-[11px] font-bold text-[#313131]">
                  {v2gHasNetCharge ? 'V2G Benefit' : 'V2G Arbitrage'} — {detail.label} · {fmtDateShort(date1)} {detailIsQH && <span className="text-[9px] text-gray-400 font-normal ml-1">(15 min)</span>}
                </p>
                <div className="flex items-center gap-3">
                  <p className="text-[10px] text-gray-400">
                    {batteryKwh} kWh · {scenario.v2gStartSoc}% → {scenario.v2gTargetSoc}%
                    {v2gHasNetCharge
                      ? ` · ${Math.round(batteryKwh * (scenario.v2gTargetSoc - scenario.v2gStartSoc) / 100)} kWh net`
                      : ' · no net charge'}
                  </p>
                  <button onClick={() => setCostDetailMode(null)} className="text-[10px] text-gray-400 hover:text-gray-600">✕</button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {/* Charge slots — split by net charge (green) vs arb charge (blue) */}
                <div className="rounded-lg p-3 border border-gray-200/80 bg-gray-50/40">
                  <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-2">
                    Charge · {chargeSlotsSorted.length} slots · {v2gDetail.totalChargedKwh.toFixed(1)} kWh
                  </p>
                  <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                    {chargeSlotsSorted.map((p: HourlyPrice, i: number) => {
                      const key = `${p.date}-${p.hour}-${p.minute ?? 0}`
                      const isNet = v2gDetail.netChargeKeys.has(key)
                      return (
                        <div key={i} className="flex justify-between text-[11px] leading-snug">
                          <span className="font-mono text-gray-500">
                            <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${isNet ? 'bg-emerald-500' : 'bg-blue-500'}`} />
                            {fmtSlot(p)}
                          </span>
                          <span className={`tabular-nums font-semibold ${isNet ? 'text-emerald-700' : 'text-blue-700'}`}>{p.priceCtKwh.toFixed(1)} ct</span>
                        </div>
                      )
                    })}
                  </div>
                  <div className="border-t border-gray-200/80 mt-2 pt-1.5 text-[10px] space-y-0.5">
                    {v2gDetail.netChargeKeys.size > 0 && (
                      <div className="flex justify-between">
                        <span className="text-emerald-600 font-medium">{v2gDetail.netChargeKeys.size} net charge</span>
                        <span className="font-semibold text-emerald-600 tabular-nums">{v2gDetail.optimizedChargeCostEur.toFixed(2)} EUR</span>
                      </div>
                    )}
                    {v2gDetail.arbChargeKeys.size > 0 && (
                      <div className="flex justify-between">
                        <span className="text-blue-600 font-medium">{v2gDetail.arbChargeKeys.size} arb recharge</span>
                        <span className="font-semibold text-blue-600 tabular-nums">{(v2gDetail.chargeCostEur - v2gDetail.optimizedChargeCostEur).toFixed(2)} EUR</span>
                      </div>
                    )}
                  </div>
                </div>

                {/* Discharge slots (sell high) — amber */}
                <div className="bg-amber-50/60 rounded-lg p-3 border border-amber-100/80">
                  <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mb-2">
                    Discharge · {dischargeSlotsSorted.length} slots · {v2gDetail.totalDischargedKwh.toFixed(1)} kWh
                  </p>
                  <div className="space-y-0.5 max-h-[200px] overflow-y-auto">
                    {dischargeSlotsSorted.map((p: HourlyPrice, i: number) => (
                      <div key={i} className="flex justify-between text-[11px] leading-snug">
                        <span className="font-mono text-gray-500">{fmtSlot(p)}</span>
                        <span className="tabular-nums font-semibold text-amber-700">{p.priceCtKwh.toFixed(1)} ct</span>
                      </div>
                    ))}
                  </div>
                  <div className="border-t border-amber-200/80 mt-2 pt-1.5 flex justify-between text-[11px]">
                    <span className="text-gray-500 font-medium">avg sell</span>
                    <span className="font-bold text-amber-700 tabular-nums">{v2gDetail.dischargeAvgCt.toFixed(2)} ct/kWh</span>
                  </div>
                  <div className="flex justify-between text-[10px] mt-0.5">
                    <span className="text-gray-400">revenue</span>
                    <span className="font-semibold text-amber-600 tabular-nums">+{v2gDetail.dischargeRevenueEur.toFixed(2)} EUR</span>
                  </div>
                </div>
              </div>

              {/* V2G Summary: total benefit = load shifting + arbitrage */}
              <div className="bg-gray-50 rounded-lg px-3 py-2 border border-gray-100 space-y-1">
                {/* Total benefit headline */}
                <div className="flex items-center justify-between pb-1.5 mb-1 border-b border-gray-200">
                  <span className="text-[10px] font-semibold text-gray-500">
                    {v2gHasNetCharge ? 'Total V2G Benefit' : 'Arbitrage Profit'}
                  </span>
                  <div className="text-right">
                    <span className="text-[13px] font-bold text-emerald-700 tabular-nums">{v2gDetail.profitEur.toFixed(2)} EUR</span>
                    <span className="text-[10px] text-gray-400 ml-1">/session</span>
                  </div>
                </div>
                {/* Load shifting portion — only when startSoC < targetSoC */}
                {v2gHasNetCharge && (
                  <>
                    <div className="flex justify-between text-[10px]">
                      <span className="text-emerald-600 font-medium">
                        <span className="inline-block w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1" />
                        Load Shifting
                      </span>
                      <span className="font-semibold text-emerald-600 tabular-nums">{v2gDetail.loadShiftingBenefitEur.toFixed(2)} EUR</span>
                    </div>
                    <div className="flex justify-between text-[9px] text-gray-400 pl-4">
                      <span>
                        {Math.round(batteryKwh * (scenario.v2gTargetSoc - scenario.v2gStartSoc) / 100)} kWh net charge:
                        baseline {v2gDetail.baselineChargeCostEur.toFixed(2)} → optimized {v2gDetail.optimizedChargeCostEur.toFixed(2)} EUR
                      </span>
                    </div>
                  </>
                )}
                {!v2gHasNetCharge && (
                  <div className="text-[9px] text-gray-400 pl-2">
                    Start SoC ({scenario.v2gStartSoc}%) ≥ Target ({scenario.v2gTargetSoc}%) — no net charge needed, pure arbitrage
                  </div>
                )}
                {/* Arbitrage portion */}
                <div className="flex justify-between text-[10px]">
                  <span className="text-blue-600 font-medium">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-blue-500 mr-1" />
                    {v2gHasNetCharge ? 'Arbitrage Uplift' : 'Arbitrage'}
                  </span>
                  <span className="font-semibold text-blue-600 tabular-nums">{v2gDetail.arbitrageUpliftEur.toFixed(2)} EUR</span>
                </div>
                {v2gDetail.arbitrageUpliftEur > 0 && (
                  <div className="text-[9px] text-gray-400 pl-4 space-y-0.5">
                    <div className="flex justify-between">
                      <span>Sell {v2gDetail.totalDischargedKwh.toFixed(1)} kWh at avg {v2gDetail.dischargeAvgCt.toFixed(1)} ct</span>
                      <span className="tabular-nums">+{v2gDetail.dischargeRevenueEur.toFixed(2)} EUR</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Recharge cost (eff. adjusted)</span>
                      <span className="tabular-nums">-{(v2gDetail.chargeCostEur - (v2gHasNetCharge ? v2gDetail.optimizedChargeCostEur : 0)).toFixed(2)} EUR</span>
                    </div>
                    <div className="flex justify-between">
                      <span>Battery degradation ({scenario.degradationCtKwh} ct/kWh)</span>
                      <span className="tabular-nums">-{v2gDetail.degradationCostEur.toFixed(2)} EUR</span>
                    </div>
                  </div>
                )}
                {v2gDetail.arbitrageUpliftEur === 0 && v2gDetail.dischargeSlots.length === 0 && (
                  <div className="text-[9px] text-gray-400 pl-4">
                    No profitable discharge/recharge cycles found for this price window
                  </div>
                )}
              </div>
            </div>
          )
        }

        // V1G detail panel (unchanged)
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
                  Charge now · first {slotLabel}
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
                  Smart charging · cheapest {slotLabel}
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
                <span className="font-mono">{bAvg.toFixed(2)} ct (now) − {oAvg.toFixed(2)} ct (smart) = <strong className="text-emerald-600">{(bAvg - oAvg).toFixed(2)} ct/kWh saved</strong></span>
              </div>
              <div className="text-right">
                <span className="text-[10px] text-gray-400">savings </span>
                <span className="text-[13px] font-bold text-emerald-700 tabular-nums">{(bEur - oEur).toFixed(2)} EUR</span>
                <span className="text-[10px] text-gray-400 ml-1">/session</span>
              </div>
            </div>
            {showIntraday && hasIntraday && (
              <div className="mt-2 rounded-lg border border-sky-200/60 bg-sky-50/40 p-2.5 space-y-1.5">
                <div className="flex items-center justify-between">
                  <span className="text-[10px] font-bold text-sky-600 uppercase tracking-wider">Intraday Re-optimization (ID3)</span>
                  {intradayUpliftEur > 0 && (
                    <span className="text-[11px] font-bold text-sky-700 tabular-nums">+{intradayUpliftEur.toFixed(2)} EUR</span>
                  )}
                </div>
                <div className="text-[10px] text-gray-500 space-y-0.5">
                  <div className="flex justify-between">
                    <span>1. DA schedule @ ID3 prices</span>
                    <span className="tabular-nums font-medium">{id3DaScheduleAvgCt.toFixed(2)} ct/kWh</span>
                  </div>
                  <div className="flex justify-between">
                    <span>2. ID3-optimized schedule</span>
                    <span className="tabular-nums font-medium text-sky-600">{id3OptScheduleAvgCt.toFixed(2)} ct/kWh</span>
                  </div>
                  <div className="flex justify-between border-t border-sky-200/60 pt-1 mt-1">
                    <span className="font-medium">Position swap value</span>
                    <span className="tabular-nums font-semibold text-sky-700">{intradayUpliftCt.toFixed(2)} ct/kWh = {intradayUpliftEur.toFixed(2)} EUR</span>
                  </div>
                </div>
                {intradayUpliftEur <= 0 && (
                  <p className="text-[9px] text-gray-400">DA schedule is already optimal on ID3 — no profitable re-optimization.</p>
                )}
              </div>
            )}
          </div>
        )
      })()}

      </div>{/* end right content column */}
      </div>{/* end main two-column grid */}

      {/* ── Savings Overview: Heatmap + Monthly + Yearly ── */}
      {(activeMonthlySavingsData.length > 0 || activeDailySavingsMap.size > 0) && (
        <div className="space-y-6">
          {activeDailySavingsMap.size > 0 && (
            <DailySavingsHeatmap
              dailySavingsMap={showFleet
                ? new Map([...activeDailySavingsMap].map(([k, v]) => [k, { ...v, savingsEur: v.savingsEur / 1000 }]))
                : activeDailySavingsMap}
              selectedDate={prices.selectedDate}
              onSelect={prices.setSelectedDate}
              energyPerSession={showFleet ? computeFleetEnergyKwh(deriveFleetDistributions(fleetConfig)) / 1000 : energyPerSession}
              chargingMode={scenario.chargingMode}
              rollingAvgSavings={showFleet ? activeRollingSavings / 1000 : activeRollingSavings}
              sessionsPerYear={showFleet ? 365 : sessionsPerYear}
              selectedDayCost={showFleet && fleetOptResult
                ? { baselineAvgCt: fleetOptResult.baselineAvgCtKwh, optimizedAvgCt: fleetOptResult.optimizedAvgCtKwh, savingsEur: Math.abs(fleetOptResult.savingsEur) / 1000 }
                : sessionCost ? { baselineAvgCt: sessionCost.baselineAvgCt, optimizedAvgCt: sessionCost.optimizedAvgCt, savingsEur: sessionCost.savingsEur } : null}
            />
          )}
          {activeMonthlySavingsData.length > 0 && (
            <div id="tour-monthly-savings" className="grid grid-cols-1 lg:grid-cols-[3fr_1fr] gap-6">
              <MonthlySavingsCard
                monthlySavingsData={showFleet
                  ? activeMonthlySavingsData.map(m => ({ ...m, savings: m.savings / 1000 }))
                  : activeMonthlySavingsData}
                weeklyPlugIns={showFleet ? 7 : weeklyPlugIns}
                energyPerSession={showFleet ? computeFleetEnergyKwh(deriveFleetDistributions(fleetConfig)) / 1000 : energyPerSession}
                sessionsPerYear={showFleet ? 365 : sessionsPerYear}
                rollingAvgSavings={showFleet ? activeRollingSavings / 1000 : activeRollingSavings}
                monthlySavings={showFleet ? activeMonthlySavings / 1000 : activeMonthlySavings}
                avgDailyEur={showFleet ? activeRollingSavings / 1000 / 365 : (sessionsPerYear > 0 ? activeRollingSavings / sessionsPerYear : 0)}
                selectedDate={date1}
                chargingMode={scenario.chargingMode}
                isV2G={isV2G}
                v2gHasNetCharge={v2gHasNetCharge}
              />
              {activeYearlySavingsData.length > 0 && (
                <YearlySavingsCard
                  yearlySavingsData={activeYearlySavingsData}
                  weeklyPlugIns={weeklyPlugIns}
                  energyPerSession={energyPerSession}
                  chargingMode={scenario.chargingMode}
                  isV2G={isV2G}
                  isFleet={showFleet}
                />
              )}
            </div>
          )}
        </div>
      )}

      {/* loading state when sessionCost not yet ready */}
      {!sessionCost && activeMonthlySavingsData.length === 0 && (
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
