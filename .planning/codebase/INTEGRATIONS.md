# FlexMon Dashboard — External Integrations

## SMARD API Integration

### Overview
SMARD (Bundesnetzagentur) provides German/Luxembourg day-ahead electricity market prices and generation data. It is the primary price source for the DE market.

### Data Flow
```
GitHub Actions (daily)          Browser (on page load)
       |                               |
download-smard.mjs            usePrices() hook
       |                               |
public/data/smard-prices.json   /api/prices/batch
public/data/smard-prices-qh.json       |
public/data/smard-generation.json  src/lib/smard.ts
public/data/smard-meta.json            |
       |                         SMARD REST API
       |                               |
       +------- merge in client -------+
```

### API Endpoints Used
- **Index:** `GET https://www.smard.de/app/chart_data/4169/DE/index_hour.json`
  Returns `{ timestamps: number[] }` — weekly bucket boundaries
- **Time series:** `GET https://www.smard.de/app/chart_data/4169/DE/4169_DE_{resolution}_{timestamp}.json`
  Returns `{ series: [[timestamp_ms, price_eur_mwh], ...] }`

### Filter & Resolution
- Filter `4169` = Marktpreis Deutschland/Luxemburg (Day-Ahead EPEX Spot)
- Resolutions: `hour` (24 pts/day) and `quarterhour` (96 pts/day)

### Lookup Logic (`src/lib/smard.ts`)
1. Fetch index to get weekly timestamp buckets
2. Find the bucket whose start timestamp is <= the requested date
3. Fetch that bucket's time series
4. Filter to the requested day's 24 hours

### Price Conversion
`EUR/MWh → ct/kWh`: divide by 10 (e.g., 100 EUR/MWh = 10 ct/kWh)

### Static Data Files (`public/data/`)
| File | Contents | Format |
|------|----------|--------|
| `smard-prices.json` | Hourly prices, all history | `[{ t: timestamp_ms, p: eur_mwh }, ...]` |
| `smard-prices-qh.json` | Quarter-hourly prices | same compact format |
| `smard-generation.json` | Solar, wind, load by hour | `[{ t, s, w, l }, ...]` |
| `smard-meta.json` | Metadata (date range, count) | JSON object |

These compact formats minimize file size. The `scripts/download-smard.mjs` script populates them.

### Incremental Updates in Browser
On each page load, `usePrices()`:
1. Loads static JSON files immediately (fast first paint)
2. Determines `lastStaticDate` from the tail of `smard-prices.json`
3. Calls `/api/prices/batch?startDate={lastStaticDate+1}&endDate={today+2}` in the background
4. Deduplicates by timestamp and merges new points into state
5. Same logic for quarter-hourly data with `?resolution=quarterhour`

### Next.js Fetch Caching
All SMARD fetches use `next: { revalidate: 3600 }` — server-side cache of 1 hour.

---

## ENTSO-E API Integration

### Overview
ENTSO-E (European Network of Transmission System Operators for Electricity) provides day-ahead prices for all European bidding zones. Used for non-DE countries (currently Netherlands `NL`).

### Endpoint
```
GET https://web-api.tp.entsoe.eu/api
  ?securityToken={ENTSOE_API_TOKEN}
  &documentType=A44
  &in_Domain={bidding_zone}
  &out_Domain={bidding_zone}
  &periodStart=YYYYMMDD0000
  &periodEnd=YYYYMMDD0000
```

### Bidding Zones Supported (`src/lib/entsoe.ts`)
| Country | EIC Code |
|---------|----------|
| DE (DE-LU) | `10Y1001A1001A82H` |
| NL | `10YNL----------L` |

### Response Format
ENTSO-E returns XML (not JSON). The parser in `src/lib/entsoe.ts`:
1. Extracts all `<Period>` blocks via regex
2. Reads `<start>` timestamp and `<resolution>` (PT60M or PT15M)
3. Iterates `<Point>` entries: `<position>` (1-based) × step interval + period start = exact timestamp
4. Converts `price.amount` from EUR/MWh to ct/kWh (÷ 10)

### Rate Limits
400 requests/minute per user (generous; caching prevents hitting this).

### Auth
`ENTSOE_API_TOKEN` environment variable — server-side only (not `NEXT_PUBLIC_`).

