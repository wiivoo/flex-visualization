# External Integrations

**Analysis Date:** 2026-04-07

## APIs & External Services

### SMARD (Bundesnetzagentur)

- **Purpose:** Primary source for German day-ahead electricity prices and generation data
- **Base URL:** `https://www.smard.de/app/chart_data`
- **Auth:** None (public API)
- **Client:** `src/lib/smard.ts`
- **Filters used:**

| Filter ID | Data |
|-----------|------|
| 4169 | Day-ahead price DE-LU (EUR/MWh) |
| 4068 | Solar generation (MW) |
| 4067 | Wind onshore (MW) |
| 1225 | Wind offshore (MW) |
| 410 | Grid load (MW) |

- **Resolutions:** `hour` (24 pts/day), `quarterhour` (96 pts/day)
- **Data structure:** Weekly timestamp buckets; fetch index first, then time series by bucket
- **Index endpoint:** `GET /4169/DE/index_hour.json` returns `{ timestamps: number[] }`
- **Series endpoint:** `GET /4169/DE/4169_DE_{resolution}_{timestamp}.json` returns `{ series: [[ts_ms, price], ...] }`
- **Caching:** Next.js `revalidate: 3600` (1h) on fetch, plus Supabase `price_cache`
- **Used by:**
  - `src/app/api/prices/batch/route.ts` — hourly + QH fallback chain (priority 3 for hourly, priority 1 for QH)
  - `src/app/api/generation/route.ts` — solar/wind/load overlay
  - `scripts/download-smard.mjs` — daily static data update

### ENTSO-E Transparency Platform

- **Purpose:** European day-ahead prices (DE-LU fallback + NL primary source)
- **Base URL:** `https://web-api.tp.entsoe.eu/api`
- **Auth:** `ENTSOE_API_TOKEN` env var (required, server-side only)
- **Client:** `src/lib/entsoe.ts`
- **Domains:**

| Country | EIC Code |
|---------|----------|
| DE | `10Y1001A1001A82H` (DE-LU) |
| NL | `10YNL----------L` |

- **Rate limit:** 400 requests/minute per user
- **Response format:** XML with TimeSeries > Period > Point structure (parsed via regex)
- **Retry logic:** Up to 2 retries on HTTP 503 with exponential backoff (`1s * (attempt + 1)`)
- **Chunking:** Ranges > 60 days automatically split into 60-day chunks to stay under 100 TimeSeries limit
- **Priority in fallback chain:** #2 for DE hourly, #1 (only source) for NL
- **Used by:**
  - `src/app/api/prices/batch/route.ts` — DE fallback + NL primary
  - `scripts/download-smard.mjs` — ENTSO-E gap-fill for SMARD data
  - `scripts/update-nl.mjs` — NL price data updates (GitHub Actions)

### aWATTar

- **Purpose:** German EPEX Spot day-ahead prices (fastest source, ~3 days history)
- **Base URL:** `https://api.awattar.de/v1/marketdata`
- **Auth:** None (public)
- **Client:** `src/lib/awattar.ts`
- **Rate limit:** 100 requests/day — mitigated by `next: { revalidate: 3600 }`
- **Query params:** `?start={unix_ms}&end={unix_ms}`
- **Response format:** JSON `{ data: [{ start_timestamp, end_timestamp, marketprice, unit }] }`
- **Priority in fallback chain:** #1 for DE hourly (fastest, native range support)
- **Limitation:** Only ~3 days of historical data available
- **Used by:** `src/app/api/prices/batch/route.ts`

### Energy-Charts (Fraunhofer ISE)

- **Purpose:** German day-ahead prices (fallback source)
- **Base URL:** `https://api.energy-charts.info/price`
- **Auth:** None (public)
- **Client:** `src/lib/energy-charts.ts`
- **Bidding zone:** DE-LU
- **Query params:** `?bzn=DE-LU&start=YYYY-MM-DD&end=YYYY-MM-DD`
- **Response format:** JSON `{ unix_seconds: number[], price: (number|null)[] }`
- **Priority in fallback chain:** #4 for DE hourly
- **Used by:** `src/app/api/prices/batch/route.ts`

