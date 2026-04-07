# Codebase Structure

**Analysis Date:** 2026-04-07

## Directory Layout

```
mmm/
├── .github/
│   └── workflows/
│       └── update-smard-data.yml    # Daily SMARD data update (13:30 UTC)
├── .planning/
│   └── codebase/                    # GSD codebase analysis docs (this file)
├── features/
│   ├── INDEX.md                     # Feature tracking registry
│   └── PROJ-*.md                    # Individual feature specs
├── public/
│   └── data/                        # Static price/generation JSON (auto-updated)
├── scripts/                         # Data extraction and utility scripts
├── src/
│   ├── _archive/                    # Dead code (excluded from tsconfig)
│   ├── app/                         # Next.js App Router pages + API routes
│   ├── components/                  # React components (ui + business)
│   ├── lib/                         # Pure logic, hooks, API clients
│   └── middleware.ts                # Auth middleware (currently no-op)
├── tests/                           # Test files (vitest)
├── input/                           # Input data files
├── logs/                            # Log output
├── supabase/                        # Supabase local dev config
├── next.config.ts                   # Next.js config (security headers)
├── tailwind.config.ts               # Tailwind CSS config
├── tsconfig.json                    # TypeScript config (strict, path aliases)
├── vitest.config.ts                 # Vitest test config
└── package.json                     # Dependencies and scripts
```

## Directory Purposes

**`src/app/`** -- Next.js App Router
- Purpose: Route definitions, page components, API route handlers
- Contains: `page.tsx` files for pages, `route.ts` files for API endpoints, `layout.tsx` for root layout
- Key files:
  - `src/app/page.tsx` (6 lines) -- redirect to `/v2`
  - `src/app/v2/page.tsx` (265 lines) -- main dashboard entry point
  - `src/app/layout.tsx` (22 lines) -- root HTML layout with metadata
  - `src/app/dynamic/page.tsx` (1572 lines) -- dynamic tariff page (DE)
  - `src/app/dynamic/analysis/page.tsx` (1822 lines) -- tariff analysis
  - `src/app/dynamic/nl/page.tsx` (1191 lines) -- NL dynamic tariff

**`src/app/api/`** -- API Routes
- Purpose: Server-side data fetching, caching, auth
- Contains: Next.js route handlers (`route.ts`)
- Key files:
  - `src/app/api/prices/batch/route.ts` (536 lines) -- main price API with 7-source fallback
  - `src/app/api/generation/route.ts` (121 lines) -- SMARD generation data
  - `src/app/api/generation/mix/route.ts` (133 lines) -- full generation mix
  - `src/app/api/auth/route.ts` (112 lines) -- JWT auth with rate limiting
  - `src/app/api/tariff-components/route.ts` (282 lines) -- German PLZ grid fee lookup
  - `src/app/api/nl-tariff-components/route.ts` (185 lines) -- Dutch tariff components

**`src/components/v2/`** -- V2 Dashboard Components
- Purpose: All business UI components for the EV charging dashboard
- Contains: Card widgets, chart components, overlays, config panels
- Key files:
  - `src/components/v2/steps/Step2ChargingScenario.tsx` (3608 lines) -- main visualization mega-component
  - `src/components/v2/SpreadIndicatorsCard.tsx` (539 lines) -- spread metrics [disabled]
  - `src/components/v2/TheoryOverlay.tsx` (511 lines) -- theory explanation modal
  - `src/components/v2/DailySavingsHeatmap.tsx` (477 lines) -- calendar heatmap
  - `src/components/v2/FleetPortfolioCard.tsx` (453 lines) -- fleet portfolio [disabled]
  - `src/components/v2/TutorialOverlay.tsx` (389 lines) -- guided tutorial
  - `src/components/v2/DateStrip.tsx` (312 lines) -- horizontal date navigator
  - `src/components/v2/FlexibilityDemoChart.tsx` (291 lines) -- flexibility demo [disabled]
  - `src/components/v2/MonthlySavingsCard.tsx` (279 lines) -- monthly savings chart
  - `src/components/v2/MiniCalendar.tsx` (246 lines) -- spread-colored calendar
  - `src/components/v2/FleetConfigPanel.tsx` (232 lines) -- fleet config sliders
  - `src/components/v2/YearlySavingsCard.tsx` (200 lines) -- yearly savings summary
  - `src/components/v2/ExportDialog.tsx` (182 lines) -- Excel export dialog
  - `src/components/v2/SessionCostCard.tsx` (160 lines) -- session cost breakdown
  - `src/components/v2/SavingsHeatmap.tsx` (135 lines) -- mileage x frequency matrix [disabled]
  - `src/components/v2/AnimatedNumber.tsx` (54 lines) -- animated counter

