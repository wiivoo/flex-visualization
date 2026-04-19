---
phase: 260419-gkt
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - src/app/v2/insights/page.tsx
  - src/app/management/page.tsx
  - src/app/v2/page.tsx
autonomous: true
requirements:
  - QUICK-260419-gkt
must_haves:
  truths:
    - "Visiting /v2/insights renders the existing Explorer (heatmap, sensitivity, price patterns) AND a new Performance section above it (KPIs, YoY, explainer)"
    - "Period toggle (YTD / Last 12 / All) and Settings button are present in the /v2/insights header"
    - "TimeFrameBar still controls only the Explorer section; period toggle controls only the Performance section"
    - "Visiting /management 307-redirects to /v2/insights"
    - "v2 More dropdown 'Management' link points to /v2/insights (not /management)"
    - "If management-monthly.json is missing, Performance section shows the inline notice; Explorer section still renders"
    - "Single Suspense fallback skeleton at the top of /v2/insights"
  artifacts:
    - path: "src/app/v2/insights/page.tsx"
      provides: "Combined Insights + Management dashboard (client component, single Suspense)"
      contains: "Performance section AND Explorer section"
    - path: "src/app/management/page.tsx"
      provides: "Server-component redirect to /v2/insights"
      contains: "redirect('/v2/insights')"
    - path: "src/app/v2/page.tsx"
      provides: "More dropdown links Management → /v2/insights"
      contains: "href=\"/v2/insights\""
  key_links:
    - from: "src/app/v2/insights/page.tsx"
      to: "MANAGEMENT_DATA_URL (/data/management-monthly.json)"
      via: "fetch in useEffect"
      pattern: "MANAGEMENT_DATA_URL"
    - from: "src/app/v2/insights/page.tsx"
      to: "@/components/management/{KpiTile,YoyBarChart,ExplainerPanel,SettingsDrawer}"
      via: "named imports"
      pattern: "@/components/management/"
    - from: "src/app/management/page.tsx"
      to: "/v2/insights"
      via: "next/navigation redirect"
      pattern: "redirect\\(.*v2/insights"
---

<objective>
Absorb the standalone /management dashboard into /v2/insights as a single comprehensive page. The page gains a "Performance" section (precomputed monthly KPIs / YoY / explainer, controlled by a period toggle) above the existing "Explorer" section (live sweeps over hourly prices, controlled by TimeFrameBar). /management becomes a thin server-side redirect, and the v2 More dropdown link is updated. Both controls and both data sources remain — they are independent and each section retains its own control.

Purpose: One canonical insights surface. Removes duplication between /management (precomputed monthly aggregates) and /v2/insights (live sweep tools), while preserving every widget from both pages and keeping URL stability for /management.

Output:
- Extended /v2/insights page (Performance + Explorer sections, header with period toggle + Settings + mode toggle + Dashboard link)
- /management → 307 redirect to /v2/insights (server component)
- v2 More dropdown updated to point to /v2/insights
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@./CLAUDE.md
@src/app/v2/insights/page.tsx
@src/app/management/page.tsx
@src/lib/management-config.ts
@src/lib/management-helpers.ts
@src/components/management/KpiTile.tsx
@src/components/management/YoyBarChart.tsx
@src/components/management/ExplainerPanel.tsx
@src/components/management/SettingsDrawer.tsx

<interfaces>
<!-- Key contracts the executor needs. Do not re-explore the codebase. -->

From src/lib/management-config.ts:
```typescript
export interface ManagementScenario {
  batteryCapacityKwh: number
  chargePowerKw: number
  plugInTime: string       // "HH:MM"
  departureTime: string    // "HH:MM"
  sessionsPerWeek: number
}
export interface MonthlyAggregate {
  year: number; month: number; monthKey: string;
  avgSpreadCtKwh: number; energyPerSessionKwh: number;
  sessionsInMonth: number; savingsEur: number; avgDayAheadCtKwh: number;
}
export interface ExplainerData { /* ... */ }
export interface ManagementDataset {
  schemaVersion: 1; generatedAt: string;
  scenario: ManagementScenario; monthly: MonthlyAggregate[];
  explainer: ExplainerData;
}
export const DEFAULT_MANAGEMENT_SCENARIO: ManagementScenario
export const MANAGEMENT_DATA_URL = '/data/management-monthly.json'
```

