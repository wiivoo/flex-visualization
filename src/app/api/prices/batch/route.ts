/**
 * Batch Prices API Route
 *
 * Loads price data for date ranges with multi-source fallback and Supabase caching.
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │ DATA SOURCE PRIORITY                                            │
 * ├─────────────────────────────────────────────────────────────────┤
 * │                                                                 │
 * │ Hourly (24 pts/day):                                            │
 * │   1. aWATTar     — fast, native range, ~3 days history          │
 * │   2. ENTSO-E     — full historical, hourly (PT60M)              │
 * │   3. SMARD       — weekly chunks, parallel fetch                │
 * │   4. Energy-Charts — Fraunhofer ISE, native range               │
 * │   5. CSV         — local files, offline fallback                │
 * │   6. Demo        — generated seasonal patterns                  │
 * │                                                                 │
 * │ Quarter-hourly (96 pts/day):                                    │
 * │   1. SMARD QH    — native 15-min day-ahead (filter 4169)       │
 * │   2. Hourly avg  — expand hourly×4 (same price per slot)       │
 * │      (uses hourly chain above)                                  │
 * │   3. Demo        — generated seasonal patterns                  │
 * │                                                                 │
 * │ NOTE: When QH falls back to hourly avg, response includes      │
 * │       isHourlyAvg=true so client shows "≈ hourly avg" badge,   │
 * │       NOT forecast styling.                                     │
 * │                                                                 │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ CACHING (Supabase price_cache)                                  │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ Key:    (date, type) where type encodes resolution:             │
 * │         'day-ahead' = hourly, 'day-ahead-qh' = quarter-hourly  │
 * │ TTL:    Past dates = 24h, Today = 2h, Future = 1h              │
 * │         → Forecast data expires fast, replaced by actual EPEX   │
 * │                                                                 │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ FORECAST (EnergyForecast.de)                                    │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ 48h window with price_origin: 'market' | 'forecast'            │
 * │ forecastStart = first 'forecast' entry (consistent for both     │
 * │ resolutions — always determined from HOURLY API call)           │
 * │ EPEX publishes D+1 at ~12:15 CET → forecast boundary moves     │
 * │                                                                 │
 * │ Prices: EUR/kWh × 100 = ct/kWh, EUR/MWh ÷ 10 = ct/kWh        │
 * ├─────────────────────────────────────────────────────────────────┤
 * │ QUERY PARAMS                                                    │
 * │  startDate:  YYYY-MM-DD (required)                              │
 * │  endDate:    YYYY-MM-DD (required)                              │
 * │  type:       day-ahead | intraday | forward (default: day-ahead)│
 * │  resolution: hour | quarterhour (default: hour)                 │
 * └─────────────────────────────────────────────────────────────────┘
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  parseISO,
  format,
  eachDayOfInterval,
  startOfDay,
  addMinutes,
  getMonth,
  differenceInDays,
  isAfter,
} from 'date-fns'
import { convertSmardPrice, SMARD_FILTER } from '@/lib/smard'
import type { SmardPricePoint } from '@/lib/smard'
import { fetchAwattarRange } from '@/lib/awattar'
import { fetchEntsoeRange, ENTSOE_DOMAINS } from '@/lib/entsoe'
import { fetchEnergyChartsRange } from '@/lib/energy-charts'
import { fetchEnergyForecast } from '@/lib/energy-forecast'
import { fetchCsvPrices } from '@/lib/csv-prices'
import { getCachedPrices, setCachedPrices, cacheTypeKey } from '@/lib/price-cache'
import { supabase } from '@/lib/supabase'

const SMARD_BASE_URL = 'https://www.smard.de/app/chart_data'

const batchQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be in YYYY-MM-DD format'),
  type: z.enum(['day-ahead', 'intraday', 'forward']).default('day-ahead'),
  resolution: z.enum(['hour', 'quarterhour']).default('hour'),
  index: z.enum(['id_full', 'id1', 'id3']).optional(),
  country: z.enum(['DE', 'NL']).default('DE'),
})

interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

// ─── SMARD Functions ────────────────────────────────────────────────

async function fetchSmardIndex(resolution: 'hour' | 'quarterhour' = 'hour'): Promise<number[]> {
  const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/DE/index_${resolution}.json`
  const response = await fetch(url, { next: { revalidate: 300 } })
  if (!response.ok) throw new Error(`SMARD index failed: ${response.status}`)
  const data = await response.json()
  const timestamps: number[] = Array.isArray(data) ? data : data.timestamps
  if (!timestamps?.length) throw new Error('No SMARD timestamps')
  return timestamps
}

function findOverlappingWeekTimestamps(allTimestamps: number[], startMs: number, endMs: number): number[] {
  const sorted = [...allTimestamps].sort((a, b) => a - b)
  const result: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const weekStart = sorted[i]
    const weekEnd = i < sorted.length - 1 ? sorted[i + 1] - 1 : weekStart + 7 * 86400000
    if (weekStart <= endMs && weekEnd >= startMs) result.push(weekStart)
  }
  return result
}

async function fetchSmardWeek(timestamp: number, resolution: 'hour' | 'quarterhour' = 'hour'): Promise<SmardPricePoint[]> {
  const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/DE/${SMARD_FILTER.PRICE_DE_LU}_DE_${resolution}_${timestamp}.json`
  const response = await fetch(url, { next: { revalidate: 3600 } })
  if (!response.ok) throw new Error(`SMARD week failed for ${timestamp}: ${response.status}`)
  const data = await response.json()
  if (data.series && Array.isArray(data.series)) {
    return data.series.map((entry: [number, number | null]) => ({
      timestamp: entry[0],
      price_eur_mwh: entry[1],
    }))
  }
  return data.data || []
}

async function fetchSmardBatch(startDate: Date, endDate: Date, resolution: 'hour' | 'quarterhour' = 'hour'): Promise<PricePoint[] | null> {
  try {
    const index = await fetchSmardIndex(resolution)
    const startMs = startOfDay(startDate).getTime()
    const endMs = startOfDay(endDate).getTime() + 86400000 - 1
    const weekTimestamps = findOverlappingWeekTimestamps(index, startMs, endMs)
    if (weekTimestamps.length === 0) return null

    const weekResults = await Promise.allSettled(weekTimestamps.map(ts => fetchSmardWeek(ts, resolution)))
    const allPoints: SmardPricePoint[] = []
    for (const result of weekResults) {
      if (result.status === 'fulfilled') allPoints.push(...result.value)
    }
    if (allPoints.length === 0) return null

    const filtered = allPoints
      .filter(p => p.price_eur_mwh !== null && p.timestamp >= startMs && p.timestamp <= endMs)
      .map(p => {
        const converted = convertSmardPrice(p)
        return { timestamp: converted.timestamp, price_ct_kwh: converted.price_ct_kwh ?? 0 }
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return filtered.length > 0 ? filtered : null
  } catch (error) {
    console.error('SMARD batch error:', error)
    return null
  }
}

// ─── Other Source Functions ──────────────────────────────────────────

async function fetchAwattarBatch(startDate: Date, endDate: Date): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchAwattarRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('aWATTar batch error:', error)
    return null
  }
}

async function fetchEntsoeBatch(startDate: Date, endDate: Date): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchEntsoeRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('ENTSO-E batch error:', error)
    return null
  }
}

async function fetchEnergyChartsBatch(startDate: Date, endDate: Date): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchEnergyChartsRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('Energy-Charts batch error:', error)
    return null
  }
}

async function fetchCsvBatch(startDate: Date, endDate: Date, type: 'day-ahead' | 'intraday'): Promise<PricePoint[] | null> {
  try {
    const days = eachDayOfInterval({ start: startDate, end: endDate })
    const allPrices: PricePoint[] = []
    for (const day of days) {
      try {
        const csvPrices = await fetchCsvPrices(type, day)
        allPrices.push(...csvPrices)
      } catch { /* skip */ }
    }
    return allPrices.length > 0 ? allPrices : null
  } catch (error) {
    console.error('CSV batch error:', error)
    return null
  }
}