### Usage in Client
Non-DE countries trigger a single batch fetch through `/api/prices/batch?country=XX` which calls `fetchEntsoeRange()` for the last 365 days up to day-after-tomorrow.

---

## aWATTar API Integration

### Overview
aWATTar provides German EPEX Spot day-ahead prices as a public JSON API. Alternative/fallback source alongside SMARD.

### Endpoint
```
GET https://api.awattar.de/v1/marketdata?start={unix_ms}&end={unix_ms}
```

### Response Format
```json
{
  "object": "list",
  "data": [
    { "start_timestamp": ..., "end_timestamp": ..., "marketprice": 85.34, "unit": "Eur/MWh" }
  ]
}
```

### Rate Limit
100 requests/day — mitigated by `next: { revalidate: 3600 }` fetch cache.

### Usage
`src/lib/awattar.ts` provides `fetchAwattarDayAhead(date)` and `fetchAwattarRange(start, end)`. The price cache sources field records `'awattar'` when this source is used.

---

## Supabase Integration

### Role
Supabase acts as a **price cache layer**, not a primary data store. It prevents repeated calls to SMARD/ENTSO-E/aWATTar for the same dates.

### Client Setup (`src/lib/supabase.ts`)
```ts
createClient(NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY)
```
Uses the public anon key — RLS policies on `price_cache` must gate access appropriately.

### Cache Table: `price_cache`
| Column | Type | Notes |
|--------|------|-------|
| `date` | string | YYYY-MM-DD |
| `type` | string | `'day-ahead'`, `'day-ahead-qh'`, `'intraday'`, `'forward'` |
| `cached_at` | ISO timestamp | When the entry was written |
| `source` | string | `'awattar'` \| `'smard'` \| `'energy-charts'` \| `'csv'` \| `'demo'` |
| `prices_json` | JSONB array | `[{ timestamp, price_ct_kwh }, ...]` |

Primary key / unique constraint: `(date, type)` — upsert uses `onConflict: 'date,type'`.

### Smart TTL (`src/lib/price-cache.ts`)
| Date | TTL | Rationale |
|------|-----|-----------|
| Past | Infinity (never expires) | EPEX actuals are final |
| Today | 2 hours | May receive intraday updates |
| Future | 1 hour | Forecast → actuals published ~12:15 CET |

### Resolution Encoding
Quarter-hourly data uses type key `'day-ahead-qh'` (vs `'day-ahead'` for hourly). This avoids a schema migration while supporting both resolutions.

### Cleanup
`cleanupExpiredCache()` deletes entries older than 30 days — called as needed to prevent unbounded growth.

---

## GitHub Actions — SMARD Data Auto-Update

### Workflow
`.github/workflows/update-smard-data.yml`

### Schedule
- **Cron:** `30 13 * * *` (13:30 UTC = 14:30 CET / 15:30 CEST)
- **Timing rationale:** EPEX SPOT publishes D+1 day-ahead prices ~12:00 CET; SMARD ingests within ~1 hour
- **Manual trigger:** `workflow_dispatch` available from GitHub Actions UI

### Steps
1. Checkout repository (`actions/checkout@v4`)
2. Set up Node.js 20 (`actions/setup-node@v4`)
3. Run `node scripts/download-smard.mjs` — downloads latest SMARD data
4. Check if `public/data/` has changed (`git diff --quiet`)
5. If changed: commit and push with message `chore: update SMARD data YYYY-MM-DD`
6. If no changes: log "already up to date — no commit needed"

### Files Updated
```
public/data/smard-prices.json
public/data/smard-prices-qh.json
public/data/smard-generation.json
public/data/smard-meta.json
```

### Permissions
`contents: write` — required to commit and push.

---

## Vercel Deployment

### Configuration
- Framework preset: Next.js (auto-detected)
- Build command: `npm run build`
- Production domain: `web.lhdus.dpdns.org` (port 8080)

### Environment Variables Required
| Variable | Used By | Visibility |
|----------|---------|-----------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client | Public (browser) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client | Public (browser) |
| `DASHBOARD_PASSWORD` | Auth (`src/lib/auth.ts`) | Server-only |
| `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` | JWT signing | Server-only |
| `ENTSOE_API_TOKEN` | ENTSO-E API | Server-only |

### Static Assets
`public/data/*.json` files are served as static assets — Vercel CDN caches them globally. The GitHub Actions daily commit triggers a Vercel redeploy, refreshing the CDN-cached files.