From src/lib/management-helpers.ts:
```typescript
export function computeYoy(monthly: MonthlyAggregate[], yearA: number, yearB: number): YoyDatum[]
```

From src/components/management/SettingsDrawer.tsx:
```typescript
export function loadScenarioFromStorage(): ManagementScenario
export function SettingsDrawer(props: { open; onOpenChange; scenario; onChange }): JSX.Element
```

From src/components/management/{KpiTile,YoyBarChart,ExplainerPanel}.tsx:
```typescript
export function KpiTile(props: {
  label: string; value: string;
  deltaPct?: number | null; deltaLabel?: string;
  sparklineData?: number[]; accentColor?: string;
}): JSX.Element
export function YoyBarChart(props: { data: YoyDatum[]; yearALabel: string; yearBLabel: string }): JSX.Element
export function ExplainerPanel(props: { data: ExplainerData; scenario: ManagementScenario; monthlySavingsEur: number }): JSX.Element
```

Helpers to copy verbatim from src/app/management/page.tsx (lines 38-199):
- type PeriodKey = 'YTD' | 'LAST_12' | 'ALL'
- BRAND_RED, EUR_FMT, CT_FMT, INT_FMT formatters
- filterByPeriod(monthly, period)
- priorWindow(monthly, current, period)
- reaggregate(entry, scenario, defaultScenario)
- weightedAvgSpread(months), sum(xs), pct(current, prior), padLeft(xs, len), isDefaultScenario(scenario, default)
- function PageSkeleton(), function EmptyState({ message }), function PeriodToggle({ value, onChange })
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend /v2/insights with Performance section (absorb /management body)</name>
  <files>src/app/v2/insights/page.tsx</files>
  <action>
Edit src/app/v2/insights/page.tsx in place. Keep `'use client'` and the top-level Suspense wrapper.

1) Add imports at top of file (alongside existing imports):
   - From 'react': add `useEffect`
   - `import { Button } from '@/components/ui/button'`
   - `import { Card } from '@/components/ui/card'`
   - `import { KpiTile } from '@/components/management/KpiTile'`
   - `import { YoyBarChart } from '@/components/management/YoyBarChart'`
   - `import { ExplainerPanel } from '@/components/management/ExplainerPanel'`
   - `import { SettingsDrawer, loadScenarioFromStorage } from '@/components/management/SettingsDrawer'`
   - `import { DEFAULT_MANAGEMENT_SCENARIO, MANAGEMENT_DATA_URL, type ExplainerData, type ManagementDataset, type ManagementScenario, type MonthlyAggregate } from '@/lib/management-config'`
   - `import { computeYoy } from '@/lib/management-helpers'`

2) Copy verbatim from src/app/management/page.tsx into the insights file (place above `function InsightsInner`):
   - `type PeriodKey`
   - `BRAND_RED`, `EUR_FMT`, `CT_FMT`, `INT_FMT`
   - All pure helpers: `filterByPeriod`, `priorWindow`, `reaggregate`, `weightedAvgSpread`, `sum`, `pct`, `padLeft`, `isDefaultScenario`
   - `function PageSkeleton()` — unchanged
   - `function EmptyState({ message })` — unchanged
   - `interface PeriodToggleProps`, `PERIOD_OPTIONS`, `function PeriodToggle({ value, onChange })` — unchanged
   These are pure / presentational and have no JSX dependencies on the management page itself.

3) Update the top-level `InsightsPage` to use `<Suspense fallback={<PageSkeleton />}>` instead of bare `<Suspense>`.

