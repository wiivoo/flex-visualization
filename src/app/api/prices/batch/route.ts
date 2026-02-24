/**
 * Batch Prices API Route
 * Efficient loading of price data for long date ranges.
 *
 * Instead of querying individual days, SMARD weeks are loaded in parallel
 * (max ~52 requests for a full year instead of 365).
 *
 * Fallback chain: Cache → SMARD → CSV → Demo data
 *
 * Query params:
 * - startDate: YYYY-MM-DD (required)
 * - endDate: YYYY-MM-DD (required)
 * - type: day-ahead | intraday | forward (default: day-ahead)
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
  isBefore,
  isAfter,
  isEqual,
} from 'date-fns'
import { convertSmardPrice, SMARD_FILTER, SMARD_RESOLUTION } from '@/lib/smard'
import type { SmardPricePoint } from '@/lib/smard'
import { fetchAwattarRange } from '@/lib/awattar'
import { fetchEnergyChartsRange } from '@/lib/energy-charts'
import { fetchCsvPrices } from '@/lib/csv-prices'
import { getCachedPrices, setCachedPrices } from '@/lib/price-cache'

const SMARD_BASE_URL = 'https://www.smard.de/app/chart_data'

// Zod validation of query parameters
const batchQuerySchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be in YYYY-MM-DD format'),
  type: z.enum(['day-ahead', 'intraday', 'forward']).default('day-ahead'),
  resolution: z.enum(['hour', 'quarterhour']).default('hour'),
})

interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

// --- SMARD batch functions ---

/**
 * Load SMARD index: Returns all available weekly timestamps
 */
async function fetchSmardIndex(resolution: 'hour' | 'quarterhour' = 'hour'): Promise<number[]> {
  const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/DE/index_${resolution}.json`
  const response = await fetch(url, { next: { revalidate: 3600 } })

  if (!response.ok) {
    throw new Error(`SMARD index request failed: ${response.status}`)
  }

  const data = await response.json()
  // SMARD returns { timestamps: [...] } dict
  const timestamps: number[] = Array.isArray(data) ? data : data.timestamps
  if (!timestamps || timestamps.length === 0) {
    throw new Error('No SMARD timestamps available')
  }

  return timestamps
}

/**
 * Find all weekly timestamps that overlap with the [startDate, endDate] range
 */
function findOverlappingWeekTimestamps(
  allTimestamps: number[],
  startMs: number,
  endMs: number
): number[] {
  // Sort ascending
  const sorted = [...allTimestamps].sort((a, b) => a - b)

  const result: number[] = []
  for (let i = 0; i < sorted.length; i++) {
    const weekStart = sorted[i]
    // Week end = next timestamp - 1ms, or +7 days if last entry
    const weekEnd = i < sorted.length - 1
      ? sorted[i + 1] - 1
      : weekStart + 7 * 24 * 60 * 60 * 1000

    // Check overlap with [startMs, endMs]
    if (weekStart <= endMs && weekEnd >= startMs) {
      result.push(weekStart)
    }
  }

  return result
}

/**
 * Load a single SMARD week
 */
async function fetchSmardWeek(timestamp: number, resolution: 'hour' | 'quarterhour' = 'hour'): Promise<SmardPricePoint[]> {
  const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/DE/${SMARD_FILTER.PRICE_DE_LU}_DE_${resolution}_${timestamp}.json`
  const response = await fetch(url, { next: { revalidate: 3600 } })

  if (!response.ok) {
    throw new Error(`SMARD weekly data failed for ${timestamp}: ${response.status}`)
  }

  const data = await response.json()

  if (data.series && Array.isArray(data.series)) {
    return data.series.map((entry: [number, number | null]) => ({
      timestamp: entry[0],
      price_eur_mwh: entry[1],
    }))
  }

  return data.data || []
}

/**
 * Load all relevant SMARD weeks in parallel and filter to date range
 */
