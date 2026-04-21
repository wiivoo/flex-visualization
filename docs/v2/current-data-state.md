# Current Data State

Last updated: April 21, 2026

This document describes the current production data behavior of `/v2`, including official sources, selectors, automation, fallbacks, and known limitations.

## Scope

- Region support in `/v2`: `DE`, `NL`, `GB`
- Day-ahead visualization: active in all three regions
- `DA+ID` optimization: active in all three regions
- Production deploy target: Vercel from `main`

## Day-Ahead Sources

### Germany (`DE`)

- Official source in app: `SMARD (Bundesnetzagentur)`
- Dataset used by app: `filter 4169 / module 8004169`
- Market reference: DE-LU day-ahead
- Runtime units in chart: `ct/kWh`
- Verification link still shown in the chart source row

Notes:
- Static files are served from `public/data/smard-prices.json` and `public/data/smard-prices-qh.json`.
- The app uses SMARD as the primary official source and still keeps an `EPEX SPOT DE-LU` cross-check link in the tooltip.

### Netherlands (`NL`)

- Official source in app: `ENTSO-E Transparency Platform`
- Dataset used by app: `documentType=A44`, bidding zone `10YNL----------L`
- Runtime units in chart: `ct/kWh`
- Public verification links are intentionally not exposed in the chart source row

Notes:
- The app stores official ENTSO-E values for NL.
- Public ENTSO-E web links for the live table were unstable, so the direct verification link was removed from the UI.
- Static files are served from `public/data/nl-prices.json` and `public/data/nl-prices-qh.json`.

### Great Britain (`GB`)

- Official source in app: `EPEX SPOT`
- Runtime units in chart: `GBp/kWh`
- ENTSO-E is not used for GB day-ahead
- BMRS MID is not used in `/v2` as a GB day-ahead source

Supported GB day-ahead auctions:

- `DAA 1`: hourly GB day-ahead auction (`60'`)
- `DAA 2`: half-hour GB day-ahead auction (`30'`)

Current UI state:

- GB keeps the same `DA / DA+ID` selector pattern as DE and NL
- A separate left pill toggles `DAA 1` and `DAA 2`
- Current default auction in code is still `DAA 1`
- The chart source row does not expose a public verification link for GB

Static GB files:

- `public/data/gb-daa1-prices.json`
- `public/data/gb-daa1-prices-qh.json`
- `public/data/gb-daa2-prices.json`
- `public/data/gb-daa2-prices-qh.json`

Notes:
- `DAA 1` is stored natively as hourly prices and expanded to quarter-hours for internal compatibility.
- `DAA 2` is stored natively as half-hour prices, aggregated to hourly for the hourly file, and duplicated to quarter-hours for internal compatibility.

## Intraday / `DA+ID`

### Germany and Netherlands

- Intraday overlay source: EPEX continuous intraday
- Optimization signal used in `/v2`: `ID3`
- Static fallback files:
  - `public/data/de-intraday-continuous.json`
  - `public/data/nl-intraday-continuous.json`

### Great Britain

- Intraday overlay source: EPEX continuous intraday for GB
- Optimization signal shown in UI: `RPD HH`
- Internal field used for compatibility with the optimizer: `id3_ct`
- Static fallback file: `public/data/gb-intraday-continuous.json`

Important:

- GB does not use native 15-minute intraday products in the same way as DE/NL.
- The GB continuous feed is parsed as half-hour data and duplicated into quarter-hour slots internally.
- In the UI, GB sub-hour display is shown as `30 min`, not `15 min`.

Separate GB intraday auction files also exist:

- `public/data/gb-ida1-auction-prices.json`
- `public/data/gb-ida1-auction-prices-qh.json`
- `public/data/gb-ida2-auction-prices.json`
- `public/data/gb-ida2-auction-prices-qh.json`

Current limitation:

- Those GB intraday auction files are generated and stored, but the current `DA+ID` overlay path still uses continuous intraday data, not `IDA1` / `IDA2`.

## Runtime Loading Model

Client behavior in `/v2`:

1. Load region-specific static JSON from `public/data`
2. Render immediately from static data
3. Call `/api/prices/batch` in the background for incremental refresh
4. Merge fresh results into client state without losing the current selected date if the new region also supports it

GB-specific runtime behavior:

- If GB static files are missing or empty, the client bootstraps a recent window from `/api/prices/batch`
- The API route fetches live EPEX GB day-ahead data first
- If live EPEX fetch fails or returns nothing, the API falls back to deployed static GB files

## Automation

Primary scheduled workflow:

- File: `.github/workflows/update-smard-data.yml`
- Schedule: daily at `13:30 UTC`

Current workflow steps:

1. Refresh DE day-ahead from SMARD
2. Refresh NL day-ahead from ENTSO-E
3. Refresh GB day-ahead from EPEX (`DAA 1` and `DAA 2`)
4. Refresh GB intraday auction files (`IDA1`, `IDA2`)
5. Refresh static continuous intraday files for `DE`, `NL`, and `GB`
6. Run a local static-data smoke test
7. Commit changed `public/data/*` files back to `main`

The Vercel site then redeploys automatically from `main`.

## Smoke Test

File:

- `scripts/smoke-static-data.mjs`

Purpose:

- Verify that GB day-ahead static files exist and are recent
- Verify that `DAA 1` and `DAA 2` files have sane latest-day counts
- Verify that static continuous intraday files for `DE`, `NL`, and `GB` exist and are recent
- Catch broken scraper output before stale data is committed silently

Run manually:

```bash
npm run smoke:data
```

## Known Limitations

- NL keeps ENTSO-E as the official source, but the public ENTSO-E verification link is not shown because the public table URLs were unstable.
- GB default auction is still `DAA 1`, even though `DAA 2` is the closer native granularity match to current DE/NL day-ahead.
- GB `IDA1` / `IDA2` are stored, but not yet wired in as the main `DA+ID` optimization signal.
- Some workflow steps other than GB day-ahead still allow partial resilience over strict failure if upstream scraping is temporarily noisy.

## Relevant Files

- `src/app/v2/page.tsx`
- `src/components/v2/steps/Step2ChargingScenario.tsx`
- `src/lib/use-prices.ts`
- `src/app/api/prices/batch/route.ts`
- `src/lib/day-ahead-sources.ts`
- `src/lib/gb-static.ts`
- `src/lib/intraday-static.ts`
- `scripts/update-gb.mjs`
- `scripts/update-gb-intraday-auctions.mjs`
- `scripts/scrape-epex-intraday.mjs`
- `.github/workflows/update-smard-data.yml`