**`src/components/dynamic/`** -- Dynamic Tariff Components
- Purpose: Components for the `/dynamic` tariff analysis pages
- Contains: Chart and analysis components
- Key files:
  - `src/components/dynamic/MonthlyPriceTrend.tsx` (557 lines)
  - `src/components/dynamic/DynamicDailySavings.tsx` (389 lines)

**`src/components/ui/`** -- shadcn/ui Primitives
- Purpose: Base UI components (do not add business logic here)
- Contains: shadcn/ui components following `React.forwardRef` + `cn()` pattern
- Active components (8): `alert.tsx`, `button.tsx`, `card.tsx`, `checkbox.tsx`, `dialog.tsx`, `input.tsx`, `label.tsx`, `tooltip.tsx`
- Note: Additional Radix packages installed (accordion, avatar, dropdown-menu, etc.) but components not yet generated

**`src/lib/`** -- Pure Logic and Hooks
- Purpose: Business logic, computation, API clients, data hooks -- no JSX
- Contains: TypeScript modules with pure functions and one React hook
- Total: 5360 lines across 22 files

| File | Lines | Purpose |
|---|---|---|
| `excel-export.ts` | 832 | Excel export with formulas and formatting |
| `use-prices.ts` | 549 | React hook: load, merge, derive price data |
| `slp-h25.ts` | 471 | German standard load profiles (H25 household) |
| `charging-helpers.ts` | 400 | Pure computation: spread, savings, V2G, overnight windows |
| `fleet-optimizer.ts` | 397 | Fleet flex band: distributions, optimization, energy calc |
| `nl-tariff.ts` | 377 | Dutch tariff structure and component calculation |
| `dynamic-tariff.ts` | 359 | Dynamic tariff computation: surcharges, end-customer price |
| `optimizer.ts` | 315 | Single-EV optimization engine (greedy cheapest-slot) |
| `v2-config.ts` | 299 | Types, constants, defaults, interfaces for V2 dashboard |
| `nl-slp.ts` | 203 | Dutch standard load profiles |
| `grid-fees.ts` | 178 | Section 14a Module 3 grid fees (10 DSOs) |
| `entsoe.ts` | 155 | ENTSO-E Transparency Platform API client |
| `config.ts` | 149 | Legacy types: PricePoint, ChargingBlock, ConfigState |
| `smard.ts` | 133 | SMARD API client (filter 4169 = DE-LU prices) |
| `price-cache.ts` | 130 | Supabase price_cache read/write with TTL |
| `csv-prices.ts` | 111 | CSV file price reader (offline fallback) |
| `energy-forecast.ts` | 104 | EnergyForecast.de API client (48h forecast) |
| `awattar.ts` | 72 | aWATTar REST API client (DE/AT spot prices) |
| `energy-charts.ts` | 69 | Fraunhofer ISE Energy-Charts API client |
| `auth.ts` | 44 | JWT sign/verify helpers (jose) |
| `supabase.ts` | 7 | Supabase client singleton |
| `utils.ts` | 6 | shadcn `cn()` class merger utility |

**`src/_archive/`** -- Dead Code
- Purpose: Archived/unused code excluded from builds
- Excluded via `tsconfig.json` exclude array
- Do not import from here
- Move unused components here rather than deleting

**`public/data/`** -- Static Data Files
- Purpose: Pre-downloaded price and generation data for fast first paint
- Updated by: GitHub Actions daily, also manual `node scripts/download-smard.mjs`
- Key files:

| File | Size | Purpose |
|---|---|---|
| `smard-prices.json` | 1.1MB | Compact hourly DE prices `[{t, p}]` (EUR/MWh) |
| `smard-prices-qh.json` | 4.5MB | Compact quarter-hourly DE prices |
| `smard-generation.json` | 1.7MB | Compact generation `[{t, s, w, l}]` (solar, wind, load MW) |
| `smard-meta.json` | 233B | Metadata about last SMARD update |
| `nl-prices.json` | 1.1MB | Dutch hourly prices (ENTSO-E) |
| `nl-prices-qh.json` | 4.5MB | Dutch QH prices (expanded from hourly) |
| `projected-prices.json` | 1.3MB | Projected/forecast prices |
| `e1a-profile-2025.json` | 2.0MB | E1A load profile data (2025) |
| `e1a-profile-relative.json` | 15KB | Relative E1A profile |
| `epex-css.json` | 42KB | EPEX CSS intraday data |

