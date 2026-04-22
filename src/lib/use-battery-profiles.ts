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

import { useEffect, useMemo, useState } from 'react'
import { getDayType, getProfileHourlyWeights } from '@/lib/slp-h25'
import { getNlDayType, getNlHourlyWeights } from '@/lib/nl-slp'
import {
  getDefaultLoadProfileId,
  isLoadProfileValidForCountry,
  type BatteryLoadProfileId,
} from '@/lib/battery-config'

export interface BatteryProfiles {
  /** 8760 hourly fractions summing to ~1.0; null while loading or on error. */
  pvProfile: number[] | null
  /** 8760 hourly fractions summing to ~1.0; null while loading or on error. */
  loadProfile: number[] | null
  loading: boolean
  error: string | null
}

interface BatteryProfilesState extends BatteryProfiles {
  requestKey: string
}

type CacheKey =
  | 'bdew-h0-profile'
  | 'pvgis-de-south-800w'
  | 'pvgis-nl-south-800w'

const cache = new Map<CacheKey, number[]>()
const inflight = new Map<CacheKey, Promise<number[]>>()
const generatedLoadCache = new Map<string, number[]>()

function pad2(n: number) {
  return String(n).padStart(2, '0')
}

function normalizeProfile(values: number[]): number[] {
  const sum = values.reduce((acc, value) => acc + value, 0)
  if (!Number.isFinite(sum) || sum <= 0) return values.map(() => 0)
  return values.map((value) => value / sum)
}

function buildH25YearProfile(year: number): number[] {
  const key = `DE:H25:${year}`
  const cached = generatedLoadCache.get(key)
  if (cached) return cached

  const hours: number[] = []
  const start = new Date(Date.UTC(year, 0, 1))
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = isLeapYear ? 366 : 365

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(start.getTime() + offset * 86_400_000)
    if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) continue
    const dateStr = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
    const dayType = getDayType(dateStr)
    hours.push(...getProfileHourlyWeights(date.getUTCMonth() + 1, dayType, 'H25'))
  }

  const normalized = normalizeProfile(hours)
  generatedLoadCache.set(key, normalized)
  return normalized
}

function buildNlYearProfile(year: number, profileId: 'E1A' | 'E1B' | 'E1C'): number[] {
  const key = `NL:${profileId}:${year}`
  const cached = generatedLoadCache.get(key)
  if (cached) return cached

  const hours: number[] = []
  const start = new Date(Date.UTC(year, 0, 1))
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = isLeapYear ? 366 : 365

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(start.getTime() + offset * 86_400_000)
    if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) continue
    const dateStr = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
    const dayType = getNlDayType(dateStr)
    hours.push(...getNlHourlyWeights(date.getUTCMonth() + 1, dayType, profileId))
  }

  const normalized = normalizeProfile(hours)
  generatedLoadCache.set(key, normalized)
  return normalized
}

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

export function useBatteryProfiles(
  country: 'DE' | 'NL',
  loadProfileId: BatteryLoadProfileId,
  year: number,
): BatteryProfiles {
  const effectiveLoadProfileId = useMemo(
    () => (
      isLoadProfileValidForCountry(loadProfileId, country)
        ? loadProfileId
        : getDefaultLoadProfileId(country)
    ),
    [country, loadProfileId],
  )

  const requestKey = `${country}:${effectiveLoadProfileId}:${year}`
  const [state, setState] = useState<BatteryProfilesState>({
    pvProfile: null,
    loadProfile: null,
    loading: true,
    error: null,
    requestKey,
  })

  useEffect(() => {
    let cancelled = false

    const pvKey: CacheKey = country === 'DE' ? 'pvgis-de-south-800w' : 'pvgis-nl-south-800w'
    const loadPromise =
      country === 'DE' && effectiveLoadProfileId === 'H0'
        ? loadProfileJson('bdew-h0-profile')
        : Promise.resolve(
            country === 'DE'
              ? buildH25YearProfile(year)
              : buildNlYearProfile(year, effectiveLoadProfileId as 'E1A' | 'E1B' | 'E1C'),
          )

    Promise.all([loadPromise, loadProfileJson(pvKey)])
      .then(([loadProfile, pv]) => {
        if (cancelled) return
        setState({ pvProfile: pv, loadProfile, loading: false, error: null, requestKey })
      })
      .catch((err) => {
        if (cancelled) return
        setState({
          pvProfile: null,
          loadProfile: null,
          loading: false,
          error: String(err?.message ?? err),
          requestKey,
        })
      })

    return () => {
      cancelled = true
    }
  }, [country, effectiveLoadProfileId, requestKey, year])

  if (state.requestKey !== requestKey) {
    return {
      pvProfile: state.pvProfile,
      loadProfile: state.loadProfile,
      loading: true,
      error: null,
    }
  }

  return state
}
