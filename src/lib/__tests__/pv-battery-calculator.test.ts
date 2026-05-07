import { describe, expect, it } from 'vitest'

import {
  buildPvBatteryInputs,
  getAvailablePvBatteryYears,
  optimizePvBattery,
  optimizePvBatteryWithOptions,
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
    curtailPvAtNegativePrice: false,
    loadKwh: 0,
    pvKwh: 0,
  }
}

function mkDailyPrice(date: string, priceCtKwh: number): HourlyPrice {
  return {
    timestamp: new Date(`${date}T00:00:00Z`).getTime(),
    date,
    hour: 0,
    minute: 0,
    priceCtKwh,
    priceEurMwh: priceCtKwh * 10,
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
  curtailPvAtNegativePrices: true,
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

function expectScenarioInvariants(
  result: ReturnType<typeof optimizePvBattery>,
  scenario: PvBatteryCalculatorScenario,
  slotHours = 1,
) {
  const chargeLimitKwh = scenario.maxChargeKw * slotHours
  const dischargeLimitKwh = scenario.maxDischargeKw * slotHours
  const exportCapKwh = scenario.feedInCapKw * slotHours
  const permissions = scenario.flowPermissions
  const tolerance = 0.0015

  let baselineCostEur = 0
  let gridImportCostEur = 0
  let exportRevenueEur = 0

  for (const slot of result.slots) {
    expectSlotConservation(slot)
    expect(slot.socKwhStart).toBeGreaterThanOrEqual(-tolerance)
    expect(slot.socKwhEnd).toBeGreaterThanOrEqual(-tolerance)
    expect(slot.socKwhStart).toBeLessThanOrEqual(scenario.usableKwh + tolerance)
    expect(slot.socKwhEnd).toBeLessThanOrEqual(scenario.usableKwh + tolerance)
    expect(slot.pvToBatteryKwh + slot.gridToBatteryKwh).toBeLessThanOrEqual(chargeLimitKwh + tolerance)
    expect(slot.batteryToLoadKwh + slot.batteryExportKwh).toBeLessThanOrEqual(dischargeLimitKwh + tolerance)
    expect(slot.pvToGridKwh + slot.batteryExportKwh).toBeLessThanOrEqual(exportCapKwh + tolerance)
    expect(slot.chargeToBatteryKwh > tolerance && (slot.batteryToLoadKwh + slot.batteryExportKwh) > tolerance).toBe(false)

    if (!permissions.pvToLoad) expect(slot.pvToLoadKwh).toBeCloseTo(0, 3)
    if (!permissions.pvToBattery) expect(slot.pvToBatteryKwh).toBeCloseTo(0, 3)
    if (!permissions.gridToBattery) expect(slot.gridToBatteryKwh).toBeCloseTo(0, 3)
    if (!permissions.batteryToLoad) expect(slot.batteryToLoadKwh).toBeCloseTo(0, 3)
    if (!permissions.pvToGrid) expect(slot.pvToGridKwh).toBeCloseTo(0, 3)
    if (!permissions.batteryToGrid) expect(slot.batteryExportKwh).toBeCloseTo(0, 3)

    baselineCostEur += slot.baselineCostEur
    gridImportCostEur += slot.slotImportCostEur
    exportRevenueEur += slot.slotExportRevenueEur
  }

  expect(result.baselineCostEur).toBeCloseTo(baselineCostEur, 2)
  expect(result.gridImportCostEur).toBeCloseTo(gridImportCostEur, 2)
  expect(result.exportRevenueEur).toBeCloseTo(exportRevenueEur, 2)
  expect(Math.abs(result.netCostEur - (result.gridImportCostEur - result.exportRevenueEur))).toBeLessThanOrEqual(0.02)
  expect(Math.abs(result.savingsEur - (result.baselineCostEur - result.netCostEur))).toBeLessThanOrEqual(0.02)
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

  it('preserves negative export prices and marks PV curtailment slots', () => {
    const prices: HourlyPrice[] = [
      {
        timestamp: Date.UTC(2025, 5, 15, 12, 0, 0),
        date: '2025-06-15',
        hour: 12,
        minute: 0,
        priceCtKwh: -5,
        priceEurMwh: -50,
      },
    ]
    const loadProfile = Array.from({ length: 8760 }, () => 0)
    const pvProfile = Array.from({ length: 8760 }, () => 0)

    const inputs = buildPvBatteryInputs(
      prices,
      loadProfile,
      pvProfile,
      {
        ...BASE_SCENARIO,
        curtailPvAtNegativePrices: true,
      },
    )

    expect(inputs[0].exportPriceCtKwh).toBeCloseTo(-5, 3)
    expect(inputs[0].curtailPvAtNegativePrice).toBe(true)
  })

  it('curtails direct PV export in negative-price slots when enabled', () => {
    const negativePvSlot: OptimizerSlotInput = {
      ...mkPrice(12, 20, -5),
      price: {
        ...mkPrice(12, 20, -5).price,
        priceCtKwh: -5,
        priceEurMwh: -50,
      },
      curtailPvAtNegativePrice: true,
      pvKwh: 1,
    }

    const curtailed = optimizePvBattery([negativePvSlot], {
      ...BASE_SCENARIO,
      usableKwh: 0,
      maxChargeKw: 0,
      maxDischargeKw: 0,
    })
    const exported = optimizePvBattery([{ ...negativePvSlot, curtailPvAtNegativePrice: false }], {
      ...BASE_SCENARIO,
      usableKwh: 0,
      maxChargeKw: 0,
      maxDischargeKw: 0,
    })

    expect(curtailed.directExportKwh).toBeCloseTo(0, 3)
    expect(curtailed.curtailedKwh).toBeCloseTo(1, 3)
    expect(curtailed.exportRevenueEur).toBeCloseTo(0, 3)
    expect(exported.directExportKwh).toBeCloseTo(1, 3)
    expect(exported.exportRevenueEur).toBeCloseTo(-0.05, 3)
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

  it('settles baseline and import costs on the household tariff instead of the raw spot price', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(18, 10, 0), importPriceCtKwh: 30, loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      usableKwh: 0,
      maxChargeKw: 0,
      maxDischargeKw: 0,
    })

    expect(result.baselineCostEur).toBeCloseTo(0.6, 3)
    expect(result.gridImportCostEur).toBeCloseTo(0.6, 3)
    expect(result.netCostEur).toBeCloseTo(0.6, 3)
    expect(result.savingsEur).toBeCloseTo(0, 3)
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

  it('tracks grid-charged battery input cost on the household tariff basis', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(1, 5, 0), importPriceCtKwh: 25 },
      { ...mkPrice(20, 30, 0), importPriceCtKwh: 40, loadKwh: 2 },
    ]

    const result = optimizePvBattery(slots, {
      ...BASE_SCENARIO,
      flowPermissions: {
        ...BASE_SCENARIO.flowPermissions,
        gridToBattery: true,
      },
    })

    expect(result.gridToBatteryKwh).toBeCloseTo(2, 3)
    expect(result.gridImportCostEur).toBeCloseTo(0.5, 3)
    expect(result.slots[1].batteryGridLoadInputCostEur).toBeCloseTo(0.5, 3)
    expect(result.slots[1].batteryLoadSavingsEur).toBeCloseTo(0.3, 3)
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

  it('can pin terminal SoC to the initial state to avoid horizon dumping', () => {
    const slots: OptimizerSlotInput[] = [
      { ...mkPrice(0, 10, 0) },
      { ...mkPrice(1, 10, 50) },
    ]

    const freeTerminal = optimizePvBatteryWithOptions(slots, BASE_SCENARIO, {
      initialSocKwh: 2,
      terminalSocKwh: null,
    })
    const pinnedTerminal = optimizePvBatteryWithOptions(slots, BASE_SCENARIO, {
      initialSocKwh: 2,
      terminalSocKwh: 2,
      planningModel: 'rolling',
    })

    expect(freeTerminal.batteryExportKwh).toBeCloseTo(2, 3)
    expect(pinnedTerminal.batteryExportKwh).toBeCloseTo(0, 3)
    expect(pinnedTerminal.slots[1].socKwhEnd).toBeCloseTo(2, 3)
    expect(pinnedTerminal.runs[0].terminalSocKwh).toBeCloseTo(2, 3)
  })

  it('only returns replay years with a complete, non-projected year of data', () => {
    const prices: HourlyPrice[] = []
    for (let day = 1; day <= 365; day += 1) {
      const date = new Date(Date.UTC(2025, 0, day)).toISOString().slice(0, 10)
      prices.push(mkDailyPrice(date, 20))
    }
    for (let day = 1; day <= 31; day += 1) {
      const date = new Date(Date.UTC(2026, 0, day)).toISOString().slice(0, 10)
      prices.push(mkDailyPrice(date, 25))
    }

    expect(getAvailablePvBatteryYears(prices, '2026-01-31')).toEqual([2025])
  })

  it('preserves core dispatch invariants across permission and tariff edge cases', () => {
    const baseSlots: OptimizerSlotInput[] = [
      { ...mkPrice(0, 8, -2), importPriceCtKwh: 18, loadKwh: 0.4, pvKwh: 0 },
      { ...mkPrice(1, 4, 0), importPriceCtKwh: 14, loadKwh: 0.2, pvKwh: 0 },
      { ...mkPrice(12, 28, 18), importPriceCtKwh: 38, loadKwh: 0.8, pvKwh: 2.4 },
      { ...mkPrice(13, -6, -6), importPriceCtKwh: 4, loadKwh: 0.3, pvKwh: 2.1, curtailPvAtNegativePrice: true },
      { ...mkPrice(19, 45, 32), importPriceCtKwh: 55, loadKwh: 2.8, pvKwh: 0.1 },
      { ...mkPrice(20, 22, 40), importPriceCtKwh: 32, loadKwh: 0.6, pvKwh: 0 },
    ]
    const permissionVariants: PvBatteryCalculatorScenario['flowPermissions'][] = [
      BASE_SCENARIO.flowPermissions,
      { ...BASE_SCENARIO.flowPermissions, gridToBattery: true },
      { ...BASE_SCENARIO.flowPermissions, pvToGrid: false, gridToBattery: true },
      { ...BASE_SCENARIO.flowPermissions, batteryToGrid: false, gridToBattery: true },
      { ...BASE_SCENARIO.flowPermissions, pvToLoad: false, pvToBattery: false, gridToBattery: true },
      { ...BASE_SCENARIO.flowPermissions, batteryToLoad: false, gridToBattery: true },
    ]

    for (const flowPermissions of permissionVariants) {
      const scenario = {
        ...BASE_SCENARIO,
        usableKwh: 3,
        maxChargeKw: 1,
        maxDischargeKw: 1.5,
        roundTripEff: 0.9,
        feedInCapKw: 1.25,
        flowPermissions,
      }
      const result = optimizePvBattery(baseSlots, scenario)
      expectScenarioInvariants(result, scenario)
    }
  })
})
