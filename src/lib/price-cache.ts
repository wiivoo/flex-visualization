/**
 * Price Cache Layer (Supabase)
 * Caches price data for 24 hours to reduce external API calls
 */

import { supabase } from './supabase'
import { format, parseISO, subHours, isBefore } from 'date-fns'

export interface CachedPriceData {
  date: string // YYYY-MM-DD
  type: 'day-ahead' | 'intraday' | 'forward'
  cached_at: string // ISO timestamp
  source: 'smard' | 'csv' | 'demo'
  prices_json: Array<{ timestamp: string; price_ct_kwh: number | null }>
}

const CACHE_TTL_HOURS = {
  'day-ahead': 24,
  'intraday': 1, // Intraday changes more frequently
  'forward': 24
} as const

/**
 * Get cached price data if available and fresh
 */
export async function getCachedPrices(
  date: string,
  type: 'day-ahead' | 'intraday' | 'forward'
): Promise<CachedPriceData | null> {
  try {
    const { data, error } = await supabase
      .from('price_cache')
      .select('*')
      .eq('date', date)
      .eq('type', type)
      .single()

    if (error || !data) return null

    // Check if cache is still valid
    const cachedAt = parseISO(data.cached_at)
    const expiry = subHours(new Date(), CACHE_TTL_HOURS[type])

    if (isBefore(cachedAt, expiry)) {
      // Cache expired
      return null
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
  type: 'day-ahead' | 'intraday' | 'forward',
  source: 'smard' | 'csv' | 'demo',
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
    cutoffDate.setDate(cutoffDate.getDate() - 30) // Delete entries older than 30 days

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