**`features/`** -- Feature Tracking
- Purpose: Feature specs and tracking registry
- Contains: `INDEX.md` (source of truth for statuses) and `PROJ-N-slug.md` spec files
- Sequential IDs, one feature per file

**`tests/`** -- Test Files
- Purpose: Unit and integration tests
- Framework: Vitest (config at `vitest.config.ts`)

**`scripts/`** -- Utility Scripts
- Purpose: Data download, extraction, maintenance scripts
- Key files: `extract-chart-data.mjs`

## Key File Locations

**Entry Points:**
- `src/app/page.tsx` -- root redirect to `/v2`
- `src/app/v2/page.tsx` -- main dashboard (URL state sync, optimization, data loading)
- `src/app/dynamic/page.tsx` -- dynamic tariff page

**Configuration:**
- `next.config.ts` -- Next.js config with security headers
- `tailwind.config.ts` -- Tailwind CSS with CSS variable color system
- `tsconfig.json` -- TypeScript strict mode, `@/*` path alias, `src/_archive` excluded
- `vitest.config.ts` -- Vitest test configuration
- `.github/workflows/update-smard-data.yml` -- daily SMARD data update

**Core Logic:**
- `src/lib/optimizer.ts` -- single-EV optimization algorithm
- `src/lib/charging-helpers.ts` -- savings computation, spread analysis, V2G optimizer
- `src/lib/fleet-optimizer.ts` -- fleet flex band computation
- `src/lib/use-prices.ts` -- central data hook (static load + incremental update)
- `src/lib/v2-config.ts` -- authoritative types and constants

**API Clients (server-side):**
- `src/lib/smard.ts` -- SMARD (BNetzA)
- `src/lib/entsoe.ts` -- ENTSO-E Transparency Platform
- `src/lib/awattar.ts` -- aWATTar
- `src/lib/energy-charts.ts` -- Fraunhofer ISE Energy-Charts
- `src/lib/energy-forecast.ts` -- EnergyForecast.de
- `src/lib/csv-prices.ts` -- local CSV fallback

**Testing:**
- `tests/` -- test files
- `vitest.config.ts` -- test configuration

## Naming Conventions

**Files:**
- PascalCase for React components: `SessionCostCard.tsx`, `DateStrip.tsx`
- kebab-case for lib modules: `charging-helpers.ts`, `grid-fees.ts`, `use-prices.ts`
- `route.ts` for API routes (Next.js convention)
- `page.tsx` for pages (Next.js convention)

**Directories:**
- lowercase for all directories: `components/`, `lib/`, `api/`
- Nested API routes mirror URL: `api/prices/batch/route.ts` = `GET /api/prices/batch`

## Where to Add New Code

**New V2 Dashboard Card/Widget:**
- Component: `src/components/v2/NewCard.tsx` (PascalCase)
- Import and render in: `src/components/v2/steps/Step2ChargingScenario.tsx`
- If it needs new types: add to `src/lib/v2-config.ts`
- If it needs new computation: add pure function to `src/lib/charging-helpers.ts` or new file in `src/lib/`

**New Dynamic Tariff Component:**
- Component: `src/components/dynamic/NewComponent.tsx`
- Import in: `src/app/dynamic/page.tsx` or relevant dynamic page

**New API Route:**
- Create: `src/app/api/<name>/route.ts`
- Use Zod for input validation
- Follow existing pattern: NextRequest/NextResponse, error handling with status codes

**New External API Client:**
- Create: `src/lib/<service-name>.ts` (kebab-case)
- Export fetch functions, keep as pure as possible
- Integrate into `src/app/api/prices/batch/route.ts` fallback chain if it's a price source

**New Computation/Helper:**
- Add to existing `src/lib/charging-helpers.ts` if related to savings/spread/windows
- Add to existing `src/lib/fleet-optimizer.ts` if related to fleet modeling
- Create new `src/lib/<name>.ts` if it's a distinct domain

**New shadcn/ui Component:**
- Install: `npx shadcn@latest add <name> --yes`
- Goes to: `src/components/ui/<name>.tsx`
- Never add business logic to ui/ components

