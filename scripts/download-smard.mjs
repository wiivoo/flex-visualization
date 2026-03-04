#!/usr/bin/env node
/**
 * Download full SMARD dataset — prices + generation data
 * Saves to public/data/ for static serving
 *
 * Usage: node scripts/download-smard.mjs
 */

const SMARD_BASE = 'https://www.smard.de/app/chart_data'

const FILTERS = {
  PRICE: 4169,
  SOLAR: 4068,
  WIND_ONSHORE: 4067,
  WIND_OFFSHORE: 1225,
  GRID_LOAD: 410,
}

const BATCH_SIZE = 15 // parallel requests per batch
const RETRY_DELAY = 1000

// ENTSO-E Transparency Platform — fallback for SMARD gaps
const ENTSOE_BASE_URL = 'https://web-api.tp.entsoe.eu/api'
const ENTSOE_DOMAIN = '10Y1001A1001A82H' // DE-LU bidding zone
const ENTSOE_TOKEN = process.env.ENTSOE_API_TOKEN || ''

async function fetchWithRetry(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      const res = await fetch(url)
      if (res.ok) return res
      if (res.status === 404) return null
      throw new Error(`HTTP ${res.status}`)
    } catch (e) {
      if (i === retries - 1) throw e
      await new Promise(r => setTimeout(r, RETRY_DELAY * (i + 1)))
    }
  }
}

async function getIndex(filter, resolution = 'hour') {
  const url = `${SMARD_BASE}/${filter}/DE/index_${resolution}.json`
  const res = await fetchWithRetry(url)
  if (!res) throw new Error(`Index not found for filter ${filter} (${resolution})`)
  const data = await res.json()
  return Array.isArray(data) ? data : data.timestamps || []
}

async function fetchChunk(filter, timestamp, resolution = 'hour') {
  const url = `${SMARD_BASE}/${filter}/DE/${filter}_DE_${resolution}_${timestamp}.json`
  const res = await fetchWithRetry(url)
  if (!res) return []
  const data = await res.json()
  return (data.series || []).filter(([, val]) => val !== null)
}

async function downloadFilter(filter, filterName, startMs, resolution = 'hour') {
  console.log(`\n📥 Downloading ${filterName} (${resolution}, filter ${filter})...`)
  const timestamps = await getIndex(filter, resolution)
  const relevant = timestamps.filter(ts => ts >= startMs - 7 * 24 * 3600 * 1000)
  console.log(`   ${relevant.length} weekly chunks to fetch`)

  const allData = new Map()
  let fetched = 0

  for (let i = 0; i < relevant.length; i += BATCH_SIZE) {
    const batch = relevant.slice(i, i + BATCH_SIZE)
    const results = await Promise.allSettled(
      batch.map(ts => fetchChunk(filter, ts, resolution))
    )

    for (const result of results) {
      if (result.status === 'fulfilled') {
        for (const [ts, val] of result.value) {
          if (ts >= startMs) allData.set(ts, val)
        }
      }
    }

    fetched += batch.length
    process.stdout.write(`   ${fetched}/${relevant.length} chunks (${allData.size} points)\r`)
  }

  console.log(`   ✅ ${allData.size} data points for ${filterName}`)
  return allData
}

/**
 * Detect gaps in a sorted Map of timestamp → value.
 * Returns array of { start, end, missingHours } for each gap.
 */
function detectGaps(dataMap, stepMs = 3600000) {
  const sorted = Array.from(dataMap.keys()).sort((a, b) => a - b)
  const gaps = []
  for (let i = 1; i < sorted.length; i++) {
    const diff = sorted[i] - sorted[i - 1]
    if (diff > stepMs * 1.5) {
      gaps.push({
        start: sorted[i - 1] + stepMs, // first missing timestamp
        end: sorted[i] - stepMs,       // last missing timestamp
        missingHours: Math.round(diff / stepMs) - 1,
      })
    }
  }
  return gaps
}

/**
 * Fetch day-ahead prices from ENTSO-E for a date range.
 * Returns Map<timestamp_ms, price_eur_mwh>.
 */
