'use client'

import Link from 'next/link'
import { type ReactNode, useEffect, useMemo, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { ArrowRight, Clock3, Gauge, LineChart, MapPinned, TrendingUp, Zap } from 'lucide-react'

import { DateStrip } from '@/components/v2/DateStrip'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import {
  estimateFlexSessionValue,
  estimateFlexValue,
  getAvailableCalculatorYears,
  type CalculatorMode,
  type FlexCalculatorResult,
  type FlexCalculatorScenario,
} from '@/lib/flex-calculator'
import { usePrices, type PriceData } from '@/lib/use-prices'
import { cn } from '@/lib/utils'
import { getPriceUnits, type HourlyPrice } from '@/lib/v2-config'

type Country = 'DE' | 'NL' | 'GB'
type AnnualBasis = 'hourly' | 'subhour'

interface CalculatorState {
  yearlyMileageKm: number
  plugInsPerWeek: number
  plugInTime: number
  departureTime: number
  chargingMode: CalculatorMode
  chargePowerKw: number
  country: Country
  year: number
  annualBasis: AnnualBasis
}

const COUNTRY_OPTIONS: Array<{ id: Country; label: string; detail: string }> = [
  { id: 'DE', label: 'Germany', detail: 'SMARD day-ahead history' },
  { id: 'NL', label: 'Netherlands', detail: 'ENTSO-E / NL tariff view' },
  { id: 'GB', label: 'Great Britain', detail: 'EPEX GB day-ahead history' },
]

const MODE_OPTIONS: Array<{ id: CalculatorMode; label: string; detail: string }> = [
  { id: 'overnight', label: 'Overnight', detail: 'Evening arrival, next-morning departure' },
  { id: 'fullday', label: 'Full day', detail: 'One extra day of flexibility' },
  { id: 'threeday', label: 'Three day', detail: 'Long parking window, deeper spread capture' },
]

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function parseCountry(raw: string | null): Country {
  return raw === 'NL' || raw === 'GB' ? raw : 'DE'
}

function parseMode(raw: string | null): CalculatorMode {
  return raw === 'fullday' || raw === 'threeday' ? raw : 'overnight'
}

function parseAnnualBasis(raw: string | null): AnnualBasis {
  return raw === 'subhour' ? 'subhour' : 'hourly'
}

function parseState(params: URLSearchParams): CalculatorState {
  const year = Number(params.get('year'))
  return {
    yearlyMileageKm: clamp(Number(params.get('mileage')) || 12000, 5000, 40000),
    plugInsPerWeek: clamp(Number(params.get('plugins')) || 2, 1, 7),
    plugInTime: clamp(Number(params.get('arrival')) || 18, 14, 23),
    departureTime: clamp(Number(params.get('departure')) || 7, 5, 10),
    chargingMode: parseMode(params.get('mode')),
    chargePowerKw: Number(params.get('power')) === 11 ? 11 : 7,
    country: parseCountry(params.get('country')),
    year: Number.isFinite(year) && year >= 2020 ? year : 0,
    annualBasis: parseAnnualBasis(params.get('basis')),
  }
}

function formatHour(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

function formatMonth(month: string): string {
  const [year, mm] = month.split('-')
  return new Date(Number(year), Number(mm) - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })
}

function splitWeeklyPlugIns(plugInsPerWeek: number): { weekdayPlugIns: number; weekendPlugIns: number } {
  return {
    weekdayPlugIns: Math.min(plugInsPerWeek, 5),
    weekendPlugIns: Math.max(0, plugInsPerWeek - 5),
  }
}

function getSubhourSeries(prices: PriceData, country: Country): HourlyPrice[] {
  if (country === 'GB') {
    return prices.hourlyQH.filter((point) => ((point.minute ?? 0) % 30) === 0)
  }
  return prices.hourlyQH
}

function getSlotMinutes(basis: AnnualBasis, country: Country): number {
  if (basis === 'subhour') return country === 'GB' ? 30 : 15
  return 60
}

function PillButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: ReactNode
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-full border px-3 py-1.5 text-[12px] font-semibold transition-colors',
        active ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:border-gray-300',
      )}
    >
      {children}
    </button>
  )
}

