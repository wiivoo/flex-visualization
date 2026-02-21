'use client'

import { useState, useEffect, useCallback } from 'react'
import { Zap, LogOut, Settings2, PiggyBank, TrendingUp, Users, Clock, BarChart3, ArrowDown, ArrowUp, Activity } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { TimeRangeSelector, TimeRange, getDateRange } from '@/components/charts/TimeRangeSelector'
import { PriceChart } from '@/components/charts/PriceChart'
import { KPIGrid } from '@/components/dashboard/KPIGrid'
import { OptimizationSummary } from '@/components/dashboard/OptimizationSummary'
import { PriceHeatmap } from '@/components/dashboard/PriceHeatmap'
import { YearlyOverview } from '@/components/dashboard/YearlyOverview'
import { VolatilityAnalysis } from '@/components/dashboard/VolatilityAnalysis'
import { ScenarioComparison } from '@/components/dashboard/ScenarioComparison'
import { ChargingTimeline } from '@/components/dashboard/ChargingTimeline'
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

    setError(null)
    setIsPricesLoading(true)
    setIsOptimizationLoading(true)

    try {
      let allPrices: PricePoint[] = []

      if (range === 'day') {
        // For day view: single fetch
        const dateStr = format(date, 'yyyy-MM-dd')
        const res = await fetch(`/api/prices?type=day-ahead&date=${dateStr}`)
        if (res.ok) {
          const data = await res.json()
          allPrices = data?.prices || []
        }
      } else {
        // For longer ranges: try batch API first, fallback to per-day
        const startStr = format(startDate, 'yyyy-MM-dd')
        const endStr = format(endDate, 'yyyy-MM-dd')

        try {
          const batchRes = await fetch(`/api/prices/batch?startDate=${startStr}&endDate=${endStr}&type=day-ahead`)
          if (batchRes.ok) {
            const batchData = await batchRes.json()
            allPrices = batchData?.prices || []
          }
        } catch {
          // Batch API not available, fallback silently
        }

        // Fallback: per-day fetching if batch returned nothing
        if (allPrices.length === 0) {
          const dates: Date[] = []
          let current = new Date(startDate)
          while (current <= endDate) {
            dates.push(new Date(current))
            current.setDate(current.getDate() + 1)
            if (dates.length > 90) break
          }

          const fetchPromises = dates.map(d => {
            const dateStr = format(d, 'yyyy-MM-dd')
            return fetch(`/api/prices?type=day-ahead&date=${dateStr}`)
              .then(res => res.ok ? res.json() : null)
              .then(data => data?.prices || [])
              .catch(() => [])
          })
          const results = await Promise.all(fetchPromises)
          allPrices = results.flat()
        }
      }

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

  // Safe stats for non-day views (guard against empty arrays)
  const priceValues = prices.map(p => p.price_ct_kwh)
  const hasData = priceValues.length > 0
  const avgPrice = hasData ? priceValues.reduce((sum, p) => sum + p, 0) / priceValues.length : 0
  const minPrice = hasData ? Math.min(...priceValues) : 0
  const maxPrice = hasData ? Math.max(...priceValues) : 0
  const priceRange = maxPrice - minPrice

  // Best charging time from schedule
  const bestTimeLabel = optimization?.charging_schedule?.[0]
    ? `${optimization.charging_schedule[0].start} - ${optimization.charging_schedule[0].end}`
    : '-'

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 dark:from-slate-950 dark:to-slate-900">
      {/* Header */}
      <header className="sticky top-0 z-50 border-b bg-white/80 backdrop-blur-sm dark:bg-slate-950/80">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-4 sm:px-6 lg:px-8">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10">
              <Zap className="h-5 w-5 text-primary" />
            </div>
            <div>
              <h1 className="text-xl font-bold tracking-tight">FlexMon</h1>
              <p className="text-xs text-muted-foreground">
                Flexibilitaets-Monetarisierung
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
      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        {/* Error */}
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

        {/* Hero KPI Section */}
        <section className="mb-8" aria-label="Wichtige Kennzahlen">
          {isOptimizationLoading || isPricesLoading ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {[1, 2, 3, 4].map((i) => (
                <div key={i} className="h-28 animate-pulse rounded-xl bg-muted" />
              ))}
            </div>
          ) : optimization && timeRange === 'day' ? (
            /* Day view with optimization: Executive KPIs */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {/* Ersparnis pro Ladung */}
              <Card className="border-green-200 bg-gradient-to-br from-green-50 to-emerald-50 dark:border-green-900 dark:from-green-950/30 dark:to-emerald-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">Ersparnis pro Ladung</p>
                    <PiggyBank className="h-5 w-5 text-green-600 dark:text-green-400" />
                  </div>
                  <p className="mt-2 text-3xl font-bold text-green-800 dark:text-green-300">
                    {optimization.savings_eur.toFixed(2)} EUR
                  </p>
                  <p className="mt-1 text-xs text-green-600 dark:text-green-500">
                    Gegenueber Standardtarif
                  </p>
                </CardContent>
              </Card>

              {/* Marge pro Monat */}
              <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-indigo-50 dark:border-blue-900 dark:from-blue-950/30 dark:to-indigo-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-blue-700 dark:text-blue-400">Marge pro Monat</p>
                    <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
                  </div>
                  <p className="mt-2 text-3xl font-bold text-blue-800 dark:text-blue-300">
                    {(optimization.our_margin_eur * 30).toFixed(0)} EUR
                  </p>
                  <p className="mt-1 text-xs text-blue-600 dark:text-blue-500">
                    Hochrechnung (30 Tage)
                  </p>
                </CardContent>
              </Card>

              {/* Kunden-Vorteil */}
              <Card className="border-purple-200 bg-gradient-to-br from-purple-50 to-violet-50 dark:border-purple-900 dark:from-purple-950/30 dark:to-violet-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-purple-700 dark:text-purple-400">Kunden-Vorteil</p>
                    <Users className="h-5 w-5 text-purple-600 dark:text-purple-400" />
                  </div>
                  <p className="mt-2 text-3xl font-bold text-purple-800 dark:text-purple-300">
                    {optimization.customer_benefit_eur.toFixed(2)} EUR
                  </p>
                  <p className="mt-1 text-xs text-purple-600 dark:text-purple-500">
                    Win-Win fuer den Kunden
                  </p>
                </CardContent>
              </Card>

              {/* Beste Ladezeit */}
              <Card className="border-amber-200 bg-gradient-to-br from-amber-50 to-orange-50 dark:border-amber-900 dark:from-amber-950/30 dark:to-orange-950/30">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-amber-700 dark:text-amber-400">Beste Ladezeit</p>
                    <Clock className="h-5 w-5 text-amber-600 dark:text-amber-400" />
                  </div>
                  <p className="mt-2 text-3xl font-bold text-amber-800 dark:text-amber-300">
                    {bestTimeLabel}
                  </p>
                  <p className="mt-1 text-xs text-amber-600 dark:text-amber-500">
                    Guenstigster Zeitraum
                  </p>
                </CardContent>
              </Card>
            </div>
          ) : (
            /* Non-day view or no optimization: Market stats */
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Durchschnittspreis</p>
                    <BarChart3 className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-2 text-3xl font-bold">
                    {hasData ? avgPrice.toFixed(2) : '-'} <span className="text-base font-normal text-muted-foreground">ct/kWh</span>
                  </p>
                </CardContent>
              </Card>

              <Card className="border-green-200 bg-green-50/50 dark:border-green-900 dark:bg-green-950/20">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-green-700 dark:text-green-400">Min. Preis</p>
                    <ArrowDown className="h-5 w-5 text-green-600" />
                  </div>
                  <p className="mt-2 text-3xl font-bold text-green-700 dark:text-green-400">
                    {hasData ? minPrice.toFixed(2) : '-'} <span className="text-base font-normal text-green-600/70">ct/kWh</span>
                  </p>
                </CardContent>
              </Card>

              <Card className="border-red-200 bg-red-50/50 dark:border-red-900 dark:bg-red-950/20">
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-red-700 dark:text-red-400">Max. Preis</p>
                    <ArrowUp className="h-5 w-5 text-red-600" />
                  </div>
                  <p className="mt-2 text-3xl font-bold text-red-700 dark:text-red-400">
                    {hasData ? maxPrice.toFixed(2) : '-'} <span className="text-base font-normal text-red-600/70">ct/kWh</span>
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardContent className="p-5">
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-medium text-muted-foreground">Preisspanne</p>
                    <Activity className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <p className="mt-2 text-3xl font-bold">
                    {hasData ? priceRange.toFixed(2) : '-'} <span className="text-base font-normal text-muted-foreground">ct/kWh</span>
                  </p>
                </CardContent>
              </Card>
            </div>
          )}
        </section>

        {/* Main Content: Chart + Sidebar */}
        <section className="mb-8">
          <div className="grid gap-6 lg:grid-cols-3">
            {/* Price Chart - takes 2 columns */}
            <div className="lg:col-span-2">
              <div className="rounded-xl border bg-white p-6 shadow-sm dark:bg-slate-950">
                <div className="mb-4 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">
                    {timeRange === 'day' ? 'Day-Ahead Preiskurve' :
                     timeRange === 'month' ? 'Monatsuebersicht Preise' :
                     timeRange === 'quarter' ? 'Quartalsuebersicht Preise' :
                     'Jahresuebersicht Preise'}
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
                  chargingSchedule={optimization?.charging_schedule}
                  isLoading={isPricesLoading}
                  timeRange={timeRange}
                />
              </div>

              {/* Charging Timeline - below chart, only for day view */}
              {timeRange === 'day' && optimization && optimization.charging_schedule.length > 0 && (
                <div className="mt-4">
                  <ChargingTimeline
                    schedule={optimization.charging_schedule}
                    windowStart={config.window_start}
                    windowEnd={config.window_end}
                    isLoading={isOptimizationLoading}
                  />
                </div>
              )}
            </div>

            {/* Right sidebar */}
            <div className="space-y-4 lg:col-span-1">
              {timeRange === 'day' ? (
                <>
                  {/* Scenario Comparison - replaces static config summary */}
                  <ScenarioComparison
                    optimization={optimization}
                    config={config}
                    prices={prices}
                    isLoading={isOptimizationLoading}
                  />

                  {/* Optimization Summary (collapsed) */}
                  <OptimizationSummary optimization={optimization} isLoading={isOptimizationLoading} />

                  {/* Config edit button */}
                  <div className="rounded-xl border bg-white p-4 shadow-sm dark:bg-slate-950">
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
                      {config.dso && (
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">14a DSO:</span>
                          <span className="font-medium text-purple-600 dark:text-purple-400">{config.dso}</span>
                        </div>
                      )}
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
                <div className="rounded-xl border bg-white p-6 shadow-sm dark:bg-slate-950">
                  <h3 className="mb-4 text-sm font-semibold">Zeitraum-Statistiken</h3>
                  <div className="space-y-3 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Durchschnittspreis:</span>
                      <span className="font-medium">
                        {hasData ? avgPrice.toFixed(2) : '-'} ct/kWh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Min. Preis:</span>
                      <span className="font-medium text-green-600">
                        {hasData ? minPrice.toFixed(2) : '-'} ct/kWh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Max. Preis:</span>
                      <span className="font-medium text-red-600">
                        {hasData ? maxPrice.toFixed(2) : '-'} ct/kWh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Preisspanne:</span>
                      <span className="font-medium">
                        {hasData ? priceRange.toFixed(2) : '-'} ct/kWh
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Datenpunkte:</span>
                      <span className="font-medium">{prices.length}</span>
                    </div>
                  </div>

                  <Button
                    variant="outline"
                    size="sm"
                    className="mt-4 w-full"
                    onClick={() => setShowConfig(true)}
                  >
                    <Settings2 className="mr-2 h-4 w-4" />
                    Konfiguration bearbeiten
                  </Button>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* Full-width sections below chart */}
        <section className="space-y-6">
          {/* Volatility Analysis - visible when multi-day data */}
          {prices.length > 24 && (
            <VolatilityAnalysis prices={prices} />
          )}

          {/* Price Heatmap - always visible when we have data */}
          {prices.length > 0 && (
            <PriceHeatmap
              prices={prices}
              basePrice={config.base_price_ct_kwh}
              margin={config.margin_ct_kwh}
            />
          )}

          {/* Yearly Overview - visible for year/quarter views or when we have multi-day data */}
          {(timeRange === 'year' || timeRange === 'quarter' || prices.length > 48) && prices.length > 0 && (
            <YearlyOverview
              prices={prices}
              selectedYear={selectedDate.getFullYear()}
              onYearChange={(year) => {
                setSelectedDate(new Date(year, 0, 1))
              }}
              onDateSelect={(date) => {
                setTimeRange('day')
                setSelectedDate(date)
              }}
            />
          )}
        </section>
      </main>
    </div>
  )
}
