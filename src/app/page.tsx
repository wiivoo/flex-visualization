'use client'

import { useState, useEffect, useCallback } from 'react'
import { Zap, LogOut, Settings2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { TimeRangeSelector, TimeRange, getDateRange } from '@/components/charts/TimeRangeSelector'
import { PriceChart } from '@/components/charts/PriceChart'
import { KPIGrid } from '@/components/dashboard/KPIGrid'
import { OptimizationSummary } from '@/components/dashboard/OptimizationSummary'
import { QuickConfigPanel } from '@/components/config/QuickConfigPanel'
import { ConfigState, PricePoint, OptimizationResult, loadConfig, saveConfig, VEHICLE_PROFILES } from '@/lib/config'
import { format } from 'date-fns'

export default function DashboardPage() {
  const [timeRange, setTimeRange] = useState<TimeRange>('day')
  const [selectedDate, setSelectedDate] = useState(new Date())
  const [config, setConfig] = useState<ConfigState>(loadConfig())
  const [showConfig, setShowConfig] = useState(false)
  const [prices, setPrices] = useState<PricePoint[]>([])
  const [optimization, setOptimization] = useState<OptimizationResult | null>(null)
  const [isPricesLoading, setIsPricesLoading] = useState(false)
  const [isOptimizationLoading, setIsOptimizationLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchData = useCallback(async (date: Date, range: TimeRange, cfg: ConfigState) => {
    const { startDate, endDate } = getDateRange(range, date)

    // For day view, fetch single day. For ranges, fetch all days in range.
    const dates: Date[] = []
    let current = new Date(startDate)
    while (current <= endDate) {
      dates.push(new Date(current))
      current.setDate(current.getDate() + 1)
      // Limit to 90 days for performance
      if (dates.length > 90) break
    }

    setError(null)
    setIsPricesLoading(true)
    setIsOptimizationLoading(true)

    try {
      // Fetch prices for all dates in range
      const fetchPromises = dates.map(d => {
        const dateStr = format(d, 'yyyy-MM-dd')
        return fetch(`/api/prices?type=day-ahead&date=${dateStr}`)
          .then(res => res.ok ? res.json() : null)
          .then(data => data?.prices || [])
          .catch(() => [])
      })
      const results = await Promise.all(fetchPromises)
      const allPrices: PricePoint[] = results.flat()
      setPrices(allPrices)

      // Only run optimization for day view
      if (range === 'day' && allPrices.length > 0) {
        const vehicle = VEHICLE_PROFILES[cfg.vehicle]
        const optimizationResponse = await fetch('/api/optimize', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            prices: allPrices,
            vehicle: {
              battery_kwh: vehicle.battery_kwh,
              charge_power_kw: vehicle.charge_power_kw,
              start_level_percent: cfg.start_level_percent
            },
            config: {
              window_start: cfg.window_start,
              window_end: cfg.window_end,
              target_level_percent: 100,
              base_price_ct_kwh: cfg.base_price_ct_kwh,
              margin_ct_kwh: cfg.margin_ct_kwh,
              customer_discount_ct_kwh: cfg.customer_discount_ct_kwh
            }
          })
        })

        if (optimizationResponse.ok) {
          const optData = await optimizationResponse.json()
          setOptimization(optData)
        } else {
          setOptimization(null)
        }
      } else {
        setOptimization(null)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Fehler beim Laden der Daten')
      setPrices([])
      setOptimization(null)
    } finally {
      setIsPricesLoading(false)
      setIsOptimizationLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchData(selectedDate, timeRange, config)
  }, [selectedDate, timeRange, config, fetchData])

  const handleConfigChange = (newConfig: ConfigState) => {
    setConfig(newConfig)
    saveConfig(newConfig)
  }

  const handleRangeChange = (range: TimeRange, date: Date) => {
    setTimeRange(range)
    setSelectedDate(date)
  }

  const handleLogout = async () => {
    await fetch('/api/auth', { method: 'DELETE' })
    window.location.href = '/login'
  }

  // Get optimal charging window for chart highlight
  const optimalStart = optimization?.charging_schedule[0]?.start
  const optimalEnd = optimization?.charging_schedule[optimization.charging_schedule.length - 1]?.end

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-sm dark:bg-slate-950/80">
        <div className="flex h-16 items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold">FlexMon</h1>
              <p className="text-xs text-muted-foreground">
                E-Auto Ladesteuerungs-Optimierung
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <TimeRangeSelector
              selectedRange={timeRange}
              selectedDate={selectedDate}
              onRangeChange={handleRangeChange}
              isLoading={isPricesLoading}
            />

            <Button
              variant="outline"
              size="icon"
              onClick={() => setShowConfig(!showConfig)}
              aria-label="Einstellungen"
            >
              <Settings2 className="h-4 w-4" />
            </Button>

            <Button variant="ghost" size="icon" onClick={handleLogout} aria-label="Abmelden">
              <LogOut className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="px-4 py-6 sm:px-6 lg:px-8">
        {error && (
          <div className="mb-6 rounded-lg border border-red-200 bg-red-50 p-4 text-red-800 dark:border-red-900 dark:bg-red-950/20 dark:text-red-400">
            <p className="font-medium">Fehler</p>
            <p className="text-sm">{error}</p>
            <Button
              variant="outline"
              size="sm"
              className="mt-2"
              onClick={() => fetchData(selectedDate, timeRange, config)}
            >
              Erneut versuchen
            </Button>
          </div>
        )}

        {/* Quick Config Panel */}
        {showConfig && (
          <div className="mb-6 rounded-lg border bg-white p-4 shadow-sm dark:bg-slate-950">
            <QuickConfigPanel
              config={config}
              onConfigChange={handleConfigChange}
              onClose={() => setShowConfig(false)}
            />
          </div>
        )}

        {/* KPI Grid */}
        <div className="mb-6">
          <KPIGrid optimization={optimization} isLoading={isOptimizationLoading} />
        </div>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Price Chart - takes 2 columns */}
          <div className="lg:col-span-2">
            <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-slate-950">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">
                  {timeRange === 'day' ? 'Day-Ahead Preiskurve' :
                   timeRange === 'month' ? 'Monatsübersicht Preise' :
                   timeRange === 'quarter' ? 'Quartalsübersicht Preise' :
                   'Jahresübersicht Preise'}
                </h2>
                <span className="text-sm text-muted-foreground">
                  {prices.length} Datenpunkte
                </span>
              </div>
              <PriceChart
                prices={prices}
                optimalStart={optimalStart}
                optimalEnd={optimalEnd}
                avgPrice={optimization?.avg_price_without_flex}
                optimizedAvgPrice={optimization?.avg_price_with_flex}
                isLoading={isPricesLoading}
                timeRange={timeRange}
              />
            </div>
          </div>

          {/* Optimization Summary */}
          <div className="lg:col-span-1">
            {timeRange === 'day' ? (
              <>
                <OptimizationSummary optimization={optimization} isLoading={isOptimizationLoading} />

                {/* Current config summary */}
                <div className="mt-4 rounded-lg border bg-white p-4 shadow-sm dark:bg-slate-950">
                  <h3 className="mb-3 text-sm font-semibold">Konfiguration</h3>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Fahrzeug:</span>
                      <span className="font-medium">{VEHICLE_PROFILES[config.vehicle].name}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Batterie:</span>
                      <span className="font-medium">{VEHICLE_PROFILES[config.vehicle].battery_kwh} kWh</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Start-Level:</span>
                      <span className="font-medium">{config.start_level_percent}%</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Ladefenster:</span>
                      <span className="font-medium">
                        {config.window_start} - {config.window_end}
                      </span>
                    </div>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-3 w-full"
                    onClick={() => setShowConfig(true)}
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Konfiguration bearbeiten
                  </Button>
                </div>
              </>
            ) : (
              <div className="rounded-lg border bg-white p-6 shadow-sm dark:bg-slate-950">
                <h3 className="mb-3 text-sm font-semibold">Zeitraum-Statistiken</h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Durchschnittspreis:</span>
                    <span className="font-medium">
                      {(prices.reduce((sum, p) => sum + p.price_ct_kwh, 0) / prices.length || 0).toFixed(2)} ct/kWh
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Min. Preis:</span>
                    <span className="font-medium text-green-600">
                      {Math.min(...prices.map(p => p.price_ct_kwh)).toFixed(2)} ct/kWh
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max. Preis:</span>
                    <span className="font-medium text-red-600">
                      {Math.max(...prices.map(p => p.price_ct_kwh)).toFixed(2)} ct/kWh
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Preisspanne:</span>
                    <span className="font-medium">
                      {(Math.max(...prices.map(p => p.price_ct_kwh)) - Math.min(...prices.map(p => p.price_ct_kwh))).toFixed(2)} ct/kWh
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  )
}