4) Inside `InsightsInner`, add the management state (above the existing `usePrices` line is fine):
   ```ts
   const [dataset, setDataset] = useState<ManagementDataset | null>(null)
   const [mgmtLoading, setMgmtLoading] = useState<boolean>(true)
   const [mgmtError, setMgmtError] = useState<string | null>(null)
   const [scenario, setScenario] = useState<ManagementScenario>(DEFAULT_MANAGEMENT_SCENARIO)
   const [period, setPeriod] = useState<PeriodKey>('LAST_12')
   const [drawerOpen, setDrawerOpen] = useState<boolean>(false)
   ```
   Note: rename `loading` from the management page to `mgmtLoading` and `loadError` to `mgmtError` to avoid shadowing `prices.loading`/`prices.error`.

5) Add the two effects from the management page (hydrate scenario; fetch MANAGEMENT_DATA_URL). Identical code, just substitute the renamed setters (`setMgmtError`, `setMgmtLoading`).

6) Add the management memos (identical bodies; reference `mgmtLoading`/`mgmtError` if needed):
   - `adjustedMonthly`, `filteredMonthly`, `priorMonthly`, `latestYear`, `yoy`, `kpis`, `explainerData`, `latestMonthlySavings`
   Place them after the existing `dataMin`/`dataMax`/`availableYears`/`dateRange`/`grid`/`series` memos.

7) Compute `scenarioIsCustom = !isDefaultScenario(scenario, DEFAULT_MANAGEMENT_SCENARIO)` and `mgmtIsEmpty = mgmtError !== null || dataset === null || !Array.isArray(dataset?.monthly) || (dataset?.monthly?.length ?? 0) === 0` (only meaningful once `mgmtLoading === false`).

8) Update the header JSX to add the period toggle + Settings button alongside the existing Dashboard back-link. Replace the current header inner div with this layout (keep `<header>` and outer div wrapper unchanged):
   ```tsx
   <div className="max-w-[1440px] mx-auto px-8 py-2 flex items-center justify-between gap-3 flex-wrap">
     <div className="flex items-center gap-4">
       <h1 className="text-sm font-semibold text-gray-400">EV Flex Charging — Insights</h1>
     </div>
     <div className="flex items-center gap-2">
       <PeriodToggle value={period} onChange={setPeriod} />
       <Button
         type="button"
         variant="outline"
         size="sm"
         onClick={() => setDrawerOpen(true)}
         aria-label="Open scenario settings"
       >
         {/* same gear svg as in management/page.tsx */}
         Settings
       </Button>
       <Link href="/v2" className="...existing classes...">Dashboard</Link>
     </div>
   </div>
   ```
   Copy the gear icon SVG verbatim from src/app/management/page.tsx lines 466-486. Keep the existing Dashboard link styling.

