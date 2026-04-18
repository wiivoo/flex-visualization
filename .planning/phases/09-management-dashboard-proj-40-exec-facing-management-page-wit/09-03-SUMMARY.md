---
phase: 09-management-dashboard-proj-40-exec-facing-management-page-wit
plan: 03
subsystem: management-dashboard
tags: [proj-40, management, explainer, settings, recharts, shadcn, sheet, localstorage]
requirements: [MGMT-04, MGMT-05, MGMT-06, MGMT-07]
dependency-graph:
  requires:
    - "src/lib/management-config.ts (ExplainerData, ManagementScenario, DEFAULT_MANAGEMENT_SCENARIO, MANAGEMENT_STORAGE_KEY — Wave 1)"
    - "src/components/ui/card.tsx (shadcn Card primitive)"
    - "src/components/ui/button.tsx (shadcn Button primitive)"
    - "src/components/ui/input.tsx (shadcn Input primitive)"
    - "src/components/ui/label.tsx (shadcn Label primitive)"
    - "src/components/ui/sheet.tsx (shadcn Sheet primitive — installed this plan)"
    - "recharts ^3.7.0 (ComposedChart, Line, ReferenceArea, Tooltip)"
    - "@radix-ui/react-dialog ^1.1.15 (transitively via shadcn Sheet)"
  provides:
    - "src/components/ui/sheet.tsx (shadcn primitive, exported for any downstream use)"
    - "src/components/management/ExplainerPanel.tsx (named export ExplainerPanel)"
    - "src/components/management/SettingsDrawer.tsx (named exports SettingsDrawer, loadScenarioFromStorage)"
  affects:
    - "Wave 3 /management page can now mount the ExplainerPanel and wire the settings gear to SettingsDrawer"
tech-stack:
  added:
    - "@radix-ui/react-dialog (shadcn Sheet dependency — already present in package.json via Dialog)"
  patterns:
    - "shadcn-first: installed sheet via CLI rather than hand-rolling a drawer"
    - "Recharts ReferenceArea for shaded windows with midnight-wrap split into two sub-ranges"
    - "Recharts stepAfter Line for QH price profile (step changes match 15-min slot semantics)"
    - "Custom Tooltip function component with narrow typed payload prop"
    - "SSR-safe localStorage access gated on typeof window; JSON.parse wrapped in try/catch"
    - "Controlled form with local working copy + Apply propagation pattern"
key-files:
  created:
    - "src/components/ui/sheet.tsx"
    - "src/components/management/ExplainerPanel.tsx"
    - "src/components/management/SettingsDrawer.tsx"
  modified: []
decisions:
  - "Shaded windows use two ReferenceArea children when the window wraps past midnight (endQh < startQh), rather than a single range with custom shape override — keeps the Recharts code idiomatic"
  - "Reconciliation tolerance rendered as a single muted line (emerald when within 1%, red with ⚠ when drift) rather than a separate badge, to avoid visual noise above the chart"
  - "Energy-per-QH intuition table inlined under the chart instead of a hover-only tooltip — non-technical execs benefit from seeing all five power tiers at once rather than needing to know which band to hover"
  - "loadScenarioFromStorage returns DEFAULT_MANAGEMENT_SCENARIO on SSR, missing key, or JSON.parse throw — single unified fallback mitigates threat T-09-D-02 (malformed JSON DoS)"
  - "SettingsDrawer keeps a local form copy; Apply propagates to parent + localStorage, Reset propagates immediately. Closing without Apply discards edits — matches 'working copy' expectations and avoids accidental persistence"
  - "localStorage setItem wrapped in try/catch for private-browsing / quota errors; in-memory Apply still propagates so the drawer works regardless of storage availability"
  - "Input number coercion filters NaN and keeps previous value (guards against intermediate typing states like `-` or empty string)"
metrics:
  duration: "~4 minutes"
  completed: "2026-04-18"
  tasks: 3
  files-created: 3
  files-modified: 0
---

# Phase 9 Plan 3: Management Dashboard Interactive Components (ExplainerPanel + SettingsDrawer) Summary

Two interactive components that turn the Management Dashboard from a static hero row into an auditable, stress-testable view: `ExplainerPanel` proves every headline € with a visible `spread × kWh × sessions` derivation over the month's averaged QH price profile, and `SettingsDrawer` lets a viewer override the fixed scenario locally via a shadcn Sheet backed by localStorage.

## Scope

