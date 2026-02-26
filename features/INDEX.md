# Feature Index

> Central tracking for all features in FlexMon Dashboard.

## Status Legend
- **Deployed** - Live in production
- **Archived** - Old v1 code, moved to `src/_archive/`

## Active Features (Deployed)

| ID | Feature | Status | Spec | Files |
|----|---------|--------|------|-------|
| PROJ-1 | SMARD Data Integration | Deployed | [spec](PROJ-1-smard-data-integration.md) | `lib/smard.ts`, `lib/use-prices.ts`, `api/prices/batch/` |
| PROJ-2 | Price Optimization Engine | Deployed | [spec](PROJ-2-price-optimization-algorithm.md) | `lib/optimizer.ts`, `lib/grid-fees.ts` |
| PROJ-6 | Password Protection | Deployed | [spec](PROJ-6-password-protection.md) | `app/login/`, `lib/auth.ts`, `middleware.ts` |
| PROJ-12 | Interactive Price Chart | Deployed | [spec](PROJ-12-v2-charging-scenario.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-17 | Customer Profile Configurator | Deployed | [spec](PROJ-17-customer-profile.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-18 | Mini Calendar (Date Picker) | Deployed | [spec](PROJ-18-mini-calendar.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-19 | Session Cost Breakdown | Deployed | [spec](PROJ-19-session-cost-breakdown.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-20 | Monthly Savings Chart | Deployed | [spec](PROJ-20-monthly-savings-chart.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-21 | Savings Sensitivity Heatmap | Deployed | [spec](PROJ-21-savings-heatmap.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-22 | Savings Potential Box | Deployed | [spec](PROJ-22-savings-potential-box.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-23 | URL State & Sharing | Deployed | [spec](PROJ-23-url-sharing.md) | `app/v2/page.tsx` |

## Archived Features (v1 — code in `src/_archive/`)

| ID | Feature | Spec |
|----|---------|------|
| PROJ-3 | Dashboard UI - Price Chart (v1) | [archived](_archive/PROJ-3-dashboard-price-chart.md) |
| PROJ-4 | Dashboard UI - Heatmap & KPIs (v1) | [archived](_archive/PROJ-4-dashboard-heatmap-kpis.md) |
| PROJ-5 | Scenario Configurator (v1) | [archived](_archive/PROJ-5-scenario-configurator.md) |
| PROJ-7 | Yearly Overview (v1) | [archived](_archive/PROJ-7-yearly-overview-highlights.md) |
| PROJ-8 | Volatility Analysis (v1) | [archived](_archive/PROJ-8-volatility-analysis.md) |
| PROJ-9 | Multi-Source Prices (v1) | [archived](_archive/PROJ-9-multi-source-prices.md) |
| PROJ-10 | Load Shifting Viz (v1) | [archived](_archive/PROJ-10-load-shifting-visualization.md) |
| PROJ-11 | Price Explorer (unbuilt) | [archived](_archive/PROJ-11-v2-price-explorer.md) |
| PROJ-13 | Value Waterfall (unbuilt) | [archived](_archive/PROJ-13-v2-value-waterfall.md) |
| PROJ-14 | Portfolio Scale (unbuilt) | [archived](_archive/PROJ-14-v2-portfolio-scale.md) |
| PROJ-15 | Market Context (unbuilt) | [archived](_archive/PROJ-15-v2-market-context.md) |

## Next Available ID: PROJ-24

## Architecture

```
src/
  app/
    page.tsx              → redirect to /v2
    v2/page.tsx           → main dashboard (state, optimization, layout)
    login/page.tsx        → password entry
    api/
      auth/               → JWT login
      prices/batch/       → SMARD incremental fetch
      generation/         → renewable generation data
  components/
    v2/
      steps/Step2ChargingScenario.tsx  → all visualizations (1800 lines)
      AnimatedNumber.tsx               → animated number transitions
    ui/                   → shadcn/ui primitives
  lib/
    use-prices.ts         → price data hook (static JSON + incremental API)
    v2-config.ts          → types, constants, defaults
    optimizer.ts          → baseline vs optimized charging algorithm
    grid-fees.ts          → §14a Module 3 grid fee schedule
    config.ts             → shared types (PricePoint, ChargingBlock)
    auth.ts               → JWT session management
    smard.ts              → SMARD API client
    awattar.ts            → aWATTar fallback
    energy-charts.ts      → Energy Charts fallback
    csv-prices.ts         → CSV file fallback
    price-cache.ts        → Supabase price cache
    supabase.ts           → Supabase client
    utils.ts              → clsx utility
```
