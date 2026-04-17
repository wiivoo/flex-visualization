# Phase 8: Plug-in Battery Business Case (DE/NL) — Pattern Map

**Mapped:** 2026-04-17
**Files analyzed:** 12 new/modified files
**Analogs found:** 11 / 12

---

## File Classification

| New / Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------------|------|-----------|----------------|---------------|
| `src/app/battery/page.tsx` | page | request-response + URL-state | `src/app/v2/page.tsx` | exact |
| `src/lib/battery-config.ts` | config / types | — | `src/lib/v2-config.ts` | exact |
| `src/lib/battery-optimizer.ts` | lib / optimizer | transform (pure TS) | `src/lib/charging-helpers.ts` (`computeV2gWindowSavings`) | role-match |
| `src/components/battery/BatteryVariantPicker.tsx` | component | consumer-facing | `src/components/v2/SavingsHeatmap.tsx` (interactive grid cards) | role-match |
| `src/components/battery/BatteryDayChart.tsx` | component | visualization | `src/components/v2/steps/Step2ChargingScenario.tsx` (ComposedChart block) | exact |
| `src/components/battery/BatteryRoiCard.tsx` | component | consumer-facing | `src/components/v2/SessionCostCard.tsx` + `MonthlySavingsCard.tsx` | exact (merged) |
| `src/components/battery/RegulationPanel.tsx` | component | consumer-facing | `src/components/v2/SessionCostCard.tsx` (collapsible section pattern) | role-match |
| `src/components/battery/ManagementView.tsx` | component | visualization | `src/components/v2/MonthlySavingsCard.tsx` (dense table + ComposedChart) | role-match |
| `src/lib/use-prices.ts` | hook | data-fetch | — | verbatim reuse (no changes) |
| `src/components/v2/MiniCalendar.tsx` | component | consumer-facing | — | verbatim reuse (no changes) |
| `public/data/bdew-h0-profile.json` | data asset | static JSON | `public/data/e1a-profile-2025.json` | exact |
| `scripts/precompute-battery-profiles.mjs` | script | batch / I/O | `scripts/extract-chart-data.mjs` | role-match |

---

## Pattern Assignments

---

### `src/app/battery/page.tsx` (page, request-response + URL-state)

**Analog:** `src/app/v2/page.tsx`

**Imports pattern** (lines 1–14):
```typescript
'use client'

import { useState, useMemo, useEffect, useCallback, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { usePrices } from '@/lib/use-prices'
import { DEFAULT_BATTERY_SCENARIO, type BatteryScenario } from '@/lib/battery-config'
// Battery-specific imports replace EV-specific ones — pattern identical
```

**Page shell pattern** (lines 77–79):
```typescript
export default function BatteryPage() {
  return <Suspense><BatteryInner /></Suspense>
}
```

**URL ↔ state parse pattern** (lines 16–56 of analog):
```typescript
function parseScenario(params: URLSearchParams): BatteryScenario {
  const get = (key: string, fallback: number) => {
    const v = Number(params.get(key))
    return isNaN(v) || v === 0 ? fallback : v
  }
  return {
    ...DEFAULT_BATTERY_SCENARIO,
    variantId: (params.get('variant') ?? DEFAULT_BATTERY_SCENARIO.variantId) as BatteryScenario['variantId'],
    country: (params.get('country') ?? 'DE') as 'DE' | 'NL',
    tariffId: params.get('tariff') ?? DEFAULT_BATTERY_SCENARIO.tariffId,
    annualLoadKwh: get('load', DEFAULT_BATTERY_SCENARIO.annualLoadKwh),
    feedInCapKw: get('feedin', DEFAULT_BATTERY_SCENARIO.feedInCapKw) as 0.8 | 2.0,
    terugleverCostEur: get('teruglever', DEFAULT_BATTERY_SCENARIO.terugleverCostEur),
    exportCompensationPct: get('export_pct', DEFAULT_BATTERY_SCENARIO.exportCompensationPct),
    selectedDate: params.get('date') ?? '',
  }
}
```

