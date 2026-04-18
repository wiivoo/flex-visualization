#!/usr/bin/env node
/**
 * Precompute monthly aggregates for the Management Dashboard (PROJ-40).
 *
 * Reads  : public/data/smard-prices-qh.json  (array of { t: <ms>, p: <EUR/MWh> })
 * Writes : public/data/management-monthly.json (schemaVersion 1)
 *
 * Runs offline in GitHub Actions right after the SMARD fetch step. Pure
 * transformation, no network calls.
 *
 * @keep-in-sync-with src/lib/management-helpers.ts
 *   The math below is a plain-JS mirror of the TS helpers. If you change
 *   aggregation, energy-per-session, or reconciliation there, update here
 *   and vice versa so both the CI precompute and the runtime UI agree.
 */

import fs from 'node:fs'
import path from 'node:path'
import process from 'node:process'

// ── Fixed scenario (mirror of DEFAULT_MANAGEMENT_SCENARIO in management-config.ts) ──
const DEFAULT_SCENARIO = {
  batteryCapacityKwh: 60,
  chargePowerKw: 7,
  plugInTime: '18:00',
  departureTime: '06:00',
  sessionsPerWeek: 4,
}

const QH_PER_DAY = 96

// ── Pure math (mirror of src/lib/management-helpers.ts) ──
function hhmmToQhIndex(hhmm) {
  if (typeof hhmm !== 'string') throw new Error(`Invalid HH:MM: ${String(hhmm)}`)
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim())
  if (!m) throw new Error(`Invalid HH:MM: ${hhmm}`)
  const h = Number(m[1])
  const mm = Number(m[2])
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) {
    throw new Error(`Invalid HH:MM: ${hhmm}`)
  }
  return (h * 4) + Math.floor(mm / 15)
}

function windowQhCount(startQh, endQh) {
  if (endQh >= startQh) return endQh - startQh + 1
  return (QH_PER_DAY - startQh) + (endQh + 1)
}

function qhInWindow(qhIndex, startQh, endQh) {
  if (endQh >= startQh) return qhIndex >= startQh && qhIndex <= endQh
  return qhIndex >= startQh || qhIndex <= endQh
}

function chargingWindowQh(scenario) {
  const startQh = hhmmToQhIndex(scenario.plugInTime)
  const departureQh = hhmmToQhIndex(scenario.departureTime)
  const endQh = (departureQh - 1 + QH_PER_DAY) % QH_PER_DAY
  return { startQh, endQh }
}

function energyPerSession(scenario) {
  const { startQh, endQh } = chargingWindowQh(scenario)
  const slots = windowQhCount(startQh, endQh)
  const windowHours = slots * 0.25
  return Math.min(scenario.batteryCapacityKwh, scenario.chargePowerKw * windowHours)
}

