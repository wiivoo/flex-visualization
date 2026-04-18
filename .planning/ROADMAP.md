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

## Phase 4: EPEX Scraper — Full Field Capture & Stable Storage

**Goal:** Extend the EPEX intraday scraper to capture all available market data fields (not just ID indices), store them reliably in Supabase, and serve them via the batch API.

**Requirements:** INTRA-02, INTRA-03

**What exists today:**
- Scraper (`scripts/scrape-epex-intraday.mjs`) extracts 6 of 10 data columns: low, high, weight_avg, id_full, id1, id3
- Missing fields: `last` (final trade price), `buy_volume`, `sell_volume`, `volume`
- Supabase `price_cache` stores JSON with partial fields
- Batch API route serves `id3_ct` only via `?type=intraday&index=id3`

**What needs to be built:**
- Extend scraper to extract `last`, `buy_volume`, `sell_volume`, `volume` from EPEX table
- Update Supabase JSON schema to include all fields per QH entry
- Update `/api/prices/batch` to serve all intraday fields (not just id3)
- Add `--backfill` CLI flag to re-scrape dates even if cached (force-refresh with new schema)
- Validate data completeness before writing (reject partial scrapes)

**Key files:**
- `scripts/scrape-epex-intraday.mjs`
- `scripts/cron-epex-intraday.sh`
- `src/app/api/prices/batch/route.ts`

**Success Criteria:**
1. Scraper extracts all 10 data columns from EPEX table
2. Supabase entries include `last_ct`, `buy_vol`, `sell_vol`, `volume` per QH
3. Batch API returns full intraday data when `?type=intraday` (no index filter needed)
4. `--backfill` flag allows re-scraping cached dates to upgrade schema
5. Incomplete scrapes (< 80 QH with prices) are rejected, not stored

---

## Phase 5: Intraday Convergence Funnel Visualization

**Goal:** Replace the static ID3 line overlay with an animated convergence funnel that shows how intraday prices narrow from wide uncertainty to settlement, and how the optimizer re-optimizes charging blocks at each stage.

**Requirements:** INTRA-04, INTRA-05

**Depends on:** Phase 4 (needs full EPEX field data)

**What exists today:**
- ID3 line overlay on the Recharts chart (sky-blue `<Line>`)
- `id3Map` in Step2 keyed by HH:MM timestamps
- Optimizer (`runOptimization`) runs once on DA prices
- Intraday uplift (DA avg vs ID3 avg) shown in session cost card

**What needs to be built:**
- **Price funnel visualization:** For each QH slot, render a converging corridor from Low–High (widest) through ID3 → ID1 → ID Full → Last (narrowest), using `<ReferenceArea>` or gradient fills
- **Timeline scrubber/animation:** User can drag a time slider or press play to watch the funnel narrow stage by stage (DA → ID3 → ID1 → settlement)
- **Re-optimization at each stage:** At each animation step, re-run the optimizer with the current best-known prices for remaining QHs; charging blocks visually shift to cheaper slots
- **Volume opacity:** Map trade volume to funnel opacity/thickness — high volume = confident price, low volume = uncertain
- **Cumulative savings counter:** Show running ct/kWh improvement as each re-optimization step plays

**Key files:**
- `src/components/v2/steps/Step2ChargingScenario.tsx` (chart integration)
- `src/lib/optimizer.ts` (re-optimization with partial price updates)
- `src/lib/use-prices.ts` (fetch all intraday fields)
- New: `src/components/v2/IntradayFunnel.tsx` (funnel rendering logic)

**Success Criteria:**
1. Price funnel shows Low–High corridor that visibly narrows through ID3 → ID1 → ID Full → Last
2. Animation/scrubber lets user step through the convergence timeline
3. Charging blocks re-optimize and shift at each step
4. Volume maps to visual opacity or thickness
5. Cumulative savings improvement displayed at each stage
6. Works only for DE (NL intraday deferred)

**UI hint:** yes

---

## Phase 6: Process View — Chronological Optimization Timeline

**Goal:** Add a dedicated "process view" mode to the price chart that walks the user through the optimization timeline chronologically (forecast → DA nomination → intraday adjustment), with uncertainty modeling and a waterfall value-drag visualization. Works for both single EV and fleet mode — fleet mode demonstrates the portfolio effect on uncertainty reduction.

