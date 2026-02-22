# B2C Flex Monetization

> EV charging flexibility monetization dashboard for the German electricity market.

B2C Flex Monetization visualizes how intelligent EV charge scheduling creates value in the German day-ahead electricity market. It shows management — at a glance — how much money load shifting saves compared to "dumb" immediate charging.

## Live Demo

- **Production:** [web.lhdus.dpdns.org:8080](http://web.lhdus.dpdns.org:8080)
- **Local:** `npm run dev` → [localhost:3000](http://localhost:3000)

## Features

| Feature | Description |
|---------|-------------|
| **Multi-Source Prices** | Real-time day-ahead prices from aWATTar, SMARD, and Energy-Charts with automatic fallback |
| **Load Shifting** | Side-by-side comparison of baseline (immediate) vs. optimized charging costs |
| **Scenario Comparison** | Flat tariff vs. DA-indexed vs. optimized vs. §14a Module 3 grid fees |
| **Volatility Analysis** | Daily spread analysis to identify arbitrage opportunities |
| **Price Heatmap** | Savings potential by vehicle type and hour of day |
| **Yearly Overview** | Monthly averages, most volatile days, negative price days |
| **Batch Optimization** | Multi-day optimization with cumulative savings tracking |
| **10 DSO Profiles** | §14a EnWG Module 3 time-variable grid fees for 10 German grid operators |

## Tech Stack

| Category | Tool |
|----------|------|
| Framework | Next.js 16 (App Router) |
| Language | TypeScript |
| Styling | Tailwind CSS + shadcn/ui |
| Charts | Recharts |
| Backend | Supabase (optional cache) |
| Auth | JWT (jose) with password protection |
| Deployment | Vercel |

## Quick Start

```bash
git clone https://github.com/wiivoo/my-first-app.git
cd my-first-app
npm install
npm run dev
```

Set `DASHBOARD_PASSWORD` in `.env.local` for authentication.

## Data Sources

| Source | API | Fallback Priority |
|--------|-----|-------------------|
| aWATTar | `api.awattar.de/v1/marketdata` | 1st |
| SMARD | `smard.de/app/chart_data` | 2nd |
| Energy-Charts | `api.energy-charts.info/price` | 3rd |
| CSV Files | Local `CSVs/` directory | 4th |
| Demo Data | Generated | 5th (last resort) |

All prices in EUR/MWh, converted to ct/kWh (÷ 10).

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/prices` | GET | Day-ahead prices for a single day |
| `/api/prices/batch` | GET | Price range query (multi-day) |
| `/api/optimize` | POST | Single-day charging optimization |
| `/api/optimize/batch` | POST | Multi-day batch optimization |
| `/api/auth` | POST/DELETE | Login / Logout |

## Project Structure

```
src/
  app/                    Pages + API routes
  components/
    ui/                   shadcn/ui primitives
    charts/               PriceChart, TimeRangeSelector
    config/               QuickConfigPanel, VehicleSelector
    dashboard/            KPIs, Heatmap, LoadShifting, Volatility
  lib/                    Core logic
    smard.ts              SMARD API client
    awattar.ts            aWATTar API client
    energy-charts.ts      Energy-Charts API client
    optimizer.ts          Charging optimization algorithm
    grid-fees.ts          §14a Module 3 DSO profiles
    config.ts             Types, vehicle profiles, defaults
features/                 Feature specifications (PROJ-1 to PROJ-10)
```

## Build Commands

```bash
npm run dev        # Development server
npm run build      # Production build
npm run start      # Production server
npm run lint       # ESLint
```

## License

MIT
