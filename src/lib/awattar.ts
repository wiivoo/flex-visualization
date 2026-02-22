/**
 * aWATTar API Client
 * Source for German day-ahead prices (EPEX Spot).
 *
 * API documentation: https://www.awattar.de/services/api
 * Rate limit: 100 requests/day - therefore use Next.js revalidate cache.
 *
 * Prices come in EUR/MWh, conversion: EUR/MWh / 10 = ct/kWh
 */

import type { PricePoint } from '@/lib/config'

const AWATTAR_BASE_URL = 'https://api.awattar.de/v1/marketdata'

interface AwattarDataPoint {
  start_timestamp: number
  end_timestamp: number
  marketprice: number
  unit: string // "Eur/MWh"
}

interface AwattarResponse {
  object: string
  data: AwattarDataPoint[]
}

/**
 * Load day-ahead prices from aWATTar for a single day.
 * Builds start/end as Unix milliseconds for the full day (00:00-23:59).
 */
export async function fetchAwattarDayAhead(date: Date): Promise<PricePoint[]> {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  return fetchAwattarRange(startOfDay, endOfDay)
}

/**
 * Load day-ahead prices from aWATTar for a date range.
 * aWATTar supports date ranges natively in a single query.
 */
export async function fetchAwattarRange(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[]> {
  const startMs = new Date(startDate).setHours(0, 0, 0, 0)
  const endMs = new Date(endDate).setHours(23, 59, 59, 999)

  const url = `${AWATTAR_BASE_URL}?start=${startMs}&end=${endMs}`

  const response = await fetch(url, {
    next: { revalidate: 3600 } // 1 hour cache
  })

  if (!response.ok) {
    throw new Error(`aWATTar API request failed: ${response.status}`)
  }

  const data: AwattarResponse = await response.json()

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('aWATTar API: Unexpected response format')
  }

  return data.data.map((point): PricePoint => ({
    timestamp: new Date(point.start_timestamp).toISOString(),
    price_ct_kwh: Math.round((point.marketprice / 10) * 100) / 100
  }))
}
