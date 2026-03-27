# PROJ-33: Intraday ID3 Price Overlay

**Status:** Deployed
**Priority:** Medium

## Summary

Overlays intraday continuous (ID3) prices from EPEX Spot on the day-ahead chart, showing the price difference between the day-ahead auction and actual intraday trading.

## Data Source
- EPEX Spot intraday continuous (ID3) prices scraped and stored in Supabase
- Fetched via `/api/prices/batch?type=intraday&index=id3`
- Only available for DE market (not NL)

## Chart Integration
- ID3 prices shown as a secondary line on the main price chart
- Optimized ID3 slots highlighted to show potential intraday arbitrage
- Toggle to show/hide intraday overlay

## Key Files
- `src/lib/use-prices.ts` — `intradayId3` state, fetched separately
- `src/app/api/prices/batch/route.ts` — intraday type handling
- `src/components/v2/steps/Step2ChargingScenario.tsx` — chart overlay rendering