async function fetchEntsoeGapFill(startMs, endMs, resolution = 'hour') {
  if (!ENTSOE_TOKEN) {
    console.log('   ⚠️  ENTSOE_API_TOKEN not set, skipping ENTSO-E gap fill')
    return new Map()
  }

  const startDate = new Date(startMs)
  const endDate = new Date(endMs)
  // ENTSO-E periodEnd is exclusive — add 1 day buffer
  const endDatePlus1 = new Date(endMs + 24 * 3600 * 1000)

  const fmtDate = (d) => d.toISOString().slice(0, 10).replace(/-/g, '') + '0000'

  const url = `${ENTSOE_BASE_URL}?securityToken=${ENTSOE_TOKEN}&documentType=A44&in_Domain=${ENTSOE_DOMAIN}&out_Domain=${ENTSOE_DOMAIN}&periodStart=${fmtDate(startDate)}&periodEnd=${fmtDate(endDatePlus1)}`

  const res = await fetchWithRetry(url)
  if (!res) return new Map()

  const xml = await res.text()
  const result = new Map()

  // Parse XML: extract Period blocks with start time, resolution, and Point entries
  const periodRegex = /<Period>([\s\S]*?)<\/Period>/g
  let periodMatch
  while ((periodMatch = periodRegex.exec(xml)) !== null) {
    const block = periodMatch[1]
    const startMatch = block.match(/<start>([\dT:Z-]+)<\/start>/)
    const resMatch = block.match(/<resolution>(PT\d+M)<\/resolution>/)
    if (!startMatch || !resMatch) continue

    const periodStart = new Date(startMatch[1]).getTime()
    const xmlRes = resMatch[1]
    const stepMs = xmlRes === 'PT15M' ? 15 * 60 * 1000 : 3600 * 1000

    // For QH resolution, skip PT60M data (we want the fine granularity)
    if (resolution === 'quarterhour' && xmlRes === 'PT60M') continue

    const pointRegex = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([-\d.]+)<\/price\.amount>\s*<\/Point>/g
    let pointMatch
    while ((pointMatch = pointRegex.exec(block)) !== null) {
      const position = parseInt(pointMatch[1], 10)
      const price = parseFloat(pointMatch[2])
      const ts = periodStart + (position - 1) * stepMs
      if (ts >= startMs && ts <= endMs) {
        result.set(ts, price)
      }
    }
  }

  return result
}

/**
 * Fill gaps in a price dataset using ENTSO-E as fallback.
 */
async function fillGapsWithEntsoe(dataMap, label, resolution = 'hour') {
  const stepMs = resolution === 'quarterhour' ? 15 * 60 * 1000 : 3600 * 1000
  const gaps = detectGaps(dataMap, stepMs)

  if (gaps.length === 0) {
    console.log(`   ✅ No gaps in ${label}`)
    return
  }

  console.log(`\n🔧 Filling ${gaps.length} gap(s) in ${label} via ENTSO-E...`)
  let totalFilled = 0

  for (const gap of gaps) {
    const startStr = new Date(gap.start).toISOString().slice(0, 16)
    const endStr = new Date(gap.end).toISOString().slice(0, 16)
    console.log(`   Gap: ${startStr} → ${endStr} (${gap.missingHours} ${resolution === 'quarterhour' ? 'slots' : 'hours'})`)

    let filled = await fetchEntsoeGapFill(gap.start, gap.end, resolution)

    // If requesting hourly but got QH data (15-min timestamps), aggregate to hourly averages
    if (resolution === 'hour' && filled.size > 0) {
      const hourly = new Map()
      for (const [ts, val] of filled) {
        const hourTs = ts - (ts % 3600000) // round down to hour
        if (!hourly.has(hourTs)) hourly.set(hourTs, [])
        hourly.get(hourTs).push(val)
      }
      filled = new Map()
      for (const [hourTs, vals] of hourly) {
        const avg = vals.reduce((s, v) => s + v, 0) / vals.length
        filled.set(hourTs, Math.round(avg * 100) / 100)
      }
    }

    for (const [ts, val] of filled) {
      dataMap.set(ts, val)
    }
    totalFilled += filled.size
    console.log(`   → Filled ${filled.size} points from ENTSO-E`)
  }

  console.log(`   ✅ Total filled: ${totalFilled} points for ${label}`)
}

