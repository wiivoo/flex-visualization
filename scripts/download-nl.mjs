#!/usr/bin/env node
/**
 * Download NL day-ahead prices from ENTSO-E Transparency Platform
 * Saves to public/data/nl-prices.json and nl-prices-qh.json
 *
 * Handles the NL QH transition (~Oct 2025): before that ENTSO-E returns PT60M,
 * after that PT15M. Hourly file always has 24 pts/day (QH aggregated to hourly avg).
 * QH file has native QH where available, expanded hourly elsewhere.
 *
 * Usage: ENTSOE_API_TOKEN=xxx node scripts/download-nl.mjs
 */

const ENTSOE_BASE = 'https://web-api.tp.entsoe.eu/api'
const NL_DOMAIN = '10YNL----------L'
const CHUNK_DAYS = 20 // smaller chunks = fewer 503s + stays under 100 TimeSeries
const MAX_RETRIES = 5

const TOKEN = process.env.ENTSOE_API_TOKEN
if (!TOKEN) {
  console.error('❌ ENTSOE_API_TOKEN environment variable required')
  process.exit(1)
}

function fmtDate(d) {
  return d.toISOString().slice(0, 10).replace(/-/g, '') + '0000'
}

function addDays(d, n) {
  const r = new Date(d)
  r.setUTCDate(r.getUTCDate() + n)
  return r
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms))
}

/**
 * Parse ENTSO-E XML into separate hourly and QH maps.
 * Returns { hourly: Map<ts, price>, qh: Map<ts, price> }
 */
function parseXml(xml) {
  const hourly = new Map()
  const qh = new Map()
  const periodRegex = /<Period>([\s\S]*?)<\/Period>/g
  let m
  while ((m = periodRegex.exec(xml)) !== null) {
    const block = m[1]
    const startMatch = block.match(/<start>([\dT:Z-]+)<\/start>/)
    const resMatch = block.match(/<resolution>(PT\d+M)<\/resolution>/)
    if (!startMatch || !resMatch) continue

    const periodStart = new Date(startMatch[1]).getTime()
    const xmlRes = resMatch[1]
    const stepMs = xmlRes === 'PT15M' ? 15 * 60 * 1000 : 3600 * 1000
    const target = xmlRes === 'PT15M' ? qh : hourly

    const pointRegex = /<Point>\s*<position>(\d+)<\/position>\s*<price\.amount>([-\d.]+)<\/price\.amount>\s*<\/Point>/g
    let pm
    while ((pm = pointRegex.exec(block)) !== null) {
      const pos = parseInt(pm[1], 10)
      const price = parseFloat(pm[2])
      const ts = periodStart + (pos - 1) * stepMs
      target.set(ts, Math.round(price * 100) / 100)
    }
  }
  return { hourly, qh }
}

/**
 * Fetch a date range from ENTSO-E with retry + fallback to smaller chunks
 */
async function fetchChunk(startDate, endDate) {
  const periodStart = fmtDate(startDate)
  const periodEnd = fmtDate(addDays(endDate, 1))
  const url = `${ENTSOE_BASE}?securityToken=${TOKEN}&documentType=A44&in_Domain=${NL_DOMAIN}&out_Domain=${NL_DOMAIN}&periodStart=${periodStart}&periodEnd=${periodEnd}`

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 503) {
        const wait = 2000 * (attempt + 1)
        process.stdout.write(`   ⚠️  503 (attempt ${attempt + 1}/${MAX_RETRIES}, wait ${wait}ms)...`)
        await sleep(wait)
        continue
      }
      if (res.status === 400) return { hourly: new Map(), qh: new Map() }
      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
      const xml = await res.text()
      if (xml.includes('No matching data found')) return { hourly: new Map(), qh: new Map() }
      return parseXml(xml)
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e
      await sleep(2000 * (attempt + 1))
    }
  }
  return { hourly: new Map(), qh: new Map() }
}

/**
 * Download full date range in chunks, collecting hourly and QH separately
 */
async function downloadRange(startDate, endDate) {
  const allHourly = new Map()
  const allQH = new Map()
  let cursor = new Date(startDate)
  const end = new Date(endDate)
  let chunkNum = 0
  const totalDays = Math.ceil((end - cursor) / 86400000)
  const totalChunks = Math.ceil(totalDays / CHUNK_DAYS)
  const failedChunks = []

  while (cursor <= end) {
    chunkNum++
    const chunkEnd = new Date(Math.min(cursor.getTime() + (CHUNK_DAYS - 1) * 86400000, end.getTime()))
    const label = `${cursor.toISOString().slice(0, 10)} → ${chunkEnd.toISOString().slice(0, 10)}`

    try {
      const { hourly, qh } = await fetchChunk(cursor, chunkEnd)
      for (const [ts, val] of hourly) allHourly.set(ts, val)
      for (const [ts, val] of qh) allQH.set(ts, val)
      const total = hourly.size + qh.size
      if (total === 0) failedChunks.push({ start: new Date(cursor), end: new Date(chunkEnd) })
      process.stdout.write(`   [${chunkNum}/${totalChunks}] ${label}: ${hourly.size}h + ${qh.size}qh (totals: ${allHourly.size}h ${allQH.size}qh)\n`)
    } catch (e) {
      console.log(`   ❌ [${chunkNum}/${totalChunks}] ${label}: ${e.message}`)
      failedChunks.push({ start: new Date(cursor), end: new Date(chunkEnd) })
    }

    cursor = addDays(chunkEnd, 1)
    await sleep(600)
  }

  // Retry failed chunks with smaller sub-chunks (5 days)
  if (failedChunks.length > 0) {
    console.log(`\n🔄 Retrying ${failedChunks.length} failed chunk(s) in 5-day pieces...`)
    for (const fc of failedChunks) {
      let sub = new Date(fc.start)
      while (sub <= fc.end) {
        const subEnd = new Date(Math.min(sub.getTime() + 4 * 86400000, fc.end.getTime()))
        const label = `${sub.toISOString().slice(0, 10)} → ${subEnd.toISOString().slice(0, 10)}`
        try {
          const { hourly, qh } = await fetchChunk(sub, subEnd)
          for (const [ts, val] of hourly) allHourly.set(ts, val)
          for (const [ts, val] of qh) allQH.set(ts, val)
          console.log(`   ✅ ${label}: ${hourly.size}h + ${qh.size}qh`)
        } catch (e) {
          console.log(`   ❌ ${label}: ${e.message}`)
        }
        sub = addDays(subEnd, 1)
        await sleep(1000)
      }
    }
  }

  return { hourly: allHourly, qh: allQH }
}

