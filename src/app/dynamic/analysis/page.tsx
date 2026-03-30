'use client'

import { useState, useMemo, useEffect, Suspense } from 'react'
import { usePrices } from '@/lib/use-prices'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ComposedChart, Line, Bar, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine, ReferenceArea, ScatterChart, Scatter, Cell,
} from 'recharts'
import {
  calculateYearlyCost, surchargesForYear, totalSurchargesNetto,
  type DailyResult,
} from '@/lib/dynamic-tariff'
import type { HourlyPrice } from '@/lib/v2-config'
import { type LoadProfile, getProfileHourlyWeights } from '@/lib/slp-h25'

export default function AnalysisPage() {
  return <Suspense><AnalysisInner /></Suspense>
}

/* ─── Constants ─── */
const COLORS = {
  before: '#2563EB',
  after: '#EA1C0A',
  neutral: '#6B7280',
  green: '#059669',
  amber: '#D97706',
  gas: '#7C3AED',
  teal: '#0D9488',
  coal: '#78716C',
  lignite: '#A16207',
}

const PROFILES: { id: LoadProfile; label: string; short: string }[] = [
  { id: 'H25', label: 'Household (H25)', short: 'H25' },
  { id: 'P25', label: 'Heat Pump (P25)', short: 'P25' },
  { id: 'S25', label: 'Storage Heater (S25)', short: 'S25' },
]

/* ─── TTF Daily Data (ICE Endex, front-month settlement, EUR/MWh) ─── */
const TTF_DAILY: [string, number][] = [
  ['2025-03-28',34.685],['2025-03-31',35.408],['2025-04-01',36.484],['2025-04-02',36.146],['2025-04-03',34.482],
  ['2025-04-04',32.932],['2025-04-07',33.705],['2025-04-08',33.375],['2025-04-09',32.279],['2025-04-10',32.002],
  ['2025-04-11',32.022],['2025-04-14',32.493],['2025-04-15',32.811],['2025-04-16',32.899],['2025-04-17',33.26],
  ['2025-04-21',33.26],['2025-04-22',32.049],['2025-04-23',32.035],['2025-04-24',31.635],['2025-04-25',30.411],
  ['2025-04-28',30.466],['2025-04-29',30.22],['2025-04-30',31.023],['2025-05-01',30.948],['2025-05-02',31.521],
  ['2025-05-05',31.674],['2025-05-06',32.914],['2025-05-07',32.972],['2025-05-08',33.417],['2025-05-09',33.15],
  ['2025-05-12',33.785],['2025-05-13',34.083],['2025-05-14',33.518],['2025-05-15',33.681],['2025-05-16',33.72],
  ['2025-05-19',33.73],['2025-05-20',34.772],['2025-05-21',34.781],['2025-05-22',34.712],['2025-05-23',34.953],
  ['2025-05-26',35.604],['2025-05-27',35.271],['2025-05-28',35.098],['2025-05-29',34.071],['2025-05-30',33.041],
  ['2025-06-02',33.637],['2025-06-03',34.347],['2025-06-04',34.091],['2025-06-05',34.639],['2025-06-06',34.601],
  ['2025-06-09',34.267],['2025-06-10',33.548],['2025-06-11',34.431],['2025-06-12',34.697],['2025-06-13',35.956],
  ['2025-06-16',36.12],['2025-06-17',37.009],['2025-06-18',36.617],['2025-06-19',38.463],['2025-06-20',37.959],
  ['2025-06-23',37.64],['2025-06-24',34.64],['2025-06-25',34.686],['2025-06-26',33.99],['2025-06-27',33.534],
  ['2025-06-30',32.967],['2025-07-01',33.238],['2025-07-02',33.484],['2025-07-03',33.615],['2025-07-04',33.565],
  ['2025-07-07',33.673],['2025-07-08',33.953],['2025-07-09',34.1],['2025-07-10',34.583],['2025-07-11',34.742],
  ['2025-07-14',34.748],['2025-07-15',34.109],['2025-07-16',34.134],['2025-07-17',33.977],['2025-07-18',33.432],
  ['2025-07-21',32.824],['2025-07-22',32.817],['2025-07-23',32.662],['2025-07-24',32.749],['2025-07-25',32.84],
  ['2025-07-28',33.3],['2025-07-29',34.143],['2025-07-30',34.429],['2025-07-31',34.471],['2025-08-01',33.617],
  ['2025-08-04',33.801],['2025-08-05',33.722],['2025-08-06',32.984],['2025-08-07',32.691],['2025-08-08',32.16],
  ['2025-08-11',32.63],['2025-08-12',32.232],['2025-08-13',32.352],['2025-08-14',32.093],['2025-08-15',30.925],
  ['2025-08-18',30.927],['2025-08-19',30.958],['2025-08-20',31.423],['2025-08-21',32.3],['2025-08-22',32.412],
  ['2025-08-25',32.632],['2025-08-26',32.176],['2025-08-27',31.589],['2025-08-28',30.931],['2025-08-29',30.978],
  ['2025-09-01',31.453],['2025-09-02',31.309],['2025-09-03',31.541],['2025-09-04',31.788],['2025-09-05',31.402],
  ['2025-09-08',32.17],['2025-09-09',32.058],['2025-09-10',32.21],['2025-09-11',31.715],['2025-09-12',32.01],
  ['2025-09-15',31.707],['2025-09-16',31.85],['2025-09-17',31.899],['2025-09-18',32.262],['2025-09-19',31.8],
  ['2025-09-22',31.314],['2025-09-23',31.525],['2025-09-24',31.415],['2025-09-25',31.693],['2025-09-26',31.964],
  ['2025-09-29',31.522],['2025-09-30',30.682],['2025-10-01',30.666],['2025-10-02',30.745],['2025-10-03',30.645],
  ['2025-10-06',31.731],['2025-10-07',31.765],['2025-10-08',31.477],['2025-10-09',31.194],['2025-10-10',30.965],
  ['2025-10-13',30.468],['2025-10-14',30.634],['2025-10-15',30.616],['2025-10-16',30.854],['2025-10-17',30.448],
  ['2025-10-20',30.302],['2025-10-21',30.755],['2025-10-22',30.626],['2025-10-23',31.203],['2025-10-24',30.853],
  ['2025-10-27',30.237],['2025-10-28',30.268],['2025-10-29',30.525],['2025-10-30',30.132],['2025-10-31',29.925],
  ['2025-11-03',30.374],['2025-11-04',30.946],['2025-11-05',30.472],['2025-11-06',30.284],['2025-11-07',30.002],
  ['2025-11-10',29.919],['2025-11-11',29.933],['2025-11-12',29.739],['2025-11-13',29.42],['2025-11-14',29.953],
  ['2025-11-17',29.994],['2025-11-18',30.17],['2025-11-19',29.626],['2025-11-20',29.713],['2025-11-21',28.773],
  ['2025-11-24',28.475],['2025-11-25',28.15],['2025-11-26',28.154],['2025-11-27',27.969],['2025-11-28',27.657],
  ['2025-12-01',27.191],['2025-12-02',27.077],['2025-12-03',27.312],['2025-12-04',26.431],['2025-12-05',26.572],
  ['2025-12-08',26.116],['2025-12-09',26.546],['2025-12-10',25.781],['2025-12-11',25.908],['2025-12-12',26.557],
  ['2025-12-15',26.276],['2025-12-16',25.633],['2025-12-17',26.068],['2025-12-18',26.32],['2025-12-19',26.743],
  ['2025-12-22',26.578],['2025-12-23',26.648],['2025-12-24',27.026],['2025-12-26',27.026],['2025-12-29',27.283],
  ['2025-12-30',26.68],['2025-12-31',27.122],['2026-01-02',27.774],['2026-01-05',26.506],['2026-01-06',26.976],
  ['2026-01-07',27.367],['2026-01-08',26.539],['2026-01-09',26.971],['2026-01-12',27.91],['2026-01-13',28.101],
  ['2026-01-14',28.08],['2026-01-15',29.339],['2026-01-16',31.813],['2026-01-19',30.938],['2026-01-20',31.329],
  ['2026-01-21',33.108],['2026-01-22',32.452],['2026-01-23',33.385],['2026-01-26',32.815],['2026-01-27',32.489],
  ['2026-01-28',32.954],['2026-01-29',34.722],['2026-01-30',35.115],['2026-02-02',31.484],['2026-02-03',30.879],
  ['2026-02-04',31.295],['2026-02-05',31.523],['2026-02-06',32.846],['2026-02-09',31.673],['2026-02-10',30.391],
  ['2026-02-11',30.544],['2026-02-12',31.22],['2026-02-13',31.007],['2026-02-16',29.889],['2026-02-17',29.041],
  ['2026-02-18',30.537],['2026-02-19',32.906],['2026-02-20',31.525],['2026-02-23',31.456],['2026-02-24',30.553],
  ['2026-02-25',30.927],['2026-02-26',32.148],['2026-02-27',31.959],['2026-03-02',44.506],['2026-03-03',54.29],
  ['2026-03-04',48.767],['2026-03-05',50.731],['2026-03-06',53.385],['2026-03-09',56.453],['2026-03-10',47.393],
  ['2026-03-11',49.989],['2026-03-12',50.87],['2026-03-13',50.115],['2026-03-16',50.887],['2026-03-17',51.559],
  ['2026-03-18',54.662],['2026-03-19',61.852],['2026-03-20',59.255],['2026-03-23',56.683],['2026-03-24',54.041],
  ['2026-03-25',52.816],['2026-03-26',55.218],
]
const _ttfMap = new Map(TTF_DAILY)

/* ─── Generation mix type ─── */
interface GenHour {
  ts: number; date: string; hour: number
  gasMw: number; coalMw: number; ligniteMw: number
  solarMw: number; windMw: number; biomassMw: number
  loadMw: number; renewableMw: number; residualMw: number
  gasSharePct: number; renewableSharePct: number
}

/* ─── Helpers ─── */
function addDays(dateStr: string, n: number): string {
  const d = new Date(dateStr + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

function gasForDate(dateStr: string): number | null {
  const exact = _ttfMap.get(dateStr)
  if (exact !== undefined) return exact
  for (let i = 1; i <= 4; i++) {
    const val = _ttfMap.get(addDays(dateStr, -i))
    if (val !== undefined) return val
  }
  return null
}

function rollingAvg(data: { date: string; value: number }[], window: number): { date: string; avg: number }[] {
  const result: { date: string; avg: number }[] = []
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1)
    const slice = data.slice(start, i + 1)
    result.push({ date: data[i].date, avg: slice.reduce((s, d) => s + d.value, 0) / slice.length })
  }
  return result
}

function dailySpread(hourlyPrices: HourlyPrice[], dateStr: string): number {
  const dayPrices = hourlyPrices.filter(p => p.date === dateStr && p.minute === 0)
  if (dayPrices.length < 2) return 0
  const vals = dayPrices.map(p => p.priceCtKwh)
  return Math.max(...vals) - Math.min(...vals)
}

function pearsonR(xs: number[], ys: number[]): number {
  const n = xs.length
  if (n < 3) return 0
  const mx = xs.reduce((a, b) => a + b, 0) / n
  const my = ys.reduce((a, b) => a + b, 0) / n
  let num = 0, dx2 = 0, dy2 = 0
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my
    num += dx * dy; dx2 += dx * dx; dy2 += dy * dy
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2)
}

function fmtDate(d: string) {
  return new Date(d + 'T12:00:00Z').toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}
function fmtNum(n: number, d = 2) { return n.toFixed(d) }

interface PeriodStats {
  days: number; avgSpot: number; avgWeightedPrice: number; avgSpread: number
  avgPeakSpot: number; avgOffPeakSpot: number; peakOffPeakDelta: number
  greenDays: number; redDays: number
  avgSavingsEur: number; totalSavingsEur: number
}

function computeStats(days: DailyResult[], hp: HourlyPrice[]): PeriodStats {
  const empty: PeriodStats = { days: 0, avgSpot: 0, avgWeightedPrice: 0, avgSpread: 0, avgPeakSpot: 0, avgOffPeakSpot: 0, peakOffPeakDelta: 0, greenDays: 0, redDays: 0, avgSavingsEur: 0, totalSavingsEur: 0 }
  if (days.length === 0) return empty
  const spots = days.map(d => d.avgSpotCtKwh)
  const weighted = days.map(d => d.avgEndPriceCtKwh)
  const spreads = days.map(d => dailySpread(hp, d.date))
  const peaks: number[] = [], offPeaks: number[] = []
  for (const d of days) {
    if (d.peakHours > 0) peaks.push(d.peakSpotSum / d.peakHours)
    if (d.offPeakHours > 0) offPeaks.push(d.offPeakSpotSum / d.offPeakHours)
  }
  const avgPeak = peaks.length > 0 ? peaks.reduce((a, b) => a + b, 0) / peaks.length : 0
  const avgOff = offPeaks.length > 0 ? offPeaks.reduce((a, b) => a + b, 0) / offPeaks.length : 0
  let green = 0, red = 0, totalSav = 0
  for (const d of days) { const s = d.fixedCostEur - d.dynamicCostEur; totalSav += s; s >= 0 ? green++ : red++ }
  return {
    days: days.length,
    avgSpot: spots.reduce((a, b) => a + b, 0) / spots.length,
    avgWeightedPrice: weighted.reduce((a, b) => a + b, 0) / weighted.length,
    avgSpread: spreads.reduce((a, b) => a + b, 0) / spreads.length,
    avgPeakSpot: avgPeak, avgOffPeakSpot: avgOff, peakOffPeakDelta: avgPeak - avgOff,
    greenDays: green, redDays: red,
    avgSavingsEur: totalSav / days.length, totalSavingsEur: totalSav,
  }
}

