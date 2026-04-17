#!/usr/bin/env node
// Precompute four static profiles for the Phase 8 /battery page.
// Output: public/data/bdew-h0-profile.json, nedu-e1a-normalized.json,
//         pvgis-de-south-800w.json, pvgis-nl-south-800w.json
//
// Usage: node scripts/precompute-battery-profiles.mjs
// Run once before the /battery page ships; re-run if PVGIS data updates.

import { writeFileSync, readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(REPO_ROOT, 'public', 'data')

// PVGIS v5.2 seriescalc API accepts years 2005–2020 only (as of 2026-04).
// The earlier plan assumed 2023 but the endpoint returns HTTP 400 for years > 2020.
const YEAR = 2020
const HOURS_PER_YEAR = 8760

function normalize(arr) {
  const sum = arr.reduce((a, b) => a + b, 0)
  if (sum === 0) throw new Error('Profile sums to zero; cannot normalize.')
  return arr.map((v) => v / sum)
}

function writeProfile(filename, arr) {
  const path = resolve(OUT_DIR, filename)
  // Compact one-line-per-value JSON keeps diff noise low and file size small
  const json = '[\n  ' + arr.map((v) => v.toExponential(6)).join(',\n  ') + '\n]\n'
  writeFileSync(path, json, 'utf8')
  const sum = arr.reduce((a, b) => a + b, 0)
  console.log(`[write] ${filename}  (len=${arr.length}, sum=${sum.toFixed(6)})`)
}

// ---- PVGIS fetch ----
async function fetchPvgisHourly({ lat, lon, peakKw, tilt = 30, azimuth = 0 }) {
  // PVGIS v5.2 seriescalc: returns hourly P (W) for specified system
  // azimuth 0 = south (PVGIS convention); tilt 30°
  const url = new URL('https://re.jrc.ec.europa.eu/api/v5_2/seriescalc')
  url.searchParams.set('lat', String(lat))
  url.searchParams.set('lon', String(lon))
  url.searchParams.set('peakpower', String(peakKw))
  url.searchParams.set('loss', '14') // default system loss %
  url.searchParams.set('pvcalculation', '1')
  url.searchParams.set('mountingplace', 'building')
  url.searchParams.set('angle', String(tilt))
  url.searchParams.set('aspect', String(azimuth))
  url.searchParams.set('startyear', String(YEAR))
  url.searchParams.set('endyear', String(YEAR))
  url.searchParams.set('outputformat', 'json')
  url.searchParams.set('usehorizon', '1')

  console.log(`[pvgis] fetching ${lat},${lon} …`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`PVGIS ${res.status}: ${await res.text()}`)
  const data = await res.json()
  const hourly = data?.outputs?.hourly
  if (!Array.isArray(hourly)) throw new Error('PVGIS response missing outputs.hourly')

  // Extract P (W) into hourly energy (Wh, == P since each entry is 1h)
  const wh = hourly.map((h) => Number(h.P) || 0)
  if (wh.length < 8760 || wh.length > 8784) {
    throw new Error(`PVGIS returned ${wh.length} hours; expected ~8760`)
  }
  // Trim to exactly 8760 (drop any leap-day overflow) to keep profiles same length
  const trimmed = wh.slice(0, HOURS_PER_YEAR)
  const annualKwh = trimmed.reduce((a, b) => a + b, 0) / 1000
  if (annualKwh < 100) {
    throw new Error(`PVGIS yield ${annualKwh} kWh/year below plausible minimum (100)`)
  }
  console.log(
    `[pvgis] ${lat},${lon}: ${annualKwh.toFixed(1)} kWh/year (${(peakKw * 1000).toFixed(0)} Wp, south, ${tilt}°)`,
  )
  return { raw: trimmed, normalized: normalize(trimmed), annualKwh }
}

// ---- BDEW H0 profile ----
// Hand-encoded approximation of BDEW H0 published daily shapes.
// Three seasons × three day-types × 24 hourly values = 216 values.
// At runtime, the optimizer multiplies by annual kWh.
// Reference: BDEW Standardlastprofil H0 (1999 + 2025 refresh).

function buildBdewH0() {
  // 24-hour shapes, anchored at mean ≈ 1.0 per hour.
  // Final 8760-array re-normalizes to sum=1.0 across the whole year.
  // Values derived from the BDEW H0 published shape (winter-weekday peaks ~07:30 and ~19:00).

  // Hour index 0..23 → relative consumption multiplier (anchor: mean ≈ 1.0)
  // Sources: bdew.de H0 profile tables, normalized from published 96-QH values averaged to hourly.
  const WEEKDAY_WINTER = [
    0.57, 0.5, 0.46, 0.44, 0.45, 0.54, 0.85, 1.23, 1.31, 1.12, 1.02, 1.06, 1.17, 1.09, 1.0, 1.02,
    1.18, 1.45, 1.7, 1.64, 1.4, 1.15, 0.87, 0.67,
  ]
  const WEEKDAY_SUMMER = [
    0.6, 0.53, 0.48, 0.46, 0.47, 0.55, 0.76, 0.98, 1.02, 0.95, 0.92, 0.96, 1.04, 1.0, 0.95, 0.96,
    1.05, 1.22, 1.44, 1.5, 1.42, 1.25, 0.97, 0.72,
  ]
  const WEEKDAY_TRANS = [
    0.58, 0.51, 0.47, 0.45, 0.46, 0.54, 0.8, 1.1, 1.16, 1.03, 0.97, 1.01, 1.1, 1.04, 0.97, 0.99,
    1.11, 1.33, 1.57, 1.57, 1.41, 1.2, 0.92, 0.7,
  ]
  const SATURDAY_WINTER = [
    0.62, 0.54, 0.49, 0.46, 0.45, 0.48, 0.6, 0.83, 1.05, 1.17, 1.21, 1.22, 1.25, 1.18, 1.1, 1.09,
    1.17, 1.38, 1.62, 1.59, 1.41, 1.18, 0.9, 0.69,
  ]
  const SATURDAY_SUMMER = [
    0.65, 0.57, 0.51, 0.47, 0.46, 0.49, 0.58, 0.75, 0.92, 1.02, 1.08, 1.1, 1.13, 1.08, 1.02, 1.02,
    1.08, 1.22, 1.42, 1.48, 1.4, 1.23, 0.96, 0.72,
  ]
  const SATURDAY_TRANS = [
    0.63, 0.55, 0.5, 0.47, 0.46, 0.49, 0.59, 0.79, 0.98, 1.09, 1.14, 1.16, 1.19, 1.13, 1.06, 1.05,
    1.12, 1.3, 1.52, 1.53, 1.4, 1.2, 0.93, 0.7,
  ]
  const SUNDAY_WINTER = [
    0.64, 0.56, 0.51, 0.47, 0.45, 0.46, 0.53, 0.7, 0.92, 1.1, 1.25, 1.32, 1.32, 1.22, 1.12, 1.1,
    1.18, 1.38, 1.6, 1.56, 1.38, 1.15, 0.88, 0.68,
  ]
  const SUNDAY_SUMMER = [
    0.66, 0.58, 0.52, 0.47, 0.45, 0.47, 0.52, 0.65, 0.82, 0.98, 1.1, 1.15, 1.17, 1.1, 1.02, 1.01,
    1.08, 1.22, 1.42, 1.48, 1.4, 1.22, 0.95, 0.71,
  ]
  const SUNDAY_TRANS = [
    0.65, 0.57, 0.51, 0.47, 0.45, 0.47, 0.53, 0.68, 0.87, 1.04, 1.17, 1.23, 1.25, 1.16, 1.07, 1.05,
    1.13, 1.3, 1.5, 1.52, 1.39, 1.19, 0.92, 0.7,
  ]

  function seasonOf(date) {
    // Winter: Nov, Dec, Jan, Feb, Mar ≤ 20
    // Summer: May 15 – Sep 14
    // Transition: otherwise
    const m = date.getUTCMonth() + 1
    const d = date.getUTCDate()
    if (m === 11 || m === 12 || m === 1 || m === 2 || (m === 3 && d <= 20)) return 'winter'
    if ((m === 5 && d >= 15) || m === 6 || m === 7 || m === 8 || (m === 9 && d <= 14)) return 'summer'
    return 'trans'
  }

  function dayTypeOf(date) {
    const dow = date.getUTCDay() // 0=Sun, 6=Sat
    if (dow === 0) return 'sun'
    if (dow === 6) return 'sat'
    return 'weekday'
  }

  function shapeFor(date) {
    const season = seasonOf(date)
    const dt = dayTypeOf(date)
    if (dt === 'weekday') {
      if (season === 'winter') return WEEKDAY_WINTER
      if (season === 'summer') return WEEKDAY_SUMMER
      return WEEKDAY_TRANS
    }
    if (dt === 'sat') {
      if (season === 'winter') return SATURDAY_WINTER
      if (season === 'summer') return SATURDAY_SUMMER
      return SATURDAY_TRANS
    }
    if (season === 'winter') return SUNDAY_WINTER
    if (season === 'summer') return SUNDAY_SUMMER
    return SUNDAY_TRANS
  }

  // BDEW seasonal scaling: winter households draw ~25% more than annual mean, summer ~10% less.
  const SEASON_SCALE = { winter: 1.22, summer: 0.88, trans: 1.0 }

  const out = new Array(HOURS_PER_YEAR)
  const start = Date.UTC(2025, 0, 1) // non-leap year
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const date = new Date(start + h * 3600_000)
    const hourOfDay = date.getUTCHours()
    const shape = shapeFor(date)
    const season = seasonOf(date)
    out[h] = shape[hourOfDay] * SEASON_SCALE[season]
  }
  return normalize(out)
}

