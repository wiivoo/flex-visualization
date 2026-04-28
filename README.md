# Flex Visualization

Interactive energy-flex dashboards built in Next.js. The current product centers on EV charging optimization, then extends that same pricing/data foundation into home-battery, dynamic-tariff, and insight views.

## Runtime Summary

- This is a **Next.js App Router server application**, not a static export.
- The repo contains active API routes under `src/app/api/`, shared-password auth via `/api/auth`, and server-side data fetch/caching logic.
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
| `/login` | Shared-password login screen |
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
| Auth | Shared-password login via `POST /api/auth` and JWT cookies |
| Optional cache | Supabase |
| Deployment | Vercel today; Azure App Service and Docker assets are now included in-repo |

## Architecture At A Glance

| Concern | Current Shape |
| --- | --- |
| Rendering | Next.js server app with route-based pages and API endpoints |
| Runtime requirement | Node.js runtime with outbound HTTPS access |
| Auth | Shared password, session cookie, JWT signing via `AUTH_SECRET` |
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
| `src/lib/` | Pricing, optimization, export, auth, and data-source logic |
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

2. Create a local env file:

```bash
cp .env.local.example .env.local
```

3. Set the required variables:

| Variable | Required | Notes |
| --- | --- | --- |
| `DASHBOARD_PASSWORD` | Yes | Shared login password |
| `AUTH_SECRET` | Yes | JWT signing secret for the session cookie |
| `NEXT_PUBLIC_SUPABASE_URL` | Optional | Needed only if you want Supabase-backed cache/features |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Optional | Paired with the Supabase URL |
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
```

## Deployment Shape

For Azure, the cleanest target is **Azure App Service on Linux** with either:

1. direct Node.js deployment, or
2. a custom container built from the included `Dockerfile`.

The container path is the more reproducible option because it avoids runtime drift between local, CI, and host environments.

The repository includes:

- [`Dockerfile`](Dockerfile)
- [`.dockerignore`](.dockerignore)
- [`azure-pipelines.yml`](azure-pipelines.yml)
- [`docs/deployment/azure-app-service.md`](docs/deployment/azure-app-service.md)

## Versioning And Releases

- `package.json` is the source of truth for the current version.
- `CHANGELOG.md` is the human-readable release history.
- Git tags use `vX.Y.Z`.
- Semver rules: patch for fixes and low-risk maintenance/docs releases, minor for new user-facing features, major for breaking changes or major product resets.

## Auth Notes

- The active auth flow is route/API based, not middleware based.
- Login happens through `/login` and `POST /api/auth`.
- Sessions are stored in an HTTP-only cookie created by `src/lib/auth.ts`.

## Documentation Sources Of Truth

- Product and setup: this README
- Feature inventory: [`features/INDEX.md`](features/INDEX.md)
- AI team roster: [`.claude/TEAM.md`](.claude/TEAM.md)
- AI task routing: [`.claude/rules/team-orchestration.md`](.claude/rules/team-orchestration.md)
- Repo conventions for Claude agents: [`CLAUDE.md`](CLAUDE.md)
