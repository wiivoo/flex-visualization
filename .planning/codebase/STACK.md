# FlexMon Dashboard — Technology Stack

## Framework & Runtime

| Layer | Technology | Version |
|-------|-----------|---------|
| Framework | Next.js (App Router) | ^16.1.1 |
| Runtime | Node.js | 20 (GitHub Actions target) |
| Language | TypeScript | ^5 |
| React | React + React DOM | ^19.0.0 |
| TypeScript target | ES2017 | — |
| Module resolution | bundler (Next.js native) | — |

Key tsconfig settings:
- `strict: true`
- `paths: { "@/*": ["./src/*"] }` — absolute imports via `@/`
- `exclude: ["src/_archive"]` — archived code excluded from builds

## UI Layer

### Tailwind CSS
- Version: ^3.4.1
- Dark mode: `class` strategy
- Color system: CSS custom properties (`hsl(var(--...))`) for all semantic tokens (background, foreground, primary, secondary, muted, accent, destructive, chart-1..5, sidebar)
- Border radius via CSS var `--radius`
- Accordion animations via Radix keyframes

### shadcn/ui (Radix UI primitives)
Active components kept in `src/components/ui/`:
- `@radix-ui/react-alert-dialog` ^1.1.15
- `@radix-ui/react-checkbox` ^1.3.3
- `@radix-ui/react-dialog` ^1.1.15
- `@radix-ui/react-dropdown-menu` ^2.1.16
- `@radix-ui/react-label` ^2.1.8
- `@radix-ui/react-popover` ^1.1.15
- `@radix-ui/react-select` ^2.2.6
- `@radix-ui/react-switch` ^1.2.6
- `@radix-ui/react-tabs` ^1.1.13
- `@radix-ui/react-tooltip` ^1.2.8
- Plus: accordion, avatar, collapsible, navigation-menu, progress, radio-group, scroll-area, separator, slot, toast

Supporting: `class-variance-authority` ^0.7.1, `clsx` ^2.1.0, `tailwind-merge` ^2.2.0

### Charts
- `recharts` ^3.7.0 — ComposedChart, Line, Area, Bar, ReferenceArea used throughout the dashboard

### Other UI
- `lucide-react` ^0.562.0 — icons
- `next-themes` ^0.4.6 — light/dark theme switching
- `sonner` ^2.0.7 — toast notifications
- `react-day-picker` ^9.13.2 — calendar/date picker
- `cmdk` ^1.1.1 — command palette

## Backend / API

### Next.js API Routes (App Router)
All routes live under `src/app/api/`:
- `GET /api/prices` — single day prices
- `GET /api/prices/batch` — date range, supports `?resolution=quarterhour`, `?type=intraday&index=id3`, `?country=XX`
- `GET /api/generation` — SMARD generation data (solar, wind, load) by date
- `POST /api/auth` — password login, issues JWT session cookie

### Supabase
- `@supabase/supabase-js` ^2.39.3
- Client initialized with `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- Used as a caching layer (`price_cache` table), not primary data source
- Cache table key: `(date, type)` with upsert on conflict

## External APIs

| API | Purpose | Base URL | Auth |
|-----|---------|----------|------|
| SMARD (BNetzA) | German day-ahead prices, generation data | `https://www.smard.de/app/chart_data` | None (public) |
| ENTSO-E Transparency Platform | European day-ahead prices (non-DE countries) | `https://web-api.tp.entsoe.eu/api` | `ENTSOE_API_TOKEN` env var |
| aWATTar | German EPEX Spot prices (alternative source) | `https://api.awattar.de/v1/marketdata` | None (public) |
| energy-charts.info | Additional generation/forecast data | See `src/lib/energy-charts.ts` | None (public) |

## Auth Approach

- Library: `jose` ^6.1.3 (JWT signing/verification)
- Algorithm: HS256
- Session cookie name: `flexmon-session`
- Session duration: 24 hours
- Password: stored in `DASHBOARD_PASSWORD` env var (single shared password, no user accounts)
- Secret key: `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` env var
- Middleware: `src/middleware.ts` — currently passes all requests through (matcher: `[]`); auth is enforced at the API route level

## Build & Deploy

### Local Dev
```bash
npm run dev     # localhost:3000
npm run build   # Production build
npm run lint    # ESLint (eslint-config-next 16.1.1)
```

### Security Headers (next.config.ts)
Applied to all routes (`/:path*`):
- `X-Frame-Options: DENY`
- `X-Content-Type-Options: nosniff`
- `Referrer-Policy: origin-when-cross-origin`
- `Strict-Transport-Security: max-age=31536000; includeSubDomains`
- `X-DNS-Prefetch-Control: on`
- `X-XSS-Protection: 1; mode=block`

### Vercel
- Production URL: `web.lhdus.dpdns.org` (port 8080)
- Platform: Vercel

### GitHub Actions
- Workflow: `.github/workflows/update-smard-data.yml`
- Schedule: daily at 13:30 UTC (14:30 CET / 15:30 CEST)
- Trigger: also `workflow_dispatch` for manual runs
- Commits updated `public/data/smard-prices.json`, `smard-prices-qh.json`, `smard-generation.json`, `smard-meta.json`

## Key Dependencies (full list)

```
next                    ^16.1.1
react / react-dom       ^19.0.0
typescript              ^5
tailwindcss             ^3.4.1
recharts                ^3.7.0
@supabase/supabase-js   ^2.39.3
jose                    ^6.1.3
date-fns                ^4.1.0
zod                     ^4.3.5
react-hook-form         ^7.71.1
@hookform/resolvers     ^5.2.2
lucide-react            ^0.562.0
next-themes             ^0.4.6
sonner                  ^2.0.7
react-day-picker        ^9.13.2
js-cookie               ^3.0.5
playwright              ^1.58.2
```
