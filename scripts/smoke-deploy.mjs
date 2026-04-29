#!/usr/bin/env node

const baseUrl = (process.env.SMOKE_BASE_URL || 'http://127.0.0.1:3000').replace(/\/$/, '')
const expectGbDisabled = process.env.EXPECT_GB_DISABLED !== 'false'
const expectIntradayDisabled = process.env.EXPECT_INTRADAY_DISABLED !== 'false'

function utcDate(offsetDays = 0) {
  const d = new Date()
  d.setUTCHours(12, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + offsetDays)
  return d
}

function fmtDay(date) {
  return date.toISOString().slice(0, 10)
}

const startDate = process.env.SMOKE_START_DATE || fmtDay(utcDate(-1))
const endDate = process.env.SMOKE_END_DATE || fmtDay(utcDate(0))

async function request(path) {
  const res = await fetch(`${baseUrl}${path}`, { redirect: 'manual' })
  const text = await res.text()
  let json = null
  try {
    json = JSON.parse(text)
  } catch {
    // not every endpoint is JSON
  }
  return { status: res.status, text, json }
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message)
  }
}

async function checkPage(path) {
  const res = await request(path)
  assert(res.status === 200, `${path} returned ${res.status}, expected 200`)
  console.log(`OK  ${path} -> 200`)
}

async function checkDayAhead(country) {
  const path = `/api/prices/batch?country=${country}&startDate=${startDate}&endDate=${endDate}`
  const res = await request(path)
  assert(res.status === 200, `${path} returned ${res.status}, expected 200`)
  assert(Array.isArray(res.json?.prices), `${path} did not return a prices array`)
  assert(res.json.prices.length > 0, `${path} returned an empty prices array`)
  console.log(`OK  ${path} -> 200 (${res.json.prices.length} prices)`)
}

async function checkGbGate() {
  const path = `/api/prices/batch?country=GB&startDate=${startDate}&endDate=${endDate}`
  const res = await request(path)
  if (expectGbDisabled) {
    assert(res.status >= 400, `${path} returned ${res.status}, expected GB to be disabled`)
    assert(typeof res.json?.error === 'string' && /disabled/i.test(res.json.error), `${path} did not return a GB-disabled error`)
    console.log(`OK  ${path} -> ${res.status} (GB disabled as expected)`)
    return
  }

  assert(res.status === 200, `${path} returned ${res.status}, expected 200`)
  assert(Array.isArray(res.json?.prices), `${path} did not return a prices array`)
  assert(res.json.prices.length > 0, `${path} returned an empty prices array`)
  console.log(`OK  ${path} -> 200 (${res.json.prices.length} prices)`)
}

async function checkIntradayGate() {
  const path = `/api/prices/batch?country=DE&startDate=${startDate}&endDate=${endDate}&type=intraday&index=id3`
  const res = await request(path)
  if (expectIntradayDisabled) {
    assert(res.status >= 400, `${path} returned ${res.status}, expected intraday to be disabled`)
    assert(typeof res.json?.error === 'string' && /disabled/i.test(res.json.error), `${path} did not return an intraday-disabled error`)
    console.log(`OK  ${path} -> ${res.status} (intraday disabled as expected)`)
    return
  }

  assert(res.status === 200, `${path} returned ${res.status}, expected 200`)
  assert(Array.isArray(res.json?.prices), `${path} did not return a prices array`)
  assert(res.json.prices.length > 0, `${path} returned an empty prices array`)
  console.log(`OK  ${path} -> 200 (${res.json.prices.length} prices)`)
}

async function main() {
  console.log(`Smoke deploy check against ${baseUrl}`)
  console.log(`Date window: ${startDate} -> ${endDate}`)
  console.log(`Expect GB disabled: ${expectGbDisabled}`)
  console.log(`Expect intraday disabled: ${expectIntradayDisabled}`)
  console.log('')

  await checkPage('/v2')
  await checkPage('/v2/calculator')
  await checkPage('/battery')
  await checkPage('/dynamic')
  await checkDayAhead('DE')
  await checkDayAhead('NL')
  await checkGbGate()
  await checkIntradayGate()

  console.log('\nDeployment smoke check passed.')
}

main().catch((error) => {
  console.error(`\nDeployment smoke check failed: ${error.message}`)
  process.exit(1)
})
