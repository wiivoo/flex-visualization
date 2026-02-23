/**
 * Bulk Price API — fetch date range of hourly day-ahead prices
 * Primary: SMARD API (official German market data)
 * Fallback: aWATTar API
 */
import { NextRequest, NextResponse } from 'next/server'

const SMARD_BASE = 'https://www.smard.de/app/chart_data'
const SMARD_FILTER_PRICE = 4169 // Marktpreis DE-LU (Day-Ahead)
const AWATTAR_BASE = 'https://api.awattar.de/v1/marketdata'

async function fetchFromSmard(startMs: number, endMs: number): Promise<{ timestamp: number; priceEurMwh: number; priceCtKwh: number }[]> {
  // 1. Get index of available weekly timestamps
  const indexUrl = `${SMARD_BASE}/${SMARD_FILTER_PRICE}/DE/index_hour.json`
  const indexRes = await fetch(indexUrl, { next: { revalidate: 3600 } })
  if (!indexRes.ok) throw new Error(`SMARD index: ${indexRes.status}`)
  const timestamps: number[] = await indexRes.json()

  // 2. Find all weekly chunks that overlap our date range
  const relevantTimestamps = timestamps.filter((ts, i) => {
    const nextTs = timestamps[i + 1] ?? ts + 7 * 24 * 3600 * 1000
    // Chunk covers [ts, nextTs). Does it overlap [startMs, endMs]?
    return ts <= endMs && nextTs >= startMs
  })

  // 3. Fetch all relevant weekly chunks in parallel (batch to avoid overwhelming)
  const BATCH_SIZE = 20
  const allPrices: { timestamp: number; priceEurMwh: number; priceCtKwh: number }[] = []
  const seen = new Set<number>()

  for (let i = 0; i < relevantTimestamps.length; i += BATCH_SIZE) {
    const batch = relevantTimestamps.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(async (ts) => {
        const url = `${SMARD_BASE}/${SMARD_FILTER_PRICE}/DE/${SMARD_FILTER_PRICE}_DE_hour_${ts}.json`
        const res = await fetch(url, { next: { revalidate: 3600 } })
        if (!res.ok) throw new Error(`SMARD chunk ${ts}: ${res.status}`)
        const data = await res.json()
        return (data.series || []) as [number, number | null][]
      })
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const [ts, price] of result.value) {
          if (price !== null && ts >= startMs && ts <= endMs && !seen.has(ts)) {
            seen.add(ts)
            allPrices.push({
              timestamp: ts,
              priceEurMwh: price,
              priceCtKwh: Math.round((price / 10) * 100) / 100,
            })
          }
        }
      }
    }
  }

  return allPrices
}

async function fetchFromAwattar(startMs: number, endMs: number): Promise<{ timestamp: number; priceEurMwh: number; priceCtKwh: number }[]> {
  const chunkMs = 30 * 24 * 60 * 60 * 1000
  const chunks: { start: number; end: number }[] = []
  let cursor = startMs
  while (cursor < endMs) {
    const chunkEnd = Math.min(cursor + chunkMs, endMs)
    chunks.push({ start: cursor, end: chunkEnd })
    cursor = chunkEnd + 1
  }

  const results = await Promise.allSettled(
    chunks.map(async (chunk) => {
      const url = `${AWATTAR_BASE}?start=${chunk.start}&end=${chunk.end}`
      const res = await fetch(url)
      if (!res.ok) throw new Error(`aWATTar ${res.status}`)
      const json = await res.json()
      return (json.data || []) as { start_timestamp: number; marketprice: number }[]
    })
  )

  const seen = new Set<number>()
  const prices: { timestamp: number; priceEurMwh: number; priceCtKwh: number }[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const entry of result.value) {
        if (!seen.has(entry.start_timestamp) && entry.marketprice !== null) {
          seen.add(entry.start_timestamp)
          prices.push({
            timestamp: entry.start_timestamp,
            priceEurMwh: entry.marketprice,
            priceCtKwh: Math.round((entry.marketprice / 10) * 100) / 100,
          })
        }
      }
    }
  }
  return prices
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('start')
  const endDate = searchParams.get('end')

  if (!startDate || !endDate) {
    return NextResponse.json({ error: 'Missing start/end parameters (YYYY-MM-DD)' }, { status: 400 })
  }

  const dateRegex = /^\d{4}-\d{2}-\d{2}$/
  if (!dateRegex.test(startDate) || !dateRegex.test(endDate)) {
    return NextResponse.json({ error: 'Invalid date format. Use YYYY-MM-DD.' }, { status: 400 })
  }

  try {
    const startMs = new Date(startDate + 'T00:00:00Z').getTime()
    const endMs = new Date(endDate + 'T23:59:59Z').getTime()

    if (isNaN(startMs) || isNaN(endMs)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }

    const maxRangeMs = 5 * 365.25 * 24 * 60 * 60 * 1000
    if (endMs - startMs > maxRangeMs) {
      return NextResponse.json({ error: 'Date range exceeds maximum of 5 years' }, { status: 400 })
    }

    if (startMs > endMs) {
      return NextResponse.json({ error: 'Start date must be before end date' }, { status: 400 })
    }

    // Try SMARD first, fallback to aWATTar
    let prices: { timestamp: number; priceEurMwh: number; priceCtKwh: number }[]
    let source = 'smard'

    try {
      prices = await fetchFromSmard(startMs, endMs)
      if (prices.length === 0) throw new Error('No data from SMARD')
    } catch (smardError) {
      console.warn('SMARD failed, falling back to aWATTar:', smardError)
      source = 'awattar'
      prices = await fetchFromAwattar(startMs, endMs)
    }

    prices.sort((a, b) => a.timestamp - b.timestamp)

    return NextResponse.json({
      source,
      count: prices.length,
      start: startDate,
      end: endDate,
      prices,
    }, {
      headers: {
        'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400',
      },
    })
  } catch (error) {
    console.error('Bulk price fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch prices' }, { status: 500 })
  }
}
