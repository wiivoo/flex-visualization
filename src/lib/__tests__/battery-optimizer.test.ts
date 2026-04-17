/**
 * Battery optimizer test suite — executable specification for src/lib/battery-optimizer.ts.
 *
 * Enforces every must_have:truths from plan 08-04-PLAN.md:
 *  - DE export prohibition: gridExportKwh === 0 for every slot, every scenario.
 *  - gridImportKwh >= 0 for every slot.
 *  - SoC bounds: 0 <= socKwhEnd <= usableKwh (with ±0.01 tolerance).
 *  - Per-slot energy conservation: loadKwh = pvSelfKwh + dischargeToLoadKwh + gridImportKwh.
 *  - Round-trip efficiency respected on charge→discharge path.
 *  - Zero-capacity guard: usableKwh=0 or maxChargeKw=0 returns a zeroed DaySummary without throwing.
 *  - Standby loss: standbyWatts × 24h × avgPrice rolled into daily standbyCostEur.
 *  - Non-negative arbitrage savings (optimizer worst case is idle).
 *  - runBatteryYear: aggregates runBatteryDay across dates into monthly + annual totals.
 */

import { describe, it, expect } from 'vitest'
import { runBatteryDay, runBatteryYear, type BatteryParams } from '@/lib/battery-optimizer'
import type { HourlyPrice } from '@/lib/v2-config'

/**
 * Build 96 quarter-hour slots from a 24-hour hourly-price pattern.
 * Each hour's price is replicated across four 15-minute slots.
 * Timestamp anchored to 2025-06-15 UTC.
 */
function mkHourlyPrices(pricesCt: number[]): HourlyPrice[] {
  const slots: HourlyPrice[] = []
  const baseTs = Date.UTC(2025, 5, 15, 0, 0, 0)
  const date = '2025-06-15'
  for (let i = 0; i < 96; i++) {
    const hour = Math.floor(i / 4)
    const minute = (i % 4) * 15
    const priceCt = pricesCt[hour]
    slots.push({
      timestamp: baseTs + i * 15 * 60_000,
      priceEurMwh: priceCt * 10,
      priceCtKwh: priceCt,
      hour,
      minute,
      date,
    })
  }
  return slots
}

function mkUniformLoad(kwhPerDay: number): number[] {
  return Array(96).fill(kwhPerDay / 96)
}

function mkNoPv(): number[] {
  return Array(96).fill(0)
}

const BASE_PARAMS: BatteryParams = {
  usableKwh: 2.0,
  maxChargeKw: 1.5,
  maxDischargeKw: 0.8,
  roundTripEff: 0.88,
  standbyWatts: 10,
  feedInCapKw: 0.8,
  allowGridExport: false,
}

describe('runBatteryDay — DE export prohibition', () => {
  it('every slot has gridExportKwh === 0 regardless of price spread', () => {
    const prices = mkHourlyPrices([
      2, 2, 2, 2, 3, 3, 5, 8, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 45, 30, 15, 8,
    ])
    const { slots } = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), BASE_PARAMS)
    for (const s of slots) expect(s.gridExportKwh).toBe(0)
  })

  it('gridImportKwh is always >= 0', () => {
    const prices = mkHourlyPrices(Array(24).fill(0).map((_, h) => h * 2))
    const { slots } = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), BASE_PARAMS)
    for (const s of slots) expect(s.gridImportKwh).toBeGreaterThanOrEqual(-0.001)
  })

  it('battery never discharges more than loadKwh in any slot (self-consumption only)', () => {
    // Flat high price — battery would want to export if allowed.
    const prices = mkHourlyPrices(Array(24).fill(50))
    const { slots } = runBatteryDay(prices, mkNoPv(), mkUniformLoad(3), BASE_PARAMS)
    for (const s of slots) {
      expect(s.dischargeToLoadKwh).toBeLessThanOrEqual(s.loadKwh + 0.001)
    }
  })

  it('even with huge PV surplus, no slot exports to grid', () => {
    // Heavy midday PV, low load — classic export-tempting profile.
    const prices = mkHourlyPrices(Array(24).fill(20))
    const pv = Array(96).fill(0).map((_, i) => {
      const h = i / 4
      return h > 8 && h < 17 ? 0.5 : 0
    })
    const { slots } = runBatteryDay(prices, pv, mkUniformLoad(2), BASE_PARAMS)
    for (const s of slots) expect(s.gridExportKwh).toBe(0)
  })
})

