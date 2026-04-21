import type { PricePoint } from '@/lib/config'
import { addDays, eachDayOfInterval, format } from 'date-fns'
import { getGbDayAheadOption, type GbDayAheadAuction } from '@/lib/gb-day-ahead'

const EPEX_BASE_URL = 'https://www.epexspot.com/en/market-results'
const EPEX_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'

const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']

function formatDisplayDate(date: Date): string {
  return `${format(date, 'd')} ${MONTHS[date.getUTCMonth()]} ${format(date, 'yyyy')}`
}

function decodeHtml(text: string): string {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function parseWidgetHtml(operations: unknown): string {
  if (!Array.isArray(operations)) throw new Error('EPEX GB AJAX response was not an array')
  const widgetUpdate = operations.find((entry): entry is { command: string; selector?: string; method?: string; args?: unknown[] } =>
    typeof entry === 'object' &&
    entry !== null &&
    'command' in entry &&
    (entry as { command?: string }).command === 'invoke' &&
    (entry as { selector?: string }).selector === '.js-md-widget' &&
    (entry as { method?: string }).method === 'html'
  )
  const html = widgetUpdate?.args?.[0]
  if (typeof html !== 'string' || html.length === 0) {
    throw new Error('EPEX GB AJAX response did not contain widget HTML')
  }
  return html
}

function extractFormBuildId(pageHtml: string): string {
  const match = pageHtml.match(/name="form_build_id" value="([^"]+)"[\s\S]*?name="form_id" value="market_data_filters_form"/)
  if (!match) throw new Error('Could not find EPEX GB form_build_id')
  return match[1]
}

function parseStartMinutes(label: string): number {
  const start = label.split(' - ')[0]?.trim()
  if (!start) throw new Error(`Invalid EPEX GB delivery label: ${label}`)
  const [hourRaw, minuteRaw] = start.split(':')
  const hour = Number.parseInt(hourRaw, 10)
  const minute = Number.parseInt(minuteRaw ?? '0', 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) {
    throw new Error(`Invalid EPEX GB delivery label: ${label}`)
  }
  return (hour * 60) + minute
}

function parseAuctionRows(date: Date, widgetHtml: string): PricePoint[] {
  const decoded = decodeHtml(widgetHtml)
  const timeLabels = [...decoded.matchAll(/<li class="child[^"]*no-children[^"]*">\s*<a href="#">([^<]+)<\/a>\s*<\/li>/g)]
    .map(match => match[1].trim())
  const rowHtml = [...decoded.matchAll(/<tr class="child[^"]*">\s*([\s\S]*?)<\/tr>/g)]

  if (timeLabels.length === 0 || rowHtml.length === 0) {
    throw new Error('EPEX GB response did not contain day-ahead table rows')
  }
  if (timeLabels.length !== rowHtml.length) {
    throw new Error(`EPEX GB row mismatch: ${timeLabels.length} labels vs ${rowHtml.length} rows`)
  }

  return rowHtml.map((row, index) => {
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)]
      .map(match => match[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim())
    const priceRaw = cells.at(-1)
    const priceGbpMwh = priceRaw ? Number.parseFloat(priceRaw) : NaN
    if (!Number.isFinite(priceGbpMwh)) {
      throw new Error(`EPEX GB price parse failed for row ${index + 1}`)
    }
    const startMinutes = parseStartMinutes(timeLabels[index])
    const timestamp = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, startMinutes))
    return {
      timestamp: timestamp.toISOString(),
      price_ct_kwh: Math.round((priceGbpMwh / 10) * 100) / 100,
    }
  })
}

async function fetchAuctionDay(date: Date, auction: GbDayAheadAuction): Promise<PricePoint[]> {
  const isoDate = format(date, 'yyyy-MM-dd')
  const pageUrl = `${EPEX_BASE_URL}?market_area=GB&delivery_date=${isoDate}&modality=Auction&sub_modality=DayAhead&data_mode=table&product=60`
  const auctionCode = getGbDayAheadOption(auction).epexAuctionCode

  const pageRes = await fetch(pageUrl, {
    headers: {
      'user-agent': EPEX_USER_AGENT,
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    },
    next: { revalidate: 900 },
  })
  if (!pageRes.ok) {
    throw new Error(`EPEX GB page request failed: ${pageRes.status}`)
  }
  const pageHtml = await pageRes.text()
  const formBuildId = extractFormBuildId(pageHtml)

  const body = new URLSearchParams({
    'filters[modality]': 'Auction',
    'filters[sub_modality]': 'DayAhead',
    'filters[auction]': auctionCode,
    'filters[delivery_date]': formatDisplayDate(date),
    'filters[product]': '60',
    'filters[data_mode]': 'table',
    'filters[market_area]': 'GB',
    form_build_id: formBuildId,
    form_id: 'market_data_filters_form',
    submit_js: '',
  })

  const ajaxRes = await fetch(`${pageUrl}&ajax_form=1`, {
    method: 'POST',
    headers: {
      'user-agent': EPEX_USER_AGENT,
      'x-requested-with': 'XMLHttpRequest',
      'accept': 'application/json, text/javascript, */*; q=0.01',
      'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    body,
    next: { revalidate: 900 },
  })
  if (!ajaxRes.ok) {
    throw new Error(`EPEX GB ajax request failed: ${ajaxRes.status}`)
  }

  const widgetHtml = parseWidgetHtml(await ajaxRes.json())
  return parseAuctionRows(date, widgetHtml)
}

export function aggregateGbHalfHourlyToHourly(prices: PricePoint[]): PricePoint[] {
  const byHour = new Map<number, number[]>()
  for (const point of prices) {
    const ts = new Date(point.timestamp).getTime()
    const hourTs = ts - (ts % 3600000)
    if (!byHour.has(hourTs)) byHour.set(hourTs, [])
    byHour.get(hourTs)!.push(point.price_ct_kwh)
  }

  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([hourTs, values]) => ({
      timestamp: new Date(hourTs).toISOString(),
      price_ct_kwh: Math.round((values.reduce((sum, value) => sum + value, 0) / values.length) * 100) / 100,
    }))
}

export async function fetchEpexGbHalfHourlyRange(startDate: Date, endDate: Date, auction: GbDayAheadAuction = 'daa2'): Promise<PricePoint[]> {
  const days = eachDayOfInterval({ start: startDate, end: endDate })
  const all: PricePoint[] = []
  for (const day of days) {
    const dayPrices = await fetchAuctionDay(day, auction)
    all.push(...dayPrices)
  }
  return all.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
}

export async function fetchEpexGbHourlyRange(startDate: Date, endDate: Date, auction: GbDayAheadAuction = 'daa1'): Promise<PricePoint[]> {
  const raw = await fetchEpexGbHalfHourlyRange(startDate, endDate, auction)
  return auction === 'daa1' ? raw : aggregateGbHalfHourlyToHourly(raw)
}

export async function fetchEpexGbLatestAvailableDate(baseDate: Date = new Date()): Promise<Date> {
  const tomorrow = addDays(baseDate, 1)
  const probe = await fetchAuctionDay(tomorrow, 'daa1').catch(() => null)
  return probe && probe.length > 0 ? tomorrow : baseDate
}
