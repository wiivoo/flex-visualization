/**
 * Batch-Optimierung API Route
 * Optimierung über einen Zeitraum (mehrere Tage).
 *
 * POST /api/optimize/batch
 * Body: { startDate, endDate, vehicle, config, dso? }
 *
 * 1. Preise für den Zeitraum laden (über /api/prices/batch Infrastruktur)
 * 2. Nach Tag gruppieren
 * 3. Pro Tag Optimierung durchführen
 * 4. Ergebnisse aggregieren
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

// Zod-Schema für Batch-Optimierung
const batchOptimizeSchema = z.object({
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'startDate muss im Format YYYY-MM-DD sein'),
  endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'endDate muss im Format YYYY-MM-DD sein'),
  vehicle: z.object({
    battery_kwh: z.number().positive('Batteriekapazität muss positiv sein'),
    charge_power_kw: z.number().positive('Ladeleistung muss positiv sein'),
    start_level_percent: z.number().min(0).max(100, 'Startlevel muss zwischen 0 und 100 liegen')
  }),
  config: z.object({
    window_start: z.string().regex(/^\d{2}:\d{2}$/, 'window_start muss im Format HH:MM sein'),
    window_end: z.string().regex(/^\d{2}:\d{2}$/, 'window_end muss im Format HH:MM sein'),
    target_level_percent: z.number().min(0).max(100, 'Ziellevel muss zwischen 0 und 100 liegen'),
    base_price_ct_kwh: z.number().positive('Basispreis muss positiv sein'),
    margin_ct_kwh: z.number().min(0, 'Marge darf nicht negativ sein'),
    customer_discount_ct_kwh: z.number().min(0, 'Kundenrabatt darf nicht negativ sein')
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
 * Preise für einen Zeitraum laden (interne Funktion).
 * Nutzt dieselbe Fallback-Kette wie /api/prices/batch.
 */
async function fetchPricesForRange(
  startDate: string,
  endDate: string
): Promise<PricePoint[]> {
  // Intern den Batch-Endpoint aufrufen via absolutem URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL
    ? `https://${process.env.VERCEL_URL}`
    : 'http://localhost:3000'

  const url = `${baseUrl}/api/prices/batch?startDate=${startDate}&endDate=${endDate}&type=day-ahead`

  const response = await fetch(url, {
    next: { revalidate: 3600 }
  })

  if (!response.ok) {
    throw new Error(`Preisabruf fehlgeschlagen: ${response.status}`)
  }

  const data = await response.json()
  return data.prices || []
}

/**
 * Ladeblock-Zeitfenster als lesbaren String formatieren
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

    // DSO validieren
    if (dso && !getAvailableDSOs().includes(dso)) {
      return NextResponse.json(
        { error: `Unbekannter Netzbetreiber: ${dso}. Verfügbar: ${getAvailableDSOs().join(', ')}` },
        { status: 400 }
      )
    }

    const startDate = parseISO(startDateStr)
    const endDate = parseISO(endDateStr)

    // Datumsvalidierung
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
      return NextResponse.json(
        { error: 'Ungültiges Datumsformat. Verwende YYYY-MM-DD' },
        { status: 400 }
      )
    }

    if (isAfter(startDate, endDate)) {
      return NextResponse.json(
        { error: 'startDate muss vor endDate liegen' },
        { status: 400 }
      )
    }

    const dayCount = differenceInDays(endDate, startDate) + 1
    if (dayCount > 365) {
      return NextResponse.json(
        { error: 'Maximaler Zeitraum: 365 Tage' },
        { status: 400 }
      )
    }

    // 1. Preise für gesamten Zeitraum laden
    const allPrices = await fetchPricesForRange(startDateStr, endDateStr)

    if (allPrices.length === 0) {
      return NextResponse.json(
        { error: 'Keine Preisdaten für den angegebenen Zeitraum verfügbar' },
        { status: 404 }
      )
    }

    // 2. Preise nach Tag gruppieren
    const pricesByDay = new Map<string, PricePoint[]>()
    for (const price of allPrices) {
      const dateStr = format(new Date(price.timestamp), 'yyyy-MM-dd')
      if (!pricesByDay.has(dateStr)) {
        pricesByDay.set(dateStr, [])
      }
      pricesByDay.get(dateStr)!.push(price)
    }

    // 3. Pro Tag optimieren
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

      // Baseline-Kosten: Durchschnittspreis der Baseline * Energie
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

    // 4. Aggregate berechnen
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
        { error: 'Ungültige Eingabe', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Batch-Optimierungsfehler:', error)
    return NextResponse.json(
      { error: 'Interner Serverfehler' },
      { status: 500 }
    )
  }
}
