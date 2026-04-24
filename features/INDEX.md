# Feature Index

> Status registry for active and archived feature specs in `features/`.

## Status Legend
- **Deployed** - Live in the current app/runtime.
- **In Progress** - Work has landed or is being implemented, but is not signed off as shipped.
- **In Review** - Implemented locally and under validation.
- **Planned** - Specified, but not available in the current runtime yet.
- **Dormant** - Partial or historical implementation remains in the repo, but the feature is not active in the current runtime.
- **Archived** - Retired v1 or unbuilt work tracked under `features/_archive/`.

## Active Feature Inventory

| ID | Feature | Status | Spec | Key Files |
|----|---------|--------|------|-----------|
| PROJ-1 | SMARD Data Integration | Deployed | [spec](PROJ-1-smard-data-integration.md) | `src/lib/smard.ts`, `src/lib/use-prices.ts`, `src/app/api/prices/batch/` |
| PROJ-2 | Price Optimization Engine | Deployed | [spec](PROJ-2-price-optimization-algorithm.md) | `src/lib/optimizer.ts`, `src/lib/grid-fees.ts` |
| PROJ-6 | Password Protection | Dormant | [spec](PROJ-6-password-protection.md) | `src/app/login/`, `src/app/api/auth/`, `src/lib/auth.ts` |
| PROJ-12 | Interactive Price Chart | Deployed | [spec](PROJ-12-v2-charging-scenario.md) | `src/components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-17 | Customer Profile Configurator | Deployed | [spec](PROJ-17-customer-profile.md) | `src/components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-18 | Mini Calendar (Date Picker) | Deployed | [spec](PROJ-18-mini-calendar.md) | `src/components/v2/MiniCalendar.tsx` |
| PROJ-19 | Session Cost Breakdown | Deployed | [spec](PROJ-19-session-cost-breakdown.md) | `src/components/v2/SessionCostCard.tsx` |
| PROJ-20 | Monthly Savings Chart | Deployed | [spec](PROJ-20-monthly-savings-chart.md) | `src/components/v2/MonthlySavingsCard.tsx` |
| PROJ-21 | Savings Sensitivity Heatmap | Deployed | [spec](PROJ-21-savings-heatmap.md) | `src/components/v2/SavingsHeatmap.tsx` |
| PROJ-22 | Savings Potential Box | Deployed | [spec](PROJ-22-savings-potential-box.md) | `src/components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-23 | URL State & Sharing | Deployed | [spec](PROJ-23-url-sharing.md) | `src/app/v2/page.tsx` |
| PROJ-24 | Weekday/Weekend Charging Split | Deployed | [spec](PROJ-24-weekday-weekend-split.md) | `src/lib/v2-config.ts`, `src/lib/charging-helpers.ts` |
| PROJ-25 | Fleet Portfolio View | Deployed | [spec](PROJ-25-fleet-portfolio.md) | `src/components/v2/FleetPortfolioCard.tsx` |
| PROJ-27 | Spread Indicators & Scenario Cards | Deployed | [spec](PROJ-27-spread-indicators.md) | `src/components/v2/steps/Step2ChargingScenario.tsx`, `src/lib/charging-helpers.ts` |
| PROJ-28 | Two-Column Layout & UX Refresh | Deployed | [spec](PROJ-28-two-column-layout-ux-refresh.md) | `src/components/v2/steps/Step2ChargingScenario.tsx`, `src/components/v2/DateStrip.tsx` |
| PROJ-29 | V2G Dual Value Streams | In Progress | [spec](PROJ-29-v2g-dual-value-streams.md) | `src/lib/charging-helpers.ts`, `src/components/v2/SessionCostCard.tsx`, `src/components/v2/MonthlySavingsCard.tsx` |
| PROJ-30 | NL Country Support | Deployed | [spec](PROJ-30-nl-country-support.md) | `src/lib/use-prices.ts`, `src/app/api/prices/batch/`, `scripts/download-nl.mjs`, `scripts/update-nl.mjs` |
| PROJ-31 | EnergyForecast.de Integration | Deployed | [spec](PROJ-31-energy-forecast.md) | `src/lib/energy-forecast.ts`, `src/app/api/prices/batch/`, `src/lib/use-prices.ts` |
| PROJ-32 | Daily Savings Heatmap | Deployed | [spec](PROJ-32-daily-savings-heatmap.md) | `src/components/v2/DailySavingsHeatmap.tsx` |
| PROJ-33 | Intraday ID3 Price Overlay | Deployed | [spec](PROJ-33-intraday-id3.md) | `src/lib/use-prices.ts`, `src/app/api/prices/batch/` |
| PROJ-34 | Excel Session Export | Deployed | [spec](PROJ-34-excel-export.md) | `src/lib/excel-export.ts`, `src/components/v2/ExportDialog.tsx` |
| PROJ-35 | Fleet Designer | In Review | [spec](PROJ-35-fleet-designer.md) | `src/lib/v2-config.ts`, `src/components/v2/FleetConfigPanel.tsx`, `src/components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-36 | Flex Band Overlay | In Review | [spec](PROJ-36-flex-band-overlay.md) | `src/lib/fleet-optimizer.ts`, `src/components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-37 | Fleet Optimized Schedule | In Review | [spec](PROJ-37-fleet-optimized-schedule.md) | `src/lib/fleet-optimizer.ts`, `src/components/v2/FleetConfigPanel.tsx`, `src/components/v2/steps/Step2ChargingScenario.tsx` |
| PROJ-39 | Plug-in Battery Business Case (DE/NL) | In Progress | [spec](PROJ-39-plug-in-battery-business-case.md) | `src/app/battery/`, `src/components/battery/`, `src/lib/battery-*.ts` |
| PROJ-40 | Management Dashboard | Planned | [spec](PROJ-40-management-dashboard.md) | `src/app/management/`, `src/components/management/`, `src/lib/management-*.ts`, `public/data/management-monthly.json` |
| PROJ-41 | AI Team Orchestration | Deployed | [spec](PROJ-41-ai-team-orchestration.md) | `CLAUDE.md`, `.claude/TEAM.md`, `.claude/agents/`, `.claude/rules/team-orchestration.md` |
| PROJ-42 | EV Flex Value Calculator | In Review | [spec](PROJ-42-ev-flex-value-calculator.md) | `src/app/v2/calculator/`, `src/components/v2/calculator/`, `src/lib/flex-calculator.ts` |
| PROJ-43 | PV + Battery Dynamic Tariff Calculator | In Progress | [spec](PROJ-43-pv-battery-dynamic-calculator.md) | `src/app/battery/calculator/`, `src/components/battery/calculator/`, `src/lib/pv-battery-calculator.ts` |

## Archived Features

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

## Notes

- `PROJ-28` was backfilled on 2026-04-21 to close the inventory gap for an already-deployed layout refresh.
- Next available ID: `PROJ-44`