async function fetchSmardBatch(
  startDate: Date,
  endDate: Date,
  resolution: 'hour' | 'quarterhour' = 'hour'
): Promise<PricePoint[] | null> {
  try {
    const index = await fetchSmardIndex(resolution)

    const startMs = startOfDay(startDate).getTime()
    const endMs = startOfDay(endDate).getTime() + 24 * 60 * 60 * 1000 - 1 // End of day

    const weekTimestamps = findOverlappingWeekTimestamps(index, startMs, endMs)

    if (weekTimestamps.length === 0) {
      return null
    }

    // Load in parallel (max ~52 requests for a year)
    const weekResults = await Promise.allSettled(
      weekTimestamps.map(ts => fetchSmardWeek(ts, resolution))
    )

    // Merge all successful results
    const allPoints: SmardPricePoint[] = []
    for (const result of weekResults) {
      if (result.status === 'fulfilled') {
        allPoints.push(...result.value)
      }
    }

    if (allPoints.length === 0) {
      return null
    }

    // Filter to exact date range and convert
    const filtered = allPoints
      .filter(p => {
        if (p.price_eur_mwh === null) return false
        return p.timestamp >= startMs && p.timestamp <= endMs
      })
      .map(p => {
        const converted = convertSmardPrice(p)
        return {
          timestamp: converted.timestamp,
          price_ct_kwh: converted.price_ct_kwh ?? 0,
        }
      })
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

    return filtered.length > 0 ? filtered : null
  } catch (error) {
    console.error('SMARD batch error:', error)
    return null
  }
}

// --- aWATTar batch function ---

/**
 * Load aWATTar prices for entire date range (native range query)
 */
async function fetchAwattarBatch(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchAwattarRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('aWATTar batch error:', error)
    return null
  }
}

// --- Energy-Charts batch function ---

/**
 * Load Energy-Charts prices for entire date range (native range query)
 */
