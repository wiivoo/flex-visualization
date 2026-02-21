import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import type { PricePoint, OptimizationResult, ChargingBlock } from '@/lib/config'
import { getGridFee, isModul3Active, getAverageGridFee, getAvailableDSOs } from '@/lib/grid-fees'

// Validation schema
const optimizeSchema = z.object({
  prices: z.array(z.object({
    timestamp: z.string(),
    price_ct_kwh: z.number()
  })),
  vehicle: z.object({
    battery_kwh: z.number().positive(),
    charge_power_kw: z.number().positive(),
    start_level_percent: z.number().min(0).max(100)
  }),
  config: z.object({
    window_start: z.string(),
    window_end: z.string(),
    target_level_percent: z.number().min(0).max(100),
    base_price_ct_kwh: z.number().positive(),
    margin_ct_kwh: z.number().min(0),
    customer_discount_ct_kwh: z.number().min(0)
  }),
  // Optional: DSO für zeitvariable Netzentgelte nach §14a EnWG Modul 3
  dso: z.string().optional()
})

interface PricePointExt extends PricePoint {
  hour: number
  minute: number
}

function parseTime(timeStr: string): { hour: number; minute: number } {
  const [hour, minute] = timeStr.split(':').map(Number)
  return { hour, minute }
}

function isTimeInWindow(price: PricePointExt, windowStart: string, windowEnd: string): boolean {
  const { hour: startHour } = parseTime(windowStart)
  const { hour: endHour } = parseTime(windowEnd)

  // Handle overnight window (e.g., 22:00 - 06:00)
  if (startHour > endHour) {
    return price.hour >= startHour || price.hour < endHour
  }

  return price.hour >= startHour && price.hour < endHour
}

