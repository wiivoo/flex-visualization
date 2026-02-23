/**
 * Hook for fetching and managing price data across the v2 flow.
 * Fetches 3 years of hourly prices and derives daily/monthly summaries.
 */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { HourlyPrice, DailySummary, MonthlyStats, GenerationData } from '@/lib/v2-config'

interface PriceData {
  hourly: HourlyPrice[]
  daily: DailySummary[]
  monthly: MonthlyStats[]
  loading: boolean
  error: string | null
  selectedDate: string
  setSelectedDate: (date: string) => void
  selectedDayPrices: HourlyPrice[]
  yearRange: { start: string; end: string }
  generation: GenerationData[]
  generationLoading: boolean
}

function isNightHour(hour: number): boolean {
  return hour >= 22 || hour < 6
}

function deriveDailySummaries(prices: HourlyPrice[]): DailySummary[] {
  const byDate = new Map<string, HourlyPrice[]>()
  for (const p of prices) {
    const arr = byDate.get(p.date) || []
    arr.push(p)
    byDate.set(p.date, arr)
  }

  const summaries: DailySummary[] = []
  for (const [date, dayPrices] of byDate) {
    let min = dayPrices[0].priceEurMwh
    let max = dayPrices[0].priceEurMwh
    let negCount = 0
    let daySum = 0, dayCount = 0
    let nightSum = 0, nightCount = 0
    let priceAt18 = 0
    let cheapestNight = Infinity

    for (const p of dayPrices) {
      if (p.priceEurMwh < min) min = p.priceEurMwh
      if (p.priceEurMwh > max) max = p.priceEurMwh
      if (p.priceEurMwh < 0) negCount++

      // Track 18:00 price (typical EV arrival time)
      if (p.hour === 18) priceAt18 = p.priceEurMwh

      if (isNightHour(p.hour)) {
        nightSum += p.priceEurMwh
        nightCount++
        if (p.priceEurMwh < cheapestNight) cheapestNight = p.priceEurMwh
      } else {
        daySum += p.priceEurMwh
        dayCount++
      }
    }

    const dayAvg = dayCount > 0 ? daySum / dayCount : 0
    const nightAvg = nightCount > 0 ? nightSum / nightCount : 0
    if (cheapestNight === Infinity) cheapestNight = nightAvg

    summaries.push({
      date,
      avgPrice: dayPrices.reduce((s, p) => s + p.priceCtKwh, 0) / dayPrices.length,
      minPrice: min,
      maxPrice: max,
      spread: max - min,
      negativeHours: negCount,
      dayAvgPrice: Math.round(dayAvg * 10) / 10,
      nightAvgPrice: Math.round(nightAvg * 10) / 10,
      dayNightSpread: Math.round((dayAvg - nightAvg) * 10) / 10,
      priceAt18: Math.round(priceAt18 * 10) / 10,
      cheapestNightPrice: Math.round(cheapestNight * 10) / 10,
      nightSpread: Math.round((priceAt18 - cheapestNight) * 10) / 10,
    })
  }
  return summaries.sort((a, b) => a.date.localeCompare(b.date))
}

function deriveMonthlyStats(daily: DailySummary[], hourly: HourlyPrice[]): MonthlyStats[] {
  const byMonth = new Map<string, { spreads: number[]; prices: number[]; negHours: number; totalHours: number; nightSpreads: number[] }>()

  for (const d of daily) {
    const month = d.date.slice(0, 7)
    const entry = byMonth.get(month) || { spreads: [], prices: [], negHours: 0, totalHours: 0, nightSpreads: [] }
    entry.spreads.push(d.spread)
    entry.negHours += d.negativeHours
    entry.nightSpreads.push(d.nightSpread) // 18:00 vs cheapest night
    byMonth.set(month, entry)
  }

  for (const p of hourly) {
    const month = p.date.slice(0, 7)
    const entry = byMonth.get(month)
    if (entry) {
      entry.prices.push(p.priceEurMwh)
      entry.totalHours++
    }
  }

  const stats: MonthlyStats[] = []
  for (const [month, data] of byMonth) {
    const avg = (arr: number[]) => arr.length ? arr.reduce((s, v) => s + v, 0) / arr.length : 0
    stats.push({
      month,
      avgSpread: Math.round(avg(data.spreads) * 10) / 10,
      avgPrice: Math.round(avg(data.prices) * 10) / 10,
      minPrice: data.prices.length ? Math.round(data.prices.reduce((m, v) => v < m ? v : m, data.prices[0]) * 10) / 10 : 0,
      maxPrice: data.prices.length ? Math.round(data.prices.reduce((m, v) => v > m ? v : m, data.prices[0]) * 10) / 10 : 0,
      negativeHours: data.negHours,
      totalHours: data.totalHours,
      avgNightSpread: Math.round(avg(data.nightSpreads) * 10) / 10,
    })
  }
  return stats.sort((a, b) => a.month.localeCompare(b.month))
}

