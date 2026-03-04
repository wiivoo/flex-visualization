#!/usr/bin/env node
/**
 * Reads CSVs/spot_price_*.csv files and generates public/data/projected-prices.json
 * in compact format [{t, p}, ...] — only dates AFTER the last real SMARD data point.
 */
import { readFileSync, writeFileSync } from 'fs'
import { join, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = join(__dirname, '..')

// Determine the last real data timestamp from smard-prices.json
const smardPath = join(ROOT, 'public/data/smard-prices.json')
const smardData = JSON.parse(readFileSync(smardPath, 'utf-8'))
const lastRealTs = smardData[smardData.length - 1].t
const lastRealDate = new Date(lastRealTs)
console.log(`Last real SMARD data: ${lastRealDate.toISOString()} (${lastRealTs})`)

// Parse CSV files for years 2026-2030
const years = [2026, 2027, 2028, 2029, 2030]
const projected = []

for (const year of years) {
  const csvPath = join(ROOT, 'CSVs', `spot_price_${year}.csv`)
  let content
  try {
    content = readFileSync(csvPath, 'utf-8')
  } catch {
    console.warn(`  Skipping ${year}: file not found`)
    continue
  }

  // Remove BOM if present
  if (content.charCodeAt(0) === 0xFEFF) content = content.slice(1)

  const lines = content.trim().split('\n')
  const header = lines[0].toLowerCase()
  const tsIdx = header.split(',').findIndex(h => h.includes('timestamp'))
  const priceIdx = header.split(',').findIndex(h => h.includes('price'))

  let count = 0
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(',')
    if (cols.length < 2) continue

    const tsStr = cols[tsIdx].trim()
    const price = parseFloat(cols[priceIdx].trim())
    if (isNaN(price)) continue

    // Parse "2026-01-01 00:00" as local time
    const d = new Date(tsStr.replace(' ', 'T') + ':00')
    const ts = d.getTime()

    // Only include dates AFTER last real data
    if (ts <= lastRealTs) continue

    projected.push({ t: ts, p: Math.round(price * 100) / 100 })
    count++
  }
  console.log(`  ${year}: ${count} projected price points`)
}

// Sort by timestamp and write
projected.sort((a, b) => a.t - b.t)

const outPath = join(ROOT, 'public/data/projected-prices.json')
writeFileSync(outPath, JSON.stringify(projected))

const sizeMB = (Buffer.byteLength(JSON.stringify(projected)) / 1024 / 1024).toFixed(2)
console.log(`\nWritten ${projected.length} projected prices to ${outPath} (${sizeMB} MB)`)
console.log(`Date range: ${new Date(projected[0]?.t).toISOString()} → ${new Date(projected[projected.length - 1]?.t).toISOString()}`)