/* ─── Hourly profile averages ─── */
function hourlyProfile(hp: HourlyPrice[], startDate: string, endDate: string): number[] {
  const sums = new Array(24).fill(0)
  const counts = new Array(24).fill(0)
  for (const p of hp) {
    if (p.date >= startDate && p.date < endDate && p.minute === 0) {
      sums[p.hour] += p.priceCtKwh
      counts[p.hour]++
    }
  }
  return sums.map((s, i) => counts[i] > 0 ? s / counts[i] : 0)
}

/* ─── Stat Row ─── */
function StatRow({ label, before, after, unit, inverted = false, bold = false }: {
  label: string; before: number; after: number; unit: string; inverted?: boolean; bold?: boolean
}) {
  const diff = after - before
  const isUp = diff > 0
  const isGood = inverted ? !isUp : isUp
  return (
    <div className={`flex items-center justify-between py-1.5 border-b border-gray-50 last:border-0 ${bold ? 'bg-gray-50/50 -mx-1 px-1 rounded' : ''}`}>
      <span className={`text-[11px] ${bold ? 'font-semibold text-gray-700' : 'text-gray-600'}`}>{label}</span>
      <div className="flex items-center gap-3">
        <span className="text-[11px] tabular-nums font-mono text-blue-600 w-16 text-right">{fmtNum(before)} {unit}</span>
        <span className="text-[11px] tabular-nums font-mono text-red-600 w-16 text-right">{fmtNum(after)} {unit}</span>
        <span className={`text-[11px] font-bold tabular-nums w-20 text-right ${isGood ? 'text-emerald-600' : 'text-red-600'}`}>
          {isUp ? '+' : ''}{fmtNum(diff)} {unit}
        </span>
      </div>
    </div>
  )
}