function formatTime(hour: number, minute: number): string {
  return `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = optimizeSchema.parse(body)

    const { prices, vehicle, config, dso } = validated

    // DSO validieren, falls angegeben
    const useMod3 = dso ? getAvailableDSOs().includes(dso) : false
    if (dso && !useMod3) {
      return NextResponse.json(
        { error: `Unbekannter Netzbetreiber: ${dso}. Verfügbar: ${getAvailableDSOs().join(', ')}` },
        { status: 400 }
      )
    }

    // Modul 3 Quartals-Check: Prüfe anhand des ersten Preis-Timestamps
    const firstPriceDate = prices.length > 0 ? new Date(prices[0].timestamp) : new Date()
    const priceMonth = firstPriceDate.getMonth() + 1 // 1-12
    const mod3Active = useMod3 && dso ? isModul3Active(dso, priceMonth) : false

    // 1. Calculate required energy
    const energy_needed_kwh = vehicle.battery_kwh *
      (config.target_level_percent - vehicle.start_level_percent) / 100

    if (energy_needed_kwh <= 0) {
      return NextResponse.json({
        charging_schedule: [],
        cost_without_flex_eur: 0,
        cost_with_flex_eur: 0,
        savings_eur: 0,
        customer_benefit_eur: 0,
        our_margin_eur: 0,
        win_win_eur: 0
      })
    }

    // 2. Calculate charging duration
    const charging_duration_hours = energy_needed_kwh / vehicle.charge_power_kw
    const intervals_needed = Math.ceil(charging_duration_hours * 4) // 15-min intervals

    // 3. Filter prices to time window and add time info
    const pricesWithTime: PricePointExt[] = prices.map(p => {
      const date = new Date(p.timestamp)
      return {
        ...p,
        hour: date.getHours(),
        minute: date.getMinutes()
      }
    }).filter(p => isTimeInWindow(p, config.window_start, config.window_end))

    if (pricesWithTime.length === 0) {
      return NextResponse.json({
        charging_schedule: [],
        cost_without_flex_eur: (config.base_price_ct_kwh * energy_needed_kwh) / 100,
        cost_with_flex_eur: 0,
        savings_eur: 0,
        customer_benefit_eur: 0,
        our_margin_eur: 0,
        win_win_eur: 0,
        error: 'No prices available in time window'
      })
    }

    // 4. Sort by total cost (ascending) and select cheapest intervals
    // Bei Modul 3: Sortierung nach Börsenpreis + zeitvariablem Netzentgelt
    const sortedPrices = [...pricesWithTime].sort((a, b) => {
      if (mod3Active && dso) {
        const totalA = a.price_ct_kwh + getGridFee(a.hour, dso)
        const totalB = b.price_ct_kwh + getGridFee(b.hour, dso)
        return totalA - totalB
      }
      return a.price_ct_kwh - b.price_ct_kwh
    })
    const selectedIntervals = sortedPrices.slice(0, Math.min(intervals_needed, sortedPrices.length))

    // 5. Calculate if we can fully charge
    const actual_energy_kwh = (selectedIntervals.length / 4) * vehicle.charge_power_kw
    const canFullyCharge = actual_energy_kwh >= energy_needed_kwh

    // 6. Create charging schedule (merge consecutive intervals)
    const charging_schedule: ChargingBlock[] = []
    const kwh_per_interval = (vehicle.charge_power_kw / 4) // 15-min intervals

    let currentBlock: ChargingBlock | null = null

    // Sort chronologically, handling overnight windows correctly
    // Times >= windowStart hour come before times < windowStart hour
    const { hour: windowStartHour } = parseTime(config.window_start)
    selectedIntervals
      .sort((a, b) => {
        // Normalize hours relative to window start so overnight wraps are handled
        const aNorm = a.hour < windowStartHour ? a.hour + 24 : a.hour
        const bNorm = b.hour < windowStartHour ? b.hour + 24 : b.hour
        return aNorm - bNorm || a.minute - b.minute
      }) // Sort by time
      .forEach((interval, index) => {
        const time = formatTime(interval.hour, interval.minute)
        const endTime = new Date()
        endTime.setHours(interval.hour, interval.minute + 15, 0, 0)
        const endTimeStr = formatTime(endTime.getHours(), endTime.getMinutes())

        if (!currentBlock) {
          currentBlock = {
            start: time,
            end: endTimeStr,
            price_ct_kwh: interval.price_ct_kwh,
            kwh: kwh_per_interval
          }
        } else {
          // Check if consecutive
          const prevEnd = new Date()
          const [hours, minutes] = currentBlock.end.split(':').map(Number)
          prevEnd.setHours(hours, minutes, 0, 0)

          const currentStart = new Date()
          currentStart.setHours(interval.hour, interval.minute, 0, 0)

          if (Math.abs(currentStart.getTime() - prevEnd.getTime()) <= 15 * 60 * 1000) {
            // Extend current block
            currentBlock.end = endTimeStr
            currentBlock.kwh += kwh_per_interval
            // Weighted average price
            currentBlock.price_ct_kwh =
              (currentBlock.price_ct_kwh * (currentBlock.kwh - kwh_per_interval) +
               interval.price_ct_kwh * kwh_per_interval) / currentBlock.kwh
          } else {
            // Start new block
            charging_schedule.push(currentBlock)
            currentBlock = {
              start: time,
              end: endTimeStr,
              price_ct_kwh: interval.price_ct_kwh,
              kwh: kwh_per_interval
            }
          }
        }

        // Add last block
        if (index === selectedIntervals.length - 1 && currentBlock) {
          charging_schedule.push(currentBlock)
        }
      })

    // 7. Calculate economics - Compare against AVERAGE of time window (not base price)
    // Average price of ALL intervals in the time window (what you'd pay without optimization)
    const avg_window_price = pricesWithTime.reduce((sum, p) => sum + p.price_ct_kwh, 0) / pricesWithTime.length
    // Average price of SELECTED (optimal) intervals
    const avg_optimal_price = selectedIntervals.reduce((sum, p) => sum + p.price_ct_kwh, 0) / selectedIntervals.length

    // Costs using actual market prices (not base price)
    const cost_without_flex_eur = (avg_window_price * energy_needed_kwh) / 100
    const cost_with_flex_eur = (avg_optimal_price * actual_energy_kwh) / 100
    const savings_eur = Math.max(0, cost_without_flex_eur - cost_with_flex_eur)

    // Customer benefit: min of discount or 50% of savings
    const discount_savings = (config.customer_discount_ct_kwh * actual_energy_kwh) / 100
    const half_savings = savings_eur * 0.5
    const customer_benefit_eur = Math.min(discount_savings, half_savings)

    // Our margin: remaining savings after customer discount
    const our_margin_eur = Math.max(0, savings_eur - customer_benefit_eur)
    const win_win_eur = customer_benefit_eur + our_margin_eur

    // Modul 3 Zusatzberechnung: Kosten mit zeitvariablen Netzentgelten
    let mod3Fields: Record<string, number | string | boolean> = {}
    if (mod3Active && dso) {
      // Durchschnittliches Netzentgelt über alle Intervalle im Fenster (ohne Optimierung)
      const avgGridFeeWindow = pricesWithTime.reduce(
        (sum, p) => sum + getGridFee(p.hour, dso), 0
      ) / pricesWithTime.length

      // Durchschnittliches Netzentgelt der optimierten Intervalle
      const avgGridFeeOptimal = selectedIntervals.reduce(
        (sum, p) => sum + getGridFee(p.hour, dso), 0
      ) / selectedIntervals.length

      // Gesamtkosten mit Modul 3 (Börsenpreis + zeitvariables Netzentgelt)
      const costWithMod3 = ((avg_optimal_price + avgGridFeeOptimal) * actual_energy_kwh) / 100
      const costWithoutMod3 = ((avg_window_price + avgGridFeeWindow) * energy_needed_kwh) / 100

      // Pauschales Netzentgelt (Durchschnitt) als Vergleich ohne Modul 3
      const flatGridFee = getAverageGridFee(dso)
      const costFlatGrid = ((avg_window_price + flatGridFee) * energy_needed_kwh) / 100

      const savingsFromMod3 = Math.max(0, costFlatGrid - costWithMod3)

      mod3Fields = {
        dso,
        mod3_active: true,
        cost_with_mod3_eur: Math.round(costWithMod3 * 100) / 100,
        cost_without_mod3_eur: Math.round(costWithoutMod3 * 100) / 100,
        savings_from_mod3_eur: Math.round(savingsFromMod3 * 100) / 100,
        avg_grid_fee_window_ct_kwh: Math.round(avgGridFeeWindow * 100) / 100,
        avg_grid_fee_optimal_ct_kwh: Math.round(avgGridFeeOptimal * 100) / 100,
      }
    } else if (dso) {
      mod3Fields = {
        dso,
        mod3_active: false,
        mod3_info: `Modul 3 ist für ${dso} im aktuellen Quartal nicht aktiv`,
      }
    }

    const result: OptimizationResult = {
      charging_schedule,
      cost_without_flex_eur: Math.round(cost_without_flex_eur * 100) / 100,
      cost_with_flex_eur: Math.round(cost_with_flex_eur * 100) / 100,
      savings_eur: Math.round(savings_eur * 100) / 100,
      customer_benefit_eur: Math.round(customer_benefit_eur * 100) / 100,
      our_margin_eur: Math.round(our_margin_eur * 100) / 100,
      win_win_eur: Math.round(win_win_eur * 100) / 100,
      // Comparison metrics: Window average vs Optimal average (pure load shifting)
      avg_price_without_flex: Math.round(avg_window_price * 100) / 100,
      avg_price_with_flex: Math.round(avg_optimal_price * 100) / 100,
      energy_charged_kwh: Math.round(actual_energy_kwh * 10) / 10,
      target_level_reached: canFullyCharge
    }

    return NextResponse.json({ ...result, ...mod3Fields })
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json(
        { error: 'Invalid input', details: error.issues },
        { status: 400 }
      )
    }

    console.error('Optimization error:', error)
    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    )
  }
}
