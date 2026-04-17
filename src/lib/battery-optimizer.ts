/**
 * Battery Day + Annual Optimizer — greedy three-pass SoC-constrained schedule.
 *
 * Purpose: correctness-critical pure-logic core for the /battery business case page
 * (phase 08). Invoked client-side by plans 08-06 (day chart) and 08-07 (ROI card).
 *
 * Hard constraints (enforced in Pass 3, validated by test suite):
 *  - Grid export is ALWAYS 0 for every slot. Phase 8 models the plug-in battery
 *    regime under which DE prohibits battery-to-grid export via VDE-AR-N
 *    4105:2026-03 and NL post-2027 economics make it uneconomical (terugleverkosten).
 *  - State of charge always in [0, usableKwh].
 *  - Per-slot energy conservation: loadKwh = pvSelfKwh + dischargeToLoadKwh + gridImportKwh.
 *    Here gridImportKwh is the residual grid draw that serves load; battery charging from
 *    the grid is tracked separately in chargeFromGridKwh and added to cost but not to
 *    this conservation equation.
 *  - Round-trip efficiency applied on charge→discharge path (energy out of battery =
 *    stored energy × roundTripEff).
 *  - Standby parasitic draw accrued as a window scalar cost on top of optimizedCost.
 *
 * Algorithm (three-pass greedy — matches RESEARCH.md Pattern 1):
 *  Pass 1  Initialise slot array with PV-direct self-consumption (free energy baseline).
 *          Set gridImportKwh = loadKwh - pvSelfKwh; slotCost = gridImport × price.
 *  Pass 2  Walk chronologically. For each slot:
 *            (a) Charge battery from PV surplus (free).
 *            (b) If price is in the cheap quantile, charge from grid up to budget.
 *            (c) If price is in the expensive quantile and SoC > 0, discharge to load
 *                up to min(maxDischarge, residual load, socKwh × roundTripEff, feedInCap).
 *          Require a minimum cheap/expensive spread (> 0.5 ct/kWh) before cycling,
 *          so flat-price days leave the battery idle (matches physical reality and the
 *          "arbitrageSavings >= 0" invariant).
 *  Pass 3  Belt-and-suspenders enforcement: gridExport := 0, gridImport := max(0, …),
 *          socKwhEnd clamped to [0, usableKwh], socKwhStart re-linked.
 *
 * Performance: O(N log N) per window (N = 96 per day at quarter-hour resolution). < 5 ms on a laptop.
 */

import type { HourlyPrice } from '@/lib/v2-config'

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface BatteryParams {
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number            // AC-to-AC efficiency in [0, 1]
  standbyWatts: number            // continuous parasitic draw
  feedInCapKw: number             // hardware feed-in cap (DE 0.8, user-toggle 2.0)
  allowGridExport: boolean        // MUST be false in Phase 8; Pass 3 enforces 0 regardless
  buyPriceCtKwh?: (daPrice: number) => number
  sellPriceCtKwh?: (daPrice: number) => number
}

export interface SlotResult {
  timestamp: number
  hour: number
  minute: number
  priceCtKwh: number
  pvKwh: number
  loadKwh: number
  pvSelfKwh: number               // PV used directly by load
  chargeFromPvKwh: number         // PV surplus routed into battery
  chargeFromGridKwh: number       // grid energy routed into battery (cheap slots)
  dischargeToLoadKwh: number      // battery energy delivered to load
  gridImportKwh: number           // residual grid draw for load (always >= 0)
  gridExportKwh: number           // always 0 under plug-in regime
  socKwhStart: number
  socKwhEnd: number
  slotCostEur: number             // (gridImportKwh + chargeFromGridKwh) × price / 100
  baselineCostEur: number         // loadKwh × price / 100 (no PV, no battery)
}

