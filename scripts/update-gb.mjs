#!/usr/bin/env node
/**
 * Incremental UK (GB) day-ahead update from EPEX Spot.
 *
 * Writes four static files:
 *   - public/data/gb-daa1-prices.json
 *   - public/data/gb-daa1-prices-qh.json
 *   - public/data/gb-daa2-prices.json
 *   - public/data/gb-daa2-prices-qh.json
 *
 * DAA 1 = hourly auction (60')
 * DAA 2 = half-hour auction (30'), aggregated to hourly for the hourly file
 *
 * File values are stored in GBp/kWh to match the existing GB client path.
 */

import { existsSync, readFileSync, statSync, writeFileSync } from 'fs'
import { join } from 'path'
import { execFileSync } from 'child_process'

const EPEX_BASE_URL = 'https://www.epexspot.com/en/market-results'
const USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36'
const MAX_RETRIES = 5
const CONCURRENCY = 6
const BOOTSTRAP_DAYS = 120
const MONTHS = ['Jan.', 'Feb.', 'Mar.', 'Apr.', 'May', 'Jun.', 'Jul.', 'Aug.', 'Sep.', 'Oct.', 'Nov.', 'Dec.']

const AUCTIONS = {
  daa1: { code: 'GB', label: "GB DAA 1 (60')" },
  daa2: { code: '30-call-GB', label: "GB DAA 2 (30')" },
}

function addDays(d, n) {
  const r = new Date(d)
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

function extractFormBuildId(pageHtml) {
  const match = pageHtml.match(/name="form_build_id" value="([^"]+)"[\s\S]*?name="form_id" value="market_data_filters_form"/)
  if (!match) throw new Error('Could not find EPEX GB form_build_id')
  return match[1]
}

function parseWidgetHtml(ops) {
  if (!Array.isArray(ops)) throw new Error('EPEX GB AJAX response was not an array')
  const invoke = ops.find(op => op?.command === 'invoke' && op.selector === '.js-md-widget' && op.method === 'html')
  const html = invoke?.args?.[0]
  if (typeof html !== 'string' || html.length === 0) throw new Error('EPEX GB widget HTML missing')
  return html
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
      p: Math.round((priceGbpMwh / 10) * 100) / 100, // GBP/MWh -> GBp/kWh
    }
  })
}

async function fetchFormBuildId(date) {
  const dateStr = fmtDay(date)
  const url = `${EPEX_BASE_URL}?market_area=GB&delivery_date=${dateStr}&modality=Auction&sub_modality=DayAhead&data_mode=table&product=60`
  const html = execFileSync('curl', [
    '-s', '-L',
    '-A', USER_AGENT,
    url,
  ], { encoding: 'utf8' })
  return extractFormBuildId(html)
}

