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
}

const SMARD_WHOLESALE_URL = 'https://www.smard.de/page/en/wiki-article/5884/5976/wholesale-prices'
const SMARD_DOWNLOAD_URL = 'https://www.smard.de/home/downloadcenter/download-marktdaten/'
const ENTSOE_GUIDE_URL = 'https://transparency.entsoe.eu/content/static_content/Static%20content/web%20api/Guide.html'
const ENTSOE_PLATFORM_URL = 'https://transparency.entsoe.eu/'
const ELEXON_MID_DOCS_URL = 'https://bmrs.elexon.co.uk/api-documentation'

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

function buildElexonMidUrl(startDate?: string, endDate?: string): string {
  if (!startDate || !endDate) {
    return 'https://data.elexon.co.uk/bmrs/api/v1/datasets/MID?format=json'
  }
  return `https://data.elexon.co.uk/bmrs/api/v1/datasets/MID?from=${startDate}&to=${endDate}&format=json`
}

export function getDayAheadSourceMeta(
  country: DayAheadCountry,
  startDate?: string,
  endDate?: string,
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
          { label: 'Official chart', href: buildSmardChartUrl(startDate, endDate) },
          { label: 'Wholesale prices', href: SMARD_WHOLESALE_URL },
          { label: 'Download center', href: SMARD_DOWNLOAD_URL },
        ],
      }
    case 'NL':
      return {
        shortLabel: 'ENTSO-E A44',
        datasetLabel: 'ENTSO-E Web API documentType=A44 / bidding zone 10YNL----------L',
        officialSource: 'ENTSO-E Transparency Platform',
        curveNote: 'The app stores official ENTSO-E EUR/MWh values for NL. Native PT15M values are used when present; missing quarter-hours are filled from hourly data.',
        verificationNote: 'The upstream feed is official, but live API checks require an ENTSO-E security token.',
        links: [
          { label: 'API guide', href: ENTSOE_GUIDE_URL },
          { label: 'Platform', href: ENTSOE_PLATFORM_URL },
        ],
      }
    case 'GB':
      return {
        shortLabel: 'Elexon MID',
        datasetLabel: 'BMRS MID dataset / APXMIDP + N2EXMIDP (GB day-ahead market index)',
        officialSource: 'Elexon BMRS',
        curveNote: 'The app aggregates official half-hour MID prices to hourly values and mirrors each half-hour into two 15-minute slots for chart parity. Prices are shown in GBp/kWh.',
        verificationNote: 'Direct public source: the BMRS MID endpoint is public and can be checked without credentials.',
        links: [
          { label: 'MID JSON', href: buildElexonMidUrl(startDate, endDate) },
          { label: 'API docs', href: ELEXON_MID_DOCS_URL },
        ],
      }
  }
}
