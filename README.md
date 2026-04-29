# Flex Visualization

Interactive energy-flex dashboards built in Next.js. The current product centers on EV charging optimization, then extends that same pricing/data foundation into home-battery, dynamic-tariff, and insight views.

## Runtime Summary

- This is a **Next.js App Router server application**, not a static export.
- The repo contains active API routes under `src/app/api/` and server-side data fetch/caching logic.
- The app therefore needs a real **Node.js runtime** in production.
- A production-ready `Dockerfile` and baseline `azure-pipelines.yml` are included for Azure-based deployment and CI.

## Product Surfaces

| Route | Purpose |
| --- | --- |
| `/` | Redirects to `/v2` |
| `/v2` | Main EV charging flexibility dashboard |
| `/v2/insights` | Portfolio, management, and sweep-style insight views |
| `/battery` | Home battery business-case workflow |
| `/dynamic` | Dynamic tariff explainer for DE |
| `/dynamic/nl` | Dynamic tariff explainer for NL |
| `/dynamic/analysis` | Dynamic tariff analysis view |
| `/management` | Legacy route redirected to `/v2/insights` |

## What The App Does

- Models EV charging savings against real day-ahead and intraday market data.
- Supports multiple market/data contexts, including DE, NL, and GB where the UI exposes them.
- Provides scenario-based views for charging, battery economics, and tariff analysis.
- Exports the active EV charging session view to Excel through `exceljs`.

## Stack

| Area | Details |
| --- | --- |
| Framework | Next.js 16 App Router, React 19, TypeScript |
| UI | Tailwind CSS, shadcn/ui, Recharts |
| Data | Static JSON in `public/data/` plus API-backed refresh/fallback flows |
| Optional cache | Supabase |
| Deployment | Vercel today; Azure App Service and Docker assets are now included in-repo |

## Architecture At A Glance

| Concern | Current Shape |
| --- | --- |
| Rendering | Next.js server app with route-based pages and API endpoints |
| Runtime requirement | Node.js runtime with outbound HTTPS access |
| Data sources | SMARD, ENTSO-E, aWATTar, EPEX, PVGIS, Tibber/Kraken, PDOK, EnergyForecast |
| Optional services | Supabase cache/storage |
| Container support | Multi-stage Docker build using Next.js standalone output |

## Data Sources

- `DE`: SMARD day-ahead prices and generation data.
- `NL`: ENTSO-E day-ahead data and NL tariff-specific views.
- `GB`: EPEX Spot day-ahead and intraday datasets where enabled in the UI.
- Additional fallbacks and forecast overlays are implemented in `src/lib/`.

Current data behavior and operational notes live in [`docs/v2/current-data-state.md`](docs/v2/current-data-state.md).

## Review And Audit Guides

Use these first if an external engineer needs to understand or review the system quickly:

- External review guide: [`docs/review/external-review-guide.md`](docs/review/external-review-guide.md)
- Azure deployment guide: [`docs/deployment/azure-app-service.md`](docs/deployment/azure-app-service.md)
- IT handoff note: [`docs/deployment/it-handoff.md`](docs/deployment/it-handoff.md)
- Current data/runtime behavior: [`docs/v2/current-data-state.md`](docs/v2/current-data-state.md)
- PV + battery audit note: [`docs/battery/pv-battery-calculator-audit-and-model-notes.md`](docs/battery/pv-battery-calculator-audit-and-model-notes.md)

## Repository Map

| Path | Purpose |
| --- | --- |
| `src/app/` | Routes, page shells, and API endpoints |
| `src/components/v2/` | Main EV charging dashboard UI |
| `src/components/battery/` | Home battery workflow UI |
| `src/components/dynamic/` | Dynamic tariff UI |
| `src/components/management/` | Insight and management cards used by `/v2/insights` |
| `src/lib/` | Pricing, optimization, export, and data-source logic |
| `public/data/` | Checked-in static market datasets |
| `docs/v2/` | Product, data, and design reference docs |
| `docs/review/` | External reviewer and audit guidance |
| `docs/deployment/` | Azure deployment and runtime runbooks |
| `features/` | Feature registry and per-feature specs |
| `.claude/` | Repo-local AI team roster, routing, and rules |

## Local Setup

1. Install dependencies:

```bash
npm install
```

2. Create a local env file if you need optional integrations:

```bash
cp .env.local.example .env.local
```

3. Set any optional variables you need:

| Variable | Required | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Needed only if you want Supabase-backed cache/features |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Paired with the Supabase URL |
| `ENABLE_GB` | Optional | Set to `true` to enable GB in the hosted app |
| `ENABLE_INTRADAY` | Optional | Set to `true` only if you explicitly want to re-enable intraday surfaces |
| `ENTSOE_API_TOKEN` | Optional | Needed for ENTSO-E-backed fetches |
| `ENERGY_FORECAST_TOKEN` | Optional | Needed for EnergyForecast-backed fetches |

4. Start the dev server:

```bash
npm run dev
```

The app serves locally at `http://127.0.0.1:3000`.

## Build And Verification

```bash
npm run build
npm run lint
docker build -t flex-visualization .
docker run --rm --name flex-visualization -p 3000:3000 flex-visualization
npm run smoke:deploy
```

If the app is not on port `3000`, point the smoke check at the running target:

