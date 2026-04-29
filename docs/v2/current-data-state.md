# Current Data State

Last updated: April 29, 2026

This document describes the current deployment shape that has been prepared and verified for Docker and Azure handoff.

## Active Deployment Scope

- Hosted app scope: `DE` and `NL`
- Active market layer: day-ahead only
- `GB`: disabled by default
- `intraday`: disabled by default
- Production deployment shape: Dockerized Next.js app plus Azure Pipelines refresh/redeploy flow

This is the intended rollout surface for IT.

## Day-Ahead Sources

### Germany (`DE`)

- Official source: `SMARD (Bundesnetzagentur)`
- Static files:
  - `public/data/smard-prices.json`
  - `public/data/smard-prices-qh.json`
- Management/generation support:
  - `public/data/smard-generation.json`
  - `public/data/smard-meta.json`

### Netherlands (`NL`)

- Official source: `ENTSO-E Transparency Platform`
- Static files:
  - `public/data/nl-prices.json`
  - `public/data/nl-prices-qh.json`

## Management Layer

The daily refresh flow also recomputes:

- `public/data/management-monthly.json`

That file powers the management/insights monthly aggregate layer.

## Disabled-by-Default Surfaces

### Great Britain (`GB`)

- GB day-ahead code and static files still exist in the repo
- The hosted rollout keeps GB off unless `ENABLE_GB=true`
- The current Azure refresh pipeline does not maintain GB data

### Intraday

- Intraday code paths still exist in the repo
- The hosted rollout keeps intraday off unless `ENABLE_INTRADAY=true`
- The current Azure refresh pipeline does not maintain intraday data
- When intraday is disabled, `/api/prices/batch?type=intraday...` returns a disabled error instead of serving stale data

## Runtime Loading Model

Client behavior in the current rollout:

1. Load checked-in static JSON from `public/data`
2. Render immediately from static day-ahead data
3. Call `/api/prices/batch` in the background for day-ahead incremental refresh
4. Keep `GB` and `intraday` unavailable unless explicitly re-enabled

## Automation

### App pipeline

- File: `azure-pipelines.yml`
- Purpose:
  - install dependencies
  - lint and build the app
  - validate Docker builds
  - optionally push/redeploy once Azure connection variables are filled in

### Daily refresh pipeline

- File: `azure-pipelines-data-refresh.yml`
- Schedule: daily at `13:30 UTC`
- Secret required: `ENTSOE_API_TOKEN`

Current refresh steps:

1. Build the Docker `refresh` target
2. Refresh DE SMARD day-ahead data
3. Refresh NL ENTSO-E day-ahead data
4. Run `scripts/smoke-refresh-data.mjs`
5. Recompute `management-monthly.json`
6. Commit changed `public/data/*` files back to the deployment branch

## Verification Commands

Use these for the current rollout shape:

```bash
npm run lint
npm run build
docker build -t flex-visualization .
docker build --target refresh -t flex-visualization-refresh .
docker run --rm --name flex-visualization -p 3000:3000 flex-visualization
npm run smoke:deploy
```

To test the refresh flow locally against the checked-out repo:

```bash
ENTSOE_API_TOKEN=your_entsoe_token_here npm run refresh:data
```

## Relevant Files

- `README.md`
- `docs/deployment/azure-app-service.md`
- `docs/deployment/it-handoff.md`
- `azure-pipelines.yml`
- `azure-pipelines-data-refresh.yml`
- `Dockerfile`
- `scripts/run-data-refresh.sh`
- `scripts/smoke-refresh-data.mjs`
- `scripts/smoke-deploy.mjs`
- `src/app/api/prices/batch/route.ts`
- `src/lib/use-prices.ts`
- `src/lib/country-config.ts`
