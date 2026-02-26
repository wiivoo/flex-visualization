/**
 * Batch optimization API route
 * Optimization over a date range (multiple days).
 *
 * POST /api/optimize/batch
 * Body: { startDate, endDate, vehicle, config, dso? }
 *
 * 1. Load prices for the date range (via /api/prices/batch infrastructure)
 * 2. Group by day
 * 3. Run optimization per day
 * 4. Aggregate results
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import {
  parseISO,
  format,
  eachDayOfInterval,
  differenceInDays,
  isAfter,
} from 'date-fns'
import { runOptimization } from '@/lib/optimizer'
import type { PricePoint } from '@/lib/config'
import { getAvailableDSOs } from '@/lib/grid-fees'

// Zod schema for batch optimization
const batchOptimizeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate must be in YYYY-MM-DD format'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate must be in YYYY-MM-DD format'),
  vehicle: z.object({
    battery_kwh: z.number().positive('Battery capacity must be positive'),
    charge_power_kw: z.number().positive('Charge power must be positive'),
    start_level_percent: z.number().min(0).max(100, 'Start level must be between 0 and 100')
  }),
  config: z.object({
    window_start: z.string().regex(/^\d{2}:\d{2}$/, 'window_start must be in HH:MM format'),
    window_end: z.string().regex(/^\d{2}:\d{2}$/, 'window_end must be in HH:MM format'),
    target_level_percent: z.number().min(0).max(100, 'Target level must be between 0 and 100'),
    base_price_ct_kwh: z.number().positive('Base price must be positive'),
    margin_ct_kwh: z.number().min(0, 'Margin must not be negative'),
    customer_discount_ct_kwh: z.number().min(0, 'Customer discount must not be negative')
  }),
  dso: z.string().optional()
})

interface DailyResult {
  date: string
  cost_baseline_eur: number
  cost_optimized_eur: number
  savings_eur: number
  energy_kwh: number
  baseline_hours: string
  optimized_hours: string
}

/**
 * Load prices for a date range (internal function).
 * Uses the same fallback chain as /api/prices/batch.
 */
async function fetchPricesForRange(
  startDate: string,
  endDate: string
): Promise<PricePoint[]> {
  // Call the batch endpoint internally via absolute URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const url = `${baseUrl}/api/prices/batch?startDate=${startDate}&endDate=${endDate}&type=day-ahead`

  const response = await fetch(url, {
    next: { revalidate: 3600 }
  })

  if (!response.ok) {
    throw new Error(`Price fetch failed: ${response.status}`)
  }

  const data = await response.json()
  return data.prices || []
}

/**
 * Format charging block time windows as a readable string
 */
function formatScheduleHours(schedule: Array<{ start: string; end: string }>): string {
  if (schedule.length === 0) return '-'
  if (schedule.length === 1) return `${schedule[0].start}-${schedule[0].end}`
  return schedule.map(b => `${b.start}-${b.end}`).join(', ')
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = batchOptimizeSchema.parse(body)

    const { startDate: startDateStr, endDate: endDateStr, vehicle, config, dso } = validated

    // Validate DSO
    if (dso && !getAvailableDSOs().includes(dso)) {
      return NextResponse.json(
        { error: `Unknown grid operator: ${dso}. Available: ${getAvailableDSOs().join(', ')}` },
        { status: 400 }
      )
    }

    const startDate = parseISO(startDateStr)
    const endDate = parseISO(endDateStr)

    // Date validation
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Invalid date format. Use YYYY-MM-DD' },
        { status: 400 }
      )
    }

    if (isAfter(startDate, endDate)) {
      return NextResponse.json(
        { error: 'startDate must be before endDate' },
        { status: 400 }
      )
    }

    const dayCount = differenceInDays(endDate, startDate) + 1
    if (dayCount > 365) {
      return NextResponse.json(
        { error: 'Maximum date range: 365 days' },
        { status: 400 }
      )
    }

    // 1. Load prices for entire date range
    const allPrices = await fetchPricesForRange(startDateStr, endDateStr)

    if (allPrices.length === 0) {
      return NextResponse.json(
        { error: 'No price data available for the specified date range' },
        { status: 404 }
      )
    }

    // 2. Group prices by day
    const pricesByDay = new Map<string, PricePoint[]>()
    for (const price of allPrices) {
      const dateStr = format(new Date(price.timestamp), 'yyyy-MM-dd')
      if (!pricesByDay.has(dateStr)) {
        pricesByDay.set(dateStr, [])
      }
      pricesByDay.get(dateStr)!.push(price)
    }

    // 3. Optimize per day
    const days = eachDayOfInterval({ start: startDate, end: endDate })
    const daily_results: DailyResult[] = []

    for (const day of days) {
      const dateStr = format(day, 'yyyy-MM-dd')
      const dayPrices = pricesByDay.get(dateStr)

      if (!dayPrices || dayPrices.length === 0) continue

      const result = runOptimization({
        prices: dayPrices,
        battery_kwh: vehicle.battery_kwh,
        charge_power_kw: vehicle.charge_power_kw,
        start_level_percent: vehicle.start_level_percent,
        window_start: config.window_start,
        window_end: config.window_end,
        target_level_percent: config.target_level_percent,
        base_price_ct_kwh: config.base_price_ct_kwh,
        margin_ct_kwh: config.margin_ct_kwh,
        customer_discount_ct_kwh: config.customer_discount_ct_kwh,
        dso
      })

      // Baseline cost: average baseline price * energy
      const baselineCost = (result.baseline_avg_price * result.energy_charged_kwh) / 100

      daily_results.push({
        date: dateStr,
        cost_baseline_eur: Math.round(baselineCost * 100) / 100,
        cost_optimized_eur: result.cost_with_flex_eur,
        savings_eur: Math.round((baselineCost - result.cost_with_flex_eur) * 100) / 100,
        energy_kwh: result.energy_charged_kwh,
        baseline_hours: formatScheduleHours(result.baseline_schedule),
        optimized_hours: formatScheduleHours(result.charging_schedule)
      })
    }

    // 4. Calculate aggregates
    const totals = {
      total_cost_baseline_eur: Math.round(
        daily_results.reduce((sum, d) => sum + d.cost_baseline_eur, 0) * 100
      ) / 100,
      total_cost_optimized_eur: Math.round(
        daily_results.reduce((sum, d) => sum + d.cost_optimized_eur, 0) * 100
      ) / 100,
      total_savings_eur: Math.round(
        daily_results.reduce((sum, d) => sum + d.savings_eur, 0) * 100
      ) / 100,
      total_energy_kwh: Math.round(
        daily_results.reduce((sum, d) => sum + d.energy_kwh, 0) * 10
      ) / 10,
      avg_savings_per_day_eur: 0,
      days_analyzed: daily_results.length
    }
    totals.avg_savings_per_day_eur = daily_results.length > 0
      ? Math.round((totals.total_savings_eur / daily_results.length) * 100) / 100
      : 0

    return NextResponse.json({
      daily_results,
      totals
    })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Batch optimization error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