function baselineWindowQh(scenario) {
  const startQh = hhmmToQhIndex(scenario.plugInTime)
  const energyKwh = energyPerSession(scenario)
  const kwhPerQh = scenario.chargePowerKw * 0.25
  const slotsNeeded = kwhPerQh > 0 ? Math.max(1, Math.ceil(energyKwh / kwhPerQh)) : 1
  const endQh = (startQh + slotsNeeded - 1) % QH_PER_DAY
  return { startQh, endQh }
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

function round2(n) { return Math.round(n * 100) / 100 }
function round1(n) { return Math.round(n * 10) / 10 }

function reconcile(spreadCtKwh, energyPerSessionKwh, sessionsInMonth) {
  if (!Number.isFinite(spreadCtKwh) || !Number.isFinite(energyPerSessionKwh) || !Number.isFinite(sessionsInMonth)) return 0
  return (spreadCtKwh / 100) * energyPerSessionKwh * sessionsInMonth
}

function groupByMonth(qhPrices) {
  const months = new Map()
  for (const point of qhPrices) {
    const d = new Date(point.ts)
    if (Number.isNaN(d.getTime())) continue
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    const day = d.getUTCDate()
    const hour = d.getUTCHours()
    const minute = d.getUTCMinutes()
    const qhIndex = (hour * 4) + Math.floor(minute / 15)
    const monthKey = `${year}-${String(month).padStart(2, '0')}`
    const dateKey = `${monthKey}-${String(day).padStart(2, '0')}`

    let mb = months.get(monthKey)
    if (!mb) {
      mb = { year, month, monthKey, days: new Map(), allPricesCtKwh: [] }
      months.set(monthKey, mb)
    }
    let db = mb.days.get(dateKey)
    if (!db) {
      db = { monthKey, year, month, dayOfMonth: day, qhByIndex: new Map() }
      mb.days.set(dateKey, db)
    }
    const ctKwh = point.price / 10
    db.qhByIndex.set(qhIndex, ctKwh)
    mb.allPricesCtKwh.push(ctKwh)
  }
  return months
}

function aggregateMonthly(qhPrices, scenario) {
  if (!qhPrices || qhPrices.length === 0) return []
  const { startQh, endQh } = chargingWindowQh(scenario)
  const energyKwh = energyPerSession(scenario)
  const months = groupByMonth(qhPrices)

  const out = []
  for (const mb of months.values()) {
    const dayCount = daysInMonth(mb.year, mb.month)
    const sessionsInMonth = round1(scenario.sessionsPerWeek * (dayCount / 7))

    let spreadSum = 0
    let spreadDays = 0
    for (const db of mb.days.values()) {
      let min = Number.POSITIVE_INFINITY
      let max = Number.NEGATIVE_INFINITY
      let count = 0
      for (const [qh, ctKwh] of db.qhByIndex) {
        if (!qhInWindow(qh, startQh, endQh)) continue
        if (ctKwh < min) min = ctKwh
        if (ctKwh > max) max = ctKwh
        count++
      }
      if (count >= 2) {
        spreadSum += (max - min)
        spreadDays++
      }
    }
    const avgSpreadCtKwh = spreadDays > 0 ? spreadSum / spreadDays : 0
    const avgDayAheadCtKwh = mb.allPricesCtKwh.length > 0
      ? mb.allPricesCtKwh.reduce((s, v) => s + v, 0) / mb.allPricesCtKwh.length
      : 0

    const savingsEur = reconcile(avgSpreadCtKwh, energyKwh, sessionsInMonth)

    out.push({
      year: mb.year,
      month: mb.month,
      monthKey: mb.monthKey,
      avgSpreadCtKwh: round2(avgSpreadCtKwh),
      energyPerSessionKwh: round2(energyKwh),
      sessionsInMonth,
      savingsEur: round2(savingsEur),
      avgDayAheadCtKwh: round2(avgDayAheadCtKwh),
    })
  }
  out.sort((a, b) => (a.monthKey < b.monthKey ? -1 : a.monthKey > b.monthKey ? 1 : 0))
  return out
}

function computeExplainer(qhPrices, monthKey, scenario) {
  const chargingWindow = chargingWindowQh(scenario)
  const baselineWindow = baselineWindowQh(scenario)
  const energyKwh = energyPerSession(scenario)

  if (!qhPrices || qhPrices.length === 0 || !monthKey) {
    return {
      monthKey: monthKey || '',
      avgQhProfile: [],
      chargingWindow,
      baselineWindow,
      spreadCtKwh: 0,
      energyPerSessionKwh: round2(energyKwh),
      sessionsInMonth: 0,
      reconciledSavingsEur: 0,
    }
  }

  const monthPrices = qhPrices.filter((p) => {
    const d = new Date(p.ts)
    if (Number.isNaN(d.getTime())) return false
    const y = d.getUTCFullYear()
    const m = d.getUTCMonth() + 1
    return `${y}-${String(m).padStart(2, '0')}` === monthKey
  })

  if (monthPrices.length === 0) {
    return {
      monthKey,
      avgQhProfile: [],
      chargingWindow,
      baselineWindow,
      spreadCtKwh: 0,
      energyPerSessionKwh: round2(energyKwh),
      sessionsInMonth: 0,
      reconciledSavingsEur: 0,
    }
  }

  const sums = new Array(QH_PER_DAY).fill(0)
  const counts = new Array(QH_PER_DAY).fill(0)
  for (const p of monthPrices) {
    const d = new Date(p.ts)
    const hour = d.getUTCHours()
    const minute = d.getUTCMinutes()
    const qh = (hour * 4) + Math.floor(minute / 15)
    sums[qh] += p.price / 10
    counts[qh] += 1
  }

  const avgQhProfile = []
  for (let qh = 0; qh < QH_PER_DAY; qh++) {
    const ctKwh = counts[qh] > 0 ? round2(sums[qh] / counts[qh]) : 0
    avgQhProfile.push({ qhIndex: qh, ctKwh })
  }

  let profileMin = Number.POSITIVE_INFINITY
  let profileMax = Number.NEGATIVE_INFINITY
  for (let qh = 0; qh < QH_PER_DAY; qh++) {
    if (!qhInWindow(qh, chargingWindow.startQh, chargingWindow.endQh)) continue
    if (counts[qh] === 0) continue
    const v = sums[qh] / counts[qh]
    if (v < profileMin) profileMin = v
    if (v > profileMax) profileMax = v
  }
  const spreadCtKwh = (Number.isFinite(profileMin) && Number.isFinite(profileMax))
    ? profileMax - profileMin
    : 0

  const [yearStr, monthStr] = monthKey.split('-')
  const year = Number(yearStr)
  const month = Number(monthStr)
  const dayCount = (Number.isFinite(year) && Number.isFinite(month))
    ? daysInMonth(year, month)
    : 0
  const sessionsInMonth = round1(scenario.sessionsPerWeek * (dayCount / 7))
  const reconciledSavingsEur = reconcile(spreadCtKwh, energyKwh, sessionsInMonth)

  return {
    monthKey,
    avgQhProfile,
    chargingWindow,
    baselineWindow,
    spreadCtKwh: round2(spreadCtKwh),
    energyPerSessionKwh: round2(energyKwh),
    sessionsInMonth,
    reconciledSavingsEur: round2(reconciledSavingsEur),
  }
}

// ── Script flow ──
function latestCompleteMonthKey(nowUtc = new Date()) {
  // Previous calendar month relative to UTC "today".
  const y = nowUtc.getUTCFullYear()
  const m = nowUtc.getUTCMonth() + 1 // 1..12
  const prevYear = m === 1 ? y - 1 : y
  const prevMonth = m === 1 ? 12 : m - 1
  return `${prevYear}-${String(prevMonth).padStart(2, '0')}`
}

function emptyExplainer(scenario) {
  const chargingWindow = chargingWindowQh(scenario)
  const baselineWindow = baselineWindowQh(scenario)
  return {
    monthKey: '',
    avgQhProfile: [],
    chargingWindow,
    baselineWindow,
    spreadCtKwh: 0,
    energyPerSessionKwh: round2(energyPerSession(scenario)),
    sessionsInMonth: 0,
    reconciledSavingsEur: 0,
  }
}

async function main() {
  const repoRoot = process.cwd()
  const inPath = path.join(repoRoot, 'public', 'data', 'smard-prices-qh.json')
  const outPath = path.join(repoRoot, 'public', 'data', 'management-monthly.json')
  const scenario = { ...DEFAULT_SCENARIO }

  let qhPrices = []
  try {
    const raw = fs.readFileSync(inPath, 'utf8')
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) {
      // Input shape: [{ t: <ms>, p: <EUR/MWh> }, ...]
      qhPrices = parsed
        .filter((row) => row && typeof row.t === 'number' && typeof row.p === 'number')
        .map((row) => ({ ts: new Date(row.t).toISOString(), price: row.p }))
    } else {
      process.stderr.write(`[precompute-management-monthly] Unexpected JSON shape in ${inPath}; expected array.\n`)
    }
  } catch (err) {
    process.stderr.write(`[precompute-management-monthly] Could not read ${inPath}: ${err && err.message ? err.message : String(err)}\n`)
  }

  let dataset
  if (qhPrices.length === 0) {
    dataset = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scenario,
      monthly: [],
      explainer: emptyExplainer(scenario),
    }
  } else {
    const monthly = aggregateMonthly(qhPrices, scenario)
    // Prefer the latest complete calendar month; fall back to the last month
    // present in the data if the completed one has no aggregation.
    let explainerMonth = latestCompleteMonthKey()
    let hasExplainerMonth = monthly.some((m) => m.monthKey === explainerMonth)
    if (!hasExplainerMonth && monthly.length > 0) {
      explainerMonth = monthly[monthly.length - 1].monthKey
    }
    const explainer = computeExplainer(qhPrices, explainerMonth, scenario)
    dataset = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      scenario,
      monthly,
      explainer,
    }
  }

  fs.mkdirSync(path.dirname(outPath), { recursive: true })
  fs.writeFileSync(outPath, JSON.stringify(dataset, null, 2) + '\n')
  const sizeKb = (fs.statSync(outPath).size / 1024).toFixed(1)
  process.stdout.write(
    `[precompute-management-monthly] Wrote ${dataset.monthly.length} monthly rows, explainer="${dataset.explainer.monthKey}" (${sizeKb} KB) → ${outPath}\n`,
  )
}

main().catch((err) => {
  process.stderr.write(`[precompute-management-monthly] Fatal: ${err && err.stack ? err.stack : String(err)}\n`)
  // Exit 0 so CI doesn't fail on bootstrap / transient input issues.
  process.exit(0)
})
