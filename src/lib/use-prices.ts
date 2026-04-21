/**
 * Hook for fetching and managing price data across the v2 flow.
 * Loads pre-downloaded SMARD data from static JSON files.
 * On page visit, fetches incremental updates from SMARD via API
 * to keep data up-to-date without manual re-downloads.
 */
'use client'

import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import type { HourlyPrice, DailySummary, MonthlyStats, GenerationData } from '@/lib/v2-config'
import { DEFAULT_GB_DAY_AHEAD_AUCTION, type GbDayAheadAuction } from '@/lib/gb-day-ahead'

/** Full intraday data point with all EPEX fields (ct/kWh for prices, MWh for volumes) */
export interface IntradayFullPoint {
  timestamp: string       // ISO timestamp of the delivery QH
  date: string            // YYYY-MM-DD
  hour: number
  minute: number
  price_ct_kwh: number | null
  id_full_ct: number | null
  id1_ct: number | null
  id3_ct: number | null
  weight_avg_ct: number | null
  low_ct: number | null
  high_ct: number | null
  last_ct: number | null
  buy_vol_mwh: number | null
  sell_vol_mwh: number | null
  volume_mwh: number | null
}

export interface PriceData {
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
  generation: GenerationData[]
  generationLoading: boolean
  lastRealDate: string  // YYYY-MM-DD boundary between real and projected data
  intradayId3: HourlyPrice[]
  intradayFull: IntradayFullPoint[]  // all EPEX fields per QH
}

function isNightHour(hour: number): boolean {
  // Night = 18:00 to 05:59 (EV charging window: plug-in at 18h to departure ~6h)
  return hour >= 18 || hour < 6
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
      isProjected: dayPrices.some(p => p.isProjected),
    })
  }
  return summaries.sort((a, b) => a.date.localeCompare(b.date))
}

function deriveMonthlyStats(daily: DailySummary[], hourly: HourlyPrice[]): MonthlyStats[] {
  const byMonth = new Map<string, { spreads: number[]; prices: number[]; negHours: number; totalHours: number; nightSpreads: number[]; hasProjected: boolean }>()

  for (const d of daily) {
    const month = d.date.slice(0, 7)
    const entry = byMonth.get(month) || { spreads: [], prices: [], negHours: 0, totalHours: 0, nightSpreads: [], hasProjected: false }
    entry.spreads.push(d.spread)
    entry.negHours += d.negativeHours
    entry.nightSpreads.push(d.nightSpread) // 18:00 vs cheapest night
    if (d.isProjected) entry.hasProjected = true
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
      isProjected: data.hasProjected,
    })
  }
  return stats.sort((a, b) => a.month.localeCompare(b.month))
}

