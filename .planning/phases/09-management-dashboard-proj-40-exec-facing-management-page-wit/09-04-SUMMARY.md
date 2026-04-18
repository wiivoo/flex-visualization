---
phase: 09-management-dashboard-proj-40-exec-facing-management-page-wit
plan: 04
subsystem: ui
tags: [nextjs, middleware, jose, jwt, recharts, tailwind, localstorage, management-dashboard]

# Dependency graph
requires:
  - phase: 09-management-dashboard-proj-40-exec-facing-management-page-wit
    provides: ManagementScenario + aggregateMonthly + KpiTile + YoyBarChart + ExplainerPanel + SettingsDrawer (plans 09-01..09-03)
provides:
  - "/management route, password-gated, renders KPI row + YoY + explainer"
  - "Edge middleware gate for /management/:path* via flexmon-session JWT"
  - "Client-side scenario re-aggregation when user overrides defaults"
  - "Graceful empty-state when management-monthly.json is missing/empty"
affects: [management-dashboard, auth, future-phases-relying-on-middleware]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Edge middleware JWT gate using jose (matches src/lib/auth.ts)"
    - "'use client' Suspense-wrapped page with SSR-safe localStorage hydration in useEffect"
    - "Scenario re-aggregation: keep precomputed avgSpreadCtKwh, re-derive energy-per-session + sessions"

key-files:
  created:
    - src/app/management/page.tsx
    - .planning/phases/09-management-dashboard-proj-40-exec-facing-management-page-wit/09-04-SUMMARY.md
  modified:
    - src/middleware.ts

key-decisions:
  - "Middleware matcher is /management/:path* only — /v2 intentionally untouched to avoid regressing existing open-access behaviour"
  - "Login redirect uses ?redirect=<path> (matches existing /login page) rather than ?next="
  - "Scenario overrides re-derive only energy+sessions; avgSpreadCtKwh stays from precomputed market data"
  - "Period toggle state is intentionally NOT synced to URL (per spec: management view is non-shareable; each viewer sees the same defaults)"
  - "Empty-state check combines loadError OR null dataset OR zero monthly entries — any of the three triggers graceful fallback"

patterns-established:
  - "Password-gated client page pattern: 'use client' + Suspense + skeleton fallback + client-only data fetch"
  - "Edge middleware JWT verification using jose + TextEncoder secret (matches /api/auth pattern)"
  - "In-page scenario drawer: default-equal check prevents redundant recomputation when scenario == default"

requirements-completed: [MGMT-01, MGMT-08, MGMT-09]

# Metrics
duration: 4min
completed: 2026-04-18
---

# Phase 9 Plan 4: Wire /management route with KPI, YoY, and explainer Summary

**Edge-middleware JWT gate on /management plus a client-side dashboard page composing KpiTile, YoyBarChart, ExplainerPanel, and SettingsDrawer against precomputed monthly aggregates.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-18T22:06:08Z
- **Completed:** 2026-04-18T22:10:01Z
- **Tasks:** 3 (2 code + 1 smoke check)
- **Files modified:** 2 (1 created, 1 updated)

## Accomplishments

- `/management` now returns 200 for authenticated sessions and 307-redirects to `/login?redirect=/management` for unauthenticated viewers
- Production build (`npm run build`) compiles cleanly; `/management` is listed as a static route alongside `/v2`
- KPI row (4 tiles: Total savings, Avg spread, Sessions counted, Avg day-ahead) derives Δ% vs. prior window for YTD and Last-12 modes
- YoY bar chart renders latest year vs. prior year with Δ% labels (from Plan 09-02)
- ExplainerPanel renders the latest-month reconciliation equation (from Plan 09-03); tolerance check fires on drift > 1%
- SettingsDrawer opens via gear icon, persists to `flexmon-management-scenario-v1`, and triggers re-aggregation
- Empty-state fallback renders when `/data/management-monthly.json` is missing (verified live with JSON renamed to `.bak`)
- Period toggle (YTD / Last 12 months / All) switches KPI windows without page reload
- Amber "Custom scenario active" banner appears only when overrides diverge from defaults

## Task Commits

1. **Task 1: Extend middleware to gate /management behind flexmon-session** — `a56ef98` (chore)
2. **Task 2: Build /management page with data load, KPIs, YoY, explainer, drawer** — `7932317` (feat)
3. **Task 3: End-to-end reconciliation and empty-state smoke check** — no code changes (verification-only task, all assertions passed)

**Plan metadata commit:** pending (will be created alongside SUMMARY + STATE update)

## Files Created/Modified

