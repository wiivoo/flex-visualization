'use client'

import { useMemo } from 'react'
import { PricePoint } from '@/lib/config'
import { VEHICLE_PROFILES } from '@/lib/config'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface PriceHeatmapProps {
  prices: PricePoint[]
  basePrice?: number
  margin?: number
}

export function PriceHeatmap({ prices, basePrice = 35, margin = 5 }: PriceHeatmapProps) {
  // Aggregate prices by hour for each vehicle type
  const heatmapData = useMemo(() => {
    const hourlyPrices = new Map<number, number[]>()

    prices.forEach(point => {
      const hour = new Date(point.timestamp).getHours()
      if (!hourlyPrices.has(hour)) {
        hourlyPrices.set(hour, [])
      }
      hourlyPrices.get(hour)!.push(point.price_ct_kwh)
    })

    // Calculate average price per hour
    const avgHourlyPrices = new Map<number, number>()
    for (let hour = 0; hour < 24; hour++) {
      const hourPrices = hourlyPrices.get(hour) || []
      const avg = hourPrices.length > 0
        ? hourPrices.reduce((sum, p) => sum + p, 0) / hourPrices.length
        : basePrice
      avgHourlyPrices.set(hour, avg)
    }

    // Calculate savings potential for each vehicle at each hour
    const vehicles = ['klein', 'medium', 'suv'] as const
    const data: Array<{
      vehicle: typeof vehicles[number]
      hour: number
      savings: number
      price: number
    }> = []

    vehicles.forEach(vehicleType => {
      const vehicle = VEHICLE_PROFILES[vehicleType]
      const energyNeeded = vehicle.battery_kwh * 0.8 // 80% charge

      for (let hour = 0; hour < 24; hour++) {
        const avgPrice = avgHourlyPrices.get(hour) || basePrice
        const costWithoutFlex = (basePrice * energyNeeded) / 100
        const costWithFlex = (avgPrice * energyNeeded) / 100
        const savings = costWithoutFlex - costWithFlex

        data.push({
          vehicle: vehicleType,
          hour,
          savings,
          price: avgPrice
        })
      }
    })

    return data
  }, [prices, basePrice, margin])

  // Find min and max savings for color scaling
  const { minSavings, maxSavings } = useMemo(() => {
    const allSavings = heatmapData.map(d => d.savings)
    return {
      minSavings: Math.min(...allSavings),
      maxSavings: Math.max(...allSavings)
    }
  }, [heatmapData])

  // Color scale function
  const getColor = (savings: number): string => {
    const range = maxSavings - minSavings || 1
    const normalized = (savings - minSavings) / range

    if (savings < 0) {
      // Red scale for negative savings
      return `rgba(239, 68, 68, ${0.3 + Math.abs(normalized) * 0.5})`
    } else {
      // Green scale for positive savings
      return `rgba(34, 197, 94, ${0.2 + normalized * 0.6})`
    }
  }

  const vehicles = ['klein', 'medium', 'suv'] as const
  const hours = Array.from({ length: 24 }, (_, i) => i)

  return (
    <Card>
      <CardHeader>
        <CardTitle>Einsparpotenzial nach Fahrzeug & Uhrzeit</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Heatmap */}
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              {/* Header row */}
              <div className="flex border-b pb-2 mb-2">
                <div className="w-24 flex-shrink-0" />
                {hours.map(hour => (
                  <div
                    key={hour}
                    className="w-6 flex-shrink-0 text-center text-xs text-muted-foreground"
                  >
                    {hour % 6 === 0 ? hour.toString().padStart(2, '0') : ''}
                  </div>
                ))}
              </div>

              {/* Vehicle rows */}
              {vehicles.map(vehicleType => {
                const vehicle = VEHICLE_PROFILES[vehicleType]
                return (
                  <div key={vehicleType} className="flex items-center">
                    <div className="w-24 flex-shrink-0 text-sm font-medium pr-2">
                      <div className="text-lg">{vehicleType === 'klein' ? '🚗' : vehicleType === 'medium' ? '🚙' : '🚚'}</div>
                      <div className="text-xs text-muted-foreground">{vehicle.name}</div>
                    </div>
                    {hours.map(hour => {
                      const data = heatmapData.find(
                        d => d.vehicle === vehicleType && d.hour === hour
                      )
                      if (!data) return <div key={hour} className="w-6 h-8 flex-shrink-0" />

                      return (
                        <div
                          key={hour}
                          className="w-6 h-8 flex-shrink-0 relative group cursor-pointer"
                          style={{ backgroundColor: getColor(data.savings) }}
                          title={`${vehicle.name} um ${hour.toString().padStart(2, '0')}:00\nPreis: ${data.price.toFixed(2)} ct/kWh\nErsparnis: €${data.savings.toFixed(2)}`}
                        >
                          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <span className="text-xs font-semibold">
                              {data.savings > 0 ? '€' : '€'}
                            </span>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )
              })}
            </div>
          </div>

          {/* Legend */}
          <div className="flex items-center justify-center gap-4 text-sm pt-4 border-t">
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 rounded" style={{ backgroundColor: 'rgba(239, 68, 68, 0.6)' }} />
              <span className="text-muted-foreground">Geringe Ersparnis</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 rounded bg-gradient-to-r from-red-400/60 via-gray-300/40 to-green-500/80" />
              <span className="text-muted-foreground">→</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-8 h-4 rounded" style={{ backgroundColor: 'rgba(34, 197, 94, 0.8)' }} />
              <span className="text-muted-foreground">Hohe Ersparnis</span>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