// ─── Demo Data ──────────────────────────────────────────────────────

function generateDemoBatchPrices(startDate: Date, endDate: Date): PricePoint[] {
  const prices: PricePoint[] = []
  const days = eachDayOfInterval({ start: startDate, end: endDate })
  function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000
    return x - Math.floor(x)
  }
  for (const day of days) {
    const month = getMonth(day)
    const dayOfYear = differenceInDays(day, new Date(day.getFullYear(), 0, 1))
    let seasonalFactor = 1.0
    if (month >= 11 || month <= 1) seasonalFactor = 1.3
    else if (month >= 5 && month <= 7) seasonalFactor = 0.7
    else if (month >= 2 && month <= 4) seasonalFactor = 0.9
    else seasonalFactor = 1.1
    for (let hour = 0; hour < 24; hour++) {
      const time = addMinutes(startOfDay(day), hour * 60)
      const seed = dayOfYear * 100 + hour + day.getFullYear()
      let basePrice: number
      if (hour >= 22 || hour < 6) basePrice = 8 + seededRandom(seed) * 10
      else if (hour >= 6 && hour < 12) basePrice = 18 + seededRandom(seed + 1) * 15
      else if (hour >= 12 && hour < 18) basePrice = 15 + seededRandom(seed + 2) * 12
      else basePrice = 28 + seededRandom(seed + 3) * 25
      basePrice *= seasonalFactor
      if (day.getDay() === 0 || day.getDay() === 6) basePrice *= 0.85
      prices.push({ timestamp: time.toISOString(), price_ct_kwh: Math.round(basePrice * 100) / 100 })
    }
  }
  return prices
}

