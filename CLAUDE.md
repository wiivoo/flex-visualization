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
