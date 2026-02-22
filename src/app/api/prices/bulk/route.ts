/**
 * Bulk Price API — fetch date range of hourly day-ahead prices
 * Primary: aWATTar API (simple range queries, no auth)
 * Fallback: SMARD API
 */
import { NextRequest, NextResponse } from 'next/server'

const AWATTAR_BASE = 'https://api.awattar.de/v1/marketdata'

interface AwattarEntry {
  start_timestamp: number
  end_timestamp: number
  marketprice: number
  unit: string
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const startDate = searchParams.get('start') // YYYY-MM-DD
  const endDate = searchParams.get('end')     // YYYY-MM-DD

  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: 'Missing start/end parameters (YYYY-MM-DD)' },
      { status: 400 }
    )
  }

  try {
    const startMs = new Date(startDate + 'T00:00:00Z').getTime()
    const endMs = new Date(endDate + 'T23:59:59Z').getTime()

    if (isNaN(startMs) || isNaN(endMs)) {
      return NextResponse.json({ error: 'Invalid date format' }, { status: 400 })
    }

    // aWATTar supports up to ~90 days in a single request reliably
    // For larger ranges, chunk into 30-day blocks
    const chunkMs = 30 * 24 * 60 * 60 * 1000
    const chunks: { start: number; end: number }[] = []

    let cursor = startMs
    while (cursor < endMs) {
      const chunkEnd = Math.min(cursor + chunkMs, endMs)
      chunks.push({ start: cursor, end: chunkEnd })
      cursor = chunkEnd + 1
    }

    // Fetch all chunks in parallel
    const results = await Promise.allSettled(
      chunks.map(async (chunk) => {
        const url = `${AWATTAR_BASE}?start=${chunk.start}&end=${chunk.end}`
        const res = await fetch(url)
        if (!res.ok) throw new Error(`aWATTar ${res.status}`)
        const json = await res.json()
        return (json.data || []) as AwattarEntry[]
      })
    )

    // Flatten and deduplicate by timestamp
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

    prices.sort((a, b) => a.timestamp - b.timestamp)

    return NextResponse.json({
      source: 'awattar',
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
    return NextResponse.json(
      { error: 'Failed to fetch prices', details: String(error) },
      { status: 500 }
    )
  }
}
