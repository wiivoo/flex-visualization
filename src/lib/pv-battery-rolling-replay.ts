import {
  aggregatePvBatteryAnnualResult,
  optimizePvBatteryWithOptions,
  type OptimizerSlotInput,
  type PvBatteryAnnualResult,
  type PvBatteryCalculatorScenario,
  type PvBatteryInventoryState,
  type PvBatteryPlannerAssumptions,
  type PvBatteryRunProvenance,
} from '@/lib/pv-battery-calculator'

export interface PvBatteryRollingReplayOptions {
  initialSocKwh: number
  runHour?: number
  runMinute?: number
  modelLabel?: string
  assumptions?: Partial<PvBatteryPlannerAssumptions>
}

function pad2(value: number): string {
  return String(value).padStart(2, '0')
}

function formatDate(value: Date): string {
  return `${value.getUTCFullYear()}-${pad2(value.getUTCMonth() + 1)}-${pad2(value.getUTCDate())}`
}

function nextDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`)
  value.setUTCDate(value.getUTCDate() + 1)
  return formatDate(value)
}

function formatRunLabel(input: OptimizerSlotInput, isBootstrap: boolean): string {
  const base = `${input.price.date} ${pad2(input.price.hour)}:${pad2(input.price.minute ?? 0)}`
  return isBootstrap ? `${base} bootstrap` : base
}

function buildRollingReplayAssumptions(
  runHour: number,
  overrides: Partial<PvBatteryPlannerAssumptions> | undefined,
): PvBatteryPlannerAssumptions {
  return {
    objective: 'Minimize modeled household net electricity cost',
    loadForecastSource: 'H25 household load forecast',
    pvForecastSource: 'Existing PV profile plus active radiation adjustment',
    priceSource: 'Historical published day-ahead replay',
    tariffBasis: 'Retail import tariff with spot-linked export valuation',
    replanCadence: `Year-start bootstrap, then daily replanning at ${pad2(runHour)}:00`,
    terminalRule: 'Final SoC equals initial SoC for each run',
    ...overrides,
  }
}

function buildRunStartIndices(
  inputs: OptimizerSlotInput[],
  runHour: number,
  runMinute: number,
): number[] {
  if (inputs.length === 0) return []

  const indices = [0]
  for (let index = 1; index < inputs.length; index += 1) {
    const point = inputs[index].price
    if (point.hour === runHour && (point.minute ?? 0) === runMinute) {
      indices.push(index)
    }
  }
  return indices
}

function getKnownHorizonEndIndex(inputs: OptimizerSlotInput[], startIndex: number): number {
  const horizonEndDate = nextDate(inputs[startIndex].price.date)
  let endIndex = startIndex
  while (endIndex + 1 < inputs.length && inputs[endIndex + 1].price.date <= horizonEndDate) {
    endIndex += 1
  }
  return endIndex
}

function buildRunId(input: OptimizerSlotInput): string {
  return `rolling-${input.price.date}-${pad2(input.price.hour)}${pad2(input.price.minute ?? 0)}`
}

function totalStoredKwh(inventory: PvBatteryInventoryState | null): number {
  if (!inventory) return 0
  return inventory.pvLots.reduce((sum, lot) => sum + lot.storedKwh, 0)
    + inventory.gridLots.reduce((sum, lot) => sum + lot.storedKwh, 0)
}

export function optimizePvBatteryRollingReplay(
  inputs: OptimizerSlotInput[],
  scenario: PvBatteryCalculatorScenario,
  options: PvBatteryRollingReplayOptions,
): PvBatteryAnnualResult {
  const runHour = options.runHour ?? 12
  const runMinute = options.runMinute ?? 0
  const modelLabel = options.modelLabel ?? 'Rolling day-ahead planner'
  const assumptions = buildRollingReplayAssumptions(runHour, options.assumptions)

  if (inputs.length === 0) {
    return aggregatePvBatteryAnnualResult([], {
      planningModel: 'rolling',
      modelLabel,
      assumptions,
      runs: [],
    })
  }

  const runStartIndices = buildRunStartIndices(inputs, runHour, runMinute)
  const committedSlots: PvBatteryAnnualResult['slots'] = []
  const runs: PvBatteryRunProvenance[] = []
  let carriedSocKwh = options.initialSocKwh
  let carriedInventory: PvBatteryInventoryState | null = null

  for (let runNumber = 0; runNumber < runStartIndices.length; runNumber += 1) {
    const runStartIndex = runStartIndices[runNumber]
    const nextRunStartIndex = runStartIndices[runNumber + 1] ?? inputs.length
    const knownHorizonEndIndex = getKnownHorizonEndIndex(inputs, runStartIndex)
    const runInputs = inputs.slice(runStartIndex, knownHorizonEndIndex + 1)
    const committedSlotCount = Math.max(
      1,
      Math.min(nextRunStartIndex - runStartIndex, runInputs.length),
    )
    const committedLastInput = runInputs[committedSlotCount - 1]
    const isBootstrap = runNumber === 0 && (
      runInputs[0].price.hour !== runHour ||
      (runInputs[0].price.minute ?? 0) !== runMinute
    )

    const runResult = optimizePvBatteryWithOptions(runInputs, scenario, {
      initialSocKwh: carriedSocKwh,
      terminalSocKwh: carriedSocKwh,
      planningModel: 'rolling',
      modelLabel,
      assumptions,
      initialInventory: carriedInventory,
      run: {
        runId: buildRunId(runInputs[0]),
        runTimestamp: runInputs[0].price.timestamp,
        runDate: runInputs[0].price.date,
        runLabel: formatRunLabel(runInputs[0], isBootstrap),
        knownHorizonStart: runInputs[0].price.timestamp,
        knownHorizonEnd: runInputs[runInputs.length - 1].price.timestamp,
        committedFrom: runInputs[0].price.timestamp,
        committedUntil: committedLastInput.price.timestamp,
        initialSocKwh: carriedSocKwh,
        terminalSocKwh: carriedSocKwh,
        terminalRule: assumptions.terminalRule,
        loadForecastSource: assumptions.loadForecastSource,
        pvForecastSource: assumptions.pvForecastSource,
        priceSource: assumptions.priceSource,
        tariffBasis: assumptions.tariffBasis,
        committedSlotCount,
      },
    })

    const committedSlice = runResult.slots.slice(0, committedSlotCount)
    committedSlots.push(...committedSlice)
    runs.push(runResult.runs[0])

    carriedInventory = runResult.inventoryAtCommittedEnd ?? null
    const lastCommittedSlot = committedSlice[committedSlice.length - 1]
    if (carriedInventory) {
      carriedSocKwh = totalStoredKwh(carriedInventory)
    } else if (lastCommittedSlot) {
      carriedSocKwh = lastCommittedSlot.socKwhEnd
    }
  }

  return aggregatePvBatteryAnnualResult(committedSlots, {
    planningModel: 'rolling',
    modelLabel,
    assumptions,
    runs,
  })
}
