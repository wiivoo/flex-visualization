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
    source: 'smard.de',
  }
  fs.writeFileSync(path.join(outDir, 'smard-meta.json'), JSON.stringify(meta, null, 2))

  console.log(`\n✅ Done! Total: ${priceArray.length} hourly + ${priceQHArray.length} QH prices + ${genArray.length} generation points`)
  console.log('   Run this script periodically to update with latest data.')
}

main().catch(e => { console.error('❌ Error:', e); process.exit(1) })
