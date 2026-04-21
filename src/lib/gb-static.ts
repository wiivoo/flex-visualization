import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { GbDayAheadAuction } from '@/lib/gb-day-ahead'

interface CompactPoint {
  t: number
  p: number
}

interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

const GB_STATIC_FILES: Record<GbDayAheadAuction, Record<'hour' | 'quarterhour', string>> = {
  daa1: {
    hour: 'gb-daa1-prices.json',
    quarterhour: 'gb-daa1-prices-qh.json',
  },
  daa2: {
    hour: 'gb-daa2-prices.json',
    quarterhour: 'gb-daa2-prices-qh.json',
  },
}

export function readGbStaticRange(
  startDate: Date,
  endDate: Date,
  auction: GbDayAheadAuction,
  resolution: 'hour' | 'quarterhour',
): PricePoint[] | null {
  const fileName = GB_STATIC_FILES[auction][resolution]
  const filePath = join(process.cwd(), 'public', 'data', fileName)
  if (!existsSync(filePath)) return null

  let raw: CompactPoint[]
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return null
  }

  const startMs = Date.UTC(startDate.getUTCFullYear(), startDate.getUTCMonth(), startDate.getUTCDate(), 0, 0, 0, 0)
  const endMs = Date.UTC(endDate.getUTCFullYear(), endDate.getUTCMonth(), endDate.getUTCDate(), 23, 59, 59, 999)

  const points = raw
    .filter(point => point.t >= startMs && point.t <= endMs)
    .map(point => ({
      timestamp: new Date(point.t).toISOString(),
      price_ct_kwh: point.p,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return points.length > 0 ? points : null
}