**New Feature Spec:**
- Check: `features/INDEX.md` for next sequential PROJ-N
- Create: `features/PROJ-N-slug.md`
- Update: `features/INDEX.md` with new entry

**Utility Scripts:**
- Location: `scripts/<name>.mjs`

**Tests:**
- Location: `tests/<name>.test.ts`

## Special Directories

**`src/_archive/`:**
- Purpose: Archived/unused code preserved for reference
- Generated: No (manually moved)
- Committed: Yes
- Excluded from TypeScript compilation via `tsconfig.json`

**`public/data/`:**
- Purpose: Static price/generation data for fast first paint
- Generated: Yes (by GitHub Actions and manual scripts)
- Committed: Yes (tracked in git, auto-updated by CI)

**`supabase/`:**
- Purpose: Supabase local development configuration
- Generated: Partially (Supabase CLI)
- Committed: Partially (`.temp/` is not)

**`.planning/`:**
- Purpose: GSD workflow planning artifacts and codebase analysis
- Generated: Yes (by GSD commands)
- Committed: Yes

## Import Dependency Graph

```
src/app/v2/page.tsx
  <-- src/lib/use-prices.ts
  <-- src/lib/optimizer.ts
  <-- src/lib/v2-config.ts
  <-- src/lib/excel-export.ts (type only)
  <-- src/components/v2/steps/Step2ChargingScenario.tsx
  <-- src/components/v2/TutorialOverlay.tsx
  <-- src/components/v2/ExportDialog.tsx

src/components/v2/steps/Step2ChargingScenario.tsx
  <-- src/lib/v2-config.ts (types + constants)
  <-- src/lib/charging-helpers.ts (computations)
  <-- src/lib/fleet-optimizer.ts (fleet computations)
  <-- src/lib/optimizer.ts (type only: OptimizeResult)
  <-- src/lib/excel-export.ts (type only: EnrichedWindow)
  <-- src/components/v2/AnimatedNumber.tsx
  <-- src/components/v2/DateStrip.tsx
  <-- src/components/v2/SessionCostCard.tsx
  <-- src/components/v2/MonthlySavingsCard.tsx
  <-- src/components/v2/DailySavingsHeatmap.tsx
  <-- src/components/v2/YearlySavingsCard.tsx
  <-- src/components/v2/FleetConfigPanel.tsx
  <-- src/components/ui/{card, tooltip}
  <-- recharts

src/lib/optimizer.ts
  <-- src/lib/config.ts (PricePoint, ChargingBlock)
  <-- src/lib/grid-fees.ts

src/lib/use-prices.ts
  <-- src/lib/v2-config.ts (HourlyPrice, DailySummary, MonthlyStats, GenerationData)

src/lib/charging-helpers.ts
  <-- src/lib/v2-config.ts (HourlyPrice)

src/lib/fleet-optimizer.ts
  <-- src/lib/v2-config.ts (FleetConfig, FlexBandSlot, etc.)

src/app/api/prices/batch/route.ts
  <-- src/lib/smard.ts
  <-- src/lib/awattar.ts
  <-- src/lib/entsoe.ts
  <-- src/lib/energy-charts.ts
  <-- src/lib/energy-forecast.ts
  <-- src/lib/csv-prices.ts
  <-- src/lib/price-cache.ts
  <-- src/lib/supabase.ts

src/app/api/generation/route.ts
  <-- (no local lib imports; raw SMARD HTTP calls inline)

src/app/dynamic/page.tsx
  <-- src/lib/use-prices.ts
  <-- src/lib/dynamic-tariff.ts
  <-- src/lib/slp-h25.ts
  <-- src/components/v2/DateStrip.tsx (shared)
  <-- src/components/dynamic/DynamicDailySavings.tsx
  <-- src/components/dynamic/MonthlyPriceTrend.tsx
```

## File Size Summary

| Category | Files | Total Lines | Largest File |
|---|---|---|---|
| `src/components/v2/` | 16 | 8,068 | `Step2ChargingScenario.tsx` (3,608) |
| `src/lib/` | 22 | 5,360 | `excel-export.ts` (832) |
| `src/app/dynamic/` | 3 | 4,585 | `analysis/page.tsx` (1,822) |
| `src/app/api/` | 6 | 1,369 | `prices/batch/route.ts` (536) |
| `src/components/dynamic/` | 2 | 946 | `MonthlyPriceTrend.tsx` (557) |
| `src/app/` (pages) | 4 | 293 | `v2/page.tsx` (265) |

---

*Structure analysis: 2026-04-07*
