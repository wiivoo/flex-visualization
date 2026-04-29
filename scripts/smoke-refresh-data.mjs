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

const root = process.cwd()
const failures = []
const summary = []
const today = fmtDay(utcDate(0))
const tomorrow = fmtDay(utcDate(1))
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

const smardHour = load('public/data/smard-prices.json')
const smardQh = load('public/data/smard-prices-qh.json')
const smardGeneration = load('public/data/smard-generation.json')
const nlHour = load('public/data/nl-prices.json')
const nlQh = load('public/data/nl-prices-qh.json')

for (const [label, dataset] of [
  ['SMARD hourly', smardHour],
  ['NL hourly', nlHour],
]) {
  check(dataset.latest >= today, `${label} is stale: latest=${dataset.latest}, expected >= ${today}`)
  const latestPoints = latestDayPoints(dataset.points)
  const minutes = minuteSet(latestPoints)
  const minPoints = dataset.latest === today || dataset.latest === tomorrow ? 20 : 23
  check(latestPoints.length >= minPoints && latestPoints.length <= 25, `${label} latest day count is out of range: ${latestPoints.length}`)
  check(minutes.every(minute => minute === 0), `${label} should only contain top-of-hour timestamps, got minutes=${minutes.join(',')}`)
}

for (const [label, dataset] of [
  ['SMARD quarterhour', smardQh],
  ['NL quarterhour', nlQh],
]) {
  check(dataset.latest >= today, `${label} is stale: latest=${dataset.latest}, expected >= ${today}`)
  const latestPoints = latestDayPoints(dataset.points)
  const minutes = minuteSet(latestPoints)
  const minPoints = dataset.latest === today || dataset.latest === tomorrow ? 80 : 92
  check(latestPoints.length >= minPoints && latestPoints.length <= 100, `${label} latest day count is out of range: ${latestPoints.length}`)
  check(minutes.every(minute => [0, 15, 30, 45].includes(minute)), `${label} contains unexpected minute offsets: ${minutes.join(',')}`)
}

check(smardGeneration.latest >= yesterday, `SMARD generation is stale: latest=${smardGeneration.latest}, expected >= ${yesterday}`)

if (failures.length > 0) {
  console.error('Refresh data smoke test failed.\n')
  for (const line of summary) console.error(`- ${line}`)
  console.error('')
  for (const failure of failures) console.error(`- ${failure}`)
  process.exit(1)
}

console.log('Refresh data smoke test passed.\n')
for (const line of summary) console.log(`- ${line}`)
