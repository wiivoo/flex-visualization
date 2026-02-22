/**
 * Energy-Charts API Client (Fraunhofer ISE)
 * Source for German day-ahead prices.
 *
 * API documentation: https://api.energy-charts.info/
 * Bidding Zone: DE-LU (Germany/Luxembourg)
 *
 * Prices come in EUR/MWh, conversion: EUR/MWh / 10 = ct/kWh
 */

import type { PricePoint } from '@/lib/config'
import { format } from 'date-fns'

const ENERGY_CHARTS_BASE_URL = 'https://api.energy-charts.info/price'

interface EnergyChartsResponse {
  unix_seconds: number[]
  price: (number | null)[]
}

/**
 * Load day-ahead prices from Energy-Charts for a single day.
 */
export async function fetchEnergyChartsDayAhead(date: Date): Promise<PricePoint[]> {
  const dateStr = format(date, 'yyyy-MM-dd')
  return fetchEnergyChartsRange(date, date)
}

/**
 * Load day-ahead prices from Energy-Charts for a date range.
 * Energy-Charts supports date ranges natively via start/end parameters.
 */
export async function fetchEnergyChartsRange(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[]> {
  const startStr = format(startDate, 'yyyy-MM-dd')
  const endStr = format(endDate, 'yyyy-MM-dd')

  const url = `${ENERGY_CHARTS_BASE_URL}?bzn=DE-LU&start=${startStr}&end=${endStr}`

  const response = await fetch(url, {
    next: { revalidate: 3600 } // 1 hour cache
  })

  if (!response.ok) {
    throw new Error(`Energy-Charts API request failed: ${response.status}`)
  }

  const data: EnergyChartsResponse = await response.json()

  if (!data.unix_seconds || !data.price || !Array.isArray(data.unix_seconds)) {
    throw new Error('Energy-Charts API: Unexpected response format')
  }

  const prices: PricePoint[] = []

  for (let i = 0; i < data.unix_seconds.length; i++) {
    const priceEurMwh = data.price[i]
    if (priceEurMwh === null || priceEurMwh === undefined) continue

    prices.push({
      timestamp: new Date(data.unix_seconds[i] * 1000).toISOString(),
      price_ct_kwh: Math.round((priceEurMwh / 10) * 100) / 100
    })
  }

  return prices
}
