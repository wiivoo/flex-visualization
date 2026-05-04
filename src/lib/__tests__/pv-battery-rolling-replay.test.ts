import { describe, expect, it } from 'vitest'

import type { OptimizerSlotInput, PvBatteryCalculatorScenario } from '@/lib/pv-battery-calculator'
import { optimizePvBatteryRollingReplay } from '@/lib/pv-battery-rolling-replay'
import type { HourlyPrice } from '@/lib/v2-config'

const BASE_SCENARIO: PvBatteryCalculatorScenario = {
  country: 'DE',
  tariffId: 'enviam-vision',
  annualLoadKwh: 0,
  pvCapacityWp: 0,
  usableKwh: 4,
  maxChargeKw: 4,
  maxDischargeKw: 4,
  roundTripEff: 1,
  feedInCapKw: 4,
  exportCompensationPct: 100,
  flowPermissions: {
    pvToLoad: true,
    pvToBattery: true,
    gridToBattery: true,
    batteryToLoad: true,
    pvToGrid: true,
    batteryToGrid: true,
  },
}

function buildHourlyInputs(
  startTimestamp: number,
  count: number,
  overrides?: (input: OptimizerSlotInput, index: number) => Partial<OptimizerSlotInput>,
): OptimizerSlotInput[] {
  return Array.from({ length: count }, (_, index) => {
    const timestamp = startTimestamp + (index * 3_600_000)
    const value = new Date(timestamp)
    const price: HourlyPrice = {
      timestamp,
      date: value.toISOString().slice(0, 10),
      hour: value.getUTCHours(),
      minute: 0,
      priceCtKwh: 20,
      priceEurMwh: 200,
    }

    const base: OptimizerSlotInput = {
      price,
      importPriceCtKwh: 20,
      exportPriceCtKwh: 0,
      loadKwh: 0,
      pvKwh: 0,
    }

    return {
      ...base,
      ...overrides?.(base, index),
    }
  })
}

describe('optimizePvBatteryRollingReplay', () => {
  it('stitches a year-start bootstrap with daily 12:00 runs and stamps provenance on each committed slot', () => {
    const inputs = buildHourlyInputs(Date.UTC(2025, 0, 1, 0, 0, 0), 72)

    const result = optimizePvBatteryRollingReplay(inputs, BASE_SCENARIO, {
      initialSocKwh: 0,
    })

    expect(result.planningModel).toBe('rolling')
    expect(result.runs).toHaveLength(4)
    expect(result.runs[0].runLabel).toContain('bootstrap')
    expect(result.runs[0].committedSlotCount).toBe(12)
    expect(result.runs[1].committedSlotCount).toBe(24)
    expect(result.slots).toHaveLength(72)

    expect(result.slots[0].runId).toBe(result.runs[0].runId)
    expect(result.slots[11].runId).toBe(result.runs[0].runId)
    expect(result.slots[12].runId).toBe(result.runs[1].runId)
    expect(result.slots[35].runId).toBe(result.runs[1].runId)
    expect(result.slots[36].runId).toBe(result.runs[2].runId)

    expect(result.slots[12].committedUntil).toBe(result.runs[1].committedUntil)
    expect(result.slots[12].knownHorizonEnd).toBe(result.runs[1].knownHorizonEnd)
    expect(result.slots[12].loadForecastSource).toBe('H25 household load forecast')
  })

  it('carries the committed SoC forward into the next rolling run', () => {
    const inputs = buildHourlyInputs(
      Date.UTC(2025, 0, 1, 0, 0, 0),
      60,
      (base) => {
        if (base.price.date === '2025-01-02' && base.price.hour === 11) {
          return { importPriceCtKwh: 5, price: { ...base.price, priceCtKwh: 5, priceEurMwh: 50 } }
        }
        if (base.price.date === '2025-01-02' && base.price.hour === 20) {
          return { importPriceCtKwh: 40, loadKwh: 2, price: { ...base.price, priceCtKwh: 40, priceEurMwh: 400 } }
        }
        return {}
      },
    )

    const result = optimizePvBatteryRollingReplay(inputs, BASE_SCENARIO, {
      initialSocKwh: 0,
    })

    const boundarySlot = result.slots.find((slot) => slot.date === '2025-01-02' && slot.label === '11:00')
    const nextRun = result.runs.find((run) => run.runDate === '2025-01-02' && run.runLabel === '2025-01-02 12:00')
    const noonSlot = result.slots.find((slot) => slot.date === '2025-01-02' && slot.label === '12:00')

    expect(boundarySlot).toBeTruthy()
    expect(nextRun).toBeTruthy()
    expect(noonSlot).toBeTruthy()
    expect(boundarySlot?.socKwhEnd).toBeGreaterThan(0.5)
    expect(nextRun?.initialSocKwh).toBeCloseTo(boundarySlot?.socKwhEnd ?? 0, 3)
    expect(noonSlot?.socKwhStart).toBeCloseTo(boundarySlot?.socKwhEnd ?? 0, 3)
  })
})