**Requirements:** PROC-01, PROC-02, PROC-03

**Plans:** 2 plans

Plans:
- [x] 06-01-PLAN.md — Process view computation engine + ProcessViewChart + Step2 integration
- [x] 06-02-PLAN.md — WaterfallCard + fleet overlays + end-to-end verification

**Depends on:** Phase 5 (needs intraday convergence data for full experience; DA stages work standalone)

**What exists today:**
- `TheoryOverlay.tsx` — 5-step educational walkthrough with synthetic data (Shape → DA → Intraday → Portfolio → Flex Band)
- `IntradayFunnel.tsx` — convergence funnel with DA → ID3 → ID1 → ID Full → Last stages
- `optimizer.ts` — single-pass optimization on DA prices
- `fleet-optimizer.ts` — flex band (greedy/lazy bounds), fleet schedule optimization, arrival/departure distributions
- Dashboard shows "perfect foresight" only — no uncertainty representation

**What needs to be built:**
- **Process view mode:** Dedicated chart mode (replaces normal chart temporarily) with time-axis scrubber or scroll-driven progressive reveal through 3 stages: Forecast → DA Nomination → Intraday Adjustment
- **Uncertainty scenarios:** User-selectable: Perfect foresight / Realistic forecast / Worst case — each shows different DA price error, car availability variance, and intraday correction costs
- **Waterfall value-drag card:** Decomposes value loss: perfect savings → minus DA forecast error → minus car availability error → minus intraday spread cost = realized value. Updates per selected scenario.
- **Re-optimization at each stage:** Show how the charging schedule changes as information is progressively revealed (forecast → actual DA → actual intraday)
- **Fleet mode support:** Process view respects single/fleet toggle. In fleet mode: √N portfolio effect reduces uncertainty bars in waterfall, flex band provides wider re-optimization corridor, arrival/departure distribution spread acts as natural hedge. The single-EV vs. fleet waterfall contrast is the killer argument for aggregation.

**Key files:**
- `src/components/v2/TheoryOverlay.tsx` (navigation pattern reference)
- `src/components/v2/IntradayFunnel.tsx` (funnel data model reference)
- `src/components/v2/steps/Step2ChargingScenario.tsx` (chart integration, single/fleet toggle)
- `src/lib/optimizer.ts` (re-optimization with staged price inputs)
- `src/lib/fleet-optimizer.ts` (flex band, fleet scheduling, distributions)
- `src/components/v2/FleetConfigPanel.tsx` (fleet config UI)
- New: `src/components/v2/ProcessViewChart.tsx` (process view chart mode)
- New: `src/components/v2/WaterfallCard.tsx` (waterfall value-drag card)
- New: `src/lib/process-view.ts` (pure computation for staged optimization + uncertainty)

**Canonical refs:** `src/components/v2/TheoryOverlay.tsx`, `src/components/v2/IntradayFunnel.tsx`, `src/lib/fleet-optimizer.ts`

**Success Criteria:**
1. Process view mode accessible from chart controls, replaces normal chart temporarily
2. Three chronological stages revealed progressively via scrubber/scroll: Forecast → DA Nomination → Intraday Adjustment
3. Three uncertainty scenarios selectable: Perfect foresight / Realistic / Worst case
4. Waterfall card decomposes value drag per uncertainty factor, updates per scenario
5. Chart shows re-optimized charging blocks at each stage with real price data
6. Uses actual DA and intraday prices for the selected date (graceful fallback when intraday unavailable)
7. Works in fleet mode: waterfall shows reduced uncertainty drag from √N portfolio effect; flex band visualizes re-optimization corridor
8. Switching single↔fleet visibly changes the waterfall — fleet shows smaller drag bars per car

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
| INTRA-02 | Phase 4 | Not started |
| INTRA-03 | Phase 4 | Not started |
| INTRA-04 | Phase 5 | Not started |
| INTRA-05 | Phase 5 | Not started |
| Tech debt | Phase 3 | Not started |
| PROC-01 | Phase 6 | Planned |
| PROC-02 | Phase 6 | Planned |
| PROC-03 | Phase 6 | Planned |
| MGMT-01..10 | Phase 9 | Planned |

