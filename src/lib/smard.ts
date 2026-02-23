/**
 * SMARD API Client
 * Documentation: https://smard.api.bund.dev
 *
 * Filter 4169 = Marktpreis Deutschland/Luxemburg (Day-Ahead)
 */

const SMARD_BASE_URL = 'https://www.smard.de/app/chart_data'

export interface SmardPricePoint {
  timestamp: number // Unix milliseconds
  price_eur_mwh: number | null
}

export const SMARD_FILTER = {
  PRICE_DE_LU: 4169 // Marktpreis Deutschland/Luxemburg
} as const

export const SMARD_RESOLUTION = {
  QUARTERHOUR: 'quarterhour',
  HOUR: 'hour'
} as const

/**
 * Get time series data for a specific timestamp
 */
async function getSmardTimeSeries(
  filter: number,
  timestamp: number,
  resolution: string
): Promise<SmardPricePoint[]> {
  const url = `${SMARD_BASE_URL}/${filter}/DE/${filter}_DE_${resolution}_${timestamp}.json`
  const response = await fetch(url, {
    next: { revalidate: 3600 } // Cache for 1 hour
  })

  if (!response.ok) {
    throw new Error(`SMARD time series request failed: ${response.status}`)
  }

  const data = await response.json()

  // SMARD returns { meta_data: {...}, series: [[timestamp, price], ...] }
  // Map the [timestamp, price] arrays to SmardPricePoint objects
  if (data.series && Array.isArray(data.series)) {
    return data.series.map((entry: [number, number | null]) => ({
      timestamp: entry[0],
      price_eur_mwh: entry[1]
    }))
  }

  // Fallback: try data.data for compatibility
  return data.data || []
}

/**
 * Fetch day-ahead prices from SMARD for a specific date.
 * Resolves the correct weekly timestamp bucket from the index,
 * fetches the time series for that bucket, and filters to the requested day.
 */
export async function fetchSmardDayAhead(
  date: Date
): Promise<SmardPricePoint[]> {
  try {
    // Get available timestamp indices
    const url = `${SMARD_BASE_URL}/${SMARD_FILTER.PRICE_DE_LU}/DE/index_${SMARD_RESOLUTION.HOUR}.json`
    const response = await fetch(url, {
      next: { revalidate: 3600 }
    })

    if (!response.ok) {
      throw new Error(`SMARD index request failed: ${response.status}`)
    }

    const indexData = await response.json()
    // SMARD returns { timestamps: [...] }, not a plain array
    const timestamps: number[] = Array.isArray(indexData) ? indexData : indexData.timestamps || []
    if (!timestamps || timestamps.length === 0) {
      throw new Error('No SMARD timestamps available')
    }

    // Find the timestamp that contains data for the requested date
    const targetMs = date.getTime()
    // SMARD timestamps are week boundaries; find the one containing our date
    let bestTimestamp = timestamps[timestamps.length - 1]
    for (let i = timestamps.length - 1; i >= 0; i--) {
      if (timestamps[i] <= targetMs) {
        bestTimestamp = timestamps[i]
        break
      }
    }

    // Fetch the time series for that timestamp
    const series = await getSmardTimeSeries(
      SMARD_FILTER.PRICE_DE_LU,
      bestTimestamp,
      SMARD_RESOLUTION.HOUR
    )

    // Filter to only include data points for the requested date
    const startOfDay = new Date(date)
    startOfDay.setHours(0, 0, 0, 0)
    const endOfDay = new Date(date)
    endOfDay.setHours(23, 59, 59, 999)

    const filtered = series.filter(point => {
      const pointDate = new Date(point.timestamp)
      return pointDate >= startOfDay && pointDate <= endOfDay
    })

    return filtered
  } catch (error) {
    console.error('SMARD API error:', error)
    throw error
  }
}

/**
 * Convert SMARD price point to our internal format
 * SMARD returns EUR/MWh, we need ct/kWh
 * Conversion: ct/kWh = EUR/MWh / 10
 */
export function convertSmardPrice(smardPoint: SmardPricePoint): {
  timestamp: string
  price_ct_kwh: number | null
} {
  return {
    timestamp: new Date(smardPoint.timestamp).toISOString(),
    price_ct_kwh: smardPoint.price_eur_mwh !== null
      ? smardPoint.price_eur_mwh / 10
      : null
  }
}
