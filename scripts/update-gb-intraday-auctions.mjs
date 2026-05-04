#!/usr/bin/env node
/**
 * Incremental GB intraday auction update from EPEX Spot.
 *
 * Writes four static files:
 *   - public/data/gb-ida1-auction-prices.json
 *   - public/data/gb-ida1-auction-prices-qh.json
 *   - public/data/gb-ida2-auction-prices.json
 *   - public/data/gb-ida2-auction-prices-qh.json
 *
 * IDA1 = half-hour intraday auction for the full delivery day.
 * IDA2 = half-hour intraday auction for the remaining half-day window.
 *
 * File values are stored in GBp/kWh.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { chromium } from 'playwright'

const EPEX_BASE_URL = 'https://www.epexspot.com/en/market-results'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const MAX_RETRIES = 5
const BOOTSTRAP_DAYS = 7
const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']
const FORM_BUILD_SELECTOR = 'input[name="form_build_id"][value*="form-"][value]:not([value=""])'

const AUCTIONS = {
  ida1: { code: 'GB-IDA1', label: 'GB-IDA1', minRows: 48 },
  ida2: { code: 'GB-IDA2', label: 'GB-IDA2', minRows: 24 },
}

function toUtcDay(date) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 12, 0, 0, 0))
}

function addDays(d, n) {
  const r = toUtcDay(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function fmtDay(d) {
  return d.toISOString().slice(0, 10)
}

function formatDisplayDate(date) {
  return `${date.getUTCDate()} ${MONTHS[date.getUTCMonth()]} ${date.getUTCFullYear()}`
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function decodeHtml(text) {
  return text
    .replace(/&nbsp;/g, ' ')
    .replace(/&#039;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
}

function parseWidgetHtml(ops) {
  if (!Array.isArray(ops)) throw new Error('EPEX GB intraday AJAX response was not an array')
  const htmlOps = ops
    .filter(op => op?.command === 'invoke' && op.selector === '.js-md-widget' && op.method === 'html')
    .map(op => op?.args?.[0])
    .filter(html => typeof html === 'string' && html.length > 0)
  const html = htmlOps.at(-1)
  if (typeof html !== 'string' || html.length === 0) throw new Error('EPEX GB intraday widget HTML missing')
  return html
}

function extractUpdatedBuildId(ops) {
  if (!Array.isArray(ops)) return ''
  return ops.find(op => op?.command === 'update_build_id' && typeof op?.new === 'string' && op.new.length > 0)?.new || ''
}

function parseStartMinutes(label) {
  const start = label.split(' - ')[0]?.trim()
  if (!start) throw new Error(`Invalid delivery label: ${label}`)
  const [hourRaw, minuteRaw] = start.split(':')
  const hour = Number.parseInt(hourRaw, 10)
  const minute = Number.parseInt(minuteRaw ?? '0', 10)
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) throw new Error(`Invalid delivery label: ${label}`)
  return (hour * 60) + minute
}

function parseAuctionRows(date, widgetHtml) {
  const decoded = decodeHtml(widgetHtml)
  const labels = [...decoded.matchAll(/<li class="child[^"]*no-children[^"]*">\s*<a href="#">([^<]+)<\/a>\s*<\/li>/g)]
    .map(match => match[1].trim())
  const rows = [...decoded.matchAll(/<tr class="child[^"]*">\s*([\s\S]*?)<\/tr>/g)]

  if (labels.length === 0 || rows.length === 0) return []
  if (labels.length !== rows.length) {
    throw new Error(`Row mismatch: ${labels.length} labels vs ${rows.length} rows`)
  }

  return rows.map((row, index) => {
    const cells = [...row[1].matchAll(/<td>([\s\S]*?)<\/td>/g)]
      .map(match => match[1].replace(/<[^>]+>/g, '').replace(/,/g, '').trim())
    const priceRaw = cells.at(-1)
    const priceGbpMwh = priceRaw ? Number.parseFloat(priceRaw) : NaN
    if (!Number.isFinite(priceGbpMwh)) throw new Error(`Invalid price row ${index + 1}`)
    const startMinutes = parseStartMinutes(labels[index])
    const ts = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), 0, startMinutes)
    return {
      t: ts,
      p: Math.round((priceGbpMwh / 10) * 100) / 100,
    }
  })
}

function getPageUrl(date) {
  const dateStr = fmtDay(date)
  return `${EPEX_BASE_URL}?market_area=GB&delivery_date=${dateStr}&modality=Auction&sub_modality=Intraday&data_mode=table&product=15`
}

async function readFormBuildId(page) {
  return await page.evaluate(selector => document.querySelector(selector)?.getAttribute('value') || '', FORM_BUILD_SELECTOR)
}

async function refreshSession(session, date = new Date()) {
  session.pageUrl = getPageUrl(date)
  session.ajaxUrl = `${session.pageUrl}&ajax_form=1`
  await session.page.goto(session.pageUrl, { waitUntil: 'domcontentloaded', timeout: 90000 })
  await session.page.waitForTimeout(2000)
  session.formBuildId = await readFormBuildId(session.page)
}

async function createBrowserSession() {
  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: USER_AGENT,
    viewport: { width: 1440, height: 900 },
    locale: 'en-US',
    timezoneId: 'Europe/Berlin',
  })
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined })
    Object.defineProperty(navigator, 'platform', { get: () => 'MacIntel' })
    Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4] })
    Object.defineProperty(navigator, 'languages', { get: () => ['en-US', 'en'] })
    window.chrome = { runtime: {} }
  })

  const page = await context.newPage()
  const baseDate = fmtDay(new Date())
  const session = {
    browser,
    page,
    pageUrl: '',
    ajaxUrl: '',
    formBuildId: '',
  }
  await refreshSession(session, new Date(`${baseDate}T12:00:00Z`))
  return session
}

async function fetchAuctionDay(session, date, auctionKey) {
  const auction = AUCTIONS[auctionKey]
  const dateLabel = formatDisplayDate(date)
  let retriedAfterEmpty = false

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const responseText = await session.page.evaluate(async ({ ajaxUrl, dateLabel, auctionCode, formBuildId }) => {
        const body = new URLSearchParams({
          'filters[modality]': 'Auction',
          'filters[sub_modality]': 'Intraday',
          'filters[auction]': auctionCode,
          'filters[delivery_date]': dateLabel,
          'filters[product]': '15',
          'filters[data_mode]': 'table',
          'filters[market_area]': 'GB',
          form_build_id: formBuildId,
          form_id: 'market_data_filters_form',
          submit_js: '',
        })

        const response = await fetch(ajaxUrl, {
          method: 'POST',
          credentials: 'include',
          headers: {
            'x-requested-with': 'XMLHttpRequest',
            'accept': 'application/json, text/javascript, */*; q=0.01',
            'content-type': 'application/x-www-form-urlencoded; charset=UTF-8',
          },
          body,
        })

        if (!response.ok) {
          throw new Error(`EPEX GB intraday ajax request failed: ${response.status}`)
        }

        return await response.text()
      }, { ajaxUrl: session.ajaxUrl, dateLabel, auctionCode: auction.code, formBuildId: session.formBuildId })

      const ops = JSON.parse(responseText)
      const nextBuildId = extractUpdatedBuildId(ops)
      if (nextBuildId) session.formBuildId = nextBuildId
      const widgetHtml = parseWidgetHtml(ops)
      const rows = parseAuctionRows(date, widgetHtml)
      if (rows.length > 0) return rows
      if (!retriedAfterEmpty) {
        retriedAfterEmpty = true
        await refreshSession(session, date)
        continue
      }
      return rows
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) throw error
      await refreshSession(session, date)
      await session.page.waitForTimeout(500 * (attempt + 1))
      await sleep(300 * (attempt + 1))
    }
  }

  return []
}

