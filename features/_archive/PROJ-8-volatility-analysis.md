# PROJ-8: Volatility Analysis & Spread Dashboard

## Status: In Review
**Created:** 2026-02-22
**Last Updated:** 2026-02-22

## Dependencies
- Requires: PROJ-1 (SMARD Data Integration) - for price data

## User Stories
- As a CEO, I want to see at a glance how large the daily arbitrage potential is
- As an analyst, I want to identify days with high volatility for customer presentations
- As a decision maker, I want to understand how often flexible charging actually pays off

## Acceptance Criteria
- [x] Volatility analysis section visible in dashboard (for multi-day data)
- [x] KPIs: Avg. daily spread, max spread, arbitrage days, analyzed days
- [x] Spread bandwidth chart: Min-max band per day with average line
- [x] Spread barometer: Daily spreads as color-coded bars
- [x] Color coding: Green (>20ct), Yellow (10-20ct), Gray (<10ct)
- [x] German labels and locale
- [x] Tooltips with details (date, min, max, spread, rating)
- [x] Legend explains color scale

## Technical Requirements
- **Performance:** Chart render < 200ms (useMemo for aggregation)
- **Data:** Uses existing PricePoint[] data, no additional API calls
- **Responsive:** Charts with ResponsiveContainer

## Files
- `src/components/dashboard/VolatilityAnalysis.tsx` - Main component
- `src/app/page.tsx` - Integration (import + rendering)
