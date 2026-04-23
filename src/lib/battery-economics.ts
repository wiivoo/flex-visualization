import {
  getScenarioVariant,
  getTariff,
  type BatteryScenario,
} from '@/lib/battery-config'
import {
  runBatteryYear,
  type AnnualBatteryResult,
  type BatteryParams,
  type MonthlyBatteryResult,
} from '@/lib/battery-optimizer'
import type { PriceData } from '@/lib/use-prices'
import type { HourlyPrice } from '@/lib/v2-config'
import {
  getDefaultTariffId as getDefaultRetailTariffId,
  getTariff as getRetailTariff,
  getTariffIntervalMinutes,
  mapPricesToRetailTariff,
} from '@/lib/retail-tariffs'

const PV_YIELD_KWH_PER_KWP_DE = 820
const PV_YIELD_KWH_PER_KWP_NL = 730

export interface BatteryEconomics {
  netAnnualSavingsEur: number
  annualSavingsGrossEur: number
  arbitrageSavingsEur: number
  pvSelfConsumptionGrossEur: number
  pvSelfConsumptionNetEur: number
  pvOpportunityCostEur: number
  fixedRegulationCostEur: number
  standbyCostEur: number
  annualDragEur: number
  arbitrageSharePct: number
  pvSharePct: number
}

export interface MonthlyEconomics {
  month: string
  arbitrageEur: number
  pvGrossEur: number
  valueDragEur: number
  netSavingsEur: number
}

export function getPreferredBatteryResolution(
  scenario: BatteryScenario,
  prices?: Pick<PriceData, 'hourlyQH'>,
): 'hour' | 'quarterhour' {
  const intervalMinutes = getTariffIntervalMinutes(scenario.tariffId, scenario.country)
  return intervalMinutes === 15 && (prices ? prices.hourlyQH.length > 0 : true)
    ? 'quarterhour'
    : 'hour'
}

export function getAnnualModelPrices(
  prices: PriceData,
  scenario: BatteryScenario,
): HourlyPrice[] {
  const resolution = getPreferredBatteryResolution(scenario, prices)
  const sourcePrices = resolution === 'quarterhour' && prices.hourlyQH.length > 0
    ? prices.hourlyQH
    : prices.hourly
  return mapPricesToRetailTariff(sourcePrices, scenario.tariffId, scenario.country)
}

export function deriveAnnualBatteryResult(
  scenario: BatteryScenario,
  allPrices: HourlyPrice[],
  pvProfile: number[],
  loadProfile: number[],
): AnnualBatteryResult | null {
  if (!pvProfile.length || !loadProfile.length || allPrices.length === 0) return null

  const byDate = new Map<string, HourlyPrice[]>()
  for (const p of allPrices) {
    const arr = byDate.get(p.date)
    if (arr) arr.push(p)
    else byDate.set(p.date, [p])
  }

  const variant = getScenarioVariant(scenario)
  const pvKwp = variant.pvCapacityWp / 1000
  const pvAnnualYield =
    scenario.country === 'DE' ? PV_YIELD_KWH_PER_KWP_DE : PV_YIELD_KWH_PER_KWP_NL
  const pvKwhPerYear = variant.includePv ? pvKwp * pvAnnualYield : 0

  const params: BatteryParams = {
    usableKwh: variant.usableKwh,
    maxChargeKw: variant.maxChargeKw,
    maxDischargeKw: variant.maxDischargeKw,
    roundTripEff: variant.roundTripEff,
    standbyWatts: variant.standbyWatts,
    feedInCapKw: scenario.feedInCapKw,
    allowGridExport: false,
  }

  return runBatteryYear(
    byDate,
    pvProfile,
    loadProfile,
    pvKwhPerYear,
    scenario.annualLoadKwh,
    params,
  )
}

export function computeBatteryEconomics(
  annual: AnnualBatteryResult,
  scenario: BatteryScenario,
): BatteryEconomics {
  const variant = getScenarioVariant(scenario)
  const exportPct =
    scenario.country === 'NL' && variant.includePv ? scenario.exportCompensationPct / 100 : 0
  // In NL post-2027, self-consuming PV carries the opportunity cost of forgone export pay.
  const pvOpportunityCostEur = annual.pvSelfConsumptionValueEur * exportPct
  const fixedRegulationCostEur =
    scenario.country === 'NL' && variant.includePv ? scenario.terugleverCostEur : 0
  const pvSelfConsumptionNetEur = annual.pvSelfConsumptionValueEur - pvOpportunityCostEur
  const annualDragEur = annual.standbyCostEur + pvOpportunityCostEur + fixedRegulationCostEur
  const annualSavingsGrossEur = annual.annualSavingsEur
  // Tariff monthly fees are omitted because the baseline and optimized case use the same supplier.
  const netAnnualSavingsEur =
    annual.arbitrageSavingsEur + pvSelfConsumptionNetEur - annual.standbyCostEur - fixedRegulationCostEur

  const positiveArb = Math.max(0, annual.arbitrageSavingsEur)
  const positivePv = Math.max(0, pvSelfConsumptionNetEur)
  const positiveTotal = positiveArb + positivePv

  return {
    netAnnualSavingsEur,
    annualSavingsGrossEur,
    arbitrageSavingsEur: annual.arbitrageSavingsEur,
    pvSelfConsumptionGrossEur: annual.pvSelfConsumptionValueEur,
    pvSelfConsumptionNetEur,
    pvOpportunityCostEur,
    fixedRegulationCostEur,
    standbyCostEur: annual.standbyCostEur,
    annualDragEur,
    arbitrageSharePct: positiveTotal > 0 ? (positiveArb / positiveTotal) * 100 : 0,
    pvSharePct: positiveTotal > 0 ? (positivePv / positiveTotal) * 100 : 0,
  }
}

export function computeMonthlyEconomics(
  months: MonthlyBatteryResult[],
  scenario: BatteryScenario,
): MonthlyEconomics[] {
  const variant = getScenarioVariant(scenario)
  const exportPct =
    scenario.country === 'NL' && variant.includePv ? scenario.exportCompensationPct / 100 : 0
  const fixedFeePerMonth =
    scenario.country === 'NL' && variant.includePv && months.length > 0
      ? scenario.terugleverCostEur / months.length
      : 0

  return months.map((month) => {
    const pvOpportunityCostEur = month.pvSelfConsumptionValueEur * exportPct
    const valueDragEur = month.standbyCostEur + pvOpportunityCostEur + fixedFeePerMonth
    return {
      month: month.month,
      arbitrageEur: month.arbitrageSavingsEur,
      pvGrossEur: month.pvSelfConsumptionValueEur,
      valueDragEur,
      netSavingsEur:
        month.arbitrageSavingsEur + month.pvSelfConsumptionValueEur - valueDragEur,
    }
  })
}

export function getTariffLabelForScenario(scenario: BatteryScenario): string {
  return getRetailTariff(scenario.tariffId, scenario.country)?.label
    ?? getTariff(scenario.tariffId, scenario.country)?.label
    ?? scenario.tariffId
}

export function getTariffDefaults(country: 'DE' | 'NL', tariffId?: string) {
  const fallbackId = getDefaultRetailTariffId(country)
  const tariff = getRetailTariff(tariffId ?? fallbackId, country)
    ?? getTariff(tariffId ?? fallbackId, country)
    ?? getRetailTariff(fallbackId, country)
    ?? getTariff(fallbackId, country)

  return {
    tariffId: tariff?.id ?? fallbackId,
    exportCompensationPct: country === 'NL' ? (tariff?.exportCompensationDefaultPct ?? 50) : 50,
  }
}