/**
 * Extend price dataset with latest aWATTar + ENTSO-E data.
 * SMARD often lags 1-2 days behind EPEX Spot publication.
 * aWATTar provides D+1 prices shortly after EPEX publishes (~12:15 CET).
 * ENTSO-E provides full historical + D+1 data.
 */
async function extendWithLatestPrices(prices, pricesQH) {
  // Find the last timestamp in SMARD data
  const lastSmardTs = Math.max(...prices.keys())
  const lastSmardDate = new Date(lastSmardTs).toISOString().slice(0, 10)
  const tomorrow = new Date(Date.now() + 24 * 3600 * 1000)
  const tomorrowEnd = new Date(tomorrow.toISOString().slice(0, 10) + 'T23:00:00Z').getTime()

  if (lastSmardTs >= tomorrowEnd) {
    console.log('\n✅ SMARD data already includes D+1, no extension needed')
    return
  }

  const gapStart = lastSmardTs + 3600000
  console.log(`\n📡 Extending prices beyond SMARD (${lastSmardDate}) with aWATTar + ENTSO-E...`)

  let extended = 0

  // 1. aWATTar — fast, no auth needed, covers today + D+1
  try {
    const awattarUrl = `https://api.awattar.de/v1/marketdata?start=${gapStart}&end=${tomorrowEnd}`
    const res = await fetchWithRetry(awattarUrl)
    if (res) {
      const data = await res.json()
      if (data.data?.length > 0) {
        for (const point of data.data) {
          const ts = point.start_timestamp
          if (!prices.has(ts)) {
            prices.set(ts, Math.round(point.marketprice * 100) / 100) // EUR/MWh
            extended++
          }
        }
        console.log(`   aWATTar: +${extended} hourly prices`)
      }
    }
  } catch (e) {
    console.log(`   ⚠️  aWATTar failed: ${e.message}`)
  }

  // 2. ENTSO-E — fills remaining gaps (broader coverage than aWATTar)
  if (ENTSOE_TOKEN) {
    try {
      const entsoeData = await fetchEntsoeGapFill(gapStart, tomorrowEnd, 'hour')
      let entsoeAdded = 0
      for (const [ts, val] of entsoeData) {
        if (!prices.has(ts)) {
          prices.set(ts, val)
          entsoeAdded++
        }
      }
      if (entsoeAdded > 0) {
        extended += entsoeAdded
        console.log(`   ENTSO-E: +${entsoeAdded} hourly prices`)
      }

      // Also extend QH data from ENTSO-E if available
      const entsoeQH = await fetchEntsoeGapFill(gapStart, tomorrowEnd, 'quarterhour')
      let qhAdded = 0
      for (const [ts, val] of entsoeQH) {
        if (!pricesQH.has(ts)) {
          pricesQH.set(ts, val)
          qhAdded++
        }
      }
      if (qhAdded > 0) console.log(`   ENTSO-E: +${qhAdded} QH prices`)
    } catch (e) {
      console.log(`   ⚠️  ENTSO-E extension failed: ${e.message}`)
    }
  }

  if (extended > 0) {
    const newLast = new Date(Math.max(...prices.keys())).toISOString().slice(0, 16)
    console.log(`   ✅ Extended to ${newLast} (+${extended} total hourly points)`)
  } else {
    console.log(`   ℹ️  No additional data available yet (EPEX may not have published D+1)`)
  }
}

