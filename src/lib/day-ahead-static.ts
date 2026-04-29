import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

type StaticCountry = 'DE' | 'NL'

interface CompactPoint {
  t: number
  p: number
}

interface PricePoint {
  timestamp: string
  price_ct_kwh: number
}

const STATIC_FILES: Record<StaticCountry, Record<'hour' | 'quarterhour', string>> = {
  DE: {
    hour: 'smard-prices.json',
    quarterhour: 'smard-prices-qh.json',
  },
  NL: {
    hour: 'nl-prices.json',
    quarterhour: 'nl-prices-qh.json',
  },
}

export function readStaticDayAheadRange(
  country: StaticCountry,
  startDate: Date,
  endDate: Date,
  resolution: 'hour' | 'quarterhour',
): PricePoint[] | null {
  const filePath = join(process.cwd(), 'public', 'data', STATIC_FILES[country][resolution])
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
    .filter((point) => point.t >= startMs && point.t <= endMs)
    .map((point) => ({
      timestamp: new Date(point.t).toISOString(),
      price_ct_kwh: Math.round((point.p / 10) * 100) / 100,
    }))
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())

  return points.length > 0 ? points : null
}
