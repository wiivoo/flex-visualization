/**
 * ENTSO-E Transparency Platform API Client
 * Source for European day-ahead electricity prices.
 *
 * API documentation: https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html
 * Bidding Zone DE-LU: 10Y1001A1001A82H
 *
 * Prices come in EUR/MWh, conversion: EUR/MWh / 10 = ct/kWh
 *
 * Rate limit: 400 requests/minute per user.
 */

import type { PricePoint } from '@/lib/config'
import { format, addDays } from 'date-fns'

const ENTSOE_BASE_URL = 'https://web-api.tp.entsoe.eu/api'
const DE_LU_DOMAIN = '10Y1001A1001A82H'
const NL_DOMAIN = '10YNL----------L'

export const ENTSOE_DOMAINS: Record<string, string> = {
  'DE': DE_LU_DOMAIN,
  'NL': NL_DOMAIN,
}

/**
 * Parse ENTSO-E XML response into price points.
 * ENTSO-E returns XML with TimeSeries > Period > Point structure.
 * Each Period has a timeInterval (start/end) and resolution (PT60M or PT15M).
 * Points have position (1-based) and price.amount in EUR/MWh.
 */
function parseEntsoeXml(xml: string): PricePoint[] {
  const prices: PricePoint[] = []

  // Extract all Period blocks
  const periodRegex = /<Period>([\s\S]*?)<\/Period>/g
  let periodMatch: RegExpExecArray | null

  while ((periodMatch = periodRegex.exec(xml)) !== null) {
    const periodXml = periodMatch[1]

    // Extract start time
    const startMatch = periodXml.match(/<start>([\dT:Z-]+)<\/start>/)
    if (!startMatch) continue

    // Extract resolution (PT60M = hourly, PT15M = quarter-hourly)
    const resMatch = periodXml.match(/<resolution>(PT\d+M)<\/resolution>/)
    if (!resMatch) continue

    const periodStart = new Date(startMatch[1])
    const resolution = resMatch[1]
    const stepMs = resolution === 'PT15M' ? 15 * 60 * 1000 : 60 * 60 * 1000

    // Extract all Point entries
    const pointRegex = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([-\d.]+)<\/price\.amount>\s*<\/Point>/g
    let pointMatch: RegExpExecArray | null

    while ((pointMatch = pointRegex.exec(periodXml)) !== null) {
      const position = parseInt(pointMatch[1], 10) // 1-based
      const priceEurMwh = parseFloat(pointMatch[2])

      const timestamp = new Date(periodStart.getTime() + (position - 1) * stepMs)

      prices.push({
        timestamp: timestamp.toISOString(),
        price_ct_kwh: Math.round((priceEurMwh / 10) * 100) / 100,
      })
    }
  }

  return prices.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

/**
 * Format date for ENTSO-E API: YYYYMMDDhhmm (UTC)
 */
function formatEntsoeDate(date: Date): string {
  return format(date, "yyyyMMdd'0000'")
}

/**
 * Load day-ahead prices from ENTSO-E for a single day.
 */
export async function fetchEntsoeDayAhead(date: Date, domain?: string): Promise<PricePoint[]> {
  return fetchEntsoeRange(date, date, domain)
}

/**
 * Load day-ahead prices from ENTSO-E for a date range.
 * ENTSO-E periodEnd is exclusive, so we add 1 day.
 * Max range per request: ~1 year.
 *
 * @param domain - EIC bidding zone code (default: DE-LU)
 */
/**
 * Fetch a single chunk from ENTSO-E with retry on 503.
 * Max ~60 days per chunk to stay well under the 100 TimeSeries limit.
 */
async function fetchEntsoeChunk(
  startDate: Date,
  endDate: Date,
  domain: string,
  token: string,
  retries = 2
): Promise<PricePoint[]> {
  const periodStart = formatEntsoeDate(startDate)
  const periodEnd = formatEntsoeDate(addDays(endDate, 1))
  const url = `${ENTSOE_BASE_URL}?securityToken=${token}&documentType=A44&in_Domain=${domain}&out_Domain=${domain}&periodStart=${periodStart}&periodEnd=${periodEnd}`

  for (let attempt = 0; attempt <= retries; attempt++) {
    const response = await fetch(url, { next: { revalidate: 3600 } })
    if (response.status === 503 && attempt < retries) {
      await new Promise(r => setTimeout(r, 1000 * (attempt + 1)))
      continue
    }
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`ENTSO-E API request failed: ${response.status} ${text.slice(0, 200)}`)
    }
    const xml = await response.text()
    return parseEntsoeXml(xml)
  }
  return []
}

/**
 * Fetch day-ahead prices from ENTSO-E for a date range.
 * Automatically chunks large ranges into ≤60-day pieces
 * to stay under the 100 TimeSeries per-response limit.
 */
export async function fetchEntsoeRange(
  startDate: Date,
  endDate: Date,
  domain: string = DE_LU_DOMAIN
): Promise<PricePoint[]> {
  const token = process.env.ENTSOE_API_TOKEN
  if (!token) {
    throw new Error('ENTSOE_API_TOKEN environment variable not set')
  }

  const diffDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (86400000))
  if (diffDays <= 60) {
    return fetchEntsoeChunk(startDate, endDate, domain, token)
  }

  // Chunk into 60-day pieces
  const allPrices: PricePoint[] = []
  let cursor = new Date(startDate)
  while (cursor <= endDate) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + 59 * 86400000, endDate.getTime()))
    const prices = await fetchEntsoeChunk(cursor, chunkEnd, domain, token)
    allPrices.push(...prices)
    cursor = addDays(chunkEnd, 1)
  }
  return allPrices
}
