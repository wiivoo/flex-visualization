#!/usr/bin/env node
/**
 * EPEX Spot Intraday Continuous Price Scraper
 *
 * Scrapes 15-min intraday continuous results from EPEX SPOT for DE and NL.
 * Extracts all fields: Low, High, Last, Weight Avg, ID Full, ID1, ID3,
 * Buy Volume, Sell Volume, Volume (EUR/MWh), stored in Supabase price_cache.
 *
 * Table structure: 168 rows per day = 24 hours × 7 rows each:
 *   [0] HH-HH+1     (hourly summary)
 *   [1] HH:00-HH:30 (30-min block)
 *   [2] HH:00-HH:15 (QH 1) ← we want these
 *   [3] HH:15-HH:30 (QH 2) ← we want these
 *   [4] HH:30-HH+1  (30-min block)
 *   [5] HH:30-HH:45 (QH 3) ← we want these
 *   [6] HH:45-HH+1  (QH 4) ← we want these
 *
 * Usage:
 *   node scripts/scrape-epex-intraday.mjs                         # DE yesterday + day before
 *   node scripts/scrape-epex-intraday.mjs --area NL               # NL yesterday + day before
 *   node scripts/scrape-epex-intraday.mjs --date 2026-03-24       # Specific date (DE)
 *   node scripts/scrape-epex-intraday.mjs --area NL --date 2026-03-24
 *   node scripts/scrape-epex-intraday.mjs --dry-run               # Scrape but don't write to DB
 *   node scripts/scrape-epex-intraday.mjs --backfill              # Re-scrape even if cached (upgrade schema)
 */
import { chromium } from 'playwright'
import { createClient } from '@supabase/supabase-js'
import { existsSync, readFileSync, writeFileSync } from 'fs'
import { join } from 'path'

// --- Load env ---
const envPath = join(process.cwd(), '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const m = line.match(/^([A-Z_]+)=(.+)$/)
    if (m) process.env[m[1]] = m[2].trim()
  }
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
if (!supabaseUrl || !supabaseKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY')
  process.exit(1)
}
const supabase = createClient(supabaseUrl, supabaseKey)

const EPEX_URL = 'https://www.epexspot.com/en/market-results'

// Supported market areas
const MARKET_AREAS = {
  DE: { epexCode: 'DE', cachePrefix: '', label: 'Germany' },
  NL: { epexCode: 'NL', cachePrefix: 'nl:', label: 'Netherlands' },
  GB: { epexCode: 'GB', cachePrefix: 'gb:', label: 'United Kingdom' },
}

// --- Column indices (from EPEX table headers) ---
// '', Low, High, Last, Weight Avg, ID Full, ID1, ID3, Buy Volume, Sell Volume, Volume
const COL = { LOW: 0, HIGH: 1, LAST: 2, WAVG: 3, ID_FULL: 4, ID1: 5, ID3: 6, BUY_VOL: 7, SELL_VOL: 8, VOLUME: 9 }

// QH row indices within each 7-row hourly group
const QH_OFFSETS = [2, 3, 5, 6]

function buildUrl(deliveryDate, marketArea = 'DE') {
  return `${EPEX_URL}?market_area=${marketArea}&delivery_date=${deliveryDate}&modality=Continuous&product=15&data_mode=table`
}

function parseNum(v) {
  if (!v || v === '-' || v === '0.00') return null
  const n = parseFloat(v.replace(/,/g, ''))
  return isNaN(n) ? null : n
}

/**
 * Scrape a single date. Returns 96 quarter-hour entries or null.
 * Retries the page load once on timeout (transient network failures).
 */