// ─── Cache Helpers ──────────────────────────────────────────────────

/** Check which days are already cached (resolution-aware) */
async function getCachedDays(
  startDate: Date,
  endDate: Date,
  type: 'day-ahead' | 'intraday' | 'forward',
  resolution: 'hour' | 'quarterhour',
  indexField?: string
): Promise<Map<string, PricePoint[]>> {
  const cachedDays = new Map<string, PricePoint[]>()
  const typeKey = cacheTypeKey(type, resolution)
  const startStr = format(startDate, 'yyyy-MM-dd')
  const endStr = format(endDate, 'yyyy-MM-dd')
  const today = format(new Date(), 'yyyy-MM-dd')

  try {
    // Single bulk query instead of per-day queries
    const { data, error } = await supabase
      .from('price_cache')
      .select('date, prices_json, cached_at')
      .eq('type', typeKey)
      .gte('date', startStr)
      .lte('date', endStr)
      .order('date')

    if (error || !data) return cachedDays

    for (const row of data) {
      // Smart TTL: past=never expires, today=2h, future=1h
      const ttlH = row.date < today ? Infinity : row.date === today ? 2 : 1
      if (ttlH !== Infinity) {
        const cachedAt = new Date(row.cached_at).getTime()
        if (Date.now() - cachedAt > ttlH * 3600000) continue // expired
      }

      cachedDays.set(row.date, row.prices_json.map((p: Record<string, unknown>) => ({
        timestamp: p.timestamp as string,
        price_ct_kwh: indexField
          ? ((p[indexField] as number) ?? (p.price_ct_kwh as number) ?? 0)
          : ((p.price_ct_kwh as number) ?? 0),
      })))
    }
  } catch (error) {
    console.error('Bulk cache read error:', error)
  }

  return cachedDays
}

/** Store new price data in cache by day (resolution-aware) */
async function cachePricesByDay(
  prices: PricePoint[],
  type: 'day-ahead' | 'intraday' | 'forward',
  resolution: 'hour' | 'quarterhour',
  source: 'awattar' | 'smard' | 'energy-charts' | 'csv'
): Promise<void> {
  const byDay = new Map<string, PricePoint[]>()
  const typeKey = cacheTypeKey(type, resolution)
  for (const price of prices) {
    const dateStr = format(new Date(price.timestamp), 'yyyy-MM-dd')
    if (!byDay.has(dateStr)) byDay.set(dateStr, [])
    byDay.get(dateStr)!.push(price)
  }
  await Promise.allSettled(
    Array.from(byDay.entries()).map(([dateStr, dayPrices]) =>
      setCachedPrices(dateStr, typeKey, source, dayPrices)
    )
  )
}

/** Expand hourly prices to quarter-hourly (×4, same price per slot) */
function expandHourlyToQH(hourlyPrices: PricePoint[]): PricePoint[] {
  return hourlyPrices.flatMap(p => {
    const base = new Date(p.timestamp)
    return [0, 15, 30, 45].map(min => {
      const ts = new Date(base)
      ts.setMinutes(min, 0, 0)
      return { timestamp: ts.toISOString(), price_ct_kwh: p.price_ct_kwh }
    })
  })
}

// ─── Hourly Fallback Chain ──────────────────────────────────────────

