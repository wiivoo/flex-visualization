'use client'

import { useState, useEffect, useMemo, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Calendar } from '@/components/ui/calendar'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Skeleton } from '@/components/ui/skeleton'
import {
  ComposedChart,
  Area,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceArea,
  ReferenceLine,
} from 'recharts'
import {
  CalendarIcon,
  Sun,
  Moon,
  Sunset,
  Sunrise,
  ChevronLeft,
  ChevronRight,
  Zap,
  TrendingUp,
  TrendingDown,
  Activity,
  Database,
} from 'lucide-react'
import { format, addDays, subDays, startOfDay } from 'date-fns'
import type { PricePoint } from '@/lib/config'

interface PriceSourceExplorerProps {
  onChargingWindowChange?: (start: number, end: number) => void
  initialDate?: Date
}

interface ChartDataPoint {
  hour: number
  label: string
  dayAhead: number | null
  intraday: number | null
  spread: number | null
  isNight: boolean
  isCharging: boolean
}

// The view spans from 12:00 (noon) of selectedDate to 12:00 (noon) of next day
// This centers the overnight period (6pm - 7am) which is the core focus

export function PriceSourceExplorer({ onChargingWindowChange, initialDate }: PriceSourceExplorerProps) {
  const [selectedDate, setSelectedDate] = useState<Date>(initialDate || new Date())
  const [calendarOpen, setCalendarOpen] = useState(false)
  const [dayAheadPrices, setDayAheadPrices] = useState<PricePoint[]>([])
  const [intradayPrices, setIntradayPrices] = useState<PricePoint[]>([])
  const [dayAheadSource, setDayAheadSource] = useState<string>('')
  const [intradaySource, setIntradaySource] = useState<string>('')
  const [isLoading, setIsLoading] = useState(false)
  const [showDayAhead, setShowDayAhead] = useState(true)
  const [showIntraday, setShowIntraday] = useState(true)

  // Charging session slider state (hours 0-23 in the 24h view)
  // Default: 10pm to 6am (evening to morning) = index 10 to 18 in our 12pm-12pm view
  const [chargeStart, setChargeStart] = useState(10) // 10pm in 12pm-based view
  const [chargeEnd, setChargeEnd] = useState(18) // 6am next day in 12pm-based view

  // Fetch both day-ahead and intraday prices
  const fetchPrices = useCallback(async (date: Date) => {
    setIsLoading(true)
    const dateStr = format(date, 'yyyy-MM-dd')
    const nextDateStr = format(addDays(date, 1), 'yyyy-MM-dd')

    try {
      // Fetch both dates for both sources in parallel (we need 12pm-12pm cross-day)
      const [daRes1, daRes2, idRes1, idRes2] = await Promise.allSettled([
        fetch(`/api/prices?type=day-ahead&date=${dateStr}`),
        fetch(`/api/prices?type=day-ahead&date=${nextDateStr}`),
        fetch(`/api/prices?type=intraday&date=${dateStr}`),
        fetch(`/api/prices?type=intraday&date=${nextDateStr}`),
      ])

      // Day-ahead
      let daPrices: PricePoint[] = []
      let daSource = ''
      if (daRes1.status === 'fulfilled' && daRes1.value.ok) {
        const data = await daRes1.value.json()
        daPrices = data.prices || []
        daSource = data.source || ''
      }
      if (daRes2.status === 'fulfilled' && daRes2.value.ok) {
        const data = await daRes2.value.json()
        daPrices = [...daPrices, ...(data.prices || [])]
      }
      setDayAheadPrices(daPrices)
      setDayAheadSource(daSource)

      // Intraday
      let idPrices: PricePoint[] = []
      let idSource = ''
      if (idRes1.status === 'fulfilled' && idRes1.value.ok) {
        const data = await idRes1.value.json()
        idPrices = data.prices || []
        idSource = data.source || ''
      }
      if (idRes2.status === 'fulfilled' && idRes2.value.ok) {
        const data = await idRes2.value.json()
        idPrices = [...idPrices, ...(data.prices || [])]
      }
      setIntradayPrices(idPrices)
      setIntradaySource(idSource)
    } catch {
      // Silently fail
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPrices(selectedDate)
  }, [selectedDate, fetchPrices])

  // Build chart data: 12:00 day1 → 12:00 day2 (24 hours)
  const chartData = useMemo((): ChartDataPoint[] => {
    const day1Start = startOfDay(selectedDate).getTime()
    const day2Start = startOfDay(addDays(selectedDate, 1)).getTime()

    const data: ChartDataPoint[] = []

    for (let i = 0; i < 24; i++) {
      const actualHour = (12 + i) % 24
      const isNextDay = 12 + i >= 24
      const targetMs = (isNextDay ? day2Start : day1Start) + actualHour * 3600000

      // Find day-ahead price for this hour
      const daPoint = dayAheadPrices.find(p => {
        const pMs = new Date(p.timestamp).getTime()
        return pMs >= targetMs && pMs < targetMs + 3600000
      })

      // Find intraday price for this hour (average 15-min intervals)
      const idPoints = intradayPrices.filter(p => {
        const pMs = new Date(p.timestamp).getTime()
        return pMs >= targetMs && pMs < targetMs + 3600000
      })
      const idAvg = idPoints.length > 0
        ? idPoints.reduce((s, p) => s + p.price_ct_kwh, 0) / idPoints.length
        : null

      const daPrice = daPoint?.price_ct_kwh ?? null
      const idPrice = idAvg

      // Night: 6pm to 7am (indices 6 to 19 in our 12pm-based view)
      const isNight = i >= 6 && i <= 19

      // Charging window
      const isCharging = i >= chargeStart && i < chargeEnd

      // Time label
      const hourLabel = `${actualHour.toString().padStart(2, '0')}:00`

      data.push({
        hour: i,
        label: hourLabel,
        dayAhead: daPrice !== null ? Math.round(daPrice * 100) / 100 : null,
        intraday: idPrice !== null ? Math.round(idPrice * 100) / 100 : null,
        spread: daPrice !== null && idPrice !== null
          ? Math.round((daPrice - idPrice) * 100) / 100
          : null,
        isNight,
        isCharging,
      })
    }

    return data
  }, [dayAheadPrices, intradayPrices, selectedDate, chargeStart, chargeEnd])

  // Night KPIs (6pm to 7am focus)
  const nightKPIs = useMemo(() => {
    const nightData = chartData.filter(d => d.isNight)
    const daPrices = nightData.map(d => d.dayAhead).filter((p): p is number => p !== null)
    const idPrices = nightData.map(d => d.intraday).filter((p): p is number => p !== null)
    const spreads = nightData.map(d => d.spread).filter((s): s is number => s !== null)

    const daMin = daPrices.length > 0 ? Math.min(...daPrices) : 0
    const daMax = daPrices.length > 0 ? Math.max(...daPrices) : 0
    const daAvg = daPrices.length > 0 ? daPrices.reduce((s, p) => s + p, 0) / daPrices.length : 0
    const idAvg = idPrices.length > 0 ? idPrices.reduce((s, p) => s + p, 0) / idPrices.length : 0
    const nightSpread = daMax - daMin
    const avgSpread = spreads.length > 0 ? spreads.reduce((s, v) => s + Math.abs(v), 0) / spreads.length : 0

    return { daMin, daMax, daAvg, idAvg, nightSpread, avgSpread, daPrices, idPrices }
  }, [chartData])

  // Charging window KPIs
  const chargingKPIs = useMemo(() => {
    const chargingData = chartData.filter(d => d.isCharging)
    const daPrices = chargingData.map(d => d.dayAhead).filter((p): p is number => p !== null)
    const avgPrice = daPrices.length > 0 ? daPrices.reduce((s, p) => s + p, 0) / daPrices.length : 0
    const minPrice = daPrices.length > 0 ? Math.min(...daPrices) : 0
    const hours = chargeEnd - chargeStart

    return { avgPrice, minPrice, hours }
  }, [chartData, chargeStart, chargeEnd])

  // Notify parent of charging window changes
  useEffect(() => {
    const actualStart = (12 + chargeStart) % 24
    const actualEnd = (12 + chargeEnd) % 24
    onChargingWindowChange?.(actualStart, actualEnd)
  }, [chargeStart, chargeEnd, onChargingWindowChange])

  const navigateDate = (direction: -1 | 1) => {
    setSelectedDate(prev => direction === 1 ? addDays(prev, 1) : subDays(prev, 1))
  }

  // Get icon for hour
  const getTimeIcon = (hour: number) => {
    if (hour >= 6 && hour < 8) return <Sunrise className="h-3 w-3 text-amber-500" />
    if (hour >= 8 && hour < 18) return <Sun className="h-3 w-3 text-yellow-500" />
    if (hour >= 18 && hour < 20) return <Sunset className="h-3 w-3 text-orange-500" />
    return <Moon className="h-3 w-3 text-indigo-400" />
  }

  // Slider positions to actual hours
  const sliderStartHour = (12 + chargeStart) % 24
  const sliderEndHour = (12 + chargeEnd) % 24

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-3">
          <Skeleton className="h-6 w-48" />
          <Skeleton className="mt-1 h-4 w-64" />
        </CardHeader>
        <CardContent className="space-y-4">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-[350px] rounded-lg" />
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2 text-base">
            <Database className="h-5 w-5" />
            Price Sources & Charging Window
          </CardTitle>
          <div className="flex items-center gap-1">
            {dayAheadSource && (
              <Badge variant="outline" className="text-xs">
                DA: {dayAheadSource}
              </Badge>
            )}
            {intradaySource && (
              <Badge variant="outline" className="text-xs">
                ID: {intradaySource}
              </Badge>
            )}
          </div>
        </div>
        <p className="text-sm text-muted-foreground">
          Noon-to-noon view — overnight charging window in focus (6 PM to 7 AM)
        </p>
      </CardHeader>
      <CardContent className="space-y-5">
        {/* Date selector + source toggles */}
        <div className="flex flex-wrap items-center gap-3">
          {/* Date navigation */}
          <div className="flex items-center gap-1 rounded-lg border p-1">
            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateDate(-1)}>
              <ChevronLeft className="h-4 w-4" />
            </Button>

            <Popover open={calendarOpen} onOpenChange={setCalendarOpen}>
              <PopoverTrigger asChild>
                <Button variant="ghost" className="h-8 gap-1.5 px-3 text-sm font-medium">
                  <CalendarIcon className="h-3.5 w-3.5" />
                  {format(selectedDate, 'MMM d, yyyy')}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-auto p-0" align="start">
                <Calendar
                  mode="single"
                  selected={selectedDate}
                  onSelect={(date) => {
                    if (date) {
                      setSelectedDate(date)
                      setCalendarOpen(false)
                    }
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>

            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => navigateDate(1)}>
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>

          {/* Source toggles */}
          <div className="flex items-center gap-1.5">
            <Button
              variant={showDayAhead ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowDayAhead(!showDayAhead)}
            >
              <Sun className="mr-1 h-3 w-3" />
              Day-Ahead (SMARD)
            </Button>
            <Button
              variant={showIntraday ? 'default' : 'outline'}
              size="sm"
              className="h-8 text-xs"
              onClick={() => setShowIntraday(!showIntraday)}
            >
              <Activity className="mr-1 h-3 w-3" />
              Intraday (CSV)
            </Button>
          </div>

          {/* Cross-day label */}
          <div className="ml-auto flex items-center gap-1.5 text-xs text-muted-foreground">
            <Sun className="h-3 w-3 text-yellow-500" />
            <span>{format(selectedDate, 'MMM d')}</span>
            <span>→</span>
            <Moon className="h-3 w-3 text-indigo-400" />
            <span>{format(addDays(selectedDate, 1), 'MMM d')}</span>
          </div>
        </div>

        {/* Night KPIs */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border bg-gradient-to-br from-indigo-50 to-purple-50 p-3 dark:from-indigo-950/20 dark:to-purple-950/20">
            <div className="flex items-center gap-1.5 text-xs text-indigo-600 dark:text-indigo-400">
              <Moon className="h-3.5 w-3.5" />
              Night Spread
            </div>
            <p className="mt-1 text-2xl font-bold">{nightKPIs.nightSpread.toFixed(1)} ct</p>
            <p className="text-xs text-muted-foreground">6 PM – 7 AM</p>
          </div>

          <div className="rounded-lg border bg-gradient-to-br from-blue-50 to-cyan-50 p-3 dark:from-blue-950/20 dark:to-cyan-950/20">
            <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
              <TrendingDown className="h-3.5 w-3.5" />
              Night Min
            </div>
            <p className="mt-1 text-2xl font-bold">{nightKPIs.daMin.toFixed(1)} ct</p>
            <p className="text-xs text-muted-foreground">Cheapest overnight</p>
          </div>

          <div className="rounded-lg border bg-gradient-to-br from-green-50 to-emerald-50 p-3 dark:from-green-950/20 dark:to-emerald-950/20">
            <div className="flex items-center gap-1.5 text-xs text-green-600 dark:text-green-400">
              <Zap className="h-3.5 w-3.5" />
              Charging Avg
            </div>
            <p className="mt-1 text-2xl font-bold">{chargingKPIs.avgPrice.toFixed(1)} ct</p>
            <p className="text-xs text-muted-foreground">{chargingKPIs.hours}h window</p>
          </div>

          <div className="rounded-lg border bg-gradient-to-br from-amber-50 to-orange-50 p-3 dark:from-amber-950/20 dark:to-orange-950/20">
            <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400">
              <TrendingUp className="h-3.5 w-3.5" />
              DA vs ID Spread
            </div>
            <p className="mt-1 text-2xl font-bold">{nightKPIs.avgSpread.toFixed(1)} ct</p>
            <p className="text-xs text-muted-foreground">Avg. overnight diff</p>
          </div>
        </div>

        {/* Main Chart: 12pm to 12pm with night shading and charging window */}
        <div>
          <ResponsiveContainer width="100%" height={350}>
            <ComposedChart data={chartData} margin={{ top: 10, right: 15, left: 0, bottom: 30 }}>
              <defs>
                <linearGradient id="nightShade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#4338ca" stopOpacity={0.08} />
                  <stop offset="100%" stopColor="#4338ca" stopOpacity={0.03} />
                </linearGradient>
                <linearGradient id="chargingShade" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#22c55e" stopOpacity={0.15} />
                  <stop offset="100%" stopColor="#22c55e" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="daGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#EA1B0A" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#EA1B0A" stopOpacity={0.02} />
                </linearGradient>
                <linearGradient id="idGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#1EA2B1" stopOpacity={0.2} />
                  <stop offset="95%" stopColor="#1EA2B1" stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.4} />

              {/* Night shading: indices 6-19 (6pm to 7am) */}
              <ReferenceArea x1={6} x2={19} fill="url(#nightShade)" fillOpacity={1} />

              {/* Charging window shading */}
              <ReferenceArea x1={chargeStart} x2={chargeEnd} fill="url(#chargingShade)" fillOpacity={1} />

              {/* Midnight line */}
              <ReferenceLine x={12} stroke="#6b7280" strokeDasharray="4 4" strokeWidth={1}
                label={{ value: '00:00', position: 'top', fill: '#6b7280', fontSize: 10 }}
              />

              <XAxis
                dataKey="hour"
                tick={(props: Record<string, unknown>) => {
                  const x = Number(props.x) || 0
                  const y = Number(props.y) || 0
                  const value = (props.payload as { value: number })?.value ?? 0
                  const d = chartData[value]
                  if (!d) return <g />
                  const show = value % 3 === 0
                  if (!show) return <g />
                  return (
                    <g transform={`translate(${x},${y + 10})`}>
                      <text textAnchor="middle" fill="#6b7280" fontSize={11}>{d.label}</text>
                    </g>
                  )
                }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
              />
              <YAxis
                tick={{ fill: '#6b7280', fontSize: 11 }}
                axisLine={{ stroke: '#e5e7eb' }}
                tickLine={false}
                width={45}
                label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', fontSize: 11 }}
              />

              <Tooltip content={<SourceTooltip chartData={chartData} />} />

              {/* Day-ahead area + line */}
              {showDayAhead && (
                <>
                  <Area
                    type="monotone"
                    dataKey="dayAhead"
                    stroke="none"
                    fill="url(#daGradient)"
                    fillOpacity={1}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="dayAhead"
                    stroke="#EA1B0A"
                    strokeWidth={2.5}
                    dot={false}
                    activeDot={{ r: 5, fill: '#EA1B0A', stroke: '#fff', strokeWidth: 2 }}
                    connectNulls
                    name="Day-Ahead"
                  />
                </>
              )}

              {/* Intraday area + line */}
              {showIntraday && (
                <>
                  <Area
                    type="monotone"
                    dataKey="intraday"
                    stroke="none"
                    fill="url(#idGradient)"
                    fillOpacity={1}
                    connectNulls
                  />
                  <Line
                    type="monotone"
                    dataKey="intraday"
                    stroke="#1EA2B1"
                    strokeWidth={2}
                    strokeDasharray="6 3"
                    dot={false}
                    activeDot={{ r: 4, fill: '#1EA2B1', stroke: '#fff', strokeWidth: 2 }}
                    connectNulls
                    name="Intraday"
                  />
                </>
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {/* Legend */}
          <div className="mt-2 flex flex-wrap items-center justify-center gap-4 text-xs text-muted-foreground">
            {showDayAhead && (
              <div className="flex items-center gap-1.5">
                <div className="h-0.5 w-6 bg-[#EA1B0A]" />
                <span>Day-Ahead (SMARD)</span>
              </div>
            )}
            {showIntraday && (
              <div className="flex items-center gap-1.5">
                <div className="h-0.5 w-6 border-t-2 border-dashed border-[#1EA2B1]" />
                <span>Intraday (CSV)</span>
              </div>
            )}
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-indigo-500/10" />
              <Moon className="h-3 w-3 text-indigo-400" />
              <span>Night (6 PM – 7 AM)</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="h-3 w-6 rounded bg-green-500/15" />
              <Zap className="h-3 w-3 text-green-500" />
              <span>Charging Window</span>
            </div>
          </div>
        </div>

        {/* Charging Session Slider */}
        <div className="rounded-lg border bg-muted/30 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="flex items-center gap-2 text-sm font-semibold">
              <Zap className="h-4 w-4 text-green-600" />
              Charging Session Window
            </h3>
            <Badge className="bg-green-600 text-white">
              {String((12 + chargeStart) % 24).padStart(2, '0')}:00 – {String((12 + chargeEnd) % 24).padStart(2, '0')}:00
              ({chargeEnd - chargeStart}h)
            </Badge>
          </div>

          {/* Visual time bar with slider handles */}
          <div className="relative">
            {/* Time bar background */}
            <div className="flex h-10 w-full overflow-hidden rounded-lg border">
              {chartData.map((d, i) => (
                <div
                  key={i}
                  className={`flex-1 flex items-center justify-center transition-colors ${
                    d.isCharging
                      ? 'bg-green-500/20 dark:bg-green-500/10'
                      : d.isNight
                      ? 'bg-indigo-500/10 dark:bg-indigo-500/5'
                      : 'bg-yellow-50 dark:bg-yellow-950/10'
                  }`}
                  title={`${d.label} ${d.isCharging ? '(Charging)' : ''}`}
                >
                  {i % 6 === 0 && (
                    <span className="text-[9px] text-muted-foreground">{getTimeIcon((12 + i) % 24)}</span>
                  )}
                </div>
              ))}
            </div>

            {/* Start slider */}
            <div className="mt-3 flex items-center gap-4">
              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">Start:</label>
                <input
                  type="range"
                  min={0}
                  max={23}
                  value={chargeStart}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (v < chargeEnd) setChargeStart(v)
                  }}
                  className="h-2 w-32 cursor-pointer accent-green-600"
                />
                <span className="w-12 text-xs font-medium">
                  {String(sliderStartHour).padStart(2, '0')}:00
                </span>
              </div>

              <div className="flex items-center gap-2">
                <label className="text-xs text-muted-foreground whitespace-nowrap">End:</label>
                <input
                  type="range"
                  min={1}
                  max={24}
                  value={chargeEnd}
                  onChange={(e) => {
                    const v = parseInt(e.target.value)
                    if (v > chargeStart) setChargeEnd(v)
                  }}
                  className="h-2 w-32 cursor-pointer accent-green-600"
                />
                <span className="w-12 text-xs font-medium">
                  {String(sliderEndHour).padStart(2, '0')}:00
                </span>
              </div>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

// Custom tooltip with day/night icons
function SourceTooltip({
  active,
  payload,
  chartData,
}: {
  active?: boolean
  payload?: Array<{ payload: ChartDataPoint }>
  chartData: ChartDataPoint[]
}) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  const actualHour = parseInt(d.label)

  return (
    <div className="rounded-lg border bg-white/95 px-3 py-2.5 shadow-lg backdrop-blur-sm dark:bg-neutral-900/95">
      <div className="flex items-center gap-2">
        {d.isNight ? <Moon className="h-4 w-4 text-indigo-400" /> : <Sun className="h-4 w-4 text-yellow-500" />}
        <p className="text-sm font-semibold">{d.label}</p>
        {d.isCharging && (
          <Badge className="bg-green-600 text-[10px] text-white px-1.5 py-0">Charging</Badge>
        )}
      </div>
      <div className="mt-1.5 space-y-0.5 text-xs">
        {d.dayAhead !== null && (
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#EA1B0A]" />
            Day-Ahead: <span className="font-semibold">{d.dayAhead.toFixed(2)} ct/kWh</span>
          </p>
        )}
        {d.intraday !== null && (
          <p className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full bg-[#1EA2B1]" />
            Intraday: <span className="font-semibold">{d.intraday.toFixed(2)} ct/kWh</span>
          </p>
        )}
        {d.spread !== null && (
          <p className="mt-1 border-t pt-1 text-muted-foreground">
            Spread: <span className={`font-semibold ${d.spread > 0 ? 'text-green-600' : 'text-red-600'}`}>
              {d.spread > 0 ? '+' : ''}{d.spread.toFixed(2)} ct
            </span>
          </p>
        )}
      </div>
    </div>
  )
}
