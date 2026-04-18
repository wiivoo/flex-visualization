'use client'

/**
 * useBatteryWindow — shared compute hook for the battery page's cycle window.
 *
 * Extracted from BatteryDayChart so the KPI strip and the chart can share a
 * single optimizer pass. Returns chart-ready points plus roll-up aggregates
 * including full-equivalent cycles (Σ charge / usableKwh).
 */

import { useMemo } from 'react'
import {
  getLoadProfile,
  getVariant,
  type BatteryLoadProfileOption,
  type BatteryScenario,
  type BatteryVariant,
} from '@/lib/battery-config'
import { runBatteryDay, type BatteryParams, type SlotResult } from '@/lib/battery-optimizer'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import type { PriceData } from '@/lib/use-prices'

export type BatteryResolution = 'hour' | 'quarterhour'
export type BatteryWindowHours = 24 | 36 | 72

export interface BatteryChartPoint {
  timestamp: number
  label: string
  priceCtKwh: number
  loadKwh: number
  pvKwh: number
  pvSelfKwh: number
  chargeKwh: number
  chargeFromGridKwh: number
  chargeFromPvKwh: number
  dischargeKwh: number
  dischargeToLoadKwh: number
  gridImportKwh: number
  gridWithoutBatteryKwh: number
  gridWithBatteryKwh: number
  slotSavingsEur: number
  socPct: number
}

export interface BatteryWindowSummary {
  consumptionKwh: number
  chargeKwh: number
  chargeFromGridKwh: number
  dischargeKwh: number
  gridImportKwh: number
  gridWithoutBatteryKwh: number
  gridWithBatteryKwh: number
  gridDisplacedKwh: number
  savingsEur: number
  baselineAvgCt: number
  batteryAvgCt: number
  fullCycles: number
}

export interface BatteryWindowResult {
  chartData: BatteryChartPoint[]
  summary: BatteryWindowSummary | null
  variant: BatteryVariant
  showPv: boolean
  capPerSlotKwh: number
  slotHours: number
  loadProfile: BatteryLoadProfileOption
  profilesLoading: boolean
  profilesError: string | null
  hasPriceData: boolean
}

function buildParamsFromScenario(scenario: BatteryScenario): BatteryParams {
  const variant = getVariant(scenario.variantId)
  return {
    usableKwh: variant.usableKwh,
    maxChargeKw: variant.maxChargeKw,
    maxDischargeKw: variant.maxDischargeKw,
    roundTripEff: variant.roundTripEff,
    standbyWatts: variant.standbyWatts,
    feedInCapKw: scenario.feedInCapKw,
    allowGridExport: false,
  }
}

function formatSlotLabel(timestamp: number) {
  const d = new Date(timestamp)
  const day = String(d.getDate()).padStart(2, '0')
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const hour = String(d.getHours()).padStart(2, '0')
  const minute = String(d.getMinutes()).padStart(2, '0')
  return `${day}.${month} ${hour}:${minute}`
}

