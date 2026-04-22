import { endCustomerPrice, surchargesForYear } from '@/lib/dynamic-tariff'
import type { HourlyPrice } from '@/lib/v2-config'

export interface RetailTariff {
  id: string
  label: string
  country: 'DE' | 'NL'
  monthlyFeeEur: number
  exportCompensationDefaultPct: number
  supplierFeeModel: 'monthly' | 'margin'
  supplierMarginCtKwh: number
  supplierMonthlyFeeEur: number
  fixedMonthlyGrossEur: number
  intervalMinutes: 15 | 60
  note?: string
}

export const DE_TARIFFS: RetailTariff[] = [
  {
    id: 'tibber-de',
    label: 'Tibber DE',
    country: 'DE',
    monthlyFeeEur: 5.99,
    exportCompensationDefaultPct: 0,
    supplierFeeModel: 'monthly',
    supplierMarginCtKwh: 0,
    supplierMonthlyFeeEur: 5.99,
    fixedMonthlyGrossEur: 0,
    intervalMinutes: 60,
    note: 'Hourly dynamic tariff. Same market curve, mainly a monthly supplier-fee wrapper here.',
  },
  {
    id: 'enviam-vision',
    label: 'enviaM MEIN STROM Vision',
    country: 'DE',
    monthlyFeeEur: 2.67,
    exportCompensationDefaultPct: 0,
    supplierFeeModel: 'margin',
    supplierMarginCtKwh: 1.87,
    supplierMonthlyFeeEur: 0,
    fixedMonthlyGrossEur: 19.73,
    intervalMinutes: 15,
    note: 'Quarter-hour dynamic tariff. Same market curve, with a retail margin and separate monthly base charge.',
  },
]

export const NL_TARIFFS: RetailTariff[] = [
  {
    id: 'frank-energie',
    label: 'Frank Energie',
    country: 'NL',
    monthlyFeeEur: 4.99,
    exportCompensationDefaultPct: 115,
    supplierFeeModel: 'monthly',
    supplierMarginCtKwh: 0,
    supplierMonthlyFeeEur: 4.99,
    fixedMonthlyGrossEur: 0,
    intervalMinutes: 60,
  },
  {
    id: 'anwb-energie',
    label: 'ANWB Energie',
    country: 'NL',
    monthlyFeeEur: 4.99,
    exportCompensationDefaultPct: 50,
    supplierFeeModel: 'monthly',
    supplierMarginCtKwh: 0,
    supplierMonthlyFeeEur: 4.99,
    fixedMonthlyGrossEur: 0,
    intervalMinutes: 60,
  },
  {
    id: 'tibber-nl',
    label: 'Tibber NL',
    country: 'NL',
    monthlyFeeEur: 5.99,
    exportCompensationDefaultPct: 50,
    supplierFeeModel: 'monthly',
    supplierMarginCtKwh: 0,
    supplierMonthlyFeeEur: 5.99,
    fixedMonthlyGrossEur: 0,
    intervalMinutes: 60,
  },
  {
    id: 'zonneplan-nl',
    label: 'Zonneplan',
    country: 'NL',
    monthlyFeeEur: 4.50,
    exportCompensationDefaultPct: 50,
    supplierFeeModel: 'monthly',
    supplierMarginCtKwh: 0,
    supplierMonthlyFeeEur: 4.5,
    fixedMonthlyGrossEur: 0,
    intervalMinutes: 60,
  },
]

export function getTariffsFor(country: 'DE' | 'NL') {
  return country === 'DE' ? DE_TARIFFS : NL_TARIFFS
}

export function getTariff(id: string, country: 'DE' | 'NL') {
  return getTariffsFor(country).find((tariff) => tariff.id === id)
}

export function getDefaultTariffId(country: 'DE' | 'NL') {
  return country === 'DE' ? 'tibber-de' : 'frank-energie'
}

export function getTariffIntervalMinutes(id: string, country: 'DE' | 'NL') {
  return getTariff(id, country)?.intervalMinutes ?? 60
}

export function transformSpotPriceForTariff(
  spotCtKwh: number,
  tariffId: string,
  country: 'DE' | 'NL',
  year: number,
) {
  if (country !== 'DE') return spotCtKwh
  const tariff = getTariff(tariffId, country)
  const supplierMarginCtKwh = tariff?.supplierFeeModel === 'margin' ? tariff.supplierMarginCtKwh : 0
  return endCustomerPrice(spotCtKwh, {
    ...surchargesForYear(year),
    margin: supplierMarginCtKwh,
  })
}

export function mapPricesToRetailTariff(
  prices: HourlyPrice[],
  tariffId: string,
  country: 'DE' | 'NL',
): HourlyPrice[] {
  if (country !== 'DE') return prices
  return prices.map((price) => {
    const year = Number(price.date.slice(0, 4)) || new Date(price.timestamp).getUTCFullYear()
    return {
      ...price,
      priceCtKwh: transformSpotPriceForTariff(price.priceCtKwh, tariffId, country, year),
      priceEurMwh: transformSpotPriceForTariff(price.priceCtKwh, tariffId, country, year) * 10,
    }
  })
}