function aggregateHalfHourlyToHourly(points) {
  const byHour = new Map()
  for (const point of points) {
    const hourTs = point.t - (point.t % 3600000)
    if (!byHour.has(hourTs)) byHour.set(hourTs, [])
    byHour.get(hourTs).push(point.p)
  }
  return [...byHour.entries()]
    .sort(([a], [b]) => a - b)
    .map(([t, prices]) => ({
      t,
      p: Math.round((prices.reduce((sum, value) => sum + value, 0) / prices.length) * 100) / 100,
    }))
}

function expandHalfHourlyToQuarterHour(points) {
  const result = new Map()
  for (const point of points) {
    for (const offset of [0, 15]) {
      result.set(point.t + offset * 60000, point.p)
    }
  }
  return [...result.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p }))
}

function dateRange(startDate, endDate) {
  const dates = []
  let cursor = toUtcDay(startDate)
  const end = toUtcDay(endDate)
  while (cursor <= end) {
    dates.push(new Date(cursor))
    cursor = addDays(cursor, 1)
  }
  return dates
}

function loadSeries(path) {
  if (!existsSync(path)) return []
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return []
  }
}

function writeSeries(path, data) {
  writeFileSync(path, JSON.stringify(data))
  return (statSync(path).size / 1024).toFixed(0)
}

async function detectLatestAvailableDateForAuction(session, auctionKey) {
  const today = toUtcDay(new Date())
  const todayProbe = await fetchAuctionDay(session, today, auctionKey).catch(() => [])
  if (todayProbe.length >= AUCTIONS[auctionKey].minRows) return today
  return addDays(today, -1)
}

function maxDate(a, b) {
  return a.getTime() >= b.getTime() ? a : b
}