function OptionCard({
  active,
  title,
  detail,
  onClick,
}: {
  active: boolean
  title: string
  detail: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'rounded-2xl border p-4 text-left transition-all',
        active
          ? 'border-gray-900 bg-gray-900 text-white shadow-[0_10px_24px_rgba(0,0,0,0.10)]'
          : 'border-gray-200 bg-white text-gray-900 hover:-translate-y-0.5 hover:border-gray-300 hover:shadow-[0_10px_24px_rgba(0,0,0,0.05)]',
      )}
    >
      <p className="text-[14px] font-semibold">{title}</p>
      <p className={cn('mt-1 text-[12px] leading-5', active ? 'text-gray-200' : 'text-gray-500')}>{detail}</p>
    </button>
  )
}

function ControlBlock({
  label,
  value,
  icon,
  children,
}: {
  label: string
  value?: string
  icon?: ReactNode
  children: ReactNode
}) {
  return (
    <Card className="rounded-[24px] border-gray-200 shadow-sm">
      <CardContent className="p-5">
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">{label}</p>
            {value ? <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900">{value}</p> : null}
          </div>
          {icon}
        </div>
        {children}
      </CardContent>
    </Card>
  )
}

export function FlexValueCalculator() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const initialState = useMemo(() => parseState(searchParams), [searchParams])
  const [initialUrlDate] = useState(() => searchParams.get('date'))
  const [state, setState] = useState<CalculatorState>(initialState)

  useEffect(() => {
    setState(initialState)
  }, [initialState])

  const prices = usePrices(state.country)
  const units = getPriceUnits(state.country)
  const selectedDate = prices.selectedDate
  const setSelectedDate = prices.setSelectedDate
  const subhourSeries = useMemo(() => getSubhourSeries(prices, state.country), [prices, state.country])
  const hasSubhourData = subhourSeries.length > 0
  const annualSeries = state.annualBasis === 'subhour' && hasSubhourData ? subhourSeries : prices.hourly
  const annualSlotMinutes = getSlotMinutes(state.annualBasis === 'subhour' && hasSubhourData ? 'subhour' : 'hourly', state.country)

  const availableYears = useMemo(
    () => getAvailableCalculatorYears(annualSeries, prices.lastRealDate),
    [annualSeries, prices.lastRealDate],
  )

  useEffect(() => {
    if (!hasSubhourData && state.annualBasis === 'subhour') {
      setState((current) => ({ ...current, annualBasis: 'hourly' }))
    }
  }, [hasSubhourData, state.annualBasis])

  useEffect(() => {
    if (availableYears.length === 0) return
    if (availableYears.includes(state.year)) return
    setState((current) => ({ ...current, year: availableYears[0] }))
  }, [availableYears, state.year])

  const yearDates = useMemo(() => {
    const allDates = new Set(prices.daily.map((day) => day.date))
    return prices.daily
      .filter((day) => day.date.slice(0, 4) === String(state.year))
      .filter((day) => !prices.lastRealDate || day.date <= prices.lastRealDate)
      .filter((day) => {
        const next = new Date(day.date + 'T12:00:00Z')
        next.setUTCDate(next.getUTCDate() + 1)
        return allDates.has(next.toISOString().slice(0, 10))
      })
      .sort((a, b) => a.date.localeCompare(b.date))
  }, [prices.daily, prices.lastRealDate, state.year])

  useEffect(() => {
    if (!initialUrlDate || yearDates.length === 0) return
    if (!yearDates.some((day) => day.date === initialUrlDate)) return
    if (selectedDate === initialUrlDate) return
    setSelectedDate(initialUrlDate)
  }, [initialUrlDate, selectedDate, setSelectedDate, yearDates])

  useEffect(() => {
    const latestDate = yearDates[yearDates.length - 1]?.date
    if (!latestDate) return
    if (selectedDate && yearDates.some((day) => day.date === selectedDate)) return
    setSelectedDate(latestDate)
  }, [selectedDate, setSelectedDate, yearDates])

  useEffect(() => {
    const params = new URLSearchParams()
    params.set('country', state.country)
    params.set('year', String(state.year))
    params.set('mileage', String(Math.round(state.yearlyMileageKm)))
    params.set('plugins', String(state.plugInsPerWeek))
    params.set('arrival', String(state.plugInTime))
    params.set('departure', String(state.departureTime))
    params.set('mode', state.chargingMode)
    params.set('power', String(state.chargePowerKw))
    params.set('basis', state.annualBasis)
    if (selectedDate) params.set('date', selectedDate)
    router.replace(`/v2/calculator?${params.toString()}`, { scroll: false })
  }, [router, selectedDate, state])

  const scenario = useMemo<FlexCalculatorScenario>(() => ({
    yearlyMileageKm: state.yearlyMileageKm,
    plugInsPerWeek: state.plugInsPerWeek,
    plugInTime: state.plugInTime,
    departureTime: state.departureTime,
    chargingMode: state.chargingMode,
    chargePowerKw: state.chargePowerKw,
  }), [state])

  const currentResult = useMemo(
    () => state.year ? estimateFlexValue(annualSeries, scenario, state.year, prices.lastRealDate, annualSlotMinutes) : null,
    [annualSeries, annualSlotMinutes, prices.lastRealDate, scenario, state.year],
  )

  const comparisonResults = useMemo(() => {
    return availableYears
      .map((year) => ({
        year,
        result: estimateFlexValue(annualSeries, scenario, year, prices.lastRealDate, annualSlotMinutes),
      }))
      .filter((entry): entry is { year: number; result: FlexCalculatorResult } => Boolean(entry.result))
      .sort((a, b) => a.year - b.year)
  }, [annualSeries, annualSlotMinutes, availableYears, prices.lastRealDate, scenario])

  const maxComparisonValue = Math.max(...comparisonResults.map((entry) => entry.result.annualSavingsEur), 1)

  const spotCheckHourly = useMemo(
    () => estimateFlexSessionValue(prices.hourly, scenario, selectedDate, 60),
    [prices.hourly, scenario, selectedDate],
  )
  const spotCheckSubhour = useMemo(
    () => hasSubhourData ? estimateFlexSessionValue(subhourSeries, scenario, selectedDate, getSlotMinutes('subhour', state.country)) : null,
    [hasSubhourData, scenario, selectedDate, state.country, subhourSeries],
  )
  const spotCheckIntraday = useMemo(
    () => prices.intradayId3.length > 0 ? estimateFlexSessionValue(prices.intradayId3, scenario, selectedDate, 15) : null,
    [prices.intradayId3, scenario, selectedDate],
  )

  const v2Link = useMemo(() => {
    const split = splitWeeklyPlugIns(state.plugInsPerWeek)
    const params = new URLSearchParams()
    params.set('country', state.country)
    params.set('mileage', String(Math.round(state.yearlyMileageKm)))
    params.set('plugins_wd', String(split.weekdayPlugIns))
    params.set('plugins_we', String(split.weekendPlugIns))
    params.set('plugin_time', String(state.plugInTime))
    params.set('departure', String(state.departureTime))
    params.set('mode', state.chargingMode)
    if (state.chargePowerKw !== 7) params.set('power', String(state.chargePowerKw))
    if (state.annualBasis === 'subhour' && hasSubhourData) params.set('resolution', 'quarterhour')
    if (selectedDate) params.set('date', selectedDate)
    return `/v2?${params.toString()}`
  }, [hasSubhourData, selectedDate, state])

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      <header className="border-b border-gray-200 bg-white">
        <div className="mx-auto flex max-w-[1440px] items-center justify-between px-8 py-2">
          <h1 className="text-sm font-semibold text-gray-400">EV Flex Charging - Load Shifting Visualization</h1>
          <nav className="flex items-center gap-2">
            <Link
              href="/v2"
              className="rounded-full px-2.5 py-1 text-[11px] font-semibold text-gray-400 transition-colors hover:text-gray-600"
            >
              Main analysis
            </Link>
            <span className="rounded-full bg-[#313131] px-2.5 py-1 text-[11px] font-semibold text-white">
              Interactive calculator
            </span>
          </nav>
        </div>
      </header>

      <main className="mx-auto max-w-[1440px] px-8 py-6">
        <div className="mb-6 flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="max-w-[760px]">
            <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Fast flex value estimate</p>
            <h2 className="mt-2 text-4xl font-semibold tracking-tight text-gray-900">Interactive EV flexibility calculator</h2>
            <p className="mt-3 text-[15px] leading-7 text-gray-500">
              Same pricing foundation as <Link href="/v2" className="font-semibold text-gray-700 hover:text-gray-900">/v2</Link>, but compressed into a calculator surface:
              live inputs on the left, commercial output on the right, plus subhour and intraday checks where the data exists.
            </p>
          </div>
          <Button asChild className="w-fit rounded-full bg-[#313131] hover:bg-[#1f1f1f]">
            <Link href={v2Link}>
              Open full scenario in /v2
              <ArrowRight className="h-4 w-4" />
            </Link>
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-5 lg:grid-cols-[360px_minmax(0,1fr)]">
          <aside className="space-y-4 lg:sticky lg:top-20 lg:self-start">
            <ControlBlock label="Country and year" value={state.year ? `${state.country} - ${state.year}` : state.country} icon={<MapPinned className="h-5 w-5 text-gray-400" />}>
              <div className="space-y-4">
                <div className="grid gap-2">
                  {COUNTRY_OPTIONS.map((option) => (
                    <OptionCard
                      key={option.id}
                      active={state.country === option.id}
                      title={option.label}
                      detail={option.detail}
                      onClick={() => setState((current) => ({ ...current, country: option.id }))}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {availableYears.map((year) => (
                    <PillButton key={year} active={state.year === year} onClick={() => setState((current) => ({ ...current, year }))}>
                      {year}
                    </PillButton>
                  ))}
                  {availableYears.length === 0 ? <span className="text-sm text-gray-400">{prices.loading ? 'Loading years...' : 'No years found'}</span> : null}
                </div>
              </div>
            </ControlBlock>

            <ControlBlock label="Annual market basis" value={state.annualBasis === 'subhour' && hasSubhourData ? `${annualSlotMinutes} min day-ahead` : 'Hourly day-ahead'} icon={<Zap className="h-5 w-5 text-gray-400" />}>
              <div className="grid gap-2">
                <OptionCard
                  active={state.annualBasis === 'hourly'}
                  title="Hourly day-ahead"
                  detail="Fastest baseline using the main yearly historical files."
                  onClick={() => setState((current) => ({ ...current, annualBasis: 'hourly' }))}
                />
                <OptionCard
                  active={state.annualBasis === 'subhour' && hasSubhourData}
                  title={state.country === 'GB' ? '30-minute day-ahead' : '15-minute day-ahead'}
                  detail={hasSubhourData ? 'Uses the higher-resolution pricing history already available in the repo.' : 'No subhour history available for the selected market yet.'}
                  onClick={() => hasSubhourData && setState((current) => ({ ...current, annualBasis: 'subhour' }))}
                />
              </div>
            </ControlBlock>

            <ControlBlock label="Mileage" value={`${Math.round(state.yearlyMileageKm).toLocaleString()} km`} icon={<Gauge className="h-5 w-5 text-gray-400" />}>
              <input
                type="range"
                min={5000}
                max={40000}
                step={500}
                value={state.yearlyMileageKm}
                onChange={(event) => setState((current) => ({ ...current, yearlyMileageKm: Number(event.target.value) }))}
                className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900"
              />
              <div className="mt-2 flex justify-between text-[12px] text-gray-400">
                <span>5,000</span>
                <span>40,000</span>
              </div>
            </ControlBlock>

            <ControlBlock label="Charging frequency" value={`${state.plugInsPerWeek} sessions / week`} icon={<TrendingUp className="h-5 w-5 text-gray-400" />}>
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((value) => (
                  <PillButton key={value} active={state.plugInsPerWeek === value} onClick={() => setState((current) => ({ ...current, plugInsPerWeek: value }))}>
                    {value}x / wk
                  </PillButton>
                ))}
              </div>
            </ControlBlock>

            <ControlBlock label="Charging window" value={`${formatHour(state.plugInTime)} -> ${formatHour(state.departureTime)}`} icon={<Clock3 className="h-5 w-5 text-gray-400" />}>
              <div className="space-y-5">
                <div>
                  <div className="mb-2 flex items-center justify-between text-[12px] text-gray-500">
                    <span>Arrival</span>
                    <span>{formatHour(state.plugInTime)}</span>
                  </div>
                  <input
                    type="range"
                    min={14}
                    max={23}
                    step={1}
                    value={state.plugInTime}
                    onChange={(event) => setState((current) => ({ ...current, plugInTime: Number(event.target.value) }))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900"
                  />
                </div>
                <div>
                  <div className="mb-2 flex items-center justify-between text-[12px] text-gray-500">
                    <span>Departure</span>
                    <span>{formatHour(state.departureTime)}</span>
                  </div>
                  <input
                    type="range"
                    min={5}
                    max={10}
                    step={1}
                    value={state.departureTime}
                    onChange={(event) => setState((current) => ({ ...current, departureTime: Number(event.target.value) }))}
                    className="h-2 w-full cursor-pointer appearance-none rounded-full bg-gray-200 accent-gray-900"
                  />
                </div>
                <div className="grid gap-2">
                  {MODE_OPTIONS.map((option) => (
                    <OptionCard
                      key={option.id}
                      active={state.chargingMode === option.id}
                      title={option.label}
                      detail={option.detail}
                      onClick={() => setState((current) => ({ ...current, chargingMode: option.id }))}
                    />
                  ))}
                </div>
                <div className="flex flex-wrap gap-2">
                  {[7, 11].map((power) => (
                    <PillButton key={power} active={state.chargePowerKw === power} onClick={() => setState((current) => ({ ...current, chargePowerKw: power }))}>
                      {power} kW wallbox
                    </PillButton>
                  ))}
                </div>
              </div>
            </ControlBlock>
          </aside>

          <section className="space-y-5">
            {prices.loading ? (
              <Card className="rounded-[28px] border-gray-200 shadow-sm">
                <CardContent className="p-8">
                  <p className="text-sm text-gray-500">Loading historical price data...</p>
                </CardContent>
              </Card>
            ) : currentResult ? (
              <>
                <Card className="overflow-hidden rounded-[28px] border-gray-200 shadow-sm">
                  <CardContent className="grid gap-0 p-0 xl:grid-cols-[1.1fr_0.9fr]">
                    <div className="border-b border-gray-200 bg-white p-8 xl:border-b-0 xl:border-r">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Estimated annual value</p>
                      <div className="mt-5 flex items-end gap-3">
                        <span className="text-5xl font-semibold tracking-tight text-gray-900">
                          {units.currencySym}{Math.round(currentResult.annualSavingsEur).toLocaleString()}
                        </span>
                        <span className="pb-2 text-sm font-medium text-emerald-700">per EV / year</span>
                      </div>
                      <p className="mt-4 max-w-[560px] text-[15px] leading-7 text-gray-500">
                        This estimate uses {state.year} {state.country} {currentResult.slotMinutes === 60 ? 'hourly' : `${currentResult.slotMinutes}-minute`} day-ahead prices,
                        then compares immediate charging versus optimized charging across {currentResult.sampleDays} sampled windows with your selected rhythm and time window.
                      </p>
                      <div className="mt-7 grid gap-4 sm:grid-cols-3">
                        <div className="rounded-2xl bg-[#F5F5F2] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Per session</p>
                          <p className="mt-2 text-2xl font-semibold text-gray-900">{units.currencySym}{currentResult.avgSavingsPerSessionEur}</p>
                        </div>
                        <div className="rounded-2xl bg-[#F5F5F2] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Energy / session</p>
                          <p className="mt-2 text-2xl font-semibold text-gray-900">{currentResult.energyPerSessionKwh} kWh</p>
                        </div>
                        <div className="rounded-2xl bg-[#F5F5F2] p-4">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Savings rate</p>
                          <p className="mt-2 text-2xl font-semibold text-gray-900">{currentResult.savingsPct}%</p>
                        </div>
                      </div>
                    </div>

                    <div className="bg-[#FBFBF8] p-8">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Calculation basis</p>
                      <div className="mt-5 space-y-4 text-sm text-gray-600">
                        <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                          <span>Baseline annual charging cost</span>
                          <span className="font-semibold text-gray-900">{units.currencySym}{Math.round(currentResult.baselineAnnualCostEur)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                          <span>Optimized annual charging cost</span>
                          <span className="font-semibold text-gray-900">{units.currencySym}{Math.round(currentResult.optimizedAnnualCostEur)}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                          <span>Average baseline price</span>
                          <span className="font-semibold text-gray-900">{currentResult.avgBaselinePriceCtKwh} {units.priceUnit}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4 border-b border-gray-200 pb-4">
                          <span>Average optimized price</span>
                          <span className="font-semibold text-gray-900">{currentResult.avgOptimizedPriceCtKwh} {units.priceUnit}</span>
                        </div>
                        <div className="flex items-center justify-between gap-4">
                          <span>Captured spread</span>
                          <span className="font-semibold text-gray-900">{currentResult.avgCapturedSpreadCtKwh} {units.priceUnit}</span>
                        </div>
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card className="overflow-hidden rounded-[24px] border-gray-200 shadow-sm">
                  <CardContent className="p-0">
                    <div className="border-b border-gray-200 px-6 py-5">
                      <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Selected-day market check</p>
                      <p className="mt-1 text-sm text-gray-500">
                        Pick a day from {state.year} and compare the same charging session across hourly day-ahead, subhour day-ahead, and intraday ID3 when available.
                      </p>
                    </div>
                    <div className="px-4 py-3">
                        <DateStrip
                          daily={yearDates}
                          selectedDate={selectedDate}
                          onSelect={setSelectedDate}
                          latestDate={yearDates[yearDates.length - 1]?.date}
                        requireNextDay
                        forecastAfter={prices.lastRealDate || undefined}
                        country={state.country}
                      />
                    </div>
                    <div className="grid gap-4 border-t border-gray-200 p-6 lg:grid-cols-3">
                      <Card className="rounded-[20px] border-gray-200 shadow-none">
                        <CardContent className="p-5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Hourly day-ahead</p>
                          <p className="mt-3 text-2xl font-semibold text-gray-900">
                            {spotCheckHourly ? `${units.currencySym}${spotCheckHourly.savingsPerSessionEur}` : '—'}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-gray-500">
                            {spotCheckHourly
                              ? `${spotCheckHourly.capturedSpreadCtKwh} ${units.priceUnit} captured spread, ${spotCheckHourly.baselineAvgCtKwh} -> ${spotCheckHourly.optimizedAvgCtKwh} ${units.priceUnit}.`
                              : 'Not enough complete data for this selected window.'}
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="rounded-[20px] border-gray-200 shadow-none">
                        <CardContent className="p-5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">
                            {state.country === 'GB' ? '30-minute day-ahead' : '15-minute day-ahead'}
                          </p>
                          <p className="mt-3 text-2xl font-semibold text-gray-900">
                            {spotCheckSubhour ? `${units.currencySym}${spotCheckSubhour.savingsPerSessionEur}` : '—'}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-gray-500">
                            {spotCheckSubhour
                              ? `${spotCheckSubhour.capturedSpreadCtKwh} ${units.priceUnit} captured spread using higher-resolution price slots.`
                              : hasSubhourData
                                ? 'Not enough complete subhour data for this selected window.'
                                : 'No higher-resolution day-ahead series available for this market.'}
                          </p>
                        </CardContent>
                      </Card>

                      <Card className="rounded-[20px] border-gray-200 shadow-none">
                        <CardContent className="p-5">
                          <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gray-400">Intraday ID3 spot check</p>
                          <p className="mt-3 text-2xl font-semibold text-gray-900">
                            {spotCheckIntraday ? `${units.currencySym}${spotCheckIntraday.savingsPerSessionEur}` : '—'}
                          </p>
                          <p className="mt-2 text-sm leading-6 text-gray-500">
                            {spotCheckIntraday
                              ? `${spotCheckIntraday.capturedSpreadCtKwh} ${units.priceUnit} captured spread on the currently selected trading day.`
                              : 'Intraday pricing is currently used as a selected-day spot check rather than a full-year annualized series.'}
                          </p>
                        </CardContent>
                      </Card>
                    </div>
                  </CardContent>
                </Card>

                <div className="grid gap-5 xl:grid-cols-[1.1fr_0.9fr]">
                  <Card className="rounded-[24px] border-gray-200 shadow-sm">
                    <CardContent className="p-6">
                      <div className="mb-5 flex items-center justify-between gap-3">
                        <div>
                          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Historical year comparison</p>
                          <p className="mt-1 text-sm text-gray-500">Same profile, recomputed across all real price years in the selected annual basis.</p>
                        </div>
                        <LineChart className="h-5 w-5 text-gray-400" />
                      </div>
                      <div className="space-y-3">
                        {comparisonResults.map((entry) => (
                          <div key={entry.year} className="grid grid-cols-[56px_minmax(0,1fr)_88px] items-center gap-3">
                            <span className={cn('text-sm font-medium', entry.year === state.year ? 'text-gray-900' : 'text-gray-500')}>
                              {entry.year}
                            </span>
                            <div className="h-2 overflow-hidden rounded-full bg-gray-100">
                              <div
                                className={cn('h-full rounded-full', entry.year === state.year ? 'bg-gray-900' : 'bg-gray-300')}
                                style={{ width: `${Math.max((entry.result.annualSavingsEur / maxComparisonValue) * 100, 6)}%` }}
                              />
                            </div>
                            <span className={cn('text-right text-sm font-semibold', entry.year === state.year ? 'text-gray-900' : 'text-gray-500')}>
                              {units.currencySym}{Math.round(entry.result.annualSavingsEur)}
                            </span>
                          </div>
                        ))}
                      </div>
                    </CardContent>
                  </Card>

                  <div className="space-y-5">
                    <Card className="rounded-[24px] border-gray-200 shadow-sm">
                      <CardContent className="p-6">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Strongest month</p>
                        <p className="mt-3 text-2xl font-semibold text-gray-900">
                          {currentResult.bestMonth ? formatMonth(currentResult.bestMonth.month) : 'No month found'}
                        </p>
                        <p className="mt-2 text-sm leading-6 text-gray-500">
                          {currentResult.bestMonth
                            ? `${units.currencySym}${currentResult.bestMonth.avgSavingsPerSessionEur} average session value in the strongest month.`
                            : 'The filtered market sample did not produce a strong monthly signal.'}
                        </p>
                      </CardContent>
                    </Card>

                    <Card className="rounded-[24px] border-gray-200 shadow-sm">
                      <CardContent className="p-6">
                        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">Data window</p>
                        <p className="mt-3 text-2xl font-semibold text-gray-900">{currentResult.sampleDays} sampled days</p>
                        <p className="mt-2 text-sm leading-6 text-gray-500">
                          Built from real price history between {currentResult.sampleStart} and {currentResult.sampleEnd}, then annualized with {currentResult.sessionsPerYear} sessions per year.
                        </p>
                      </CardContent>
                    </Card>
                  </div>
                </div>

                <Card className="rounded-[24px] border-gray-200 shadow-sm">
                  <CardContent className="p-6">
                    <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-gray-400">How the existing price data is being leveraged</p>
                    <div className="mt-4 grid gap-4 lg:grid-cols-3">
                      <div className="rounded-2xl bg-[#F5F5F2] p-4">
                        <p className="text-sm font-semibold text-gray-900">1. Live year replay</p>
                        <p className="mt-1 text-[13px] leading-6 text-gray-500">The calculator now recomputes the same EV profile across all historical years, so users can see volatility and timing sensitivity immediately.</p>
                      </div>
                      <div className="rounded-2xl bg-[#F5F5F2] p-4">
                        <p className="text-sm font-semibold text-gray-900">2. Subhour and intraday layers</p>
                        <p className="mt-1 text-[13px] leading-6 text-gray-500">Higher-resolution day-ahead series are now usable as an annual basis, and intraday ID3 is surfaced as a selected-day spot check to show possible uplift.</p>
                      </div>
                      <div className="rounded-2xl bg-[#F5F5F2] p-4">
                        <p className="text-sm font-semibold text-gray-900">3. Direct handoff into /v2</p>
                        <p className="mt-1 text-[13px] leading-6 text-gray-500">The call to action now carries date, window, charging rhythm, country, and high-resolution mode straight into `/v2` for the deeper analysis view.</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card className="rounded-[24px] border-amber-200 bg-amber-50 shadow-sm">
                <CardContent className="p-6">
                  <p className="text-sm font-medium text-amber-900">No complete estimate could be built for this combination.</p>
                  <p className="mt-2 text-sm leading-6 text-amber-800">
                    Try a different year or a shorter charging window so the calculator can find enough real pricing windows to annualize.
                  </p>
                </CardContent>
              </Card>
            )}
          </section>
        </div>
      </main>
    </div>
  )
}
