import { describe, expect, it } from 'vitest'

import {
  buildPvBatteryInputs,
  optimizePvBattery,
  type OptimizerSlotInput,
  type PvBatteryCalculatorScenario,
  type PvBatterySlotResult,
} from '@/lib/pv-battery-calculator'
import type { HourlyPrice } from '@/lib/v2-config'

function mkPrice(hour: number, importPriceCtKwh: number, exportPriceCtKwh: number): OptimizerSlotInput {
  const price: HourlyPrice = {
    timestamp: Date.UTC(2025, 5, 15, hour, 0, 0),
    date: '2025-06-15',
    hour,
    minute: 0,
    priceCtKwh: importPriceCtKwh,
    priceEurMwh: importPriceCtKwh * 10,
  }

  return {
    price,
    importPriceCtKwh: importPriceCtKwh,
    exportPriceCtKwh,
    loadKwh: 0,
    pvKwh: 0,
  }
}

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
    gridToBattery: false,
    batteryToLoad: true,
    pvToGrid: true,
    batteryToGrid: true,
  },
}

function expectSlotConservation(slot: PvBatterySlotResult) {
  expect(slot.householdImportPriceCtKwh).toBeCloseTo(slot.importPriceCtKwh, 3)
  expect(slot.directSelfKwh).toBeCloseTo(slot.pvToLoadKwh, 3)
  expect(slot.chargeToBatteryKwh).toBeCloseTo(slot.pvToBatteryKwh, 3)
  expect(slot.directExportKwh).toBeCloseTo(slot.pvToGridKwh, 3)
  expect(slot.gridImportKwh).toBeCloseTo(slot.gridToLoadKwh, 3)
  expect(slot.batteryToLoadKwh).toBeCloseTo(slot.batteryPvToLoadKwh + slot.batteryGridToLoadKwh, 3)
  expect(slot.batteryExportKwh).toBeCloseTo(slot.batteryPvExportKwh + slot.batteryGridExportKwh, 3)
  expect(slot.pvKwh).toBeCloseTo(slot.pvToLoadKwh + slot.pvToBatteryKwh + slot.pvToGridKwh + slot.curtailedKwh, 3)
  expect(slot.loadKwh).toBeCloseTo(slot.pvToLoadKwh + slot.batteryToLoadKwh + slot.gridToLoadKwh, 3)
}

