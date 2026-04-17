'use client'

import { useMemo } from 'react'
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import {
  BATTERY_VARIANTS,
  DEFAULT_BATTERY_SCENARIO,
  getDefaultDischargeCapKw,
  getDefaultLoadProfileId,
  getVariant,
  type BatteryScenario,
} from '@/lib/battery-config'
import {
  computeBatteryEconomics,
  deriveAnnualBatteryResult,
  getAnnualModelPrices,
  getTariffDefaults,
} from '@/lib/battery-economics'
import { useBatteryProfiles } from '@/lib/use-battery-profiles'
import { usePrices } from '@/lib/use-prices'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

interface Props {
  scenario: BatteryScenario
}

interface ManagementRow {
  key: string
  label: string
  chartLabel: string
  country: 'DE' | 'NL'
  hardwareCostEur: number
  netAnnualSavingsEur: number
  paybackYears: number
  npv10: number
  arbitrageSharePct: number
  pvSharePct: number
  arbitrageEur: number
  pvNetEur: number
  annualDragEur: number
  annualDragNeg: number
  isActive: boolean
}

const DISCOUNT_RATE = 0.03

function computeNpv10(hardwareCostEur: number, annualSavings: number): number {
  let npv = -hardwareCostEur
  for (let y = 1; y <= 10; y++) {
    npv += annualSavings / Math.pow(1 + DISCOUNT_RATE, y)
  }
  return npv
}

function buildScenario(
  current: BatteryScenario,
  variantId: BatteryScenario['variantId'],
  country: 'DE' | 'NL',
): BatteryScenario {
  const defaults = getTariffDefaults(country)
  const variant = getVariant(variantId)
  const defaultCap = getDefaultDischargeCapKw(variant)
  if (current.variantId === variantId && current.country === country) return current

  return {
    ...DEFAULT_BATTERY_SCENARIO,
    variantId,
    country,
    loadProfileId:
      current.country === country ? current.loadProfileId : getDefaultLoadProfileId(country),
    annualLoadKwh: current.annualLoadKwh,
    feedInCapKw: defaultCap,
    tariffId: defaults.tariffId,
    terugleverCostEur: country === 'NL' ? 0 : 0,
    exportCompensationPct: defaults.exportCompensationPct,
  }
}

function buildRow(
  scenario: BatteryScenario,
  annual: ReturnType<typeof deriveAnnualBatteryResult>,
): ManagementRow | null {
  if (!annual) return null
  const variant = getVariant(scenario.variantId)
  const economics = computeBatteryEconomics(annual, scenario)
  const paybackYears =
    economics.netAnnualSavingsEur > 0.01
      ? variant.hardwareCostEurIncVat / economics.netAnnualSavingsEur
      : Infinity

  return {
    key: `${scenario.variantId}-${scenario.country}`,
    label: `${variant.label} — ${scenario.country}`,
    chartLabel: `${variant.usableKwh} kWh / ${scenario.country}`,
    country: scenario.country,
    hardwareCostEur: variant.hardwareCostEurIncVat,
    netAnnualSavingsEur: economics.netAnnualSavingsEur,
    paybackYears,
    npv10: computeNpv10(variant.hardwareCostEurIncVat, economics.netAnnualSavingsEur),
    arbitrageSharePct: economics.arbitrageSharePct,
    pvSharePct: economics.pvSharePct,
    arbitrageEur: economics.arbitrageSavingsEur,
    pvNetEur: economics.pvSelfConsumptionNetEur,
    annualDragEur: economics.annualDragEur,
    annualDragNeg: -economics.annualDragEur,
    isActive: false,
  }
}

function formatRange(rows: ManagementRow[]) {
  if (rows.length === 0) return '—'
  const values = rows.map((row) => row.netAnnualSavingsEur)
  const min = Math.min(...values)
  const max = Math.max(...values)
  return `${min.toFixed(0)}-${max.toFixed(0)} EUR/yr`
}

function perHundredKMarketValue(rows: ManagementRow[]) {
  if (rows.length === 0) return '—'
  const best = Math.max(...rows.map((row) => row.netAnnualSavingsEur))
  return `${((best * 100_000) / 1_000_000).toFixed(1)}M EUR/yr`
}

