/**
 * Generation Mix API — fetch hourly generation by fuel type from SMARD
 * Returns gas, coal, lignite, solar, wind, load, and residual load
 * for a date range (max 90 days).
 */
import { NextRequest, NextResponse } from 'next/server'

const SMARD_BASE = 'https://www.smard.de/app/chart_data'

const FILTERS = {
  GAS: 4071,
  HARD_COAL: 4069,
  LIGNITE: 1223,
  SOLAR: 4068,
  WIND_ONSHORE: 4067,
  WIND_OFFSHORE: 1225,
  GRID_LOAD: 410,
  BIOMASS: 4066,
} as const

async function fetchSmardChunks(filter: number, startDate: Date, endDate: Date): Promise<Map<number, number>> {
  // Get index
  const indexUrl = `${SMARD_BASE}/${filter}/DE/index_hour.json`
  const indexRes = await fetch(indexUrl, { next: { revalidate: 3600 } })
  if (!indexRes.ok) throw new Error(`SMARD index ${filter}: ${indexRes.status}`)
  const indexData = await indexRes.json()
  const timestamps: number[] = Array.isArray(indexData) ? indexData : indexData.timestamps || []

  const startMs = startDate.getTime()
  const endMs = endDate.getTime()

  // Find all chunks that overlap our range
  const relevantChunks: number[] = []
  for (let i = 0; i < timestamps.length; i++) {
    const chunkStart = timestamps[i]
    const chunkEnd = i < timestamps.length - 1 ? timestamps[i + 1] : chunkStart + 7 * 24 * 3600 * 1000
    if (chunkEnd >= startMs && chunkStart <= endMs) {
      relevantChunks.push(chunkStart)
    }
  }

  const map = new Map<number, number>()
  for (const ts of relevantChunks) {
    const url = `${SMARD_BASE}/${filter}/DE/${filter}_DE_hour_${ts}.json`
    try {
      const res = await fetch(url, { next: { revalidate: 3600 } })
      if (!res.ok) continue
      const data = await res.json()
      if (data.series) {
        for (const [t, val] of data.series) {
          if (val !== null && t >= startMs && t <= endMs) map.set(t, val)
        }
      }
    } catch { /* skip failed chunks */ }
  }
  return map
}

export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl
  const from = searchParams.get('from')
  const to = searchParams.get('to')

  if (!from || !to || !/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) {
    return NextResponse.json({ error: 'Missing from/to (YYYY-MM-DD)' }, { status: 400 })
  }

  const startDate = new Date(from + 'T00:00:00+01:00')
  const endDate = new Date(to + 'T23:59:59+01:00')

  // Max 90 days
  if (endDate.getTime() - startDate.getTime() > 90 * 24 * 3600 * 1000) {
    return NextResponse.json({ error: 'Max 90 day range' }, { status: 400 })
  }

  try {
    const [gas, coal, lignite, solar, windOn, windOff, load, biomass] = await Promise.all([
      fetchSmardChunks(FILTERS.GAS, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.HARD_COAL, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.LIGNITE, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.SOLAR, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.WIND_ONSHORE, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.WIND_OFFSHORE, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.GRID_LOAD, startDate, endDate).catch(() => new Map<number, number>()),
      fetchSmardChunks(FILTERS.BIOMASS, startDate, endDate).catch(() => new Map<number, number>()),
    ])

    // Merge all timestamps
    const allTs = new Set<number>()
    for (const m of [gas, coal, lignite, solar, windOn, windOff, load]) {
      for (const ts of m.keys()) allTs.add(ts)
    }

    const hourly = Array.from(allTs).sort().map(ts => {
      const gasMw = gas.get(ts) ?? 0
      const coalMw = coal.get(ts) ?? 0
      const ligniteMw = lignite.get(ts) ?? 0
      const solarMw = solar.get(ts) ?? 0
      const windMw = (windOn.get(ts) ?? 0) + (windOff.get(ts) ?? 0)
      const biomassMw = biomass.get(ts) ?? 0
      const loadMw = load.get(ts) ?? 0
      const renewableMw = solarMw + windMw + biomassMw
      const residualMw = loadMw - renewableMw // residual load = what fossil must cover

      const dt = new Date(ts)
      const dateStr = dt.toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' }) // YYYY-MM-DD
      const hourStr = dt.toLocaleString('en-US', { timeZone: 'Europe/Berlin', hour: 'numeric', hour12: false })
      const hour = parseInt(hourStr, 10)

      return {
        ts, date: dateStr, hour: isNaN(hour) ? dt.getUTCHours() + 1 : hour,
        gasMw: Math.round(gasMw),
        coalMw: Math.round(coalMw),
        ligniteMw: Math.round(ligniteMw),
        solarMw: Math.round(solarMw),
        windMw: Math.round(windMw),
        biomassMw: Math.round(biomassMw),
        loadMw: Math.round(loadMw),
        renewableMw: Math.round(renewableMw),
        residualMw: Math.round(residualMw),
        gasSharePct: loadMw > 0 ? Math.round((gasMw / loadMw) * 1000) / 10 : 0,
        renewableSharePct: loadMw > 0 ? Math.round((renewableMw / loadMw) * 1000) / 10 : 0,
      }
    })

    return NextResponse.json({ from, to, count: hourly.length, hourly }, {
      headers: { 'Cache-Control': 'public, max-age=3600, stale-while-revalidate=86400' },
    })
  } catch (error) {
    console.error('Generation mix fetch error:', error)
    return NextResponse.json({ error: 'Failed to fetch generation mix' }, { status: 500 })
  }
}
