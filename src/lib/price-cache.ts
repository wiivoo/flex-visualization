/**
 * Price Cache Layer (Supabase)
 *
 * Caches price data per (date, type) with smart TTL:
 *   - Past dates:   24h (EPEX data is final)
 *   - Today:         2h (may get intraday updates)
 *   - Future dates:  1h (forecast → actual replacement when EPEX publishes at ~12:15 CET)
 *
 * Resolution is encoded into the type field:
 *   - 'day-ahead'    = hourly prices (24 points/day)
 *   - 'day-ahead-qh' = quarter-hourly prices (96 points/day)
 * This avoids a Supabase schema migration while supporting both resolutions.
 */

import { supabase } from './supabase'
import { format, parseISO, subHours, isBefore } from 'date-fns'

type CacheType = string // 'day-ahead' | 'day-ahead-qh' | 'intraday' | 'forward'

export interface CachedPriceData {
  date: string // YYYY-MM-DD
  type: CacheType
  cached_at: string // ISO timestamp
  source: 'awattar' | 'smard' | 'energy-charts' | 'csv' | 'demo'
  prices_json: Array<{ timestamp: string; price_ct_kwh: number | null }>
}

/**
 * Build cache type key from market type + resolution.
 * Encodes resolution into the type string so QH has its own cache slot.
 */
export function cacheTypeKey(
  type: 'day-ahead' | 'intraday' | 'forward',
  resolution: 'hour' | 'quarterhour' = 'hour'
): CacheType {
  if (resolution === 'quarterhour' && type === 'day-ahead') return 'day-ahead-qh'
  return type
}

/** Smart TTL: past=never expires, today=2h, future=1h */
function getTtlHours(date: string): number {
  const today = format(new Date(), 'yyyy-MM-dd')
  if (date < today) return Infinity  // Historical — final data, never expires
  if (date === today) return 2       // Today — may get updates
  return 1                           // Future — forecast, replace quickly
}

/**
 * Get cached price data if available and fresh
 */
export async function getCachedPrices(
  date: string,
  type: CacheType
): Promise<CachedPriceData | null> {
  try {
    const { data, error } = await supabase
      .from('price_cache')
      .select('*')
      .eq('date', date)
      .eq('type', type)
      .single()

    if (error || !data) return null

    // Check if cache is still valid (smart TTL based on date)
    const cachedAt = parseISO(data.cached_at)
    const ttl = getTtlHours(date)
    const expiry = subHours(new Date(), ttl)

    if (isBefore(cachedAt, expiry)) {
      return null // Cache expired
    }

    return data as CachedPriceData
  } catch (error) {
    console.error('Cache read error:', error)
    return null
  }
}

/**
 * Save price data to cache
 */
export async function setCachedPrices(
  date: string,
  type: CacheType,
  source: 'awattar' | 'smard' | 'energy-charts' | 'csv' | 'demo',
  prices: Array<{ timestamp: string; price_ct_kwh: number | null }>
): Promise<void> {
  try {
    const { error } = await supabase
      .from('price_cache')
      .upsert({
        date,
        type,
        cached_at: new Date().toISOString(),
        source,
        prices_json: prices
      }, {
        onConflict: 'date,type'
      })

    if (error) {
      console.error('Cache write error:', error)
    }
  } catch (error) {
    console.error('Cache write error:', error)
  }
}

/**
 * Delete expired cache entries (cleanup)
 */
export async function cleanupExpiredCache(): Promise<void> {
  try {
    const cutoffDate = new Date()
    cutoffDate.setDate(cutoffDate.getDate() - 30)

    const { error } = await supabase
      .from('price_cache')
      .delete()
      .lt('cached_at', cutoffDate.toISOString())

    if (error) {
      console.error('Cache cleanup error:', error)
    }
  } catch (error) {
    console.error('Cache cleanup error:', error)
  }
}