async function main() {
  const outDir = join(process.cwd(), 'public', 'data')
  const paths = {
    ida1Hourly: join(outDir, 'gb-ida1-auction-prices.json'),
    ida1QH: join(outDir, 'gb-ida1-auction-prices-qh.json'),
    ida2Hourly: join(outDir, 'gb-ida2-auction-prices.json'),
    ida2QH: join(outDir, 'gb-ida2-auction-prices-qh.json'),
  }

  const existing = {
    ida1Hourly: loadSeries(paths.ida1Hourly),
    ida1QH: loadSeries(paths.ida1QH),
    ida2Hourly: loadSeries(paths.ida2Hourly),
    ida2QH: loadSeries(paths.ida2QH),
  }

  const bootstrap = Object.values(existing).some(series => series.length === 0)
  const existingLastTs = Math.min(
    ...Object.values(existing)
      .filter(series => series.length > 0)
      .map(series => series[series.length - 1].t),
  )
  const session = await createBrowserSession()
  const latestAvailableDates = {
    ida1: await detectLatestAvailableDateForAuction(session, 'ida1'),
    ida2: await detectLatestAvailableDateForAuction(session, 'ida2'),
  }
  const latestAvailableDate = maxDate(latestAvailableDates.ida1, latestAvailableDates.ida2)
  const fetchStart = bootstrap
    ? addDays(latestAvailableDate, -(BOOTSTRAP_DAYS - 1))
    : addDays(new Date(existingLastTs), -2)
  const dates = dateRange(fetchStart, latestAvailableDate)

  console.log('🇬🇧 GB Intraday Auction Update (EPEX)')
  console.log(`   Mode: ${bootstrap ? 'bootstrap' : 'incremental'}`)
  console.log(`   Range: ${fmtDay(fetchStart)} → ${fmtDay(latestAvailableDate)} (${dates.length} days)`)
  console.log(`   Latest IDA1: ${fmtDay(latestAvailableDates.ida1)}`)
  console.log(`   Latest IDA2: ${fmtDay(latestAvailableDates.ida2)}`)

  const ida1HourlyMap = new Map(existing.ida1Hourly.map(point => [point.t, point.p]))
  const ida1QHMap = new Map(existing.ida1QH.map(point => [point.t, point.p]))
  const ida2HourlyMap = new Map(existing.ida2Hourly.map(point => [point.t, point.p]))
  const ida2QHMap = new Map(existing.ida2QH.map(point => [point.t, point.p]))

  let completed = 0

  try {
    for (const day of dates) {
      const dayStr = fmtDay(day)
      if (day <= latestAvailableDates.ida1) {
        try {
          const ida1Rows = await fetchAuctionDay(session, day, 'ida1')
          if (ida1Rows.length < AUCTIONS.ida1.minRows) throw new Error(`IDA1 returned only ${ida1Rows.length} rows`)
          for (const point of aggregateHalfHourlyToHourly(ida1Rows)) ida1HourlyMap.set(point.t, point.p)
          for (const point of expandHalfHourlyToQuarterHour(ida1Rows)) ida1QHMap.set(point.t, point.p)
        } catch (error) {
          console.log(`   ⚠️  ${dayStr} IDA1: ${error.message}`)
        }
      }

      if (day <= latestAvailableDates.ida2) {
        try {
          const ida2Rows = await fetchAuctionDay(session, day, 'ida2')
          if (ida2Rows.length < AUCTIONS.ida2.minRows) throw new Error(`IDA2 returned only ${ida2Rows.length} rows`)
          for (const point of aggregateHalfHourlyToHourly(ida2Rows)) ida2HourlyMap.set(point.t, point.p)
          for (const point of expandHalfHourlyToQuarterHour(ida2Rows)) ida2QHMap.set(point.t, point.p)
        } catch (error) {
          console.log(`   ⚠️  ${dayStr} IDA2: ${error.message}`)
        }
      }

      completed++
      if (completed % 25 === 0 || completed === dates.length) {
        console.log(`   Progress: ${completed}/${dates.length}`)
      }
    }
  } finally {
    await session.browser.close()
  }

  const out = {
    ida1Hourly: [...ida1HourlyMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
    ida1QH: [...ida1QHMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
    ida2Hourly: [...ida2HourlyMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
    ida2QH: [...ida2QHMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
  }

  const sizes = {
    ida1Hourly: writeSeries(paths.ida1Hourly, out.ida1Hourly),
    ida1QH: writeSeries(paths.ida1QH, out.ida1QH),
    ida2Hourly: writeSeries(paths.ida2Hourly, out.ida2Hourly),
    ida2QH: writeSeries(paths.ida2QH, out.ida2QH),
  }

  console.log(`   💾 gb-ida1-auction-prices.json: ${out.ida1Hourly.length} pts (${sizes.ida1Hourly} KB)`)
  console.log(`   💾 gb-ida1-auction-prices-qh.json: ${out.ida1QH.length} pts (${sizes.ida1QH} KB)`)
  console.log(`   💾 gb-ida2-auction-prices.json: ${out.ida2Hourly.length} pts (${sizes.ida2Hourly} KB)`)
  console.log(`   💾 gb-ida2-auction-prices-qh.json: ${out.ida2QH.length} pts (${sizes.ida2QH} KB)`)
  console.log('   ✅ Done!')
}

main().catch(error => {
  console.error('❌ GB intraday auction update error:', error.message)
  process.exit(1)
})
