#!/usr/bin/env node
/**
 * Incremental NL price update — fetches only new data since last static file entry.
 * Designed for daily GitHub Actions runs alongside download-smard.mjs.
 *
 * Usage: ENTSOE_API_TOKEN=xxx node scripts/update-nl.mjs
 */

import { readFileSync, writeFileSync, statSync } from 'fs'
import { join } from 'path'

const ENTSOE_BASE = 'https://web-api.tp.entsoe.eu/api'
const NL_DOMAIN = '10YNL----------L'
const MAX_RETRIES = 5
const TOKEN = process.env.ENTSOE_API_TOKEN

if (!TOKEN) {
  console.error('❌ ENTSOE_API_TOKEN not set — skipping NL update')
  process.exit(0) // exit 0 so workflow doesn't fail
}

function fmtDate(d) { return d.toISOString().slice(0, 10).replace(/-/g, '') + '0000' }
function addDays(d, n) { const r = new Date(d); r.setUTCDate(r.getUTCDate() + n); return r }
function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

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
      const ts = periodStart + (parseInt(pm[1]) - 1) * stepMs
      target.set(ts, Math.round(parseFloat(pm[2]) * 100) / 100)
    }
  }
  return { hourly, qh }
}

async function fetchChunk(startDate, endDate) {
  const periodEnd = addDays(endDate, 1)
  const url = `${ENTSOE_BASE}?securityToken=${TOKEN}&documentType=A44&in_Domain=${NL_DOMAIN}&out_Domain=${NL_DOMAIN}&periodStart=${fmtDate(startDate)}&periodEnd=${fmtDate(periodEnd)}`

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      const res = await fetch(url)
      if (res.status === 503) {
        console.log(`   ⚠️  503 (attempt ${attempt + 1}), retrying...`)
        await sleep(2000 * (attempt + 1))
        continue
      }
      if (res.status === 400) return { hourly: new Map(), qh: new Map() }
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
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

async function main() {
  const outDir = join(process.cwd(), 'public', 'data')
  const hourlyPath = join(outDir, 'nl-prices.json')
  const qhPath = join(outDir, 'nl-prices-qh.json')

  // Load existing data
  let existing, existingQH
  try {
    existing = JSON.parse(readFileSync(hourlyPath, 'utf8'))
    existingQH = JSON.parse(readFileSync(qhPath, 'utf8'))
  } catch {
    console.error('❌ Cannot read existing NL files — run download-nl.mjs first')
    process.exit(1)
  }

  // Build maps from existing data
  const hourlyMap = new Map()
  for (const p of existing) hourlyMap.set(p.t, p.p)
  const qhMap = new Map()
  for (const p of existingQH) qhMap.set(p.t, p.p)

  // Find last timestamp and fetch from there
  const lastTs = existing[existing.length - 1].t
  const lastDate = new Date(lastTs)
  const tomorrow = addDays(new Date(), 1)

  // Start from 2 days before last entry (overlap to catch any late ENTSO-E updates)
  const fetchStart = addDays(lastDate, -2)

  console.log(`🇳🇱 NL Incremental Update`)
  console.log(`   Existing: ${hourlyMap.size} hourly, ${qhMap.size} QH`)
  console.log(`   Last entry: ${lastDate.toISOString().slice(0, 10)}`)
  console.log(`   Fetching: ${fetchStart.toISOString().slice(0, 10)} → ${tomorrow.toISOString().slice(0, 10)}`)

  const { hourly: newHourly, qh: newQH } = await fetchChunk(fetchStart, tomorrow)

  // Merge hourly
  let hAdded = 0
  for (const [ts, price] of newHourly) {
    if (!hourlyMap.has(ts)) { hourlyMap.set(ts, price); hAdded++ }
  }
  // Aggregate QH to hourly where needed
  const qhByHour = new Map()
  for (const [ts, price] of newQH) {
    const hourTs = ts - (ts % 3600000)
    if (!qhByHour.has(hourTs)) qhByHour.set(hourTs, [])
    qhByHour.get(hourTs).push(price)
  }
  for (const [hourTs, prices] of qhByHour) {
    if (!hourlyMap.has(hourTs)) {
      hourlyMap.set(hourTs, Math.round((prices.reduce((s, v) => s + v, 0) / prices.length) * 100) / 100)
      hAdded++
    }
  }

  // Merge QH
  let qAdded = 0
  for (const [ts, price] of newQH) {
    if (!qhMap.has(ts)) { qhMap.set(ts, price); qAdded++ }
  }
  // Expand hourly to QH where no native QH exists
  for (const [ts, price] of newHourly) {
    for (let m = 0; m < 4; m++) {
      const qhTs = ts + m * 15 * 60 * 1000
      if (!qhMap.has(qhTs)) { qhMap.set(qhTs, price); qAdded++ }
    }
  }

  if (hAdded === 0 && qAdded === 0) {
    console.log('   ℹ️  No new data — NL files are up to date')
    return
  }

  // Write updated files
  const priceArray = Array.from(hourlyMap.entries()).sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p }))
  const qhArray = Array.from(qhMap.entries()).sort(([a], [b]) => a - b).map(([t, p]) => ({ t, p }))

  writeFileSync(hourlyPath, JSON.stringify(priceArray))
  writeFileSync(qhPath, JSON.stringify(qhArray))

  const hSize = (statSync(hourlyPath).size / 1024).toFixed(0)
  const qSize = (statSync(qhPath).size / 1024).toFixed(0)

  console.log(`   +${hAdded} hourly, +${qAdded} QH`)
  console.log(`   💾 nl-prices.json: ${priceArray.length} pts (${hSize} KB)`)
  console.log(`   💾 nl-prices-qh.json: ${qhArray.length} pts (${qSize} KB)`)
  console.log('   ✅ Done!')
}

main().catch(e => { console.error('❌ NL update error:', e.message); process.exit(1) })