describe('runBatteryDay — SoC bounds', () => {
  it('socKwhEnd is always in [0, usableKwh]', () => {
    const prices = mkHourlyPrices([
      2, 2, 2, 2, 3, 3, 5, 8, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 45, 30, 15, 8,
    ])
    const { slots } = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), BASE_PARAMS, 0)
    for (const s of slots) {
      expect(s.socKwhEnd).toBeGreaterThanOrEqual(-0.01)
      expect(s.socKwhEnd).toBeLessThanOrEqual(BASE_PARAMS.usableKwh + 0.01)
    }
  })

  it('socKwhStart of slot n+1 equals socKwhEnd of slot n', () => {
    const prices = mkHourlyPrices([
      2, 2, 2, 2, 3, 3, 5, 8, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 45, 30, 15, 8,
    ])
    const { slots } = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), BASE_PARAMS, 0.5)
    for (let i = 1; i < slots.length; i++) {
      expect(slots[i].socKwhStart).toBeCloseTo(slots[i - 1].socKwhEnd, 3)
    }
    expect(slots[0].socKwhStart).toBe(0.5)
  })
})

describe('runBatteryDay — energy conservation', () => {
  it('per-slot: loadKwh === pvSelfKwh + dischargeToLoadKwh + gridImportKwh', () => {
    const prices = mkHourlyPrices([
      2, 2, 2, 2, 3, 3, 5, 8, 12, 15, 18, 20, 22, 25, 28, 30, 35, 40, 45, 50, 45, 30, 15, 8,
    ])
    // Moderate PV, midday bell.
    const pv = Array(96).fill(0).map((_, i) => {
      const h = i / 4
      return Math.max(0, Math.sin(((h - 6) / 14) * Math.PI)) * 0.05
    })
    const { slots } = runBatteryDay(prices, pv, mkUniformLoad(5), { ...BASE_PARAMS, maxDischargeKw: 1.0 })
    for (const s of slots) {
      const delivered = s.pvSelfKwh + s.dischargeToLoadKwh + s.gridImportKwh
      expect(delivered).toBeCloseTo(s.loadKwh, 3)
    }
  })

  it('per-slot charge sources never exceed available PV surplus + grid', () => {
    const prices = mkHourlyPrices(Array(24).fill(10))
    const pv = Array(96).fill(0).map((_, i) => (i >= 40 && i < 56 ? 0.3 : 0))
    const { slots } = runBatteryDay(prices, pv, mkUniformLoad(4), BASE_PARAMS)
    for (const s of slots) {
      expect(s.chargeFromPvKwh).toBeLessThanOrEqual(Math.max(0, s.pvKwh - s.pvSelfKwh) + 0.001)
    }
  })
})

describe('runBatteryDay — round-trip efficiency', () => {
  it('total battery-out <= total battery-in × roundTripEff (daily rollup)', () => {
    const prices = mkHourlyPrices([
      2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 2, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40, 40,
    ])
    const { slots } = runBatteryDay(prices, mkNoPv(), mkUniformLoad(8), BASE_PARAMS)
    const chargeIn = slots.reduce((a, s) => a + s.chargeFromGridKwh + s.chargeFromPvKwh, 0)
    const dischargeOut = slots.reduce((a, s) => a + s.dischargeToLoadKwh, 0)
    if (chargeIn > 0.1) {
      expect(dischargeOut).toBeLessThanOrEqual(chargeIn * BASE_PARAMS.roundTripEff + 0.05)
    }
  })
})

