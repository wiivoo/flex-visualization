'use client'

import { useEffect, useState } from 'react'

export interface PvRadiationData {
  zipCode: string
  location: {
    lat: number
    lon: number
    region: string
  }
  peakPowerKwp: number
  monthlyRadiation: number[]
  annualTotal: number
  isDefault: boolean
}

export function usePvRadiation(zipCode: string | null, peakPowerKwp: number) {
  const isValidZip = Boolean(zipCode && /^\d{5}$/.test(zipCode))
  const [data, setData] = useState<PvRadiationData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!isValidZip || !zipCode) return

    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true)
    setError(null)

    const controller = new AbortController()

    fetch(`/api/pv-radiation?zip=${zipCode}&peakPower=${peakPowerKwp}`, {
      signal: controller.signal,
    })
      .then((res) => res.json())
      .then((result) => {
        if (result.error) {
          setError(result.error)
          setData(null)
        } else {
          setData(result)
          setError(null)
        }
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          setError('Failed to fetch radiation data')
        }
      })
      .finally(() => {
        setLoading(false)
      })

    return () => controller.abort()
  }, [isValidZip, zipCode, peakPowerKwp])

  if (!isValidZip) {
    return { data: null, loading: false, error: null }
  }

  return { data, loading, error }
}

/**
 * Calculate daily radiation factor based on monthly data
 * Returns a multiplier for the base PV profile
 */
export function getDailyRadiationFactor(
  date: string,
  radiationData: PvRadiationData | null,
  annualPvYieldKwhPerKwp: number,
): number {
  if (!radiationData) {
    // Default: use standard German yield curve
    return 1.0
  }

  const month = new Date(date).getUTCMonth()
  const monthlyRadiation = radiationData.monthlyRadiation[month] || 0
  const monthlyAverage = radiationData.annualTotal / 12

  // Factor: how does this month compare to average?
  // >1 means above average, <1 means below
  return monthlyAverage > 0 ? monthlyRadiation / monthlyAverage : 1.0
}
