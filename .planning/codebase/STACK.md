# Technology Stack

**Analysis Date:** 2026-04-07

## Languages

**Primary:**
- TypeScript ^5 — All source code (`src/`, API routes, config files)
- Target: ES2017, strict mode enabled

**Secondary:**
- JavaScript (ESM) — Build/data scripts in `scripts/*.mjs`

## Runtime

**Environment:**
- Node.js 20 (target in GitHub Actions, implied by `@types/node: ^20`)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present

## Frameworks

**Core:**
- Next.js ^16.1.1 (App Router) — Full-stack framework, SSR + API routes
- React ^19.0.0 + React DOM ^19.0.0 — UI rendering

**Testing:**
- Vitest ^4.1.2 — Unit test runner, config at `vitest.config.ts`
- Playwright ^1.58.2 — Browser automation (used for EPEX scraping, NOT E2E tests)

**Build/Dev:**
- TypeScript ^5 — Type checking
- ESLint ^9 + eslint-config-next 16.1.1 — Linting (`npm run lint`)
- PostCSS ^8 + Autoprefixer ^10.0.1 — CSS processing

## UI Layer

**Styling:**
- Tailwind CSS ^3.4.1 — Utility-first CSS, `class` dark mode strategy
- tailwind-merge ^2.2.0 — Class deduplication (used in `cn()` at `src/lib/utils.ts`)
- clsx ^2.1.0 — Conditional class composition
- class-variance-authority ^0.7.1 — Variant-based component styling (shadcn/ui)

**Component Library:**
- shadcn/ui (Radix UI primitives) — Located in `src/components/ui/`
- Radix packages installed:

| Package | Version |
|---------|---------|
| `@radix-ui/react-accordion` | ^1.2.12 |
| `@radix-ui/react-alert-dialog` | ^1.1.15 |
| `@radix-ui/react-avatar` | ^1.1.11 |
| `@radix-ui/react-checkbox` | ^1.3.3 |
| `@radix-ui/react-collapsible` | ^1.1.12 |
| `@radix-ui/react-dialog` | ^1.1.15 |
| `@radix-ui/react-dropdown-menu` | ^2.1.16 |
| `@radix-ui/react-label` | ^2.1.8 |
| `@radix-ui/react-navigation-menu` | ^1.2.14 |
| `@radix-ui/react-popover` | ^1.1.15 |
| `@radix-ui/react-progress` | ^1.1.8 |
| `@radix-ui/react-radio-group` | ^1.3.8 |
| `@radix-ui/react-scroll-area` | ^1.2.10 |
| `@radix-ui/react-select` | ^2.2.6 |
| `@radix-ui/react-separator` | ^1.1.8 |
| `@radix-ui/react-slot` | ^1.2.4 |
| `@radix-ui/react-switch` | ^1.2.6 |
| `@radix-ui/react-tabs` | ^1.1.13 |
| `@radix-ui/react-toast` | ^1.2.15 |
| `@radix-ui/react-tooltip` | ^1.2.8 |

**Icons:**
- lucide-react ^0.562.0

**Themes:**
- next-themes ^0.4.6 — Light/dark mode switching

**Toasts:**
- sonner ^2.0.7 — Toast notifications

**Date Picker:**
- react-day-picker ^9.13.2

**Command Palette:**
- cmdk ^1.1.1

## Charts

- Recharts ^3.7.0 — ComposedChart, Line, Area, Bar, ReferenceArea
- Used in `src/components/v2/steps/Step2*.tsx`, `src/components/v2/MonthlySavingsCard.tsx`, `src/components/v2/SavingsHeatmap.tsx`

## Authentication

- jose ^6.1.3 — JWT signing/verification (HS256)
- Implementation: `src/lib/auth.ts`
- Session cookie: `flexmon-session`, 24h duration
- Single shared password, no user accounts
- Middleware at `src/middleware.ts` — passthrough (matcher: `[]`), auth enforced at API level