**URL sync effect pattern** (lines 120–133 of analog):
```typescript
useEffect(() => {
  const p = new URLSearchParams()
  if (scenario.selectedDate) p.set('date', scenario.selectedDate)
  if (scenario.variantId !== DEFAULT_BATTERY_SCENARIO.variantId) p.set('variant', scenario.variantId)
  if (scenario.country !== 'DE') p.set('country', scenario.country)
  if (scenario.tariffId !== DEFAULT_BATTERY_SCENARIO.tariffId) p.set('tariff', scenario.tariffId)
  if (scenario.annualLoadKwh !== 2500) p.set('load', String(scenario.annualLoadKwh))
  if (scenario.feedInCapKw !== 0.8) p.set('feedin', String(scenario.feedInCapKw))
  if (scenario.terugleverCostEur !== 0) p.set('teruglever', String(scenario.terugleverCostEur))
  if (scenario.exportCompensationPct !== 50) p.set('export_pct', String(scenario.exportCompensationPct))
  router.replace(`/battery?${p.toString()}`, { scroll: false })
}, [scenario]) // eslint-disable-line react-hooks/exhaustive-deps
```

**NL error auto-revert pattern** (lines 101–107 of analog):
```typescript
useEffect(() => {
  if (prices.error && scenario.country !== 'DE') {
    console.warn(`[country] ${scenario.country} failed: ${prices.error} — reverting to DE`)
    setScenario(s => ({ ...s, country: 'DE' }))
  }
}, [prices.error, scenario.country])
```

**Page layout pattern** (lines 187–243 of analog):
```typescript
return (
  <div className="min-h-screen bg-[#F5F5F2]">
    <header className="bg-white border-b border-gray-200">
      <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between">
        <h1 className="text-sm font-semibold text-gray-400">Home Battery Business Case</h1>
        {/* nav buttons — same pill style as v2 */}
      </div>
    </header>
    <main className="max-w-[1440px] mx-auto px-8 py-8">
      {/* BatteryVariantPicker, BatteryDayChart, BatteryRoiCard, RegulationPanel, ManagementView */}
    </main>
  </div>
)
```

---

### `src/lib/battery-config.ts` (config / types)

**Analog:** `src/lib/v2-config.ts`

**File header pattern** (lines 1–4 of analog):
```typescript
/**
 * Battery Configuration — shared types and constants for the battery business case page
 */
```

**Interface + const array pattern** (lines 8–43 of analog `VEHICLE_PRESETS`):
```typescript
export interface BatteryVariant {
  id: 'schuko-2kwh' | 'balcony-pv-1.6kwh' | 'wall-5kwh'
  label: string
  description: string
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number       // AC-to-AC, default 0.88
  standbyWatts: number
  includePv: boolean
  pvCapacityWp: number
  hardwareCostEurIncVat: number
  vatRate: number            // 0 | 0.19
  warrantyYears: number
  cycleLife: number
  feedInCapKw: number
  electricianRequired: boolean
  priceConfidence: 'HIGH' | 'MEDIUM' | 'LOW'  // surfaces to UI footnote
}

export const BATTERY_VARIANTS: BatteryVariant[] = [
  // … three entries per RESEARCH.md §Code Examples
]
```

**Default scenario const pattern** (lines 89–108 of analog):
```typescript
export interface BatteryScenario {
  variantId: 'schuko-2kwh' | 'balcony-pv-1.6kwh' | 'wall-5kwh'
  country: 'DE' | 'NL'
  tariffId: string
  annualLoadKwh: number
  feedInCapKw: 0.8 | 2.0
  terugleverCostEur: number
  exportCompensationPct: number
  selectedDate: string
  nlRegime: 'post2027'   // only value in phase 8; kept for future toggle
}

export const DEFAULT_BATTERY_SCENARIO: BatteryScenario = {
  variantId: 'schuko-2kwh',
  country: 'DE',
  tariffId: 'awattar-de',
  annualLoadKwh: 2500,
  feedInCapKw: 0.8,
  terugleverCostEur: 0,
  exportCompensationPct: 50,
  selectedDate: '',
  nlRegime: 'post2027',
}
```

**HourlyPrice re-export** (lines 250–258 of analog — `HourlyPrice` already defined in `v2-config.ts`):
```typescript
// Do NOT redefine HourlyPrice. Import from v2-config:
import type { HourlyPrice } from '@/lib/v2-config'
export type { HourlyPrice }
```

---

### `src/lib/battery-optimizer.ts` (lib / optimizer, pure transform)

**Analog:** `src/lib/charging-helpers.ts` — specifically `computeV2gWindowSavings` (lines 188–361)

**File header + imports pattern** (lines 1–4 of analog):
```typescript
/**
 * Battery day optimizer — greedy three-pass SoC-constrained schedule.
 * Self-consumption arbitrage only (DE: gridExportKwh enforced = 0).
 */
import type { HourlyPrice } from '@/lib/v2-config'
```

