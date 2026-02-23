/**
 * Hook for fetching and managing price data across the v2 flow.
 * Loads pre-downloaded SMARD data from static JSON files.
 * Falls back to API for any data not in the static files.
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

/** Compact format from static JSON: { t: timestamp, p: priceEurMwh } */
interface CompactPrice { t: number; p: number }
/** Compact generation: { t: timestamp, s: solarMW, w: windMW, l: loadMW } */
interface CompactGen { t: number; s: number; w: number; l: number }

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
  const generationCache = useRef<Map<string, GenerationData[]>>(new Map())
  const allGeneration = useRef<CompactGen[]>([])

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true

    async function loadData() {
      setLoading(true)
      setError(null)

      try {
        // Load both static files in parallel
        const [priceRes, genRes] = await Promise.allSettled([
          fetch('/data/smard-prices.json'),
          fetch('/data/smard-generation.json'),
        ])

        // Parse prices
        let rawPrices: CompactPrice[] = []
        if (priceRes.status === 'fulfilled' && priceRes.value.ok) {
          rawPrices = await priceRes.value.json()
        }

        // Parse generation (keep in ref for on-demand day lookups)
        if (genRes.status === 'fulfilled' && genRes.value.ok) {
          allGeneration.current = await genRes.value.json()
        }

        if (rawPrices.length === 0) {
          throw new Error('No price data available. Run: node scripts/download-smard.mjs')
        }

        // Convert compact format to HourlyPrice
        const prices: HourlyPrice[] = rawPrices.map(p => {
          const d = new Date(p.t)
          const localYear = d.getFullYear()
          const localMonth = String(d.getMonth() + 1).padStart(2, '0')
          const localDay = String(d.getDate()).padStart(2, '0')
          return {
            timestamp: p.t,
            priceEurMwh: p.p,
            priceCtKwh: Math.round((p.p / 10) * 100) / 100,
            hour: d.getHours(),
            date: `${localYear}-${localMonth}-${localDay}`,
          }
        })

        setHourly(prices)

        const dailySummaries = deriveDailySummaries(prices)
        setDaily(dailySummaries)

        const monthlyStats = deriveMonthlyStats(dailySummaries, prices)
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

    loadData()
  }, [])

  // Get generation data for selected day from the pre-loaded dataset
  const loadGenerationForDate = useCallback((date: string) => {
    if (!date) return

    // Check cache
    if (generationCache.current.has(date)) {
      setGeneration(generationCache.current.get(date)!)
      return
    }

    setGenerationLoading(true)

    // Filter from pre-loaded data
    const gen = allGeneration.current
    if (gen.length > 0) {
      const startOfDay = new Date(date + 'T00:00:00').getTime()
      const endOfDay = new Date(date + 'T23:59:59').getTime()

      const dayGen: GenerationData[] = []
      for (const g of gen) {
        if (g.t >= startOfDay && g.t <= endOfDay) {
          const d = new Date(g.t)
          const renewableMw = g.s + g.w
          const loadMw = g.l || 1
          dayGen.push({
            timestamp: g.t,
            hour: d.getHours(),
            solarMw: g.s,
            windMw: g.w,
            loadMw: g.l,
            renewableMw,
            renewableShare: loadMw > 0 ? Math.round((renewableMw / loadMw) * 1000) / 10 : 0,
          })
        }
      }

      generationCache.current.set(date, dayGen)
      setGeneration(dayGen)
      setGenerationLoading(false)
    } else {
      // Fallback: fetch from API if static data not available
      fetch(`/api/generation?date=${date}`)
        .then(res => res.ok ? res.json() : { hourly: [] })
        .then(json => {
          const data = json.hourly || []
          generationCache.current.set(date, data)
          setGeneration(data)
        })
        .catch(() => setGeneration([]))
        .finally(() => setGenerationLoading(false))
    }
  }, [])

  useEffect(() => {
    if (selectedDate) loadGenerationForDate(selectedDate)
  }, [selectedDate, loadGenerationForDate])

  const selectedDayPrices = useMemo(
    () => hourly.filter(p => p.date === selectedDate),
    [hourly, selectedDate]
  )

  // Compute year range from actual data
  const yearRange = useMemo(() => {
    if (hourly.length === 0) return { start: '', end: '' }
    const first = new Date(hourly[0].timestamp)
    const last = new Date(hourly[hourly.length - 1].timestamp)
    return {
      start: `${first.getFullYear()}-${String(first.getMonth() + 1).padStart(2, '0')}-${String(first.getDate()).padStart(2, '0')}`,
      end: `${last.getFullYear()}-${String(last.getMonth() + 1).padStart(2, '0')}-${String(last.getDate()).padStart(2, '0')}`,
    }
  }, [hourly])

  return {
    hourly,
    daily,
    monthly,
    loading,
    error,
    selectedDate,
    setSelectedDate,
    selectedDayPrices,
    yearRange,
    generation,
    generationLoading,
  }
}
