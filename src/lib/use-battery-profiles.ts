'use client'

/**
 * useBatteryProfiles — fetches normalized PV + household load profiles for the
 * plug-in battery business case page (phase 08).
 *
 * For each selected country (DE / NL), loads two static JSON files from
 * `/data/*.json` built by plan 08-01 (scripts/precompute-battery-profiles.mjs):
 *
 *   DE:
 *     - /data/bdew-h0-profile.json          (DE H0 apartment household load, 8760 hourly)
 *     - /data/pvgis-de-south-800w.json      (Berlin 800 Wp south-facing PV, 8760 hourly)
 *   NL:
 *     - /data/nedu-e1a-normalized.json      (NL NEDU E1a household load, 8760 hourly)
 *     - /data/pvgis-nl-south-800w.json      (Rotterdam 800 Wp south-facing PV, 8760 hourly)
 *
 * Profiles are normalized (Σ ≈ 1.0); callers scale by annual kWh / Wp.
 *
 * Module-level `cache` Map persists for the tab lifetime — switching country back
 * and forth does not re-fetch. `inflight` Map deduplicates concurrent fetches.
 */

import { useEffect, useState } from 'react'

export interface BatteryProfiles {
  /** 8760 hourly fractions summing to ~1.0; null while loading or on error. */
  pvProfile: number[] | null
  /** 8760 hourly fractions summing to ~1.0; null while loading or on error. */
  loadProfile: number[] | null
  loading: boolean
  error: string | null
}

type CacheKey =
  | 'bdew-h0-profile'
  | 'nedu-e1a-normalized'
  | 'pvgis-de-south-800w'
  | 'pvgis-nl-south-800w'

const cache = new Map<CacheKey, number[]>()
const inflight = new Map<CacheKey, Promise<number[]>>()

async function loadProfileJson(key: CacheKey): Promise<number[]> {
  const cached = cache.get(key)
  if (cached) return cached
  const pending = inflight.get(key)
  if (pending) return pending
  const p = fetch(`/data/${key}.json`)
    .then(async (r) => {
      if (!r.ok) throw new Error(`Failed to load /data/${key}.json: HTTP ${r.status}`)
      const data = await r.json()
      if (!Array.isArray(data)) throw new Error(`/data/${key}.json is not an array`)
      if (data.length !== 8760) {
        throw new Error(`/data/${key}.json has length ${data.length}, expected 8760`)
      }
      cache.set(key, data as number[])
      inflight.delete(key)
      return data as number[]
    })
    .catch((err) => {
      inflight.delete(key)
      throw err
    })
  inflight.set(key, p)
  return p
}

export function useBatteryProfiles(country: 'DE' | 'NL'): BatteryProfiles {
  const [state, setState] = useState<BatteryProfiles>({
    pvProfile: null,
    loadProfile: null,
    loading: true,
    error: null,
  })

  useEffect(() => {
    let cancelled = false
    setState((s) => ({ ...s, loading: true, error: null }))

    const loadKey: CacheKey = country === 'DE' ? 'bdew-h0-profile' : 'nedu-e1a-normalized'
    const pvKey: CacheKey = country === 'DE' ? 'pvgis-de-south-800w' : 'pvgis-nl-south-800w'

    Promise.all([loadProfileJson(loadKey), loadProfileJson(pvKey)])
      .then(([load, pv]) => {
        if (cancelled) return
        setState({ pvProfile: pv, loadProfile: load, loading: false, error: null })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          pvProfile: null,
          loadProfile: null,
          loading: false,
          error: String(err?.message ?? err),
        })
      })

    return () => {
      cancelled = true
    }
  }, [country])

  return state
}
