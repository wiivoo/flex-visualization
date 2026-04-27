import type { DeBatteryLoadProfileId } from '@/lib/battery-config'
import { mapPricesToRetailTariff } from '@/lib/retail-tariffs'
import { getDayType, getProfileHourlyWeights, type LoadProfile } from '@/lib/slp-h25'
import type { HourlyPrice } from '@/lib/v2-config'

export type PvBatteryCountry = 'DE' | 'NL'
export type PvBatteryResolution = 'hour' | 'quarterhour'

export interface PvBatteryFlowPermissions {
  pvToLoad: boolean
  pvToBattery: boolean
  gridToBattery: boolean
  batteryToLoad: boolean
  pvToGrid: boolean
  batteryToGrid: boolean
}

export interface PvBatteryCalculatorScenario {
  country: PvBatteryCountry
  tariffId: string
  annualLoadKwh: number
  pvCapacityWp: number
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number
  feedInCapKw: number
  exportCompensationPct: number
  flowPermissions: PvBatteryFlowPermissions
}

export interface PvBatterySlotResult {
  timestamp: number
  date: string
  hour: number
  minute: number
  label: string
  spotPriceCtKwh: number
  householdImportPriceCtKwh: number
  hasSeparateHouseholdImportPrice: boolean
  importPriceCtKwh: number
  exportPriceCtKwh: number
  loadKwh: number
  pvKwh: number
  directSelfKwh: number
  pvToLoadKwh: number
  chargeToBatteryKwh: number
  pvToBatteryKwh: number
  gridToBatteryKwh: number
  batteryToLoadKwh: number
  batteryPvToLoadKwh: number
  batteryGridToLoadKwh: number
  batteryGridLoadInputCostEur: number
  batteryLoadSavingsEur: number
  directExportKwh: number
  pvToGridKwh: number
  batteryExportKwh: number
  batteryPvExportKwh: number
  batteryGridExportKwh: number
  batteryPvExportSavingsEur: number
  batteryGridExportSavingsEur: number
  batteryExportSavingsEur: number
  batteryDischargeSavingsEur: number
  curtailedKwh: number
  gridImportKwh: number
  gridToLoadKwh: number
  isGridChargingBattery: boolean
  isBatteryDischarging: boolean
  isBatteryExporting: boolean
  isDirectPvExporting: boolean
  socKwhStart: number
  socKwhEnd: number
  baselineCostEur: number
  gridImportCostEur: number
  exportRevenueEur: number
  netCostEur: number
  savingsEur: number
}

export interface PvBatteryMonthResult {
  month: string
  baselineCostEur: number
  gridImportCostEur: number
  exportRevenueEur: number
  netCostEur: number
  savingsEur: number
}

export interface PvBatteryAnnualResult {
  baselineCostEur: number
  gridImportCostEur: number
  exportRevenueEur: number
  netCostEur: number
  savingsEur: number
  directSelfConsumedKwh: number
  gridToBatteryKwh: number
  batteryToLoadKwh: number
  directExportKwh: number
  batteryExportKwh: number
  curtailedKwh: number
  gridImportKwh: number
  pvGenerationKwh: number
  loadKwh: number
  selfSufficiencyPct: number
  selfConsumptionPct: number
  months: PvBatteryMonthResult[]
  slots: PvBatterySlotResult[]
}

export interface OptimizerSlotInput {
  price: HourlyPrice
  importPriceCtKwh: number
  exportPriceCtKwh: number
  loadKwh: number
  pvKwh: number
}

const PV_YIELD_KWH_PER_KWP: Record<PvBatteryCountry, number> = {
  DE: 820,
  NL: 730,
}

const SOC_STEP_KWH = 0.5
const EPSILON = 1e-9
const DEFAULT_FLOW_PERMISSIONS: PvBatteryFlowPermissions = {
  pvToLoad: true,
  pvToBattery: true,
  gridToBattery: false,
  batteryToLoad: true,
  pvToGrid: true,
  batteryToGrid: true,
}

interface PvBatteryDispatch {
  directSelfKwh: number
  chargeToBatteryKwh: number
  gridToBatteryKwh: number
  batteryToLoadKwh: number
  directExportKwh: number
  batteryExportKwh: number
  curtailedKwh: number
  gridImportKwh: number
  netCostEur: number
}

interface EnergyLayer {
  source: 'pv' | 'grid'
  storedKwh: number
  unitValueCtKwh: number
}

interface StoredEnergyLot {
  storedKwh: number
  valueCtKwh: number
}

interface ExactBatteryDischargeSplit {
  batteryPvToLoadKwh: number
  batteryGridToLoadKwh: number
  batteryGridLoadInputCostEur: number
  batteryPvExportKwh: number
  batteryGridExportKwh: number
  batteryPvExportSavingsEur: number
  batteryGridExportSavingsEur: number
  batteryLoadSavingsEur: number
  batteryExportSavingsEur: number
  batteryDischargeSavingsEur: number
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000
}

