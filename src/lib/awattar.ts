/**
 * aWATTar API Client
 * Quelle für deutsche Day-Ahead-Preise (EPEX Spot).
 *
 * API-Dokumentation: https://www.awattar.de/services/api
 * Rate Limit: 100 Abfragen/Tag - daher Next.js revalidate Cache nutzen.
 *
 * Preise kommen in EUR/MWh, Umrechnung: EUR/MWh ÷ 10 = ct/kWh
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
 * Day-Ahead-Preise von aWATTar für einen einzelnen Tag laden.
 * Baut start/end als Unix-Millisekunden für den vollen Tag (00:00-23:59).
 */
export async function fetchAwattarDayAhead(date: Date): Promise<PricePoint[]> {
  const startOfDay = new Date(date)
  startOfDay.setHours(0, 0, 0, 0)

  const endOfDay = new Date(date)
  endOfDay.setHours(23, 59, 59, 999)

  return fetchAwattarRange(startOfDay, endOfDay)
}

/**
 * Day-Ahead-Preise von aWATTar für einen Zeitraum laden.
 * aWATTar unterstützt Zeiträume nativ in einer Abfrage.
 */
export async function fetchAwattarRange(
  startDate: Date,
  endDate: Date
): Promise<PricePoint[]> {
  const startMs = new Date(startDate).setHours(0, 0, 0, 0)
  const endMs = new Date(endDate).setHours(23, 59, 59, 999)

  const url = `${AWATTAR_BASE_URL}?start=${startMs}&end=${endMs}`

  const response = await fetch(url, {
    next: { revalidate: 3600 } // 1 Stunde Cache
  })

  if (!response.ok) {
    throw new Error(`aWATTar API-Anfrage fehlgeschlagen: ${response.status}`)
  }

  const data: AwattarResponse = await response.json()

  if (!data.data || !Array.isArray(data.data)) {
    throw new Error('aWATTar API: Unerwartetes Antwortformat')
  }

  return data.data.map((point): PricePoint => ({
    timestamp: new Date(point.start_timestamp).toISOString(),
    price_ct_kwh: Math.round((point.marketprice / 10) * 100) / 100
  }))
}
