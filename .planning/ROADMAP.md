# FlexMon Dashboard — Roadmap

## Overview
3 phases | 6 active requirements | Coarse granularity

Active requirements: V2G-01, V2G-02, INTL-01, INTL-02, INTL-03, INTRA-01
Tech debt: Step2ChargingScenario.tsx refactor (2,924 lines), mobile layout, performance

---

## Phase 1: V2G Integration

**Goal:** Complete PROJ-29 — expose Vehicle-to-Grid dual value streams in the UI so users can see discharge revenue alongside charging savings.

**Requirements:** V2G-01, V2G-02

**What exists today:**
- `computeV2gWindowSavings` in `src/lib/charging-helpers.ts` — V2G computation logic exists
- V1G/V2G toggle buttons are present in the Customer Profile card
- The toggle is visible but the V2G path may not flow through to the full visualization

**What needs to be built:**
- V2G discharge revenue calculation wired into the optimization output
- `SessionCostCard` updated to show discharge revenue as a separate line
- `MonthlySavingsCard` updated to show dual streams (charging savings + discharge revenue)
- Visual distinction between charging savings and discharge revenue in all summary boxes

**Key files:**
- `src/components/v2/SessionCostCard.tsx`
- `src/components/v2/MonthlySavingsCard.tsx`
- `src/components/v2/steps/Step2ChargingScenario.tsx`
- `src/lib/charging-helpers.ts`
- `src/lib/optimizer.ts`

**Success Criteria:**
1. V2G toggle in Customer Profile card produces a different result from V1G
2. SessionCostCard shows discharge revenue as a distinct value when V2G is active
3. MonthlySavingsCard renders dual-stream bars (charging savings + discharge revenue)
4. Switching V1G ↔ V2G updates all summary numbers without page reload

**UI hint:** yes

---

## Phase 2: Multi-Country & Intraday

**Goal:** Enable the NL country selector that already exists in code but is disabled in the UI, and surface EPEX intraday prices alongside day-ahead in the chart.

**Requirements:** INTL-01, INTL-02, INTL-03, INTRA-01

**What exists today:**
- ENTSO-E NL fetch path implemented in `src/app/api/prices/batch/route.ts`
- Country-prefixed Supabase cache keys in place
- EPEX intraday scraper implemented, `intradayId3` state in `src/lib/use-prices.ts`
- `src/components/v2/DailySavingsHeatmap.tsx` is new/untracked — may be related

**What needs to be built:**
- Country selector UI component (DE/NL toggle, likely in the sidebar or header)
- Wire country selection into `use-prices.ts` country state
- Intraday price overlay in the Recharts chart (ID3 curve, distinct styling)
- User-visible indicator when intraday data is unavailable (scraper down)

**Key files:**
- `src/lib/use-prices.ts`
- `src/components/v2/steps/Step2ChargingScenario.tsx`
- `src/app/api/prices/batch/route.ts`
- New: country selector component

**Known risks:**
- ENTSO-E returns 503s intermittently — need graceful fallback with user message
- Race condition in `loadData()` when country switches (see CONCERNS.md §2) — fix AbortController before enabling country toggle
- SMARD source mislabeled as `source: 'smard'` for ENTSO-E responses (CONCERNS.md §2) — fix before NL goes live

**Success Criteria:**
1. Country toggle (DE / NL) is visible and functional
2. Switching to NL loads ENTSO-E prices; chart title or label reflects active country
3. EPEX intraday ID3 curve appears as an overlay on the price chart when data is available
4. When intraday data is unavailable, a non-blocking indicator is shown (not a silent blank)
5. Switching countries does not contaminate the price cache or cause stale data display

**UI hint:** yes

---

## Phase 3: Refactoring & Polish

**Goal:** Address critical tech debt from CONCERNS.md — split the 2,924-line Step2 component, improve mobile layout, and clean up dead code.

**Requirements:** (no new user-facing requirements — internal quality)

**What needs to be done:**

### 3a — Component Split (highest priority)
Split `src/components/v2/steps/Step2ChargingScenario.tsx` (2,924 lines) into:
- `src/lib/use-rolling-savings.ts` — 365-day rolling scan hook (~200 lines)
- `src/lib/use-chart-data.ts` — chart data builder + intraday ID3 re-optimization
- `src/components/v2/CustomerProfileSidebar.tsx` — left sidebar Card
- `src/components/v2/ChargingChart.tsx` — Recharts chart + drag logic

Merge overlapping 365-day scan memos into a single shared hook (CONCERNS.md §5).

### 3b — Mobile Responsiveness
- Verify layout at 375px breakpoint
- Fix any overflow/truncation issues in the two-column layout
- MiniCalendar date cells: change `div` + `onClick` to `button` elements (also fixes keyboard accessibility)

### 3c — Dead Code Removal
Remove unused exports: `fetchForecastOnly`, `fetchEnergyChartsDayAhead`, `fetchAwattarDayAhead`, `fetchSmardDayAhead`, `hasCsvData`, `SMARD_RESOLUTION` (CONCERNS.md §9).
Delete or relocate `src/_archive/` outside `src/` to prevent accidental imports.

### 3d — Demo Data Banner
Add a visible banner/badge when `source === 'demo'` so users know they are seeing fabricated prices (CONCERNS.md §10).

### 3e — Batch API Auth
Verify `middleware.ts` matcher config covers `/api/prices/batch` — currently unauthenticated (CONCERNS.md §4).

**Success Criteria:**
1. No source file in `src/` exceeds 500 lines
2. `Step2ChargingScenario.tsx` is replaced by the four extracted modules; existing behavior is unchanged
3. Dashboard renders correctly at 375px viewport width (no horizontal scroll)
4. All dead exports removed; `src/_archive/` moved out of `src/`
5. A "Demo data" badge appears when real prices cannot be loaded

**UI hint:** yes

---

## Traceability

| Requirement | Phase | Status |
|---|---|---|
| V2G-01 | Phase 1 | In Progress (PROJ-29) |
| V2G-02 | Phase 1 | In Progress (PROJ-29) |
| INTL-01 | Phase 2 | Implemented, UI disabled |
| INTL-02 | Phase 2 | Implemented |
| INTL-03 | Phase 2 | Implemented |
| INTRA-01 | Phase 2 | Scraper exists |
| Tech debt | Phase 3 | Not started |

---
*Last updated: 2026-03-26 — initial roadmap*