function round6(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function getDaysInYear(year: number): number {
  return ((year % 4 === 0 && year % 100 !== 0) || year % 400 === 0) ? 366 : 365
}

function normalizeSeries(values: number[]): number[] {
  const total = values.reduce((sum, value) => sum + value, 0)
  if (!Number.isFinite(total) || total <= 0) return values.map(() => 0)
  return values.map((value) => value / total)
}

function formatLabel(price: HourlyPrice): string {
  return `${String(price.hour).padStart(2, '0')}:${String(price.minute ?? 0).padStart(2, '0')}`
}

function getSlotHours(prices: HourlyPrice[]): number {
  if (prices.length < 2) return 1
  return Math.max(1 / 60, (prices[1].timestamp - prices[0].timestamp) / 3_600_000)
}

function hourIndexFromTimestamp(timestamp: number): number {
  const d = new Date(timestamp)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  return Math.floor((timestamp - yearStart) / 3_600_000) % 8760
}

function normalizeFlowPermissions(
  permissions: PvBatteryFlowPermissions | undefined,
): PvBatteryFlowPermissions {
  return {
    ...DEFAULT_FLOW_PERMISSIONS,
    ...permissions,
  }
}

function uniqueCandidates(values: number[]): number[] {
  const result: number[] = []
  for (const value of values) {
    const rounded = round6(value)
    if (result.some((candidate) => Math.abs(candidate - rounded) <= EPSILON)) continue
    result.push(rounded)
  }
  return result
}

function cloneLayers(layers: EnergyLayer[]): EnergyLayer[] {
  return layers.map((layer) => ({ ...layer }))
}

function totalStoredKwh(layers: EnergyLayer[]): number {
  return layers.reduce((sum, layer) => sum + layer.storedKwh, 0)
}

function pushLayer(layers: EnergyLayer[], layer: EnergyLayer | null) {
  if (!layer || layer.storedKwh <= EPSILON) return
  const previous = layers[layers.length - 1]
  if (
    previous &&
    previous.source === layer.source &&
    Math.abs(previous.unitValueCtKwh - layer.unitValueCtKwh) <= EPSILON
  ) {
    previous.storedKwh += layer.storedKwh
    return
  }
  layers.push(layer)
}

function consumeLayersByLowestValue(
  layers: EnergyLayer[],
  storedKwhToRemove: number,
): { remainingLayers: EnergyLayer[]; consumedLayers: EnergyLayer[] } {
  const remaining = cloneLayers(layers)
  const consumed: EnergyLayer[] = []
  let remainingToRemove = storedKwhToRemove

  while (remainingToRemove > EPSILON) {
    let bestIndex = -1
    let bestValue = Number.POSITIVE_INFINITY

    for (let index = 0; index < remaining.length; index += 1) {
      const layer = remaining[index]
      if (layer.storedKwh <= EPSILON) continue
      if (layer.unitValueCtKwh < bestValue - EPSILON) {
        bestValue = layer.unitValueCtKwh
        bestIndex = index
      }
    }

    if (bestIndex === -1) break

    const layer = remaining[bestIndex]
    const removed = Math.min(layer.storedKwh, remainingToRemove)
    consumed.push({
      source: layer.source,
      storedKwh: removed,
      unitValueCtKwh: layer.unitValueCtKwh,
    })
    layer.storedKwh -= removed
    remainingToRemove -= removed
  }

  return {
    remainingLayers: remaining.filter((layer) => layer.storedKwh > EPSILON),
    consumedLayers: consumed,
  }
}

function allocateConsumedEnergy(
  consumedLayers: EnergyLayer[],
  batteryToLoadKwh: number,
  batteryExportKwh: number,
  importPriceCtKwh: number,
  exportPriceCtKwh: number,
  roundTripEff: number,
) {
  const chunks = consumedLayers
    .map((layer) => ({
      source: layer.source,
      outputKwh: layer.storedKwh * roundTripEff,
      unitValueCtKwh: layer.unitValueCtKwh,
    }))
    .filter((chunk) => chunk.outputKwh > EPSILON)
    .sort((a, b) => a.unitValueCtKwh - b.unitValueCtKwh)

  const sinks = [
    { key: 'load' as const, remainingKwh: batteryToLoadKwh, realizedValueCtKwh: importPriceCtKwh },
    { key: 'export' as const, remainingKwh: batteryExportKwh, realizedValueCtKwh: exportPriceCtKwh },
  ].filter((sink) => sink.remainingKwh > EPSILON)
    .sort((a, b) => a.realizedValueCtKwh - b.realizedValueCtKwh)

  let batteryPvToLoadKwh = 0
  let batteryGridToLoadKwh = 0
  let batteryPvExportKwh = 0
  let batteryGridExportKwh = 0

  for (const sink of sinks) {
    let remaining = sink.remainingKwh
    for (const chunk of chunks) {
      if (remaining <= EPSILON || chunk.outputKwh <= EPSILON) break
      const allocated = Math.min(chunk.outputKwh, remaining)
      if (sink.key === 'load') {
        if (chunk.source === 'pv') batteryPvToLoadKwh += allocated
        else batteryGridToLoadKwh += allocated
      } else {
        if (chunk.source === 'pv') batteryPvExportKwh += allocated
        else batteryGridExportKwh += allocated
      }
      chunk.outputKwh -= allocated
      remaining -= allocated
    }
  }

  return {
    batteryPvToLoadKwh,
    batteryGridToLoadKwh,
    batteryPvExportKwh,
    batteryGridExportKwh,
  }
}

function insertStoredLot(lots: StoredEnergyLot[], storedKwh: number, valueCtKwh: number) {
  if (storedKwh <= EPSILON) return

  const lot: StoredEnergyLot = {
    storedKwh: round6(storedKwh),
    valueCtKwh: round6(valueCtKwh),
  }

  let insertIndex = 0
  while (insertIndex < lots.length && lots[insertIndex].valueCtKwh < lot.valueCtKwh - EPSILON) {
    insertIndex += 1
  }

  const mergeWith = lots[insertIndex]
  if (mergeWith && Math.abs(mergeWith.valueCtKwh - lot.valueCtKwh) <= EPSILON) {
    mergeWith.storedKwh = round6(mergeWith.storedKwh + lot.storedKwh)
    return
  }

  const previous = lots[insertIndex - 1]
  if (previous && Math.abs(previous.valueCtKwh - lot.valueCtKwh) <= EPSILON) {
    previous.storedKwh = round6(previous.storedKwh + lot.storedKwh)
    return
  }

  lots.splice(insertIndex, 0, lot)
}

function maybeShiftEmptyLot(lots: StoredEnergyLot[]) {
  while (lots.length > 0 && lots[0].storedKwh <= EPSILON) {
    lots.shift()
  }
}

function buildNoBatteryChargeDispatch(
  slot: OptimizerSlotInput,
  permissions: PvBatteryFlowPermissions,
  feedInCapKwh: number,
): PvBatteryDispatch {
  const dispatch = buildChargeDispatch(slot, permissions, 0, feedInCapKwh)
  if (!dispatch) {
    throw new Error('optimizePvBattery: failed to build no-battery charge counterfactual')
  }
  return dispatch
}

function storePvChargeLots(
  pvLots: StoredEnergyLot[],
  slot: OptimizerSlotInput,
  permissions: PvBatteryFlowPermissions,
  dispatch: PvBatteryDispatch,
  feedInCapKwh: number,
) {
  if (dispatch.chargeToBatteryKwh <= EPSILON) return

  const withoutBatteryCharge = buildNoBatteryChargeDispatch(slot, permissions, feedInCapKwh)
  const displacedDirectUseKwh = Math.max(0, withoutBatteryCharge.directSelfKwh - dispatch.directSelfKwh)
  const displacedExportKwh = Math.max(0, withoutBatteryCharge.directExportKwh - dispatch.directExportKwh)
  const displacedCurtailmentKwh = Math.max(0, withoutBatteryCharge.curtailedKwh - dispatch.curtailedKwh)

  let remainingChargeKwh = dispatch.chargeToBatteryKwh
  const directUseChargeKwh = Math.min(remainingChargeKwh, displacedDirectUseKwh)
  remainingChargeKwh -= directUseChargeKwh
  const exportChargeKwh = Math.min(remainingChargeKwh, displacedExportKwh)
  remainingChargeKwh -= exportChargeKwh
  const curtailedChargeKwh = Math.min(remainingChargeKwh, displacedCurtailmentKwh)
  remainingChargeKwh -= curtailedChargeKwh

  insertStoredLot(pvLots, curtailedChargeKwh, 0)
  insertStoredLot(pvLots, exportChargeKwh, slot.exportPriceCtKwh)
  // Charging from PV instead of serving load immediately gives up avoided import cost.
  insertStoredLot(pvLots, directUseChargeKwh, slot.importPriceCtKwh)

  if (remainingChargeKwh > EPSILON) {
    insertStoredLot(pvLots, remainingChargeKwh, slot.exportPriceCtKwh)
  }
}

function consumeLowerValueStoredEnergy(
  pvLots: StoredEnergyLot[],
  gridLots: StoredEnergyLot[],
  storedToRemoveKwh: number,
  batteryToLoadKwh: number,
  batteryExportKwh: number,
  roundTripEff: number,
  importPriceCtKwh: number,
  exportPriceCtKwh: number,
): ExactBatteryDischargeSplit {
  if (storedToRemoveKwh <= EPSILON || roundTripEff <= EPSILON) {
    return {
      batteryPvToLoadKwh: 0,
      batteryGridToLoadKwh: 0,
      batteryGridLoadInputCostEur: 0,
      batteryPvExportKwh: 0,
      batteryGridExportKwh: 0,
      batteryPvExportSavingsEur: 0,
      batteryGridExportSavingsEur: 0,
      batteryLoadSavingsEur: 0,
      batteryExportSavingsEur: 0,
      batteryDischargeSavingsEur: 0,
    }
  }

  const sinkTargets = [
    {
      key: 'load' as const,
      remainingKwh: batteryToLoadKwh,
      valueCtKwh: importPriceCtKwh,
    },
    {
      key: 'export' as const,
      remainingKwh: batteryExportKwh,
      valueCtKwh: exportPriceCtKwh,
    },
  ].sort((a, b) => a.valueCtKwh - b.valueCtKwh)

  const split: ExactBatteryDischargeSplit = {
    batteryPvToLoadKwh: 0,
    batteryGridToLoadKwh: 0,
    batteryGridLoadInputCostEur: 0,
    batteryPvExportKwh: 0,
    batteryGridExportKwh: 0,
    batteryPvExportSavingsEur: 0,
    batteryGridExportSavingsEur: 0,
    batteryLoadSavingsEur: 0,
    batteryExportSavingsEur: 0,
    batteryDischargeSavingsEur: 0,
  }

  let remainingStoredKwh = storedToRemoveKwh

  while (remainingStoredKwh > EPSILON) {
    maybeShiftEmptyLot(pvLots)
    maybeShiftEmptyLot(gridLots)

    const pvLot = pvLots[0]
    const gridLot = gridLots[0]
    if (!pvLot && !gridLot) {
      throw new Error('optimizePvBattery: battery provenance inventory underflow')
    }

    const takePvLot = !!pvLot && (!gridLot || pvLot.valueCtKwh <= gridLot.valueCtKwh + EPSILON)
    const lot = takePvLot ? pvLot! : gridLot!
    const origin = takePvLot ? 'pv' : 'grid'
    const storedKwh = Math.min(lot.storedKwh, remainingStoredKwh)
    lot.storedKwh = round6(lot.storedKwh - storedKwh)
    remainingStoredKwh = round6(remainingStoredKwh - storedKwh)

    let remainingOutputKwh = storedKwh * roundTripEff
    for (const sink of sinkTargets) {
      if (remainingOutputKwh <= EPSILON) break
      if (sink.remainingKwh <= EPSILON) continue

      const allocatedKwh = Math.min(sink.remainingKwh, remainingOutputKwh)
      sink.remainingKwh = round6(sink.remainingKwh - allocatedKwh)
      remainingOutputKwh = Math.max(0, remainingOutputKwh - allocatedKwh)
      const storedInputEquivalentKwh = allocatedKwh / roundTripEff
      const storedInputCostEur = (lot.valueCtKwh * storedInputEquivalentKwh) / 100
      const realizedSavingsEur = (
        (sink.valueCtKwh * allocatedKwh) -
        (lot.valueCtKwh * storedInputEquivalentKwh)
      ) / 100

      if (origin === 'pv' && sink.key === 'load') split.batteryPvToLoadKwh += allocatedKwh
      if (origin === 'grid' && sink.key === 'load') split.batteryGridToLoadKwh += allocatedKwh
      if (origin === 'grid' && sink.key === 'load') split.batteryGridLoadInputCostEur += storedInputCostEur
      if (origin === 'pv' && sink.key === 'export') split.batteryPvExportKwh += allocatedKwh
      if (origin === 'grid' && sink.key === 'export') split.batteryGridExportKwh += allocatedKwh
      if (sink.key === 'load') split.batteryLoadSavingsEur += realizedSavingsEur
      if (sink.key === 'export') split.batteryExportSavingsEur += realizedSavingsEur
      if (origin === 'pv' && sink.key === 'export') split.batteryPvExportSavingsEur += realizedSavingsEur
      if (origin === 'grid' && sink.key === 'export') split.batteryGridExportSavingsEur += realizedSavingsEur
      split.batteryDischargeSavingsEur += realizedSavingsEur
    }
  }

  return {
    batteryPvToLoadKwh: round6(split.batteryPvToLoadKwh),
    batteryGridToLoadKwh: round6(split.batteryGridToLoadKwh),
    batteryGridLoadInputCostEur: round6(split.batteryGridLoadInputCostEur),
    batteryPvExportKwh: round6(split.batteryPvExportKwh),
    batteryGridExportKwh: round6(split.batteryGridExportKwh),
    batteryPvExportSavingsEur: round6(split.batteryPvExportSavingsEur),
    batteryGridExportSavingsEur: round6(split.batteryGridExportSavingsEur),
    batteryLoadSavingsEur: round6(split.batteryLoadSavingsEur),
    batteryExportSavingsEur: round6(split.batteryExportSavingsEur),
    batteryDischargeSavingsEur: round6(split.batteryDischargeSavingsEur),
  }
}

function choosePvToLoad(
  pvKwh: number,
  loadKwh: number,
  importPriceCtKwh: number,
  exportPriceCtKwh: number,
  exportCapKwh: number,
  pvToLoadEnabled: boolean,
  pvToGridEnabled: boolean,
): number {
  if (!pvToLoadEnabled || pvKwh <= EPSILON || loadKwh <= EPSILON) return 0

  const cappedExport = Math.max(0, exportCapKwh)
  const yMax = Math.min(pvKwh, loadKwh)
  const candidates = uniqueCandidates([
    0,
    yMax,
    clamp(pvKwh - cappedExport, 0, yMax),
  ])

  let bestY = 0
  let bestValue = Number.NEGATIVE_INFINITY

  for (const candidate of candidates) {
    const pvRemaining = Math.max(0, pvKwh - candidate)
    const directExportKwh = pvToGridEnabled
      ? Math.min(pvRemaining, cappedExport)
      : 0
    const value =
      candidate * importPriceCtKwh +
      directExportKwh * exportPriceCtKwh

    if (
      value > bestValue + EPSILON ||
      (Math.abs(value - bestValue) <= EPSILON && candidate > bestY + EPSILON)
    ) {
      bestValue = value
      bestY = candidate
    }
  }

  return bestY
}

function buildChargeDispatch(
  slot: OptimizerSlotInput,
  permissions: PvBatteryFlowPermissions,
  chargeKwh: number,
  feedInCapKwh: number,
): PvBatteryDispatch | null {
  const pvKwh = Math.max(0, slot.pvKwh)
  const loadKwh = Math.max(0, slot.loadKwh)
  const importPriceCtKwh = slot.importPriceCtKwh
  const exportPriceCtKwh = slot.exportPriceCtKwh
  const cappedExport = Math.max(0, feedInCapKwh)

  if (chargeKwh > EPSILON && !permissions.pvToBattery && !permissions.gridToBattery) {
    return null
  }

  const pvChargeMin = chargeKwh > EPSILON && !permissions.gridToBattery ? chargeKwh : 0
  const pvChargeMax = permissions.pvToBattery ? chargeKwh : 0
  if (pvChargeMin > pvChargeMax + EPSILON) return null

  const pvLoadMax = permissions.pvToLoad ? loadKwh : 0
  const zMin = pvChargeMin
  const zMax = Math.min(pvKwh, pvChargeMax + pvLoadMax)
  if (zMin > zMax + EPSILON) return null

  const candidates = uniqueCandidates([
    zMin,
    zMax,
    clamp(pvKwh - cappedExport, zMin, zMax),
  ])

  let bestDispatch: PvBatteryDispatch | null = null

  for (const z of candidates) {
    const directSelfKwh = Math.min(pvLoadMax, z - pvChargeMin)
    const chargeToBatteryKwh = z - directSelfKwh
    const gridToBatteryKwh = chargeKwh - chargeToBatteryKwh
    const pvRemaining = Math.max(0, pvKwh - z)
    const directExportKwh = permissions.pvToGrid
      ? Math.min(pvRemaining, cappedExport)
      : 0
    const curtailedKwh = Math.max(0, pvRemaining - directExportKwh)
    const gridImportKwh = Math.max(0, loadKwh - directSelfKwh)
    const slotImportKwh = gridImportKwh + gridToBatteryKwh
    const netCostEur =
      (slotImportKwh * importPriceCtKwh) / 100 -
      ((directExportKwh + 0) * exportPriceCtKwh) / 100

    const dispatch: PvBatteryDispatch = {
      directSelfKwh,
      chargeToBatteryKwh,
      gridToBatteryKwh,
      batteryToLoadKwh: 0,
      directExportKwh,
      batteryExportKwh: 0,
      curtailedKwh,
      gridImportKwh,
      netCostEur,
    }

    if (
      !bestDispatch ||
      netCostEur < bestDispatch.netCostEur - EPSILON ||
      (
        Math.abs(netCostEur - bestDispatch.netCostEur) <= EPSILON &&
        dispatch.gridToBatteryKwh + dispatch.gridImportKwh + dispatch.directExportKwh <
          bestDispatch.gridToBatteryKwh + bestDispatch.gridImportKwh + bestDispatch.directExportKwh - EPSILON
      )
    ) {
      bestDispatch = dispatch
    }
  }

  return bestDispatch
}

function buildDischargeDispatch(
  slot: OptimizerSlotInput,
  permissions: PvBatteryFlowPermissions,
  dischargeOutputKwh: number,
  feedInCapKwh: number,
): PvBatteryDispatch | null {
  const pvKwh = Math.max(0, slot.pvKwh)
  const loadKwh = Math.max(0, slot.loadKwh)
  const importPriceCtKwh = slot.importPriceCtKwh
  const exportPriceCtKwh = slot.exportPriceCtKwh
  const cappedExport = Math.max(0, feedInCapKwh)

  if (dischargeOutputKwh <= EPSILON) return buildChargeDispatch(slot, permissions, 0, feedInCapKwh)
  if (!permissions.batteryToLoad && !permissions.batteryToGrid) return null

  if (!permissions.batteryToLoad) {
    // Battery can only discharge to grid - check if discharge exceeds export cap
    if (!permissions.batteryToGrid || dischargeOutputKwh > cappedExport + EPSILON) return null
    const pvToLoadKwh = choosePvToLoad(
      pvKwh,
      loadKwh,
      importPriceCtKwh,
      exportPriceCtKwh,
      cappedExport - dischargeOutputKwh,
      permissions.pvToLoad,
      permissions.pvToGrid,
    )
    const directExportKwh = permissions.pvToGrid
      ? Math.min(Math.max(0, pvKwh - pvToLoadKwh), Math.max(0, cappedExport - dischargeOutputKwh))
      : 0
    const curtailedKwh = Math.max(0, pvKwh - pvToLoadKwh - directExportKwh)
    const gridImportKwh = Math.max(0, loadKwh - pvToLoadKwh)
    const netCostEur =
      (gridImportKwh * importPriceCtKwh) / 100 -
      ((directExportKwh + dischargeOutputKwh) * exportPriceCtKwh) / 100

    return {
      directSelfKwh: pvToLoadKwh,
      chargeToBatteryKwh: 0,
      gridToBatteryKwh: 0,
      batteryToLoadKwh: 0,
      directExportKwh,
      batteryExportKwh: dischargeOutputKwh,
      curtailedKwh,
      gridImportKwh,
      netCostEur,
    }
  }

  if (!permissions.batteryToGrid) {
    // Battery can only discharge to load - no export cap constraint needed
    // Discharge is limited by load, not by feed-in cap
    if (dischargeOutputKwh > loadKwh + EPSILON) return null
    const pvToLoadKwh = choosePvToLoad(
      pvKwh,
      Math.max(0, loadKwh - dischargeOutputKwh),
      importPriceCtKwh,
      exportPriceCtKwh,
      cappedExport,
      permissions.pvToLoad,
      permissions.pvToGrid,
    )
    const directExportKwh = permissions.pvToGrid
      ? Math.min(Math.max(0, pvKwh - pvToLoadKwh), cappedExport)
      : 0
    const curtailedKwh = Math.max(0, pvKwh - pvToLoadKwh - directExportKwh)
    const gridImportKwh = Math.max(0, loadKwh - dischargeOutputKwh - pvToLoadKwh)
    const netCostEur =
      (gridImportKwh * importPriceCtKwh) / 100 -
      (directExportKwh * exportPriceCtKwh) / 100

    return {
      directSelfKwh: pvToLoadKwh,
      chargeToBatteryKwh: 0,
      gridToBatteryKwh: 0,
      batteryToLoadKwh: dischargeOutputKwh,
      directExportKwh,
      batteryExportKwh: 0,
      curtailedKwh,
      gridImportKwh,
      netCostEur,
    }
  }

  if (!permissions.pvToGrid) {
    // No PV export allowed - battery can export but PV excess is curtailed
    // Battery discharge split: prioritize load first, then export up to cap
    const directSelfKwh = permissions.pvToLoad ? Math.min(pvKwh, loadKwh) : 0
    const residualLoadKwh = Math.max(0, loadKwh - directSelfKwh)
    let batteryToLoadKwh = exportPriceCtKwh > importPriceCtKwh
      ? Math.max(0, dischargeOutputKwh - cappedExport)
      : Math.min(dischargeOutputKwh, residualLoadKwh)

    const batteryExportKwh = dischargeOutputKwh - batteryToLoadKwh
    // Validate: battery to load cannot exceed residual load, battery export cannot exceed cap
    if (
      batteryToLoadKwh > residualLoadKwh + EPSILON ||
      batteryExportKwh > cappedExport + EPSILON
    ) {
      return null
    }

    const curtailedKwh = Math.max(0, pvKwh - directSelfKwh)
    const gridImportKwh = Math.max(0, loadKwh - directSelfKwh - batteryToLoadKwh)
    const netCostEur =
      (gridImportKwh * importPriceCtKwh) / 100 -
      (batteryExportKwh * exportPriceCtKwh) / 100

    return {
      directSelfKwh,
      chargeToBatteryKwh: 0,
      gridToBatteryKwh: 0,
      batteryToLoadKwh,
      directExportKwh: 0,
      batteryExportKwh,
      curtailedKwh,
      gridImportKwh,
      netCostEur,
    }
  }

  // Full flexibility: both PV and battery can export
  // z = total energy serving load (PV + battery combined)
  // Battery export is capped at feedInCapKwh, but total discharge is not limited by it
  const pvLoadMax = permissions.pvToLoad ? pvKwh : 0
  const zMin = 0
  const zMax = Math.min(loadKwh, dischargeOutputKwh + pvLoadMax)
  if (zMin > zMax + EPSILON) return null

  const candidates = uniqueCandidates([
    zMin,
    zMax,
    clamp(pvKwh + dischargeOutputKwh - cappedExport, zMin, zMax),
  ])

  let bestDispatch: PvBatteryDispatch | null = null

  for (const z of candidates) {
    const directSelfKwh = Math.min(pvLoadMax, z)
    const batteryToLoadKwh = z - directSelfKwh
    const batteryExportKwh = dischargeOutputKwh - batteryToLoadKwh
    // Only the grid export portion is capped, not total discharge
    if (batteryExportKwh > cappedExport + EPSILON) continue

    const pvRemaining = Math.max(0, pvKwh - directSelfKwh)
    const directExportKwh = Math.min(pvRemaining, Math.max(0, cappedExport - batteryExportKwh))
    const curtailedKwh = Math.max(0, pvRemaining - directExportKwh)
    const gridImportKwh = Math.max(0, loadKwh - z)
    const netCostEur =
      (gridImportKwh * importPriceCtKwh) / 100 -
      ((directExportKwh + batteryExportKwh) * exportPriceCtKwh) / 100

    const dispatch: PvBatteryDispatch = {
      directSelfKwh,
      chargeToBatteryKwh: 0,
      gridToBatteryKwh: 0,
      batteryToLoadKwh,
      directExportKwh,
      batteryExportKwh,
      curtailedKwh,
      gridImportKwh,
      netCostEur,
    }

    if (
      !bestDispatch ||
      netCostEur < bestDispatch.netCostEur - EPSILON ||
      (
        Math.abs(netCostEur - bestDispatch.netCostEur) <= EPSILON &&
        dispatch.batteryToLoadKwh + dispatch.directSelfKwh >
          bestDispatch.batteryToLoadKwh + bestDispatch.directSelfKwh + EPSILON
      )
    ) {
      bestDispatch = dispatch
    }
  }

  return bestDispatch
}

function buildDispatch(
  slot: OptimizerSlotInput,
  permissions: PvBatteryFlowPermissions,
  socStart: number,
  socEnd: number,
  roundTripEff: number,
  feedInCapKwh: number,
): PvBatteryDispatch | null {
  if (socEnd > socStart + EPSILON) {
    return buildChargeDispatch(slot, permissions, socEnd - socStart, feedInCapKwh)
  }

  if (socEnd < socStart - EPSILON) {
    if (roundTripEff <= EPSILON) return null
    return buildDischargeDispatch(
      slot,
      permissions,
      (socStart - socEnd) * roundTripEff,
      feedInCapKwh,
    )
  }

  return buildChargeDispatch(slot, permissions, 0, feedInCapKwh)
}

export function getAvailablePvBatteryYears(
  prices: HourlyPrice[],
  lastRealDate: string,
): number[] {
  const datesByYear = new Map<number, Set<string>>()
  for (const point of prices) {
    if (lastRealDate && point.date > lastRealDate) continue
    const year = Number(point.date.slice(0, 4))
    if (!Number.isFinite(year)) continue
    const yearDates = datesByYear.get(year) ?? new Set<string>()
    yearDates.add(point.date)
    datesByYear.set(year, yearDates)
  }

  return [...datesByYear.entries()]
    .filter(([year, yearDates]) => {
      if (yearDates.size !== getDaysInYear(year)) return false
      return yearDates.has(`${year}-01-01`) && yearDates.has(`${year}-12-31`)
    })
    .map(([year]) => year)
    .sort((a, b) => b - a)
}

export function buildDeYearLoadProfile(
  profileId: Exclude<DeBatteryLoadProfileId, 'H0'>,
  year: number,
): number[] {
  const profile = profileId as LoadProfile
  const start = new Date(Date.UTC(year, 0, 1))
  const isLeapYear = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
  const days = isLeapYear ? 366 : 365
  const values: number[] = []

  for (let offset = 0; offset < days; offset++) {
    const date = new Date(start.getTime() + offset * 86_400_000)
    if (date.getUTCMonth() === 1 && date.getUTCDate() === 29) continue
    const dateStr = `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
    const dayType = getDayType(dateStr)
    values.push(...getProfileHourlyWeights(date.getUTCMonth() + 1, dayType, profile))
  }

  return normalizeSeries(values)
}

export function buildProfileSeries(
  prices: HourlyPrice[],
  normalizedProfile: number[],
  annualKwh: number,
): number[] {
  const slotHours = getSlotHours(prices)
  return prices.map((point) => {
    const hourIdx = hourIndexFromTimestamp(point.timestamp)
    return (normalizedProfile[hourIdx] ?? 0) * annualKwh * slotHours
  })
}

export interface PvRadiationAdjustment {
  monthlyFactors: number[] // 12 monthly multipliers (e.g., 0.95, 1.05, etc.)
}

export function buildPvBatteryInputs(
  rawPrices: HourlyPrice[],
  loadProfile: number[],
  pvProfile: number[],
  scenario: PvBatteryCalculatorScenario,
  radiationAdjustment?: PvRadiationAdjustment | null,
): OptimizerSlotInput[] {
  const importPrices = mapPricesToRetailTariff(rawPrices, scenario.tariffId, scenario.country)
  const annualPvKwh = (scenario.pvCapacityWp / 1000) * PV_YIELD_KWH_PER_KWP[scenario.country]
  const slotHours = getSlotHours(rawPrices)
  const loadKwh = buildProfileSeries(rawPrices, loadProfile, scenario.annualLoadKwh)

  // Apply radiation adjustment if available
  let pvKwh: number[]
  if (radiationAdjustment) {
    pvKwh = rawPrices.map((point, index) => {
      const hourIdx = hourIndexFromTimestamp(point.timestamp)
      const baseValue = (pvProfile[hourIdx] ?? 0) * annualPvKwh * slotHours
      // Apply monthly factor based on the date
      const month = new Date(point.timestamp).getUTCMonth()
      const monthlyFactor = radiationAdjustment.monthlyFactors[month] ?? 1.0
      return baseValue * monthlyFactor
    })
  } else {
    pvKwh = buildProfileSeries(rawPrices, pvProfile, annualPvKwh)
  }

  return rawPrices.map((price, index) => ({
    price,
    importPriceCtKwh: importPrices[index]?.priceCtKwh ?? price.priceCtKwh,
    exportPriceCtKwh: Math.max(0, price.priceCtKwh * (scenario.exportCompensationPct / 100)),
    loadKwh: loadKwh[index] ?? 0,
    pvKwh: pvKwh[index] ?? 0,
  }))
}

export function optimizePvBattery(inputs: OptimizerSlotInput[], scenario: PvBatteryCalculatorScenario): PvBatteryAnnualResult {
  if (inputs.length === 0) {
    return {
      baselineCostEur: 0,
      gridImportCostEur: 0,
      exportRevenueEur: 0,
      netCostEur: 0,
      savingsEur: 0,
      directSelfConsumedKwh: 0,
      gridToBatteryKwh: 0,
      batteryToLoadKwh: 0,
      directExportKwh: 0,
      batteryExportKwh: 0,
      curtailedKwh: 0,
      gridImportKwh: 0,
      pvGenerationKwh: 0,
      loadKwh: 0,
      selfSufficiencyPct: 0,
      selfConsumptionPct: 0,
      months: [],
      slots: [],
    }
  }

  const slotHours = getSlotHours(inputs.map((entry) => entry.price))
  const chargeLimitKwh = scenario.maxChargeKw * slotHours
  const dischargeLimitKwh = scenario.maxDischargeKw * slotHours
  const feedInCapKwh = scenario.feedInCapKw * slotHours
  const capacity = clamp(scenario.usableKwh, 0, 20)
  const roundTripEff = clamp(scenario.roundTripEff, 0, 1)
  const permissions = normalizeFlowPermissions(scenario.flowPermissions)
  const stateCount = Math.max(1, Math.floor(capacity / SOC_STEP_KWH + 1e-9) + 1)
  const bestNext = Array.from({ length: inputs.length }, () => new Uint16Array(stateCount))

  let nextValues = new Float64Array(stateCount)

  for (let slotIndex = inputs.length - 1; slotIndex >= 0; slotIndex--) {
    const currentValues = new Float64Array(stateCount)
    const slot = inputs[slotIndex]

    for (let stateIndex = 0; stateIndex < stateCount; stateIndex++) {
      const soc = stateIndex * SOC_STEP_KWH
      let bestValue = Number.POSITIVE_INFINITY
      let bestStateIndex = stateIndex

      const maxChargeKwh = Math.min(chargeLimitKwh, capacity - soc)
      const maxChargeIndex = Math.min(stateCount - 1, Math.floor((soc + maxChargeKwh + 1e-9) / SOC_STEP_KWH))
      for (let nextIndex = stateIndex; nextIndex <= maxChargeIndex; nextIndex++) {
        const nextSoc = nextIndex * SOC_STEP_KWH
        const dispatch = buildDispatch(slot, permissions, soc, nextSoc, roundTripEff, feedInCapKwh)
        if (!dispatch) continue

        const candidate = dispatch.netCostEur + nextValues[nextIndex]
        const currentDelta = Math.abs(bestStateIndex - stateIndex)
        const nextDelta = Math.abs(nextIndex - stateIndex)
        if (
          candidate < bestValue - EPSILON ||
          (Math.abs(candidate - bestValue) <= EPSILON && nextDelta < currentDelta)
        ) {
          bestValue = candidate
          bestStateIndex = nextIndex
        }
      }

      if (roundTripEff > EPSILON) {
        const maxDischargeKwh = Math.min(dischargeLimitKwh, soc * roundTripEff)
        const minNextSoc = Math.max(0, soc - maxDischargeKwh / roundTripEff)
        const minNextIndex = Math.max(0, Math.ceil((minNextSoc - 1e-9) / SOC_STEP_KWH))

        for (let nextIndex = minNextIndex; nextIndex < stateIndex; nextIndex++) {
          const nextSoc = nextIndex * SOC_STEP_KWH
          const dispatch = buildDispatch(slot, permissions, soc, nextSoc, roundTripEff, feedInCapKwh)
          if (!dispatch) continue

          const candidate = dispatch.netCostEur + nextValues[nextIndex]
          const currentDelta = Math.abs(bestStateIndex - stateIndex)
          const nextDelta = Math.abs(nextIndex - stateIndex)
          if (
            candidate < bestValue - EPSILON ||
            (Math.abs(candidate - bestValue) <= EPSILON && nextDelta < currentDelta)
          ) {
            bestValue = candidate
            bestStateIndex = nextIndex
          }
        }
      }

      currentValues[stateIndex] = Number.isFinite(bestValue) ? bestValue : nextValues[stateIndex]
      bestNext[slotIndex][stateIndex] = bestStateIndex
    }

    nextValues = currentValues
  }

  const monthMap = new Map<string, PvBatteryMonthResult>()
  const slots: PvBatterySlotResult[] = []
  let stateIndex = 0

  let baselineCostEur = 0
  let gridImportCostEur = 0
  let exportRevenueEur = 0
  let directSelfConsumedKwh = 0
  let gridToBatteryKwh = 0
  let batteryToLoadKwh = 0
  let directExportKwh = 0
  let batteryExportKwh = 0
  let curtailedKwh = 0
  let gridImportKwh = 0
  let pvGenerationKwh = 0
  let loadKwh = 0
  let pvBatteryToLoadKwh = 0
  const pvLots: StoredEnergyLot[] = []
  const gridLots: StoredEnergyLot[] = []

  for (let slotIndex = 0; slotIndex < inputs.length; slotIndex++) {
    const slot = inputs[slotIndex]
    const socStart = stateIndex * SOC_STEP_KWH
    const nextIndex = bestNext[slotIndex][stateIndex]
    const socEnd = nextIndex * SOC_STEP_KWH
    const dispatch = buildDispatch(slot, permissions, socStart, socEnd, roundTripEff, feedInCapKwh)
    if (!dispatch) {
      throw new Error(`optimizePvBattery: infeasible dispatch reconstruction at slot ${slotIndex}`)
    }

    const slotBaselineCostEur = (slot.loadKwh * slot.importPriceCtKwh) / 100
    const slotImportCostEur = ((dispatch.gridImportKwh + dispatch.gridToBatteryKwh) * slot.importPriceCtKwh) / 100
    const slotExportRevenueEur = ((dispatch.directExportKwh + dispatch.batteryExportKwh) * slot.exportPriceCtKwh) / 100
    const slotNetCostEur = slotImportCostEur - slotExportRevenueEur
    const slotSavingsEur = slotBaselineCostEur - slotNetCostEur

    if (dispatch.chargeToBatteryKwh > EPSILON) {
      storePvChargeLots(pvLots, slot, permissions, dispatch, feedInCapKwh)
    }
    if (dispatch.gridToBatteryKwh > EPSILON) {
      insertStoredLot(gridLots, dispatch.gridToBatteryKwh, slot.importPriceCtKwh)
    }

    const exactDischargeSplit = consumeLowerValueStoredEnergy(
      pvLots,
      gridLots,
      socStart - socEnd,
      dispatch.batteryToLoadKwh,
      dispatch.batteryExportKwh,
      roundTripEff,
      slot.importPriceCtKwh,
      slot.exportPriceCtKwh,
    )
    pvBatteryToLoadKwh += exactDischargeSplit.batteryPvToLoadKwh

    const month = slot.price.date.slice(0, 7)
    const monthEntry = monthMap.get(month) ?? {
      month,
      baselineCostEur: 0,
      gridImportCostEur: 0,
      exportRevenueEur: 0,
      netCostEur: 0,
      savingsEur: 0,
    }

    monthEntry.baselineCostEur += slotBaselineCostEur
    monthEntry.gridImportCostEur += slotImportCostEur
    monthEntry.exportRevenueEur += slotExportRevenueEur
    monthEntry.netCostEur += slotNetCostEur
    monthEntry.savingsEur += slotSavingsEur
    monthMap.set(month, monthEntry)

    baselineCostEur += slotBaselineCostEur
    gridImportCostEur += slotImportCostEur
    exportRevenueEur += slotExportRevenueEur
    directSelfConsumedKwh += dispatch.directSelfKwh
    gridToBatteryKwh += dispatch.gridToBatteryKwh
    batteryToLoadKwh += dispatch.batteryToLoadKwh
    directExportKwh += dispatch.directExportKwh
    batteryExportKwh += dispatch.batteryExportKwh
    curtailedKwh += dispatch.curtailedKwh
    gridImportKwh += dispatch.gridImportKwh
    pvGenerationKwh += slot.pvKwh
    loadKwh += slot.loadKwh

    slots.push({
      timestamp: slot.price.timestamp,
      date: slot.price.date,
      hour: slot.price.hour,
      minute: slot.price.minute ?? 0,
      label: formatLabel(slot.price),
      spotPriceCtKwh: round2(slot.price.priceCtKwh),
      householdImportPriceCtKwh: round2(slot.importPriceCtKwh),
      hasSeparateHouseholdImportPrice: Math.abs(slot.importPriceCtKwh - slot.price.priceCtKwh) > EPSILON,
      importPriceCtKwh: round2(slot.importPriceCtKwh),
      exportPriceCtKwh: round2(slot.exportPriceCtKwh),
      loadKwh: round3(slot.loadKwh),
      pvKwh: round3(slot.pvKwh),
      directSelfKwh: round3(dispatch.directSelfKwh),
      pvToLoadKwh: round3(dispatch.directSelfKwh),
      chargeToBatteryKwh: round3(dispatch.chargeToBatteryKwh),
      pvToBatteryKwh: round3(dispatch.chargeToBatteryKwh),
      gridToBatteryKwh: round3(dispatch.gridToBatteryKwh),
      batteryToLoadKwh: round3(dispatch.batteryToLoadKwh),
      batteryPvToLoadKwh: round3(exactDischargeSplit.batteryPvToLoadKwh),
      batteryGridToLoadKwh: round3(exactDischargeSplit.batteryGridToLoadKwh),
      batteryGridLoadInputCostEur: round3(exactDischargeSplit.batteryGridLoadInputCostEur),
      batteryLoadSavingsEur: round3(exactDischargeSplit.batteryLoadSavingsEur),
      directExportKwh: round3(dispatch.directExportKwh),
      pvToGridKwh: round3(dispatch.directExportKwh),
      batteryExportKwh: round3(dispatch.batteryExportKwh),
      batteryPvExportKwh: round3(exactDischargeSplit.batteryPvExportKwh),
      batteryGridExportKwh: round3(exactDischargeSplit.batteryGridExportKwh),
      batteryPvExportSavingsEur: round3(exactDischargeSplit.batteryPvExportSavingsEur),
      batteryGridExportSavingsEur: round3(exactDischargeSplit.batteryGridExportSavingsEur),
      batteryExportSavingsEur: round3(exactDischargeSplit.batteryExportSavingsEur),
      batteryDischargeSavingsEur: round3(exactDischargeSplit.batteryDischargeSavingsEur),
      curtailedKwh: round3(dispatch.curtailedKwh),
      gridImportKwh: round3(dispatch.gridImportKwh),
      gridToLoadKwh: round3(dispatch.gridImportKwh),
      isGridChargingBattery: dispatch.gridToBatteryKwh > EPSILON,
      isBatteryDischarging: dispatch.batteryToLoadKwh > EPSILON || dispatch.batteryExportKwh > EPSILON,
      isBatteryExporting: dispatch.batteryExportKwh > EPSILON,
      isDirectPvExporting: dispatch.directExportKwh > EPSILON,
      socKwhStart: round3(socStart),
      socKwhEnd: round3(socEnd),
      baselineCostEur: round3(slotBaselineCostEur),
      gridImportCostEur: round3(slotImportCostEur),
      exportRevenueEur: round3(slotExportRevenueEur),
      netCostEur: round3(slotNetCostEur),
      savingsEur: round3(slotSavingsEur),
    })

    stateIndex = nextIndex
  }

  const netCostEur = gridImportCostEur - exportRevenueEur
  const savingsEur = baselineCostEur - netCostEur
  const selfSufficiencyPct = loadKwh > 0
    ? ((directSelfConsumedKwh + pvBatteryToLoadKwh) / loadKwh) * 100
  : 0
  const selfConsumptionPct = pvGenerationKwh > 0
    ? ((directSelfConsumedKwh + pvBatteryToLoadKwh) / pvGenerationKwh) * 100
    : 0

  return {
    baselineCostEur: round2(baselineCostEur),
    gridImportCostEur: round2(gridImportCostEur),
    exportRevenueEur: round2(exportRevenueEur),
    netCostEur: round2(netCostEur),
    savingsEur: round2(savingsEur),
    directSelfConsumedKwh: round2(directSelfConsumedKwh),
    gridToBatteryKwh: round2(gridToBatteryKwh),
    batteryToLoadKwh: round2(batteryToLoadKwh),
    directExportKwh: round2(directExportKwh),
    batteryExportKwh: round2(batteryExportKwh),
    curtailedKwh: round2(curtailedKwh),
    gridImportKwh: round2(gridImportKwh),
    pvGenerationKwh: round2(pvGenerationKwh),
    loadKwh: round2(loadKwh),
    selfSufficiencyPct: round2(selfSufficiencyPct),
    selfConsumptionPct: round2(selfConsumptionPct),
    months: [...monthMap.values()]
      .sort((a, b) => a.month.localeCompare(b.month))
      .map((month) => ({
        ...month,
        baselineCostEur: round2(month.baselineCostEur),
        gridImportCostEur: round2(month.gridImportCostEur),
        exportRevenueEur: round2(month.exportRevenueEur),
        netCostEur: round2(month.netCostEur),
        savingsEur: round2(month.savingsEur),
      })),
    slots,
  }
}
