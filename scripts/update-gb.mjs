#!/usr/bin/env node
/**
 * Incremental UK (GB) price update — fetches Elexon BMRS MID data and writes
 * public/data/gb-prices.json + public/data/gb-prices-qh.json.
 *
 * Prices are in GBp/kWh (pence per kWh). The static file format mirrors the
 * NL files ({ t: epochMs, p: price }) so the v2 pipeline can consume them.
 *
 * Usage: node scripts/update-gb.mjs
 */

import { readFileSync, writeFileSync, statSync, existsSync } from 'fs'
import { join } from 'path'

const ELEXON_BASE = 'https://data.elexon.co.uk/bmrs/api/v1'
const MAX_RETRIES = 5

function addDays(d, n) { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }
function fmtDay(d) { return d.toISOString().slice(0, 10) }

async function fetchChunk(startDate, endDate) {
  const from = fmtDay(startDate)
  const to = fmtDay(addDays(endDate, 1))
  const url = `${ELEXON_BASE}/datasets/MID?from=${from}&to=${to}&format=json`
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 429 || res.status === 503) {
        console.log(`   ⚠️  ${res.status} (attempt ${attempt + 1}), retrying...`)
        await sleep(2000 * (attempt + 1))
        continue
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const body = await res.json()
      return body.data || []
    } catch (e) {
      if (attempt === MAX_RETRIES - 1) throw e
      await sleep(2000 * (attempt + 1))
    }
  }
  return []
}

/**
 * Aggregate per-provider points into a single reference price per 30-min slot.
 * Volume-weighted mean when both providers have published, otherwise the
 * non-zero provider (typically APXMIDP when N2EXMIDP lags).
 */
function aggregate(points) {
  const byTs = new Map()
  for (const p of points) {
    if (!byTs.has(p.startTime)) byTs.set(p.startTime, [])
    byTs.get(p.startTime).push(p)
  }
  const result = new Map() // epochMs -> GBp/kWh
  for (const [ts, providers] of byTs) {
    const nonZero = providers.filter(p => p.volume > 0 && Number.isFinite(p.price))
    let priceGbpMwh = null
    if (nonZero.length === providers.length && providers.length > 1) {
      const totalVol = providers.reduce((s, p) => s + p.volume, 0)
      const weightedSum = providers.reduce((s, p) => s + p.price * p.volume, 0)
      priceGbpMwh = totalVol > 0 ? weightedSum / totalVol : null
    } else if (nonZero.length > 0) {
      priceGbpMwh = nonZero[0].price
    }
    if (priceGbpMwh === null) continue
    result.set(new Date(ts).getTime(), Math.round(priceGbpMwh * 10) / 100)
  }
  return result
}

async function main() {
  const outDir = join(process.cwd(), 'public', 'data')
  const hourlyPath = join(outDir, 'gb-prices.json')
  const qhPath = join(outDir, 'gb-prices-qh.json')

  // Load existing (or start empty)
  let existing = []
  let existingQH = []
  try {
    if (existsSync(hourlyPath)) existing = JSON.parse(readFileSync(hourlyPath, 'utf8'))
    if (existsSync(qhPath)) existingQH = JSON.parse(readFileSync(qhPath, 'utf8'))
  } catch { /* treat as empty */ }

  const hourlyMap = new Map()
  for (const p of existing) hourlyMap.set(p.t, p.p)
  const qhMap = new Map()
  for (const p of existingQH) qhMap.set(p.t, p.p)

  const tomorrow = addDays(new Date(), 1)
  const fetchStart = existing.length > 0
    ? addDays(new Date(existing[existing.length - 1].t), -2)
    : new Date('2022-01-01T00:00:00Z') // first full year of half-hourly MID

  console.log(`🇬🇧 GB Incremental Update`)
  console.log(`   Existing: ${hourlyMap.size} hourly, ${qhMap.size} QH`)
  console.log(`   Fetching: ${fmtDay(fetchStart)} → ${fmtDay(tomorrow)}`)

  // Chunk into 7-day pieces (Elexon MID dataset caps at 7 days per request)
  const CHUNK_DAYS = 7
  const allPoints = []
  let cursor = new Date(fetchStart)
  let chunkIdx = 0
  while (cursor <= tomorrow) {
    const chunkEnd = new Date(Math.min(cursor.getTime() + (CHUNK_DAYS - 1) * 86400000, tomorrow.getTime()))
    const pts = await fetchChunk(cursor, chunkEnd)
    allPoints.push(...pts)
    cursor = addDays(chunkEnd, 1)
    chunkIdx++
    // Modest pacing to stay friendly to Elexon
    if (cursor <= tomorrow) await sleep(200)
  }
  console.log(`   Pulled ${chunkIdx} chunks, ${allPoints.length} raw points`)

  // Half-hourly aggregated reference
  const hh = aggregate(allPoints)
  let hhAdded = 0
  for (const [ts, price] of hh) {
    if (!qhMap.has(ts)) { qhMap.set(ts, price); hhAdded++ }
    // Also populate the HH+15 slot with the same price so 15-min consumers get values
    const ts15 = ts + 15 * 60 * 1000
    if (!qhMap.has(ts15)) { qhMap.set(ts15, price); hhAdded++ }
  }

  // Hourly aggregation — mean of the two half-hours within each hour
  const byHour = new Map()
  for (const [ts, price] of hh) {
    const hourTs = ts - (ts % 3600000)
    if (!byHour.has(hourTs)) byHour.set(hourTs, [])
    byHour.get(hourTs).push(price)
  }
  let hAdded = 0
  for (const [hourTs, prices] of byHour) {
    if (!hourlyMap.has(hourTs)) {
      hourlyMap.set(hourTs, Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100)
      hAdded++
    }
  }

  if (hhAdded === 0 && hAdded === 0) {
    console.log('   ℹ️  No new data — GB files are up to date')
    return
  }

  const priceArray = Array.from(hourlyMap.entries()).sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p }))
  const qhArray = Array.from(qhMap.entries()).sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p }))

  writeFileSync(hourlyPath, JSON.stringify(priceArray))
  writeFileSync(qhPath, JSON.stringify(qhArray))

  const hSize = (statSync(hourlyPath).size / 1024).toFixed(0)
  const qSize = (statSync(qhPath).size / 1024).toFixed(0)

  console.log(`   +${hAdded} hourly, +${hhAdded} QH`)
  console.log(`   💾 gb-prices.json: ${priceArray.length} pts (${hSize} KB)`)
  console.log(`   💾 gb-prices-qh.json: ${qhArray.length} pts (${qSize} KB)`)
  console.log('   ✅ Done!')
}

main().catch(e => { console.error('❌ GB update error:', e.message); process.exit(1) })
