# Coding Conventions

**Analysis Date:** 2026-04-07

## Naming Patterns

**Files:**
- Components: PascalCase `.tsx` — `SessionCostCard.tsx`, `MiniCalendar.tsx`, `YearlySavingsCard.tsx`
- Library modules: kebab-case `.ts` — `charging-helpers.ts`, `grid-fees.ts`, `use-prices.ts`, `v2-config.ts`
- UI primitives (shadcn): lowercase `.tsx` — `button.tsx`, `card.tsx`, `tooltip.tsx`

**Functions:**
- camelCase for all functions: `computeWindowSavings`, `deriveEnergyPerSession`, `buildOvernightWindows`
- Pure computation functions are named verb-first: `compute*`, `derive*`, `build*`, `get*`, `calculate*`
- Boolean-returning helpers: `is*` pattern — `isModul3Active`, `isNightHour`

**Variables / Parameters:**
- camelCase throughout: `plugInTime`, `baselineEndHour`, `energyPerSession`, `weekdayPlugIns`
- Abbreviated units in names: `priceCtKwh`, `priceEurMwh`, `batteryKwh`, `chargePowerKw`

**Constants:**
- SCREAMING_SNAKE_CASE: `BAR_COLOR`, `DSO_TARIFFS`, `HOURLY_ZONES`, `AVG_CONSUMPTION_KWH_PER_100KM`
- Default objects: `DEFAULT_SCENARIO`, `DEFAULT_FLEET_CONFIG`, `DEFAULT_VALUE_ESTIMATES`

**Types/Interfaces:**
- PascalCase with domain name: `HourlyPrice`, `DailySummary`, `ChargingScenario`, `SpreadResult`, `V2gResult`
- Props interfaces: local `interface Props { ... }` when not exported, named `interface <Name>Props` when exported
  - Example (local): `interface Props { sessionCost: SessionCostData; ... }` in `SessionCostCard.tsx`
  - Example (exported): `interface MiniCalendarProps` in `MiniCalendar.tsx`
- Union types with string literals: `type Tarifzone = 'HT' | 'ST' | 'NT'`, `type SpreadMode = 'normal' | 'wide' | 'narrow' | 'off'`

**Boolean Props:**
- Prefix with `is*`, `has*`, `show*`: `isQH`, `isV2G`, `hasDate3Data`, `isFleet`, `isProjected`

**Event Handler Props:**
- `on<Event>` pattern: `onSelect`, `onModeChange`

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | PascalCase for components | `SessionCostCard.tsx` |
| Files | kebab-case for lib modules | `charging-helpers.ts`, `grid-fees.ts` |
| Components | PascalCase | `MonthlySavingsCard` |
| Props interfaces | `Props` (local) or `<Name>Props` (exported) | `interface Props`, `interface MiniCalendarProps` |
| Exported interfaces | PascalCase with domain name | `MonthlySavingsEntry`, `SpreadResult`, `V2gResult` |
| Constants | SCREAMING_SNAKE_CASE | `BAR_COLOR`, `DSO_TARIFFS`, `HOURLY_ZONES` |
| Variables / parameters | camelCase | `plugInTime`, `baselineEndHour` |
| Boolean props | `is*`, `has*`, `can*`, `show*` | `isQH`, `hasDate3Data`, `isV2G` |
| Event handler props | `on<Event>` | `onSelect`, `onModeChange` |

## Code Style

**Formatting:**
- No Prettier config — relies on editor defaults
- Semicolons: omitted (no-semicolon style throughout)
- Quotes: single quotes for strings
- Trailing commas: used in function parameters and object literals
- Indentation: 2 spaces

**Linting:**
- ESLint with `next/core-web-vitals` preset (`.eslintrc.json`)
- Run: `npm run lint`

## Import Organization

**Order (follow this when adding new imports):**
1. `'use client'` directive (first line, before all imports)
2. React imports: `import { useState, useMemo, useCallback } from 'react'`
3. Next.js imports: `import { useRouter, useSearchParams } from 'next/navigation'`
4. Third-party: `import { ComposedChart, Line, Area } from 'recharts'`
5. Project lib modules: `import { computeWindowSavings } from '@/lib/charging-helpers'`
6. Project components: `import { SessionCostCard } from '@/components/v2/SessionCostCard'`
7. Type-only imports: `import type { HourlyPrice } from '@/lib/v2-config'`