async function scrapeDate(page, deliveryDate, marketArea = 'DE') {
  console.log(`  ${deliveryDate}: loading...`)

  // Attempt page load with retry on timeout
  let loadOk = false
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      await page.goto(buildUrl(deliveryDate, marketArea), { waitUntil: 'domcontentloaded', timeout: 90000 })
      loadOk = true
      break
    } catch (err) {
      if (attempt < 2) {
        console.log(`  ${deliveryDate}: page load timeout (attempt ${attempt}), retrying after 15s...`)
        await page.waitForTimeout(15000)
      } else {
        console.error(`  ${deliveryDate}: page load failed after 2 attempts — ${err.message.split('\n')[0]}`)
        return null
      }
    }
  }
  if (!loadOk) return null

  await page.waitForTimeout(10000)

  // Check WAF
  const title = await page.title()
  if (title === 'Human Verification' || title === '') {
    console.error(`  ${deliveryDate}: WAF CAPTCHA — blocked`)
    return null
  }

  // Handle disclaimer + cookies
  try {
    const btn = page.locator('#edit-acceptationbutton')
    if (await btn.isVisible({ timeout: 2000 })) { await btn.click(); await page.waitForTimeout(3000) }
  } catch {}
  try {
    const c = page.locator('#onetrust-accept-btn-handler')
    if (await c.isVisible({ timeout: 1500 })) { await c.click(); await page.waitForTimeout(500) }
  } catch {}

  // Wait for table to render (JS-loaded content)
  try {
    await page.waitForSelector('table.table-01 tr[class^="child-"]', { timeout: 20000 })
  } catch {
    // Table may not appear if no data for this date — wait a bit longer and continue
    await page.waitForTimeout(8000)
  }

  // Extract data rows with multiple fallback strategies:
  //   1. Primary: tr[class^="child-"] — standard EPEX row class
  //   2. Fallback A: any tr with 10 td cells (DE standard)
  //   3. Fallback B: any tr with 9–11 td cells (NL or future layout variations)
  //   4. Fallback C: any tr inside table.table-01 with at least 7 tds (broadest match)
  let allCells = await page.$$eval('table.table-01 tr[class^="child-"]', trs =>
    trs.map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || ''))
  ).catch(() => [])

  if (allCells.length === 0) {
    // Fallback A: exactly 10 tds (original fallback)
    allCells = await page.$$eval('table.table-01 tr', trs =>
      Array.from(trs)
        .filter(tr => tr.querySelectorAll('td').length === 10)
        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || ''))
    ).catch(() => [])
  }

  if (allCells.length === 0) {
    // Fallback B: 9–11 tds (handles NL layout with different column count)
    allCells = await page.$$eval('table.table-01 tr', trs =>
      Array.from(trs)
        .filter(tr => { const n = tr.querySelectorAll('td').length; return n >= 9 && n <= 11 })
        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || ''))
    ).catch(() => [])
  }

  if (allCells.length === 0) {
    // Fallback C: any tr with ≥7 tds inside any table on the page
    allCells = await page.$$eval('table tr', trs =>
      Array.from(trs)
        .filter(tr => tr.querySelectorAll('td').length >= 7)
        .map(tr => Array.from(tr.querySelectorAll('td')).map(td => td.textContent?.trim() || ''))
    ).catch(() => [])
  }

  if (allCells.length === 0) {
    // Diagnostic: log how many tables and rows exist so we can debug selector issues
    const pageInfo = await page.evaluate(() => {
      const tables = document.querySelectorAll('table')
      return Array.from(tables).map((t, i) => `table[${i}] rows=${t.querySelectorAll('tr').length} class="${t.className}"`)
    }).catch(() => [])
    console.error(`  ${deliveryDate}: no data rows found. Page tables: ${pageInfo.join(' | ') || 'none'}`)
    return null
  }

  return extractQH(deliveryDate, allCells, marketArea)
}

/**
 * Detect column layout from the first data row.
 * EPEX DE has 10 columns, NL may have a different count.
 * Returns column indices adjusted for the actual layout.
 */