### EnergyForecast.de

- **Purpose:** 48-hour price forecasts extending beyond published EPEX data
- **Base URL:** `https://www.energyforecast.de/api/v1/predictions`
- **Auth:** `ENERGY_FORECAST_TOKEN` env var (required, server-side only)
- **Client:** `src/lib/energy-forecast.ts`
- **Rate limit:** 50 requests/day
- **Market zones:** DE-LU, NL
- **Resolutions:** HOURLY, QUARTER_HOURLY
- **Key fields:** `price_origin: 'market' | 'forecast'` — distinguishes actual vs predicted prices
- **Price conversion:** EUR/kWh x 100 = ct/kWh (different from other APIs!)
- **Response:** Array of `{ start, end, price, price_origin }` entries
- **`forecastStart`:** ISO timestamp of first `'forecast'` entry, used by client for visual styling
- **Used by:** `src/app/api/prices/batch/route.ts` (forecast boundary detection + gap filling at end of range)

### EPEX SPOT

- **Purpose:** Intraday continuous prices (ID Full, ID1, ID3)
- **URL:** `https://www.epexspot.com/en/market-results`
- **Auth:** None (public website, scraped via headless browser)
- **Client:** `scripts/scrape-epex-intraday.mjs`
- **Method:** Headless Chromium via Playwright — scrapes HTML tables
- **Data extracted:** 15-min intraday continuous prices for DE and NL
- **Table structure:** 168 rows/day = 24h x 7 rows (hourly + 30min + 4 QH blocks)
- **Storage:** Scraped data upserted into Supabase `price_cache` table with type `intraday`
- **Market areas:** DE (default), NL
- **Schedule:** Manual via `scripts/cron-epex-intraday.sh`
- **CLI flags:** `--area DE|NL`, `--date YYYY-MM-DD`, `--dry-run`

## Data Storage

### Supabase (Cache Layer)

