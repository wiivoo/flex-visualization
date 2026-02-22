# PROJ-7: Yearly Overview & Highlights

## Status: Planned
**Created:** 2025-02-21
**Last Updated:** 2025-02-21

## Dependencies
- Requires: PROJ-1 (SMARD Data Integration) - for historical data

## User Stories
- As a CEO, I want to see the annual trend at a glance
- As a product manager, I want to identify interesting days (highlights)
- As a decision maker, I want to see monthly aggregation

## Acceptance Criteria
- [ ] New page `/yearly` or tab in dashboard
- [ ] Monthly chart: Line or bar chart with average prices per month
- [ ] Highlight days: Top 5 days with highest volatility (largest price spread)
- [ ] Highlight days: Top 3 days with negative prices (if available)
- [ ] Click on highlight = switch to day view with that date
- [ ] Yearly KPIs: Average price, cheapest month, most expensive month
- [ ] Year selection: Dropdown for different years (2023, 2024, 2025)

## UI Spec

**Layout:**
```
┌─────────────────────────────────────────────────────────────┐
│  Jahresübersicht                                   [2024 ▼]│
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  KPIs                                                         │
│  ┌───────────┬───────────┬───────────┬───────────┐          │
│  │⌀ Ø-Preis  │📉 Min     │📈 Max     │💰 Volatil  │          │
│  │  82 ct    │  45 ct    │ 320 ct    │  275 ct   │          │
│  └───────────┴───────────┴───────────┴───────────┘          │
│                                                               │
│  Monatsverlauf (Preis)                                        │
│  350┤      █                                                  │
│  300┤      █      █                                          │
│  250┤      █      █  █                                       │
│  200┤  █   █      █  █  █                                    │
│  150┤  █   █  █   █  █  █  █                                 │
│  100┤  █   █  █   █  █  █  █  █                              │
│   50┤  █   █  █   █  █  █  █  █  █   █                       │
│    0┼──█───█──█───█──█──█──█──█──█───█───                    │
│      Jan Feb Mär Apr Mai Jun Jul Aug Sep Okt Nov Dez          │
│                                                               │
│  Highlights (Top Volatile Days)                               │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 📅 15. Okt 2024  │  Spanne: 450 ct  │  [Ansehen →] │     │
│  │ 📅 08. Feb 2024  │  Spanne: 380 ct  │  [Ansehen →] │     │
│  │ 📅 22. Nov 2024  │  Spanne: 320 ct  │  [Ansehen →] │     │
│  └─────────────────────────────────────────────────────┘     │
└─────────────────────────────────────────────────────────────┘
```

## Data Requirements
- **Aggregation:** Daily prices → monthly average
- **Volatility:** `max(price) - min(price)` per day
- **Highlights:** Sorted by volatility (top 5)
- **Negative Prices:** Extractor for days with `min(price) < 0`

## Edge Cases
- **What if no year selected?** → Current year as default
- **What if data missing for months?** → Gap in chart with tooltip "Keine Daten"
- **What if no day with negative prices?** → Don't show that category
- **What if very flat annual trend?** → Y-axis auto-scale with padding
- **What if year is in the future?** → "Prognose" label, only available data

## Technical Requirements
- **Data Fetch:** All data for a year at once (or lazy loading)
- **Performance:** Monthly chart < 500ms, highlights < 200ms
- **State Management:** Selected year in URL query param `?year=2024`
- **Linking:** Highlight click navigates to `/?date=2024-10-15`

## Visual Design
- **Monthly Chart:** Bar chart or line chart
- **Highlights:** Card layout with icon, date, metric, button
- **Colors:** Same palette as day view (consistency)

---
<!-- Sections below are added by subsequent skills -->

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