async function main() {
  const startYear = 2022 // 4 years of data
  const startMs = new Date(`${startYear}-01-01T00:00:00Z`).getTime()

  console.log('🔌 SMARD Data Downloader')
  console.log(`   Range: ${startYear}-01-01 to today`)
  console.log(`   Output: public/data/`)

  // Download prices (hourly + quarter-hourly)
  const prices = await downloadFilter(FILTERS.PRICE, 'Day-Ahead Prices', startMs, 'hour')
  const pricesQH = await downloadFilter(FILTERS.PRICE, 'Day-Ahead Prices QH', startMs, 'quarterhour')

  // Download generation data
  const solar = await downloadFilter(FILTERS.SOLAR, 'Solar PV', startMs)
  const windOn = await downloadFilter(FILTERS.WIND_ONSHORE, 'Wind Onshore', startMs)
  const windOff = await downloadFilter(FILTERS.WIND_OFFSHORE, 'Wind Offshore', startMs)
  const load = await downloadFilter(FILTERS.GRID_LOAD, 'Grid Load', startMs)

  // Fill gaps in SMARD data using ENTSO-E
  await fillGapsWithEntsoe(prices, 'Hourly Prices', 'hour')
  await fillGapsWithEntsoe(pricesQH, 'QH Prices', 'quarterhour')

  // Extend dataset with latest aWATTar + ENTSO-E data (D+1)
  // SMARD lags behind EPEX publication — aWATTar/ENTSO-E have prices sooner
  await extendWithLatestPrices(prices, pricesQH)

  // Build prices JSON
  const priceArray = Array.from(prices.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, price]) => ({
      t: ts,
      p: Math.round(price * 100) / 100, // EUR/MWh, 2 decimals
    }))

  // Build QH prices JSON
  const priceQHArray = Array.from(pricesQH.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, price]) => ({
      t: ts,
      p: Math.round(price * 100) / 100,
    }))

  // Build generation JSON — merge all sources by timestamp
  const allGenTs = new Set([...solar.keys(), ...windOn.keys(), ...windOff.keys(), ...load.keys()])
  const genArray = Array.from(allGenTs)
    .filter(ts => ts >= startMs)
    .sort()
    .map(ts => ({
      t: ts,
      s: Math.round(solar.get(ts) || 0),   // solar MW
      w: Math.round((windOn.get(ts) || 0) + (windOff.get(ts) || 0)), // wind MW
      l: Math.round(load.get(ts) || 0),     // load MW
    }))

  // Write files
  const fs = await import('fs')
  const path = await import('path')
  const outDir = path.join(process.cwd(), 'public', 'data')

  const pricesPath = path.join(outDir, 'smard-prices.json')
  fs.writeFileSync(pricesPath, JSON.stringify(priceArray))
  const priceSize = (fs.statSync(pricesPath).size / 1024 / 1024).toFixed(1)
  console.log(`\n💾 Prices: ${priceArray.length} points (${priceSize} MB) → ${pricesPath}`)

  const pricesQHPath = path.join(outDir, 'smard-prices-qh.json')
  fs.writeFileSync(pricesQHPath, JSON.stringify(priceQHArray))
  const priceQHSize = (fs.statSync(pricesQHPath).size / 1024 / 1024).toFixed(1)
  console.log(`💾 Prices QH: ${priceQHArray.length} points (${priceQHSize} MB) → ${pricesQHPath}`)

  const genPath = path.join(outDir, 'smard-generation.json')
  fs.writeFileSync(genPath, JSON.stringify(genArray))
  const genSize = (fs.statSync(genPath).size / 1024 / 1024).toFixed(1)
  console.log(`💾 Generation: ${genArray.length} points (${genSize} MB) → ${genPath}`)

  // Write metadata
  const meta = {
    downloadedAt: new Date().toISOString(),
    startDate: new Date(startMs).toISOString().slice(0, 10),
    endDate: new Date().toISOString().slice(0, 10),
    pricePoints: priceArray.length,
    priceQHPoints: priceQHArray.length,
    generationPoints: genArray.length,
    source: 'smard.de + awattar.de + entsoe.eu',
  }
  fs.writeFileSync(path.join(outDir, 'smard-meta.json'), JSON.stringify(meta, null, 2))

  console.log(`\n✅ Done! Total: ${priceArray.length} hourly + ${priceQHArray.length} QH prices + ${genArray.length} generation points`)
  console.log('   Run this script periodically to update with latest data.')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
