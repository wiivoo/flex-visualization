#!/usr/bin/env node
/**
 * EPEX Spot Day-Ahead Auction Price Scraper
 * Scrapes day-ahead auction results from https://www.epexspot.com/en/market-results
 *
 * Market area: DE-LU (Germany/Luxembourg)
 * Requires: playwright (npx playwright install chromium)
 *
 * Usage:
 *   node scripts/scrape-epex.mjs                          # Today's prices
 *   node scripts/scrape-epex.mjs --date 2026-03-01        # Specific date
 *   node scripts/scrape-epex.mjs --start 2026-02-14 --end 2026-02-16  # Date range
 *   node scripts/scrape-epex.mjs --output json             # JSON to stdout
 *   node scripts/scrape-epex.mjs --save                    # Merge into static data
 *
 * Output: hourly day-ahead prices in EUR/MWh for DE-LU
 *
 * Note: EPEX Spot Terms of Service restrict commercial usage.
 * This scraper is for personal/research use only.
 */

import { chromium } from 'playwright'

const EPEX_BASE_URL = 'https://www.epexspot.com/en/market-results'
const MARKET_AREA = 'DE-LU'
const MODALITY = 'Auction'
const SUB_MODALITY = 'DayAhead'
const DATA_MODE = 'table'

/**
 * Build EPEX Spot URL for a given delivery date and product granularity.
 * product=60 → hourly, product=15 → quarter-hourly
 */
function buildUrl(date, product = 60) {
  const dateStr = date instanceof Date
    ? date.toISOString().slice(0, 10)
    : date
  return `${EPEX_BASE_URL}?market_area=${MARKET_AREA}&delivery_date=${dateStr}&modality=${MODALITY}&sub_modality=${SUB_MODALITY}&data_mode=${DATA_MODE}&product=${product}`
}

/**
 * Scrape day-ahead auction prices for a single date.
 * Returns array of { hour, priceEurMwh, volume } objects.
 */
async function scrapeDate(page, date, product = 60) {
  const url = buildUrl(date, product)
  const dateStr = date instanceof Date ? date.toISOString().slice(0, 10) : date

  await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })

  // Handle cookie consent banner if present
  try {
    const cookieBtn = page.locator('#onetrust-accept-btn-handler')
    if (await cookieBtn.isVisible({ timeout: 2000 })) {
      await cookieBtn.click()
      await page.waitForTimeout(500)
    }
  } catch {
    // No cookie banner, continue
  }

  // Wait for the data table to load
  await page.waitForSelector('table.table-01', { timeout: 15000 }).catch(() => null)

  // Allow extra time for JS rendering
  await page.waitForTimeout(1500)

  // Extract price data from the table
  const rows = await page.$$eval('table.table-01 tbody tr', (trs) => {
    return trs.map(tr => {
      const cells = Array.from(tr.querySelectorAll('td'))
      return cells.map(td => td.textContent?.trim() || '')
    }).filter(row => row.length > 0)
  })

  if (rows.length === 0) {
    console.error(`   No data found for ${dateStr}`)
    return []
  }

  const results = []
  const stepsPerDay = product === 15 ? 96 : 24
  const minutesPerStep = product === 15 ? 15 : 60

  for (let i = 0; i < rows.length && i < stepsPerDay; i++) {
    const row = rows[i]
    // EPEX table columns vary but typically:
    // Col 0: Delivery period (e.g., "00 - 01" or "00:00 - 00:15")
    // Col 1-N: Price/volume data
    // We look for the price column — usually contains decimal numbers

    // Find the first numeric-looking column (price in EUR/MWh)
    let price = null
    for (let j = 0; j < row.length; j++) {
      const val = row[j].replace(/,/g, '.').replace(/\s/g, '')
      const num = parseFloat(val)
      if (!isNaN(num) && val.match(/^-?\d+\.?\d*$/)) {
        price = num
        break
      }
    }

    if (price !== null) {
      const hour = Math.floor((i * minutesPerStep) / 60)
      const minute = (i * minutesPerStep) % 60
      results.push({
        hour,
        minute,
        priceEurMwh: price,
        deliveryPeriod: row[0] || `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`,
      })
    }
  }

  return results
}

