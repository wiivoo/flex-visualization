# PROJ-31: EnergyForecast.de Integration

## Status: Deployed
**Priority:** Medium

## Summary

Integrates EnergyForecast.de API to show price predictions for the next 48 hours beyond published EPEX Spot data. Supports both DE and NL market zones.

## How It Works

### Forecast Boundary
- The batch API route (Step 5) calls `fetchEnergyForecast('HOURLY', country)` for any request extending into the future
- EnergyForecast.de returns a mix of `price_origin: 'market'` (already published) and `price_origin: 'forecast'` (predicted)
- The boundary between market and forecast is returned as `forecastStart` in the API response
- Client-side, prices with `timestamp >= forecastStart` get `isProjected: true`

### Chart Rendering
- Forecast prices render with a dashed line style instead of solid
- The date strip shows forecast days as selectable but visually distinct

### Forecast → Real Data Replacement
- Forecast prices are never cached in Supabase (appended after cache write in Step 3)
- Cache TTL: past = infinite, today = 2 hours, future = 1 hour
- When ENTSO-E/SMARD publishes real data, it naturally replaces forecast on next fetch

### Market Zones
- DE → `DE-LU` market zone
- NL → `NL` market zone

### Rate Limiting
- 50 requests/day API limit
- Token stored in `ENERGY_FORECAST_TOKEN` env var

## Environment Variables
- `ENERGY_FORECAST_TOKEN` — required on both local (.env.local) and Vercel

## Key Files
- `src/lib/energy-forecast.ts` — API client, market zone mapping
- `src/app/api/prices/batch/route.ts` — Step 5 forecast integration
- `src/lib/use-prices.ts` — `isProjected` flag propagation
