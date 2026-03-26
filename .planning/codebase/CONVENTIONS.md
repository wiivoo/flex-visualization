# FlexMon Dashboard — Code Conventions

## Component Patterns

### Client vs. Server Components
- All interactive components open with `'use client'` as the very first line (before imports)
- Static/data components (shadcn/ui primitives) do NOT use `'use client'`
- Every business component in `src/components/v2/` is a client component

### Props Interfaces
- Props are typed with a local `interface Props { ... }` or a named interface (e.g. `interface DateStripProps`)
- Props interfaces are defined in the same file, immediately before the component function
- Exported data-shape interfaces (used by callers) are exported at the top of the file with `export interface`
- Default prop values are expressed inline in the destructuring signature: `{ compact = false }`

### Functional Components
- All components are arrow-function expressions assigned to a `const`, except for rare helper sub-functions which use `function` declarations
- Named exports only — no default exports for components
- Component name matches the file name exactly (PascalCase)

### Hooks Usage
- `useMemo`, `useCallback`, `useState`, `useEffect`, `useRef` are imported from `'react'`
- `useCallback` wraps any function passed as a prop or referenced in event handlers
- `useMemo` wraps derived data that depends on props/state arrays

---

## Styling Approach

- **Tailwind CSS exclusively** — no CSS modules, no inline `style={}` (rare exceptions only for non-Tailwind properties like `scrollbarWidth`)
- Utility classes are concatenated directly as strings; `cn()` from `@/lib/utils` is used in shadcn/ui primitives but rarely in business components
- Text sizes use Tailwind's arbitrary value syntax: `text-[10px]`, `text-[11px]`, `text-[#313131]`
- Brand color is `#EA1C0A` (used for selected state, accents, danger). Defined inline as arbitrary Tailwind values.
- Semantic color palette for states: `emerald-*` = optimized/savings (green), `red-*` = unmanaged/warning, `gray-*` = neutral
- Responsive layout is achieved with Tailwind flex/grid classes; components assume they are placed in a responsive grid by the parent page
- `tabular-nums` is consistently applied to all numeric displays
- `font-mono` is used for code-like labels (times, prices)

---

## Naming Conventions

| Thing | Convention | Example |
|-------|-----------|---------|
| Files | PascalCase for components | `SessionCostCard.tsx` |
| Files | camelCase for lib modules | `charging-helpers.ts`, `grid-fees.ts` |
| Components | PascalCase | `MonthlySavingsCard` |
| Props interfaces | `Props` (local) or `<Name>Props` (exported) | `interface Props`, `interface MiniCalendarProps` |
| Exported interfaces | PascalCase with domain name | `MonthlySavingsEntry`, `SpreadResult`, `V2gResult` |
| Constants | SCREAMING_SNAKE_CASE | `BAR_COLOR`, `DSO_TARIFFS`, `HOURLY_ZONES` |
| Variables / parameters | camelCase | `plugInTime`, `baselineEndHour` |
| Boolean props | `is*`, `has*`, `can*`, `show*` | `isQH`, `hasDate3Data`, `isV2G` |
| Event handler props | `on<Event>` | `onSelect`, `onModeChange` |

---

## Import Patterns

- Path alias `@/` maps to `src/` — always use this for project imports, never relative `../../`
- shadcn/ui components: `import { Card, CardContent } from '@/components/ui/card'`
- Types-only imports use `import type { ... }`: `import type { DailySummary } from '@/lib/v2-config'`
- React hooks are imported destructured from `'react'`: `import { useState, useMemo } from 'react'`
- Third-party chart imports: destructured from `'recharts'`

---

## Error Handling Patterns

- **Library functions** throw `Error` with descriptive messages for invalid inputs: `throw new Error('Invalid hour: ...')`
- **Unknown lookups** (e.g. unknown DSO) use `console.warn` and return a safe default (`0` for fees)
- **Components** handle missing/empty data by returning `null` or rendering fallback UI (e.g. `if (sortedDays.length === 0) return null`)
- **Optional chaining** (`?.`) and nullish coalescing (`??`) used throughout for safe access
- No try/catch in component render paths — data fetching errors are handled in hooks (`use-prices.ts`)

---

## Code Organisation

### `src/lib/` — Pure logic, no JSX
| File | Contents |
|------|----------|
| `v2-config.ts` | Types, constants, defaults for the whole app |
| `charging-helpers.ts` | Pure computation: `computeWindowSavings`, `computeSpread`, `computeV2gWindowSavings`, `buildOvernightWindows` |
| `grid-fees.ts` | §14a Module 3 tariff data + pure fee computation functions |
| `optimizer.ts` | Optimization algorithm (picks cheapest charging slots) |
| `use-prices.ts` | React hook — data fetching and caching for price data |
| `smard.ts` | SMARD API client |
| `utils.ts` | `cn()` Tailwind class merger utility |

### `src/components/v2/` — All UI components
- `steps/Step2*.tsx` — main multi-step visualization (large, ~1270 lines)
- One file per card/widget component
- No business logic — call into `src/lib/` for calculations

### `src/components/ui/` — shadcn/ui primitives only
- Do not add business logic here
- Only 6 components are kept: `alert`, `button`, `card`, `input`, `label`, `tooltip`
- shadcn components follow the `React.forwardRef` + `cn()` pattern

### `src/app/` — Next.js App Router
- `src/app/v2/page.tsx` — main dashboard page
- `src/app/api/` — API routes (prices, batch prices, optimize)

### `src/_archive/` — Dead code
- Excluded from TypeScript compilation via `tsconfig.json`
- Do not import from here

---

## Git Commit Conventions

Format: `type(PROJ-X): short description`

| Type | Use |
|------|-----|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behaviour change |
| `test` | Adding/updating tests |
| `docs` | Documentation only |
| `deploy` | Deployment configuration |
| `chore` | Maintenance (data updates, deps) |

Example: `feat(PROJ-29): add dual value stream display to V2G optimizer`

---

## Feature Tracking

- Every feature gets a spec file at `features/PROJ-<N>-<slug>.md`
- Feature IDs are sequential — check `features/INDEX.md` before creating a new one
- `features/INDEX.md` is the source of truth for all feature statuses
- Valid statuses: `Planned`, `In Progress`, `In Review`, `Deployed`
- Update both the spec header and INDEX.md when status changes
- One feature per spec file — do not combine independent features

---

## Other Conventions

- **Prices**: EUR/MWh from SMARD → ct/kWh by dividing by 10. Always convert before display.
- **Dates**: YYYY-MM-DD string format throughout; UTC-noon anchor (`T12:00:00Z`) used when constructing `Date` objects to avoid timezone drift
- **Files > 500 lines**: Flag for refactoring (project rule)
- **Archived code**: Move unused components to `src/_archive/` rather than deleting