9) Reorganize `<main>` content in this order — Performance FIRST, then mode toggle + Explorer:

   ```tsx
   <main className="max-w-[1440px] mx-auto px-8 py-6 space-y-8">

     {/* PERFORMANCE SECTION */}
     <section aria-label="Performance" className="space-y-4">
       <div className="flex items-baseline justify-between">
         <h2 className="text-xl font-bold text-[#313131]">Performance</h2>
         <span className="text-[11px] text-gray-500">Precomputed monthly aggregates</span>
       </div>

       {mgmtLoading ? (
         <div className="text-[12px] text-gray-500 py-8 text-center">Loading aggregated performance…</div>
       ) : mgmtIsEmpty ? (
         <Card className="p-4 text-[12px] text-gray-600">
           No aggregated performance data yet — run <span className="font-mono">scripts/precompute-management-monthly.mjs</span> to generate it.
         </Card>
       ) : (
         <>
           {scenarioIsCustom ? (
             <div className="text-[11px] text-amber-700 bg-amber-50 border border-amber-200 rounded px-2 py-1">
               Custom scenario active — numbers reflect your overrides, not the dashboard defaults.
             </div>
           ) : null}
           {/* KPI row — copy the four <KpiTile> blocks verbatim from src/app/management/page.tsx lines 506-551 */}
           <section aria-label="Key performance indicators" className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
             {/* 4x KpiTile here */}
           </section>
           {/* YoY card — copy from management/page.tsx lines 554-568 */}
           <Card className="p-5">
             <div className="flex items-baseline justify-between mb-3">
               <h2 className="text-sm font-semibold text-foreground">Year over year</h2>
               <span className="text-[11px] text-muted-foreground tabular-nums">{latestYear - 1} vs {latestYear}</span>
             </div>
             <YoyBarChart data={yoy} yearALabel={String(latestYear - 1)} yearBLabel={String(latestYear)} />
           </Card>
           {/* Explainer */}
           {explainerData ? (
             <ExplainerPanel data={explainerData} scenario={scenario} monthlySavingsEur={latestMonthlySavings} />
           ) : null}
         </>
       )}
     </section>

     {/* EXPLORER SECTION — existing content, lightly relabeled */}
     <section aria-label="Explorer" className="space-y-5">
       <div className="flex items-start justify-between gap-6">
         <div>
           <h2 className="text-xl font-bold text-[#313131]">Explorer</h2>
           <p className="text-[12px] text-gray-500 mt-1">
             Find the customers worth targeting and the behaviors worth incentivizing. Adjust the
             controls and watch both views update in real time.
           </p>
         </div>
         <div className="flex items-center gap-2 shrink-0">
           {/* existing single/fleet mode toggle — keep as-is */}
         </div>
       </div>

       {prices.loading && (<div className="text-[12px] text-gray-500 py-12 text-center">Loading price data…</div>)}
       {prices.error && (<div className="text-[12px] text-red-600 py-12 text-center">Failed to load prices: {prices.error}</div>)}

       {!prices.loading && !prices.error && (
         <>
           <TimeFrameBar ... />        {/* unchanged */}
           <InsightsControls ... />    {/* unchanged */}
           {grid && <IdealParametersHeatmap ... />}
           {series && <SensitivityCurves ... />}
           {prices.hourlyQH.length > 0 && <PricePatternsHeatmap hourlyQH={prices.hourlyQH} />}
         </>
       )}
     </section>

     {/* SettingsDrawer — mounted at the page root so it works in empty-state too */}
     <SettingsDrawer open={drawerOpen} onOpenChange={setDrawerOpen} scenario={scenario} onChange={setScenario} />
   </main>
   ```

10) Constraints:
   - Do NOT change any prop signatures of imported components.
   - Do NOT introduce inline `style={}` except where the management `PeriodToggle` already uses one (`{ backgroundColor: BRAND_RED }`) — that's the existing exception we keep.
   - Use `'use client'` (already present).
   - Do NOT touch use-prices, optimizer, or any sweep helpers.

11) The combined file will exceed 500 lines. That is acceptable for this task (per the explicit user goal of combining); flag in commit message but do not split mid-task.
  </action>
  <verify>
    <automated>npm run lint && npm run build</automated>
  </verify>
  <done>
- src/app/v2/insights/page.tsx contains both the Performance section (KpiTile×4, YoyBarChart, ExplainerPanel, EmptyState fallback) and the Explorer section (TimeFrameBar, InsightsControls, IdealParametersHeatmap, SensitivityCurves, PricePatternsHeatmap)
- Header shows: title, PeriodToggle, Settings button, Dashboard link
- mode toggle (single/fleet) sits in the Explorer section header
- SettingsDrawer mounted once
- `npm run build` succeeds
- `npm run lint` passes (no new warnings)
  </done>
</task>

<task type="auto">
  <name>Task 2: Convert /management to a server-side redirect</name>
  <files>src/app/management/page.tsx</files>
  <action>
Replace the entire contents of src/app/management/page.tsx with a minimal server component that redirects to /v2/insights. Do NOT include `'use client'` — `redirect()` requires a server context.

```tsx
import { redirect } from 'next/navigation'

/**
 * /management has been absorbed into /v2/insights (260419-gkt).
 * Permanent server-side redirect preserves any external links / bookmarks.
 */
export default function ManagementRedirect(): never {
  redirect('/v2/insights')
}
```

