/**
 * Generation Data API — fetch hourly solar, wind, and grid load from SMARD
 * Used to show renewable share overlay on price charts
 */
import { NextRequest, NextResponse } from 'next/server'

const SMARD_BASE = 'https://www.smard.de/app/chart_data'

const FILTERS = {
  SOLAR: 4068,
  WIND_ONSHORE: 4067,
  WIND_OFFSHORE: 1225,
  GRID_LOAD: 410,
} as const

interface SmardSeries {
  series: [number, number | null][]
}

async function fetchSmardFilter(filter: number, date: Date): Promise<Map<number, number>> {
  // Get index of available timestamps
  const indexUrl = `${SMARD_BASE}/${filter}/DE/index_hour.json`
  const indexRes = await fetch(indexUrl, { next: { revalidate: 3600 } })
  if (!indexRes.ok) throw new Error(`SMARD index ${filter}: ${indexRes.status}`)
  const indexData = await indexRes.json()
  // SMARD returns { timestamps: [...] }, not a plain array
  const timestamps: number[] = Array.isArray(indexData) ? indexData : indexData.timestamps || []
  if (timestamps.length === 0) throw new Error(`SMARD index ${filter} empty`)

  // Find the timestamp bucket containing our date
  const targetMs = date.getTime()
  let bestTimestamp = timestamps[timestamps.length - 1]
  for (let i = timestamps.length - 1; i >= 0; i--) {
    if (timestamps[i] <= targetMs) {
      bestTimestamp = timestamps[i]
      break
    }
  }

  // Fetch the time series
  const dataUrl = `${SMARD_BASE}/${filter}/DE/${filter}_DE_hour_${bestTimestamp}.json`
  const dataRes = await fetch(dataUrl, { next: { revalidate: 3600 } })
  if (!dataRes.ok) throw new Error(`SMARD data ${filter}: ${dataRes.status}`)
  const data: SmardSeries = await dataRes.json()

  const map = new Map<number, number>()
  if (data.series) {
    for (const [ts, val] of data.series) {
      if (val !== null) map.set(ts, val)
    }
  }
  return map
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const dateStr = searchParams.get('date')

  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    return NextResponse.json({ error: 'Missing or invalid date parameter (YYYY-MM-DD)' }, { status: 400 })
  }

  const date = new Date(dateStr + 'T12:00:00Z')
  if (isNaN(date.getTime())) {
    return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
  }

  try {
    // Fetch all filters in parallel
    const [solar, windOnshore, windOffshore, gridLoad] = await Promise.all([
      fetchSmardFilter(FILTERS.SOLAR, date).catch(() => new Map<number, number>()),
      fetchSmardFilter(FILTERS.WIND_ONSHORE, date).catch(() => new Map<number, number>()),
      fetchSmardFilter(FILTERS.WIND_OFFSHORE, date).catch(() => new Map<number, number>()),
      fetchSmardFilter(FILTERS.GRID_LOAD, date).catch(() => new Map<number, number>()),
    ])

    // Filter to requested day and merge
    const startOfDay = new Date(dateStr + 'T00:00:00+01:00').getTime()
    const endOfDay = new Date(dateStr + 'T23:59:59+01:00').getTime()

    // Collect all timestamps from all sources
    const allTimestamps = new Set<number>()
    for (const ts of solar.keys()) if (ts >= startOfDay && ts <= endOfDay) allTimestamps.add(ts)
    for (const ts of windOnshore.keys()) if (ts >= startOfDay && ts <= endOfDay) allTimestamps.add(ts)
    for (const ts of gridLoad.keys()) if (ts >= startOfDay && ts <= endOfDay) allTimestamps.add(ts)

    const hourly = Array.from(allTimestamps).sort().map(ts => {
      const solarMw = solar.get(ts) ?? 0
      const windOnMw = windOnshore.get(ts) ?? 0
      const windOffMw = windOffshore.get(ts) ?? 0
      const loadMw = gridLoad.get(ts) ?? 1 // avoid division by zero
      const renewableMw = solarMw + windOnMw + windOffMw
      const renewableShare = loadMw > 0 ? Math.round((renewableMw / loadMw) * 1000) / 10 : 0

      // Use CET/CEST consistently (German local time)
      const hourStr = new Date(ts).toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
      const hour = parseInt(hourStr, 10)

      return {
        timestamp: ts,
        hour: isNaN(hour) ? new Date(ts).getUTCHours() + 1 : hour, // fallback to UTC+1
        solarMw: Math.round(solarMw),
        windMw: Math.round(windOnMw + windOffMw),
        loadMw: Math.round(loadMw),
        renewableMw: Math.round(renewableMw),
        renewableShare, // percentage
      }
    })

    return NextResponse.json({
      date: dateStr,
      source: 'smard',
      hourly,
    }, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    })
  } catch (error) {
    console.error('Generation fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch generation data' }, { status: 500 })
  }
}
