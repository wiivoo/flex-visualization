# IT Handoff

This is the short operational handoff for the current rollout shape.

## Repo Verification Status

Verified on `2026-04-29`:

- `npm run lint` passes with no warnings
- `npm run build` passes
- Current verified scope is repo-side readiness only; Azure resource wiring, secrets, and service connections remain IT-owned

## Deployment Shape

- One Dockerized Next.js app container
- One separate daily Azure Pipeline for data refresh
- Current hosted scope: `DE` and `NL` day-ahead only
- `GB` stays disabled
- `intraday` stays disabled

## What IT Needs To Set Up

### App runtime

- Build and run the app from `Dockerfile`
- Host it on Azure App Service for Containers
- Leave `ENABLE_GB` unset
- Leave `ENABLE_INTRADAY` unset

Optional runtime vars:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ENTSOE_API_TOKEN`
- `ENERGY_FORECAST_TOKEN`

For the current rollout, none of those are required just to start and serve the app.

### Daily refresh job

- Enable `azure-pipelines-data-refresh.yml`
- Store `ENTSOE_API_TOKEN` as an Azure Pipelines secret variable or variable-group secret
- Keep the daily schedule active

That refresh job updates:

- `public/data/smard-prices.json`
- `public/data/smard-prices-qh.json`
- `public/data/smard-generation.json`
- `public/data/smard-meta.json`
- `public/data/nl-prices.json`
- `public/data/nl-prices-qh.json`
- `public/data/management-monthly.json`

It does not refresh intraday data in the current rollout.

### Redeploy wiring

Fill these variables in `azure-pipelines.yml`:

- `deploy_enabled=true`
- `azure_subscription_service_connection`
- `azure_container_registry_service_connection`
- `azure_container_registry_login_server`
- `app_service_name`

Without those values, the repo can validate and refresh data, but Azure will not automatically push and redeploy the production container.

## Smoke Check

After the app is reachable, run:

```bash
SMOKE_BASE_URL=http://<host-or-ip>:<port> npm run smoke:deploy
```

Expected result:

- `/v2`, `/v2/calculator`, `/battery`, and `/dynamic` return `200`
- `DE` and `NL` day-ahead API calls return `200` with price data
- `GB` API calls are rejected because GB is disabled
- `intraday` API calls are rejected because intraday is disabled

## Ready-To-Send Message

Use this message as-is if needed:

```text
The repo is ready for Azure IT handoff in its current rollout shape.

Repo-side verification is complete:
- npm run lint passes cleanly
- npm run build passes

Operationally there are two parts:
1. one web app container for the Next.js app
2. one separate daily Azure Pipeline that refreshes DE/NL day-ahead data and management aggregates

Please keep GB and intraday disabled for the initial rollout, so ENABLE_GB and ENABLE_INTRADAY should remain unset.

The daily refresh pipeline needs the ENTSOE_API_TOKEN secret in Azure Pipelines.

Please also fill the Azure deployment variables in azure-pipelines.yml so refresh commits can trigger a rebuild and redeploy of the app container.

From the repo side, there is no remaining deployment blocker in this handoff. The remaining work is Azure-side configuration: App Service/container wiring, Azure service connections, pipeline secret setup, and final environment smoke verification after deployment.
```