export function usePrices(country: string = 'DE', gbAuction: GbDayAheadAuction = DEFAULT_GB_DAY_AHEAD_AUCTION): PriceData {
  const [hourly, setHourly] = useState<HourlyPrice[]>([])
  const [hourlyQH, setHourlyQH] = useState<HourlyPrice[]>([])
  const [daily, setDaily] = useState<DailySummary[]>([])
  const [monthly, setMonthly] = useState<MonthlyStats[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedDate, setSelectedDate] = useState<string>('')
  const [generation, setGeneration] = useState<GenerationData[]>([])
  const [generationLoading, setGenerationLoading] = useState(false)
  const [lastRealDate, setLastRealDate] = useState<string>('')
  const [intradayId3, setIntradayId3] = useState<HourlyPrice[]>([])
  const [intradayFull, setIntradayFull] = useState<IntradayFullPoint[]>([])
  const fetchedCountry = useRef<string | null>(null)
  const generationCache = useRef<Map<string, GenerationData[]>>(new Map())
  const allGeneration = useRef<CompactGen[]>([])

  /** Convert compact price to HourlyPrice */
  const toHourlyPrice = useCallback((p: CompactPrice): HourlyPrice => {
    const d = new Date(p.t)
    // GB static files (gb-prices*.json) store values already in GBp/kWh;
    // DE/NL files store values in EUR/MWh and need /10 to convert.
    const isKwhScale = country === 'GB'
    const priceCtKwh = isKwhScale ? Math.round(p.p * 100) / 100 : Math.round((p.p / 10) * 100) / 100
    const priceEurMwh = isKwhScale ? p.p * 10 : p.p
    return {
      timestamp: p.t,
      priceEurMwh,
      priceCtKwh,
      hour: d.getHours(),
      minute: d.getMinutes(),
      date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
    }
  }, [country])

  /** Get next day string from YYYY-MM-DD */
  const nextDay = useCallback((dateStr: string): string => {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + 1)
    return d.toISOString().slice(0, 10)
  }, [])

  /** Shift YYYY-MM-DD by a fixed number of UTC days */
  const shiftDay = useCallback((dateStr: string, deltaDays: number): string => {
    const d = new Date(dateStr + 'T12:00:00Z')
    d.setUTCDate(d.getUTCDate() + deltaDays)
    return d.toISOString().slice(0, 10)
  }, [])

  /** Today's date in local time */
  const todayStr = useCallback((): string => {
    const d = new Date()
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  }, [])

  useEffect(() => {
    const countryKey = country === 'GB' ? `${country}:${gbAuction}` : country
    if (fetchedCountry.current === countryKey) return
    fetchedCountry.current = countryKey

    async function loadData() {
      setLoading(true)
      setError(null)
      // Reset state on country switch
      setHourly([])
      setHourlyQH([])
      setDaily([])
      setMonthly([])
      setGeneration([])
      setIntradayId3([])
      setLastRealDate('')
      setSelectedDate('')
      generationCache.current.clear()
      allGeneration.current = []

      try {
        // Load static files — country-aware paths
        const gbPrefix = country === 'GB' ? `gb-${gbAuction}` : country.toLowerCase()
        const priceFile = country === 'DE' ? '/data/smard-prices.json' : `/data/${gbPrefix}-prices.json`
        const priceQHFile = country === 'DE' ? '/data/smard-prices-qh.json' : `/data/${gbPrefix}-prices-qh.json`

        const [priceRes, priceQHRes, genRes] = await Promise.allSettled([
          fetch(priceFile),
          fetch(priceQHFile),
          country === 'DE' ? fetch('/data/smard-generation.json') : Promise.reject('no generation for non-DE'),
        ])

        // Parse hourly prices
        let rawPrices: CompactPrice[] = []
        if (priceRes.status === 'fulfilled' && priceRes.value.ok) {
          rawPrices = await priceRes.value.json()
        }

        // Parse QH prices (optional — may not exist yet)
        let rawQHPrices: CompactPrice[] = []
        if (priceQHRes.status === 'fulfilled' && priceQHRes.value.ok) {
          rawQHPrices = await priceQHRes.value.json()
        }

        // Parse generation (keep in ref for on-demand day lookups)
        if (genRes.status === 'fulfilled' && genRes.value.ok) {
          allGeneration.current = await genRes.value.json()
        }

        // GB can start from an empty static file set while the EPEX bootstrap is still running.
        // In that case fetch a recent real window from the batch API so the app still works.
        if (rawPrices.length === 0 && country === 'GB') {
          const bootstrapEnd = nextDay(todayStr())
          const bootstrapStart = shiftDay(bootstrapEnd, -44)
          const gbAuctionParam = `&gbAuction=${gbAuction}`

          const [bootstrapRes, bootstrapQHRes] = await Promise.all([
            fetch(`/api/prices/batch?startDate=${bootstrapStart}&endDate=${bootstrapEnd}&country=GB${gbAuctionParam}`),
            fetch(`/api/prices/batch?startDate=${bootstrapStart}&endDate=${bootstrapEnd}&country=GB&resolution=quarterhour${gbAuctionParam}`),
          ])

          if (bootstrapRes.ok) {
            const bootstrap = await bootstrapRes.json()
            rawPrices = (bootstrap.prices || []).map((p: { timestamp: string; price_ct_kwh: number }) => ({
              t: new Date(p.timestamp).getTime(),
              p: p.price_ct_kwh,
            }))
          }

          if (bootstrapQHRes.ok) {
            const bootstrapQH = await bootstrapQHRes.json()
            rawQHPrices = (bootstrapQH.prices || []).map((p: { timestamp: string; price_ct_kwh: number }) => ({
              t: new Date(p.timestamp).getTime(),
              p: p.price_ct_kwh,
            }))
          }
        }

        if (rawPrices.length === 0) {
          throw new Error(country === 'GB'
            ? 'No GB day-ahead data available from EPEX.'
            : 'No price data available. Run: node scripts/download-smard.mjs')
        }

        // Convert compact format to HourlyPrice
        const prices: HourlyPrice[] = rawPrices.map(toHourlyPrice)
        const qhPrices: HourlyPrice[] = rawQHPrices.map(toHourlyPrice)

        // Determine the last date in static data for incremental fetch boundary
        const lastStaticDate = prices[prices.length - 1].date
        setLastRealDate(lastStaticDate)
        const lastStaticQHDate = qhPrices.length > 0 ? qhPrices[qhPrices.length - 1].date : lastStaticDate
        const today = todayStr()

        // Show static data immediately (fast first paint)
        setHourly(prices)
        if (qhPrices.length > 0) setHourlyQH(qhPrices)
        const dailySummaries = deriveDailySummaries(prices)
        setDaily(dailySummaries)
        setMonthly(deriveMonthlyStats(dailySummaries, prices))

        // Default to the latest real date that still has a next day available for the overnight view.
        const dateSet = new Set(dailySummaries.map(d => d.date))
        const latestSelectable = [...dailySummaries]
          .sort((a, b) => a.date.localeCompare(b.date))
          .filter(d => d.date <= lastStaticDate)
          .filter(d => dateSet.has(nextDay(d.date)))
          .pop()
        if (latestSelectable) {
          setSelectedDate(latestSelectable.date)
        } else if (dailySummaries.length > 1) {
          setSelectedDate(dailySummaries[dailySummaries.length - 2].date)
        } else if (dailySummaries.length > 0) {
          setSelectedDate(dailySummaries[dailySummaries.length - 1].date)
        }

        // Background: fetch incremental data up to dayAfterTomorrow
        const dayAfterTomorrow = nextDay(nextDay(today))
        fetchIncremental(lastStaticDate, dayAfterTomorrow, prices, country, gbAuction)
        fetchIncrementalQH(lastStaticQHDate, dayAfterTomorrow, qhPrices, country, gbAuction)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load prices')
        // Reset fetchedCountry so user can retry the same country
        fetchedCountry.current = null
      } finally {
        setLoading(false)
      }
    }

    loadData()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [country, gbAuction, nextDay, shiftDay, todayStr])

  /** Fetch new prices from batch API and merge into state */
  const fetchIncremental = useCallback(async (lastStaticDate: string, today: string, existingPrices: HourlyPrice[], ctry: string, gbAuctionMode: GbDayAheadAuction) => {
    try {
      const startDate = nextDay(lastStaticDate)
      if (startDate > today) return

      const countryParam = ctry !== 'DE' ? `&country=${ctry}` : ''
      const gbAuctionParam = ctry === 'GB' ? `&gbAuction=${gbAuctionMode}` : ''
      const res = await fetch(`/api/prices/batch?startDate=${startDate}&endDate=${today}${countryParam}${gbAuctionParam}`)
      if (!res.ok) return

      const data = await res.json()
      const newPoints: { timestamp: string; price_ct_kwh: number }[] = data.prices || []
      if (newPoints.length === 0) return

      // forecastStart marks where EPEX actuals end and EnergyForecast.de predictions begin
      const forecastStartTs = data.forecastStart ? new Date(data.forecastStart).getTime() : null

      // Convert batch API format to HourlyPrice
      const newHourly: HourlyPrice[] = newPoints.map(p => {
        const d = new Date(p.timestamp)
        const eurMwh = p.price_ct_kwh * 10
        const ts = d.getTime()
        return {
          timestamp: ts,
          priceEurMwh: eurMwh,
          priceCtKwh: p.price_ct_kwh,
          hour: d.getHours(),
          minute: d.getMinutes(),
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          isProjected: forecastStartTs ? ts >= forecastStartTs : false,
        }
      })

      // Deduplicate by timestamp and merge
      const existingTs = new Set(existingPrices.map(p => p.timestamp))
      const unique = newHourly.filter(p => !existingTs.has(p.timestamp))
      if (unique.length === 0) return

      const merged = [...existingPrices, ...unique].sort((a, b) => a.timestamp - b.timestamp)

      setHourly(merged)
      const dailySummaries = deriveDailySummaries(merged)
      setDaily(dailySummaries)
      setMonthly(deriveMonthlyStats(dailySummaries, merged))

      // Update lastRealDate — only advance to the last non-projected date
      const realPrices = unique.filter(p => !p.isProjected)
      if (realPrices.length > 0) {
        const lastRealNewDate = realPrices[realPrices.length - 1].date
        setLastRealDate(prev => lastRealNewDate > prev ? lastRealNewDate : prev)
      }

      // Only advance selected date if it's empty — don't override user's choice
      // and never advance past yesterday (today/tomorrow may have incomplete data)
      if (dailySummaries.length > 1) {
        const now = new Date()
        const yest = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate() - 1).padStart(2, '0')}`
        const target = dailySummaries.find(d => d.date === yest)?.date
          ?? dailySummaries.filter(d => d.date <= yest).pop()?.date
        if (target) {
          setSelectedDate(prev => !prev ? target : prev)
        }
      }

      console.log(`[usePrices] Incremental update: +${unique.length} price points (${startDate} → ${today})`)
    } catch (e) {
      console.warn('[usePrices] Incremental fetch failed (non-fatal):', e)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Fetch new QH prices from batch API and merge into state */
  const fetchIncrementalQH = useCallback(async (lastStaticDate: string, today: string, existingQH: HourlyPrice[], ctry: string, gbAuctionMode: GbDayAheadAuction) => {
    try {
      const startDate = nextDay(lastStaticDate)
      if (startDate > today) return

      const countryParam = ctry !== 'DE' ? `&country=${ctry}` : ''
      const gbAuctionParam = ctry === 'GB' ? `&gbAuction=${gbAuctionMode}` : ''
      const res = await fetch(`/api/prices/batch?startDate=${startDate}&endDate=${today}&resolution=quarterhour${countryParam}${gbAuctionParam}`)
      if (!res.ok) return

      const data = await res.json()
      const newPoints: { timestamp: string; price_ct_kwh: number }[] = data.prices || []
      if (newPoints.length === 0) return

      const forecastStartTs = data.forecastStart ? new Date(data.forecastStart).getTime() : null

      const newQH: HourlyPrice[] = newPoints.map(p => {
        const d = new Date(p.timestamp)
        const eurMwh = p.price_ct_kwh * 10
        const ts = d.getTime()
        return {
          timestamp: ts,
          priceEurMwh: eurMwh,
          priceCtKwh: p.price_ct_kwh,
          hour: d.getHours(),
          minute: d.getMinutes(),
          date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`,
          isProjected: forecastStartTs ? ts >= forecastStartTs : false,
        }
      })

      const existingTs = new Set(existingQH.map(p => p.timestamp))
      const unique = newQH.filter(p => !existingTs.has(p.timestamp))
      if (unique.length === 0) return

      const merged = [...existingQH, ...unique].sort((a, b) => a.timestamp - b.timestamp)
      setHourlyQH(merged)

      console.log(`[usePrices] QH incremental update: +${unique.length} points (${startDate} → ${today})`)
    } catch (e) {
      console.warn('[usePrices] QH incremental fetch failed (non-fatal):', e)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /** Fetch generation from live API and cache.
   *  Only replaces existing data if the live result is at least as complete
   *  (same or more hours) — prevents partial today-data from overwriting a
   *  complete static dataset. */
  const fetchLiveGeneration = useCallback((date: string) => {
    setGenerationLoading(true)
    fetch(`/api/generation?date=${date}`)
      .then(res => res.ok ? res.json() : { hourly: [] })
      .then(json => {
        const data: GenerationData[] = json.hourly || []
        const existing = generationCache.current.get(date)
        if (data.length > 0 && (!existing || data.length >= existing.length)) {
          generationCache.current.set(date, data)
          setGeneration(data)
        }
      })
      .catch(() => {/* keep existing data */})
      .finally(() => setGenerationLoading(false))
  }, [])

  // Get generation data for selected day from the pre-loaded dataset
  // Falls back to live SMARD API if static data is incomplete (< 20 hours)
  const loadGenerationForDate = useCallback((date: string) => {
    if (!date) return

    // Check cache first (live-fetched data is always complete)
    if (generationCache.current.has(date)) {
      setGeneration(generationCache.current.get(date)!)
      return
    }

    setGenerationLoading(true)

    // Filter from pre-loaded static data
    const gen = allGeneration.current
    const startOfDay = new Date(date + 'T00:00:00').getTime()
    const endOfDay = new Date(date + 'T23:59:59').getTime()

    const dayGen: GenerationData[] = []
    if (gen.length > 0) {
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
    }

    // For recent dates (last 7 days), always refresh from live SMARD — static may be stale
    const dayAgeMs = Date.now() - new Date(date + 'T12:00:00').getTime()
    const isRecentDate = dayAgeMs < 7 * 24 * 3600 * 1000

    if (dayGen.length < 20 || isRecentDate) {
      // Show static data immediately if available, then upgrade with live data
      if (dayGen.length > 0) {
        setGeneration(dayGen)
        setGenerationLoading(false)
      }
      fetchLiveGeneration(date)
    } else {
      // Static data is complete and old enough — use it directly
      generationCache.current.set(date, dayGen)
      setGeneration(dayGen)
      setGenerationLoading(false)
    }
  }, [fetchLiveGeneration])

  useEffect(() => {
    if (selectedDate && country === 'DE') loadGenerationForDate(selectedDate)
    else { setGeneration([]); setGenerationLoading(false) }
  }, [selectedDate, loadGenerationForDate, country])

  // Fetch intraday ID3 prices for selected date (+ 3 extra days for 72h view)
  useEffect(() => {
    if (!selectedDate) return
    const controller = new AbortController()
    // Fetch 4 days of intraday data to cover 72h (3-day) view
    const d2 = nextDay(selectedDate)
    const d3 = nextDay(d2)
    const d4 = nextDay(d3)
    const nd = nextDay(d4)
    const countryParam = country !== 'DE' ? `&country=${country}` : ''
    fetch(`/api/prices/batch?startDate=${selectedDate}&endDate=${nd}&type=intraday&index=id3${countryParam}`,
      { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.prices?.length) { setIntradayId3([]); return }
        // EPEX timestamps are CET delivery periods stored with Z suffix
        // Parse hour/minute from string directly, not from Date object
        const id3: HourlyPrice[] = data.prices
          .filter((p: { price_ct_kwh?: number }) => p.price_ct_kwh != null && p.price_ct_kwh !== 0)
          .map((p: { timestamp: string; price_ct_kwh: number }) => {
            const ts = p.timestamp as string
            const dateStr = ts.slice(0, 10)
            const hour = parseInt(ts.slice(11, 13))
            const minute = parseInt(ts.slice(14, 16))
            const priceCtKwh = p.price_ct_kwh
            return {
              timestamp: new Date(`${dateStr}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`).getTime(),
              priceEurMwh: priceCtKwh * 10,
              priceCtKwh,
              hour,
              minute,
              date: dateStr,
            }
          })
        setIntradayId3(id3)
      })
      .catch(() => setIntradayId3([]))
    return () => controller.abort()
  }, [selectedDate, nextDay, country])

  // Fetch full intraday data (all EPEX fields) for convergence funnel
  useEffect(() => {
    if (!selectedDate) return
    const controller = new AbortController()
    const d2 = nextDay(selectedDate)
    const d3 = nextDay(d2)
    const d4 = nextDay(d3)
    const nd = nextDay(d4)
    const countryParam = country !== 'DE' ? `&country=${country}` : ''
    fetch(`/api/prices/batch?startDate=${selectedDate}&endDate=${nd}&type=intraday${countryParam}`,
      { signal: controller.signal })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        if (!data?.prices?.length) { setIntradayFull([]); return }
        const points: IntradayFullPoint[] = data.prices.map((p: Record<string, unknown>) => {
          const ts = p.timestamp as string
          return {
            timestamp: ts,
            date: ts.slice(0, 10),
            hour: parseInt(ts.slice(11, 13)),
            minute: parseInt(ts.slice(14, 16)),
            price_ct_kwh: (p.price_ct_kwh as number) ?? null,
            id_full_ct: (p.id_full_ct as number) ?? null,
            id1_ct: (p.id1_ct as number) ?? null,
            id3_ct: (p.id3_ct as number) ?? null,
            weight_avg_ct: (p.weight_avg_ct as number) ?? null,
            low_ct: (p.low_ct as number) ?? null,
            high_ct: (p.high_ct as number) ?? null,
            last_ct: (p.last_ct as number) ?? null,
            buy_vol_mwh: (p.buy_vol_mwh as number) ?? null,
            sell_vol_mwh: (p.sell_vol_mwh as number) ?? null,
            volume_mwh: (p.volume_mwh as number) ?? null,
          }
        })
        setIntradayFull(points)
      })
      .catch(() => setIntradayFull([]))
    return () => controller.abort()
  }, [selectedDate, nextDay, country])

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
    hourlyQH,
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
    lastRealDate,
    intradayId3,
    intradayFull,
  }
}
