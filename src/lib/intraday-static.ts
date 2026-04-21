import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

export interface StaticIntradayPoint {
  timestamp: string
  price_ct_kwh: number | null
  id_full_ct: number | null
  id1_ct: number | null
  id3_ct: number | null
  weight_avg_ct: number | null
  low_ct: number | null
  high_ct: number | null
  last_ct: number | null
  buy_vol_mwh: number | null
  sell_vol_mwh: number | null
  volume_mwh: number | null
}

const STATIC_INTRADAY_FILES = {
  DE: 'de-intraday-continuous.json',
  NL: 'nl-intraday-continuous.json',
  GB: 'gb-intraday-continuous.json',
} as const

export function readStaticIntradayRange(
  country: keyof typeof STATIC_INTRADAY_FILES,
  startDate: Date,
  endDate: Date,
): Map<string, StaticIntradayPoint[]> {
  const fileName = STATIC_INTRADAY_FILES[country]
  const filePath = join(process.cwd(), 'public', 'data', fileName)
  const days = new Map<string, StaticIntradayPoint[]>()
  if (!existsSync(filePath)) return days

  let raw: StaticIntradayPoint[]
  try {
    raw = JSON.parse(readFileSync(filePath, 'utf8'))
  } catch {
    return days
  }

  const startStr = startDate.toISOString().slice(0, 10)
  const endStr = endDate.toISOString().slice(0, 10)
  for (const point of raw) {
    const date = point.timestamp.slice(0, 10)
    if (date < startStr || date > endStr) continue
    const bucket = days.get(date) || []
    bucket.push(point)
    days.set(date, bucket)
  }

  for (const [date, points] of days) {
    points.sort((a, b) => a.timestamp.localeCompare(b.timestamp))
    days.set(date, points)
  }

  return days
}
