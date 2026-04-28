# Azure App Service Deployment Guide

This repository is ready to run on Azure without relying on GitHub or Vercel-specific workflows.

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
- shared-password auth with HTTP-only cookies
- external data fetching and cache behavior on the server

## Required Configuration

At minimum, set these App Settings:

- `DASHBOARD_PASSWORD`
- `AUTH_SECRET`

Optional App Settings:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ENTSOE_API_TOKEN`
- `ENERGY_FORECAST_TOKEN`

## Repo Assets Included

- `Dockerfile` for production container builds
- `.dockerignore` for lean build context
- `azure-pipelines.yml` for CI and container validation
- `next.config.ts` with `output: 'standalone'`

## Baseline Pipeline Flow

The included `azure-pipelines.yml` does two things:

1. installs dependencies, lints, and builds the app
2. builds the Docker image to validate the production container path

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
- required App Settings
- HTTPS/custom domain as needed

### Phase 3: Delivery

After the host exists, extend `azure-pipelines.yml` to:

- push the built image to Azure Container Registry
- update the App Service container image reference

## Runtime Notes

- Use an LTS Node version across local, CI, and hosting environments.
- The included Dockerfile uses `node:22-alpine`.
- App Service must allow outbound access to the external data providers used by the API routes.

## Verification

Before a production cutover, verify:

```bash
npm run lint
npm run build
docker build -t flex-visualization .
docker run -p 3000:3000 \
  -e DASHBOARD_PASSWORD=... \
  -e AUTH_SECRET=... \
  flex-visualization
```

Then test:

- `/login`
- `/v2`
- `/battery`
- `/battery/calculator`
- `/dynamic`
- the active API routes under `/api/*`