describe('runBatteryDay — guards', () => {
  it('returns zeroed result when usableKwh === 0', () => {
    const prices = mkHourlyPrices(Array(24).fill(20))
    const r = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), { ...BASE_PARAMS, usableKwh: 0 })
    expect(r.summary.savingsEur).toBe(0)
    for (const s of r.slots) {
      expect(s.chargeFromGridKwh).toBe(0)
      expect(s.dischargeToLoadKwh).toBe(0)
      expect(s.gridExportKwh).toBe(0)
    }
  })

  it('returns zeroed result when maxChargeKw === 0', () => {
    const prices = mkHourlyPrices(Array(24).fill(20))
    const r = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), { ...BASE_PARAMS, maxChargeKw: 0 })
    expect(r.summary.savingsEur).toBe(0)
  })

  it('does not produce negative arbitrage savings vs baseline', () => {
    // Flat price day — no arbitrage opportunity. arbitrageSavings must be >= 0.
    const prices = mkHourlyPrices(Array(24).fill(20))
    const r = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), BASE_PARAMS)
    expect(r.summary.arbitrageSavingsEur).toBeGreaterThanOrEqual(-0.001)
  })

  it('throws on length mismatch between prices and profile arrays', () => {
    const prices = mkHourlyPrices(Array(24).fill(20))
    expect(() =>
      runBatteryDay(prices, mkNoPv().slice(0, 50), mkUniformLoad(5), BASE_PARAMS)
    ).toThrow(/length mismatch/)
  })
})

describe('runBatteryDay — standby cost', () => {
  it('accrues 10W × 24h × avgPrice for the day', () => {
    // Flat price day: standbyCost should be 10W × 24h × 20ct/100 / 1000 = 0.048 EUR.
    const prices = mkHourlyPrices(Array(24).fill(20))
    const r = runBatteryDay(prices, mkNoPv(), mkUniformLoad(5), BASE_PARAMS)
    expect(r.summary.standbyCostEur).toBeCloseTo((10 * 24) / 1000 * 20 / 100, 2)
  })
})

describe('runBatteryYear — annual roll-up', () => {
  it('aggregates multiple days into non-negative annual savings with monthly buckets', () => {
    const dates = ['2025-06-15', '2025-06-16', '2025-06-17']
    const map = new Map<string, HourlyPrice[]>()
    for (const d of dates) {
      const [y, m, day] = d.split('-').map(Number)
      const ts = Date.UTC(y, m - 1, day)
      const slots: HourlyPrice[] = []
      for (let i = 0; i < 96; i++) {
        const hour = Math.floor(i / 4)
        const minute = (i % 4) * 15
        const priceCt = hour < 6 ? 5 : hour > 18 ? 40 : 20
        slots.push({
          timestamp: ts + i * 15 * 60_000,
          priceEurMwh: priceCt * 10,
          priceCtKwh: priceCt,
          hour,
          minute,
          date: d,
        })
      }
      map.set(d, slots)
    }
    const pvProfile = Array(8760).fill(1 / 8760)
    const loadProfile = Array(8760).fill(1 / 8760)
    const r = runBatteryYear(map, pvProfile, loadProfile, 0, 2500, BASE_PARAMS)
    expect(r.annualSavingsEur).toBeGreaterThanOrEqual(0)
    expect(r.months.length).toBeGreaterThan(0)
    expect(r.months.every((m) => /^\d{4}-\d{2}$/.test(m.month))).toBe(true)
    // Every day generates standby cost → annual standby > 0.
    expect(r.standbyCostEur).toBeGreaterThan(0)
  })

  it('returns empty months array when pricesByDate is empty', () => {
    const r = runBatteryYear(
      new Map(),
      Array(8760).fill(1 / 8760),
      Array(8760).fill(1 / 8760),
      0,
      2500,
      BASE_PARAMS,
    )
    expect(r.months.length).toBe(0)
    expect(r.annualSavingsEur).toBe(0)
  })
})