**Params interface pattern** (mirrors `V2gResult` shape from lines 128–159 of analog):
```typescript
export interface BatteryParams {
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number       // AC-to-AC
  standbyWatts: number
  feedInCapKw: number        // capped at 0.8 in DE, hardware limit in NL
  allowGridExport: boolean   // always false for phase 8 (both DE and NL plug-in regime)
}

export interface SlotResult {
  timestamp: number
  hour: number
  minute: number
  priceCtKwh: number
  pvKwh: number
  loadKwh: number
  chargeFromGridKwh: number
  chargeFromPvKwh: number
  dischargeToLoadKwh: number
  gridImportKwh: number      // always >= 0 (no export)
  gridExportKwh: number      // always 0 in DE (enforced); 0 in NL plug-in regime
  socKwhStart: number
  socKwhEnd: number
  slotCostEur: number        // negative = savings vs no-battery baseline
}

export interface DaySummary {
  baselineCostEur: number
  optimizedCostEur: number
  savingsEur: number
  arbitrageSavingsEur: number
  pvSelfConsumptionValueEur: number
  standbyCostEur: number
}
```

**Guard pattern for zero-energy input** (lines 177–194 of `optimizer.ts`):
```typescript
export function runBatteryDay(
  prices: HourlyPrice[],
  pvKwhPerSlot: number[],
  loadKwhPerSlot: number[],
  params: BatteryParams,
  startSocKwh: number = 0,
): { slots: SlotResult[]; summary: DaySummary } {
  if (params.usableKwh <= 0 || params.maxChargeKw <= 0) {
    return { slots: [], summary: { baselineCostEur: 0, optimizedCostEur: 0, savingsEur: 0, arbitrageSavingsEur: 0, pvSelfConsumptionValueEur: 0, standbyCostEur: 0 } }
  }
  // ...
}
```

**Three-pass greedy structure** (mirrors structure of `computeV2gWindowSavings` lines 210–288):
```typescript
// Pass 1 — PV self-consumption: use PV directly; surplus → charge battery
// (mirrors netChargeSlotsNeeded reservation pattern, lines 228–231)

// Pass 2 — Arbitrage: sort by price, pair cheap charge ↔ expensive load-shift discharge
// Key difference from V2G: discharge never makes gridImportKwh negative.
// Enforce: dischargeToLoadKwh <= loadKwhPerSlot (cannot export).
// (mirrors buyLow/sellHigh pairing loop, lines 240–263)

// Pass 3 — Chronological SoC continuity walk
// (mirrors execCharge/execDischarge walk, lines 265–288)
```

**SoC floor guard — identical pattern to V2G** (lines 279–288 of analog):
```typescript
if (action === 'discharge' && socKwh - dischargeKwhThisSlot >= 0 - 0.01) {
  // execute discharge
  socKwh = Math.max(socKwh - dischargeKwhThisSlot, 0)
} else if (action === 'charge' && socKwh + chargeKwhThisSlot <= params.usableKwh + 0.01) {
  // execute charge
  socKwh = Math.min(socKwh + chargeKwhThisSlot, params.usableKwh)
}
```

**Annual roll-up function:**
```typescript
export function runBatteryYear(
  allDayPrices: Map<string, HourlyPrice[]>,   // keyed by YYYY-MM-DD
  pvProfile: number[],                         // 8760 or 35040 hourly values, normalized to 1kWh/year
  loadProfile: number[],                       // same format
  pvCapacityKwh: number,                       // scale factor for PV
  annualLoadKwh: number,                       // scale factor for load
  params: BatteryParams,
): { byMonth: MonthlyBatteryResult[]; annual: AnnualBatteryResult }
```

---

### `src/components/battery/BatteryVariantPicker.tsx` (component, consumer-facing)

**Analog:** `src/components/v2/SavingsHeatmap.tsx` (interactive selection grid pattern)

**'use client' + import pattern** (lines 1–5 of analog):
```typescript
'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import type { BatteryVariant, BatteryScenario } from '@/lib/battery-config'
import { BATTERY_VARIANTS } from '@/lib/battery-config'
```

**Props interface pattern** (lines 18–23 of analog):
```typescript
interface Props {
  scenario: BatteryScenario
  setScenario: (s: BatteryScenario) => void
}
```

**Selected-state ring pattern** (lines 106–114 of `SavingsHeatmap.tsx`):
```typescript
// Active/selected card:
className={`rounded-md transition-all ${
  isSelected
    ? 'ring-2 ring-[#EA1C0A] ring-offset-2 scale-[1.02]'
    : 'border border-gray-200/80 shadow-sm hover:shadow-md'
}`}
```