export function useBatteryWindow(
  scenario: BatteryScenario,
  prices: PriceData,
  windowHours: BatteryWindowHours,
  resolution: BatteryResolution,
): BatteryWindowResult {
  const variant = useMemo(() => getVariant(scenario.variantId), [scenario.variantId])
  const profileYear = useMemo(() => {
    const dateLike = prices.selectedDate
      ?? prices.daily[0]?.date
      ?? prices.hourly[0]?.date
      ?? prices.hourlyQH[0]?.date
    const parsed = Number(dateLike?.slice(0, 4))
    return Number.isFinite(parsed) && parsed > 2000 ? parsed : new Date().getFullYear()
  }, [prices.selectedDate, prices.daily, prices.hourly, prices.hourlyQH])
  const profiles = useBatteryProfiles(scenario.country, scenario.loadProfileId, profileYear)
  const loadProfile = useMemo(
    () => getLoadProfile(scenario.loadProfileId, scenario.country),
    [scenario.country, scenario.loadProfileId],
  )

  const activePrices = useMemo(
    () => (resolution === 'quarterhour' && prices.hourlyQH.length > 0 ? prices.hourlyQH : prices.hourly),
    [prices.hourly, prices.hourlyQH, resolution],
  )
  const slotHours = resolution === 'quarterhour' && prices.hourlyQH.length > 0 ? 0.25 : 1

  const windowSlots = useMemo(() => {
    if (!prices.selectedDate) return []
    const startIdx = activePrices.findIndex((point) => point.date === prices.selectedDate)
    if (startIdx < 0) return []
    const startTs = activePrices[startIdx].timestamp
    const endTs = startTs + windowHours * 3_600_000
    return activePrices.filter((point) => point.timestamp >= startTs && point.timestamp < endTs)
  }, [activePrices, prices.selectedDate, windowHours])

  const windowResult = useMemo(() => {
    if (windowSlots.length === 0) return null
    if (!profiles.pvProfile || !profiles.loadProfile) return null

    const pvCapKwp = variant.pvCapacityWp / 1000
    const pvKwhPerYear = variant.includePv
      ? pvCapKwp * (scenario.country === 'DE' ? 820 : 730)
      : 0

    const pvPerSlot = new Array<number>(windowSlots.length)
    const loadPerSlot = new Array<number>(windowSlots.length)

    for (let i = 0; i < windowSlots.length; i++) {
      const slotDate = new Date(windowSlots[i].timestamp)
      const yearStart = new Date(slotDate.getFullYear(), 0, 1).getTime()
      const hourIdx = Math.floor((windowSlots[i].timestamp - yearStart) / 3_600_000) % 8760
      pvPerSlot[i] = (profiles.pvProfile[hourIdx] ?? 0) * pvKwhPerYear * slotHours
      loadPerSlot[i] = (profiles.loadProfile[hourIdx] ?? 0) * scenario.annualLoadKwh * slotHours
    }

    return runBatteryDay(windowSlots, pvPerSlot, loadPerSlot, buildParamsFromScenario(scenario), 0)
  }, [profiles.loadProfile, profiles.pvProfile, scenario, slotHours, variant, windowSlots])

  const chartData: BatteryChartPoint[] = useMemo(() => {
    if (!windowResult) return []
    return windowResult.slots.map((slot: SlotResult) => {
      const chargeKwh = slot.chargeFromGridKwh + slot.chargeFromPvKwh
      const gridWithoutBatteryKwh = Math.max(0, slot.loadKwh - slot.pvSelfKwh)
      const gridWithBatteryKwh = slot.gridImportKwh + slot.chargeFromGridKwh
      return {
        timestamp: slot.timestamp,
        label: formatSlotLabel(slot.timestamp),
        priceCtKwh: slot.priceCtKwh,
        loadKwh: slot.loadKwh,
        pvKwh: slot.pvKwh,
        pvSelfKwh: slot.pvSelfKwh,
        chargeKwh,
        chargeFromGridKwh: slot.chargeFromGridKwh,
        chargeFromPvKwh: slot.chargeFromPvKwh,
        dischargeKwh: slot.dischargeToLoadKwh,
        dischargeToLoadKwh: slot.dischargeToLoadKwh,
        gridImportKwh: slot.gridImportKwh,
        gridWithoutBatteryKwh,
        gridWithBatteryKwh,
        slotSavingsEur: slot.baselineCostEur - slot.slotCostEur,
        socPct: variant.usableKwh > 0 ? (slot.socKwhEnd / variant.usableKwh) * 100 : 0,
      }
    })
  }, [variant.usableKwh, windowResult])

  const summary: BatteryWindowSummary | null = useMemo(() => {
    if (!windowResult || chartData.length === 0) return null
    let consumptionKwh = 0
    let chargeKwh = 0
    let chargeFromGridKwh = 0
    let dischargeKwh = 0
    let gridImportKwh = 0
    let gridWithoutBatteryKwh = 0
    let gridWithBatteryKwh = 0
    for (const point of chartData) {
      consumptionKwh += point.loadKwh
      chargeKwh += point.chargeKwh
      chargeFromGridKwh += point.chargeFromGridKwh
      dischargeKwh += point.dischargeKwh
      gridImportKwh += point.gridImportKwh
      gridWithoutBatteryKwh += point.gridWithoutBatteryKwh
      gridWithBatteryKwh += point.gridWithBatteryKwh
    }
    const baselineAvgCt = consumptionKwh > 0
      ? (windowResult.summary.baselineCostEur / consumptionKwh) * 100
      : 0
    const batteryAvgCt = consumptionKwh > 0
      ? (windowResult.summary.optimizedCostEur / consumptionKwh) * 100
      : 0
    const fullCycles = variant.usableKwh > 0 ? chargeKwh / variant.usableKwh : 0
    return {
      consumptionKwh,
      chargeKwh,
      chargeFromGridKwh,
      dischargeKwh,
      gridImportKwh,
      gridWithoutBatteryKwh,
      gridWithBatteryKwh,
      gridDisplacedKwh: dischargeKwh,
      savingsEur: windowResult.summary.savingsEur,
      baselineAvgCt,
      batteryAvgCt,
      fullCycles,
    }
  }, [chartData, variant.usableKwh, windowResult])

  return {
    chartData,
    summary,
    variant,
    showPv: variant.includePv,
    capPerSlotKwh: scenario.feedInCapKw * slotHours,
    slotHours,
    loadProfile,
    profilesLoading: profiles.loading,
    profilesError: profiles.error,
    hasPriceData: Boolean(prices.selectedDate) && chartData.length > 0,
  }
}