function detectColumnLayout(allCells) {
  // Find first row with numeric-looking content (skip header rows)
  for (const row of allCells) {
    const numericCols = row.filter(c => /^-?[\d,]+\.?\d*$/.test(c.replace(/\s/g, ''))).length
    if (numericCols >= 3) {
      // Standard layout: 10 cols = Low, High, Last, WAVG, ID_Full, ID1, ID3, BuyVol, SellVol, Vol
      // NL may omit some volume columns but price cols (ID_Full, ID1, ID3) stay in same position
      // relative to Low/High/Last/WAVG at start.
      // Return the standard COL offsets — they are relative to start of the row.
      return COL
    }
  }
  return COL
}

/**
 * Extract 96 quarter-hour entries from the 168 raw rows.
 * marketArea is used for diagnostic logging only.
 */
function extractQH(deliveryDate, allCells, marketArea = 'DE') {
  if (allCells.length < 7) {
    console.error(`  ${deliveryDate}: too few rows (${allCells.length}) for ${marketArea}`)
    return null
  }

  const colMap = detectColumnLayout(allCells)
  const entries = []
  const rowsPerHour = 7
  const totalHours = Math.min(24, Math.floor(allCells.length / rowsPerHour))

  for (let h = 0; h < totalHours; h++) {
    const baseIdx = h * rowsPerHour

    for (let q = 0; q < 4; q++) {
      const rowIdx = baseIdx + QH_OFFSETS[q]
      if (rowIdx >= allCells.length) break

      const cells = allCells[rowIdx]
      // Be lenient: require only 5+ cells (Low, High, Last, WAVG, ID_Full minimum)
      if (cells.length < 5) continue

      const minute = [0, 15, 30, 45][q]
      const ts = `${deliveryDate}T${String(h).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00Z`

      entries.push({
        timestamp: ts,
        id_full: cells.length > colMap.ID_FULL ? parseNum(cells[colMap.ID_FULL]) : null,
        id1: cells.length > colMap.ID1 ? parseNum(cells[colMap.ID1]) : null,
        id3: cells.length > colMap.ID3 ? parseNum(cells[colMap.ID3]) : null,
        weight_avg: cells.length > colMap.WAVG ? parseNum(cells[colMap.WAVG]) : null,
        low: cells.length > colMap.LOW ? parseNum(cells[colMap.LOW]) : null,
        high: cells.length > colMap.HIGH ? parseNum(cells[colMap.HIGH]) : null,
        last: cells.length > colMap.LAST ? parseNum(cells[colMap.LAST]) : null,
        buy_volume: cells.length > colMap.BUY_VOL ? parseNum(cells[colMap.BUY_VOL]) : null,
        sell_volume: cells.length > colMap.SELL_VOL ? parseNum(cells[colMap.SELL_VOL]) : null,
        volume: cells.length > colMap.VOLUME ? parseNum(cells[colMap.VOLUME]) : null,
      })
    }
  }

  const withPrices = entries.filter(e => e.id_full !== null || e.weight_avg !== null)
  console.log(`  ${deliveryDate}: ${entries.length} QH slots, ${withPrices.length} with prices`)
  return entries
}

/**
 * Sanity-check extracted entries before writing. VWAP (weight_avg, id_full,
 * id1, id3) must sit inside [low, high] per settlement period. A violation
 * usually means the EPEX table rendered with a transient column offset or
 * partial data — we drop the row so Supabase never accepts garbage.
 * Returns { kept, dropped, fixedIndexFields } where kept is the subset that
 * passed validation.
 */
function validateEntries(entries) {
  const kept = []
  let dropped = 0
  let fixedIndexFields = 0
  const EPS = 0.51 // EUR/MWh tolerance — ≈ 0.05 ct/kWh rounding slack
  for (const e of entries) {
    const lo = e.low, hi = e.high
    const checkField = (v) => v == null || lo == null || hi == null || (v >= lo - EPS && v <= hi + EPS)
    const coreOk = checkField(e.weight_avg) && checkField(e.last)
    if (!coreOk) { dropped++; continue }
    // Index fields (id_full, id1, id3) are sometimes in a different, still-
    // bounded range. If they fail the check, drop just those index values
    // rather than the whole row (price_ct_kwh falls back to weight_avg).
    const clean = { ...e }
    let anyIndexDropped = false
    for (const k of ['id_full', 'id1', 'id3']) {
      if (!checkField(clean[k])) { clean[k] = null; anyIndexDropped = true }
    }
    if (anyIndexDropped) fixedIndexFields++
    kept.push(clean)
  }
  return { kept, dropped, fixedIndexFields }
}