describe('optimizePvBattery', () => {
  it('keeps quarter-hour PV slot energy scaling when radiation adjustment is applied', () => {
    const prices: HourlyPrice[] = [
      {
        timestamp: Date.UTC(2025, 0, 1, 0, 0, 0),
        date: '2025-01-01',
        hour: 0,
        minute: 0,
        priceCtKwh: 20,
        priceEurMwh: 200,
      },
      {
        timestamp: Date.UTC(2025, 0, 1, 0, 15, 0),
        date: '2025-01-01',
        hour: 0,
        minute: 15,
        priceCtKwh: 20,
        priceEurMwh: 200,
      },
    ]
    const loadProfile = Array.from({ length: 8760 }, () => 0)
    const pvProfile = Array.from({ length: 8760 }, () => 0)
    pvProfile[0] = 1

    const inputs = buildPvBatteryInputs(
      prices,
      loadProfile,
      pvProfile,
      {
        ...BASE_SCENARIO,
        annualLoadKwh: 0,
        pvCapacityWp: 1000,
      },
      {
        monthlyFactors: Array.from({ length: 12 }, () => 1),
      },
    )

    expect(inputs[0].pvKwh).toBeCloseTo(205, 6)
    expect(inputs[1].pvKwh).toBeCloseTo(205, 6)
  })

  it('optimizes for lower net cost instead of self-sufficiency', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(12, 10, 50), pvKwh: 2 },
      { ...mkPrice(19, 20, 0), loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, BASE_SCENARIO)

    expect(result.directExportKwh).toBeCloseTo(2, 3)
    expect(result.batteryExportKwh).toBeCloseTo(0, 3)
    expect(result.batteryToLoadKwh).toBeCloseTo(0, 3)
    expect(result.gridImportKwh).toBeCloseTo(2, 3)
    expect(result.exportRevenueEur).toBeCloseTo(1, 3)
    expect(result.netCostEur).toBeCloseTo(-0.6, 3)
  })

  it('charges from the grid when that lowers later household import cost', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(2, 5, 0) },
      { ...mkPrice(20, 30, 0), loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    expect(result.directExportKwh).toBeCloseTo(0, 3)
    expect(result.gridToBatteryKwh).toBeCloseTo(2, 3)
    expect(result.batteryToLoadKwh).toBeCloseTo(2, 3)
    expect(result.gridImportKwh).toBeCloseTo(0, 3)
    expect(result.gridImportCostEur).toBeCloseTo(0.1, 3)
  })

  it('respects disabled grid-to-battery charging', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(2, 5, 0) },
      { ...mkPrice(20, 30, 0), loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, BASE_SCENARIO)

    expect(result.gridToBatteryKwh).toBeCloseTo(0, 3)
    expect(result.batteryToLoadKwh).toBeCloseTo(0, 3)
    expect(result.gridImportKwh).toBeCloseTo(2, 3)
    expect(result.gridImportCostEur).toBeCloseTo(0.6, 3)
  })

  it('respects disabled PV-to-load routing', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(12, 20, 20), loadKwh: 1, pvKwh: 1 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 0,
      maxChargeKw: 0,
      maxDischargeKw: 0,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        pvToLoad: false,
        pvToBattery: false,
      },
    })

    expect(result.directSelfConsumedKwh).toBeCloseTo(0, 3)
    expect(result.directExportKwh).toBeCloseTo(1, 3)
    expect(result.gridImportKwh).toBeCloseTo(1, 3)
    expect(result.netCostEur).toBeCloseTo(0, 3)
  })

  it('splits battery discharge to household by stored PV and grid origin', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(1, 5, 0) },
      { ...mkPrice(12, 10, 0), pvKwh: 2 },
      { ...mkPrice(20, 30, 0), loadKwh: 4 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 4,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    expect(result.gridToBatteryKwh).toBeCloseTo(2, 3)
    expect(result.batteryToLoadKwh).toBeCloseTo(4, 3)

    const dischargeSlot = result.slots[2]
    expect(dischargeSlot.spotPriceCtKwh).toBeCloseTo(30, 3)
    expect(dischargeSlot.householdImportPriceCtKwh).toBeCloseTo(30, 3)
    expect(dischargeSlot.hasSeparateHouseholdImportPrice).toBe(false)
    expect(dischargeSlot.socKwhStart).toBeCloseTo(4, 3)
    expect(dischargeSlot.batteryPvToLoadKwh).toBeCloseTo(2, 3)
    expect(dischargeSlot.batteryGridToLoadKwh).toBeCloseTo(2, 3)
    expect(dischargeSlot.batteryLoadSavingsEur).toBeCloseTo(1.1, 3)
    expect(dischargeSlot.batteryDischargeSavingsEur).toBeCloseTo(1.1, 3)
    expect(dischargeSlot.gridToLoadKwh).toBeCloseTo(0, 3)
    expect(dischargeSlot.isGridChargingBattery).toBe(false)
    expect(dischargeSlot.isBatteryDischarging).toBe(true)
    expect(dischargeSlot.isBatteryExporting).toBe(false)
    expect(dischargeSlot.isDirectPvExporting).toBe(false)

    for (const slot of result.slots) {
      expectSlotConservation(slot)
    }
  })

  it('uses the lower-value stored bucket first instead of a proportional split for household discharge', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(1, 5, 0), importPriceCtKwh: 5 },
      { ...mkPrice(2, 50, 20), importPriceCtKwh: 50, pvKwh: 1 },
      { ...mkPrice(3, 50, 20), importPriceCtKwh: 50, pvKwh: 1 },
      { ...mkPrice(4, 30, 0), loadKwh: 2 },
      { ...mkPrice(5, 20, 25) },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 3,
      maxChargeKw: 1,
      maxDischargeKw: 1,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    const dischargeSlot = result.slots[3]
    expect(result.batteryToLoadKwh).toBeGreaterThan(0)
    expect(dischargeSlot.batteryGridToLoadKwh).toBeCloseTo(dischargeSlot.batteryToLoadKwh, 3)
    expect(dischargeSlot.batteryPvToLoadKwh).toBeCloseTo(0, 3)
    expect(dischargeSlot.batteryGridToLoadKwh).not.toBeCloseTo(0.5, 3)
    expect(dischargeSlot.batteryPvToLoadKwh).not.toBeCloseTo(0.5, 3)

    for (const slot of result.slots) {
      expectSlotConservation(slot)
    }
  })

  it('splits battery export by stored PV and grid origin', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(1, 5, 0) },
      { ...mkPrice(12, 10, 0), pvKwh: 2 },
      { ...mkPrice(20, 20, 30) },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 4,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    expect(result.gridToBatteryKwh).toBeCloseTo(2, 3)
    expect(result.batteryExportKwh).toBeCloseTo(4, 3)

    const exportSlot = result.slots[2]
    expect(exportSlot.spotPriceCtKwh).toBeCloseTo(20, 3)
    expect(exportSlot.householdImportPriceCtKwh).toBeCloseTo(20, 3)
    expect(exportSlot.hasSeparateHouseholdImportPrice).toBe(false)
    expect(exportSlot.socKwhStart).toBeCloseTo(4, 3)
    expect(exportSlot.batteryPvExportKwh).toBeCloseTo(2, 3)
    expect(exportSlot.batteryGridExportKwh).toBeCloseTo(2, 3)
    expect(exportSlot.batteryPvToLoadKwh).toBeCloseTo(0, 3)
    expect(exportSlot.batteryGridToLoadKwh).toBeCloseTo(0, 3)
    expect(exportSlot.isGridChargingBattery).toBe(false)
    expect(exportSlot.isBatteryDischarging).toBe(true)
    expect(exportSlot.isBatteryExporting).toBe(true)
    expect(exportSlot.isDirectPvExporting).toBe(false)

    for (const slot of result.slots) {
      expectSlotConservation(slot)
    }
  })

  it('uses the lower-value stored bucket first when exporting from mixed inventory', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(1, 5, 0), importPriceCtKwh: 5 },
      { ...mkPrice(2, 5, 0), importPriceCtKwh: 5 },
      { ...mkPrice(3, 50, 20), importPriceCtKwh: 50, pvKwh: 1 },
      { ...mkPrice(4, 50, 20), importPriceCtKwh: 50, pvKwh: 1 },
      { ...mkPrice(5, 20, 30) },
      { ...mkPrice(6, 30, 0), loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 4,
      maxChargeKw: 1,
      maxDischargeKw: 2,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    const exportSlot = result.slots[4]
    expect(result.batteryExportKwh).toBeCloseTo(2, 3)
    expect(exportSlot.batteryGridExportKwh).toBeCloseTo(2, 3)
    expect(exportSlot.batteryPvExportKwh).toBeCloseTo(0, 3)
    expect(exportSlot.batteryGridExportKwh).not.toBeCloseTo(1, 3)

    for (const slot of result.slots) {
      expectSlotConservation(slot)
    }
  })

  it('uses the lower-value stored bucket first when discharging to household load', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(1, 5, 0), importPriceCtKwh: 5 },
      { ...mkPrice(2, 5, 0), importPriceCtKwh: 5 },
      { ...mkPrice(11, 50, 20), importPriceCtKwh: 50, pvKwh: 1 },
      { ...mkPrice(12, 50, 20), importPriceCtKwh: 50, pvKwh: 1 },
      { ...mkPrice(20, 30, 0), loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 4,
      maxChargeKw: 1,
      maxDischargeKw: 2,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    const dischargeSlot = result.slots[4]
    expect(result.batteryToLoadKwh).toBeCloseTo(2, 3)
    expect(dischargeSlot.batteryGridToLoadKwh).toBeCloseTo(2, 3)
    expect(dischargeSlot.batteryPvToLoadKwh).toBeCloseTo(0, 3)

    for (const slot of result.slots) {
      expectSlotConservation(slot)
    }
  })

  it('exposes separate spot and household prices plus action flags for UI markers', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(10, 24, 12), importPriceCtKwh: 30, pvKwh: 3 },
      { ...mkPrice(11, 8, 0) },
      { ...mkPrice(20, 35, 25), loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 1,
      maxChargeKw: 1,
      maxDischargeKw: 1,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    const pvSlot = result.slots[0]
    expect(pvSlot.spotPriceCtKwh).toBeCloseTo(24, 3)
    expect(pvSlot.householdImportPriceCtKwh).toBeCloseTo(30, 3)
    expect(pvSlot.hasSeparateHouseholdImportPrice).toBe(true)
    expect(pvSlot.isDirectPvExporting).toBe(true)
    expect(pvSlot.pvToGridKwh).toBeGreaterThan(0)

    const chargeSlot = result.slots[1]
    expect(chargeSlot.isGridChargingBattery).toBe(true)
    expect(chargeSlot.gridToBatteryKwh).toBeGreaterThan(0)
    expect(chargeSlot.isBatteryDischarging).toBe(false)
    expect(chargeSlot.isBatteryExporting).toBe(false)

    const dischargeSlot = result.slots[2]
    expect(dischargeSlot.isBatteryDischarging).toBe(true)
    expect(dischargeSlot.isBatteryExporting).toBe(false)
    expect(dischargeSlot.batteryToLoadKwh).toBeGreaterThan(0)
    expect(dischargeSlot.batteryLoadSavingsEur).toBeGreaterThan(0)
    expect(dischargeSlot.batteryDischargeSavingsEur).toBeGreaterThan(0)

    for (const slot of result.slots) {
      expectSlotConservation(slot)
    }
  })
})
