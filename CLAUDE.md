# FlexMon Dashboard — Claude Code Instructions

## Project Overview

B2C Flex Monetization Dashboard — single-page interactive visualization of EV charging load shifting value using real German day-ahead electricity prices (SMARD).

## Tech Stack

- **Framework:** Next.js 16 (App Router), TypeScript
- **Styling:** Tailwind CSS + shadcn/ui
- **Charts:** Recharts (ComposedChart, Line, Area, Bar, ReferenceArea)
- **Prices:** SMARD API + static JSON + Supabase cache + CSV fallback
- **Auth:** JWT (jose), password in DASHBOARD_PASSWORD env var
- **Deployment:** Vercel

## Active Source Structure

```
src/app/v2/page.tsx                     Main dashboard page
src/components/v2/steps/Step2*.tsx       Core visualization (~1270 lines)
src/components/v2/MiniCalendar.tsx       Date picker with spread colors
src/components/v2/SessionCostCard.tsx    Baseline vs. optimized cost
src/components/v2/MonthlySavingsCard.tsx 12-month savings chart
src/components/v2/SavingsHeatmap.tsx     Mileage x frequency matrix
src/lib/v2-config.ts                    Types, constants, defaults
src/lib/use-prices.ts                   Price data hook
src/lib/optimizer.ts                    Optimization algorithm
src/lib/charging-helpers.ts             Shared computation helpers
src/lib/grid-fees.ts                    Module 3 grid fees (10 DSOs)
```

## Key Conventions

- **UI text:** English
- **Commits:** `feat(PROJ-X): description`, `fix(PROJ-X): description`
- **Feature specs:** `features/PROJ-X-name.md`, tracked in `features/INDEX.md`
- **shadcn/ui first:** Only 6 components kept (alert, button, card, input, label, tooltip)
- **Archive:** Unused code lives in `src/_archive/` (excluded from builds via tsconfig)
- **Prices:** EUR/MWh from SMARD, convert to ct/kWh by dividing by 10

## Build & Test

```bash
npm run dev        # Development (localhost:3000)
npm run build      # Production build
npm run lint       # ESLint
```

## Deployment

- Production: web.lhdus.dpdns.org (port 8080)
- Platform: Vercel
- SMARD data auto-updated via GitHub Actions (.github/workflows/update-smard-data.yml)

## Feature Overview

See `features/INDEX.md` for complete feature tracking.

<!-- GSD:project-start source:PROJECT.md -->
## Project

**FlexMon Dashboard — Project Context**

**FlexMon** (EV Flex Charging Dashboard) is a B2C interactive visualization tool that demonstrates the value of smart EV charging through load shifting. It uses real German (and European) day-ahead electricity prices to show how shifting charging sessions to the cheapest hours saves money compared to immediate/"dumb" charging.

**Core Value:** Make the financial benefit of flexible EV charging tangible and easy to understand for end consumers, fleet managers, and business stakeholders.

### Constraints

- **Budget:** Vercel free/hobby tier, Supabase free tier
- **Data:** SMARD updates with ~2 day delay; ENTSO-E can be unreliable (503s)
- **Performance:** Bundle size matters (Recharts is heavy)
- **Browser:** Desktop-first (1440px), mobile is secondary
<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->
## Technology Stack