**Path Aliases:**
- `@/` maps to `src/` — always use `@/` for project imports, never relative `../../`
- Example: `import { Card } from '@/components/ui/card'`
- Configured in `tsconfig.json`: `"paths": { "@/*": ["./src/*"] }`

**Type-only imports — use `import type` for interfaces/types not used at runtime:**
```typescript
import type { HourlyPrice, DailySummary } from '@/lib/v2-config'
import type { OptimizeResult } from '@/lib/optimizer'
```

## Component Patterns

**Client vs Server:**
- All interactive components start with `'use client'` as the very first line (before imports)
- Every component in `src/components/v2/` is a client component
- shadcn/ui primitives in `src/components/ui/` do NOT use `'use client'`
- The main page (`src/app/v2/page.tsx`) is a client component

**Function Components — use named exports, arrow or function declaration:**
```typescript
// Pattern used in most components:
export function SessionCostCard({ sessionCost, sessionsPerYear, ... }: Props) {
  // ...
}
```
- Named exports only — no default exports
- Component name matches file name exactly (PascalCase)

**Props — define interface immediately before the component:**
```typescript
interface SessionCostData {
  baselineAvgCt: number
  optimizedAvgCt: number
  // ...
}

interface Props {
  sessionCost: SessionCostData
  sessionsPerYear: number
  isQH: boolean
  chargingMode: 'overnight' | 'fullday' | 'threeday'
  onModeChange: (mode: 'overnight' | 'fullday' | 'threeday') => void
  hasDate3Data?: boolean
}

export function SessionCostCard({
  sessionCost, sessionsPerYear, isQH,
  chargingMode, onModeChange, hasDate3Data = true,
}: Props) {
```
- Default values inline in destructuring: `{ compact = false, requireNextDay = true }`
- Complex data props get dedicated interfaces above Props

**Hooks Usage:**
- `useMemo` wraps derived data depending on props/state
- `useCallback` wraps functions passed as props or used in event handlers
- `useState` for local UI state (toggle, selection, etc.)
- `useEffect` for side effects (URL sync, data fetch)
- `useRef` for DOM measurements (chart plot area)
- `useDeferredValue` used in `Step2ChargingScenario.tsx` for performance

## Styling Approach

**Tailwind CSS exclusively — no CSS modules, no inline `style={}`:**
- Utility classes concatenated as strings directly — no `cn()` in business components
- `cn()` from `@/lib/utils` used only in shadcn/ui primitives

**Text sizes — arbitrary value syntax:**
```tsx
<p className="text-[10px] font-bold text-red-500 uppercase tracking-wider">
<span className="text-[11px] text-gray-400">
<span className="text-[12px] leading-snug">
```

**Semantic Color Palette:**
- Brand accent: `#EA1C0A` (inline arbitrary Tailwind value)
- Optimized/savings (green): `emerald-*` — `bg-emerald-50/60`, `text-emerald-600`, `border-emerald-100/80`
- Unmanaged/warning (red): `red-*` — `bg-red-50/60`, `text-red-500`, `border-red-100/80`
- Neutral: `gray-*`
- Opacity modifiers: `bg-gray-50/80`, `border-gray-200/60`

**Numeric displays — always use these classes:**
- `tabular-nums` on all numeric values
- `font-mono` for time/price labels
- Format: `toFixed(1)` for ct/kWh, `toFixed(2)` for EUR

**Layout:**
- Card-based using shadcn `Card`, `CardHeader`, `CardContent`
- Grid: `grid grid-cols-2 gap-3`
- Spacing: `space-y-4`, `gap-3`, `pt-5`, `pb-3`

## Error Handling

**Library functions (`src/lib/`) — throw on invalid input:**
```typescript
if (hour < 0 || hour > 23) {
  throw new Error(`Invalid hour: ${hour}. Must be between 0 and 23.`)
}
```

**Unknown lookups — warn + safe default:**
```typescript
if (!tariff) {
  console.warn(`Unknown DSO: ${dso}. Grid fee = 0`)
  return 0
}
```

**Components — return null or fallback UI for missing data:**
```typescript
if (sortedDays.length === 0) return null
```
- Use optional chaining (`?.`) and nullish coalescing (`??`) throughout
- No try/catch in render paths — errors handled in hooks

**Hooks (`src/lib/use-prices.ts`):**
- Expose `error: string | null` and `loading: boolean` in return value

## Logging

