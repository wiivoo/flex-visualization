/**
 * Prices API Route
 * Returns electricity market prices with multi-level fallback:
 * 1. Supabase Cache
 * 2. SMARD API (Primary - Day-Ahead only)
 * 3. CSV Files (Fallback)
 * 4. Demo Data (Final fallback)
 *
 * Query params:
 * - type: day-ahead | intraday | forward
 * - date: YYYY-MM-DD
 */

import { NextRequest, NextResponse } from 'next/server'
import { parseISO, format, startOfDay, addMinutes } from 'date-fns'
import { fetchSmardDayAhead, convertSmardPrice } from '@/lib/smard'
import { fetchCsvPrices, hasCsvData } from '@/lib/csv-prices'
import { getCachedPrices, setCachedPrices } from '@/lib/price-cache'

export interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

// Demo data fallback - realistic price distribution for Germany
function generateDemoPrices(date: Date): PricePoint[] {
  const prices: PricePoint[] = []
  const baseDate = startOfDay(date)

  for (let hour = 0; hour < 24; hour++) {
    for (let quarter = 0; quarter < 4; quarter++) {
      const time = addMinutes(baseDate, hour * 60 + quarter * 15)

      // Realistic German day-ahead price pattern (ct/kWh)
      let basePrice = 25

      // Night (22:00 - 06:00): Cheapest
      if (hour >= 22 || hour < 6) {
        basePrice = 12 + Math.random() * 10
      }
      // Morning (06:00 - 12:00): Rising
      else if (hour >= 6 && hour < 12) {
        basePrice = 20 + Math.random() * 15
      }
      // Midday (12:00 - 18:00): Moderate (solar production)
      else if (hour >= 12 && hour < 18) {
        basePrice = 25 + Math.random() * 10
      }
      // Evening (18:00 - 22:00): Peak
      else {
        basePrice = 35 + Math.random() * 25
      }

      prices.push({
        timestamp: time.toISOString(),
        price_ct_kwh: Math.round(basePrice * 100) / 100
      })
    }
  }

  return prices
}

/**
 * Fetch from SMARD API (Day-Ahead only)
 */
async function fetchFromSmard(date: Date): Promise<PricePoint[] | null> {
  try {
    const smardData = await fetchSmardDayAhead(date)
    return smardData.map(p => {
      const converted = convertSmardPrice(p)
      return {
        timestamp: converted.timestamp,
        price_ct_kwh: converted.price_ct_kwh ?? 0
      }
    })
  } catch (error) {
    console.error('SMARD fetch error:', error)
    return null
  }
}

/**
 * Fetch from CSV files (Fallback)
 */
async function fetchFromCsv(
  date: Date,
  type: 'day-ahead' | 'intraday'
): Promise<PricePoint[] | null> {
  try {
    const csvPrices = await fetchCsvPrices(type, date)
    return csvPrices
  } catch (error) {
    console.error('CSV fetch error:', error)
    return null
  }
}

/**
 * Generate demo data (Final fallback)
 */
function fetchDemoData(date: Date): { prices: PricePoint[]; source: 'demo' } {
  return {
    prices: generateDemoPrices(date),
    source: 'demo'
  }
}

export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams
  const type = (searchParams.get('type') || 'day-ahead') as
    | 'day-ahead'
    | 'intraday'
    | 'forward'
  const dateStr = searchParams.get('date')

  // Validate date parameter
  if (!dateStr) {
    return NextResponse.json(
      { error: 'Date parameter required (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  const date = parseISO(dateStr)
  if (isNaN(date.getTime())) {
    return NextResponse.json(
      { error: 'Invalid date format. Use YYYY-MM-DD' },
      { status: 400 }
    )
  }

  // Validate type parameter
  if (!['day-ahead', 'intraday', 'forward'].includes(type)) {
    return NextResponse.json(
      { error: 'Invalid type. Use day-ahead, intraday, or forward' },
      { status: 400 }
    )
  }

  // Step 1: Check Supabase Cache
  const cached = await getCachedPrices(dateStr, type)
  if (cached) {
    return NextResponse.json({
      type,
      date: dateStr,
      source: cached.source,
      fromCache: true,
      prices: cached.prices_json
    })
  }

  let result: { prices: PricePoint[]; source: 'smard' | 'csv' | 'demo' }

  // Step 2: Try SMARD API (Day-Ahead only)
  if (type === 'day-ahead') {
    const smardPrices = await fetchFromSmard(date)
    if (smardPrices && smardPrices.length > 0) {
      result = { prices: smardPrices, source: 'smard' }
    } else {
      // Step 3: Fallback to CSV
      const csvPrices = await fetchFromCsv(date, 'day-ahead')
      if (csvPrices && csvPrices.length > 0) {
        result = { prices: csvPrices, source: 'csv' }
      } else {
        // Step 4: Final fallback to demo data
        result = fetchDemoData(date)
      }
    }
  }
  // Intraday and Forward: CSV only (no API source)
  else {
    const csvType = type === 'forward' ? 'day-ahead' : type
    const csvPrices = await fetchFromCsv(date, csvType as 'day-ahead' | 'intraday')
    if (csvPrices && csvPrices.length > 0) {
      result = { prices: csvPrices, source: 'csv' }
    } else {
      // Final fallback
      result = fetchDemoData(date)
    }
  }

  // Cache the result (don't cache demo data)
  if (result.source !== 'demo') {
    try {
      await setCachedPrices(dateStr, type, result.source, result.prices)
    } catch (error) {
      console.error('Cache write failed (non-fatal):', error)
    }
  }

  return NextResponse.json({
    type,
    date: dateStr,
    source: result.source,
    fromCache: false,
    prices: result.prices
  })
}
