/**
 * EnergyForecast.de API Client
 * Provides 48-hour day-ahead price forecasts for DE-LU.
 *
 * API docs: https://www.energyforecast.de/api-docs/index.html
 * Rate limit: 50 requests/day
 *
 * Prices returned in EUR/kWh (with fixed_cost=0, vat=0 → raw market price).
 * Convert: EUR/kWh × 100 = ct/kWh, EUR/kWh × 1000 = EUR/MWh
 */

import type { PricePoint } from '@/lib/config'

const FORECAST_BASE_URL = 'https://www.energyforecast.de/api/v1/predictions'

interface ForecastEntry {
  start: string   // ISO 8601 with timezone, e.g. "2026-03-05T00:00:00.000+01:00"
  end: string
  price: number   // EUR/kWh (raw, no VAT/fees when requested)
  price_origin: 'market' | 'forecast'
}

/**
 * Fetch 48-hour price forecast/actuals from EnergyForecast.de.
 * Returns both actual (published) and forecast (predicted) prices.
 * Forecast entries have isProjected=true.
 */
const MARKET_ZONES: Record<string, string> = {
  'DE': 'DE-LU',
  'NL': 'NL',
}

export async function fetchEnergyForecast(
  resolution: 'HOURLY' | 'QUARTER_HOURLY' = 'HOURLY',
  country: string = 'DE'
): Promise<{ prices: PricePoint[]; forecastStart: string | null }> {
  const token = process.env.ENERGY_FORECAST_TOKEN
  if (!token) {
    throw new Error('ENERGY_FORECAST_TOKEN environment variable not set')
  }

  const marketZone = MARKET_ZONES[country] ?? 'DE-LU'
  const url = `${FORECAST_BASE_URL}/next_48_hours?token=${token}&market_zone=${marketZone}&resolution=${resolution}&fixed_cost_cent=0&vat=0`

  const response = await fetch(url, {
    next: { revalidate: 3600 }, // 1 hour cache (50 req/day limit)
  })

  if (!response.ok) {
    throw new Error(`EnergyForecast API failed: ${response.status}`)
  }

  const data: ForecastEntry[] = await response.json()

  if (!Array.isArray(data) || data.length === 0) {
    throw new Error('EnergyForecast API: empty response')
  }

  let forecastStart: string | null = null
  const prices: PricePoint[] = data.map(entry => {
    const ts = new Date(entry.start)
    if (entry.price_origin === 'forecast' && !forecastStart) {
      forecastStart = ts.toISOString()
    }
    return {
      timestamp: ts.toISOString(),
      price_ct_kwh: Math.round(entry.price * 100 * 100) / 100, // EUR/kWh → ct/kWh, 2 decimals
    }
  })

  return { prices, forecastStart }
}

/**
 * Fetch forecast prices and return only the forecast (predicted) portion.
 * Useful for extending the dashboard beyond published EPEX prices.
 */
export async function fetchForecastOnly(
  resolution: 'HOURLY' | 'QUARTER_HOURLY' = 'HOURLY'
): Promise<PricePoint[]> {
  const token = process.env.ENERGY_FORECAST_TOKEN
  if (!token) {
    throw new Error('ENERGY_FORECAST_TOKEN environment variable not set')
  }

  const url = `${FORECAST_BASE_URL}/next_48_hours?token=${token}&market_zone=DE-LU&resolution=${resolution}&fixed_cost_cent=0&vat=0`

  const response = await fetch(url, {
    next: { revalidate: 3600 },
  })

  if (!response.ok) {
    throw new Error(`EnergyForecast API failed: ${response.status}`)
  }

  const data: ForecastEntry[] = await response.json()

  return data
    .filter(entry => entry.price_origin === 'forecast')
    .map(entry => ({
      timestamp: new Date(entry.start).toISOString(),
      price_ct_kwh: Math.round(entry.price * 100 * 100) / 100,
    }))
}
