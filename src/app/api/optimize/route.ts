import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { runOptimization } from '@/lib/optimizer'
import { getAvailableDSOs } from '@/lib/grid-fees'

// Validation schema
const optimizeSchema = z.object({
  prices: z.array(z.object({
    timestamp: z.string(),
    price_ct_kwh: z.number()
  })).max(500, 'Maximum 500 price points allowed'),
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
  // Optional: DSO for time-variable grid fees per §14a EnWG Module 3
  dso: z.string().optional()
})

export async function POST(request: NextRequest) {
  try {
    const body = await request.json()
    const validated = optimizeSchema.parse(body)

    const { prices, vehicle, config, dso } = validated

    // Validate DSO if provided
    if (dso && !getAvailableDSOs().includes(dso)) {
      return NextResponse.json(
        { error: `Unknown grid operator: ${dso}. Available: ${getAvailableDSOs().join(', ')}` },
        { status: 400 }
      )
    }

    const result = runOptimization({
      prices,
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

    return NextResponse.json(result)
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