/** Fetch hourly prices through the full fallback chain */
async function fetchHourlyChain(
  startDate: Date,
  endDate: Date
): Promise<{ prices: PricePoint[] | null; source: 'awattar' | 'smard' | 'energy-charts' | 'csv' | 'demo' }> {
  // 1. aWATTar (fast, ~3 days history)
  let prices = await fetchAwattarBatch(startDate, endDate)
  if (prices?.length) return { prices, source: 'awattar' }

  // 2. ENTSO-E (full historical)
  prices = await fetchEntsoeBatch(startDate, endDate)
  if (prices?.length) return { prices, source: 'smard' as const }

  // 3. SMARD (weekly chunks)
  prices = await fetchSmardBatch(startDate, endDate)
  if (prices?.length) return { prices, source: 'smard' }

  // 4. Energy-Charts (Fraunhofer ISE)
  prices = await fetchEnergyChartsBatch(startDate, endDate)
  if (prices?.length) return { prices, source: 'energy-charts' }

  // 5. CSV (local files)
  prices = await fetchCsvBatch(startDate, endDate, 'day-ahead')
  if (prices?.length) return { prices, source: 'csv' }

  return { prices: null, source: 'demo' }
}

// ═══════════════════════════════════════════════════════════════════
// API ROUTE
// ═══════════════════════════════════════════════════════════════════

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  const parseResult = batchQuerySchema.safeParse({
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    type: searchParams.get('type') || 'day-ahead',
    resolution: searchParams.get('resolution') || 'hour',
    index: searchParams.get('index') || undefined,
    country: searchParams.get('country') || 'DE',
  })

  if (!parseResult.success) {
    return NextResponse.json(
      { error: 'Invalid parameters', details: parseResult.error.issues.map(i => i.message) },
      { status: 400 }
    )
  }

  const { startDate: startDateStr, endDate: endDateStr, type, resolution, index, country } = parseResult.data
  const indexField = type === 'intraday' && index ? `${index}_ct` : undefined
  const startDate = parseISO(startDateStr)
  const endDate = parseISO(endDateStr)

  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD' }, { status: 400 })
  }
  if (isAfter(startDate, endDate)) {
    return NextResponse.json({ error: 'startDate must be before endDate' }, { status: 400 })
  }
  if (differenceInDays(endDate, startDate) + 1 > 1600) {
    return NextResponse.json({ error: 'Maximum date range: 1600 days' }, { status: 400 })
  }

  // ── Step 1: Check Supabase cache (resolution-aware, country-aware) ──
  // Non-DE countries use prefixed cache type (e.g., 'nl:day-ahead') for separate cache slots
  const cachePrefix = country !== 'DE' ? `${country.toLowerCase()}:` : ''
  const effectiveType = `${cachePrefix}${type}` as 'day-ahead' | 'intraday' | 'forward'
  const cachedDays = await getCachedDays(startDate, endDate, effectiveType, resolution, indexField)
  const allDays = eachDayOfInterval({ start: startDate, end: endDate })
  const uncachedDays = allDays.filter(d => !cachedDays.has(format(d, 'yyyy-MM-dd')))

  // ── Step 2: Fetch uncached days from source chain ──
  let fetchedPrices: PricePoint[] | null = null
  let source: 'awattar' | 'smard' | 'energy-charts' | 'csv' | 'demo' = 'demo'
  let isHourlyAvg = false

  if (uncachedDays.length > 0) {
    const uncachedStart = uncachedDays[0]
    const uncachedEnd = uncachedDays[uncachedDays.length - 1]

    if (country !== 'DE') {
      // Non-DE countries: ENTSO-E only
      const domain = ENTSOE_DOMAINS[country]
      if (domain && type === 'day-ahead') {
        try {
          fetchedPrices = await fetchEntsoeRange(uncachedStart, uncachedEnd, domain)
          if (fetchedPrices?.length) source = 'smard' as const // reuse type for cache
        } catch (error) {
          console.error(`ENTSO-E ${country} error:`, error)
        }
        if (resolution === 'quarterhour' && fetchedPrices?.length) {
          // ENTSO-E NL only has hourly — expand to QH
          fetchedPrices = expandHourlyToQH(fetchedPrices)
          isHourlyAvg = true
        }
      }
    } else if (type === 'day-ahead' && resolution === 'quarterhour') {
      // QH chain: SMARD QH → hourly avg expansion → demo
      fetchedPrices = await fetchSmardBatch(uncachedStart, uncachedEnd, 'quarterhour')
      if (fetchedPrices?.length) {
        source = 'smard'
      } else {
        // No real QH data — expand hourly to QH (same price ×4)
        const hourly = await fetchHourlyChain(uncachedStart, uncachedEnd)
        if (hourly.prices?.length) {
          fetchedPrices = expandHourlyToQH(hourly.prices)
          source = hourly.source
          isHourlyAvg = true // Signal client to show "≈ hourly avg" badge
        }
      }
    } else if (type === 'day-ahead') {
      // Hourly chain
      const result = await fetchHourlyChain(uncachedStart, uncachedEnd)
      fetchedPrices = result.prices
      source = result.source
    } else if (type === 'intraday') {
      // Intraday only from Supabase cache (EPEX scraper) — no external fetch
    } else {
      // Forward: CSV fallback
      fetchedPrices = await fetchCsvBatch(uncachedStart, uncachedEnd, 'day-ahead')
      if (fetchedPrices?.length) source = 'csv'
    }

    // Final fallback: demo data (DE only, skip for intraday - only from EPEX scraper cache)
    // Non-DE countries must not get demo data — better to show an error than fake prices
    if (!fetchedPrices?.length && type !== 'intraday' && country === 'DE') {
      fetchedPrices = generateDemoBatchPrices(uncachedStart, uncachedEnd)
      source = 'demo'
    }

    // ── Step 3: Cache fresh data (skip demo) ──
    if (source !== 'demo' && fetchedPrices && fetchedPrices.length > 0) {
      try {
        await cachePricesByDay(fetchedPrices, effectiveType, resolution, source)
      } catch (error) {
        console.error('Cache write error (non-fatal):', error)
      }
    }
  }

  // ── Step 4: Merge cached + fetched data ──
  const allPrices: PricePoint[] = []
  for (const day of allDays) {
    const dateStr = format(day, 'yyyy-MM-dd')
    const cached = cachedDays.get(dateStr)
    if (cached) {
      allPrices.push(...cached)
    } else if (fetchedPrices) {
      const dayStart = startOfDay(day).getTime()
      const dayEnd = dayStart + 86400000 - 1
      allPrices.push(...fetchedPrices.filter(p => {
        const ts = new Date(p.timestamp).getTime()
        return ts >= dayStart && ts <= dayEnd
      }))
    }
  }

  // ── Step 5: Forecast boundary (single code path for ALL requests) ──
  // Determines where actual EPEX data ends and EnergyForecast.de predictions begin.
  // Always uses HOURLY API to get a consistent boundary for both resolutions.
  // Also appends forecast prices for any gaps at the end of the range.
  let forecastStart: string | null = null
  if (type === 'day-ahead') {
    try {
      const endRangeTs = startOfDay(endDate).getTime() + 86400000
      if (endRangeTs > Date.now()) {
        // Get forecast boundary from HOURLY API (consistent for both resolutions)
        const { prices: forecastHourly, forecastStart: apiForecastStart } = await fetchEnergyForecast('HOURLY', country)
        forecastStart = apiForecastStart

        // Determine which prices to append (match requested resolution)
        let pricesToAppend = forecastHourly
        if (resolution === 'quarterhour') {
          try {
            const qhResult = await fetchEnergyForecast('QUARTER_HOURLY', country)
            pricesToAppend = qhResult.prices
          } catch { /* fall back to hourly */ }
        }

        // Append forecast prices not already in dataset
        const existingTs = new Set(allPrices.map(p => new Date(p.timestamp).getTime()))
        for (const fp of pricesToAppend) {
          const fpTs = new Date(fp.timestamp).getTime()
          if (!existingTs.has(fpTs) && fpTs <= endRangeTs) {
            allPrices.push(fp)
          }
        }
        allPrices.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      }
    } catch (error) {
      console.error('Forecast error (non-fatal):', error)
    }
  }

  // ── Step 6: Response ──
  return NextResponse.json({
    type,
    startDate: startDateStr,
    endDate: endDateStr,
    source: cachedDays.size > 0 && uncachedDays.length > 0
      ? `mixed (${cachedDays.size} cached)`
      : cachedDays.size > 0 ? 'cache' : source,
    count: allPrices.length,
    prices: allPrices,
    forecastStart,
    isHourlyAvg,
  })
}
