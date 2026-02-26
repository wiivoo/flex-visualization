# Product Requirements Document - FlexMon Dashboard

## Vision
FlexMon Dashboard is a visualization tool for top management that demonstrates how EV charging control (flexibility) can be monetized in the German electricity market. The dashboard uses real market prices to show how customers save through flexible charging times while simultaneously generating arbitrage profits - a win-win scenario for both sides.

## Target Users
- **Primary:** CEO/CFO Level (non-technical)
  - Need: Visual, easy-to-understand presentation of the business case
  - Pain Point: Complex energy trading concepts are hard to grasp
- **Secondary:** Product Manager, Sales Teams
  - Need: Numbers and materials for customer presentations

## Core Features (Roadmap)

| Priority | Feature | Status |
|----------|---------|--------|
| P0 (MVP) | SMARD Data Integration | Deployed |
| P0 (MVP) | Price Optimization Algorithm | Deployed |
| P0 (MVP) | Dashboard Visualizations | Deployed |
| P0 (MVP) | Scenario Configurator | Deployed |
| P0 (MVP) | Password Protection | Deployed |
| P1 | Export (PDF/Excel) | Planned |
| P1 | Historical Data Archives | Planned |
| P2 | Multi-Portfolio Comparison | Planned |

## Success Metrics
- Management understands the flexibility concept within 5 minutes
- Dashboard can be used for customer presentations
- Numbers are based on real market data (not fabricated)

## Constraints
- **Timeline:** MVP in < 1 week
- **Complexity:** Simple enough for non-technical decision-makers
- **Data:** Real German electricity market prices (SMARD.de)
- **Language:** German (UI)

## Non-Goals
- No user auth with individual accounts (password protection only)
- No live price forecasts (historical + current data suffice)
- No integration with real charging infrastructure (simulation only)
- No automatic trades/orders (visualization only)
