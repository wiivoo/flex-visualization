/**
 * Hook for fetching and managing price data across the v2 flow.
 * Fetches 3 years of hourly prices and derives daily/monthly summaries.
 */
'use client'

import { useState, useEffect, useRef } from 'react'
import type { HourlyPrice, DailySummary, MonthlyStats } from '@/lib/v2-config'

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
    const eurMwhPrices = dayPrices.map(p => p.priceEurMwh)
    const min = Math.min(...eurMwhPrices)
    const max = Math.max(...eurMwhPrices)
    summaries.push({
      date,
      avgPrice: dayPrices.reduce((s, p) => s + p.priceCtKwh, 0) / dayPrices.length,
      minPrice: min,
      maxPrice: max,
      spread: max - min,
      negativeHours: dayPrices.filter(p => p.priceEurMwh < 0).length,
    })
  }
  return summaries.sort((a, b) => a.date.localeCompare(b.date))
}

function deriveMonthlyStats(daily: DailySummary[], hourly: HourlyPrice[]): MonthlyStats[] {
  const byMonth = new Map<string, { spreads: number[]; prices: number[]; negHours: number; totalHours: number }>()

  for (const d of daily) {
    const month = d.date.slice(0, 7)
    const entry = byMonth.get(month) || { spreads: [], prices: [], negHours: 0, totalHours: 0 }
    entry.spreads.push(d.spread)
    entry.negHours += d.negativeHours
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
  const fetched = useRef(false)

  // Determine date range: last 3 years
  const now = new Date()
  const endDate = now.toISOString().slice(0, 10)
  const startDate = new Date(now.getFullYear() - 3, now.getMonth(), now.getDate()).toISOString().slice(0, 10)

  useEffect(() => {
    if (fetched.current) return
    fetched.current = true

    async function loadPrices() {
      setLoading(true)
      setError(null)

      try {
        // Fetch in yearly chunks for reliability
        const years: HourlyPrice[] = []
        const chunks = [
          { start: startDate, end: `${now.getFullYear() - 2}-12-31` },
          { start: `${now.getFullYear() - 1}-01-01`, end: `${now.getFullYear() - 1}-12-31` },
          { start: `${now.getFullYear()}-01-01`, end: endDate },
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
              years.push({
                timestamp: p.timestamp,
                priceEurMwh: p.priceEurMwh,
                priceCtKwh: p.priceCtKwh,
                hour: d.getHours(),
                date: d.toISOString().slice(0, 10),
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
  }, [startDate, endDate])

  const selectedDayPrices = hourly.filter(p => p.date === selectedDate)

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
  }
}