### Phase 7: Insights tab — Ideal Parameters Sweep (BD heatmap + product sensitivity at /v2/insights, both views in one tab with toggle, sweep over optimizer.ts; pinned defaults sourcing TBD — see .planning/research/questions.md and .planning/notes/ideal-parameters-feature.md)

**Goal:** [To be planned]
**Requirements**: TBD
**Depends on:** Phase 6
**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 7 to break down)

### Phase 8: Plug-in Battery Business Case (DE/NL)

**Goal:** Ship a new v2-style sub-page that shows the business case for a plug-in home battery in Germany and the Netherlands (post-2027 regime). Covers three product variants — Schuko Steckerspeicher, Steckerspeicher + balcony PV, and a simple electrician-installed flat-friendly battery. Split layout: consumer ROI calculator on top, management/investor view below.

**Requirements:** TBD (to be derived during planning)

**Depends on:** Phase 7 (research prerequisites — see `.planning/research/questions.md` 2026-04-17 entries)

**Prerequisites before planning:**
- `.planning/notes/plug-in-battery-exploration.md` captures scope decisions — read first.
- Three open research questions dated 2026-04-17 must be resolved:
  1. Plug-in home battery product landscape & unit economics (DE/NL 2026)
  2. DE Steckerspeicher regulation (2026 regime)
  3. NL home battery regime post-2027 (salderingsregeling phase-out)

**Value streams to model:**
- Dynamic tariff arbitrage (SMARD DE, ENTSO-E NL) — charge at cheap hours, discharge at peak
- Balcony PV self-consumption — store daytime solar, use in evening peak

Not in scope: V2G, backup/resilience, C&I batteries, marketing landing page.

**Technical constraints (first-class parameters):**
- 800W DE feed-in cap (with 2000W transition scenario toggle)
- Household consumption profile (apartment baseline + evening peak)
- Battery specs: usable kWh, max charge/discharge kW, round-trip efficiency, standby loss

**Architectural pattern:** Mirror /v2 — client component under `src/app/`, shared optimizer lib, reuse `use-prices.ts`, shadcn/ui, Recharts ComposedChart, URL↔state sync, desktop-first.

**Success Criteria:**
1. Sub-page route exists and loads DE and NL price data (post-2027 NL regime modeled)
2. Battery optimizer produces arbitrage + PV self-consumption schedules respecting 800W feed-in cap, C-rate, and round-trip efficiency
3. Consumer ROI section shows annual savings, payback period, break-even year for each of the three battery variants
4. Management view shows unit economics per household and DE vs NL market comparison
5. Regulation-dependent inputs (DE feed-in cap, NL post-2027 terugleverkosten) are explicit, documented, and changeable via the UI

**UI hint:** yes

**Plans:** 0 plans

Plans:
- [ ] TBD (run /gsd-plan-phase 8 to break down)

### Phase 9: Management Dashboard (PROJ-40) — exec-facing /management page with fixed scenario, three time-period views (Month / Rolling 365d / Full year), KPI tiles, YoY grouped bars, and avg QH-price explainer panel that reconciles headline savings via spread × kWh × sessions audit trail

**Goal:** Ship an exec-facing `/management` dashboard (password-gated, fixed scenario) that surfaces four KPI tiles, a YoY grouped bar chart, and an avg-QH-price explainer panel which reconciles headline savings via `spread × energy-per-session × sessions` within 1%. Scenario overrides persist to localStorage via a shadcn Sheet drawer. Monthly aggregates precomputed from `public/data/smard-prices-qh.json` and served as static JSON, refreshed daily by the existing GitHub Actions SMARD workflow.

**Requirements**: MGMT-01, MGMT-02, MGMT-03, MGMT-04, MGMT-05, MGMT-06, MGMT-07, MGMT-08, MGMT-09, MGMT-10
**Depends on:** Phase 8
**Plans:** 4 plans

Plans:
- [x] 09-01-PLAN.md — Data foundations: types, pure helpers, precompute script, initial JSON, CI workflow step
- [x] 09-02-PLAN.md — KpiTile + YoyBarChart presentational components
- [x] 09-03-PLAN.md — ExplainerPanel + SettingsDrawer (shadcn Sheet) + localStorage persistence
- [ ] 09-04-PLAN.md — /management page wiring, middleware password gate, empty-state, smoke test

---
*Last updated: 2026-04-18 — Phase 9 plans created (4 plans, 3 waves)*
