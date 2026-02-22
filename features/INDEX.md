# Feature Index

> Central tracking for all features. Updated by skills automatically.

## Status Legend
- **Planned** - Requirements written, ready for development
- **Architecture** - Tech design complete, ready for frontend
- **In Progress** - Currently being built
- **In Review** - QA testing in progress
- **Deployed** - Live in production

## Features

| ID | Feature | Status | Spec | Created |
|----|---------|--------|------|---------|
| PROJ-1 | SMARD Data Integration | In Review | [smard-data-integration](PROJ-1-smard-data-integration.md) | 2025-02-21 |
| PROJ-2 | Price Optimization Algorithm | In Review | [price-optimization-algorithm](PROJ-2-price-optimization-algorithm.md) | 2025-02-21 |
| PROJ-3 | Dashboard UI - Price Chart | In Review | [dashboard-price-chart](PROJ-3-dashboard-price-chart.md) | 2025-02-21 |
| PROJ-4 | Dashboard UI - Heatmap & KPIs | In Review | [dashboard-heatmap-kpis](PROJ-4-dashboard-heatmap-kpis.md) | 2025-02-21 |
| PROJ-5 | Scenario Configurator | In Review | [scenario-configurator](PROJ-5-scenario-configurator.md) | 2025-02-21 |
| PROJ-6 | Password Protection | In Review | [password-protection](PROJ-6-password-protection.md) | 2025-02-21 |
| PROJ-7 | Yearly Overview & Highlights | In Review | [yearly-overview-highlights](PROJ-7-yearly-overview-highlights.md) | 2025-02-21 |
| PROJ-8 | Volatility Analysis & Spread | In Review | [volatility-analysis](PROJ-8-volatility-analysis.md) | 2026-02-22 |
| PROJ-9 | Multi-Source Electricity Prices | In Review | [multi-source-prices](PROJ-9-multi-source-prices.md) | 2026-02-22 |
| PROJ-10 | Baseline vs. Load Shifting | In Review | [load-shifting-visualization](PROJ-10-load-shifting-visualization.md) | 2026-02-22 |


<!-- Add features above this line -->

## Next Available ID: PROJ-11

## Recommended Build Order

1. **PROJ-6** (Password Protection) - First feature, no dependencies
2. **PROJ-1** (SMARD Data Integration) - Foundation for everything
3. **PROJ-2** (Price Optimization Algorithm) - Requires PROJ-1
4. **PROJ-5** (Scenario Configurator) - Parallel to UI features
5. **PROJ-3** (Dashboard UI - Price Chart) - Requires PROJ-1, PROJ-2
6. **PROJ-4** (Dashboard UI - Heatmap & KPIs) - Requires PROJ-1, PROJ-2
7. **PROJ-7** (Yearly Overview) - Requires PROJ-1, nice-to-have

## MVP Scope (Week 1)
- PROJ-6, PROJ-1, PROJ-2, PROJ-3, PROJ-5 = Core functionality ✅ Frontend Complete
- PROJ-4, PROJ-7 = P1 (can follow week 2)

## Backend Implementation Complete
- ✅ PROJ-1: SMARD API client, CSV parser, Supabase cache, full fallback chain
- ✅ PROJ-6: Login page with password protection
- ✅ PROJ-3: Dashboard with price chart (Recharts)
- ✅ PROJ-5: Configuration panel (vehicle, prices, charging)
- ✅ PROJ-2: Optimization API

## Next Step: QA Testing
Run `/qa` to test all features against acceptance criteria.