export function usePrices(): PriceData {
  const [hourly, setHourly] = useState<HourlyPrice[]>([])
  const [daily, setDaily] = useState<DailySummary[]>([])
  const [monthly, setMonthly] = useState<MonthlyStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [generation, setGeneration] = useState<GenerationData[]>([])
  const [generationLoading, setGenerationLoading] = useState(false)
  const fetched = useRef(false)

  // Determine date range: last 3 years (stable refs)
  const dateRange = useRef(() => {
    const now = new Date()
    const endDate = now.toISOString().slice(0, 10)
    const startDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()).toISOString().slice(0, 10)
    const year = now.getFullYear()
    return { startDate, endDate, year }
  })
  const { startDate, endDate, year: currentYear } = dateRange.current()

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true

    async function loadPrices() {
      setLoading(true)
      setError(null)

      try {
        const years: HourlyPrice[] = []
        const chunks = [
          { start: startDate, end: `${currentYear - 2}-12-31` },
          { start: `${currentYear - 1}-01-01`, end: `${currentYear - 1}-12-31` },
          { start: `${currentYear}-01-01`, end: endDate },
        ]

        const results = await Promise.allSettled(
          chunks.map(async (chunk) => {
            const res = await fetch(`/api/prices/bulk?start=${chunk.start}&end=${chunk.end}`)
            if (!res.ok) throw new Error(`API ${res.status}`)
            const json = await res.json()
            return json.prices as { timestamp: number; priceEurMwh: number; priceCtKwh: number }[]
          })
        )

        for (const result of results) {
          if (result.status === 'fulfilled' && result.value) {
            for (const p of result.value) {
              const d = new Date(p.timestamp)
              // Use local time consistently for both hour and date
              const localYear = d.getFullYear()
              const localMonth = String(d.getMonth() + 1).padStart(2, '0')
              const localDay = String(d.getDate()).padStart(2, '0')
              years.push({
                timestamp: p.timestamp,
                priceEurMwh: p.priceEurMwh,
                priceCtKwh: p.priceCtKwh,
                hour: d.getHours(),
                date: `${localYear}-${localMonth}-${localDay}`,
              })
            }
          }
        }

        years.sort((a, b) => a.timestamp - b.timestamp)
        setHourly(years)

        const dailySummaries = deriveDailySummaries(years)
        setDaily(dailySummaries)

        const monthlyStats = deriveMonthlyStats(dailySummaries, years)
        setMonthly(monthlyStats)

        // Default to most recent date with data
        if (dailySummaries.length > 0) {
          setSelectedDate(dailySummaries[dailySummaries.length - 1].date)
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load prices')
      } finally {
        setLoading(false)
      }
    }

    loadPrices()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Fetch generation data when selected date changes
  const fetchGeneration = useCallback(async (date: string) => {
    if (!date) return
    setGenerationLoading(true)
    try {
      const res = await fetch(`/api/generation?date=${date}`)
      if (res.ok) {
        const json = await res.json()
        setGeneration(json.hourly || [])
      } else {
        setGeneration([])
      }
    } catch {
      setGeneration([])
    } finally {
      setGenerationLoading(false)
    }
  }, [])

  useEffect(() => {
    if (selectedDate) fetchGeneration(selectedDate)
  }, [selectedDate, fetchGeneration])

  const selectedDayPrices = useMemo(
    () => hourly.filter(p => p.date === selectedDate),
    [hourly, selectedDate]
  )

  return {
    hourly,
    daily,
    monthly,
    loading,
    error,
    selectedDate,
    setSelectedDate,
    selectedDayPrices,
    yearRange: { start: startDate, end: endDate },
    generation,
    generationLoading,
  }
}