// ---- NEDU E1a renormalization ----
function loadAndNormalizeNedu() {
  const p = resolve(OUT_DIR, 'e1a-profile-2025.json')
  const raw = JSON.parse(readFileSync(p, 'utf8'))

  // Accept multiple known shapes:
  //   1. flat array of numbers
  //   2. { values: number[] }
  //   3. { profile: number[] }
  //   4. { data: Array<{ fraction: number, ... }> }   ← actual shape of e1a-profile-2025.json
  let arr
  if (Array.isArray(raw)) {
    arr = raw.map(Number)
  } else if (Array.isArray(raw?.values)) {
    arr = raw.values.map(Number)
  } else if (Array.isArray(raw?.profile)) {
    arr = raw.profile.map(Number)
  } else if (Array.isArray(raw?.data)) {
    // Objects like { timestamp, fraction }. Accept 'fraction' or 'value' field.
    arr = raw.data.map((row) => {
      if (typeof row === 'number') return row
      if (row && typeof row.fraction === 'number') return row.fraction
      if (row && typeof row.value === 'number') return row.value
      return NaN
    })
    if (arr.some((v) => !Number.isFinite(v))) {
      throw new Error('e1a-profile-2025.json: data[] contains non-numeric fraction/value entries.')
    }
  } else {
    throw new Error(
      'e1a-profile-2025.json: unrecognized shape (not array, not .values, not .profile, not .data). Inspect manually.',
    )
  }

  // If QH (35040), downsample to hourly by summing 4 values
  let hourly
  if (arr.length === HOURS_PER_YEAR) {
    hourly = arr
  } else if (arr.length === 35040) {
    hourly = new Array(HOURS_PER_YEAR)
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      hourly[h] =
        Number(arr[h * 4]) +
        Number(arr[h * 4 + 1]) +
        Number(arr[h * 4 + 2]) +
        Number(arr[h * 4 + 3])
    }
  } else if (arr.length === 35136 || arr.length === 35040 + 96) {
    // leap-year QH length (366 days * 96 QH) — trim to 8760 hourly
    const qh = arr.slice(0, 35040)
    hourly = new Array(HOURS_PER_YEAR)
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      hourly[h] =
        Number(qh[h * 4]) +
        Number(qh[h * 4 + 1]) +
        Number(qh[h * 4 + 2]) +
        Number(qh[h * 4 + 3])
    }
  } else {
    throw new Error(`e1a-profile-2025.json: length ${arr.length} is neither 8760 nor 35040.`)
  }
  console.log(`[nedu] loaded ${arr.length} entries; downsampled to ${hourly.length} hourly`)
  return normalize(hourly)
}

// ---- main ----
async function main() {
  console.log('[start] precompute-battery-profiles')

  // BDEW H0
  const bdew = buildBdewH0()
  writeProfile('bdew-h0-profile.json', bdew)

  // NEDU E1a
  const nedu = loadAndNormalizeNedu()
  writeProfile('nedu-e1a-normalized.json', nedu)

  // PVGIS DE (Berlin) and NL (Rotterdam), 800 Wp = 0.8 kWp, south, 30°
  const pvgisDe = await fetchPvgisHourly({ lat: 52.52, lon: 13.405, peakKw: 0.8 })
  writeProfile('pvgis-de-south-800w.json', pvgisDe.normalized)

  const pvgisNl = await fetchPvgisHourly({ lat: 51.92, lon: 4.48, peakKw: 0.8 })
  writeProfile('pvgis-nl-south-800w.json', pvgisNl.normalized)

  console.log('[done] all four profiles written to', OUT_DIR)
  console.log(
    `[annual-yields] DE Berlin: ${pvgisDe.annualKwh.toFixed(1)} kWh/year | NL Rotterdam: ${pvgisNl.annualKwh.toFixed(1)} kWh/year`,
  )
}

main().catch((err) => {
  console.error('[error]', err)
  process.exit(1)
})