Notes:
- The `: never` return type matches `redirect()`'s `never` signature.
- No metadata export is required; the redirect happens before render.
- Do NOT delete the file — middleware matcher is empty (`[]`) so no middleware change is needed, but the route must still resolve.
- Components in src/components/management/* and src/lib/management-* MUST be left untouched (they are now imported by /v2/insights and by the precompute script).
  </action>
  <verify>
    <automated>npm run build && curl -sI http://localhost:3000/management 2>/dev/null | head -3 || echo "build OK; runtime check requires dev server"</automated>
  </verify>
  <done>
- src/app/management/page.tsx is a server component (no `'use client'`) that calls `redirect('/v2/insights')`
- Build succeeds
- Visiting /management in dev mode 307s to /v2/insights
  </done>
</task>

<task type="auto">
  <name>Task 3: Update v2 More dropdown link from /management to /v2/insights</name>
  <files>src/app/v2/page.tsx</files>
  <action>
In src/app/v2/page.tsx, locate the More dropdown (around line 216-223) and update the Management link's `href`.

Change:
```tsx
<Link
  href="/management"
  className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
>
  Management
  <span className="text-[10px] text-gray-400">Exec KPIs</span>
</Link>
```

To:
```tsx
<Link
  href="/v2/insights"
  className="flex items-center justify-between rounded-lg px-3 py-2 text-[12px] font-semibold text-gray-600 hover:bg-gray-50 transition-colors"
>
  Management
  <span className="text-[10px] text-gray-400">Exec KPIs</span>
</Link>
```

Keep the visible label as "Management" — users still recognize the destination by name. Only the href changes.

Do not modify any other links in the dropdown (Dynamic, Battery) and do not touch the separate top-level "Insights" button (already points to /v2/insights — leaving it duplicated is fine; both routes go to the same place now).
  </action>
  <verify>
    <automated>grep -n "href=\"/management\"" src/app/v2/page.tsx | wc -l | xargs -I{} test {} -eq 0 && echo OK</automated>
  </verify>
  <done>
- No remaining `href="/management"` in src/app/v2/page.tsx
- The More dropdown's Management entry now points to /v2/insights
- All other dropdown items unchanged
  </done>
</task>

</tasks>

<verification>
End-to-end manual verification (after `npm run dev`):

1. Visit http://localhost:3000/v2/insights
   - Header shows title + Period toggle (YTD / Last 12 / All) + Settings button + Dashboard link
   - Performance section renders first: 4 KPI tiles, YoY card, ExplainerPanel
   - Explorer section renders below: mode toggle, TimeFrameBar, InsightsControls, heatmap, sensitivity curves, price patterns heatmap
   - Period toggle changes only KPIs / YoY / explainer; TimeFrameBar changes only the sweep visualizations
   - Settings button opens the SettingsDrawer; changes persist to localStorage
2. Visit http://localhost:3000/management
   - Browser is 307-redirected to /v2/insights
3. From /v2, open the More dropdown
   - "Management" entry navigates to /v2/insights
4. Empty-state simulation: rename `public/data/management-monthly.json` temporarily
   - Performance section shows the inline notice
   - Explorer section still renders normally
   - Restore the file
</verification>

<success_criteria>
- `npm run lint` passes with no new warnings
- `npm run build` succeeds
- /v2/insights renders both Performance and Explorer sections
- /management redirects to /v2/insights
- v2 More dropdown links to /v2/insights
- No regressions in existing Explorer behavior (sweeps, exports, mode toggle, TimeFrameBar)
- No new files in repo root; no inline styles other than the pre-existing PeriodToggle BRAND_RED background
</success_criteria>

<output>
After completion, create `.planning/quick/260419-gkt-absorb-management-page-into-v2-insights-/260419-gkt-SUMMARY.md` capturing: combined line count of new insights page, any helpers extracted to a shared module (none expected), and a note that the file exceeded 500 lines (expected per task scope).
</output>
