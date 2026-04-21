#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

function utcDate(offsetDays = 0) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d
}

function fmtDay(date) {
  return date.toISOString().slice(0, 10)
}

function shiftDay(dateStr, deltaDays) {
  const d = new Date(`${dateStr}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + deltaDays)
  return fmtDay(d)
}

function readArray(path) {
  if (!existsSync(path)) {
    throw new Error(`Missing file: ${path}`)
  }
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  if (!Array.isArray(raw) || raw.length === 0) {
    throw new Error(`Empty or invalid array in ${path}`)
  }
  return raw
}

function getTimestampMs(point) {
  if (typeof point?.t === 'number') return point.t
  if (typeof point?.timestamp === 'string') {
    const ms = Date.parse(point.timestamp)
    if (Number.isFinite(ms)) return ms
  }
  throw new Error(`Point is missing a readable timestamp: ${JSON.stringify(point)}`)
}

function getDateKey(point) {
  return new Date(getTimestampMs(point)).toISOString().slice(0, 10)
}

function latestDate(points) {
  return getDateKey(points[points.length - 1])
}

function latestDayPoints(points) {
  const day = latestDate(points)
  return points.filter(point => getDateKey(point) === day)
}

function minuteSet(points) {
  return [...new Set(points.map(point => new Date(getTimestampMs(point)).getUTCMinutes()))].sort((a, b) => a - b)
}

function countFinite(points, field) {
  return points.filter(point => Number.isFinite(point?.[field])).length
}

const root = process.cwd()
const failures = []
const summary = []
const today = fmtDay(utcDate(0))
const yesterday = fmtDay(utcDate(-1))

function check(condition, message) {
  if (!condition) failures.push(message)
}

function load(relativePath) {
  const fullPath = join(root, relativePath)
  const points = readArray(fullPath)
  const latest = latestDate(points)
  summary.push(`${relativePath}: ${points.length} pts, latest=${latest}`)
  return { relativePath, points, latest }
}

const gbDaa1Hour = load('public/data/gb-daa1-prices.json')
const gbDaa1Qh = load('public/data/gb-daa1-prices-qh.json')
const gbDaa2Hour = load('public/data/gb-daa2-prices.json')
const gbDaa2Qh = load('public/data/gb-daa2-prices-qh.json')

const deIntraday = load('public/data/de-intraday-continuous.json')
const nlIntraday = load('public/data/nl-intraday-continuous.json')
const gbIntraday = load('public/data/gb-intraday-continuous.json')

check(gbDaa1Hour.latest >= today, `GB DAA1 hourly is stale: latest=${gbDaa1Hour.latest}, expected >= ${today}`)
check(gbDaa1Qh.latest >= today, `GB DAA1 quarterhour is stale: latest=${gbDaa1Qh.latest}, expected >= ${today}`)

const minAcceptableDaa2 = shiftDay(gbDaa1Hour.latest, -1)
check(gbDaa2Hour.latest >= minAcceptableDaa2, `GB DAA2 hourly lags too far behind DAA1: latest=${gbDaa2Hour.latest}, expected >= ${minAcceptableDaa2}`)
check(gbDaa2Qh.latest >= minAcceptableDaa2, `GB DAA2 quarterhour lags too far behind DAA1: latest=${gbDaa2Qh.latest}, expected >= ${minAcceptableDaa2}`)

for (const [label, dataset] of [
  ['GB DAA1 hourly', gbDaa1Hour],
  ['GB DAA1 quarterhour', gbDaa1Qh],
  ['GB DAA2 hourly', gbDaa2Hour],
  ['GB DAA2 quarterhour', gbDaa2Qh],
]) {
  const latestPoints = latestDayPoints(dataset.points)
  const minutes = minuteSet(latestPoints)
  if (label.includes('hourly')) {
    check(latestPoints.length >= 23 && latestPoints.length <= 25, `${label} latest day count is out of range: ${latestPoints.length}`)
    check(minutes.every(minute => minute === 0), `${label} should only contain top-of-hour timestamps, got minutes=${minutes.join(',')}`)
  } else {
    check(latestPoints.length >= 92 && latestPoints.length <= 100, `${label} latest day count is out of range: ${latestPoints.length}`)
    check(minutes.every(minute => [0, 15, 30, 45].includes(minute)), `${label} contains unexpected minute offsets: ${minutes.join(',')}`)
  }
}

for (const [label, dataset] of [
  ['DE intraday continuous', deIntraday],
  ['NL intraday continuous', nlIntraday],
  ['GB intraday continuous', gbIntraday],
]) {
  check(dataset.latest >= yesterday, `${label} is stale: latest=${dataset.latest}, expected >= ${yesterday}`)
  const latestPoints = latestDayPoints(dataset.points)
  check(latestPoints.length >= 92 && latestPoints.length <= 100, `${label} latest day count is out of range: ${latestPoints.length}`)
}

check(countFinite(latestDayPoints(gbIntraday.points), 'id3_ct') >= 40, 'GB intraday continuous latest day is missing too many RPD HH / id3 values')

if (failures.length > 0) {
  console.error('Static data smoke test failed.\n')
  for (const line of summary) console.error(`- ${line}`)
  console.error('')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Static data smoke test passed.\n')
for (const line of summary) console.log(`- ${line}`)