export function ManagementView({ scenario }: Props) {
  const dePrices = usePrices('DE')
  const nlPrices = usePrices('NL')
  const deProfileYear = useMemo(() => {
    const dateLike = dePrices.hourly[0]?.date ?? dePrices.hourlyQH[0]?.date
    const parsed = Number(dateLike?.slice(0, 4))
    return Number.isFinite(parsed) && parsed > 2000 ? parsed : new Date().getUTCFullYear()
  }, [dePrices.hourly, dePrices.hourlyQH])
  const nlProfileYear = useMemo(() => {
    const dateLike = nlPrices.hourly[0]?.date ?? nlPrices.hourlyQH[0]?.date
    const parsed = Number(dateLike?.slice(0, 4))
    return Number.isFinite(parsed) && parsed > 2000 ? parsed : new Date().getUTCFullYear()
  }, [nlPrices.hourly, nlPrices.hourlyQH])
  const deProfiles = useBatteryProfiles(
    'DE',
    scenario.country === 'DE' ? scenario.loadProfileId : 'H0',
    deProfileYear,
  )
  const nlProfiles = useBatteryProfiles(
    'NL',
    scenario.country === 'NL' ? scenario.loadProfileId : 'E1A',
    nlProfileYear,
  )

  const rows = useMemo(() => {
    if (
      deProfiles.loading ||
      nlProfiles.loading ||
      !deProfiles.pvProfile ||
      !deProfiles.loadProfile ||
      !nlProfiles.pvProfile ||
      !nlProfiles.loadProfile
    ) {
      return [] as ManagementRow[]
    }

    const dePvProfile = deProfiles.pvProfile
    const deLoadProfile = deProfiles.loadProfile
    const nlPvProfile = nlProfiles.pvProfile
    const nlLoadProfile = nlProfiles.loadProfile
    if (!dePvProfile || !deLoadProfile || !nlPvProfile || !nlLoadProfile) return [] as ManagementRow[]

    const nextRows: ManagementRow[] = []
    for (const variant of BATTERY_VARIANTS) {
      for (const country of ['DE', 'NL'] as const) {
        const rowScenario = buildScenario(scenario, variant.id, country)
        const prices = country === 'DE' ? dePrices : nlPrices
        const annual = deriveAnnualBatteryResult(
          rowScenario,
          getAnnualModelPrices(prices),
          country === 'DE' ? dePvProfile : nlPvProfile,
          country === 'DE' ? deLoadProfile : nlLoadProfile,
        )
        const row = buildRow(rowScenario, annual)
        if (row) {
          row.isActive = rowScenario.country === scenario.country && rowScenario.variantId === scenario.variantId
          nextRows.push(row)
        }
      }
    }
    return nextRows
  }, [dePrices, nlPrices, deProfiles, nlProfiles, scenario])

  const deRows = rows.filter((row) => row.country === 'DE')
  const nlRows = rows.filter((row) => row.country === 'NL')

  if (rows.length === 0) {
    return (
      <Card className="shadow-sm border-gray-200/80">
        <CardHeader className="pb-2 border-b border-gray-100">
          <CardTitle className="text-base font-semibold text-[#313131]">
            Investor / Management View
          </CardTitle>
        </CardHeader>
        <CardContent className="pt-4">
          <div className="flex items-center justify-center h-[280px]">
            <p className="text-[12px] text-gray-400">Computing cross-country unit economics…</p>
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-2 border-b border-gray-100">
        <CardTitle className="text-base font-semibold text-[#313131]">
          Investor / Management View
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-4 space-y-6">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[860px] border-separate border-spacing-0">
            <thead>
              <tr>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Variant</th>
                <th className="text-left text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Country</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Annual savings</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Hardware</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Payback</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">10yr NPV</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">Arb share</th>
                <th className="text-right text-[10px] font-semibold text-gray-400 uppercase tracking-wider pb-2">PV share</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.key}
                  className={row.isActive ? 'bg-emerald-50/30' : ''}
                >
                  <td className="text-[12px] text-[#313131] py-2 pr-3 border-t border-gray-100">{row.label.replace(` — ${row.country}`, '')}</td>
                  <td className="text-[12px] text-[#313131] py-2 pr-3 border-t border-gray-100">{row.country}</td>
                  <td className="text-[12px] text-right tabular-nums text-[#313131] py-2 pr-3 border-t border-gray-100">{row.netAnnualSavingsEur.toFixed(0)} EUR</td>
                  <td className="text-[12px] text-right tabular-nums text-[#313131] py-2 pr-3 border-t border-gray-100">{row.hardwareCostEur.toFixed(0)} EUR</td>
                  <td className="text-[12px] text-right tabular-nums text-[#313131] py-2 pr-3 border-t border-gray-100">{Number.isFinite(row.paybackYears) ? `${row.paybackYears.toFixed(1)} yr` : '—'}</td>
                  <td className={`text-[12px] text-right tabular-nums py-2 pr-3 border-t border-gray-100 ${row.npv10 < 0 ? 'text-red-600' : 'text-[#313131]'}`}>{row.npv10.toFixed(0)} EUR</td>
                  <td className="text-[12px] text-right tabular-nums text-[#313131] py-2 pr-3 border-t border-gray-100">{row.arbitrageSharePct.toFixed(0)}%</td>
                  <td className="text-[12px] text-right tabular-nums text-[#313131] py-2 border-t border-gray-100">{row.pvSharePct.toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div>
          <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Revenue stream breakdown
          </p>
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={rows} margin={{ top: 8, right: 16, left: 0, bottom: 20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
              <XAxis
                dataKey="chartLabel"
                tick={{ fontSize: 10, fill: '#6B7280' }}
                tickLine={false}
                axisLine={false}
                interval={0}
              />
              <YAxis
                tick={{ fontSize: 10, fill: '#9CA3AF' }}
                tickLine={false}
                axisLine={false}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null
                  const row = payload[0].payload as ManagementRow
                  return (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
                      <p className="text-gray-500 text-[10px]">{row.label}</p>
                      <p className="tabular-nums text-emerald-700">Arbitrage: {row.arbitrageEur.toFixed(0)} EUR</p>
                      <p className="tabular-nums text-amber-700">PV value: {row.pvNetEur.toFixed(0)} EUR</p>
                      <p className="tabular-nums text-red-500">Value drag: {row.annualDragEur.toFixed(0)} EUR</p>
                    </div>
                  )
                }}
              />
              <Bar dataKey="arbitrageEur" stackId="value" fill="#10B981" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="pvNetEur" stackId="value" fill="#F59E0B" radius={[3, 3, 0, 0]} isAnimationActive={false} />
              <Bar dataKey="annualDragNeg" stackId="drag" fill="#F87171" fillOpacity={0.5} isAnimationActive={false} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              DE market
            </p>
            <div className="space-y-1">
              <p className="text-[12px] text-gray-600">Apartment load band modeled: 2,200-3,000 kWh/year via BDEW H0.</p>
              <p className="text-[12px] text-gray-600">Dynamic tariffs are mandatory to offer since 2025; self-consumption arbitrage is contractually viable.</p>
              <p className="text-[12px] text-gray-600">Modeled per-home value range: {formatRange(deRows)}.</p>
              <p className="text-[12px] text-gray-600">At 100k households, modeled end-user value reaches {perHundredKMarketValue(deRows)}.</p>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Source dates: BDEW H0 profile, dynamic-tariff mandate 2025, Phase 8 research 2026-04-17.</p>
          </div>
          <div>
            <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider mb-2">
              NL market
            </p>
            <div className="space-y-1">
              <p className="text-[12px] text-gray-600">Modeled post-2027 only: salderingsregeling ends 2027-01-01, export floor remains &gt;= 50% through 2030.</p>
              <p className="text-[12px] text-gray-600">Dynamic-tariff penetration was ~7% of households (~600,000) in 2025.</p>
              <p className="text-[12px] text-gray-600">Modeled per-home value range: {formatRange(nlRows)}.</p>
              <p className="text-[12px] text-gray-600">At 100k households, modeled end-user value reaches {perHundredKMarketValue(nlRows)} before 2028 network-tariff upside.</p>
            </div>
            <p className="text-[10px] text-gray-400 mt-2">Source dates: post-2027 supplier assumptions and 2025 penetration from Phase 8 research.</p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