**Segmented control pill pattern** (lines 143–156 of `SessionCostCard.tsx`):
```typescript
<div className="flex items-center gap-1 bg-gray-100 rounded-full p-0.5">
  <button onClick={() => setScenario({ ...scenario, country: 'DE' })}
    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
      scenario.country === 'DE' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
    }`}>
    DE
  </button>
  <button onClick={() => setScenario({ ...scenario, country: 'NL' })}
    className={`text-[11px] font-semibold px-2.5 py-1 rounded-full transition-colors ${
      scenario.country === 'NL' ? 'bg-white text-[#313131] shadow-sm' : 'text-gray-400 hover:text-gray-600'
    }`}>
    NL
  </button>
</div>
```

**Spec grid inside card — typography pattern** (lines 58–94 of `SessionCostCard.tsx`):
```typescript
// Spec rows inside each variant card:
<div className="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px] tabular-nums mt-2">
  <span className="text-gray-400">Capacity</span>
  <span className="font-semibold text-[#313131]">{variant.usableKwh} kWh</span>
  <span className="text-gray-400">Power</span>
  <span className="font-semibold text-[#313131]">{variant.maxDischargeKw} kW</span>
  <span className="text-gray-400">RTE</span>
  <span className="font-semibold text-[#313131]">{Math.round(variant.roundTripEff * 100)}%</span>
  <span className="text-gray-400">Price</span>
  <span className={`font-semibold ${variant.priceConfidence === 'LOW' ? 'text-amber-600' : 'text-[#313131]'} tabular-nums`}>
    {variant.hardwareCostEurIncVat} EUR{variant.priceConfidence === 'LOW' ? ' *' : ''}
  </span>
</div>
```

---

### `src/components/battery/BatteryDayChart.tsx` (component, visualization)

**Analog:** `src/components/v2/steps/Step2ChargingScenario.tsx` — ComposedChart block (lines 2255–2605)

**'use client' + Recharts imports pattern** (lines 1–28 of analog):
```typescript
'use client'