/**
 * Convert scraped results to the compact { t, p } format used by smard-prices.json
 */
function toCompactFormat(dateStr, results) {
  return results.map(r => {
    const d = new Date(`${dateStr}T${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}:00Z`)
    return {
      t: d.getTime(),
      p: Math.round(r.priceEurMwh * 100) / 100,
    }
  })
}

/**
 * Generate array of dates between start and end (inclusive)
 */
function dateRange(start, end) {
  const dates = []
  const current = new Date(start + 'T12:00:00Z')
  const endDate = new Date(end + 'T12:00:00Z')
  while (current <= endDate) {
    dates.push(current.toISOString().slice(0, 10))
    current.setUTCDate(current.getUTCDate() + 1)
  }
  return dates
}

// --- CLI ---

async function main() {
  const args = process.argv.slice(2)
  const flags = {}
  for (let i = 0; i < args.length; i++) {
    if (args[i].startsWith('--')) {
      const key = args[i].slice(2)
      flags[key] = args[i + 1] && !args[i + 1].startsWith('--') ? args[++i] : true
    }
  }

  const today = new Date().toISOString().slice(0, 10)
  const dates = flags.start && flags.end
    ? dateRange(flags.start, flags.end)
    : [flags.date || today]

  const product = flags.qh ? 15 : 60
  const outputJson = flags.output === 'json'
  const save = flags.save

  console.log(`🔌 EPEX Spot Scraper — DE-LU Day-Ahead Auction`)
  console.log(`   Dates: ${dates[0]}${dates.length > 1 ? ` → ${dates[dates.length - 1]} (${dates.length} days)` : ''}`)
  console.log(`   Product: ${product === 15 ? '15-min' : 'hourly'}`)

  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  })
  const page = await context.newPage()

  const allResults = []
  const allCompact = []

  for (const dateStr of dates) {
    process.stdout.write(`   ${dateStr}... `)
    try {
      const results = await scrapeDate(page, dateStr, product)
      allResults.push({ date: dateStr, prices: results })
      allCompact.push(...toCompactFormat(dateStr, results))
      console.log(`${results.length} prices`)
    } catch (e) {
      console.log(`ERROR: ${e.message}`)
    }

    // Rate limit: 2 seconds between requests
    if (dates.indexOf(dateStr) < dates.length - 1) {
      await new Promise(r => setTimeout(r, 2000))
    }
  }

  await browser.close()

  if (outputJson) {
    console.log(JSON.stringify(allResults, null, 2))
  } else if (!save) {
    // Print summary table
    for (const { date, prices } of allResults) {
      console.log(`\n📅 ${date}:`)
      for (const p of prices) {
        const bar = '█'.repeat(Math.max(0, Math.round(p.priceEurMwh / 5)))
        console.log(`   ${p.deliveryPeriod.padEnd(12)} ${String(p.priceEurMwh).padStart(8)} EUR/MWh  ${bar}`)
      }
    }
  }

  if (save && allCompact.length > 0) {
    const fs = await import('fs')
    const path = await import('path')
    const pricesPath = path.join(process.cwd(), 'public', 'data', 'smard-prices.json')

    if (fs.existsSync(pricesPath)) {
      const existing = JSON.parse(fs.readFileSync(pricesPath, 'utf-8'))
      const existingTs = new Set(existing.map(p => p.t))

      let added = 0
      for (const p of allCompact) {
        if (!existingTs.has(p.t)) {
          existing.push(p)
          added++
        }
      }

      existing.sort((a, b) => a.t - b.t)
      fs.writeFileSync(pricesPath, JSON.stringify(existing))
      console.log(`\n💾 Merged ${added} new points into ${pricesPath}`)
    } else {
      fs.writeFileSync(pricesPath, JSON.stringify(allCompact))
      console.log(`\n💾 Wrote ${allCompact.length} points to ${pricesPath}`)
    }
  }

  console.log(`\n✅ Done! Scraped ${allCompact.length} price points.`)
}

main().catch(e => { console.error('❌ Error:', e.message); process.exit(1) })