## Framework & Runtime
| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | ^16.1.1 |
| Runtime | Node.js | 20 (GitHub Actions target) |
| Language | TypeScript | ^5 |
| React | React + React DOM | ^19.0.0 |
| TypeScript target | ES2017 | — |
| Module resolution | bundler (Next.js native) | — |
- `strict: true`
- `paths: { "@/*": ["./src/*"] }` — absolute imports via `@/`
- `exclude: ["src/_archive"]` — archived code excluded from builds
## UI Layer
### Tailwind CSS
- Version: ^3.4.1
- Dark mode: `class` strategy
- Color system: CSS custom properties (`hsl(var(--...))`) for all semantic tokens (background, foreground, primary, secondary, muted, accent, destructive, chart-1..5, sidebar)
- Border radius via CSS var `--radius`
- Accordion animations via Radix keyframes
### shadcn/ui (Radix UI primitives)
- `@radix-ui/react-alert-dialog` ^1.1.15
- `@radix-ui/react-checkbox` ^1.3.3
- `@radix-ui/react-dialog` ^1.1.15
- `@radix-ui/react-dropdown-menu` ^2.1.16
- `@radix-ui/react-label` ^2.1.8
- `@radix-ui/react-popover` ^1.1.15
- `@radix-ui/react-select` ^2.2.6
- `@radix-ui/react-switch` ^1.2.6
- `@radix-ui/react-tabs` ^1.1.13
- `@radix-ui/react-tooltip` ^1.2.8
- Plus: accordion, avatar, collapsible, navigation-menu, progress, radio-group, scroll-area, separator, slot, toast
### Charts
- `recharts` ^3.7.0 — ComposedChart, Line, Area, Bar, ReferenceArea used throughout the dashboard
### Other UI
- `lucide-react` ^0.562.0 — icons
- `next-themes` ^0.4.6 — light/dark theme switching
- `sonner` ^2.0.7 — toast notifications
- `react-day-picker` ^9.13.2 — calendar/date picker
- `cmdk` ^1.1.1 — command palette
## Backend / API
### Next.js API Routes (App Router)
- `GET /api/prices` — single day prices
- `GET /api/prices/batch` — date range, supports `?resolution=quarterhour`, `?type=intraday&index=id3`, `?country=XX`
- `GET /api/generation` — SMARD generation data (solar, wind, load) by date
- `POST /api/auth` — password login, issues JWT session cookie
### Supabase
- `@supabase/supabase-js` ^2.39.3
- Client initialized with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Used as a caching layer (`price_cache` table), not primary data source
- Cache table key: `(date, type)` with upsert on conflict
## External APIs
| API | Purpose | Base URL | Auth |
|-----|---------|----------|------|
| SMARD (BNetzA) | German day-ahead prices, generation data | `https://www.smard.de/app/chart_data` | None (public) |
| ENTSO-E Transparency Platform | European day-ahead prices (non-DE countries) | `https://web-api.tp.entsoe.eu/api` | `ENTSOE_API_TOKEN` env var |
| aWATTar | German EPEX Spot prices (alternative source) | `https://api.awattar.de/v1/marketdata` | None (public) |
| energy-charts.info | Additional generation/forecast data | See `src/lib/energy-charts.ts` | None (public) |
## Auth Approach
- Library: `jose` ^6.1.3 (JWT signing/verification)
- Algorithm: HS256
- Session cookie name: `flexmon-session`
- Session duration: 24 hours
- Password: stored in `DASHBOARD_PASSWORD` env var (single shared password, no user accounts)
- Secret key: `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` env var
- Middleware: `src/middleware.ts` — currently passes all requests through (matcher: `[]`); auth is enforced at the API route level
## Build & Deploy
### Local Dev
### Security Headers (next.config.ts)
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-DNS-Prefetch-Control: on`
- `X-XSS-Protection: 1; mode=block`
### Vercel
- Production URL: `web.lhdus.dpdns.org` (port 8080)
- Platform: Vercel
### GitHub Actions
- Workflow: `.github/workflows/update-smard-data.yml`
- Schedule: daily at 13:30 UTC (14:30 CET / 15:30 CEST)
- Trigger: also `workflow_dispatch` for manual runs
- Commits updated `public/data/smard-prices.json`, `smard-prices-qh.json`, `smard-generation.json`, `smard-meta.json`
## Key Dependencies (full list)
<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->
## Conventions

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
## Styling Approach
- **Tailwind CSS exclusively** — no CSS modules, no inline `style={}` (rare exceptions only for non-Tailwind properties like `scrollbarWidth`)
- Utility classes are concatenated directly as strings; `cn()` from `@/lib/utils` is used in shadcn/ui primitives but rarely in business components
- Text sizes use Tailwind's arbitrary value syntax: `text-[10px]`, `text-[11px]`, `text-[#313131]`
- Brand color is `#EA1C0A` (used for selected state, accents, danger). Defined inline as arbitrary Tailwind values.
- Semantic color palette for states: `emerald-*` = optimized/savings (green), `red-*` = unmanaged/warning, `gray-*` = neutral
- Responsive layout is achieved with Tailwind flex/grid classes; components assume they are placed in a responsive grid by the parent page
- `tabular-nums` is consistently applied to all numeric displays
- `font-mono` is used for code-like labels (times, prices)
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
## Import Patterns
- Path alias `@/` maps to `src/` — always use this for project imports, never relative `../../`
- shadcn/ui components: `import { Card, CardContent } from '@/components/ui/card'`
- Types-only imports use `import type { ... }`: `import type { DailySummary } from '@/lib/v2-config'`
- React hooks are imported destructured from `'react'`: `import { useState, useMemo } from 'react'`
- Third-party chart imports: destructured from `'recharts'`
## Error Handling Patterns
- **Library functions** throw `Error` with descriptive messages for invalid inputs: `throw new Error('Invalid hour: ...')`
- **Unknown lookups** (e.g. unknown DSO) use `console.warn` and return a safe default (`0` for fees)
- **Components** handle missing/empty data by returning `null` or rendering fallback UI (e.g. `if (sortedDays.length === 0) return null`)
- **Optional chaining** (`?.`) and nullish coalescing (`??`) used throughout for safe access
- No try/catch in component render paths — data fetching errors are handled in hooks (`use-prices.ts`)
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
## Git Commit Conventions
| Type | Use |
|------|-----|
| `feat` | New feature |
| `fix` | Bug fix |
| `refactor` | Code restructure without behaviour change |
| `test` | Adding/updating tests |
| `docs` | Documentation only |
| `deploy` | Deployment configuration |
| `chore` | Maintenance (data updates, deps) |
## Feature Tracking
- Every feature gets a spec file at `features/PROJ-<N>-<slug>.md`
- Feature IDs are sequential — check `features/INDEX.md` before creating a new one
- `features/INDEX.md` is the source of truth for all feature statuses
- Valid statuses: `Planned`, `In Progress`, `In Review`, `Deployed`
- Update both the spec header and INDEX.md when status changes
- One feature per spec file — do not combine independent features
## Other Conventions
- **Prices**: EUR/MWh from SMARD → ct/kWh by dividing by 10. Always convert before display.
- **Dates**: YYYY-MM-DD string format throughout; UTC-noon anchor (`T12:00:00Z`) used when constructing `Date` objects to avoid timezone drift
- **Files > 500 lines**: Flag for refactoring (project rule)
- **Archived code**: Move unused components to `src/_archive/` rather than deleting
<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->
## Architecture

## App Router Structure
### Pages
| Route | File | Purpose |
|---|---|---|
| `/` | `src/app/page.tsx` | Redirect to `/v2` |
| `/v2` | `src/app/v2/page.tsx` | Main dashboard (wrapped in `<Suspense>`) |
| `/login` | `src/app/login/page.tsx` | Login page |
### API Routes
| Route | File | Purpose |
|---|---|---|
| `GET /api/prices/batch` | `src/app/api/prices/batch/route.ts` | Multi-source price fetcher with Supabase cache |
| `GET /api/generation` | `src/app/api/generation/route.ts` | Solar/wind/load data from SMARD |
| `POST /api/auth` | `src/app/api/auth/route.ts` | JWT auth (jose), checks `DASHBOARD_PASSWORD` |
### Middleware
## Data Flow
### DE Path (default)
```
```
### Non-DE Path (e.g. NL)
```
```
### Batch API Route (`/api/prices/batch`) — Hourly Fallback Chain (DE)
```
```
## Component Hierarchy
```
```
## State Management
### URL ↔ State Sync (`src/app/v2/page.tsx`)
| URL param | State field |
|---|---|
| `date` | `prices.selectedDate` |
| `mileage` | `scenario.yearlyMileageKm` |
| `plugins_wd` | `scenario.weekdayPlugIns` |
| `plugins_we` | `scenario.weekendPlugIns` |
| `plugin_time` | `scenario.plugInTime` |
| `departure` | `scenario.departureTime` |
| `power` | `scenario.chargePowerKw` (omitted if default 7) |
| `mode` | `scenario.chargingMode` (omitted if 'overnight') |
### React State Layers
- **V2Page**: `scenario` (ChargingScenario), `country` ('DE'|'NL'), `copied`, `showTutorial`
- **usePrices hook**: `hourly`, `hourlyQH`, `daily`, `monthly`, `selectedDate`, `generation`, `intradayId3`, `lastRealDate`, `loading`, `error`
- **Step2ChargingScenario**: local UI state (drag handles, resolution, cost detail mode, renewable overlay toggle, plot area measurements)
## Optimization Engine (`src/lib/optimizer.ts` + `src/lib/charging-helpers.ts`)
### `runOptimization()` (optimizer.ts)
- `prices[]` — hourly price points for the day
- `battery_kwh`, `charge_power_kw`
- `start_level_percent`, `target_level_percent`
- `window_start` / `window_end` (HH:MM) — plug-in to departure
- `base_price_ct_kwh`, `margin_ct_kwh`, `customer_discount_ct_kwh`
- `dso?` — optional DSO for §14a Module 3 grid fees
- `charging_schedule[]` / `baseline_schedule[]` — `ChargingBlock` arrays
- `savings_eur`, `customer_benefit_eur`, `our_margin_eur`
- `avg_price_without_flex`, `avg_price_with_flex`
- `mod3_active`, `savings_from_mod3_eur` (Module 3 fields, optional)
### `computeV2gWindowSavings()` (charging-helpers.ts)
### `computeWindowSavings()` / `computeSpread()` (charging-helpers.ts)
## Country-Aware Data Separation
| Aspect | DE | NL (or other) |
|---|---|---|
| Price source | Static JSON + SMARD incremental | ENTSO-E via `/api/prices/batch?country=NL` |
| Generation data | SMARD (solar, wind, load) | Not available |
| Intraday ID3 | Available (EPEX scraper → Supabase) | Not available |
| QH resolution | SMARD native QH | Hourly expanded ×4 (`isHourlyAvg=true`) |
| Cache prefix | `day-ahead` | `nl:day-ahead` |
| Fallback on error | — | Auto-revert to DE (V2Page `useEffect`) |
| ENTSOE domain | `10Y1001A1001A82H` (DE-LU) | `10YNL----------L` |
## §14a Module 3 Grid Fees (`src/lib/grid-fees.ts`)
<!-- GSD:architecture-end -->

<!-- GSD:workflow-start source:GSD defaults -->
## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:
- `/gsd:quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd:debug` for investigation and bug fixing
- `/gsd:execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->
## Developer Profile

> Profile not yet configured. Run `/gsd:profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