async function fetchAuctionDay(date, auctionKey, formBuildId) {
  const auction = AUCTIONS[auctionKey]
  const dateStr = fmtDay(date)
  const pageUrl = `${EPEX_BASE_URL}?market_area=GB&delivery_date=${dateStr}&modality=Auction&sub_modality=DayAhead&data_mode=table&product=60`

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const body = new URLSearchParams({
        'filters[modality]': 'Auction',
        'filters[sub_modality]': 'DayAhead',
        'filters[auction]': auction.code,
        'filters[delivery_date]': formatDisplayDate(date),
        'filters[product]': '60',
        'filters[data_mode]': 'table',
        'filters[market_area]': 'GB',
        form_build_id: formBuildId,
        form_id: 'market_data_filters_form',
        submit_js: '',
      })

      const responseText = execFileSync('curl', [
        '-s', '-L',
        '-A', USER_AGENT,
        '-H', 'X-Requested-With: XMLHttpRequest',
        '-H', 'Accept: application/json, text/javascript, */*; q=0.01',
        '-H', 'Content-Type: application/x-www-form-urlencoded; charset=UTF-8',
        '--data', body.toString(),
        `${pageUrl}&ajax_form=1`,
      ], { encoding: 'utf8' })

      const widgetHtml = parseWidgetHtml(JSON.parse(responseText))
      return parseAuctionRows(date, widgetHtml)
    } catch (error) {
      if (attempt === MAX_RETRIES - 1) throw error
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

function expandHourlyToQuarterHour(points) {
  const result = new Map()
  for (const point of points) {
    for (const offset of [0, 15, 30, 45]) {
      result.set(point.t + offset * 60000, point.p)
    }
  }
  return [...result.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p }))
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
  let cursor = new Date(startDate)
  while (cursor <= endDate) {
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

async function detectLatestAvailableDate(formBuildId) {
  const today = new Date()
  const tomorrow = addDays(today, 1)
  const probeTomorrow = await fetchAuctionDay(tomorrow, 'daa1', formBuildId).catch(() => [])
  if (probeTomorrow.length > 0) return tomorrow
  return today
}

async function main() {
  const outDir = join(process.cwd(), 'public', 'data')
  const paths = {
    daa1Hourly: join(outDir, 'gb-daa1-prices.json'),
    daa1QH: join(outDir, 'gb-daa1-prices-qh.json'),
    daa2Hourly: join(outDir, 'gb-daa2-prices.json'),
    daa2QH: join(outDir, 'gb-daa2-prices-qh.json'),
  }

  const existing = {
    daa1Hourly: loadSeries(paths.daa1Hourly),
    daa1QH: loadSeries(paths.daa1QH),
    daa2Hourly: loadSeries(paths.daa2Hourly),
    daa2QH: loadSeries(paths.daa2QH),
  }

  const bootstrap = Object.values(existing).some(series => series.length === 0)
  const existingLastTs = Math.min(
    ...Object.values(existing)
      .filter(series => series.length > 0)
      .map(series => series[series.length - 1].t),
  )
  const latestAvailableDate = await detectLatestAvailableDate(await fetchFormBuildId(new Date()))
  const fetchStart = bootstrap
    ? addDays(latestAvailableDate, -(BOOTSTRAP_DAYS - 1))
    : addDays(new Date(existingLastTs), -2)
  const dates = dateRange(fetchStart, latestAvailableDate)

  console.log('🇬🇧 GB Day-Ahead Update (EPEX)')
  console.log(`   Mode: ${bootstrap ? 'bootstrap' : 'incremental'}`)
  console.log(`   Range: ${fmtDay(fetchStart)} → ${fmtDay(latestAvailableDate)} (${dates.length} days)`)

  const daa1HourlyMap = new Map(existing.daa1Hourly.map(point => [point.t, point.p]))
  const daa1QHMap = new Map(existing.daa1QH.map(point => [point.t, point.p]))
  const daa2HourlyMap = new Map(existing.daa2Hourly.map(point => [point.t, point.p]))
  const daa2QHMap = new Map(existing.daa2QH.map(point => [point.t, point.p]))

  let cursor = 0
  let completed = 0

  async function worker() {
    while (cursor < dates.length) {
      const index = cursor++
        const day = dates[index]
        const dayStr = fmtDay(day)
      try {
        const formBuildId = await fetchFormBuildId(day)
        const [daa1Rows, daa2Rows] = await Promise.all([
          fetchAuctionDay(day, 'daa1', formBuildId),
          fetchAuctionDay(day, 'daa2', formBuildId),
        ])

        for (const point of daa1Rows) {
          daa1HourlyMap.set(point.t, point.p)
        }
        for (const point of expandHourlyToQuarterHour(daa1Rows)) {
          daa1QHMap.set(point.t, point.p)
        }

        for (const point of aggregateHalfHourlyToHourly(daa2Rows)) {
          daa2HourlyMap.set(point.t, point.p)
        }
        for (const point of expandHalfHourlyToQuarterHour(daa2Rows)) {
          daa2QHMap.set(point.t, point.p)
        }
      } catch (error) {
        console.log(`   ⚠️  ${dayStr}: ${error.message}`)
      }

      completed++
      if (completed % 25 === 0 || completed === dates.length) {
        console.log(`   Progress: ${completed}/${dates.length}`)
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, dates.length || 1) }, () => worker()))

  const out = {
    daa1Hourly: [...daa1HourlyMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
    daa1QH: [...daa1QHMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
    daa2Hourly: [...daa2HourlyMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
    daa2QH: [...daa2QHMap.entries()].sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p })),
  }

  const sizes = {
    daa1Hourly: writeSeries(paths.daa1Hourly, out.daa1Hourly),
    daa1QH: writeSeries(paths.daa1QH, out.daa1QH),
    daa2Hourly: writeSeries(paths.daa2Hourly, out.daa2Hourly),
    daa2QH: writeSeries(paths.daa2QH, out.daa2QH),
  }

  console.log(`   💾 gb-daa1-prices.json: ${out.daa1Hourly.length} pts (${sizes.daa1Hourly} KB)`)
  console.log(`   💾 gb-daa1-prices-qh.json: ${out.daa1QH.length} pts (${sizes.daa1QH} KB)`)
  console.log(`   💾 gb-daa2-prices.json: ${out.daa2Hourly.length} pts (${sizes.daa2Hourly} KB)`)
  console.log(`   💾 gb-daa2-prices-qh.json: ${out.daa2QH.length} pts (${sizes.daa2QH} KB)`)
  console.log('   ✅ Done!')
}

main().catch(error => {
  console.error('❌ GB update error:', error.message)
  process.exit(1)
})
