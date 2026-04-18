/**
 * Elexon BMRS API Client
 *
 * UK day-ahead reference price source. Elexon publishes the Market Index Data
 * (MID) dataset with half-hourly settlement-period prices from both UK
 * day-ahead exchanges:
 *   - APXMIDP  — EPEX Spot UK
 *   - N2EXMIDP — Nord Pool N2EX
 *
 * The canonical UK day-ahead reference price is the volume-weighted mean of
 * both providers. When one provider has not published yet (volume=0), we fall
 * back to the other.
 *
 * Prices are in GBP/MWh. We convert to GBp/kWh (pence per kWh) to keep the
 * same field name `price_ct_kwh` used by the rest of the pipeline, but tag
 * entries with `currency: 'GBP'` so the UI can render the correct symbol.
 *
 * Endpoint: https://data.elexon.co.uk/bmrs/api/v1/datasets/MID
 * No authentication required for this dataset.
 * Documentation: https://bmrs.elexon.co.uk/api-documentation
 *
 * UK market runs in half-hour settlement periods (48/day). For parity with
 * DE/NL we expose the same shape (timestamp + price_ct_kwh) and callers that
 * need QH resolution can expand each 30-min slot to two 15-min slots.
 */

import type { PricePoint } from '@/lib/config'
import { format, addDays } from 'date-fns'

const ELEXON_BASE_URL = 'https://data.elexon.co.uk/bmrs/api/v1'

interface ElexonMidPoint {
  dataset: 'MID'
  startTime: string
  dataProvider: 'APXMIDP' | 'N2EXMIDP'
  settlementDate: string
  settlementPeriod: number
  price: number
  volume: number
}

interface ElexonResponse {
  data?: ElexonMidPoint[]
}

/**
 * Aggregate per-provider points into a single volume-weighted reference price
 * per settlement period. Falls back to the non-zero provider when the other
 * has not published yet.
 */
function aggregateMid(points: ElexonMidPoint[]): PricePoint[] {
  const byTs = new Map<string, ElexonMidPoint[]>()
  for (const p of points) {
    if (!byTs.has(p.startTime)) byTs.set(p.startTime, [])
    byTs.get(p.startTime)!.push(p)
  }

  const result: PricePoint[] = []
  for (const [ts, providers] of byTs) {
    const nonZero = providers.filter(p => p.volume > 0 && Number.isFinite(p.price))
    let priceGbpMwh: number | null = null
    if (nonZero.length === providers.length && providers.length > 1) {
      // Full coverage — volume-weighted mean
      const totalVol = providers.reduce((s, p) => s + p.volume, 0)
      const weightedSum = providers.reduce((s, p) => s + p.price * p.volume, 0)
      priceGbpMwh = totalVol > 0 ? weightedSum / totalVol : null
    } else if (nonZero.length > 0) {
      // Partial — take the non-zero provider (typically APXMIDP first)
      priceGbpMwh = nonZero[0].price
    }
    if (priceGbpMwh === null) continue
    // GBP/MWh → GBp/kWh: divide by 10 (same ratio as EUR/MWh → ct/kWh)
    result.push({
      timestamp: new Date(ts).toISOString(),
      price_ct_kwh: Math.round(priceGbpMwh * 10) / 100,
    })
  }
  return result.sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  )
}

async function fetchChunk(startDate: Date, endDate: Date): Promise<ElexonMidPoint[]> {
  const from = format(startDate, 'yyyy-MM-dd')
  const to = format(addDays(endDate, 1), 'yyyy-MM-dd')
  const url = `${ELEXON_BASE_URL}/datasets/MID?from=${from}&to=${to}&format=json`

  const res = await fetch(url, { next: { revalidate: 3600 } })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`Elexon MID request failed: ${res.status} ${text.slice(0, 200)}`)
  }
  const body = (await res.json()) as ElexonResponse
  return body.data ?? []
}

/**
 * Fetch UK day-ahead reference prices (half-hourly) for a date range.
 * Elexon caps each request at 7 days, so larger ranges are chunked.
 */
const CHUNK_DAYS = 7

export async function fetchElexonMidRange(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[]> {
  const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / 86400000)
  if (diffDays <= CHUNK_DAYS) {
    const points = await fetchChunk(startDate, endDate)
    return aggregateMid(points)
  }

  const all: ElexonMidPoint[] = []
  let cursor = new Date(startDate)
  while (cursor <= endDate) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + (CHUNK_DAYS - 1) * 86400000, endDate.getTime()))
    const points = await fetchChunk(cursor, chunkEnd)
    all.push(...points)
    cursor = addDays(chunkEnd, 1)
  }
  return aggregateMid(all)
}