/**
 * Write to Supabase price_cache.
 * Stores prices in ct/kWh (EUR/MWh ÷ 10).
 * Uses country-prefixed cache type for non-DE areas (e.g., 'nl:intraday').
 */
async function writeToSupabase(dateStr, entries, cachePrefix = '') {
  const pricesJson = entries.map(e => ({
    timestamp: e.timestamp,
    price_ct_kwh: e.id_full !== null ? Math.round(e.id_full * 10) / 100 : (e.weight_avg !== null ? Math.round(e.weight_avg * 10) / 100 : null),
    id_full_ct: e.id_full !== null ? Math.round(e.id_full * 10) / 100 : null,
    id1_ct: e.id1 !== null ? Math.round(e.id1 * 10) / 100 : null,
    id3_ct: e.id3 !== null ? Math.round(e.id3 * 10) / 100 : null,
    weight_avg_ct: e.weight_avg !== null ? Math.round(e.weight_avg * 10) / 100 : null,
    low_ct: e.low !== null ? Math.round(e.low * 10) / 100 : null,
    high_ct: e.high !== null ? Math.round(e.high * 10) / 100 : null,
    last_ct: e.last !== null ? Math.round(e.last * 10) / 100 : null,
    buy_vol_mwh: e.buy_volume !== null ? Math.round(e.buy_volume * 100) / 100 : null,
    sell_vol_mwh: e.sell_volume !== null ? Math.round(e.sell_volume * 100) / 100 : null,
    volume_mwh: e.volume !== null ? Math.round(e.volume * 100) / 100 : null,
  }))

  const cacheType = `${cachePrefix}intraday`

  const { error } = await supabase
    .from('price_cache')
    .upsert({
      date: dateStr,
      type: cacheType,
      cached_at: new Date().toISOString(),
      source: 'epex',
      prices_json: pricesJson,
    }, { onConflict: 'date,type' })

  if (error) {
    console.error(`  ${dateStr}: Supabase error — ${error.message}`)
    return false
  }
  console.log(`  ${dateStr}: saved to Supabase as ${cacheType} (${pricesJson.filter(p => p.price_ct_kwh !== null).length} valid points)`)
  return true
}

