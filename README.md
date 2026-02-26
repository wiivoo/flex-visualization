# B2C Flex Monetization Dashboard

Interactive visualization showing how EV charging load shifting creates value in the German day-ahead electricity market. Built for management presentations — real SMARD market data, no simulations.

**Live:** [web.lhdus.dpdns.org:8080](http://web.lhdus.dpdns.org:8080)

## What It Does

A single-page dashboard where users configure a charging scenario (mileage, plug-in frequency, plug-in/departure times) and see — with real hourly and 15-minute prices — how much money optimized charging saves vs. immediate ("dumb") charging.

Key visualizations:
- **Interactive price chart** with draggable plug-in/departure handles
- **Overnight & Full Day** charging modes
- **Hourly and 15-min** price resolution toggle
- **Session cost breakdown** (baseline vs. optimized, hour-by-hour)
- **Monthly savings** bar chart with seasonal coloring and cumulative line
- **Savings heatmap** (mileage x plug-in frequency matrix)
- **Mini calendar** with daily price spread indicators
- **URL sharing** — scenario state encoded in the URL

## Tech Stack

| | |
|--|--|
| Framework | Next.js 16 (App Router), TypeScript |
| Charts | Recharts |
| Styling | Tailwind CSS + shadcn/ui |
| Prices | SMARD API (day-ahead DE/LU) + static JSON + incremental API |
| Auth | JWT (jose), password protection via middleware |
| Deploy | Vercel |

## Project Structure

```
src/
  app/
    page.tsx                    Redirects to /v2
    v2/page.tsx                 Main dashboard (scenario <> URL sync)
    login/page.tsx              Password entry
    api/auth/route.ts           JWT login
    api/prices/batch/route.ts   SMARD incremental price fetch
    api/generation/route.ts     Renewable generation data
  components/
    ui/                         shadcn/ui (alert, button, card, input, label, tooltip)
    v2/
      steps/Step2ChargingScenario.tsx   Core visualization (~1270 lines)
      MiniCalendar.tsx                  Month-view date picker
      SessionCostCard.tsx               Hour-by-hour cost comparison
      MonthlySavingsCard.tsx            12-month savings chart
      SavingsHeatmap.tsx                Mileage x frequency matrix
      AnimatedNumber.tsx                Animated KPI transitions
  lib/
    v2-config.ts                Types, constants, scenario defaults
    use-prices.ts               Price data hook (static JSON + API)
    optimizer.ts                Baseline vs. optimized scheduling
    charging-helpers.ts         Shared helpers (window computation)
    grid-fees.ts                Module 3 grid fees (10 DSOs)
    smard.ts                    SMARD API client
    auth.ts                     JWT session management
    config.ts                   Shared types
    supabase.ts                 Supabase client
    awattar.ts                  aWATTar fallback
    energy-charts.ts            Energy-Charts fallback
    csv-prices.ts               CSV fallback parser
    price-cache.ts              Supabase price cache layer
  middleware.ts                 Auth middleware
public/data/
  smard-prices.json             Pre-loaded hourly prices
  smard-prices-qh.json          Pre-loaded 15-min prices
  smard-generation.json         Renewable generation data
scripts/
  download-smard.mjs            SMARD bulk download script
features/                       Feature specifications (PROJ-12, 17-23)
docs/v2/                        Product requirements & design docs
```

## Quick Start

```bash
npm install
cp .env.local.example .env.local   # Set DASHBOARD_PASSWORD and AUTH_SECRET
npm run dev                        # localhost:3000
```

## Build

```bash
npm run build      # Production build
npm run start      # Production server
npm run lint       # ESLint
```

## Data Flow

1. Static JSON files provide ~3 years of pre-loaded SMARD prices
2. On page load, `usePrices()` checks for newer data via `/api/prices/batch`
3. User adjusts scenario, URL updates, chart re-renders with `useDeferredValue`
4. `runOptimization()` computes baseline vs. cheapest-slot scheduling client-side
5. Results feed into SessionCostCard, MonthlySavingsCard, SavingsHeatmap

## License

MIT