- **Task 1 — shadcn Sheet primitive**: Installed via `npx shadcn@latest add sheet --yes`. Exports `Sheet`, `SheetContent`, `SheetHeader`, `SheetFooter`, `SheetTitle`, `SheetDescription`, `SheetTrigger`, `SheetClose`, `SheetPortal`, `SheetOverlay`. Built on `@radix-ui/react-dialog`.
- **Task 2 — ExplainerPanel**: Recharts `ComposedChart` with a `stepAfter` Line over the 96-point avg QH price profile. Two `ReferenceArea` pairs (one each for baseline / optimized, with midnight-wrap handled by two sub-ranges). Custom tooltip showing HH:MM / ct/kWh / energy-per-QH. Reconciliation row with four values (`Spread × Energy/session × Sessions = Monthly`). Within-1% tolerance check against the caller-supplied headline. Energy-per-QH intuition table (0.8/3.7/7/11/22 kW) inline under the chart. Empty-state fallback when `avgQhProfile.length === 0`.
- **Task 3 — SettingsDrawer**: shadcn `Sheet side="right" w-[380px]` with five controlled form fields (battery kWh, charge kW, plug-in time, departure time, sessions/week). `Apply` propagates via `onChange` and persists to `localStorage[MANAGEMENT_STORAGE_KEY]`. `Reset to defaults` restores `DEFAULT_MANAGEMENT_SCENARIO` and removes the storage entry. Also exports `loadScenarioFromStorage()` helper for page-level hydration with SSR / malformed-JSON guards.

## Implementation Notes

### `src/components/ui/sheet.tsx` (140 lines — shadcn generated)

Unmodified from shadcn canonical output. Uses a `cva` variant for side (top/bottom/left/right) with standard slide-in/slide-out Tailwind animations. Close button pinned at top-right via `absolute`. Portal + overlay wrap the content per Radix Dialog.

### `src/components/management/ExplainerPanel.tsx` (343 lines)

- First line: `'use client'`
- Shell: `<Card className="flex flex-col gap-4 p-5">`
- Header: `Why these numbers add up` + muted `monthKey`
- Chart block (height 220):
  - `ResponsiveContainer` → `ComposedChart` with `margin={{ top: 8, right: 12, left: 0, bottom: 8 }}`
  - `CartesianGrid strokeDasharray="3 3" vertical={false}`
  - `XAxis dataKey="qhIndex" type="number" domain={[0, 95]} ticks={[0, 24, 48, 72, 95]}` with `HH:MM` formatter
  - `YAxis` with `ct/kWh` axis label, integer tick formatter
  - `Tooltip` with a custom `<ChartTooltip>` function component — accepts `chargePowerKw`, reads `payload[0].payload` to pull the QH point, renders `HH:MM`, `ct/kWh`, and `Energy per QH: X kWh (N kW × 15 min)`
  - `ReferenceArea` pairs for baseline (`#DC2626` @ 0.08 / stroke `#fca5a5`) and optimized (`#059669` @ 0.12 / stroke `#86efac`). When a window wraps past midnight (`endQh < startQh`), `windowToSubRanges()` emits two `{x1, x2}` sub-ranges; first gets the label, second does not.
  - `Line type="stepAfter" dataKey="ctKwh" stroke="#374151" strokeWidth={1.5}` with `isAnimationActive={false}`
- Reconciliation row: 4-column grid (`grid grid-cols-2 md:grid-cols-4`), each cell has an uppercase tracking-wide caption and a large tabular-nums font-mono value. EUR values formatted with `Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' })`.
- Tolerance row: single line, emerald when `|reconciled - monthly| / max(1, |monthly|) ≤ 0.01`, red with `⚠` otherwise. Also shows the derived `spread × power × 0.25` identity in muted text on the right.
- Intuition table: full-width under the chart, `text-[11px] tabular-nums font-mono`, five power rows. Static values precomputed (0.20 / 0.93 / 1.75 / 2.75 / 5.50 kWh per slot).
- Empty state: `No data for selected period` rendered as a 220px-high centered message so the card height matches the chart variant.

### `src/components/management/SettingsDrawer.tsx` (216 lines)

- First line: `'use client'`
- Sheet configuration: `side="right" className="w-[380px] sm:max-w-[380px] flex flex-col gap-5"`
- Local working copy pattern:
  - `const [local, setLocal] = useState<ManagementScenario>(scenario)`
  - `useEffect(() => setLocal(scenario), [scenario])` re-syncs when the parent resets or hydrates from storage