async function isAlreadyCached(dateStr, cachePrefix = '') {
  const cacheType = `${cachePrefix}intraday`
  const { data } = await supabase
    .from('price_cache')
    .select('cached_at, prices_json')
    .eq('date', dateStr)
    .eq('type', cacheType)
    .single()
  if (!data) return false
  // Never consider empty data as cached
  const prices = data.prices_json || []
  const validCount = Array.isArray(prices) ? prices.filter(p => p.price_ct_kwh != null).length : 0
  if (validCount === 0) return false
  // Past dates: cache for 7 days (data is final). Today/yesterday: 12h (may update).
  const cachedAt = new Date(data.cached_at)
  const dateObj = new Date(`${dateStr}T12:00:00Z`)
  const ageMs = Date.now() - cachedAt.getTime()
  const daysSinceDate = (Date.now() - dateObj.getTime()) / 86400000
  const ttlMs = daysSinceDate > 2 ? 7 * 86400000 : 12 * 3600000
  return ageMs < ttlMs
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

  const areaKey = (flags.area || 'DE').toUpperCase()
  const area = MARKET_AREAS[areaKey]
  if (!area) {
    console.error(`Unknown market area: ${areaKey}. Supported: ${Object.keys(MARKET_AREAS).join(', ')}`)
    process.exit(1)
  }

  const today = new Date()
  const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
  const dayBefore = new Date(today); dayBefore.setDate(dayBefore.getDate() - 2)

  const dates = flags.date
    ? [flags.date]
    : [dayBefore.toISOString().slice(0, 10), yesterday.toISOString().slice(0, 10)]

  const dryRun = !!flags['dry-run']
  const backfill = !!flags['backfill']

  console.log(`EPEX Intraday Scraper — ${area.label} (${areaKey}) Continuous 15min`)
  console.log(`  Dates: ${dates.join(', ')} | Mode: ${dryRun ? 'DRY RUN' : 'Supabase'}${backfill ? ' | BACKFILL (ignoring cache)' : ''}`)

  // Skip cached dates (unless backfill mode)
  const toScrape = []
  for (const d of dates) {
    if (!dryRun && !backfill && await isAlreadyCached(d, area.cachePrefix)) {
      console.log(`  ${d}: already cached, skipping`)
    } else {
      toScrape.push(d)
    }
  }

  if (toScrape.length === 0) {
    console.log('Nothing to scrape.')
    return
  }

  const browser = await chromium.launch({
    headless: true,
    args: ['--disable-blink-features=AutomationControlled'],
  })
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/134.0.0.0 Safari/537.36',
    viewport: { width: 1440, height: 900 },
    timezoneId: 'Europe/Berlin',
  })
  const page = await context.newPage()

  let scraped = 0
  for (const dateStr of toScrape) {
    const rawEntries = await scrapeDate(page, dateStr, area.epexCode)
    if (!rawEntries) continue

    // Sanity-gate each row: VWAP/index fields must sit inside [low, high].
    // Rows where even the core fields fail are dropped; rows where only the
    // index fields fail keep the row but null out the bad index columns.
    const { kept: entries, dropped, fixedIndexFields } = validateEntries(rawEntries)
    if (dropped > 0 || fixedIndexFields > 0) {
      console.log(`  ${dateStr}: validation dropped ${dropped} rows, nulled index fields on ${fixedIndexFields} rows`)
    }

    // Guard: never overwrite good data with empty scrape results
    const validCount = entries.filter(e => e.id_full !== null || e.weight_avg !== null).length
    if (validCount === 0) {
      console.log(`  ${dateStr}: 0 valid prices after validation — skipping write to preserve existing data`)
      continue
    }
    // Extra guard: drop the write if too many ROWS were dropped entirely
    // (signals a table-layout regression). Nulled index fields do not count
    // here — they still leave low/high/last/weight_avg intact which is
    // useful data on its own, and EPEX sometimes publishes index fields
    // before they have finished settling.
    if (dropped > rawEntries.length * 0.25) {
      console.log(`  ${dateStr}: >25% of rows were dropped — skipping write, investigate EPEX layout`)
      continue
    }

    if (dryRun) {
      console.log(`  [DRY] Sample:`)
      entries.filter(e => e.id_full !== null).slice(0, 3).forEach(e =>
        console.log(`    ${e.timestamp}: ID Full=${e.id_full} | ID1=${e.id1} | ID3=${e.id3} | Last=${e.last} | Low=${e.low} | High=${e.high} | Vol=${e.volume} EUR/MWh`)
      )
    } else {
      await writeToSupabase(dateStr, entries, area.cachePrefix)
    }
    scraped++

    // Rate limit between dates
    if (toScrape.indexOf(dateStr) < toScrape.length - 1) {
      await page.waitForTimeout(5000)
    }
  }

  await browser.close()
  console.log(`\nDone. ${scraped}/${toScrape.length} days scraped.`)

  // Implicit heartbeat: every successful scrape already updates `cached_at`
  // on the corresponding price_cache row, so dashboards can monitor freshness
  // with:
  //   SELECT max(cached_at) FROM price_cache WHERE type IN ('intraday','nl:intraday','gb:intraday')
  // No separate heartbeat row is needed (and price_cache.type has a CHECK
  // constraint that rejects 'meta:*' values).
}

main().catch(e => { console.error('Error:', e.message); process.exit(1) })
