import { getGbDayAheadOption, type GbDayAheadAuction } from '@/lib/gb-day-ahead'

export type DayAheadCountry = 'DE' | 'NL' | 'GB'

export interface DayAheadSourceLink {
  label: string
  href: string
}

export interface DayAheadSourceMeta {
  shortLabel: string
  datasetLabel: string
  officialSource: string
  curveNote: string
  verificationNote: string
  links: DayAheadSourceLink[]
  showVerifyLink?: boolean
}

const SMARD_WHOLESALE_URL = 'https://www.smard.de/page/en/wiki-article/5884/5976/wholesale-prices'
const SMARD_DOWNLOAD_URL = 'https://www.smard.de/home/downloadcenter/download-marktdaten/'
const ENTSOE_GUIDE_URL = 'https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html'

function buildEpexDayAheadUrl(marketArea: 'DE-LU' | 'NL' | 'GB', deliveryDate?: string, product: 60 | 15 = 60): string {
  const date = deliveryDate ?? '2026-04-21'
  return `https://www.epexspot.com/en/market-results?market_area=${marketArea}&delivery_date=${date}&modality=Auction&sub_modality=DayAhead&data_mode=table&product=${product}`
}

function buildEpexGbAuctionUrl(auction: GbDayAheadAuction, deliveryDate?: string): string {
  const date = deliveryDate ?? '2026-04-21'
  const option = getGbDayAheadOption(auction)
  return `https://www.epexspot.com/en/market-results?market_area=GB&auction=${option.epexAuctionCode}&trading_date=${date}&delivery_date=${date}&modality=Auction&sub_modality=DayAhead&data_mode=table`
}

function buildSmardChartUrl(startDate?: string, endDate?: string): string {
  if (!startDate || !endDate) return SMARD_WHOLESALE_URL
  return `https://www.smard.de/home/marktdaten?marketDataAttributes=${encodeURIComponent(JSON.stringify({
    resolution: 'hour',
    from: new Date(`${startDate}T00:00:00`).getTime(),
    to: new Date(`${endDate}T23:59:59`).getTime(),
    moduleIds: [8004169],
    selectedCategory: null,
    activeChart: true,
    style: 'color',
    categoriesModuleOrder: {},
    region: 'DE',
  }))}`
}

export function getDayAheadSourceMeta(
  country: DayAheadCountry,
  startDate?: string,
  endDate?: string,
  gbAuction: GbDayAheadAuction = 'daa1',
): DayAheadSourceMeta {
  switch (country) {
    case 'DE':
      return {
        shortLabel: 'SMARD 4169',
        datasetLabel: 'Bundesnetzagentur SMARD filter 4169 / module 8004169 (DE-LU day-ahead)',
        officialSource: 'SMARD (Bundesnetzagentur)',
        curveNote: 'The app uses official SMARD chart_data exports. Hourly and quarter-hour values are stored in EUR/MWh and shown as ct/kWh.',
        verificationNote: 'Direct public source: the official SMARD chart and download endpoints can be checked without credentials.',
        links: [
          { label: 'Primary source', href: buildSmardChartUrl(startDate, endDate) },
          { label: 'EPEX SPOT DE-LU', href: buildEpexDayAheadUrl('DE-LU', startDate, 60) },
          { label: 'SMARD docs', href: SMARD_WHOLESALE_URL },
          { label: 'Download center', href: SMARD_DOWNLOAD_URL },
        ],
        showVerifyLink: true,
      }
    case 'NL':
      return {
        shortLabel: 'ENTSO-E A44',
        datasetLabel: 'ENTSO-E Web API documentType=A44 / bidding zone 10YNL----------L',
        officialSource: 'ENTSO-E Transparency Platform',
        curveNote: 'The app stores official ENTSO-E EUR/MWh values for NL. Native PT15M values are used when present; missing quarter-hours are filled from hourly data.',
        verificationNote: 'Primary source is ENTSO-E A44.',
        links: [],
        showVerifyLink: false,
      }
    case 'GB':
      if (gbAuction === 'daa2') {
        return {
          shortLabel: 'EPEX GB DAA 2',
          datasetLabel: "EPEX SPOT GB DAA 2 (30') / half-hour day-ahead auction",
          officialSource: 'EPEX SPOT',
          curveNote: 'The app uses the EPEX GB DAA 2 half-hour day-ahead auction. Hourly values are the mean of the two half-hours, and quarter-hour values duplicate each half-hour into two 15-minute slots.',
          verificationNote: 'Primary source is the EPEX GB DAA 2 auction table for the selected delivery date.',
          links: [],
          showVerifyLink: false,
        }
      }
      return {
        shortLabel: 'EPEX GB DAA 1',
        datasetLabel: "EPEX SPOT GB DAA 1 (60') / hourly day-ahead auction",
        officialSource: 'EPEX SPOT',
        curveNote: 'The app uses the EPEX GB DAA 1 hourly day-ahead auction directly. Quarter-hour values are expanded from each hourly auction result.',
        verificationNote: 'Primary source is the EPEX GB DAA 1 auction table for the selected delivery date.',
        links: [],
        showVerifyLink: false,
      }
  }
}
