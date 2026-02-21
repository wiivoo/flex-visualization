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
| PROJ-1 | SMARD Datenintegration | In Review | [smard-data-integration](PROJ-1-smard-data-integration.md) | 2025-02-21 |
| PROJ-2 | Preis-Optimierungsalgorithmus | In Review | [price-optimization-algorithm](PROJ-2-price-optimization-algorithm.md) | 2025-02-21 |
| PROJ-3 | Dashboard UI - Preis-Chart | In Review | [dashboard-price-chart](PROJ-3-dashboard-price-chart.md) | 2025-02-21 |
| PROJ-4 | Dashboard UI - Heatmap & KPIs | Planned | [dashboard-heatmap-kpis](PROJ-4-dashboard-heatmap-kpis.md) | 2025-02-21 |
| PROJ-5 | Szenario-Konfigurator | In Review | [scenario-configurator](PROJ-5-scenario-configurator.md) | 2025-02-21 |
| PROJ-6 | Passwortschutz | In Review | [password-protection](PROJ-6-password-protection.md) | 2025-02-21 |
| PROJ-7 | Jahresansicht & Highlights | Planned | [yearly-overview-highlights](PROJ-7-yearly-overview-highlights.md) | 2025-02-21 |

<!-- Add features above this line -->

## Next Available ID: PROJ-8

## Recommended Build Order

1. **PROJ-6** (Passwortschutz) - Erstes Feature, keine Dependencies
2. **PROJ-1** (SMARD Datenintegration) - Grundlage für alles
3. **PROJ-2** (Preis-Optimierungsalgorithmus) - Benötigt PROJ-1
4. **PROJ-5** (Szenario-Konfigurator) - Parallel zu UI Features
5. **PROJ-3** (Dashboard UI - Preis-Chart) - Benötigt PROJ-1, PROJ-2
6. **PROJ-4** (Dashboard UI - Heatmap & KPIs) - Benötigt PROJ-1, PROJ-2
7. **PROJ-7** (Jahresansicht) - Benötigt PROJ-1, nice-to-have

## MVP Scope (Week 1)
- PROJ-6, PROJ-1, PROJ-2, PROJ-3, PROJ-5 = Kernfunktionalität ✅ Frontend Complete
- PROJ-4, PROJ-7 = P1 (can follow week 2)

## Backend Implementation Complete
- ✅ PROJ-1: SMARD API client, CSV parser, Supabase cache, full fallback chain
- ✅ PROJ-6: Login page with password protection
- ✅ PROJ-3: Dashboard with price chart (Recharts)
- ✅ PROJ-5: Configuration panel (vehicle, prices, charging)
- ✅ PROJ-2: Optimization API

## Next Step: QA Testing
Run `/qa` to test all features against acceptance criteria.