## Database / Cache

- Supabase (`@supabase/supabase-js` ^2.39.3) — Used as caching layer only
- Client: `src/lib/supabase.ts`
- Cache logic: `src/lib/price-cache.ts`
- Table: `price_cache` with key `(date, type)`, upsert on conflict
- Smart TTL: past dates = never expire, today = 2h, future = 1h
- No primary data storage — all data from external APIs + static JSON

## Key Dependencies

**Critical:**

| Package | Version | Purpose |
|---------|---------|---------|
| `recharts` | ^3.7.0 | All chart visualizations |
| `@supabase/supabase-js` | ^2.39.3 | Price caching layer |
| `jose` | ^6.1.3 | JWT auth |
| `date-fns` | ^4.1.0 | Date manipulation throughout |
| `zod` | ^4.3.5 | API input validation |

**Data Export:**

| Package | Version | Purpose |
|---------|---------|---------|
| `exceljs` | ^4.4.0 | Excel export with formulas |
| `xlsx` | ^0.18.5 | Additional spreadsheet support |

**Forms:**

| Package | Version | Purpose |
|---------|---------|---------|
| `react-hook-form` | ^7.71.1 | Form state management |
| `@hookform/resolvers` | ^5.2.2 | Zod integration for forms |

**Utilities:**

| Package | Version | Purpose |
|---------|---------|---------|
| `js-cookie` | ^3.0.5 | Client-side cookie access |
| `playwright` | ^1.58.2 | EPEX intraday scraping (not testing) |

## TypeScript Configuration

- Config: `tsconfig.json`
- Target: ES2017
- Module: ESNext, resolution: bundler
- Strict: true
- Path alias: `@/*` maps to `./src/*`
- Excluded: `src/_archive` (dead code archive)
- JSX: react-jsx
- Incremental compilation enabled

## Build Configuration

- `next.config.ts` — Security headers only (X-Frame-Options, HSTS, X-Content-Type-Options, Referrer-Policy, X-XSS-Protection, X-DNS-Prefetch-Control)
- No custom webpack config
- No custom Babel config
- PostCSS: Tailwind + Autoprefixer

## Static Data Files

Located in `public/data/`:

| File | Content |
|------|---------|
| `smard-prices.json` | DE hourly day-ahead prices (historical) |
| `smard-prices-qh.json` | DE quarter-hourly prices |
| `smard-generation.json` | Solar, wind, load generation data |
| `smard-meta.json` | SMARD metadata (date ranges, last update) |
| `nl-prices.json` | NL hourly prices (ENTSO-E) |
| `nl-prices-qh.json` | NL quarter-hourly prices |
| `projected-prices.json` | Forward-looking price projections |
| `e1a-profile-2025.json` | E1A load profile data |
| `e1a-profile-relative.json` | Relative E1A profile |
| `epex-css.json` | EPEX CSS styling data |

## NPM Scripts

```bash
npm run dev              # next dev (localhost:3000)
npm run build            # next build (production)
npm run start            # next start
npm run lint             # next lint (ESLint)
npm run download-data    # node scripts/download-smard.mjs
```

## Platform Requirements

**Development:**
- Node.js 20+
- npm
- `.env.local` with required environment variables

**Production:**
- Vercel (hobby/free tier)
- Production URL: `web.lhdus.dpdns.org` (port 8080)

## Environment Variables

**Required (server-side):**
- `DASHBOARD_PASSWORD` — Single login password
- `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` — JWT signing key
- `ENTSOE_API_TOKEN` — ENTSO-E Transparency Platform access
- `ENERGY_FORECAST_TOKEN` — EnergyForecast.de API access

**Required (client-side, NEXT_PUBLIC_ prefix):**
- `NEXT_PUBLIC_SUPABASE_URL` — Supabase project URL
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` — Supabase anonymous key

**Reference:**
- `.env.local.example` exists with dummy values

---

*Stack analysis: 2026-04-07*
