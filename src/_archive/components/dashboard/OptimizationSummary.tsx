'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Clock, Battery, CheckCircle2, TrendingDown, ArrowRight } from 'lucide-react'
import { OptimizationResult } from '@/lib/config'

interface OptimizationSummaryProps {
  optimization: OptimizationResult | null
  isLoading?: boolean
}

export function OptimizationSummary({ optimization, isLoading }: OptimizationSummaryProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Charging Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-primary border-t-transparent" />
            <span className="text-sm text-muted-foreground">Calculating optimal charging plan...</span>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (!optimization || optimization.charging_schedule.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Charging Plan</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            No optimal charging times found. Prices in the time window may be too high.
          </p>
        </CardContent>
      </Card>
    )
  }

  const totalKwh = optimization.charging_schedule.reduce((sum, block) => sum + block.kwh, 0)
  const avgPrice = optimization.charging_schedule.reduce(
    (sum, block) => sum + block.price_ct_kwh * block.kwh,
    0
  ) / totalKwh

  // Calculate comparison metrics
  const savingsPercent = optimization.avg_price_without_flex && optimization.avg_price_with_flex
    ? ((optimization.avg_price_without_flex - optimization.avg_price_with_flex) / optimization.avg_price_without_flex * 100)
    : 0

  return (
    <Card>
      <CardHeader>
        <CardTitle>Optimal Charging Plan</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Before/After Comparison Card */}
        {(optimization.avg_price_without_flex && optimization.avg_price_with_flex) && (
          <div className="rounded-lg border bg-gradient-to-br from-slate-50 to-blue-50 p-4 dark:from-slate-950/20 dark:to-blue-950/20">
            <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Load Shifting Comparison
            </p>

            {/* Before - Average of entire time window */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-slate-200 dark:bg-slate-700">
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-400">&#8960;</span>
                </div>
                <div>
                  <span className="text-sm">Window Average</span>
                  <p className="text-xs text-muted-foreground">entire time window</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-slate-600 dark:text-slate-400">
                  {optimization.avg_price_without_flex.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">ct/kWh</p>
              </div>
            </div>

            {/* Arrow */}
            <div className="mb-3 flex justify-center">
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
            </div>

            {/* After - Optimal charging time only */}
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <div className="flex h-6 w-6 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                  <TrendingDown className="h-3 w-3 text-green-600 dark:text-green-400" />
                </div>
                <div>
                  <span className="text-sm">Optimized</span>
                  <p className="text-xs text-muted-foreground">cheapest hours only</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-lg font-bold text-green-600 dark:text-green-400">
                  {optimization.avg_price_with_flex!.toFixed(2)}
                </p>
                <p className="text-xs text-muted-foreground">ct/kWh</p>
              </div>
            </div>

            {/* Savings Badge */}
            {savingsPercent > 0 && (
              <div className="mt-3 flex items-center justify-center rounded-full bg-green-500 px-3 py-1.5">
                <TrendingDown className="mr-1 h-3 w-3 text-white" />
                <span className="text-sm font-semibold text-white">
                  {savingsPercent.toFixed(0)}% cheaper
                </span>
              </div>
            )}
          </div>
        )}

        {/* Charging blocks */}
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Charging Times
          </p>
          <div className="space-y-2">
            {optimization.charging_schedule.map((block, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-lg border bg-green-50 p-3 dark:bg-green-950/20"
              >
                <div className="flex items-center gap-3">
                  <CheckCircle2 className="h-5 w-5 text-green-600" />
                  <div>
                    <p className="font-medium">
                      {block.start} - {block.end}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {block.kwh.toFixed(1)} kWh charge
                    </p>
                  </div>
                </div>
                <Badge variant="secondary" className="bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400">
                  {block.price_ct_kwh.toFixed(2)} ct/kWh
                </Badge>
              </div>
            ))}
          </div>
        </div>

        {/* Summary stats */}
        <div className="flex flex-wrap gap-4 border-t pt-4">
          <div className="flex items-center gap-2">
            <Battery className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              Total: <span className="font-semibold">{totalKwh.toFixed(1)} kWh</span>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm">
              Average: <span className="font-semibold">{avgPrice.toFixed(2)} ct/kWh</span>
            </span>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