async function fetchEnergyChartsBatch(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[] | null> {
  try {
    const prices = await fetchEnergyChartsRange(startDate, endDate)
    return prices.length > 0 ? prices : null
  } catch (error) {
    console.error('Energy-Charts batch error:', error)
    return null
  }
}

// --- CSV batch function ---

/**
 * Load CSV data for all days in the date range
 */
async function fetchCsvBatch(
  startDate: Date,
  endDate: Date,
  type: 'day-ahead' | 'intraday'
): Promise<PricePoint[] | null> {
  try {
    const days = eachDayOfInterval({ start: startDate, end: endDate })
    const allPrices: PricePoint[] = []

    // Load sequentially (CSV reads from local files, fast enough)
    for (const day of days) {
      try {
        const csvPrices = await fetchCsvPrices(type, day)
        allPrices.push(...csvPrices)
      } catch {
        // Skip day if CSV not available
      }
    }

    return allPrices.length > 0 ? allPrices : null
  } catch (error) {
    console.error('CSV batch error:', error)
    return null
  }
}

// --- Demo data ---

/**
 * Generate realistic demo prices for entire date range.
 * Accounts for seasonal fluctuations (winter more expensive, summer cheaper).
 */
function generateDemoBatchPrices(startDate: Date, endDate: Date): PricePoint[] {
  const prices: PricePoint[] = []
  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // Seed function for reproducible pseudo-random numbers
  function seededRandom(seed: number): number {
    const x = Math.sin(seed) * 10000
    return x - Math.floor(x)
  }

  for (const day of days) {
    const month = getMonth(day) // 0-11
    const dayOfYear = differenceInDays(day, new Date(day.getFullYear(), 0, 1))

    // Seasonal factor: Winter (Dec-Feb) more expensive, Summer (Jun-Aug) cheaper
    let seasonalFactor = 1.0
    if (month >= 11 || month <= 1) {
      seasonalFactor = 1.3 // Winter: +30%
    } else if (month >= 5 && month <= 7) {
      seasonalFactor = 0.7 // Summer: -30% (solar surplus)
    } else if (month >= 2 && month <= 4) {
      seasonalFactor = 0.9 // Spring
    } else {
      seasonalFactor = 1.1 // Autumn
    }

    for (let hour = 0; hour < 24; hour++) {
      const time = addMinutes(startOfDay(day), hour * 60)
      const seed = dayOfYear * 100 + hour + day.getFullYear()

      // Daily pattern (ct/kWh)
      let basePrice: number
      if (hour >= 22 || hour < 6) {
        basePrice = 8 + seededRandom(seed) * 10 // Night: 8-18
      } else if (hour >= 6 && hour < 12) {
        basePrice = 18 + seededRandom(seed + 1) * 15 // Morning: 18-33
      } else if (hour >= 12 && hour < 18) {
        basePrice = 15 + seededRandom(seed + 2) * 12 // Midday: 15-27 (solar)
      } else {
        basePrice = 28 + seededRandom(seed + 3) * 25 // Evening peak: 28-53
      }

      basePrice *= seasonalFactor

      // Weekend discount
      const dayOfWeek = day.getDay()
      if (dayOfWeek === 0 || dayOfWeek === 6) {
        basePrice *= 0.85
      }

      prices.push({
        timestamp: time.toISOString(),
        price_ct_kwh: Math.round(basePrice * 100) / 100,
      })
    }
  }

  return prices
}

// --- Cache functions for batch ---

/**
 * Check which days are already cached
 */
async function getCachedDays(
  startDate: Date,
  endDate: Date,
  type: 'day-ahead' | 'intraday' | 'forward'
): Promise<Map<string, PricePoint[]>> {
  const cachedDays = new Map<string, PricePoint[]>()
  const days = eachDayOfInterval({ start: startDate, end: endDate })

  // Query all days in parallel
  const results = await Promise.allSettled(
    days.map(async day => {
      const dateStr = format(day, 'yyyy-MM-dd')
      const cached = await getCachedPrices(dateStr, type)
      return { dateStr, cached }
    })
  )

  for (const result of results) {
    if (result.status === 'fulfilled' && result.value.cached) {
      const { dateStr, cached } = result.value
      cachedDays.set(
        dateStr,
        cached.prices_json.map(p => ({
          timestamp: p.timestamp,
          price_ct_kwh: p.price_ct_kwh ?? 0,
        }))
      )
    }
  }

  return cachedDays
}

/**
 * Store new price data in cache by day
 */
async function cachePricesByDay(
  prices: PricePoint[],
  type: 'day-ahead' | 'intraday' | 'forward',
  source: 'awattar' | 'smard' | 'energy-charts' | 'csv'
): Promise<void> {
  // Group prices by day
  const byDay = new Map<string, PricePoint[]>()

  for (const price of prices) {
    const dateStr = format(new Date(price.timestamp), 'yyyy-MM-dd')
    if (!byDay.has(dateStr)) {
      byDay.set(dateStr, [])
    }
    byDay.get(dateStr)!.push(price)
  }

  // Save in parallel
  await Promise.allSettled(
    Array.from(byDay.entries()).map(([dateStr, dayPrices]) =>
      setCachedPrices(dateStr, type, source, dayPrices)
    )
  )
}

// --- API Route ---

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams

  // Zod validation
  const parseResult = batchQuerySchema.safeParse({
    startDate: searchParams.get('startDate'),
    endDate: searchParams.get('endDate'),
    type: searchParams.get('type') || 'day-ahead',
    resolution: searchParams.get('resolution') || 'hour',
  })

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: 'Invalid parameters',
        details: parseResult.error.issues.map(i => i.message),
      },
      { status: 400 }
    )
  }

  const { startDate: startDateStr, endDate: endDateStr, type, resolution } = parseResult.data

  const startDate = parseISO(startDateStr)
  const endDate = parseISO(endDateStr)

  // Date validation
  if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
    return NextResponse.json(
      { error: 'Invalid date format. Use YYYY-MM-DD' },
      { status: 400 }
    )
  }

  if (isAfter(startDate, endDate)) {
    return NextResponse.json(
      { error: 'startDate must be before endDate' },
      { status: 400 }
    )
  }

  // Maximum 400 days (slightly more than 1 year)
  const dayCount = differenceInDays(endDate, startDate) + 1
  if (dayCount > 400) {
    return NextResponse.json(
      { error: 'Maximum date range: 400 days' },
      { status: 400 }
    )
  }

  // Step 1: Check cache
  const cachedDays = await getCachedDays(startDate, endDate, type)
  const allDays = eachDayOfInterval({ start: startDate, end: endDate })
  const uncachedDays = allDays.filter(d => !cachedDays.has(format(d, 'yyyy-MM-dd')))

  // If everything is cached, return directly
  if (uncachedDays.length === 0) {
    const allPrices: PricePoint[] = []
    for (const day of allDays) {
      const dayPrices = cachedDays.get(format(day, 'yyyy-MM-dd'))
      if (dayPrices) allPrices.push(...dayPrices)
    }

    return NextResponse.json({
      type,
      startDate: startDateStr,
      endDate: endDateStr,
      source: 'cache',
      count: allPrices.length,
      prices: allPrices,
    })
  }

  // Step 2: Load missing data
  let fetchedPrices: PricePoint[] | null = null
  let source: 'awattar' | 'smard' | 'energy-charts' | 'csv' | 'demo' = 'demo'

  // Only load missing days: calculate range of missing days
  const uncachedStart = uncachedDays[0]
  const uncachedEnd = uncachedDays[uncachedDays.length - 1]

  if (type === 'day-ahead' && resolution === 'quarterhour') {
    // Quarter-hourly: only SMARD has 15-min data
    fetchedPrices = await fetchSmardBatch(uncachedStart, uncachedEnd, 'quarterhour')
    if (fetchedPrices && fetchedPrices.length > 0) {
      source = 'smard'
    }
  } else if (type === 'day-ahead') {
    // Step 2a: aWATTar (native range query, fastest source)
    fetchedPrices = await fetchAwattarBatch(uncachedStart, uncachedEnd)
    if (fetchedPrices && fetchedPrices.length > 0) {
      source = 'awattar'
    } else {
      // Step 2b: SMARD API (weekly, parallel)
      fetchedPrices = await fetchSmardBatch(uncachedStart, uncachedEnd)
      if (fetchedPrices && fetchedPrices.length > 0) {
        source = 'smard'
      } else {
        // Step 2c: Energy-Charts (native range query)
        fetchedPrices = await fetchEnergyChartsBatch(uncachedStart, uncachedEnd)
        if (fetchedPrices && fetchedPrices.length > 0) {
          source = 'energy-charts'
        } else {
          // Step 2d: CSV fallback
          fetchedPrices = await fetchCsvBatch(uncachedStart, uncachedEnd, 'day-ahead')
          if (fetchedPrices && fetchedPrices.length > 0) {
            source = 'csv'
          }
        }
      }
    }
  } else {
    // Intraday/Forward: CSV only
    const csvType = type === 'forward' ? 'day-ahead' : (type as 'day-ahead' | 'intraday')
    fetchedPrices = await fetchCsvBatch(uncachedStart, uncachedEnd, csvType)
    if (fetchedPrices && fetchedPrices.length > 0) {
      source = 'csv'
    }
  }

  // Step 2e: Demo data fallback
  if (!fetchedPrices || fetchedPrices.length === 0) {
    fetchedPrices = generateDemoBatchPrices(uncachedStart, uncachedEnd)
    source = 'demo'
  }

  // Step 3: Update cache (do not cache demo data)
  if (source !== 'demo' && fetchedPrices.length > 0) {
    try {
      await cachePricesByDay(fetchedPrices, type, source)
    } catch (error) {
      console.error('Batch cache write error (non-fatal):', error)
    }
  }

  // Step 4: Merge cache + freshly loaded data
  const allPrices: PricePoint[] = []

  for (const day of allDays) {
    const dateStr = format(day, 'yyyy-MM-dd')
    const cached = cachedDays.get(dateStr)
    if (cached) {
      allPrices.push(...cached)
    } else {
      // Extract data for this day from fetchedPrices
      const dayStart = startOfDay(day).getTime()
      const dayEnd = dayStart + 24 * 60 * 60 * 1000 - 1
      const dayPrices = fetchedPrices.filter(p => {
        const ts = new Date(p.timestamp).getTime()
        return ts >= dayStart && ts <= dayEnd
      })
      allPrices.push(...dayPrices)
    }
  }

  return NextResponse.json({
    type,
    startDate: startDateStr,
    endDate: endDateStr,
    source: cachedDays.size > 0 ? `mixed (${cachedDays.size} cached)` : source,
    count: allPrices.length,
    prices: allPrices,
  })
}
