# SMARD Data Strategy — Bulk Historical + Realtime

## API Overview

SMARD (Strommarktdaten) by Bundesnetzagentur provides German electricity market data.

- **Filter 4169** = Day-Ahead Market Price (EPEX Spot, DE-LU bidding zone)
- **Resolution:** Hourly (from Oct 2025: quarter-hourly available)
- **Format:** JSON, `[timestamp_ms, price_eur_mwh]` pairs

## Endpoints

### Index
```
GET https://www.smard.de/app/chart_data/4169/DE/index_hour.json
→ { "timestamps": [1538344800000, ...] }
```
Returns all available weekly chunk timestamps (~387 entries, from Sep 2018 to present).

### Weekly Data
```
GET https://www.smard.de/app/chart_data/4169/DE/4169_DE_hour_{TIMESTAMP}.json
→ { "meta_data": {...}, "series": [[ts, price], ...] }
```
Each file contains 168 entries (7 days × 24 hours).

### ⚠️ Bug in v1 Code
The existing `src/lib/smard.ts` has incorrect URL construction:
- **Wrong:** `/4169/4169_{TIMESTAMP}_hour.json`
- **Correct:** `/4169/DE/4169_DE_hour_{TIMESTAMP}.json`
Also: index returns `{ timestamps: [...] }` object, not a plain array.

## Bulk Download Strategy (3 Years)

### Scope
- 2023–2025: ~157 weekly JSON files
- ~26,376 hourly data points total
- Zero rate limits detected (20 concurrent workers = 0.91s total)

### Implementation
```typescript
// 1. Fetch index
const index = await fetch('.../index_hour.json').then(r => r.json())
const timestamps = index.timestamps.filter(t =>
  t >= Date.parse('2023-01-01') && t < Date.parse('2026-01-01')
)

// 2. Parallel fetch all weekly chunks (20 workers)
const results = await Promise.allSettled(
  timestamps.map(ts =>
    fetch(`.../4169_DE_hour_${ts}.json`).then(r => r.json())
  )
)

// 3. Flatten and deduplicate
const allPrices = results
  .filter(r => r.status === 'fulfilled')
  .flatMap(r => r.value.series)
  .filter(([ts, price]) => price !== null)
  .sort((a, b) => a[0] - b[0])
```

### Caching Strategy
1. **Initial bulk load:** API route fetches all 3 years, stores in Supabase
2. **Daily update:** Cron or on-demand fetch of current week's chunk
3. **Client cache:** Once loaded, price data cached in browser (IndexedDB or memory)
4. **Supabase schema:**
```sql
CREATE TABLE prices_hourly (
  timestamp_utc TIMESTAMPTZ PRIMARY KEY,
  price_eur_mwh NUMERIC(8,2) NOT NULL,
  source TEXT DEFAULT 'smard',
  fetched_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_prices_date ON prices_hourly (DATE(timestamp_utc));
```

## Data Quality Notes
- Some hours return `null` price (public holidays, missing data) — filter these
- Prices are EUR/MWh — divide by 10 for ct/kWh
- Timestamps are UTC — convert to CET/CEST for display
- DST transitions: some days have 23 or 25 hours