/* ─── Main ─── */
function AnalysisInner() {
  const [profile, setProfile] = useState<LoadProfile>('H25')
  const [fixedPrice, setFixedPrice] = useState(32)
  const [consumption, setConsumption] = useState(3500)

  // Fixed periods: February 2026 vs. March 2026
  const febStart = '2026-02-01'
  const febEnd = '2026-03-01'
  const marStart = '2026-03-01'
  // Dynamic marEnd: today or latest available data
  const marEnd = useMemo(() => {
    const today = new Date()
    const y = today.getFullYear(), m = String(today.getMonth() + 1).padStart(2, '0'), d = String(today.getDate()).padStart(2, '0')
    return `${y}-${m}-${d}`
  }, [])
  const eventDate = '2026-02-28'

  const prices = usePrices('DE')

  // Generation mix data
  const [genMix, setGenMix] = useState<GenHour[]>([])
  const [genLoading, setGenLoading] = useState(true)
  const [showGasOverlay, setShowGasOverlay] = useState(false)
  const [showResOverlay, setShowResOverlay] = useState(false)

  useEffect(() => {
    setGenLoading(true)
    fetch(`/api/generation/mix?from=2026-01-01&to=${marEnd}`)
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data?.hourly) setGenMix(data.hourly) })
      .catch(() => {})
      .finally(() => setGenLoading(false))
  }, [marEnd])

  // CSS (Clean Spark Spread) data — EPEX hourly
  const [cssData, setCssData] = useState<{ t: number; p: number }[]>([])
  useEffect(() => {
    fetch('/data/epex-css.json')
      .then(r => r.ok ? r.json() : [])
      .then(data => setCssData(data))
      .catch(() => {})
  }, [])

  // Daily results — profile-weighted
  const allDaily = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const s = surchargesForYear(2026)
    const result = calculateYearlyCost(consumption, prices.hourly, s, fixedPrice, 2026, profile)
    return result.dailyBreakdown.sort((a, b) => a.date.localeCompare(b.date))
  }, [prices.hourly, fixedPrice, consumption, profile])

  const febDays = useMemo(() => allDaily.filter(d => d.date >= febStart && d.date < febEnd), [allDaily])
  const marDays = useMemo(() => allDaily.filter(d => d.date >= marStart && d.date < marEnd), [allDaily])

  const febStats = useMemo(() => computeStats(febDays, prices.hourly), [febDays, prices.hourly])
  const marStats = useMemo(() => computeStats(marDays, prices.hourly), [marDays, prices.hourly])

  // Hourly profiles
  const febProfile = useMemo(() => hourlyProfile(prices.hourly, febStart, febEnd), [prices.hourly])
  const marProfile = useMemo(() => hourlyProfile(prices.hourly, marStart, marEnd), [prices.hourly])

  // Gas generation daily aggregates
  const gasGenDaily = useMemo(() => {
    if (genMix.length === 0) return []
    const byDate = new Map<string, { gasMw: number[]; loadMw: number[]; resMw: number[]; gasShare: number[]; resShare: number[]; renewMw: number[] }>()
    for (const g of genMix) {
      let entry = byDate.get(g.date)
      if (!entry) { entry = { gasMw: [], loadMw: [], resMw: [], gasShare: [], resShare: [], renewMw: [] }; byDate.set(g.date, entry) }
      entry.gasMw.push(g.gasMw)
      entry.loadMw.push(g.loadMw)
      entry.resMw.push(g.residualMw)
      entry.gasShare.push(g.gasSharePct)
      entry.resShare.push(g.renewableSharePct)
      entry.renewMw.push(g.renewableMw)
    }
    return Array.from(byDate.entries()).map(([date, v]) => ({
      date,
      avgGasMw: v.gasMw.reduce((a, b) => a + b, 0) / v.gasMw.length,
      avgLoadMw: v.loadMw.reduce((a, b) => a + b, 0) / v.loadMw.length,
      avgGasShare: v.gasShare.reduce((a, b) => a + b, 0) / v.gasShare.length,
      avgResShare: v.resShare.reduce((a, b) => a + b, 0) / v.resShare.length,
      maxGasMw: Math.max(...v.gasMw),
      maxGasShare: Math.max(...v.gasShare),
    })).sort((a, b) => a.date.localeCompare(b.date))
  }, [genMix])

  // Hourly gas + RES generation profile (Feb vs Mar)
  const gasHourlyProfile = useMemo(() => {
    if (genMix.length === 0) return []
    const febHours: number[][] = Array.from({ length: 24 }, () => [])
    const marHours: number[][] = Array.from({ length: 24 }, () => [])
    const febShare: number[][] = Array.from({ length: 24 }, () => [])
    const marShare: number[][] = Array.from({ length: 24 }, () => [])
    const febResShare: number[][] = Array.from({ length: 24 }, () => [])
    const marResShare: number[][] = Array.from({ length: 24 }, () => [])
    for (const g of genMix) {
      if (g.date >= febStart && g.date < febEnd) {
        febHours[g.hour]?.push(g.gasMw); febShare[g.hour]?.push(g.gasSharePct)
        febResShare[g.hour]?.push(g.renewableSharePct)
      }
      if (g.date >= marStart && g.date < marEnd) {
        marHours[g.hour]?.push(g.gasMw); marShare[g.hour]?.push(g.gasSharePct)
        marResShare[g.hour]?.push(g.renewableSharePct)
      }
    }
    return Array.from({ length: 24 }, (_, h) => ({
      hour: h, label: `${String(h).padStart(2, '0')}:00`,
      febGasMw: febHours[h].length > 0 ? febHours[h].reduce((a, b) => a + b, 0) / febHours[h].length : 0,
      marGasMw: marHours[h].length > 0 ? marHours[h].reduce((a, b) => a + b, 0) / marHours[h].length : 0,
      febGasShare: febShare[h].length > 0 ? febShare[h].reduce((a, b) => a + b, 0) / febShare[h].length : 0,
      marGasShare: marShare[h].length > 0 ? marShare[h].reduce((a, b) => a + b, 0) / marShare[h].length : 0,
      febResShare: febResShare[h].length > 0 ? febResShare[h].reduce((a, b) => a + b, 0) / febResShare[h].length : 0,
      marResShare: marResShare[h].length > 0 ? marResShare[h].reduce((a, b) => a + b, 0) / marResShare[h].length : 0,
    }))
  }, [genMix])

  // Hourly price + gen share data for Chart 4
  const hourlyData = useMemo(() => Array.from({ length: 24 }, (_, h) => {
    const gp = gasHourlyProfile[h]
    return {
      hour: h, label: `${String(h).padStart(2, '0')}:00`,
      feb: febProfile[h], mar: marProfile[h],
      delta: marProfile[h] - febProfile[h],
      febGasShare: gp?.febGasShare ?? 0, marGasShare: gp?.marGasShare ?? 0,
      febResShare: gp?.febResShare ?? 0, marResShare: gp?.marResShare ?? 0,
    }
  }), [febProfile, marProfile, gasHourlyProfile])

  // Gas-price correlation: hourly gas generation vs. spot price
  const gasPriceCorrelation = useMemo(() => {
    if (genMix.length === 0 || prices.hourly.length === 0) return { points: [] as { gasMw: number; spot: number; date: string; isMarch: boolean }[], rFeb: 0, rMar: 0 }
    const priceMap = new Map<string, number>()
    for (const p of prices.hourly) {
      if (p.minute === 0) priceMap.set(`${p.date}-${p.hour}`, p.priceCtKwh)
    }
    const points: { gasMw: number; spot: number; date: string; isMarch: boolean }[] = []
    for (const g of genMix) {
      const spot = priceMap.get(`${g.date}-${g.hour}`)
      if (spot !== undefined && g.gasMw > 0) {
        points.push({ gasMw: g.gasMw, spot, date: g.date, isMarch: g.date >= marStart })
      }
    }
    const febPts = points.filter(p => !p.isMarch)
    const marPts = points.filter(p => p.isMarch)
    return {
      points,
      rFeb: pearsonR(febPts.map(p => p.gasMw), febPts.map(p => p.spot)),
      rMar: pearsonR(marPts.map(p => p.gasMw), marPts.map(p => p.spot)),
    }
  }, [genMix, prices.hourly])

  // Gas dispatch stats: median-based threshold per period
  // Gas is always dispatched in DE; the question is how much.
  // "High gas dispatch" = above-median for the period → gas plants running hard, setting price at elevated marginal cost
  const gasSettingHours = useMemo(() => {
    if (genMix.length === 0) return { febCount: 0, febTotal: 0, marCount: 0, marTotal: 0, febPct: 0, marPct: 0, febMedianMw: 0, marMedianMw: 0 }
    const febMw: number[] = [], marMw: number[] = []
    for (const g of genMix) {
      if (g.date >= febStart && g.date < febEnd) febMw.push(g.gasMw)
      if (g.date >= marStart && g.date < marEnd) marMw.push(g.gasMw)
    }
    febMw.sort((a, b) => a - b); marMw.sort((a, b) => a - b)
    const febMedian = febMw.length > 0 ? febMw[Math.floor(febMw.length / 2)] : 0
    const marMedian = marMw.length > 0 ? marMw[Math.floor(marMw.length / 2)] : 0
    // "High gas" = above the OVERALL median (use Feb as baseline since it's the reference period)
    const overallMedian = febMedian
    let febCount = 0, marCount = 0
    for (const v of febMw) if (v > overallMedian) febCount++
    for (const v of marMw) if (v > overallMedian) marCount++
    return {
      febCount, febTotal: febMw.length, marCount, marTotal: marMw.length,
      febPct: febMw.length > 0 ? (febCount / febMw.length) * 100 : 0,
      marPct: marMw.length > 0 ? (marCount / marMw.length) * 100 : 0,
      febMedianMw: febMedian, marMedianMw: marMedian,
    }
  }, [genMix])

  // ── Chart 4a: Weekly price curves (15-min QH) with gas dispatch overlay ──
  // 672 slots per week: 7 days × 96 quarter-hours
  const SLOTS_PER_DAY = 96
  const SLOTS_PER_WEEK = 7 * SLOTS_PER_DAY

  const weeklyOverlayData = useMemo(() => {
    const qh = prices.hourlyQH
    if (qh.length === 0 || genMix.length === 0) return []

    // Gas lookup: date-hour → gasMw (hourly resolution, spread across QH in that hour)
    const gasMap = new Map<string, number>()
    for (const g of genMix) gasMap.set(`${g.date}-${g.hour}`, g.gasMw)

    function buildSlots(startDate: string, endDate: string) {
      const slots = new Map<number, { prices: number[]; totalGasMw: number }>()
      for (const p of qh) {
        if (p.date < startDate || p.date >= endDate) continue
        const d = new Date(p.date + 'T12:00:00Z')
        const dayOfWeek = (d.getUTCDay() + 6) % 7 // Mon=0
        const qhIdx = p.hour * 4 + Math.floor(p.minute / 15)
        const idx = dayOfWeek * SLOTS_PER_DAY + qhIdx
        if (!slots.has(idx)) slots.set(idx, { prices: [], totalGasMw: 0 })
        const s = slots.get(idx)!
        s.prices.push(p.priceCtKwh)
        s.totalGasMw += gasMap.get(`${p.date}-${p.hour}`) ?? 0
      }
      return slots
    }

    const febSlots = buildSlots(febStart, febEnd)
    const marSlots = buildSlots(marStart, marEnd)
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

    return Array.from({ length: SLOTS_PER_WEEK }, (_, idx) => {
      const day = Math.floor(idx / SLOTS_PER_DAY)
      const qhInDay = idx % SLOTS_PER_DAY
      const hour = Math.floor(qhInDay / 4)
      const minute = (qhInDay % 4) * 15
      const fs = febSlots.get(idx)
      const ms = marSlots.get(idx)
      const febAvg = fs && fs.prices.length > 0 ? fs.prices.reduce((a, b) => a + b, 0) / fs.prices.length : 0
      const marAvg = ms && ms.prices.length > 0 ? ms.prices.reduce((a, b) => a + b, 0) / ms.prices.length : 0
      const febGasMw = fs && fs.prices.length > 0 ? fs.totalGasMw / fs.prices.length / 1000 : 0
      const marGasMw = ms && ms.prices.length > 0 ? ms.totalGasMw / ms.prices.length / 1000 : 0

      let label = ''
      if (hour === 0 && minute === 0) label = dayNames[day]
      else if (hour === 12 && minute === 0) label = '12h'

      return {
        idx, day, hour, minute, label,
        febPrice: febAvg, marPrice: marAvg,
        febGasMw, marGasMw,
        delta: marAvg - febAvg,
      }
    })
  }, [prices.hourlyQH, genMix])

  // ── Chart 4b: 15-min boxplot data — combined into one array for overlay ──
  const qhBoxplotData = useMemo(() => {
    if (prices.hourlyQH.length === 0) return []

    function percentile(sorted: number[], p: number): number {
      if (sorted.length === 0) return 0
      const i = (sorted.length - 1) * p
      const lo = Math.floor(i), hi = Math.ceil(i)
      return lo === hi ? sorted[lo] : sorted[lo] * (hi - i) + sorted[hi] * (i - lo)
    }

    function buildSlots(startDate: string, endDate: string) {
      const slots: number[][] = Array.from({ length: 96 }, () => [])
      for (const p of prices.hourlyQH) {
        if (p.date >= startDate && p.date < endDate) {
          const slotIdx = p.hour * 4 + Math.floor(p.minute / 15)
          if (slotIdx >= 0 && slotIdx < 96) slots[slotIdx].push(p.priceCtKwh)
        }
      }
      return slots.map(vals => {
        const sorted = vals.slice().sort((a, b) => a - b)
        return {
          min: sorted.length > 0 ? sorted[0] : 0,
          q25: percentile(sorted, 0.25),
          median: percentile(sorted, 0.5),
          q75: percentile(sorted, 0.75),
          max: sorted.length > 0 ? sorted[sorted.length - 1] : 0,
        }
      })
    }

    const feb = buildSlots(febStart, febEnd)
    const mar = buildSlots(marStart, marEnd)

    return Array.from({ length: 96 }, (_, idx) => {
      const h = Math.floor(idx / 4), m = (idx % 4) * 15
      return {
        idx,
        label: m === 0 ? `${String(h).padStart(2, '0')}:00` : '',
        febMin: feb[idx].min, febQ25: feb[idx].q25, febMedian: feb[idx].median, febQ75: feb[idx].q75, febMax: feb[idx].max,
        marMin: mar[idx].min, marQ25: mar[idx].q25, marMedian: mar[idx].median, marQ75: mar[idx].q75, marMax: mar[idx].max,
      }
    })
  }, [prices.hourlyQH])

  // ── Story charts: "Why spreads exploded" ──

  // Chart S1: Daily min-max price band (Feb vs Mar) — the widening corridor
  const dailyBandData = useMemo(() => {
    if (prices.hourly.length === 0) return []
    // Group hourly prices by date
    const byDate = new Map<string, number[]>()
    for (const p of prices.hourly) {
      if (p.minute !== 0) continue
      if (!byDate.has(p.date)) byDate.set(p.date, [])
      byDate.get(p.date)!.push(p.priceCtKwh)
    }
    return Array.from(byDate.entries())
      .filter(([d]) => d >= febStart && d < marEnd)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, vals]) => {
        const sorted = vals.slice().sort((a, b) => a - b)
        const n = sorted.length
        return {
          date,
          label: date.slice(5),
          min: sorted[0],
          max: sorted[n - 1],
          spread: sorted[n - 1] - sorted[0],
          avg: vals.reduce((a, b) => a + b, 0) / n,
          isMarch: date >= marStart,
        }
      })
  }, [prices.hourly])

  // Chart S2: Two forces — solar midday vs gas evening, grouped by period
  const twoForcesData = useMemo(() => {
    if (prices.hourly.length === 0 || genMix.length === 0) return []
    const gasMap = new Map<string, number>()
    for (const g of genMix) gasMap.set(`${g.date}-${g.hour}`, g.gasMw)
    const resMap = new Map<string, number>()
    for (const g of genMix) resMap.set(`${g.date}-${g.hour}`, g.renewableSharePct)

    const buckets = [
      { key: 'night', label: 'Night\n22–06h', hours: [22, 23, 0, 1, 2, 3, 4, 5], color: '#6366F1' },
      { key: 'morning', label: 'Morning\n06–10h', hours: [6, 7, 8, 9], color: '#F59E0B' },
      { key: 'solar', label: 'Solar Peak\n10–16h', hours: [10, 11, 12, 13, 14, 15], color: '#10B981' },
      { key: 'evening', label: 'Evening\n16–22h', hours: [16, 17, 18, 19, 20, 21], color: '#EF4444' },
    ]

    return buckets.map(b => {
      const febPrices: number[] = [], marPrices: number[] = []
      const febGas: number[] = [], marGas: number[] = []
      const febRes: number[] = [], marRes: number[] = []
      for (const p of prices.hourly) {
        if (p.minute !== 0 || !b.hours.includes(p.hour)) continue
        const gas = gasMap.get(`${p.date}-${p.hour}`) ?? 0
        const res = resMap.get(`${p.date}-${p.hour}`) ?? 0
        if (p.date >= febStart && p.date < febEnd) { febPrices.push(p.priceCtKwh); febGas.push(gas); febRes.push(res) }
        if (p.date >= marStart && p.date < marEnd) { marPrices.push(p.priceCtKwh); marGas.push(gas); marRes.push(res) }
      }
      const avg = (a: number[]) => a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0
      return {
        label: b.label.replace('\n', ' '),
        key: b.key,
        color: b.color,
        febPrice: avg(febPrices),
        marPrice: avg(marPrices),
        delta: avg(marPrices) - avg(febPrices),
        febGasMw: avg(febGas) / 1000,
        marGasMw: avg(marGas) / 1000,
        febResShare: avg(febRes),
        marResShare: avg(marRes),
      }
    })
  }, [prices.hourly, genMix])

  // Chart S3: Price histogram — bucket distribution
  const histogramData = useMemo(() => {
    if (prices.hourly.length === 0) return []
    const bucketSize = 2 // 2 ct/kWh bins
    const minBucket = -4, maxBucket = 32
    const numBuckets = (maxBucket - minBucket) / bucketSize

    const febCounts = new Array(numBuckets).fill(0)
    const marCounts = new Array(numBuckets).fill(0)
    let febTotal = 0, marTotal = 0

    for (const p of prices.hourly) {
      if (p.minute !== 0) continue
      const bi = Math.floor((p.priceCtKwh - minBucket) / bucketSize)
      const clamped = Math.max(0, Math.min(numBuckets - 1, bi))
      if (p.date >= febStart && p.date < febEnd) { febCounts[clamped]++; febTotal++ }
      if (p.date >= marStart && p.date < marEnd) { marCounts[clamped]++; marTotal++ }
    }

    return Array.from({ length: numBuckets }, (_, i) => ({
      bucket: minBucket + i * bucketSize,
      label: `${minBucket + i * bucketSize}`,
      febPct: febTotal > 0 ? (febCounts[i] / febTotal) * 100 : 0,
      marPct: marTotal > 0 ? (marCounts[i] / marTotal) * 100 : 0,
      // Negative marPct for mirrored butterfly chart
      marPctNeg: marTotal > 0 ? -(marCounts[i] / marTotal) * 100 : 0,
    }))
  }, [prices.hourly])

  // Fact charts data: spot profiles + H25 weights + CSS/gas profitability
  const factChartData = useMemo(() => {
    if (prices.hourly.length === 0) return null

    // H25 hourly weights for WT (weekday, dominant type) — use March
    const h25WeightsRaw = getProfileHourlyWeights(3, 'WT', profile)
    const totalWeight = h25WeightsRaw.reduce((s, v) => s + v, 0)
    // Normalize to fraction of daily consumption (sums to 1.0)
    const h25Frac = h25WeightsRaw.map(w => w / totalWeight)

    // H25-weighted average spot prices
    let febWeightedAvg = 0, marWeightedAvg = 0
    for (let h = 0; h < 24; h++) {
      febWeightedAvg += febProfile[h] * h25Frac[h]
      marWeightedAvg += marProfile[h] * h25Frac[h]
    }

    // CSS lookup
    const cssMap = new Map<number, number>()
    for (const c of cssData) cssMap.set(c.t, c.p)

    // Per-hour: CSS positive fraction (% of days where CSS ≥ 0)
    const hourlyDetail: {
      hour: number; label: string
      febSpot: number; marSpot: number
      h25Weight: number  // percentage for display
      febResShare: number; marResShare: number
      febGasShare: number; marGasShare: number
      marCssPositivePct: number  // % of March days where CSS ≥ 0 at this hour
      febCssAvg: number; marCssAvg: number
    }[] = []

    for (let h = 0; h < 24; h++) {
      const gp = gasHourlyProfile[h]
      // CSS positive fraction for March
      let marCssPos = 0, marCssTotal = 0
      const febCssVals: number[] = [], marCssVals: number[] = []
      for (const p of prices.hourly) {
        if (p.hour !== h || p.minute !== 0) continue
        const css = cssMap.get(p.timestamp)
        if (p.date >= febStart && p.date < febEnd && css !== undefined) {
          febCssVals.push(css)
        }
        if (p.date >= marStart && p.date < marEnd && css !== undefined) {
          marCssVals.push(css)
          marCssTotal++
          if (css >= 0) marCssPos++
        }
      }
      const avg = (a: number[]) => a.length > 0 ? a.reduce((s, v) => s + v, 0) / a.length : 0

      hourlyDetail.push({
        hour: h,
        label: `${String(h).padStart(2, '0')}h`,
        febSpot: febProfile[h],
        marSpot: marProfile[h],
        h25Weight: h25Frac[h] * 100,
        febResShare: gp?.febResShare ?? 0,
        marResShare: gp?.marResShare ?? 0,
        febGasShare: gp?.febGasShare ?? 0,
        marGasShare: gp?.marGasShare ?? 0,
        marCssPositivePct: marCssTotal > 0 ? (marCssPos / marCssTotal) * 100 : 0,
        febCssAvg: avg(febCssVals) / 10,  // EUR/MWh → ct/kWh
        marCssAvg: avg(marCssVals) / 10,
      })
    }

    // H25 monthly cost from allDaily
    const febCost = febDays.reduce((s, d) => s + d.dynamicCostEur, 0)
    const marCost = marDays.reduce((s, d) => s + d.dynamicCostEur, 0)
    const febDaysN = febDays.length || 1
    const marDaysN = marDays.length || 1
    const febCost30 = (febCost / febDaysN) * 30
    const marCost30 = (marCost / marDaysN) * 30

    return { hourlyDetail, febWeightedAvg, marWeightedAvg, febCost30, marCost30 }
  }, [prices.hourly, cssData, febProfile, marProfile, gasHourlyProfile, febDays, marDays, profile])

  // Full timeline chart data
  const chartData = useMemo(() => {
    const spotSeries = allDaily.map(d => ({ date: d.date, value: d.avgSpotCtKwh }))
    const r7 = rollingAvg(spotSeries, 7)
    const r14 = rollingAvg(spotSeries, 14)
    const peakSeries = allDaily.map(d => ({ date: d.date, value: d.peakHours > 0 ? d.peakSpotSum / d.peakHours : 0 }))
    const offPeakSeries = allDaily.map(d => ({ date: d.date, value: d.offPeakHours > 0 ? d.offPeakSpotSum / d.offPeakHours : 0 }))
    const pr7 = rollingAvg(peakSeries, 7)
    const or7 = rollingAvg(offPeakSeries, 7)
    const savSeries = allDaily.map(d => ({ date: d.date, value: (d.fixedCostEur - d.dynamicCostEur) * 365 }))
    const savR14 = rollingAvg(savSeries, 14)

    // Match gas gen daily
    const gasMap = new Map(gasGenDaily.map(g => [g.date, g]))

    return allDaily.map((d, i) => {
      const dayPrices = prices.hourly.filter(p => p.date === d.date && p.minute === 0)
      const maxPrice = dayPrices.length > 0 ? Math.max(...dayPrices.map(p => p.priceCtKwh)) : 0
      const minPrice = dayPrices.length > 0 ? Math.min(...dayPrices.map(p => p.priceCtKwh)) : 0
      return {
        date: d.date,
        label: d.date.slice(5),
        spot: d.avgSpotCtKwh,
        weightedPrice: d.avgEndPriceCtKwh,
        r7: r7[i]?.avg ?? null,
        r14: r14[i]?.avg ?? null,
        spread: dailySpread(prices.hourly, d.date),
        peak: pr7[i]?.avg ?? null,
        offPeak: or7[i]?.avg ?? null,
        peakDelta: (pr7[i]?.avg ?? 0) - (or7[i]?.avg ?? 0),
        savings: (d.fixedCostEur - d.dynamicCostEur) * 365,
        savR14: savR14[i]?.avg ?? null,
        gas: gasForDate(d.date),
        gasGenMw: gasMap.get(d.date)?.avgGasMw ?? null,
        gasShare: gasMap.get(d.date)?.avgGasShare ?? null,
        resShare: gasMap.get(d.date)?.avgResShare ?? null,
        maxPrice, minPrice,
      }
    })
  }, [allDaily, prices.hourly, gasGenDaily])

  const eventIdx = chartData.findIndex(d => d.date >= eventDate)

  if (prices.loading) {
    return <div className="min-h-screen bg-[#F5F5F2] flex items-center justify-center"><p className="text-gray-400">Loading price data...</p></div>
  }

  const chartCommon = { margin: { top: 8, right: 12, bottom: 2, left: 5 } }
  const xAxisProps = { dataKey: 'label' as const, tick: { fontSize: 9, fill: '#9CA3AF' }, tickLine: false, axisLine: false, interval: Math.floor(chartData.length / 15) }
  const yAxisProps = { tick: { fontSize: 10, fill: '#9CA3AF' }, tickLine: false, axisLine: false }

  return (
    <div className="min-h-screen bg-[#F5F5F2]">
      {/* ─── Header ─── */}
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-[1440px] mx-auto px-8 py-3 flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold text-[#313131]">Geopolitical Event Impact on Dynamic Electricity Tariffs</h1>
            <p className="text-[10px] text-gray-400 mt-0.5">
              EPEX Spot DE day-ahead prices, {profile}-weighted | TTF gas (ICE Endex front-month settlement) | SMARD generation mix | February vs. March 2026
            </p>
          </div>
          <div className="flex items-center gap-3">
            {/* Profile selector pills */}
            <div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
              {PROFILES.map(p => (
                <button key={p.id} onClick={() => setProfile(p.id)}
                  className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${profile === p.id ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}
                  title={p.label}>
                  {p.short}
                </button>
              ))}
            </div>
            <div className="flex items-center gap-1.5">
              <label className="text-[9px] font-bold text-gray-400 uppercase">Fixed ref</label>
              <input type="range" min={20} max={45} step={0.5} value={fixedPrice} onChange={e => setFixedPrice(Number(e.target.value))}
                className="w-16 h-1.5 bg-gray-200 rounded-full appearance-none cursor-pointer accent-[#EA1C0A] [&::-webkit-slider-thumb]:w-3 [&::-webkit-slider-thumb]:h-3 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-[#313131] [&::-webkit-slider-thumb]:appearance-none" />
              <span className="text-[11px] tabular-nums font-semibold text-[#313131] w-10">{fixedPrice} ct</span>
            </div>
            <a href="/dynamic" className="text-[12px] font-semibold px-3 py-1.5 rounded-lg border border-gray-200 bg-white hover:bg-gray-50 text-gray-600 transition-colors">
              &larr; Back
            </a>
          </div>
        </div>
      </header>

      <main className="max-w-[1440px] mx-auto px-8 py-6 space-y-4">

        {/* ─── 1: EPEX DA Spot + TTF + Gas Generation (full timeline) ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">1</span>
                  <CardTitle className="text-base font-bold text-[#313131]">EPEX Spot DE Day-Ahead + TTF Gas + Generation Mix</CardTitle>
                </div>
                <p className="text-[11px] text-gray-400 mt-0.5">
                  Left axis: daily avg. DA spot price (ct/kWh, unweighted). Right axis: TTF front-month (EUR/MWh, purple), gas share of load (%, teal), RES share of load (%, green area).
                </p>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[340px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} {...chartCommon} margin={{ top: 8, right: 55, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis {...xAxisProps} />
                  <YAxis yAxisId="elec" {...yAxisProps} label={{ value: 'ct/kWh (gross)', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <YAxis yAxisId="right" orientation="right" {...yAxisProps} label={{ value: 'EUR/MWh | %', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                        <p className="tabular-nums">Spot avg: <b>{fmtNum(d.spot)} ct</b> | {profile}-weighted: <b>{fmtNum(d.weightedPrice)} ct</b></p>
                        {d.gas != null && <p className="tabular-nums">TTF front-month: <b className="text-purple-600">{fmtNum(d.gas)} EUR/MWh</b></p>}
                        {d.gasShare != null && <p className="tabular-nums">Gas share: <b className="text-teal-600">{fmtNum(d.gasShare, 1)}%</b> | RES share: <b className="text-emerald-600">{fmtNum(d.resShare ?? 0, 1)}%</b></p>}
                        <p className="tabular-nums">Spread: <b>{fmtNum(d.spread)} ct</b> (min {fmtNum(d.minPrice)}, max {fmtNum(d.maxPrice)})</p>
                      </div>
                    )
                  }} />
                  {eventIdx >= 0 && <ReferenceLine yAxisId="elec" x={eventIdx} stroke="#EA1C0A" strokeDasharray="6 3" strokeWidth={2}
                    label={{ value: 'Feb 28', position: 'top', style: { fontSize: 10, fill: '#EA1C0A', fontWeight: 700 } }} />}
                  {/* RES share area + Gas share line */}
                  <Area yAxisId="right" dataKey="resShare" type="monotone" fill={COLORS.green} fillOpacity={0.06} stroke={COLORS.green} strokeWidth={1} dot={false} connectNulls
                    name="RES share (%)" />
                  <Line yAxisId="right" dataKey="gasShare" type="monotone" stroke={COLORS.teal} strokeWidth={1.5} dot={false} connectNulls strokeDasharray="4 2"
                    name="Gas share (%)" />
                  {/* Spot bars */}
                  <Bar yAxisId="elec" dataKey="spot" fill="#94A3B8" fillOpacity={0.12} radius={[1, 1, 0, 0]} maxBarSize={3} />
                  {/* Rolling avgs */}
                  <Line yAxisId="elec" dataKey="r7" type="monotone" stroke={COLORS.amber} strokeWidth={1.5} dot={false} connectNulls />
                  <Line yAxisId="elec" dataKey="r14" type="monotone" stroke={COLORS.before} strokeWidth={2.5} dot={false} connectNulls />
                  {/* TTF gas price */}
                  <Line yAxisId="right" dataKey="gas" type="monotone" stroke={COLORS.gas} strokeWidth={2.5} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300/30" /> DA spot (ct/kWh)</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 1.5, backgroundColor: COLORS.amber }} /> 7d avg</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.before }} /> 14d avg</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.gas }} /> TTF front-month (EUR/MWh)</span>
              <span className="flex items-center gap-1"><span className="w-3 border-b-2 border-dashed" style={{ borderColor: COLORS.teal }} /> Gas share (%)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.green, opacity: 0.2 }} /> RES share (%)</span>
              <span className="text-[9px] text-gray-300 ml-auto">EPEX Spot | ICE Endex | SMARD BNetzA</span>
            </div>
          </CardContent>
        </Card>

        {/* ─── 2: Gas Generation — When Does Gas Set the Price? ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">2</span>
              <CardTitle className="text-base font-bold text-[#313131]">Gas Generation Profile — When Does Gas Set the Price?</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Average hourly gas-fired generation (MW) and gas share of load (%). Gas is always dispatched in DE — higher dispatch means more expensive marginal gas plants are running.
              {!genLoading && gasSettingHours.febTotal > 0 && (
                <span className="ml-1 font-medium">
                  Median gas dispatch: <span className="text-blue-600">{(gasSettingHours.febMedianMw / 1000).toFixed(1)} GW in Feb</span> vs. <span className="text-red-600">{(gasSettingHours.marMedianMw / 1000).toFixed(1)} GW in Mar</span>.
                  High-gas hours (above Feb median): <span className="text-blue-600">{fmtNum(gasSettingHours.febPct, 0)}%</span> vs. <span className="text-red-600">{fmtNum(gasSettingHours.marPct, 0)}%</span>.
                </span>
              )}
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            {genLoading ? (
              <p className="text-gray-400 text-[11px] py-8 text-center">Loading SMARD generation data...</p>
            ) : (
              <div className="grid grid-cols-2 gap-4">
                {/* Gas MW by hour */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 mb-2">Gas Generation by Hour (MW avg)</p>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={gasHourlyProfile} margin={{ top: 4, right: 8, bottom: 2, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                          label={{ value: 'MW', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                              <p className="font-semibold text-gray-700 mb-1">{d.label}</p>
                              <p className="tabular-nums"><span className="text-blue-600">Feb:</span> <b>{Math.round(d.febGasMw).toLocaleString()} MW</b></p>
                              <p className="tabular-nums"><span className="text-red-600">Mar:</span> <b>{Math.round(d.marGasMw).toLocaleString()} MW</b></p>
                              <p className="tabular-nums">Delta: <b className={d.marGasMw > d.febGasMw ? 'text-red-600' : 'text-emerald-600'}>{d.marGasMw > d.febGasMw ? '+' : ''}{Math.round(d.marGasMw - d.febGasMw).toLocaleString()} MW</b></p>
                            </div>
                          )
                        }} />
                        <Area dataKey="febGasMw" type="monotone" fill={COLORS.before} fillOpacity={0.1} stroke={COLORS.before} strokeWidth={2} dot={false} />
                        <Line dataKey="marGasMw" type="monotone" stroke={COLORS.after} strokeWidth={2.5} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="flex items-center gap-4 mt-1 text-[10px] text-gray-500">
                    <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: COLORS.before }} /> Feb 2026</span>
                    <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.after }} /> Mar 2026</span>
                  </div>
                </div>
                {/* Gas share of load by hour */}
                <div>
                  <p className="text-[10px] font-bold text-gray-400 mb-2">Gas Share of Grid Load by Hour (%)</p>
                  <div className="h-[200px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={gasHourlyProfile} margin={{ top: 4, right: 8, bottom: 2, left: 5 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval={2} />
                        <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                          label={{ value: '%', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                        <Tooltip content={({ active, payload }) => {
                          if (!active || !payload?.length) return null
                          const d = payload[0].payload
                          return (
                            <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                              <p className="font-semibold text-gray-700 mb-1">{d.label}</p>
                              <p className="tabular-nums"><span className="text-blue-600">Feb:</span> <b>{fmtNum(d.febGasShare, 1)}%</b></p>
                              <p className="tabular-nums"><span className="text-red-600">Mar:</span> <b>{fmtNum(d.marGasShare, 1)}%</b></p>
                            </div>
                          )
                        }} />
                        <Area dataKey="febGasShare" type="monotone" fill={COLORS.before} fillOpacity={0.1} stroke={COLORS.before} strokeWidth={2} dot={false} />
                        <Line dataKey="marGasShare" type="monotone" stroke={COLORS.after} strokeWidth={2.5} dot={false} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── 3: Gas Generation vs. Spot Price (scatter) ─── */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="shadow-sm border-gray-200/80">
            <CardHeader className="pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">3a</span>
                <CardTitle className="text-sm font-bold text-[#313131]">Gas Generation vs. DA Spot Price</CardTitle>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Hourly: gas-fired generation (MW) vs. EPEX Spot (ct/kWh). Higher gas dispatch correlates with higher spot prices.
              </p>
            </CardHeader>
            <CardContent className="pt-3">
              <div className="h-[240px]">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                    <XAxis type="number" dataKey="gasMw" name="Gas Gen" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                      label={{ value: 'Gas Generation (MW)', position: 'insideBottom', offset: -8, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                    <YAxis type="number" dataKey="spot" name="Spot" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                      label={{ value: 'EPEX DA Spot (ct/kWh)', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                    <Tooltip content={({ active, payload }) => {
                      if (!active || !payload?.length) return null
                      const d = payload[0].payload
                      return (
                        <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                          <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                          <p className="tabular-nums">Gas: <b>{d.gasMw.toLocaleString()} MW</b> | Spot: <b>{fmtNum(d.spot)} ct</b></p>
                        </div>
                      )
                    }} />
                    <Scatter data={gasPriceCorrelation.points} shape="circle">
                      {gasPriceCorrelation.points.map((entry, i) => (
                        <Cell key={i} fill={entry.isMarch ? COLORS.after : COLORS.before} fillOpacity={0.35} r={2.5} />
                      ))}
                    </Scatter>
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
              <div className="grid grid-cols-2 gap-2 mt-2">
                <div className="text-center rounded bg-blue-50/50 border border-blue-100 py-1.5">
                  <p className="text-[9px] text-gray-400 font-bold">Pearson r (Jan-Feb)</p>
                  <p className="text-[14px] font-bold tabular-nums text-blue-600">{fmtNum(gasPriceCorrelation.rFeb)}</p>
                </div>
                <div className="text-center rounded bg-red-50/50 border border-red-100 py-1.5">
                  <p className="text-[9px] text-gray-400 font-bold">Pearson r (Mar)</p>
                  <p className="text-[14px] font-bold tabular-nums text-red-600">{fmtNum(gasPriceCorrelation.rMar)}</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* TTF vs. DA Spot correlation */}
          <Card className="shadow-sm border-gray-200/80">
            <CardHeader className="pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">3b</span>
                <CardTitle className="text-sm font-bold text-[#313131]">TTF Front-Month vs. DA Spot Price</CardTitle>
              </div>
              <p className="text-[10px] text-gray-400 mt-0.5">
                Daily: ICE Endex TTF front-month settlement (EUR/MWh) vs. EPEX Spot daily avg (ct/kWh). Shows fuel cost transmission.
              </p>
            </CardHeader>
            <CardContent className="pt-3">
              {(() => {
                const pts = chartData.filter(d => d.gas != null && d.date >= '2026-01-01').map(d => ({
                  gas: d.gas!, spot: d.spot, date: d.date, isMarch: d.date >= marStart,
                }))
                const febPts = pts.filter(p => !p.isMarch)
                const marPts = pts.filter(p => p.isMarch)
                const rFeb = pearsonR(febPts.map(p => p.gas), febPts.map(p => p.spot))
                const rMar = pearsonR(marPts.map(p => p.gas), marPts.map(p => p.spot))
                return (
                  <>
                    <div className="h-[240px]">
                      <ResponsiveContainer width="100%" height="100%">
                        <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 5 }}>
                          <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                          <XAxis type="number" dataKey="gas" name="TTF" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                            label={{ value: 'TTF (EUR/MWh)', position: 'insideBottom', offset: -8, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                          <YAxis type="number" dataKey="spot" name="Spot" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                            label={{ value: 'EPEX DA Spot (ct/kWh)', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                          <Tooltip content={({ active, payload }) => {
                            if (!active || !payload?.length) return null
                            const d = payload[0].payload
                            return (
                              <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                                <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                                <p className="tabular-nums">TTF: <b className="text-purple-600">{fmtNum(d.gas)} EUR/MWh</b> | Spot: <b>{fmtNum(d.spot)} ct</b></p>
                              </div>
                            )
                          }} />
                          <Scatter data={pts} shape="circle">
                            {pts.map((entry, i) => (
                              <Cell key={i} fill={entry.isMarch ? COLORS.after : COLORS.before} fillOpacity={entry.isMarch ? 0.6 : 0.3} r={entry.isMarch ? 4 : 3} />
                            ))}
                          </Scatter>
                        </ScatterChart>
                      </ResponsiveContainer>
                    </div>
                    <div className="grid grid-cols-2 gap-2 mt-2">
                      <div className="text-center rounded bg-blue-50/50 border border-blue-100 py-1.5">
                        <p className="text-[9px] text-gray-400 font-bold">Pearson r (Jan-Feb)</p>
                        <p className="text-[14px] font-bold tabular-nums text-blue-600">{fmtNum(rFeb)}</p>
                      </div>
                      <div className="text-center rounded bg-red-50/50 border border-red-100 py-1.5">
                        <p className="text-[9px] text-gray-400 font-bold">Pearson r (Mar)</p>
                        <p className="text-[14px] font-bold tabular-nums text-red-600">{fmtNum(rMar)}</p>
                      </div>
                    </div>
                  </>
                )
              })()}
            </CardContent>
          </Card>
        </div>

        {/* ─── 4: Feb vs. Mar Hourly DA Price Shape ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">4</span>
              <CardTitle className="text-base font-bold text-[#313131]">Hourly DA Price Shape — February vs. March 2026</CardTitle>
            </div>
            <div className="flex items-center justify-between mt-0.5">
              <p className="text-[11px] text-gray-400">
                Average hourly EPEX Spot DA price (ct/kWh, unweighted). Note: other factors (weather, wind/solar output, demand) also differ between months &mdash; not solely attributable to conflict.
              </p>
              <div className="flex items-center gap-1.5 ml-4 shrink-0">
                <button
                  onClick={() => setShowGasOverlay(v => !v)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${showGasOverlay ? 'bg-teal-50 border-teal-300 text-teal-700 font-semibold' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}
                >Gas %</button>
                <button
                  onClick={() => setShowResOverlay(v => !v)}
                  className={`text-[10px] px-2 py-0.5 rounded-full border transition-colors ${showResOverlay ? 'bg-emerald-50 border-emerald-300 text-emerald-700 font-semibold' : 'bg-white border-gray-200 text-gray-400 hover:border-gray-300'}`}
                >RES %</button>
              </div>
            </div>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={hourlyData} margin={{ top: 8, right: (showGasOverlay || showResOverlay) ? 40 : 12, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval={2} />
                  <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <YAxis yAxisId="right" orientation="right"
                    tick={(showGasOverlay || showResOverlay) ? { fontSize: 9, fill: '#9CA3AF' } : false}
                    tickLine={false} axisLine={false} width={(showGasOverlay || showResOverlay) ? undefined : 0}
                    label={(showGasOverlay || showResOverlay) ? { value: '%', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#9CA3AF' } } : undefined}
                    domain={[0, (dataMax: number) => Math.ceil(dataMax / 10) * 10]} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{d.label}</p>
                        <p className="tabular-nums"><span className="text-blue-600">Feb price:</span> <b>{fmtNum(d.feb)} ct</b></p>
                        <p className="tabular-nums"><span className="text-red-600">Mar price:</span> <b>{fmtNum(d.mar)} ct</b></p>
                        <p className="tabular-nums">Delta: <b className={d.delta > 0 ? 'text-red-600' : 'text-emerald-600'}>{d.delta >= 0 ? '+' : ''}{fmtNum(d.delta)} ct</b></p>
                        {(showGasOverlay || showResOverlay) && <hr className="my-1 border-gray-100" />}
                        {showGasOverlay && <>
                          <p className="tabular-nums"><span className="text-teal-600">Gas share Feb:</span> <b>{fmtNum(d.febGasShare)}%</b></p>
                          <p className="tabular-nums"><span className="text-teal-400">Gas share Mar:</span> <b>{fmtNum(d.marGasShare)}%</b></p>
                        </>}
                        {showResOverlay && <>
                          <p className="tabular-nums"><span className="text-emerald-600">RES share Feb:</span> <b>{fmtNum(d.febResShare)}%</b></p>
                          <p className="tabular-nums"><span className="text-emerald-400">RES share Mar:</span> <b>{fmtNum(d.marResShare)}%</b></p>
                        </>}
                      </div>
                    )
                  }} />
                  {/* Price lines */}
                  <Area yAxisId="left" dataKey="feb" type="monotone" fill={COLORS.before} fillOpacity={0.08} stroke={COLORS.before} strokeWidth={2} dot={false} />
                  <Line yAxisId="left" dataKey="mar" type="monotone" stroke={COLORS.after} strokeWidth={2.5} dot={false} />
                  <Bar yAxisId="left" dataKey="delta" fill={COLORS.after} fillOpacity={0.1} radius={[1, 1, 0, 0]} maxBarSize={12} />
                  {/* Gas share overlay */}
                  {showGasOverlay && <>
                    <Line yAxisId="right" dataKey="febGasShare" type="monotone" stroke="#0D9488" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    <Line yAxisId="right" dataKey="marGasShare" type="monotone" stroke="#0D9488" strokeWidth={2} dot={false} />
                  </>}
                  {/* RES share overlay */}
                  {showResOverlay && <>
                    <Area yAxisId="right" dataKey="febResShare" type="monotone" fill="#059669" fillOpacity={0.04} stroke="#059669" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                    <Area yAxisId="right" dataKey="marResShare" type="monotone" fill="#059669" fillOpacity={0.08} stroke="#059669" strokeWidth={2} dot={false} />
                  </>}
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: COLORS.before }} /> Feb price</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.after }} /> Mar price</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.after, opacity: 0.15 }} /> Price delta</span>
              {showGasOverlay && <>
                <span className="flex items-center gap-1"><span className="w-3" style={{ height: 1.5, borderTop: '2px dashed #0D9488' }} /> Gas % Feb</span>
                <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: '#0D9488' }} /> Gas % Mar</span>
              </>}
              {showResOverlay && <>
                <span className="flex items-center gap-1"><span className="w-3" style={{ height: 1.5, borderTop: '2px dashed #059669' }} /> RES % Feb</span>
                <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: '#059669' }} /> RES % Mar</span>
              </>}
              <span className="text-[9px] text-gray-300 ml-auto">Caveat: seasonal/weather effects not isolated</span>
            </div>
          </CardContent>
        </Card>

        {/* ─── 4a: Weekly Price Curve with Gas Dispatch Overlay ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">4a</span>
              <CardTitle className="text-base font-bold text-[#313131]">Weekly Price Curve — Gas Dispatch Overlay</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Average hourly EPEX Spot DA price across a Mon–Sun week. <span className="font-semibold" style={{ color: '#7C3AED' }}>Purple area</span> = avg gas dispatch (GW, right axis).
              More gas dispatch → more expensive marginal plants running → higher spot price.
              {gasSettingHours.febTotal > 0 && (
                <span className="ml-1 font-medium">
                  Feb avg gas: <span className="text-blue-600">{(gasSettingHours.febMedianMw / 1000).toFixed(1)} GW</span> (median) vs. Mar: <span className="text-red-600">{(gasSettingHours.marMedianMw / 1000).toFixed(1)} GW</span>.
                </span>
              )}
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            {genLoading ? (
              <p className="text-gray-400 text-[11px] py-8 text-center">Loading generation data...</p>
            ) : (
              <div>
                <div className="h-[320px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={weeklyOverlayData} margin={{ top: 8, right: 45, bottom: 2, left: 5 }}>
                      <defs>
                        <linearGradient id="febGasGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.20} />
                          <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.03} />
                        </linearGradient>
                        <linearGradient id="marGasGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#7C3AED" stopOpacity={0.35} />
                          <stop offset="100%" stopColor="#7C3AED" stopOpacity={0.05} />
                        </linearGradient>
                      </defs>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                      <XAxis dataKey="idx" tick={(props: Record<string, unknown>) => {
                        const x = Number(props.x ?? 0), y = Number(props.y ?? 0)
                        const val = (props.payload as { value?: number })?.value ?? 0
                        const d = weeklyOverlayData[val]
                        if (!d) return <text />
                        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                        if (d.hour === 0) return <text x={x} y={y + 12} textAnchor="middle" fontSize={9} fontWeight={600} fill="#6B7280">{dayNames[d.day]}</text>
                        if (d.hour === 12) return <text x={x} y={y + 12} textAnchor="middle" fontSize={8} fill="#D1D5DB">12h</text>
                        return <text />
                      }} tickLine={false} axisLine={false} interval={0} />
                      <YAxis yAxisId="price" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                      <YAxis yAxisId="gas" orientation="right" tick={{ fontSize: 9, fill: '#A78BFA' }} tickLine={false} axisLine={false}
                        label={{ value: 'Gas GW', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#A78BFA' } }} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
                        return (
                          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                            <p className="font-semibold text-gray-700 mb-1">{dayNames[d.day]} {String(d.hour).padStart(2, '0')}:00</p>
                            <p className="tabular-nums"><span className="text-blue-600">Feb price:</span> <b>{fmtNum(d.febPrice)} ct</b></p>
                            <p className="tabular-nums"><span className="text-red-600">Mar price:</span> <b>{fmtNum(d.marPrice)} ct</b></p>
                            <p className="tabular-nums">Delta: <b className={d.delta > 0 ? 'text-red-600' : 'text-emerald-600'}>{d.delta >= 0 ? '+' : ''}{fmtNum(d.delta)} ct</b></p>
                            <hr className="my-1 border-gray-100" />
                            <p className="tabular-nums"><span className="text-purple-400">Feb gas:</span> <b>{fmtNum(d.febGasMw, 1)} GW</b></p>
                            <p className="tabular-nums"><span className="text-purple-600">Mar gas:</span> <b>{fmtNum(d.marGasMw, 1)} GW</b></p>
                          </div>
                        )
                      }} />
                      {/* Day separator lines (every 96 QH slots) */}
                      {[1, 2, 3, 4, 5, 6].map(d => (
                        <ReferenceLine key={`day-${d}`} yAxisId="price" x={d * SLOTS_PER_DAY} stroke="#E5E7EB" strokeWidth={1} />
                      ))}
                      {/* Gas dispatch areas — Feb lighter, Mar darker */}
                      <Area yAxisId="gas" dataKey="febGasMw" type="monotone" fill="url(#febGasGrad)" stroke="#A78BFA" strokeWidth={0.5} strokeOpacity={0.4} dot={false} />
                      <Area yAxisId="gas" dataKey="marGasMw" type="monotone" fill="none" stroke="#7C3AED" strokeWidth={1.5} strokeDasharray="4 2" dot={false} />
                      {/* Price curves */}
                      <Area yAxisId="price" dataKey="febPrice" type="monotone" fill={COLORS.before} fillOpacity={0.06} stroke={COLORS.before} strokeWidth={1.5} dot={false} />
                      <Line yAxisId="price" dataKey="marPrice" type="monotone" stroke={COLORS.after} strokeWidth={2.5} dot={false} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
                <div className="flex items-center flex-wrap gap-x-4 gap-y-1 mt-2 text-[10px] text-gray-500">
                  <span className="flex items-center gap-1"><span className="w-3" style={{ height: 1.5, backgroundColor: COLORS.before }} /> Feb avg price</span>
                  <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.after }} /> Mar avg price</span>
                  <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: '#7C3AED', opacity: 0.2 }} /> Feb gas dispatch (GW)</span>
                  <span className="flex items-center gap-1"><span className="w-3 border-b-2 border-dashed" style={{ borderColor: '#7C3AED' }} /> Mar gas dispatch (GW)</span>
                  <span className="text-[9px] text-gray-300 ml-auto">SMARD generation + EPEX Spot</span>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* ─── 4b: 15-min Price Distribution — Combined Boxplot ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">4b</span>
              <CardTitle className="text-base font-bold text-[#313131]">Price Distribution by Time of Day — 15-min Resolution</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Overlaid IQR bands (Q25–Q75) and median lines for <span className="text-blue-600 font-semibold">February</span> vs. <span className="text-red-600 font-semibold">March</span>. Dashed = min/max whiskers. Shows both level shift and increased volatility.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={qhBoxplotData} margin={{ top: 8, right: 12, bottom: 2, left: 5 }}>
                  <defs>
                    <linearGradient id="iqrFeb" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#2563EB" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#2563EB" stopOpacity={0.03} />
                    </linearGradient>
                    <linearGradient id="iqrMar" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#EA1C0A" stopOpacity={0.12} />
                      <stop offset="100%" stopColor="#EA1C0A" stopOpacity={0.03} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#9CA3AF' }} tickLine={false} axisLine={false} interval={7} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    const h = Math.floor(d.idx / 4), m = (d.idx % 4) * 15
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{String(h).padStart(2, '0')}:{String(m).padStart(2, '0')}</p>
                        <div className="grid grid-cols-2 gap-x-4 gap-y-0.5">
                          <p className="text-blue-600 font-semibold">February</p>
                          <p className="text-red-600 font-semibold">March</p>
                          <p className="tabular-nums">Max: {fmtNum(d.febMax)}</p>
                          <p className="tabular-nums">Max: {fmtNum(d.marMax)}</p>
                          <p className="tabular-nums">Q75: {fmtNum(d.febQ75)}</p>
                          <p className="tabular-nums">Q75: {fmtNum(d.marQ75)}</p>
                          <p className="tabular-nums font-bold">Med: {fmtNum(d.febMedian)}</p>
                          <p className="tabular-nums font-bold">Med: {fmtNum(d.marMedian)}</p>
                          <p className="tabular-nums">Q25: {fmtNum(d.febQ25)}</p>
                          <p className="tabular-nums">Q25: {fmtNum(d.marQ25)}</p>
                          <p className="tabular-nums">Min: {fmtNum(d.febMin)}</p>
                          <p className="tabular-nums">Min: {fmtNum(d.marMin)}</p>
                        </div>
                      </div>
                    )
                  }} />
                  {/* Feb IQR band + whiskers */}
                  <Area dataKey="febQ75" type="monotone" fill="url(#iqrFeb)" stroke={COLORS.before} strokeWidth={0.5} strokeOpacity={0.3} dot={false} />
                  <Area dataKey="febQ25" type="monotone" fill="#FFFFFF" stroke={COLORS.before} strokeWidth={0.5} strokeOpacity={0.3} dot={false} />
                  <Line dataKey="febMax" type="monotone" stroke={COLORS.before} strokeWidth={0.5} strokeOpacity={0.25} strokeDasharray="2 3" dot={false} />
                  <Line dataKey="febMin" type="monotone" stroke={COLORS.before} strokeWidth={0.5} strokeOpacity={0.25} strokeDasharray="2 3" dot={false} />
                  <Line dataKey="febMedian" type="monotone" stroke={COLORS.before} strokeWidth={2} dot={false} />
                  {/* Mar IQR band + whiskers */}
                  <Area dataKey="marQ75" type="monotone" fill="url(#iqrMar)" stroke={COLORS.after} strokeWidth={0.5} strokeOpacity={0.3} dot={false} />
                  <Area dataKey="marQ25" type="monotone" fill="none" stroke={COLORS.after} strokeWidth={0.5} strokeOpacity={0.3} dot={false} />
                  <Line dataKey="marMax" type="monotone" stroke={COLORS.after} strokeWidth={0.5} strokeOpacity={0.25} strokeDasharray="2 3" dot={false} />
                  <Line dataKey="marMin" type="monotone" stroke={COLORS.after} strokeWidth={0.5} strokeOpacity={0.25} strokeDasharray="2 3" dot={false} />
                  <Line dataKey="marMedian" type="monotone" stroke={COLORS.after} strokeWidth={2.5} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: COLORS.before }} /> Feb median</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.before, opacity: 0.15 }} /> Feb IQR</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.after }} /> Mar median</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.after, opacity: 0.15 }} /> Mar IQR</span>
              <span className="flex items-center gap-1"><span className="w-3 border-t border-dashed border-gray-300" /> Min/Max</span>
              <span className="text-[9px] text-gray-300 ml-auto">SMARD 15-min prices</span>
            </div>
          </CardContent>
        </Card>

        {/* ─── S: The Spread Story — 3 charts ─── */}
        <div className="relative">
          <div className="absolute -top-2 left-0 right-0 border-t-2 border-dashed border-amber-300/50" />
          <p className="text-[10px] font-bold text-amber-600 uppercase tracking-wider mt-3 mb-3">Why did spreads explode in March?</p>
        </div>

        {/* S1: Daily price corridor — the widening band */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1.5 py-0.5">S1</span>
              <CardTitle className="text-base font-bold text-[#313131]">The Widening Corridor — Daily Price Range</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Each bar shows the daily min-to-max price range. The corridor blows wide open in March: cheaper lows + more expensive peaks = massive spread increase.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[280px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={dailyBandData} margin={{ top: 8, right: 12, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 8, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    interval={Math.floor(dailyBandData.length / 12)} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                        <p className="tabular-nums">Max: <b className="text-red-500">{fmtNum(d.max)} ct</b></p>
                        <p className="tabular-nums">Min: <b className="text-blue-500">{fmtNum(d.min)} ct</b></p>
                        <p className="tabular-nums font-bold">Spread: <b className="text-amber-600">{fmtNum(d.spread)} ct</b></p>
                      </div>
                    )
                  }} />
                  <ReferenceLine y={0} stroke="#9CA3AF" strokeWidth={0.5} />
                  {/* Feb 28 event line */}
                  {(() => {
                    const idx = dailyBandData.findIndex(d => d.date >= eventDate)
                    return idx >= 0 ? <ReferenceLine x={dailyBandData[idx].label} stroke="#EA1C0A" strokeDasharray="6 3" strokeWidth={2}
                      label={{ value: 'Feb 28', position: 'top', style: { fontSize: 10, fill: '#EA1C0A', fontWeight: 700 } }} /> : null
                  })()}
                  {/* Max line (ceiling) */}
                  <Line dataKey="max" type="monotone" stroke="#EF4444" strokeWidth={1.5} dot={false} />
                  {/* Min line (floor) */}
                  <Line dataKey="min" type="monotone" stroke="#3B82F6" strokeWidth={1.5} dot={false} />
                  {/* Spread as filled area between min and max */}
                  <Area dataKey="max" type="monotone" fill="none" stroke="none" />
                  {dailyBandData.map((d, i) => {
                    // We can't do a true between-area in Recharts, so use bars for spread
                    return null
                  })}
                  {/* Spread bars */}
                  <Bar dataKey="spread" maxBarSize={4} radius={[1, 1, 0, 0]}>
                    {dailyBandData.map((d, i) => (
                      <Cell key={i} fill={d.isMarch ? '#F59E0B' : '#94A3B8'} fillOpacity={d.isMarch ? 0.5 : 0.25} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Summary callout */}
            <div className="grid grid-cols-3 gap-3 mt-3">
              {[
                { label: 'Avg daily spread', feb: dailyBandData.filter(d => !d.isMarch).reduce((s, d) => s + d.spread, 0) / (dailyBandData.filter(d => !d.isMarch).length || 1), mar: dailyBandData.filter(d => d.isMarch).reduce((s, d) => s + d.spread, 0) / (dailyBandData.filter(d => d.isMarch).length || 1), unit: 'ct' },
                { label: 'Avg daily low', feb: dailyBandData.filter(d => !d.isMarch).reduce((s, d) => s + d.min, 0) / (dailyBandData.filter(d => !d.isMarch).length || 1), mar: dailyBandData.filter(d => d.isMarch).reduce((s, d) => s + d.min, 0) / (dailyBandData.filter(d => d.isMarch).length || 1), unit: 'ct' },
                { label: 'Avg daily high', feb: dailyBandData.filter(d => !d.isMarch).reduce((s, d) => s + d.max, 0) / (dailyBandData.filter(d => !d.isMarch).length || 1), mar: dailyBandData.filter(d => d.isMarch).reduce((s, d) => s + d.max, 0) / (dailyBandData.filter(d => d.isMarch).length || 1), unit: 'ct' },
              ].map(m => (
                <div key={m.label} className="text-center rounded-lg bg-gray-50 border border-gray-100 py-2">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">{m.label}</p>
                  <div className="flex items-center justify-center gap-2 mt-1">
                    <span className="text-[13px] font-bold tabular-nums text-blue-600">{fmtNum(m.feb)}</span>
                    <span className="text-[11px] text-gray-300">→</span>
                    <span className="text-[13px] font-bold tabular-nums text-red-600">{fmtNum(m.mar)}</span>
                    <span className="text-[10px] font-bold tabular-nums text-amber-600">({m.mar > m.feb ? '+' : ''}{fmtNum(m.mar - m.feb)} {m.unit})</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 1.5, backgroundColor: '#EF4444' }} /> Daily max</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 1.5, backgroundColor: '#3B82F6' }} /> Daily min</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-300" /> Feb spread</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400" /> Mar spread</span>
            </div>
          </CardContent>
        </Card>

        {/* S2: Two Forces — Solar midday vs Gas evening */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1.5 py-0.5">S2</span>
              <CardTitle className="text-base font-bold text-[#313131]">Two Forces — Solar Surplus vs. Gas Peaks</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              The spread widened from <b>both sides</b>. Solar midday hours got cheaper (spring = 3× more solar). Evening gas hours got more expensive (TTF nearly doubled).
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-6">
              {/* Left: Grouped bar chart — prices by time block */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 mb-2">Avg Spot Price by Time Block (ct/kWh)</p>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={twoForcesData} layout="vertical" margin={{ top: 4, right: 12, bottom: 2, left: 70 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#6B7280', fontWeight: 600 }} tickLine={false} axisLine={false} width={65} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        label={{ value: 'ct/kWh', position: 'insideBottom', offset: -2, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                            <p className="font-semibold text-gray-700 mb-1">{d.label}</p>
                            <p className="tabular-nums"><span className="text-blue-600">Feb:</span> <b>{fmtNum(d.febPrice)} ct</b></p>
                            <p className="tabular-nums"><span className="text-red-600">Mar:</span> <b>{fmtNum(d.marPrice)} ct</b></p>
                            <p className="tabular-nums font-bold">Delta: <span className={d.delta > 0 ? 'text-red-600' : 'text-emerald-600'}>{d.delta >= 0 ? '+' : ''}{fmtNum(d.delta)} ct</span></p>
                            <hr className="my-1 border-gray-100" />
                            <p className="tabular-nums text-gray-400">Gas: {fmtNum(d.febGasMw, 1)} → {fmtNum(d.marGasMw, 1)} GW</p>
                            <p className="tabular-nums text-gray-400">RES: {fmtNum(d.febResShare, 0)} → {fmtNum(d.marResShare, 0)}%</p>
                          </div>
                        )
                      }} />
                      <Bar dataKey="febPrice" fill={COLORS.before} fillOpacity={0.7} barSize={12} radius={[0, 3, 3, 0]} />
                      <Bar dataKey="marPrice" fill={COLORS.after} fillOpacity={0.7} barSize={12} radius={[0, 3, 3, 0]} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
              {/* Right: The delta + explanation */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 mb-2">Price Change by Time Block (ct/kWh)</p>
                <div className="h-[240px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={twoForcesData} layout="vertical" margin={{ top: 4, right: 12, bottom: 2, left: 70 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" horizontal={false} />
                      <YAxis type="category" dataKey="label" tick={{ fontSize: 10, fill: '#6B7280', fontWeight: 600 }} tickLine={false} axisLine={false} width={65} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                        domain={[(min: number) => Math.min(min, -2), (max: number) => Math.max(max, 3)]} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                            <p className="font-semibold text-gray-700 mb-1">{d.label}</p>
                            <p className="tabular-nums font-bold">Δ Price: <span className={d.delta > 0 ? 'text-red-600' : 'text-emerald-600'}>{d.delta >= 0 ? '+' : ''}{fmtNum(d.delta)} ct</span></p>
                            <p className="tabular-nums text-gray-400">Gas Δ: {d.marGasMw > d.febGasMw ? '+' : ''}{fmtNum(d.marGasMw - d.febGasMw, 1)} GW</p>
                            <p className="tabular-nums text-gray-400">RES Δ: {d.marResShare > d.febResShare ? '+' : ''}{fmtNum(d.marResShare - d.febResShare, 0)}%</p>
                          </div>
                        )
                      }} />
                      <ReferenceLine x={0} stroke="#9CA3AF" strokeWidth={1} />
                      <Bar dataKey="delta" barSize={18} radius={[0, 4, 4, 0]}>
                        {twoForcesData.map((d, i) => (
                          <Cell key={i} fill={d.delta > 0 ? '#EF4444' : '#10B981'} fillOpacity={0.7} />
                        ))}
                      </Bar>
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
            {/* Annotation boxes */}
            <div className="grid grid-cols-2 gap-4 mt-3">
              <div className="rounded-lg bg-emerald-50/50 border border-emerald-200/50 p-3">
                <p className="text-[11px] font-bold text-emerald-700">Solar surplus pushes lows down</p>
                <p className="text-[10px] text-emerald-600/80 mt-0.5">
                  Spring transition: solar output tripled (3.8 → 10.1 GW avg). Midday hours see RES shares above 80–100%, flooding the market and pushing prices toward zero or negative.
                </p>
              </div>
              <div className="rounded-lg bg-red-50/50 border border-red-200/50 p-3">
                <p className="text-[11px] font-bold text-red-700">Gas cost drives peaks up</p>
                <p className="text-[10px] text-red-600/80 mt-0.5">
                  TTF gas nearly doubled (31 → 55 EUR/MWh). Evening hours when gas sets the clearing price see the full cost pass-through: every €1/MWh TTF increase ≈ +0.1 ct/kWh on spot.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.before, opacity: 0.7 }} /> February</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.after, opacity: 0.7 }} /> March</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-400" /> Cheaper (solar effect)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-red-400" /> More expensive (gas effect)</span>
            </div>
          </CardContent>
        </Card>

        {/* S3: Price Histogram — Distribution shift */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1.5 py-0.5">S3</span>
              <CardTitle className="text-base font-bold text-[#313131]">Price Distribution — Fat Tails in March</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Histogram of hourly prices (% of hours in each 2 ct/kWh bin). February is concentrated in the middle. March develops fat tails on <b>both</b> sides — more extreme hours in both directions.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[260px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={histogramData} margin={{ top: 8, right: 12, bottom: 16, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'Price bin (ct/kWh)', position: 'insideBottom', offset: -8, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <YAxis tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: '% of hours', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{d.bucket} – {d.bucket + 2} ct/kWh</p>
                        <p className="tabular-nums"><span className="text-blue-600">Feb:</span> <b>{fmtNum(d.febPct, 1)}%</b> of hours</p>
                        <p className="tabular-nums"><span className="text-red-600">Mar:</span> <b>{fmtNum(d.marPct, 1)}%</b> of hours</p>
                      </div>
                    )
                  }} />
                  <Bar dataKey="febPct" fill={COLORS.before} fillOpacity={0.5} barSize={16} radius={[2, 2, 0, 0]} />
                  <Bar dataKey="marPct" fill={COLORS.after} fillOpacity={0.5} barSize={16} radius={[2, 2, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Key stat callouts */}
            <div className="grid grid-cols-4 gap-2 mt-3">
              {[
                { label: 'Hours < 2 ct', feb: '14', mar: '83', icon: '↓', accent: 'text-blue-600' },
                { label: 'Negative hours', feb: '7', mar: '30', icon: '↓↓', accent: 'text-blue-700' },
                { label: 'Hours > 15 ct', feb: '12', mar: '101', icon: '↑', accent: 'text-red-600' },
                { label: 'Hours > 20 ct', feb: '1', mar: '19', icon: '↑↑', accent: 'text-red-700' },
              ].map(s => (
                <div key={s.label} className="text-center rounded-lg bg-gray-50 border border-gray-100 py-2">
                  <p className="text-[9px] text-gray-400 font-bold uppercase">{s.label}</p>
                  <div className="flex items-center justify-center gap-1.5 mt-1">
                    <span className="text-[12px] font-bold tabular-nums text-blue-600">{s.feb}</span>
                    <span className="text-[11px] text-gray-300">→</span>
                    <span className={`text-[14px] font-bold tabular-nums ${s.accent}`}>{s.mar}</span>
                  </div>
                </div>
              ))}
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.before, opacity: 0.5 }} /> February</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: COLORS.after, opacity: 0.5 }} /> March</span>
              <span className="text-[9px] text-gray-300 ml-auto">Same avg (~10 ct), completely different distribution</span>
            </div>
          </CardContent>
        </Card>

        {/* ─── Fact 1: Wider Spreads, Same Weighted Average ─── */}
        {factChartData && (
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1.5 py-0.5">F1</span>
              <CardTitle className="text-base font-bold text-[#313131]">Wider Spreads, Same Bill — The {profile} Averaging Effect</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              March has <b>cheaper lows</b> (solar midday) and <b>more expensive peaks</b> (gas evening) — but the {profile}-weighted average barely moved.
              The load profile spreads consumption across all hours, so cheap and expensive cancel out.
            </p>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={factChartData.hourlyDetail} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="price" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <YAxis yAxisId="weight" orientation="right" tick={{ fontSize: 9, fill: '#D4D4D4' }} tickLine={false} axisLine={false}
                    label={{ value: '% consumption', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#D4D4D4' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    const delta = d.marSpot - d.febSpot
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{String(d.hour).padStart(2, '0')}:00</p>
                        <p className="tabular-nums"><span className="text-blue-600">Feb:</span> <b>{fmtNum(d.febSpot)} ct</b></p>
                        <p className="tabular-nums"><span className="text-red-600">Mar:</span> <b>{fmtNum(d.marSpot)} ct</b></p>
                        <p className={`tabular-nums font-bold ${delta > 0 ? 'text-red-500' : 'text-emerald-500'}`}>Δ: {delta >= 0 ? '+' : ''}{fmtNum(delta)} ct</p>
                        <p className="tabular-nums text-gray-400">{profile} weight: {fmtNum(d.h25Weight, 1)}% of daily kWh</p>
                      </div>
                    )
                  }} />
                  {/* H25 consumption weight as subtle area */}
                  <Area yAxisId="weight" dataKey="h25Weight" type="monotone" fill="#D4D4D4" fillOpacity={0.25} stroke="#D4D4D4" strokeWidth={0.5} dot={false} />
                  {/* Feb spot profile */}
                  <Line yAxisId="price" dataKey="febSpot" type="monotone" stroke={COLORS.before} strokeWidth={2} dot={false} />
                  {/* Mar spot profile */}
                  <Line yAxisId="price" dataKey="marSpot" type="monotone" stroke={COLORS.after} strokeWidth={2.5} dot={false} />
                  {/* Weighted average reference lines */}
                  <ReferenceLine yAxisId="price" y={factChartData.febWeightedAvg} stroke={COLORS.before} strokeDasharray="6 3" strokeWidth={1.5}
                    label={{ value: `Feb avg: ${fmtNum(factChartData.febWeightedAvg)} ct`, position: 'left', style: { fontSize: 9, fill: COLORS.before, fontWeight: 700 } }} />
                  <ReferenceLine yAxisId="price" y={factChartData.marWeightedAvg} stroke={COLORS.after} strokeDasharray="6 3" strokeWidth={1.5}
                    label={{ value: `Mar avg: ${fmtNum(factChartData.marWeightedAvg)} ct`, position: 'right', style: { fontSize: 9, fill: COLORS.after, fontWeight: 700 } }} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Key stats row */}
            <div className="grid grid-cols-4 gap-3">
              <div className="text-center rounded-lg bg-blue-50/50 border border-blue-100 py-2">
                <p className="text-[9px] text-blue-400 font-bold uppercase">Feb {profile}-weighted</p>
                <p className="text-[15px] font-bold tabular-nums text-blue-600">{fmtNum(factChartData.febWeightedAvg)} ct</p>
              </div>
              <div className="text-center rounded-lg bg-red-50/50 border border-red-100 py-2">
                <p className="text-[9px] text-red-400 font-bold uppercase">Mar {profile}-weighted</p>
                <p className="text-[15px] font-bold tabular-nums text-red-600">{fmtNum(factChartData.marWeightedAvg)} ct</p>
              </div>
              <div className="text-center rounded-lg bg-gray-50 border border-gray-100 py-2">
                <p className="text-[9px] text-gray-400 font-bold uppercase">Delta</p>
                <p className={`text-[15px] font-bold tabular-nums ${factChartData.marWeightedAvg - factChartData.febWeightedAvg > 0.5 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {factChartData.marWeightedAvg - factChartData.febWeightedAvg >= 0 ? '+' : ''}{fmtNum(factChartData.marWeightedAvg - factChartData.febWeightedAvg)} ct
                </p>
              </div>
              <div className="text-center rounded-lg bg-gray-50 border border-gray-100 py-2">
                <p className="text-[9px] text-gray-400 font-bold uppercase">Monthly cost Δ</p>
                <p className={`text-[15px] font-bold tabular-nums ${factChartData.marCost30 - factChartData.febCost30 > 1 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {factChartData.marCost30 - factChartData.febCost30 >= 0 ? '+' : ''}{fmtNum(factChartData.marCost30 - factChartData.febCost30)} €
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: COLORS.before }} /> Feb spot profile</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.after }} /> Mar spot profile</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-gray-200" /> {profile} consumption weight</span>
              <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed border-blue-500" /> Weighted avg</span>
              <span className="text-[9px] text-gray-300 ml-auto">BDEW {profile} WT profile | EPEX Spot</span>
            </div>
          </CardContent>
        </Card>
        )}

        {/* ─── Fact 2: What Drives Cheap and Expensive Hours ─── */}
        {factChartData && (
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-white bg-amber-500 rounded px-1.5 py-0.5">F2</span>
              <CardTitle className="text-base font-bold text-[#313131]">What Drives Cheap and Expensive Hours</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              <b>Cheap hours</b> (midday) are driven by high renewable share — more solar in March pushes prices to zero.{' '}
              <b>Expensive hours</b> (evening) are driven by gas costs — with TTF nearly doubled, the CSS (Clean Spark Spread = Spot − Gas costs) shows where gas plants are profitable and price-setting.
            </p>
          </CardHeader>
          <CardContent className="pt-4 space-y-4">
            {/* Chart: RES share + price delta + CSS profitability */}
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={factChartData.hourlyDetail} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis dataKey="label" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
                  <YAxis yAxisId="share" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: '% of load', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <YAxis yAxisId="css" orientation="right" tick={{ fontSize: 9, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
                    label={{ value: 'CSS ≥ 0 (%)', angle: 90, position: 'insideRight', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{String(d.hour).padStart(2, '0')}:00</p>
                        <div className="space-y-0.5">
                          <p className="tabular-nums"><span className="text-emerald-600">RES share:</span> Feb {fmtNum(d.febResShare, 1)}% → Mar <b>{fmtNum(d.marResShare, 1)}%</b></p>
                          <p className="tabular-nums"><span className="text-purple-600">CSS ≥ 0:</span> <b>{fmtNum(d.marCssPositivePct, 0)}%</b> of March days (gas profitable)</p>
                          <p className="tabular-nums text-gray-400">Spot: Feb {fmtNum(d.febSpot)} → Mar {fmtNum(d.marSpot)} ct ({(d.marSpot - d.febSpot) >= 0 ? '+' : ''}{fmtNum(d.marSpot - d.febSpot)})</p>
                        </div>
                      </div>
                    )
                  }} />
                  {/* Highlight CSS ≥ 0 zones (gas profitable hours) as background bars */}
                  <Bar yAxisId="css" dataKey="marCssPositivePct" maxBarSize={20} radius={[2, 2, 0, 0]} fillOpacity={0.15}>
                    {factChartData.hourlyDetail.map((d, i) => (
                      <Cell key={i} fill={d.marCssPositivePct > 50 ? '#7C3AED' : '#D4D4D4'} />
                    ))}
                  </Bar>
                  {/* Feb RES share */}
                  <Line yAxisId="share" dataKey="febResShare" type="monotone" stroke={COLORS.green} strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
                  {/* Mar RES share */}
                  <Line yAxisId="share" dataKey="marResShare" type="monotone" stroke={COLORS.green} strokeWidth={2.5} dot={false} />
                  {/* Reference line at 50% CSS */}
                  <ReferenceLine yAxisId="css" y={50} stroke="#7C3AED" strokeDasharray="3 3" strokeWidth={0.5} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            {/* Explanation callouts */}
            <div className="grid grid-cols-2 gap-4">
              <div className="rounded-lg bg-emerald-50/50 border border-emerald-200/50 p-3">
                <p className="text-[11px] font-bold text-emerald-700">Cheap hours: renewables flood the market</p>
                <p className="text-[10px] text-emerald-600/80 mt-0.5">
                  10–15h: RES share reaches {fmtNum(Math.max(...factChartData.hourlyDetail.filter(d => d.hour >= 10 && d.hour <= 15).map(d => d.marResShare)), 0)}% in March
                  (vs. {fmtNum(Math.max(...factChartData.hourlyDetail.filter(d => d.hour >= 10 && d.hour <= 15).map(d => d.febResShare)), 0)}% in Feb).
                  More solar → prices crash to {fmtNum(Math.min(...factChartData.hourlyDetail.filter(d => d.hour >= 10 && d.hour <= 15).map(d => d.marSpot)))} ct.
                  Gas is unprofitable (CSS &lt; 0) — only{' '}
                  {fmtNum(factChartData.hourlyDetail.filter(d => d.hour >= 10 && d.hour <= 15).reduce((s, d) => s + d.marCssPositivePct, 0) / 6, 0)}% of midday hours have CSS ≥ 0.
                </p>
              </div>
              <div className="rounded-lg bg-purple-50/50 border border-purple-200/50 p-3">
                <p className="text-[11px] font-bold text-purple-700">Expensive hours: gas costs set the price</p>
                <p className="text-[10px] text-purple-600/80 mt-0.5">
                  16–20h: RES share drops to {fmtNum(Math.min(...factChartData.hourlyDetail.filter(d => d.hour >= 16 && d.hour <= 20).map(d => d.marResShare)), 0)}%.
                  Gas becomes profitable — CSS ≥ 0 in{' '}
                  {fmtNum(factChartData.hourlyDetail.filter(d => d.hour >= 16 && d.hour <= 20).reduce((s, d) => s + d.marCssPositivePct, 0) / 5, 0)}% of evening hours.
                  With TTF near doubled, the gas marginal cost pushes spot to {fmtNum(Math.max(...factChartData.hourlyDetail.filter(d => d.hour >= 16 && d.hour <= 20).map(d => d.marSpot)))} ct — the price peak.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-4 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2.5, backgroundColor: COLORS.green }} /> Mar RES share</span>
              <span className="flex items-center gap-1"><span className="w-3 border-t-2 border-dashed" style={{ borderColor: COLORS.green }} /> Feb RES share</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-purple-400" style={{ opacity: 0.3 }} /> CSS ≥ 0 (gas profitable)</span>
              <span className="text-[9px] text-gray-300 ml-auto">CSS = Spot − (Gas/η + CO₂) | SMARD + EPEX SPOT</span>
            </div>
          </CardContent>
        </Card>
        )}

        {/* ─── 5: Peak / Off-Peak + DA Spread ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">5</span>
              <CardTitle className="text-base font-bold text-[#313131]">Peak vs. Off-Peak + Daily DA Spread</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              Peak (WT 8-20h) and off-peak (7d rolling avg). Daily DA spread = max minus min hourly price within each day. Gas lifts peak hours while renewables keep midday cheap &rarr; wider spread = more arbitrage value.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} {...chartCommon}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis {...xAxisProps} />
                  <YAxis {...yAxisProps} label={{ value: 'ct/kWh', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                        <p className="tabular-nums">Peak 7d: <b className="text-amber-600">{fmtNum(d.peak ?? 0)}</b> | Off-peak 7d: <b className="text-blue-600">{fmtNum(d.offPeak ?? 0)}</b></p>
                        <p className="tabular-nums">Peak-offpeak delta: <b>{fmtNum(d.peakDelta)}</b> ct | DA spread: <b>{fmtNum(d.spread)}</b> ct</p>
                      </div>
                    )
                  }} />
                  {eventIdx >= 0 && <ReferenceLine x={eventIdx} stroke="#EA1C0A" strokeDasharray="6 3" strokeWidth={2} />}
                  <Bar dataKey="spread" fill="#F59E0B" fillOpacity={0.15} radius={[1, 1, 0, 0]} maxBarSize={4} />
                  <Line dataKey="peak" type="monotone" stroke={COLORS.amber} strokeWidth={2} dot={false} connectNulls />
                  <Line dataKey="offPeak" type="monotone" stroke={COLORS.before} strokeWidth={2} dot={false} connectNulls />
                  <Area dataKey="peakDelta" type="monotone" fill="#9CA3AF" fillOpacity={0.05} stroke="#9CA3AF" strokeWidth={1} strokeDasharray="3 2" dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-4 mt-2 text-[10px] text-gray-500">
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: COLORS.amber }} /> Peak (7d avg)</span>
              <span className="flex items-center gap-1"><span className="w-3" style={{ height: 2, backgroundColor: COLORS.before }} /> Off-peak (7d avg)</span>
              <span className="flex items-center gap-1"><span className="w-2.5 h-2.5 rounded-sm bg-amber-200" /> Daily DA spread</span>
            </div>
          </CardContent>
        </Card>

        {/* ─── 6: Generation Mix vs. Spread & Price Extremes ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">6</span>
              <CardTitle className="text-base font-bold text-[#313131]">Generation Mix vs. DA Spread & Price Extremes</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              How gas share and renewable share relate to daily DA spread and max/min prices. High gas share + low RES = wider spreads and higher price spikes.
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="grid grid-cols-2 gap-4">
              {/* Left: Gas/RES share vs spread (scatter) */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 mb-2">Gas Share vs. Daily DA Spread</p>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis type="number" dataKey="gasShare" name="Gas Share" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                        label={{ value: 'Gas share of load (%)', position: 'insideBottom', offset: -8, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                      <YAxis type="number" dataKey="spread" name="Spread" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                        label={{ value: 'DA spread (ct/kWh)', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                            <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                            <p className="tabular-nums">Gas: <b className="text-teal-600">{fmtNum(d.gasShare ?? 0, 1)}%</b> | Spread: <b>{fmtNum(d.spread)} ct</b></p>
                            <p className="tabular-nums">Max: <b className="text-red-500">{fmtNum(d.maxPrice)} ct</b> | Min: <b className="text-blue-500">{fmtNum(d.minPrice)} ct</b></p>
                          </div>
                        )
                      }} />
                      <Scatter data={chartData.filter(d => d.gasShare != null)} shape="circle">
                        {chartData.filter(d => d.gasShare != null).map((d, i) => (
                          <Cell key={i} fill={d.date >= marStart ? COLORS.after : COLORS.before} fillOpacity={d.date >= marStart ? 0.6 : 0.3} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                {(() => {
                  const pts = chartData.filter(d => d.gasShare != null)
                  const r = pearsonR(pts.map(d => d.gasShare!), pts.map(d => d.spread))
                  return <p className="text-[10px] text-gray-400 text-center mt-1">Pearson r = <b className="text-[#313131]">{fmtNum(r)}</b> (higher gas share &rarr; wider spread)</p>
                })()}
              </div>
              {/* Right: RES share vs max price */}
              <div>
                <p className="text-[10px] font-bold text-gray-400 mb-2">RES Share vs. Daily Max Price</p>
                <div className="h-[220px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <ScatterChart margin={{ top: 8, right: 12, bottom: 16, left: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" />
                      <XAxis type="number" dataKey="resShare" name="RES Share" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                        label={{ value: 'RES share of load (%)', position: 'insideBottom', offset: -8, style: { fontSize: 9, fill: '#9CA3AF' } }} />
                      <YAxis type="number" dataKey="maxPrice" name="Max Price" tick={{ fontSize: 9, fill: '#9CA3AF' }}
                        label={{ value: 'Daily max price (ct/kWh)', angle: -90, position: 'insideLeft', style: { fontSize: 9, fill: '#9CA3AF' } }} />
                      <Tooltip content={({ active, payload }) => {
                        if (!active || !payload?.length) return null
                        const d = payload[0].payload
                        return (
                          <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                            <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                            <p className="tabular-nums">RES: <b className="text-emerald-600">{fmtNum(d.resShare ?? 0, 1)}%</b> | Max: <b className="text-red-500">{fmtNum(d.maxPrice)} ct</b></p>
                            <p className="tabular-nums">Gas: <b className="text-teal-600">{fmtNum(d.gasShare ?? 0, 1)}%</b> | Min: <b className="text-blue-500">{fmtNum(d.minPrice)} ct</b></p>
                          </div>
                        )
                      }} />
                      <Scatter data={chartData.filter(d => d.resShare != null)} shape="circle">
                        {chartData.filter(d => d.resShare != null).map((d, i) => (
                          <Cell key={i} fill={d.date >= marStart ? COLORS.after : COLORS.before} fillOpacity={d.date >= marStart ? 0.6 : 0.3} />
                        ))}
                      </Scatter>
                    </ScatterChart>
                  </ResponsiveContainer>
                </div>
                {(() => {
                  const pts = chartData.filter(d => d.resShare != null)
                  const r = pearsonR(pts.map(d => d.resShare!), pts.map(d => d.maxPrice))
                  return <p className="text-[10px] text-gray-400 text-center mt-1">Pearson r = <b className="text-[#313131]">{fmtNum(r)}</b> (higher RES share &rarr; lower peak prices)</p>
                })()}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ─── 7: Feb vs. Mar Comparison Table ─── */}
        <div className="grid grid-cols-2 gap-4">
          <Card className="shadow-sm border-gray-200/80">
            <CardHeader className="pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">7a</span>
                <CardTitle className="text-sm font-bold text-[#313131]">Price Metrics — Feb vs. Mar</CardTitle>
              </div>
              <p className="text-[10px] text-gray-400">
                {profile}-weighted, {consumption.toLocaleString()} kWh/yr. <span className="text-blue-600 font-semibold">Feb</span> ({febStats.days}d) vs. <span className="text-red-600 font-semibold">Mar</span> ({marStats.days}d)
              </p>
            </CardHeader>
            <CardContent className="pt-3">
              <StatRow label="Avg DA spot (simple)" before={febStats.avgSpot} after={marStats.avgSpot} unit="ct" />
              <StatRow label={`Avg end-price (${profile}-weighted, gross)`} before={febStats.avgWeightedPrice} after={marStats.avgWeightedPrice} unit="ct" bold />
              <StatRow label="Avg daily DA spread (max-min)" before={febStats.avgSpread} after={marStats.avgSpread} unit="ct" />
              {(() => {
                const bg = gasForDate('2026-02-15')
                const ag = gasForDate('2026-03-15')
                if (bg == null || ag == null) return null
                return <StatRow label="TTF front-month (mid-month)" before={bg} after={ag} unit="EUR" bold />
              })()}
              {!genLoading && gasGenDaily.length > 0 && (() => {
                const febGen = gasGenDaily.filter(g => g.date >= febStart && g.date < febEnd)
                const marGen = gasGenDaily.filter(g => g.date >= marStart && g.date < marEnd)
                const avgFebGas = febGen.length > 0 ? febGen.reduce((s, g) => s + g.avgGasShare, 0) / febGen.length : 0
                const avgMarGas = marGen.length > 0 ? marGen.reduce((s, g) => s + g.avgGasShare, 0) / marGen.length : 0
                const avgFebRes = febGen.length > 0 ? febGen.reduce((s, g) => s + g.avgResShare, 0) / febGen.length : 0
                const avgMarRes = marGen.length > 0 ? marGen.reduce((s, g) => s + g.avgResShare, 0) / marGen.length : 0
                return <>
                  <StatRow label="Avg gas share of load" before={avgFebGas} after={avgMarGas} unit="%" />
                  <StatRow label="Avg RES share of load" before={avgFebRes} after={avgMarRes} unit="%" inverted />
                </>
              })()}
            </CardContent>
          </Card>

          <Card className="shadow-sm border-gray-200/80">
            <CardHeader className="pb-2 border-b border-gray-100">
              <div className="flex items-center gap-2">
                <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">7b</span>
                <CardTitle className="text-sm font-bold text-[#313131]">Consumer Impact — Feb vs. Mar</CardTitle>
              </div>
            </CardHeader>
            <CardContent className="pt-3">
              <StatRow label="Peak avg DA spot (WT 8-20h)" before={febStats.avgPeakSpot} after={marStats.avgPeakSpot} unit="ct" />
              <StatRow label="Off-peak avg DA spot" before={febStats.avgOffPeakSpot} after={marStats.avgOffPeakSpot} unit="ct" />
              <StatRow label="Peak-offpeak delta" before={febStats.peakOffPeakDelta} after={marStats.peakOffPeakDelta} unit="ct" bold />
              <StatRow label="Avg daily savings vs. fixed" before={febStats.avgSavingsEur} after={marStats.avgSavingsEur} unit="EUR" inverted />
              <div className="flex items-center justify-between py-1.5 border-b border-gray-50">
                <span className="text-[11px] text-gray-600">Days where dynamic is cheaper</span>
                <span className="text-[11px] tabular-nums font-bold text-gray-500">
                  {febStats.days > 0 ? ((febStats.greenDays / febStats.days) * 100).toFixed(0) : 0}% &rarr; {marStats.days > 0 ? ((marStats.greenDays / marStats.days) * 100).toFixed(0) : 0}%
                </span>
              </div>
              <div className="flex items-center justify-between py-1.5">
                <span className="text-[11px] text-gray-600">Period savings total</span>
                <span className={`text-[11px] tabular-nums font-bold ${marStats.totalSavingsEur >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                  {fmtNum(febStats.totalSavingsEur)} &rarr; {fmtNum(marStats.totalSavingsEur)} EUR
                </span>
              </div>
            </CardContent>
          </Card>
        </div>

        {/* ─── 8: Dynamic Tariff Savings vs Fixed ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardHeader className="pb-2 border-b border-gray-100">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold text-gray-400 bg-gray-100 rounded px-1.5 py-0.5">8</span>
              <CardTitle className="text-base font-bold text-[#313131]">Dynamic vs. Fixed Tariff — Annualized Savings</CardTitle>
            </div>
            <p className="text-[11px] text-gray-400 mt-0.5">
              {profile}-weighted, {consumption.toLocaleString()} kWh/yr vs. {fixedPrice} ct/kWh fixed. Positive = dynamic is cheaper. The key question: does the gas-driven price increase erode the dynamic tariff advantage?
            </p>
          </CardHeader>
          <CardContent className="pt-4">
            <div className="h-[200px]">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={chartData} {...chartCommon}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
                  <XAxis {...xAxisProps} />
                  <YAxis {...yAxisProps} label={{ value: 'EUR/yr', angle: -90, position: 'insideLeft', style: { fontSize: 10, fill: '#9CA3AF' } }} />
                  <Tooltip content={({ active, payload }) => {
                    if (!active || !payload?.length) return null
                    const d = payload[0].payload
                    return (
                      <div className="bg-white/95 backdrop-blur-sm border border-gray-200 rounded-lg shadow-lg p-2.5 text-[11px]">
                        <p className="font-semibold text-gray-700 mb-1">{d.date}</p>
                        <p className="tabular-nums">Annualized: <b className={d.savings >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmtNum(d.savings, 0)} EUR/yr</b> | 14d trend: <b>{fmtNum(d.savR14 ?? 0, 0)}</b></p>
                      </div>
                    )
                  }} />
                  {eventIdx >= 0 && <ReferenceLine x={eventIdx} stroke="#EA1C0A" strokeDasharray="6 3" strokeWidth={2} />}
                  <ReferenceLine y={0} stroke="#9CA3AF" strokeWidth={1} />
                  <Bar dataKey="savings" maxBarSize={3} fillOpacity={0.15} radius={[1, 1, 0, 0]}>
                    {chartData.map((d, i) => (
                      <Cell key={i} fill={d.savings >= 0 ? '#059669' : '#EA1C0A'} />
                    ))}
                  </Bar>
                  <Line dataKey="savR14" type="monotone" stroke={COLORS.green} strokeWidth={2.5} dot={false} connectNulls />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* ─── Sources ─── */}
        <Card className="shadow-sm border-gray-200/80">
          <CardContent className="py-3">
            <p className="text-[9px] text-gray-400 leading-relaxed">
              <b>Data sources:</b> Day-ahead electricity prices: EPEX Spot DE-LU via SMARD (Bundesnetzagentur). Gas prices: ICE Endex Dutch TTF Natural Gas Futures, front-month settlement (EUR/MWh).
              Generation mix: SMARD hourly data (filter IDs: 4071 gas, 4069 hard coal, 1223 lignite, 4068 solar, 4067+1225 wind, 410 grid load).
              Consumer cost: BDEW {profile} Standard Load Profile, 2026 surcharges (total {fmtNum(totalSurchargesNetto(surchargesForYear(2026)))} ct/kWh netto + 19% VAT).
              <b>Caveats:</b> Feb-to-Mar comparison includes seasonal effects (longer days, higher solar, spring demand patterns) that are not isolated from the conflict effect.
              Gas generation acts as a proxy for price-setting: in hours where gas plants run at high utilization and residual load is high, gas is likely the marginal technology setting the clearing price.
            </p>
          </CardContent>
        </Card>
      </main>
    </div>
  )
}