export interface DaySummary {
  baselineCostEur: number         // Σ baselineCostEur (no-PV, no-battery scenario)
  optimizedCostEur: number        // Σ slotCostEur + standbyCostEur
  savingsEur: number              // baselineCostEur − optimizedCostEur
  arbitrageSavingsEur: number     // portion of savings from charge-cheap / discharge-expensive
  pvSelfConsumptionValueEur: number  // portion from direct PV + PV-to-battery-to-load
  standbyCostEur: number          // always >= 0
  gridImportKwh: number
  gridExportKwh: number           // always 0
  batteryCyclesEquivalent: number // Σ(charge kWh) / usableKwh
}

export interface MonthlyBatteryResult {
  month: string                   // 'YYYY-MM'
  savingsEur: number
  arbitrageSavingsEur: number
  pvSelfConsumptionValueEur: number
  standbyCostEur: number
  cyclesEquivalent: number
}

export interface AnnualBatteryResult {
  annualSavingsEur: number
  arbitrageSavingsEur: number
  pvSelfConsumptionValueEur: number
  standbyCostEur: number
  gridImportKwh: number
  cyclesEquivalent: number
  months: MonthlyBatteryResult[]
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/** Minimum spread between cheap and expensive cutoffs before the optimizer cycles.
 *  Below this threshold, no arbitrage is worth the round-trip efficiency penalty,
 *  so the battery idles. Keeps arbitrageSavings >= 0 on flat-price days. */
const MIN_ARBITRAGE_SPREAD_CT_KWH = 0.5

/** Build a fully zeroed day result — used by the zero-capacity guard. */
function zeroedDay(prices: HourlyPrice[]): { slots: SlotResult[]; summary: DaySummary } {
  const slots: SlotResult[] = prices.map((p) => ({
    timestamp: p.timestamp,
    hour: p.hour,
    minute: p.minute,
    priceCtKwh: p.priceCtKwh,
    pvKwh: 0,
    loadKwh: 0,
    pvSelfKwh: 0,
    chargeFromPvKwh: 0,
    chargeFromGridKwh: 0,
    dischargeToLoadKwh: 0,
    gridImportKwh: 0,
    gridExportKwh: 0,
    socKwhStart: 0,
    socKwhEnd: 0,
    slotCostEur: 0,
    baselineCostEur: 0,
  }))
  return {
    slots,
    summary: {
      baselineCostEur: 0,
      optimizedCostEur: 0,
      savingsEur: 0,
      arbitrageSavingsEur: 0,
      pvSelfConsumptionValueEur: 0,
      standbyCostEur: 0,
      gridImportKwh: 0,
      gridExportKwh: 0,
      batteryCyclesEquivalent: 0,
    },
  }
}

// ---------------------------------------------------------------------------
// runBatteryDay — fixed-interval window optimizer
// ---------------------------------------------------------------------------

export function runBatteryDay(
  prices: HourlyPrice[],
  pvKwhPerSlot: number[],
  loadKwhPerSlot: number[],
  params: BatteryParams,
  startSocKwh: number = 0,
): { slots: SlotResult[]; summary: DaySummary } {
  // Guard: zero capacity or zero charge power → nothing to do.
  if (params.usableKwh <= 0 || params.maxChargeKw <= 0) return zeroedDay(prices)
  if (prices.length === 0) return zeroedDay(prices)

  // Guard: length mismatch is a programmer error — fail loudly.
  if (pvKwhPerSlot.length !== prices.length || loadKwhPerSlot.length !== prices.length) {
    throw new Error(
      `runBatteryDay: length mismatch — prices=${prices.length}, ` +
        `pv=${pvKwhPerSlot.length}, load=${loadKwhPerSlot.length}`,
    )
  }

  const N = prices.length
  const slotHours =
    N > 1
      ? Math.max(1 / 60, (prices[1].timestamp - prices[0].timestamp) / 3_600_000)
      : 24 / N
  const windowHours = slotHours * N
  const maxChargePerSlot = params.maxChargeKw * slotHours
  const maxDischargePerSlot = params.maxDischargeKw * slotHours
  const feedInCapPerSlot = params.feedInCapKw * slotHours

  // -------------------------------------------------------------------------
  // Pass 1 — initialise slots with PV-direct self-consumption
  // -------------------------------------------------------------------------
  const slots: SlotResult[] = new Array(N)
  for (let i = 0; i < N; i++) {
    const p = prices[i]
    const pvKwh = Math.max(0, pvKwhPerSlot[i])
    const loadKwh = Math.max(0, loadKwhPerSlot[i])
    const pvSelfKwh = Math.min(pvKwh, loadKwh)
    const baselineGridKwh = Math.max(0, loadKwh - pvSelfKwh)
    slots[i] = {
      timestamp: p.timestamp,
      hour: p.hour,
      minute: p.minute,
      priceCtKwh: p.priceCtKwh,
      pvKwh,
      loadKwh,
      pvSelfKwh,
      chargeFromPvKwh: 0,
      chargeFromGridKwh: 0,
      dischargeToLoadKwh: 0,
      gridImportKwh: baselineGridKwh,
      gridExportKwh: 0,
      socKwhStart: 0,
      socKwhEnd: 0,
      slotCostEur: (baselineGridKwh * p.priceCtKwh) / 100,
      baselineCostEur: (loadKwh * p.priceCtKwh) / 100,
    }
  }

  // -------------------------------------------------------------------------
  // Pass 2 — chronological schedule: PV→battery, grid-charge cheap, discharge expensive
  // -------------------------------------------------------------------------
  // Cheap/expensive thresholds — range-relative rather than percentile-based.
  // Percentile cutoffs fail on trimodal distributions (e.g. 6h cheap / 13h mid /
  // 5h expensive): the 40th and 60th percentile both land inside the mid band,
  // hiding real arbitrage opportunity. Range-relative (20% shoulders on each
  // side of the min/max spread) always triggers when there's any meaningful
  // spread and cleanly idles the battery on flat-price days.
  let minPrice = Infinity
  let maxPrice = -Infinity
  for (let i = 0; i < N; i++) {
    const p = slots[i].priceCtKwh
    if (p < minPrice) minPrice = p
    if (p > maxPrice) maxPrice = p
  }
  const priceRange = maxPrice - minPrice
  const cheapCutoff = minPrice + priceRange * 0.2
  const expensiveCutoff = maxPrice - priceRange * 0.2
  const hasArbitrageSpread = expensiveCutoff - cheapCutoff > MIN_ARBITRAGE_SPREAD_CT_KWH

  let socKwh = Math.max(0, Math.min(startSocKwh, params.usableKwh))

  for (let i = 0; i < N; i++) {
    const s = slots[i]
    s.socKwhStart = socKwh

    // (a) PV surplus → battery (free energy).
    const pvSurplus = Math.max(0, s.pvKwh - s.pvSelfKwh)
    const headroomAfterPv = params.usableKwh - socKwh
    const chargeFromPv = Math.min(pvSurplus, maxChargePerSlot, headroomAfterPv)
    if (chargeFromPv > 0) {
      s.chargeFromPvKwh = chargeFromPv
      socKwh += chargeFromPv
    }

    // (b) Grid charging when price is cheap (only if there is a real arbitrage spread).
    if (hasArbitrageSpread && s.priceCtKwh <= cheapCutoff) {
      const chargeBudget = Math.min(
        maxChargePerSlot - s.chargeFromPvKwh,
        params.usableKwh - socKwh,
      )
      if (chargeBudget > 0) {
        s.chargeFromGridKwh = chargeBudget
        socKwh += chargeBudget
      }
    }

    // (c) Discharge to load when price is expensive and battery has energy.
    if (hasArbitrageSpread && s.priceCtKwh >= expensiveCutoff && socKwh > 0) {
      // Energy delivered to load = socKwh × roundTripEff (penalty on discharge side).
      // Capped by: max discharge power, residual load (no export!), feed-in cap.
      const residualLoad = Math.max(0, s.loadKwh - s.pvSelfKwh - s.dischargeToLoadKwh)
      const energyAvailableOut = socKwh * params.roundTripEff
      const maxOut = Math.max(
        0,
        Math.min(maxDischargePerSlot, residualLoad, energyAvailableOut, feedInCapPerSlot),
      )
      if (maxOut > 0) {
        s.dischargeToLoadKwh = maxOut
        // Battery draw from stored energy to deliver maxOut to load.
        const batteryDraw = maxOut / params.roundTripEff
        socKwh = Math.max(0, socKwh - batteryDraw)
        // Residual grid draw for load = baseline load − PV-self − battery-discharge.
        s.gridImportKwh = Math.max(0, s.loadKwh - s.pvSelfKwh - s.dischargeToLoadKwh)
      }
    }

    // slotCost accounts for residual grid load + grid-to-battery charging.
    s.slotCostEur = ((s.gridImportKwh + s.chargeFromGridKwh) * s.priceCtKwh) / 100
    s.socKwhEnd = socKwh
  }

  // -------------------------------------------------------------------------
  // Pass 3 — invariant enforcement (belt and suspenders)
  // -------------------------------------------------------------------------
  for (let i = 0; i < N; i++) {
    const s = slots[i]
    if (s.gridImportKwh < 0) s.gridImportKwh = 0
    s.gridExportKwh = 0                                     // DE/NL plug-in regime
    if (s.socKwhEnd < 0) s.socKwhEnd = 0
    if (s.socKwhEnd > params.usableKwh) s.socKwhEnd = params.usableKwh
    if (i > 0) s.socKwhStart = slots[i - 1].socKwhEnd
  }

  // -------------------------------------------------------------------------
  // Roll up summary
  // -------------------------------------------------------------------------
  const baselineCostEur = slots.reduce((a, s) => a + s.baselineCostEur, 0)
  const slotCostSum = slots.reduce((a, s) => a + s.slotCostEur, 0)
  const avgPriceCtKwh = slots.reduce((a, s) => a + s.priceCtKwh, 0) / N
  const standbyCostEur = ((params.standbyWatts * windowHours) / 1000) * avgPriceCtKwh / 100
  const optimizedCostEur = slotCostSum + standbyCostEur
  const savingsEur = baselineCostEur - optimizedCostEur

  // Attribution:
  //   arbitrageSavings = Σ(dischargeToLoad × price) − Σ(chargeFromGrid × price)
  //     Intuition: discharge at expensive times saves grid cost of that amount;
  //     grid charging at cheap times is what we pay for that stored energy.
  //     The round-trip efficiency penalty shows up because dischargeToLoad < chargeFromGrid × eff,
  //     so when price spread is small, arbitrageSavings → 0 (battery idles and spread check
  //     prevents cycling).
  //   pvSelfConsumptionValue = Σ(pvSelf × price) + Σ(chargeFromPv × eff × avgPrice)
  //     First term = direct PV self-consumption saved grid cost.
  //     Second term = stored PV that will later displace grid at ~avg price.
  const dischargeRevenueEur = slots.reduce(
    (a, s) => a + (s.dischargeToLoadKwh * s.priceCtKwh) / 100,
    0,
  )
  const gridChargeCostEur = slots.reduce(
    (a, s) => a + (s.chargeFromGridKwh * s.priceCtKwh) / 100,
    0,
  )
  const arbitrageSavingsEur = Math.max(0, dischargeRevenueEur - gridChargeCostEur)

  const pvDirectValueEur = slots.reduce(
    (a, s) => a + (s.pvSelfKwh * s.priceCtKwh) / 100,
    0,
  )
  const pvStoredValueEur = slots.reduce(
    (a, s) => a + (s.chargeFromPvKwh * params.roundTripEff * avgPriceCtKwh) / 100,
    0,
  )
  const pvSelfConsumptionValueEur = pvDirectValueEur + pvStoredValueEur

  const gridImportKwh = slots.reduce((a, s) => a + s.gridImportKwh, 0)
  const totalChargeKwh = slots.reduce((a, s) => a + s.chargeFromGridKwh + s.chargeFromPvKwh, 0)
  const batteryCyclesEquivalent = totalChargeKwh / params.usableKwh

  return {
    slots,
    summary: {
      baselineCostEur,
      optimizedCostEur,
      savingsEur,
      arbitrageSavingsEur,
      pvSelfConsumptionValueEur,
      standbyCostEur,
      gridImportKwh,
      gridExportKwh: 0,
      batteryCyclesEquivalent,
    },
  }
}

// ---------------------------------------------------------------------------
// runBatteryYear — annual aggregation over runBatteryDay
// ---------------------------------------------------------------------------

export function runBatteryYear(
  pricesByDate: Map<string, HourlyPrice[]>,
  pvProfile: number[],            // 8760 hourly fractions; Σ = 1.0
  loadProfile: number[],          // 8760 hourly fractions; Σ = 1.0
  pvKwhPerYear: number,           // annual PV yield (0 if no PV)
  annualLoadKwh: number,          // annual household load
  params: BatteryParams,
): AnnualBatteryResult {
  type Bucket = {
    savings: number
    arb: number
    pv: number
    standby: number
    cycles: number
  }
  const monthlyAccum = new Map<string, Bucket>()

  let annualSavings = 0
  let annualArb = 0
  let annualPv = 0
  let annualStandby = 0
  let annualGridImport = 0
  let annualCycles = 0

  const sortedDates = Array.from(pricesByDate.keys()).sort()
  for (const date of sortedDates) {
    const prices = pricesByDate.get(date)
    if (!prices || prices.length === 0) continue

    const [yy, mm, dd] = date.split('-').map(Number)
    const dayStart = Date.UTC(yy, mm - 1, dd)
    const yearStart = Date.UTC(yy, 0, 1)
    const hourOfYear = Math.floor((dayStart - yearStart) / 3_600_000)
    const slotHours = prices.length === 96 ? 0.25 : 24 / prices.length

    // Map each slot to an hour-of-year index and scale the normalised profiles.
    const pvPerSlot = new Array(prices.length)
    const loadPerSlot = new Array(prices.length)
    for (let i = 0; i < prices.length; i++) {
      const hourIdx = (hourOfYear + Math.floor(i * slotHours)) % 8760
      const fracPv = pvProfile[hourIdx] ?? 0
      const fracLoad = loadProfile[hourIdx] ?? 0
      pvPerSlot[i] = fracPv * pvKwhPerYear * slotHours
      loadPerSlot[i] = fracLoad * annualLoadKwh * slotHours
    }

    const { summary } = runBatteryDay(prices, pvPerSlot, loadPerSlot, params, 0)

    const monthKey = `${yy}-${String(mm).padStart(2, '0')}`
    const bucket =
      monthlyAccum.get(monthKey) ?? { savings: 0, arb: 0, pv: 0, standby: 0, cycles: 0 }
    bucket.savings += summary.savingsEur
    bucket.arb += summary.arbitrageSavingsEur
    bucket.pv += summary.pvSelfConsumptionValueEur
    bucket.standby += summary.standbyCostEur
    bucket.cycles += summary.batteryCyclesEquivalent
    monthlyAccum.set(monthKey, bucket)

    annualSavings += summary.savingsEur
    annualArb += summary.arbitrageSavingsEur
    annualPv += summary.pvSelfConsumptionValueEur
    annualStandby += summary.standbyCostEur
    annualGridImport += summary.gridImportKwh
    annualCycles += summary.batteryCyclesEquivalent
  }

  const months: MonthlyBatteryResult[] = Array.from(monthlyAccum.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([month, b]) => ({
      month,
      savingsEur: b.savings,
      arbitrageSavingsEur: b.arb,
      pvSelfConsumptionValueEur: b.pv,
      standbyCostEur: b.standby,
      cyclesEquivalent: b.cycles,
    }))

  return {
    annualSavingsEur: annualSavings,
    arbitrageSavingsEur: annualArb,
    pvSelfConsumptionValueEur: annualPv,
    standbyCostEur: annualStandby,
    gridImportKwh: annualGridImport,
    cyclesEquivalent: annualCycles,
    months,
  }
}