- **Purpose:** Price data caching — NOT primary data store
- **Client:** `src/lib/supabase.ts` (singleton, `createClient()`)
- **SDK:** `@supabase/supabase-js` ^2.39.3
- **Connection:** `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- **Table:**

| Table | Key | Purpose |
|-------|-----|---------|
| `price_cache` | `(date, type)` unique | Cached price data with smart TTL |

- **Columns:** `date` (YYYY-MM-DD), `type` (string), `cached_at` (ISO), `source` (string), `prices_json` (JSONB)
- **Cache type encoding:**

| Type Key | Resolution | Country |
|----------|------------|---------|
| `day-ahead` | Hourly (24/day) | DE |
| `day-ahead-qh` | Quarter-hourly (96/day) | DE |
| `nl:day-ahead` | Hourly | NL |
| `nl:day-ahead-qh` | Quarter-hourly | NL |
| `intraday` | QH (EPEX scraper) | DE |

- **Smart TTL strategy** (`src/lib/price-cache.ts`):

| Date | TTL | Rationale |
|------|-----|-----------|
| Past | Infinity (never) | EPEX actuals are final |
| Today | 2 hours | May get intraday updates |
| Future | 1 hour | Forecast replaced by actuals at ~12:15 CET |

- **Operations:** upsert on conflict `(date, type)`, bulk select for ranges
- **Cleanup:** `cleanupExpiredCache()` deletes entries > 30 days old
- **Error handling:** All cache errors are non-fatal (logged, operation continues)

### Static JSON Files

- **Location:** `public/data/`
- **Purpose:** Offline fallback + fast initial load for historical data
- **Updated by:** GitHub Actions daily at 13:30 UTC
- **Files committed to git:**

| File | Source | Content |
|------|--------|---------|
| `smard-prices.json` | SMARD | DE hourly prices (full history, compact `{t,p}` format) |
| `smard-prices-qh.json` | SMARD | DE quarter-hourly prices |
| `smard-generation.json` | SMARD | Solar, wind, load data (`{t,s,w,l}` format) |
| `smard-meta.json` | SMARD | Metadata (date ranges, counts) |
| `nl-prices.json` | ENTSO-E | NL hourly prices |
| `nl-prices-qh.json` | ENTSO-E | NL quarter-hourly prices |

### CSV Fallback

- **Location:** `CSVs/` (project root)
- **Client:** `src/lib/csv-prices.ts`
- **Format:** `timestamp,price` (EUR/MWh)
- **Naming:** `spot_price_YYYY.csv`, `intraday_price_YYYY.csv`
- **Priority in fallback chain:** #5 (last resort before demo data)

### Local Storage (Browser)

- **Key:** `flexmon-config`
- **Purpose:** Persist user configuration (vehicle, pricing, DSO selection)
- **Implementation:** `src/lib/config.ts` — `loadConfig()`, `saveConfig()`, `resetConfig()`

## Authentication & Identity

**Auth Provider:** Custom (single shared password)
- **Implementation:** `src/lib/auth.ts`
- **API route:** `POST /api/auth` at `src/app/api/auth/route.ts`
- **Flow:** POST password -> verify against `DASHBOARD_PASSWORD` env var -> sign JWT -> set `flexmon-session` cookie
- **Library:** jose (HS256)
- **Session:** 24h expiry
- **Secret:** `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` env var (fallback to hardcoded key)
- **Middleware:** `src/middleware.ts` — passthrough (no route protection, auth at API level only)

## Monitoring & Observability

**Error Tracking:** None (console.error only)
**Logs:** `console.error` / `console.warn` in API routes and lib functions
**Analytics:** None detected
**Health checks:** None detected

## CI/CD & Deployment

### Vercel

- **Platform:** Vercel (hobby/free tier)
- **Production URL:** `web.lhdus.dpdns.org` (port 8080)
- **Deploy trigger:** Git push to main
- **Build command:** `next build` (auto-detected)
- **Static assets:** `public/data/*.json` served via Vercel CDN, refreshed on each deploy

### GitHub Actions

**Workflow:** `.github/workflows/update-smard-data.yml`
- **Name:** "Update Price Data"
- **Schedule:** Daily at 13:30 UTC (14:30 CET / 15:30 CEST)
- **Timing rationale:** EPEX SPOT publishes D+1 day-ahead prices ~12:00 CET; SMARD ingests within ~1h
- **Trigger:** Also `workflow_dispatch` for manual runs
- **Runner:** `ubuntu-latest`, Node.js 20
- **Steps:**
  1. `node scripts/download-smard.mjs` — Fetch DE prices + generation from SMARD (with ENTSO-E gap-fill)
  2. `node scripts/update-nl.mjs` — Fetch NL prices from ENTSO-E
  3. `git diff --quiet public/data/` — Check for changes
  4. Auto-commit with message `chore: update price data YYYY-MM-DD` if changed
- **Secrets used:** `ENTSOE_API_TOKEN`
- **Permissions:** `contents: write`
- **Files committed:** `smard-prices.json`, `smard-prices-qh.json`, `smard-generation.json`, `smard-meta.json`, `nl-prices.json`, `nl-prices-qh.json`

## Data Scripts

| Script | Purpose | External Dependencies |
|--------|---------|----------------------|
| `scripts/download-smard.mjs` | Full SMARD dataset download (prices + generation) | SMARD API, ENTSO-E (gap-fill) |
| `scripts/update-nl.mjs` | NL price data update | ENTSO-E API |
| `scripts/scrape-epex-intraday.mjs` | EPEX intraday continuous scraper | EPEX website (Playwright), Supabase |
| `scripts/scrape-epex.mjs` | EPEX spot price scraper | EPEX website |
| `scripts/download-nl.mjs` | NL data download | ENTSO-E API |
| `scripts/build-projected-prices.mjs` | Forward price projections | Local data |
| `scripts/cron-epex-intraday.sh` | Cron wrapper for EPEX scraper | Shell |
| `scripts/extract-chart-data.mjs` | Chart data extraction utility | Local data |
| `scripts/analyze-fridays.mjs` | Friday price analysis | Local data |

## Price Data Fallback Chain

### DE Hourly (24 pts/day)

```
1. Supabase cache (if fresh per smart TTL)
2. aWATTar (fast, ~3 days history)
3. ENTSO-E (full historical, hourly)
4. SMARD (weekly chunks, parallel fetch)
5. Energy-Charts (Fraunhofer ISE)
6. CSV files (local /CSVs/)
7. Demo data (generated seasonal patterns, DE only)
```

### DE Quarter-Hourly (96 pts/day)

```
1. Supabase cache (if fresh, type='day-ahead-qh')
2. SMARD QH (native 15-min resolution)
3. Hourly chain above -> expand x4 (isHourlyAvg=true flag)
4. Demo data
```

### NL (any resolution)

```
1. Supabase cache (if fresh, prefixed nl:)
2. ENTSO-E (NL domain only)
3. No demo fallback (returns error — prevents fake prices for non-DE)
```

### Forecast Extension (48h window)

```
EnergyForecast.de -> appended to end of range if range extends into future
forecastStart marks where actual EPEX -> forecast boundary is
Hourly API always used for boundary detection (consistency across resolutions)
```

**Implemented in:** `src/app/api/prices/batch/route.ts` (537 lines)

## API Routes

| Route | Method | File | Purpose | Sources |
|-------|--------|------|---------|---------|
| `/api/prices/batch` | GET | `src/app/api/prices/batch/route.ts` | Multi-day price data with caching + fallback | All price APIs |
| `/api/generation` | GET | `src/app/api/generation/route.ts` | Solar/wind/load generation data | SMARD |
| `/api/generation/mix` | GET | `src/app/api/generation/mix/route.ts` | Generation mix data | SMARD |
| `/api/auth` | POST | `src/app/api/auth/route.ts` | Password login, JWT issuance | Local auth |
| `/api/tariff-components` | GET | `src/app/api/tariff-components/route.ts` | DE tariff component data | Local calculation |
| `/api/nl-tariff-components` | GET | `src/app/api/nl-tariff-components/route.ts` | NL tariff component data | Local calculation |

## Environment Configuration

**Required env vars:**

| Variable | Scope | Purpose |
|----------|-------|---------|
| `DASHBOARD_PASSWORD` | Server | Login password |
| `AUTH_SECRET` | Server | JWT signing key (or `DASHBOARD_SESSION_SECRET`) |
| `ENTSOE_API_TOKEN` | Server + CI | ENTSO-E API access |
| `ENERGY_FORECAST_TOKEN` | Server | EnergyForecast.de API access |
| `NEXT_PUBLIC_SUPABASE_URL` | Client | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Client | Supabase anon key |

**Secrets location:**
- Local: `.env.local` (gitignored)
- Production: Vercel environment variables
- CI: GitHub Actions secrets (`ENTSOE_API_TOKEN`)
- Reference: `.env.local.example` with dummy values

## Price Unit Convention

All external APIs return prices in **EUR/MWh**. Internal representation is **ct/kWh**.

| Source | Input Unit | Conversion |
|--------|-----------|------------|
| SMARD | EUR/MWh | / 10 |
| ENTSO-E | EUR/MWh | / 10 |
| aWATTar | EUR/MWh | / 10 |
| Energy-Charts | EUR/MWh | / 10 |
| EnergyForecast.de | EUR/kWh | x 100 |

Conversions happen at the API client boundary in each respective `src/lib/*.ts` file.

## Webhooks & Callbacks

**Incoming:** None
**Outgoing:** None

---

*Integration audit: 2026-04-07*
