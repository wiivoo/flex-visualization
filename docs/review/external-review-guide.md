# External Review Guide

This guide is the fastest way for an external engineer, auditor, or reviewer to understand the live application without reverse-engineering the whole repository.

## 1. What This Repo Is

- Framework: Next.js 16 App Router with React 19 and TypeScript.
- Product: energy-flexibility dashboards for EV charging, home battery, dynamic tariffs, and management-style views.
- Runtime shape: server application with API routes, not a static export.

Start here:

- Product/setup overview: [`README.md`](../../README.md)
- Active feature inventory: [`features/INDEX.md`](../../features/INDEX.md)
- Current data/runtime notes: [`docs/v2/current-data-state.md`](../v2/current-data-state.md)

## 2. What Is Live Versus Historical

Live app code:

- `src/app/`
- `src/components/`
- `src/lib/`
- `public/data/`

Historical or research-only material:

- `src/_archive/`
- `research/`

Those historical areas are intentionally excluded from repo-level linting so validation reflects the production codepath.

## 3. Runtime Model

The app requires a Node.js runtime because it contains:

- route handlers under `src/app/api/`
- server-side fetch/caching logic for external energy datasets

This matters for deployment review:

- static hosting alone is not sufficient
- outbound HTTPS access is required
- production secrets must be set at the host level

## 4. Primary Review Surfaces

Use these paths when reviewing behavior:

- Routes and page entrypoints: `src/app/`
- Shared calculation logic: `src/lib/`
- EV charging UI: `src/components/v2/`
- Battery workflows: `src/components/battery/`
- Dynamic tariff views: `src/components/dynamic/`
- Management/insight views: `src/components/management/`

## 5. API Endpoints To Inspect

The main runtime endpoints are:

- `src/app/api/prices/batch/route.ts`
- `src/app/api/generation/route.ts`
- `src/app/api/generation/mix/route.ts`
- `src/app/api/pv-radiation/route.ts`
- `src/app/api/tariff-components/route.ts`
- `src/app/api/nl-tariff-components/route.ts`

Reviewers should note that these endpoints mix:

- public data fetches
- optional Supabase caching
- country-specific fallback chains
- cache-control and `revalidate` usage

## 6. Secrets And External Dependencies

Optional integrations:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `ENTSOE_API_TOKEN`
- `ENERGY_FORECAST_TOKEN`

Key external data providers:

- SMARD
- ENTSO-E
- aWATTar
- Energy Charts
- EPEX/GB static datasets
- PVGIS
- Tibber lookup
- Octopus Kraken GraphQL
- PDOK
- Supabase

## 7. Validation Commands

These are the repo’s intended baseline checks:

```bash
npm ci
npm run lint
npm run build
docker build -t flex-visualization .
```

## 8. Deployment Assets

The repo now includes Azure-friendly deployment assets:

- `Dockerfile`
- `.dockerignore`
- `azure-pipelines.yml`
- `docs/deployment/azure-app-service.md`

## 9. Reviewer Notes

- `README.md` describes the current product and operational setup.
- `CHANGELOG.md` is the human-readable release log.
- `features/INDEX.md` is the feature/status registry.
- `docs/battery/pv-battery-calculator-audit-and-model-notes.md` captures recent calculator accounting corrections.

If reviewing correctness, start with the relevant `features/PROJ-*.md` spec and compare it with the live code paths listed above.