**Framework:** `console` only (no structured logging)
- `console.warn` for recoverable issues (unknown DSO, missing data)
- `console.log` used in tests for debugging output

## Comments

**Module-level docblock:**
```typescript
/**
 * §14a EnWG Module 3 - Time-variable grid fees
 * Implements time-variable grid fees per §14a EnWG for
 * controllable consumption devices (e.g. EV wallboxes).
 */
```

**Function-level JSDoc for complex APIs:**
```typescript
/**
 * Calculate total cost including grid fee, taxes and VAT.
 * @param priceCtKwh - Exchange electricity price in ct/kWh
 * @param gridFeeCtKwh - Grid fee in ct/kWh
 * @param taxesCtKwh - Taxes, levies, surcharges in ct/kWh
 * @param vatPercent - VAT rate in % (e.g. 19)
 * @returns Total cost in ct/kWh
 */
```

**Section headers within files:**
```typescript
/* ── Spread Indicator Types & Helpers ── */
/* ── V2G (Bidirectional) Optimizer ── */
```

## Module Design

**`src/lib/` — Pure logic, no JSX:**

| File | Contents |
|------|----------|
| `v2-config.ts` | Types, constants, defaults for the whole app |
| `charging-helpers.ts` | Pure computation: `computeWindowSavings`, `computeSpread`, `computeV2gWindowSavings`, `buildOvernightWindows` |
| `grid-fees.ts` | §14a Module 3 tariff data + pure fee computation functions |
| `optimizer.ts` | Optimization algorithm (picks cheapest charging slots) |
| `fleet-optimizer.ts` | Fleet-level flex band + schedule optimization |
| `use-prices.ts` | React hook — data fetching and caching for price data |
| `smard.ts` | SMARD API client |
| `entsoe.ts` | ENTSO-E API client (non-DE countries) |
| `excel-export.ts` | Excel workbook generation |
| `utils.ts` | `cn()` Tailwind class merger utility |

**`src/components/v2/` — All UI components:**
- `steps/Step2ChargingScenario.tsx` — main visualization (~3608 lines)
- One file per card/widget component
- No business logic — call into `src/lib/` for calculations
- Exported interfaces for data shapes used by parent (e.g., `MonthlySavingsEntry`, `YearlySavingsEntry`)

**`src/components/ui/` — shadcn/ui primitives only:**
- 8 components: `alert`, `button`, `card`, `checkbox`, `dialog`, `input`, `label`, `tooltip`
- Follow `React.forwardRef` + `cn()` pattern
- Do not add business logic here

**Barrel files:** Not used — each component/module imported individually

**`src/_archive/` — Dead code:**
- Excluded from TypeScript compilation via `tsconfig.json`
- Do not import from here

## Dates and Numbers

**Dates — YYYY-MM-DD strings with UTC-noon anchor:**
```typescript
const d = new Date(dateStr + 'T12:00:00Z')  // prevents timezone drift
```

**Prices — EUR/MWh from SMARD, ct/kWh for display:**
- Convert by dividing by 10: `priceCtKwh = priceEurMwh / 10`
- Always maintain both `priceEurMwh` and `priceCtKwh` on data objects

**Rounding patterns:**
```typescript
Math.round(value * 100) / 100  // 2 decimals
Math.round(value * 10) / 10    // 1 decimal
```

## Git Commit Conventions

Format: `type(PROJ-X): short description`

| Type | Use |
|------|-----|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behavior change |
| `test` | Adding/updating tests |
| `docs` | Documentation only |
| `deploy` | Deployment configuration |
| `chore` | Maintenance (data updates, deps) |

Example: `feat(PROJ-29): add dual value stream display to V2G optimizer`

## Feature Tracking

- Feature specs: `features/PROJ-<N>-<slug>.md`
- Index: `features/INDEX.md` — source of truth for all feature statuses
- IDs are sequential — check INDEX.md before creating a new one
- Statuses: `Planned`, `In Progress`, `In Review`, `Deployed`
- Update both the spec header and INDEX.md when status changes
- One feature per spec file

## Other Conventions

- **Files > 500 lines**: Flag for refactoring (project rule). Note: `Step2ChargingScenario.tsx` is 3608 lines.
- **Archived code**: Move unused components to `src/_archive/` rather than deleting
- **shadcn/ui first**: Before creating any UI component, check if shadcn/ui has it. Install with `npx shadcn@latest add <name> --yes`

---

*Convention analysis: 2026-04-07*