- `src/app/management/page.tsx` (CREATED, 591 lines) — `'use client'` Suspense-wrapped page; fetches `MANAGEMENT_DATA_URL`, filters by period, re-aggregates on scenario overrides, renders KPI row + YoY + explainer + drawer; empty-state Card fallback
- `src/middleware.ts` (MODIFIED) — replaced no-op with `jwtVerify`-based redirect; matcher scoped to `/management/:path*`; uses `AUTH_SECRET` or `DASHBOARD_SESSION_SECRET` (same env vars as `src/lib/auth.ts`)

## Decisions Made

- **Middleware scope:** Matcher is `/management/:path*` only. `/v2` currently has no middleware gate (its matcher was `[]` before this plan), and expanding the gate would be a silent policy change. Kept additive-only per plan instructions.
- **Redirect query param:** `?redirect=<pathname>` — the plan suggested `?next=`, but the existing `src/app/login/page.tsx` reads `params.get('redirect')`. Matching the existing convention avoided a breaking handoff.
- **Scenario re-aggregation shortcut:** When the user's scenario matches the default byte-for-byte, `reaggregate` returns the precomputed entry unchanged — no rounding drift is introduced into headline numbers for the shareable view.
- **Period: ALL has no prior window:** `priorWindow` returns `null` for `ALL`, so KPIs show no Δ% in that mode (correct — there is no "prior" for the whole dataset).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Redirect param name aligned with existing login page**
- **Found during:** Task 1 (middleware implementation)
- **Issue:** Plan specified `?next=<path>` but `src/app/login/page.tsx` line 32 reads `params.get('redirect')`. Using `?next=` would have left users stranded on `/login` after successful auth.
- **Fix:** Used `?redirect=<pathname>` in `loginUrl.searchParams.set(...)`.
- **Files modified:** `src/middleware.ts`
- **Verification:** Smoke test confirmed 307 redirect followed by successful POST `/api/auth` round-trip lands on the authenticated `/management` 200.
- **Committed in:** `a56ef98` (Task 1 commit)

---

**Total deviations:** 1 auto-fixed (1 bug)
**Impact on plan:** Single-line change; would have silently broken the redirect UX. No scope creep.

## Issues Encountered

- **Initial smoke-test grep failed on "Flex Value Dashboard" string in raw HTML.** Expected: the page is `'use client'` Suspense-wrapped, so SSR HTML contains only the skeleton fallback; the title string is in the client JS chunk and renders post-hydration. Confirmed the string exists in `.next/static/chunks/232bed940bbb30b6.js`. Not a bug — matches the `/v2` pattern.
- **Two unrelated files (`src/components/v2/steps/Step2ChargingScenario.tsx`, `src/lib/v2-config.ts`) were modified in the working tree at session start.** Per scope boundary rules these pre-existing changes (UK/GB country support from commit `8e92486`) were left untouched. Not part of this plan.

## User Setup Required

None — no new env vars or external services. The existing `DASHBOARD_PASSWORD` and `AUTH_SECRET` (or `DASHBOARD_SESSION_SECRET`) env vars are reused.

## Next Phase Readiness

- Phase 9 (Management Dashboard) is feature-complete. All four plans (09-01 through 09-04) are now shipped.
- Precompute script (`scripts/precompute-management-monthly.mjs`) exists; a follow-up can wire it into `.github/workflows/update-smard-data.yml` to run on the existing daily schedule (MGMT-10).
- NL parity and additional market coverage (PROJ-40 "Out of Scope") remain as potential follow-ups.
- Test plan: visit https://web.lhdus.dpdns.org/management, authenticate, verify four KPI tiles, YoY chart, and explainer render with 2022–2026 monthly data; toggle period; open settings drawer; change sessions/week → confirm amber banner appears and Total-savings recalculates.

## Self-Check

- [x] `src/app/management/page.tsx` created (591 lines, `'use client'` first line)
- [x] `src/middleware.ts` gates `/management/:path*` via `jwtVerify`
- [x] `npm run build` passes (17 routes; `/management` static, middleware compiled as Proxy)
- [x] Unauthenticated `curl -sI /management` → 307 to `/login?redirect=/management`
- [x] Authenticated `curl -sI /management` → 200 OK
- [x] Renaming `management-monthly.json` → 404 on JSON, page still 200 (graceful empty-state path)
- [x] All acceptance-criteria grep patterns match in both files
- [x] Commits exist: `a56ef98` (middleware), `7932317` (page)

## Self-Check: PASSED

---
*Phase: 09-management-dashboard-proj-40-exec-facing-management-page-wit*
*Completed: 2026-04-18*