import { useMemo } from 'react'
import {
  ComposedChart, Bar, Area, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceArea,
} from 'recharts'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { SlotResult } from '@/lib/battery-optimizer'
import type { BatteryScenario } from '@/lib/battery-config'
```

**ResponsiveContainer + ComposedChart wrapper pattern** (lines 2255–2260 of analog):
```typescript
<ResponsiveContainer width="100%" height={320}>
  <ComposedChart data={chartData} margin={{ top: 12, right: 48, bottom: 25, left: 20 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
    <XAxis dataKey="label" tick={{ fontSize: 10, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={3} />
    {/* YAxis left: kWh scale */}
    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
    {/* YAxis right: ct/kWh price scale */}
    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false}
      tickFormatter={(v) => v.toFixed(0) + ' ct'} />
```

**Series layering order** (mirrors render order convention of analog):
```typescript
    {/* 1. Household load area (gray-200 fill) */}
    <Area yAxisId="left" dataKey="loadKwh" fill="#E5E7EB" fillOpacity={0.5} stroke="#9CA3AF" strokeWidth={1} dot={false} />
    {/* 2. PV generation area (amber, only when includePv) */}
    {showPv && <Area yAxisId="left" dataKey="pvKwh" fill="#FEF3C7" fillOpacity={0.6} stroke="#F59E0B" strokeWidth={1.5} dot={false} />}
    {/* 3. Battery charge bars (blue-500) */}
    <Bar yAxisId="left" dataKey="chargeKw" fill="#3B82F6" fillOpacity={0.65} maxBarSize={8} />
    {/* 4. Battery discharge-to-load bars (emerald-500) */}
    <Bar yAxisId="left" dataKey="dischargeKw" fill="#10B981" fillOpacity={0.65} maxBarSize={8} />
    {/* 5. Price line (red EA1C0A) */}
    <Line yAxisId="right" dataKey="priceCtKwh" stroke="#EA1C0A" strokeWidth={2} dot={false} />
    {/* 6. SoC line (blue-500, dashed) */}
    <Line yAxisId="right" dataKey="socKwh" stroke="#3B82F6" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
```

**ReferenceArea for DE export prohibition** (mirrors discharge highlight ReferenceArea pattern, lines 2392–2411 of analog):
```typescript
    {/* DE export-prohibited overlay — gray wash over any slot where battery would have exported */}
    {country === 'DE' && prohibitedSlots.map((r, i) => (
      <ReferenceArea key={`de-exp-${i}`} x1={r.x1} x2={r.x2} yAxisId="left"
        fill="#F3F4F6" fillOpacity={0.8} ifOverflow="hidden" />
    ))}
```

**Custom tooltip pattern** (lines 174–200 of `MonthlySavingsCard.tsx`):
```typescript
<Tooltip
  content={({ active, payload }) => {
    if (!active || !payload?.length) return null
    const d = payload[0].payload as SlotChartPoint
    return (
      <div className="bg-white rounded-lg border border-gray-200 shadow-lg px-3 py-2 text-[12px] space-y-0.5">
        <p className="text-gray-500 text-[10px]">{d.label}</p>
        <p className="tabular-nums text-[#EA1C0A] font-semibold">{d.priceCtKwh.toFixed(1)} ct/kWh</p>
        <p className="tabular-nums text-gray-600">Load: {d.loadKwh.toFixed(3)} kWh</p>
        {showPv && <p className="tabular-nums text-amber-600">PV: {d.pvKwh.toFixed(3)} kWh</p>}
        <p className="tabular-nums text-blue-600">SoC: {d.socKwhStart.toFixed(2)} → {d.socKwhEnd.toFixed(2)} kWh</p>
        <p className={`tabular-nums font-semibold ${d.slotSavingsEur < 0 ? 'text-red-600' : 'text-emerald-600'}`}>
          {d.slotSavingsEur >= 0 ? '+' : ''}{d.slotSavingsEur.toFixed(4)} EUR
        </p>
      </div>
    )
  }} />
```

**Loading state shimmer pattern** (use `opacity-30 animate-pulse` on the Line series while `prices.loading`):
```typescript
// When prices.loading === true, pass strokeOpacity={0.3} and add animate-pulse via wrapper div
```

---

### `src/components/battery/BatteryRoiCard.tsx` (component, consumer-facing)

**Analog:** `src/components/v2/SessionCostCard.tsx` (upper half) + `src/components/v2/MonthlySavingsCard.tsx` (lower half)

**'use client' + imports pattern** (line 1 + lines 3–5 of both analogs):
```typescript
'use client'

import { useState, useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts'
import type { AnnualBatteryResult, MonthlyBatteryResult } from '@/lib/battery-optimizer'
import type { BatteryVariant } from '@/lib/battery-config'
```

**Props interface pattern** (lines 7–31 of `SessionCostCard.tsx`):
```typescript
interface Props {
  variant: BatteryVariant
  annualResult: AnnualBatteryResult | null
  selectedDate: string
}
```

**Two-column baseline vs optimized layout** (lines 57–95 of `SessionCostCard.tsx`):
```typescript
<div className="grid grid-cols-2 gap-3">
  {/* No battery */}
  <div className="bg-red-50/60 rounded-lg p-3 border border-red-100/80">
    <p className="text-[10px] font-semibold text-red-500 uppercase tracking-wider mb-2.5">No battery</p>
    {/* avg buy price */}
  </div>
  {/* With battery */}
  <div className="bg-emerald-50/60 rounded-lg p-3 border border-emerald-100/80">
    <p className="text-[10px] font-semibold text-emerald-600 uppercase tracking-wider mb-2.5">With battery</p>
    {/* arbitrage + PV rows */}
  </div>
</div>
```

**4-metric display grid — typography pattern** (from `text-xl font-semibold tabular-nums` convention in UI-SPEC):
```typescript
<div className="grid grid-cols-2 gap-4 mt-4">
  <div>
    <p className="text-xl font-semibold text-emerald-700 tabular-nums">{annualSavingsEur.toFixed(0)} EUR</p>
    <p className="text-[10px] text-gray-400 mt-0.5">Annual savings</p>
  </div>
  <div>
    <p className="text-xl font-semibold text-[#313131] tabular-nums">{paybackYears.toFixed(1)} yr</p>
    <p className="text-[10px] text-gray-400 mt-0.5">Simple payback</p>
  </div>
  <div>
    <p className="text-xl font-semibold text-[#313131] tabular-nums">{breakEvenYear}</p>
    <p className="text-[10px] text-gray-400 mt-0.5">Break-even year</p>
  </div>
  <div>
    <p className={`text-xl font-semibold tabular-nums ${npv10yr >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>{npv10yr.toFixed(0)} EUR</p>
    <p className="text-[10px] text-gray-400 mt-0.5">10-year NPV (3% discount)</p>
  </div>
</div>
```

**Collapsible formula section pattern** (lines 97–128 of `SessionCostCard.tsx`):
```typescript
const [formulaOpen, setFormulaOpen] = useState(false)
// …
<div className="border border-gray-200/60 rounded-lg overflow-hidden">
  <button
    onClick={() => setFormulaOpen(v => !v)}
    className="w-full flex items-center justify-between bg-gray-50/80 px-3.5 py-2 text-left hover:bg-gray-100/60 transition-colors">
    <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">Formula: hardware cost ÷ annual savings = payback (yr)</span>
    <span className="text-[10px] text-gray-400 ml-2">{formulaOpen ? '▲' : '▼'}</span>
  </button>
  {formulaOpen && (
    <div className="px-3.5 py-3 text-[11px] space-y-1.5 bg-gray-50/40">
      {/* hardware cost, standby cost, savings breakdown */}
    </div>
  )}
</div>
```

**Annual stacked bar chart pattern** (lines 167–213 of `MonthlySavingsCard.tsx`):
```typescript
<ResponsiveContainer width="100%" height="100%">
  <ComposedChart data={last12c} margin={{ top: 12, right: 48, bottom: 2, left: 5 }}>
    <CartesianGrid strokeDasharray="3 3" stroke="#E5E7EB" vertical={false} />
    <XAxis dataKey="displayLabel" tick={{ fontSize: 10, fontWeight: 500, fill: '#6B7280' }} tickLine={false} axisLine={false} interval={0} />
    <YAxis yAxisId="left" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
    <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: '#9CA3AF' }} tickLine={false} axisLine={false} />
    {/* Stacked bars: arbitrage (emerald) + PV self-consumption (amber) */}
    <Bar yAxisId="left" dataKey="arbitrageEur" stackId="rev" radius={[0,0,0,0]} maxBarSize={28} fill="#10B981" fillOpacity={0.7} />
    {showPv && <Bar yAxisId="left" dataKey="pvSelfEur" stackId="rev" radius={[3,3,0,0]} maxBarSize={28} fill="#F59E0B" fillOpacity={0.7} />}
    {/* Cumulative line (dashed gray-700) */}
    <Line yAxisId="right" dataKey="cumulative" type="monotone" stroke="#374151" strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={{ r: 3 }} />
  </ComposedChart>
</ResponsiveContainer>
```

**View toggle (Month / Day) pattern** (lines 109–117 of `MonthlySavingsCard.tsx`):
```typescript
<div className="flex gap-0.5 bg-gray-100 rounded p-0.5">
  <button onClick={() => setViewMode('month')}
    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'month' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
    Month
  </button>
  <button onClick={() => setViewMode('day')}
    className={`px-2 py-0.5 rounded text-[10px] font-medium transition-colors ${viewMode === 'day' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400 hover:text-gray-600'}`}>
    Day
  </button>
</div>
```

---

### `src/components/battery/RegulationPanel.tsx` (component, consumer-facing)

**Analog:** `src/components/v2/SessionCostCard.tsx` — collapsible section pattern

**Collapsible open-by-default pattern** (inverse of SessionCostCard's default-closed):
```typescript
'use client'

import { useState } from 'react'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import type { BatteryScenario } from '@/lib/battery-config'

interface Props {
  scenario: BatteryScenario
  setScenario: (s: BatteryScenario) => void
}

export function RegulationPanel({ scenario, setScenario }: Props) {
  const [open, setOpen] = useState(true)  // open by default — differs from SessionCostCard

  return (
    <Card className="shadow-sm border-gray-200/80">
      <CardHeader className="pb-3 border-b border-gray-100">
        <button
          aria-label="Toggle regulation settings"
          onClick={() => setOpen(v => !v)}
          className="w-full flex items-center justify-between">
          <span className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider">
            Regulation Settings
          </span>
          <span className="text-[10px] text-gray-400">{open ? '▲' : '▼'}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="pt-4">
          {/* DE or NL controls based on scenario.country */}
        </CardContent>
      )}
    </Card>
  )
}
```

**Read-only pill for locked parameters** (pattern from UI-SPEC — no analog in codebase):
```typescript
// Locked "Grid export prohibited" read-only pill:
<div className="flex items-center gap-2">
  <span className="text-[12px] text-gray-400">Grid export</span>
  <span className="inline-flex items-center px-2 py-0.5 rounded-full bg-gray-100 border border-gray-200 text-[10px] text-gray-500 font-medium">
    Prohibited
  </span>
  {/* shadcn Tooltip wrapping the pill: "VDE-AR-N 4105:2026-03 — battery discharge to grid not permitted" */}
</div>
```

**DE 800W / 2000W segmented control** (same pill pattern as country toggle):
```typescript
// Same `bg-gray-100 rounded-full p-0.5` pattern as country toggle in BatteryVariantPicker
// Active 2000W: ring-2 ring-[#EA1C0A] + amber badge
```

---

### `src/components/battery/ManagementView.tsx` (component, visualization)

**Analog:** `src/components/v2/MonthlySavingsCard.tsx` (dense table) + `src/components/v2/SavingsHeatmap.tsx` (tabular layout)

**'use client' + imports pattern** (lines 1–9 of `MonthlySavingsCard.tsx`):
```typescript
'use client'

import { useMemo } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  ComposedChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
} from 'recharts'
import type { AnnualBatteryResult } from '@/lib/battery-optimizer'
import type { BatteryVariant } from '@/lib/battery-config'
```

**Section divider pattern** (from UI-SPEC — use `border-t border-gray-200`):
```typescript
<div className="border-t border-gray-200 mt-8">
  <p className="text-[10px] font-semibold text-gray-400 uppercase tracking-wider py-4">
    Investor / Management View
  </p>
</div>
```

**Dense tabular layout** (lines 134–162 of `MonthlySavingsCard.tsx` — day-view table):
```typescript
<table className="w-full text-[12px] tabular-nums">
  <thead>
    <tr className="text-gray-400 text-left">
      <th className="text-[10px] font-semibold pb-1 pr-2 uppercase tracking-wider">Variant</th>
      <th className="text-[10px] font-semibold pb-1 pr-2 uppercase tracking-wider">Country</th>
      <th className="text-[10px] font-semibold pb-1 pr-2 text-right uppercase tracking-wider">Annual savings EUR</th>
      <th className="text-[10px] font-semibold pb-1 pr-2 text-right uppercase tracking-wider">Hardware EUR</th>
      <th className="text-[10px] font-semibold pb-1 pr-2 text-right uppercase tracking-wider">Payback yr</th>
      <th className="text-[10px] font-semibold pb-1 text-right uppercase tracking-wider">10yr NPV EUR</th>
    </tr>
  </thead>
  <tbody>
    {rows.map(row => (
      <tr key={row.key} className={`border-t border-gray-50 ${row.isActive ? 'bg-emerald-50/30' : ''}`}>
        {/* NPV < 0: text-red-600 on NPV column only */}
      </tr>
    ))}
  </tbody>
</table>
```

**100% stacked bar chart for revenue stream breakdown** (mirrors V2G stacked bar in `MonthlySavingsCard.tsx` lines 201–209):
```typescript
<Bar yAxisId="left" dataKey="arbitrageEur" stackId="rev" fill="#10B981" fillOpacity={0.65} />
<Bar yAxisId="left" dataKey="pvSelfEur" stackId="rev" fill="#F59E0B" fillOpacity={0.65} />
{/* Standby cost as negative bar below zero line */}
<Bar yAxisId="left" dataKey="standbyCostNeg" stackId="rev" fill="#F87171" fillOpacity={0.5} />
```

---

### Data Assets: `public/data/bdew-h0-profile.json` and `pvgis-*.json`

**Analog:** `public/data/e1a-profile-2025.json` and `public/data/e1a-profile-relative.json`

Read existing NL profile to confirm exact JSON shape before writing the new ones:
```bash
# At build time: inspect e1a-profile-relative.json shape
# Expected: flat array of numbers, length 8760 or 35040, sum ≈ 1.0
```

**Static JSON shape to match** (from RESEARCH.md §Pattern 3):
```json
[0.000082, 0.000078, 0.000074, ...]
// 8760 entries (hourly) or 35040 entries (QH), normalized so sum = 1.0 kWh/year
// At runtime: multiply each value by actual_kwh_per_year
```

---

### `scripts/precompute-battery-profiles.mjs`

**Analog:** `scripts/extract-chart-data.mjs` (Node.js ESM script pattern)

Check existing script for shebang, import style, and output conventions:
```javascript
// Mirror: ESM with top-level await, fetch() for API calls, fs.writeFileSync for output
// Output: public/data/bdew-h0-profile.json, pvgis-de-south-800w.json, pvgis-nl-south-800w.json
```

---

## Shared Patterns

### `'use client'` Declaration
**Source:** Every file in `src/components/v2/` and `src/app/v2/page.tsx`
**Apply to:** All new files in `src/components/battery/` and `src/app/battery/page.tsx`
**Rule:** `'use client'` is ALWAYS the very first line, before any imports.

### shadcn/ui Import Pattern
**Source:** `src/components/v2/SessionCostCard.tsx` lines 3–5, `MonthlySavingsCard.tsx` lines 3–8
**Apply to:** All `src/components/battery/*.tsx` files
```typescript
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
```

### Path Alias
**Source:** All files in `src/`
**Apply to:** All new files
**Rule:** Always use `@/` alias, never relative `../../`. Example: `import type { HourlyPrice } from '@/lib/v2-config'`

### Typography Constants
**Source:** `src/components/v2/SessionCostCard.tsx` and `MonthlySavingsCard.tsx` throughout
**Apply to:** All `src/components/battery/*.tsx`
```
text-[10px] font-semibold uppercase tracking-wider  → section headers, column headers
text-[12px] font-normal                             → body text, table rows, parameter labels
text-base font-semibold                             → CardTitle
text-xl font-semibold tabular-nums                  → hero metric numbers
font-mono tabular-nums                              → timestamps, prices, ct/kWh values
```

### Color Semantic Tokens
**Source:** `src/components/v2/SessionCostCard.tsx` lines 59–95
**Apply to:** All `src/components/battery/*.tsx`
```
text-emerald-700 / bg-emerald-50/60 / border-emerald-100/80  → savings / optimized
text-red-600 / bg-red-50/60 / border-red-100/80              → baseline / cost / negative NPV
text-amber-600 / bg-amber-50 / border-amber-200               → warnings / assumption flags / NL regime badge
#EA1C0A (ring-2 ring-[#EA1C0A])                              → selected state, active toggle
#3B82F6 / text-blue-600                                       → battery SoC
#F59E0B / text-amber-400                                      → PV generation
```

### Recharts Chart Margin
**Source:** `src/components/v2/MonthlySavingsCard.tsx` line 168; `Step2ChargingScenario.tsx` line 47
**Apply to:** `BatteryDayChart.tsx`, `BatteryRoiCard.tsx` embedded chart, `ManagementView.tsx` chart
```typescript
// For charts with right YAxis label:
margin={{ top: 12, right: 48, bottom: 2, left: 5 }}
// For main intra-day chart:
margin={{ top: 12, right: 48, bottom: 25, left: 20 }}
```

### Empty / Loading State
**Source:** `src/components/v2/MonthlySavingsCard.tsx` — `if (sortedDays.length === 0) return null` pattern; `src/app/v2/page.tsx` loading state
**Apply to:** `BatteryDayChart.tsx`, `BatteryRoiCard.tsx`
```typescript
// No data:
if (!slots || slots.length === 0) return (
  <div className="flex items-center justify-center h-[320px]">
    <p className="text-[12px] text-gray-400">No price data available for this date.</p>
  </div>
)
```

### usePrices Hook Call
**Source:** `src/app/v2/page.tsx` line 98
**Apply to:** `src/app/battery/page.tsx`
```typescript
// Reuse verbatim — no wrapper, no changes:
const prices = usePrices(scenario.country)
// prices.hourlyQH → 96 QH slots per day → pass directly to runBatteryDay()
```

### Assumption Footnote Pattern (Low-Confidence Data)
**Source:** `src/components/v2/SavingsHeatmap.tsx` (projected data note)
**Apply to:** `BatteryVariantPicker.tsx` (Variant A price), `RegulationPanel.tsx` (NL BTW note)
```typescript
// Asterisk marker inline:
<span className="text-[10px] text-amber-600"> *</span>
// Footnote below the section:
<ul className="mt-2 space-y-0.5">
  <li className="text-[10px] text-gray-400">* Retail price not confirmed — placeholder based on similar model.</li>
</ul>
```

---

## No Analog Found

| File | Role | Data Flow | Reason |
|------|------|-----------|--------|
| `scripts/precompute-battery-profiles.mjs` | script | batch / I/O | Closest is `scripts/extract-chart-data.mjs` but that operates on local JSON; this script calls PVGIS and BDEW external APIs — no existing analog for external data precomputation in this codebase |

---

## Metadata

**Analog search scope:** `src/app/v2/`, `src/components/v2/`, `src/lib/`, `scripts/`
**Files scanned:** 9 analog files read in full
**Pattern extraction date:** 2026-04-17
