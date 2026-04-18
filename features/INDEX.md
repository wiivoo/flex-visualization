# Feature Index

> Central tracking for all features in Flex Visualization Dashboard.

## Status Legend
- **Deployed** - Live in production
- **In Progress** - Under active development
- **Archived** - Old v1 code, moved to `src/_archive/`

## Active Features (Deployed)

| ID | Feature | Status | Spec | Files |
|----|---------|--------|------|-------|
| PROJ-1 | SMARD Data Integration | Deployed | [spec](PROJ-1-smard-data-integration.md) | `lib/smard.ts`, `lib/use-prices.ts`, `api/prices/batch/` |
| PROJ-2 | Price Optimization Engine | Deployed | [spec](PROJ-2-price-optimization-algorithm.md) | `lib/optimizer.ts`, `lib/grid-fees.ts` |
| PROJ-6 | Password Protection | Deployed | [spec](PROJ-6-password-protection.md) | `app/login/`, `lib/auth.ts`, `middleware.ts` |
| PROJ-12 | Interactive Price Chart | Deployed | [spec](PROJ-12-v2-charging-scenario.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-17 | Customer Profile Configurator | Deployed | [spec](PROJ-17-customer-profile.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-18 | Mini Calendar (Date Picker) | Deployed | [spec](PROJ-18-mini-calendar.md) | `components/v2/MiniCalendar.tsx` |
| PROJ-19 | Session Cost Breakdown | Deployed | [spec](PROJ-19-session-cost-breakdown.md) | `components/v2/SessionCostCard.tsx` |
| PROJ-20 | Monthly Savings Chart | Deployed | [spec](PROJ-20-monthly-savings-chart.md) | `components/v2/MonthlySavingsCard.tsx` |
| PROJ-21 | Savings Sensitivity Heatmap | Deployed | [spec](PROJ-21-savings-heatmap.md) | `components/v2/SavingsHeatmap.tsx` |
| PROJ-22 | Savings Potential Box | Deployed | [spec](PROJ-22-savings-potential-box.md) | `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-23 | URL State & Sharing | Deployed | [spec](PROJ-23-url-sharing.md) | `app/v2/page.tsx` |
| PROJ-24 | Weekday/Weekend Charging Split | Deployed | [spec](PROJ-24-weekday-weekend-split.md) | `lib/v2-config.ts`, `lib/charging-helpers.ts` |
| PROJ-25 | Fleet Portfolio View | Deployed | [spec](PROJ-25-fleet-portfolio.md) | `components/v2/FleetPortfolioCard.tsx` |
| PROJ-27 | Spread Indicators & Scenario Cards | Deployed | [spec](PROJ-27-spread-indicators.md) | `components/v2/steps/Step2ChargingScenario.tsx`, `lib/charging-helpers.ts` |
| PROJ-28 | Two-Column Layout & UX Refresh | Deployed | — | `components/v2/steps/Step2ChargingScenario.tsx`, `components/v2/DateStrip.tsx` |
| PROJ-29 | V2G Dual Value Streams | In Progress | [spec](PROJ-29-v2g-dual-value-streams.md) | `lib/charging-helpers.ts`, `components/v2/SessionCostCard.tsx`, `components/v2/MonthlySavingsCard.tsx` |
| PROJ-30 | NL Country Support | Deployed | [spec](PROJ-30-nl-country-support.md) | `lib/use-prices.ts`, `api/prices/batch/`, `scripts/download-nl.mjs`, `scripts/update-nl.mjs` |
| PROJ-31 | EnergyForecast.de Integration | Deployed | [spec](PROJ-31-energy-forecast.md) | `lib/energy-forecast.ts`, `api/prices/batch/`, `lib/use-prices.ts` |
| PROJ-32 | Daily Savings Heatmap | Deployed | [spec](PROJ-32-daily-savings-heatmap.md) | `components/v2/DailySavingsHeatmap.tsx` |
| PROJ-33 | Intraday ID3 Price Overlay | Deployed | [spec](PROJ-33-intraday-id3.md) | `lib/use-prices.ts`, `api/prices/batch/` |
| PROJ-34 | Excel Session Export | Deployed | [spec](PROJ-34-excel-export.md) | `lib/excel-export.ts`, `app/v2/page.tsx` |
| PROJ-35 | Fleet Designer | In Review | [spec](PROJ-35-fleet-designer.md) | `lib/v2-config.ts`, `components/v2/FleetConfigPanel.tsx`, `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-36 | Flex Band Overlay | In Review | [spec](PROJ-36-flex-band-overlay.md) | `lib/fleet-optimizer.ts`, `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-37 | Fleet Optimized Schedule | In Review | [spec](PROJ-37-fleet-optimized-schedule.md) | `lib/fleet-optimizer.ts`, `components/v2/FleetConfigPanel.tsx`, `components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-39 | Plug-in Battery Business Case (DE/NL) | In Progress | [spec](PROJ-39-plug-in-battery-business-case.md) | `app/battery/`, `components/battery/`, `lib/battery-*.ts` |
| PROJ-40 | Management Dashboard | Planned | [spec](PROJ-40-management-dashboard.md) | `app/management/`, `components/management/`, `lib/management-*.ts`, `public/data/management-monthly.json` |

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

## Next Available ID: PROJ-41

## Architecture

```
src/
  app/
    page.tsx              → redirect to /v2
    v2/page.tsx           → main dashboard (state, optimization, layout, URL sharing, export)
    login/page.tsx        → password entry
    api/
      auth/               → JWT login
      prices/batch/       → multi-source price fetch (SMARD, aWATTar, ENTSO-E, EnergyForecast)
      generation/         → renewable generation data (SMARD)
  components/
    v2/
      steps/Step2ChargingScenario.tsx  → core visualization (~1800 lines)
                                         chart, sidebar, scenario cards, detail panel
      AnimatedNumber.tsx               → animated number transitions
      DailySavingsHeatmap.tsx          → calendar-style daily savings heatmap
      DateStrip.tsx                    → horizontal date strip with week labels
      FleetPortfolioCard.tsx           → fleet portfolio analysis card
      FlexibilityDemoChart.tsx         → flexibility demonstration chart
      MiniCalendar.tsx                 → date picker with spread colors & weekend styling
      MonthlySavingsCard.tsx           → monthly savings bar chart (mode-aware, V2G-aware)
      SavingsHeatmap.tsx               → mileage x frequency sensitivity matrix
      SessionCostCard.tsx              → baseline vs. optimized cost card
      SpreadIndicatorsCard.tsx         → standalone spread indicators card
      TutorialOverlay.tsx              → guided tutorial overlay
      YearlySavingsCard.tsx            → yearly savings with YoY comparison (mode-aware)
    ui/                   → shadcn/ui primitives (alert, button, card, input, label, tooltip)
  lib/
    use-prices.ts         → price data hook (static JSON + incremental API, hourly + QH, DE + NL)
    v2-config.ts          → types, constants, defaults (ChargingScenario, weekday/weekend split)
    charging-helpers.ts   → window builders, savings computation, spread, V2G optimizer
    optimizer.ts          → baseline vs optimized charging algorithm
    grid-fees.ts          → §14a Module 3 grid fee schedule (10 DSOs)
    excel-export.ts       → multi-sheet Excel export (SheetJS)
    energy-forecast.ts    → EnergyForecast.de API client (DE + NL)
    config.ts             → shared types (PricePoint, ChargingBlock)
    auth.ts               → JWT session management
    smard.ts              → SMARD API client
    awattar.ts            → aWATTar fallback
    energy-charts.ts      → Energy Charts fallback
    csv-prices.ts         → CSV file fallback
    price-cache.ts        → Supabase price cache
    supabase.ts           → Supabase client
    utils.ts              → clsx utility
scripts/
    download-smard.mjs    → full DE price download (SMARD)
    update-smard.mjs      → incremental DE price update
    download-nl.mjs       → full NL price download (ENTSO-E)
    update-nl.mjs         → incremental NL price update
public/data/
    smard-prices.json     → DE hourly prices (static)
    smard-prices-qh.json  → DE quarter-hourly prices (static)
    smard-generation.json → DE renewable generation (static)
    nl-prices.json        → NL hourly prices (static)
    nl-prices-qh.json     → NL quarter-hourly prices (static)
```

## Environment Variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `DASHBOARD_PASSWORD` | Yes | Login password |
| `AUTH_SECRET` / `DASHBOARD_SESSION_SECRET` | Yes | JWT signing key |
| `NEXT_PUBLIC_SUPABASE_URL` | Yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes | Supabase anon key |
| `ENTSOE_API_TOKEN` | For NL | ENTSO-E Transparency Platform token |
| `ENERGY_FORECAST_TOKEN` | For forecast | EnergyForecast.de API token |

## Data Update Schedule

| Source | Schedule | Trigger |
|--------|----------|---------|
| DE prices (SMARD) | Daily 13:30 UTC | GitHub Actions + manual |
| NL prices (ENTSO-E) | Daily 13:30 UTC | GitHub Actions + manual |
| DE generation (SMARD) | Daily 13:30 UTC | GitHub Actions + manual |
| Forecast (EnergyForecast.de) | On request | Batch API route (not cached) |