```bash
SMOKE_BASE_URL=http://127.0.0.1:3001 npm run smoke:deploy
```

## Docker For IT Handoff

The simplest run path needs no env file at all:

```bash
docker build -t flex-visualization .
docker run --rm --name flex-visualization -p 3000:3000 flex-visualization
```

Then open:

- `http://127.0.0.1:3000/`
- `http://127.0.0.1:3000/v2`

If you want optional external integrations, create an env file from `.env.docker.example` and run:

```bash
cp .env.docker.example .env.docker
docker run --rm --name flex-visualization --env-file .env.docker -p 3000:3000 flex-visualization
```

Without optional tokens:

- the container still starts and serves the app
- ENTSO-E-backed fallback paths may be unavailable
- the future DE/NL forecast extension is skipped

For the current deployment scope, leave both `ENABLE_GB` and `ENABLE_INTRADAY` unset so the hosted app stays focused on the DE/NL day-ahead experience.

## Operational Model

To keep the product working as intended, there are two separate operational pieces:

1. The `flex-visualization` web container must be running so users can open the app.
2. The scheduled data-refresh job must also be active so `public/data/` keeps getting updated.

Important:

- These are not two web containers.
- The web container runs continuously.
- The refresh flow runs on a schedule in Azure Pipelines; it does not need to stay up as a long-running service.
- If the refresh pipeline is disabled, the app still opens, but the checked-in static market data will become stale over time.

## Dockerized Refresh

The repository includes a dedicated Docker `refresh` target for the Azure data-update flow.

Build it:

```bash
docker build --target refresh -t flex-visualization-refresh .
```

Run it against the checked-out repo data directory:

```bash
docker run --rm \
  -e ENTSOE_API_TOKEN=your_entsoe_token_here \
  -v "$(pwd)/public/data:/app/public/data" \
  flex-visualization-refresh
```

This refresh container:

- updates only the DE/NL static market data files backed by SMARD and ENTSO-E
- refreshes DE generation data used by the management layer
- runs the smoke test
- recomputes management aggregates
- does not refresh or expose intraday data in the current deployment shape

It does not commit or push by itself. In Azure, the pipeline runs this refresh container and then commits changed `public/data` files back to the target branch.

## Deployment Shape

For Azure, the cleanest target is **Azure App Service on Linux** with either:

1. direct Node.js deployment, or
2. a custom container built from the included `Dockerfile`.

The container path is the more reproducible option because it avoids runtime drift between local, CI, and host environments.

Use `flex-visualization` as the canonical Docker image/container name. The earlier `flexviz-local-test` name was only a throwaway local test container label, not a product name.

The repository includes:

- [`Dockerfile`](Dockerfile)
- [`.dockerignore`](.dockerignore)
- [`azure-pipelines.yml`](azure-pipelines.yml)
- [`azure-pipelines-data-refresh.yml`](azure-pipelines-data-refresh.yml)
- [`docs/deployment/azure-app-service.md`](docs/deployment/azure-app-service.md)

## Versioning And Releases

- `package.json` is the source of truth for the current version.
- `CHANGELOG.md` is the human-readable release history.
- Git tags use `vX.Y.Z`.
- Semver rules: patch for fixes and low-risk maintenance/docs releases, minor for new user-facing features, major for breaking changes or major product resets.

## Runtime Notes

- Supabase is optional. Without `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, the app still runs but skips Supabase-backed caching.
- `ENERGY_FORECAST_TOKEN` is optional at runtime. If you omit it in Azure, `/v2` still serves normally; only the forecast extension for future DE/NL prices is skipped.
- By default the hosted app exposes only `DE` and `NL`. Set `ENABLE_GB=true` only if you explicitly want to enable GB.
- Intraday is disabled by default in this deployment path. Leave `ENABLE_INTRADAY` unset unless you also restore a maintained intraday refresh flow.

## Azure Secret Placement

- Put runtime app secrets used by the web container in Azure App Service Application Settings.
- Put scheduled refresh secrets used by `azure-pipelines-data-refresh.yml` in Azure Pipelines secret variables or a variable group.
- `ENTSOE_API_TOKEN` is only needed for the refresh pipeline and ENTSO-E-backed fallback paths.
- `ENERGY_FORECAST_TOKEN` is not required for the Azure refresh pipeline.
- For the current rollout, do not set `ENABLE_GB` or `ENABLE_INTRADAY`.

## GitHub And Azure

- GitHub remains the day-to-day development repo and keeps the existing GitHub Actions workflows.
- Azure keeps `azure-pipelines.yml` for CI/container validation and `azure-pipelines-data-refresh.yml` as the Azure equivalent of `.github/workflows/update-smard-data.yml`.
- This intentionally allows GitHub and Azure to create separate data-refresh commits under `public/data/`.
- Reconsolidate periodically by merging or rebasing GitHub `main` into Azure `master`, then resolve any `public/data/` differences in favor of the fresher generated artifacts.

## Documentation Sources Of Truth

- Product and setup: this README
- Feature inventory: [`features/INDEX.md`](features/INDEX.md)
- AI team roster: [`.claude/TEAM.md`](.claude/TEAM.md)
- AI task routing: [`.claude/rules/team-orchestration.md`](.claude/rules/team-orchestration.md)
- Repo conventions for Claude agents: [`CLAUDE.md`](CLAUDE.md)
