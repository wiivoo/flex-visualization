'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts'
import { OptimizationResult, ConfigState, PricePoint, VEHICLE_PROFILES, DSO_PROFILES } from '@/lib/config'

interface ScenarioComparisonProps {
  optimization: OptimizationResult | null
  config: ConfigState
  prices: PricePoint[]
  isLoading?: boolean
}

interface ScenarioData {
  name: string
  shortName: string
  totalCost: number
  marketPrice: number
  gridFee: number
  taxes: number
  color: string
  savings: number
}

// German electricity tax + surcharges (approximate ct/kWh)
const ELECTRICITY_TAX_CT = 2.05
const EEG_UMLAGE_CT = 0 // currently 0 since 2023
const KWK_UMLAGE_CT = 0.275
const OFFSHORE_UMLAGE_CT = 0.656
const KONZESSIONSABGABE_CT = 1.66
const TOTAL_TAXES_CT = ELECTRICITY_TAX_CT + EEG_UMLAGE_CT + KWK_UMLAGE_CT + OFFSHORE_UMLAGE_CT + KONZESSIONSABGABE_CT

// Average grid fee for standard tariff (ct/kWh) - typical German value
const STANDARD_GRID_FEE_CT = 8.0

export function ScenarioComparison({ optimization, config, prices, isLoading }: ScenarioComparisonProps) {
  const scenarios = useMemo(() => {
    if (!optimization || prices.length === 0) return []

    const vehicle = VEHICLE_PROFILES[config.vehicle]
    const energyKwh = optimization.energy_charged_kwh || (
      vehicle.battery_kwh * (100 - config.start_level_percent) / 100
    )

    // 1. Flat Tariff (Standardtarif)
    const flatMarketPrice = config.base_price_ct_kwh
    const flatGridFee = STANDARD_GRID_FEE_CT
    const flatTaxes = TOTAL_TAXES_CT
    const flatTotal = (flatMarketPrice + flatGridFee + flatTaxes) * energyKwh / 100

    // 2. Window Average (DA-indexed)
    const windowAvgPrice = optimization.avg_price_without_flex || 0
    const windowGridFee = STANDARD_GRID_FEE_CT
    const windowTaxes = TOTAL_TAXES_CT
    const windowTotal = (windowAvgPrice + windowGridFee + windowTaxes) * energyKwh / 100

    // 3. Optimized Charging (DA-optimized)
    const optPrice = optimization.avg_price_with_flex || 0
    const optGridFee = STANDARD_GRID_FEE_CT
    const optTaxes = TOTAL_TAXES_CT
    const optTotal = (optPrice + optGridFee + optTaxes) * energyKwh / 100

    // 4. With 14a Modul 3 (DA + variable grid fees)
    let modul3GridFee = STANDARD_GRID_FEE_CT
    if (config.dso && DSO_PROFILES[config.dso]) {
      const dso = DSO_PROFILES[config.dso]
      // Simplified: use NT rate since optimized charging is typically at night
      modul3GridFee = dso.nt_ct_kwh
    }
    const modul3Total = (optPrice + modul3GridFee + TOTAL_TAXES_CT) * energyKwh / 100

    const result: ScenarioData[] = [
      {
        name: 'Standardtarif',
        shortName: 'Flat',
        totalCost: flatTotal,
        marketPrice: flatMarketPrice * energyKwh / 100,
        gridFee: flatGridFee * energyKwh / 100,
        taxes: flatTaxes * energyKwh / 100,
        color: '#94a3b8',
        savings: 0
      },
      {
        name: 'Fenster-Durchschnitt',
        shortName: 'DA-Idx',
        totalCost: windowTotal,
        marketPrice: windowAvgPrice * energyKwh / 100,
        gridFee: windowGridFee * energyKwh / 100,
        taxes: windowTaxes * energyKwh / 100,
        color: '#60a5fa',
        savings: Math.max(0, flatTotal - windowTotal)
      },
      {
        name: 'Optimiertes Laden',
        shortName: 'Opt.',
        totalCost: optTotal,
        marketPrice: optPrice * energyKwh / 100,
        gridFee: optGridFee * energyKwh / 100,
        taxes: optTaxes * energyKwh / 100,
        color: '#34d399',
        savings: Math.max(0, flatTotal - optTotal)
      },
      {
        name: 'Mit 14a Modul 3',
        shortName: '14a',
        totalCost: modul3Total,
        marketPrice: optPrice * energyKwh / 100,
        gridFee: modul3GridFee * energyKwh / 100,
        taxes: TOTAL_TAXES_CT * energyKwh / 100,
        color: '#a78bfa',
        savings: Math.max(0, flatTotal - modul3Total)
      }
    ]

    return result
  }, [optimization, config, prices])

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Szenario-Vergleich</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex h-[200px] items-center justify-center">
            <div className="h-5 w-5 animate-spin rounded-full border-2 border-primary border-t-transparent" />
          </div>
        </CardContent>
      </Card>
    )
  }

  if (scenarios.length === 0) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base">Szenario-Vergleich</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Keine Optimierungsdaten verfügbar.</p>
        </CardContent>
      </Card>
    )
  }

  const maxCost = Math.max(...scenarios.map(s => s.totalCost))

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">Szenario-Vergleich</CardTitle>
        <p className="text-xs text-muted-foreground">Gesamtkosten pro Ladung inkl. aller Abgaben</p>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Bar Chart */}
        <ResponsiveContainer width="100%" height={180}>
          <BarChart
            data={scenarios}
            margin={{ top: 10, right: 10, left: 0, bottom: 0 }}
          >
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" strokeOpacity={0.5} vertical={false} />
            <XAxis
              dataKey="shortName"
              tick={{ fill: '#6b7280', fontSize: 11 }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              domain={[0, Math.ceil(maxCost * 1.15 * 100) / 100]}
              tick={{ fill: '#6b7280', fontSize: 10 }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v.toFixed(1)}`}
              width={40}
            />
            <Tooltip content={<ScenarioTooltip />} />
            <Bar
              dataKey="totalCost"
              radius={[4, 4, 0, 0]}
              isAnimationActive={true}
              animationDuration={800}
              animationBegin={0}
            >
              {scenarios.map((entry, index) => (
                <Cell key={`cell-${index}`} fill={entry.color} />
              ))}
              <LabelList
                dataKey="totalCost"
                position="top"
                formatter={(value: unknown) => `${Number(value).toFixed(2)} EUR`}
                style={{ fill: '#374151', fontSize: 10, fontWeight: 600 }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>

        {/* Scenario details */}
        <div className="space-y-2">
          {scenarios.map((scenario, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg border px-3 py-2">
              <div className="flex items-center gap-2">
                <div
                  className="h-3 w-3 rounded-full"
                  style={{ backgroundColor: scenario.color }}
                />
                <span className="text-xs font-medium">{scenario.name}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold">{scenario.totalCost.toFixed(2)} EUR</span>
                {scenario.savings > 0.005 && (
                  <Badge variant="secondary" className="bg-green-100 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400">
                    -{scenario.savings.toFixed(2)} EUR
                  </Badge>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Price breakdown footnote */}
        <div className="rounded-lg bg-muted/50 p-2">
          <p className="text-xs text-muted-foreground">
            Aufschluesselung: Marktpreis + Netzentgelt ({STANDARD_GRID_FEE_CT.toFixed(1)} ct/kWh) + Steuern/Abgaben ({TOTAL_TAXES_CT.toFixed(2)} ct/kWh)
          </p>
          {config.dso && DSO_PROFILES[config.dso] && (
            <p className="mt-1 text-xs text-purple-600 dark:text-purple-400">
              14a Netzentgelt ({DSO_PROFILES[config.dso].name}): NT {DSO_PROFILES[config.dso].nt_ct_kwh.toFixed(1)} ct/kWh
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  )
}

function ScenarioTooltip({ active, payload }: {
  active?: boolean
  payload?: Array<{ payload: ScenarioData }>
}) {
  if (!active || !payload?.length) return null

  const data = payload[0].payload

  return (
    <div className="rounded-lg border bg-white px-3 py-2 shadow-lg dark:bg-slate-900">
      <p className="text-sm font-semibold">{data.name}</p>
      <div className="mt-1 space-y-0.5 text-xs">
        <p>Marktpreis: {data.marketPrice.toFixed(2)} EUR</p>
        <p>Netzentgelt: {data.gridFee.toFixed(2)} EUR</p>
        <p>Steuern: {data.taxes.toFixed(2)} EUR</p>
        <p className="border-t pt-0.5 font-bold">Gesamt: {data.totalCost.toFixed(2)} EUR</p>
      </div>
    </div>
  )
}
