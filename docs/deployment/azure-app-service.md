# Azure App Service Deployment Guide

This repository is ready to run on Azure without relying on GitHub or Vercel-specific workflows.

See also:

- `docs/deployment/it-handoff.md`
- `docs/v2/current-data-state.md`

## Recommended Azure Shape

Use:

1. Azure Repos for source control
2. Azure Pipelines for CI/CD
3. Azure App Service on Linux for hosting

Two hosting modes are valid:

- Direct Node.js runtime on App Service
- Custom container on App Service using the included `Dockerfile`

For this repo, the **container path is preferred** because it removes drift between local, CI, and production runtime behavior.

## Why App Service

This app is not a static SPA. It requires a Node.js server because it includes:

- Next.js App Router server rendering
- API routes under `src/app/api/`
- external data fetching and cache behavior on the server

## Required Configuration

Recommended App Service Application Settings:

- `WEBSITES_PORT=3000`
- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ENABLE_GB`
- `ENABLE_INTRADAY`
- `ENTSOE_API_TOKEN`
- `ENERGY_FORECAST_TOKEN`

Notes:

- `WEBSITES_PORT=3000` is required for this container on Azure App Service because the included Docker image listens on port `3000`, not port `80`.
- `ENTSOE_API_TOKEN` is optional for the web app, but useful for ENTSO-E-backed fallback paths.
- `ENERGY_FORECAST_TOKEN` is optional. If omitted, the app still serves `/v2`; only the forecast extension for future `DE` / `NL` prices is skipped.
- The daily Azure refresh pipeline does not need `ENERGY_FORECAST_TOKEN`.
- A plain Docker run works without any custom env vars; tokens only enable optional integrations.
- GB is disabled by default. Set `ENABLE_GB=true` on App Service only if you explicitly want to expose GB in the hosted UI and runtime API requests.
- Intraday is disabled by default. Leave `ENABLE_INTRADAY` unset unless you intentionally restore and maintain an intraday refresh path.

## Repo Assets Included

- `Dockerfile` for production container builds
- `.dockerignore` for lean build context
- `azure-pipelines.yml` for CI and container validation
- `azure-pipelines-data-refresh.yml` for the Azure copy of the daily GitHub market-data refresh
- `next.config.ts` with `output: 'standalone'`

## Baseline Pipeline Flow

The included `azure-pipelines.yml` does three things:

1. installs dependencies, lints, and builds the app
2. builds the Docker image to validate the production container path
3. includes a deploy stage skeleton that can push the production image to Azure Container Registry and deploy Azure App Service once IT fills in the Azure connection variables and enables deployment

The included `azure-pipelines-data-refresh.yml` mirrors the behavior of `.github/workflows/update-smard-data.yml` on Azure:

- scheduled daily at `30 13 * * *`
- manual runnable from Azure Pipelines UI
- builds the Docker `refresh` target
- runs that refresh container with `ENTSOE_API_TOKEN`
- refreshes only the SMARD / ENTSO-E-backed DE/NL static files
- refreshes DE generation data used by the management layer
- smoke-tests those refreshed DE/NL artifacts, precomputes management aggregates, and commits only when data changed
- does not refresh intraday data in the current deployment shape

Keep this refresh job separate from the serving web container. The production app container should stay focused on running Next.js; the scheduled data refresh belongs in Azure Pipelines so it can update checked-in data files and push commits without bloating the runtime image.

## How Fresh Data Reaches Production

The refresh pipeline updates the repo, not the live App Service container.

Daily flow:

1. `azure-pipelines-data-refresh.yml` runs the refresh container.
2. That container updates `public/data/` in the checked-out repo workspace.
3. The refresh pipeline commits and pushes those generated file changes back to the Azure deployment branch.
4. That new commit triggers `azure-pipelines.yml` on `master`.
5. The app pipeline rebuilds the production Docker image from the refreshed commit and redeploys App Service.

This means the repo is the source of truth for refreshed static market data. The live website only serves the new data after the app image is rebuilt and redeployed from that refreshed commit.

Recommended operating mode:

- keep the refresh pipeline and app pipeline separate
- let the refresh pipeline commit generated data back to the repo
- let the app pipeline redeploy once per day from that new commit
- leave `ENABLE_GB` unset in App Service so the hosted deployment exposes only `DE` and `NL`
- leave `ENABLE_INTRADAY` unset so the hosted deployment stays aligned with the maintained refresh scope

## What Must Be Active

For a healthy Azure deployment, treat these as two required operational parts:

1. The App Service container must be running to serve the website.
2. The Azure data-refresh pipeline must be enabled so price files continue to update.

Clarification:

- They do not run as two always-on containers.
- The container is the live app runtime.
- The pipeline is a scheduled maintenance job that runs the Dockerized refresh target.
- If only the container runs, users can still load the site, but the static data layer will age and become stale.
- If only the refresh pipeline runs, the repo data gets newer, but the live App Service stays on the older baked-in data until the app pipeline redeploys.

## Secret Storage

- Store web runtime secrets in App Service Application Settings.
- Store pipeline secrets in Azure Pipelines secret variables or a variable group.
- If you want central secret management, back those pipeline variables with Azure Key Vault instead of hardcoding them in YAML.
- For the current rollout, keep `ENABLE_GB` and `ENABLE_INTRADAY` unset.

GitHub Actions are intentionally kept in place. Azure is not the source of truth for normal development in this setup.

This is a safe default because it does not assume:

- a specific Azure Container Registry
- a specific App Service name
- a specific subscription or service connection

## Suggested Rollout

### Phase 1: CI only

- create a new Azure Pipeline from `azure-pipelines.yml`
- confirm `npm run lint`, `npm run build`, and `docker build` pass in Azure

### Phase 2: Hosting

Create:

- an App Service Plan (Linux)
- a Web App for Containers

Then configure:

- container image source
- `WEBSITES_PORT=3000`
- required App Settings
- HTTPS/custom domain as needed

### Phase 3: Delivery

Fill in these pipeline variables in Azure Pipelines:

- `deploy_enabled=true`
- `azure_subscription_service_connection`
- `azure_container_registry_service_connection`
- `azure_container_registry_login_server`
- `app_service_name`

Then let `azure-pipelines.yml`:

- push the built image to Azure Container Registry
- update the App Service container image reference
- redeploy automatically on every `master` commit, including the daily refresh commit

This is the recommended end-to-end behavior for this repository.

## Practical Handoff Checklist

Before handing the repo to IT, make sure these points are explicit:

1. Build and run the app container from `Dockerfile`.
2. Enable `azure-pipelines-data-refresh.yml` on its daily schedule.
3. Store `ENTSOE_API_TOKEN` as an Azure Pipelines secret variable or variable-group secret.
4. Keep `ENABLE_GB` and `ENABLE_INTRADAY` unset for the initial rollout.
5. Fill in the Azure deploy variables in `azure-pipelines.yml` so refresh commits actually trigger a rebuild and redeploy.

## Reconsolidation Rule

This repo currently runs in split mode:

- GitHub remains the normal development surface
- Azure keeps its own CI pipeline plus an Azure-native daily data refresh

Because both platforms may generate `public/data/` commits independently, do not expect branch hashes to stay identical. Instead:

1. treat GitHub `main` as the working development branch
2. treat Azure `master` as the Azure-side deployment branch
3. periodically merge GitHub `main` into Azure `master`
4. if `public/data/` differs on both sides, keep the fresher generated artifacts and continue

That keeps the divergence predictable and limited to generated data rather than product code.

## Runtime Notes

- Use an LTS Node version across local, CI, and hosting environments.
- The included Dockerfile uses `node:22-alpine`.
- App Service must allow outbound access to the external data providers used by the API routes.

## Verification

Repo-side verification status as of `2026-04-29`:

- `npm run lint` passes cleanly
- `npm run build` passes
- container build and live Azure smoke validation remain environment-specific checks for IT

Before a production cutover, verify:

```bash
npm run lint
npm run build
docker build -t flex-visualization .
docker run --rm --name flex-visualization -p 3000:3000 \
  flex-visualization
npm run smoke:deploy
```

Then test:

- `/v2`
- `/battery`
- `/battery/calculator`
- `/dynamic`
- the active API routes under `/api/*`