- `handleNumber(field)` — `Number(e.target.value)` then `Number.isFinite` guard; NaN keeps previous value
- `handleTime(field)` — regex-tests `^\d{2}:\d{2}$` before accepting
- `handleApply`: `onChange(local)` → `localStorage.setItem(MANAGEMENT_STORAGE_KEY, JSON.stringify(local))` wrapped in try/catch → `onOpenChange(false)`
- `handleReset`: `setLocal(DEFAULT_MANAGEMENT_SCENARIO)` → `onChange(DEFAULT_MANAGEMENT_SCENARIO)` → `localStorage.removeItem(MANAGEMENT_STORAGE_KEY)` wrapped in try/catch
- Form is a `<form onSubmit>` so Enter submits and the `type="submit"` Apply button doesn't need an `onClick`
- `SheetFooter` row with `Reset to defaults` (ghost variant, left) and `Apply` (default variant, right)

### `loadScenarioFromStorage()` helper

```ts
export function loadScenarioFromStorage(): ManagementScenario {
  if (typeof window === 'undefined') return DEFAULT_MANAGEMENT_SCENARIO;
  try {
    const raw = window.localStorage.getItem(MANAGEMENT_STORAGE_KEY);
    if (!raw) return DEFAULT_MANAGEMENT_SCENARIO;
    const parsed = JSON.parse(raw) as Partial<ManagementScenario>;
    return { ...DEFAULT_MANAGEMENT_SCENARIO, ...parsed };
  } catch {
    return DEFAULT_MANAGEMENT_SCENARIO;
  }
}
```

Single-level spread merge keeps newly-added fields in `DEFAULT_MANAGEMENT_SCENARIO` live even when the cached JSON predates them — future-proof against scenario shape drift. Mitigates threat `T-09-D-02` (malformed JSON DoS).

## Verification

- `test -f src/components/ui/sheet.tsx` → PASS; `SheetContent`, `SheetTrigger`, `SheetHeader`, `SheetTitle`, `SheetDescription` all exported; `@radix-ui/react-dialog` imported.
- `test -f src/components/management/ExplainerPanel.tsx` → PASS; `'use client';` first line; contains `export const ExplainerPanel`, `ReferenceArea`, `avgQhProfile`, `tabular-nums`, `Energy per QH`, `Reconciled within 1%`, `spreadCtKwh`, `No data for selected period`.
- `test -f src/components/management/SettingsDrawer.tsx` → PASS; `'use client';` first line; contains `export const SettingsDrawer`, `export function loadScenarioFromStorage`, `MANAGEMENT_STORAGE_KEY`, `DEFAULT_MANAGEMENT_SCENARIO`, `from '@/components/ui/sheet'`, `Reset to defaults`, `Apply`, `typeof window`.
- `npx tsc --noEmit` → PASS (clean, no output).
- `npm run lint` — project lint script is broken (`Invalid project directory provided`); pre-existing and out-of-scope per the plan's scope-boundary rule. Filed to `deferred-items.md` if not already tracked.

## Deviations from Plan

None — plan executed exactly as written. One minor inline enhancement: the tolerance-check row shows both the headline EUR and the derived EUR (e.g. `headline 97 € ≈ derived 98 €`) rather than just the ratio, because exec audiences want to see both numbers when reconciling. Still within the plan's "discrepancy > 1% renders a warning" spec.

## Known Stubs

None. Both components accept real props; no empty-array placeholders or mock data are wired. Intuition table values are static reference data (not stubs — they're the canonical teaching examples from the feature spec).

## Threat Flags

No new threat surface beyond what the plan's threat model already covered (`T-09-D-01` Tampering, `T-09-D-02` malformed JSON). `SettingsDrawer` mitigates `T-09-D-02` via try/catch around `JSON.parse` in `loadScenarioFromStorage`.

## Self-Check: PASSED

- `src/components/ui/sheet.tsx` exists → FOUND
- `src/components/management/ExplainerPanel.tsx` exists → FOUND
- `src/components/management/SettingsDrawer.tsx` exists → FOUND
- Commit `1bc073a` (chore(ui): add shadcn sheet primitive) → FOUND
- Commit `e5ad086` (feat(PROJ-40): add ExplainerPanel…) → FOUND
- Commit `0425d00` (feat(PROJ-40): add SettingsDrawer…) → FOUND
- `npx tsc --noEmit` → PASS