/**
 * Aggregate QH prices to hourly averages
 */
function qhToHourly(qhMap) {
  const hourlyAgg = new Map()
  for (const [ts, price] of qhMap) {
    const hourTs = ts - (ts % 3600000) // round down to hour
    if (!hourlyAgg.has(hourTs)) hourlyAgg.set(hourTs, [])
    hourlyAgg.get(hourTs).push(price)
  }
  const result = new Map()
  for (const [hourTs, vals] of hourlyAgg) {
    result.set(hourTs, Math.round((vals.reduce((s, v) => s + v, 0) / vals.length) * 100) / 100)
  }
  return result
}

async function main() {
  const startYear = 2022
  const startDate = new Date(`${startYear}-01-01T00:00:00Z`)
  const endDate = new Date()
  const tomorrow = addDays(endDate, 1)

  console.log('🇳🇱 NL Price Downloader (ENTSO-E)')
  console.log(`   Range: ${startDate.toISOString().slice(0, 10)} → ${tomorrow.toISOString().slice(0, 10)}`)
  console.log(`   Output: public/data/nl-prices.json, nl-prices-qh.json\n`)

  console.log('📥 Downloading prices...')
  const { hourly: rawHourly, qh: rawQH } = await downloadRange(startDate, tomorrow)
  console.log(`\n   Raw totals: ${rawHourly.size} hourly + ${rawQH.size} QH points`)

  // Build the unified hourly map:
  // 1. Start with native hourly data
  // 2. Fill in hours from QH data (aggregated) where hourly is missing
  const hourlyFromQH = qhToHourly(rawQH)
  const mergedHourly = new Map(rawHourly)
  let qhFilled = 0
  for (const [ts, price] of hourlyFromQH) {
    if (!mergedHourly.has(ts)) {
      mergedHourly.set(ts, price)
      qhFilled++
    }
  }
  console.log(`   Hourly after QH merge: ${mergedHourly.size} (${qhFilled} filled from QH aggregation)`)

  // Build the unified QH map:
  // 1. Start with native QH data
  // 2. Expand hourly ×4 where no QH exists
  const mergedQH = new Map(rawQH)
  let hourlyExpanded = 0
  for (const [ts, price] of rawHourly) {
    for (let m = 0; m < 4; m++) {
      const qhTs = ts + m * 15 * 60 * 1000
      if (!mergedQH.has(qhTs)) {
        mergedQH.set(qhTs, price)
        hourlyExpanded++
      }
    }
  }
  console.log(`   QH after hourly expand: ${mergedQH.size} (${hourlyExpanded} expanded from hourly)`)

  // Sort and build arrays
  const priceArray = Array.from(mergedHourly.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, price]) => ({ t: ts, p: price }))

  const qhArray = Array.from(mergedQH.entries())
    .sort(([a], [b]) => a - b)
    .map(([ts, price]) => ({ t: ts, p: price }))

  // Stats: check coverage
  const byDate = new Map()
  for (const { t } of priceArray) {
    const d = new Date(t)
    const date = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    byDate.set(date, (byDate.get(date) || 0) + 1)
  }
  let short = 0
  for (const [date, count] of byDate) {
    if (count < 23) {
      short++
      console.log(`   ⚠️  ${date}: ${count} hours`)
    }
  }

  // Write files
  const fs = await import('fs')
  const path = await import('path')
  const outDir = path.join(process.cwd(), 'public', 'data')

  const hourlyPath = path.join(outDir, 'nl-prices.json')
  fs.writeFileSync(hourlyPath, JSON.stringify(priceArray))
  const hSize = (fs.statSync(hourlyPath).size / 1024).toFixed(0)
  console.log(`\n💾 Hourly: ${priceArray.length} points (${hSize} KB) → nl-prices.json`)

  const qhPath = path.join(outDir, 'nl-prices-qh.json')
  fs.writeFileSync(qhPath, JSON.stringify(qhArray))
  const qSize = (fs.statSync(qhPath).size / 1024).toFixed(0)
  console.log(`💾 QH: ${qhArray.length} points (${qSize} KB) → nl-prices-qh.json`)

  console.log(`\n📊 ${byDate.size} dates, ${short} with < 23 hours`)
  console.log('✅ Done!')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
