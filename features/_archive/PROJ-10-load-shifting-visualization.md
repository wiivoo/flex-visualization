# PROJ-10: Baseline vs. Load Shifting Visualization

## Status: In Progress
## Created: 2026-02-22
## Dependencies: PROJ-2 (Optimization Algorithm), PROJ-9 (Multi-Source Price Data)

## Description

Central business case visualization: Shows management a direct comparison between "dumb" charging (baseline) and optimized load shifting. The core question is answered visually: "What does charging cost without control vs. with intelligent control?"

## Concept

**Baseline** = Vehicle charges immediately on arrival (window_start), chronologically until full → typically expensive (evening peak 18-22h)

**Load Shifting** = Charging is shifted to the cheapest hours → typically cheap (off-peak night 00-06h)

## User Stories

1. As a CEO, I want to see at a glance how much money load shifting saves
2. As a CFO, I want to see the monthly/yearly total savings
3. As a sales rep, I want to show a customer: "This is what your savings look like"

## Acceptance Criteria

### Day View
- [ ] Price curve as background with two overlay areas:
  - Red bars: When "dumb" charging would occur (baseline)
  - Green bars: When optimized charging takes place
- [ ] Text annotation: "Laden verschoben: 18:00 → 02:00"
- [ ] Cost comparison: Baseline X EUR vs. Optimized Y EUR + savings badge

### Monthly/Yearly View
- [ ] Daily bars: Baseline costs (red) vs. optimized (green)
- [ ] Cumulative savings line over the time period
- [ ] KPI cards: Total saved, avg. savings/day, days analyzed, kWh shifted

### Batch Optimization
- [ ] Server-side batch endpoint for multi-day optimization
- [ ] Per day, both baseline + optimized are calculated and aggregated
- [ ] Results are cached for fast repeat access

## Technical Details

### New Endpoint
```
POST /api/optimize/batch
Body: { startDate, endDate, vehicle, config, dso? }
Response: { daily_results: [...], totals: { total_savings, avg_per_day, ... } }
```

### Files
| File | Action |
|------|--------|
| `src/lib/optimizer.ts` | NEW - Extracted optimization logic |
| `src/app/api/optimize/batch/route.ts` | NEW - Batch endpoint |
| `src/components/dashboard/LoadShiftingComparison.tsx` | NEW - Main component |
| `src/app/api/optimize/route.ts` | EDIT - Add baseline |
| `src/lib/config.ts` | EDIT - baseline_schedule type |
| `src/app/page.tsx` | EDIT - Integration |

## QA Test Results

**Tested:** 2026-02-22
**App URL:** http://localhost:3000
**Tester:** QA Engineer (AI)
**Build Status:** Production build succeeds without errors

### Acceptance Criteria Status

#### Day View

##### AC-1: Price curve as background with red baseline bars and green optimized bars
- [x] PASS -- `LoadShiftingComparison.tsx` renders `ComposedChart` with:
  - Blue price line (`dataKey="price"`, `yAxisId="price"`)
  - Red baseline bars (`dataKey="baseline"`, gradient fill)
  - Green optimized bars (`dataKey="optimized"`, gradient fill)
- [x] PASS -- Bars use `Cell` components to hide null values (transparent fill)
- [x] PASS -- Dual Y-axes: left for ct/kWh (price), right for kWh (charging)

##### AC-2: Text annotation "Laden verschoben: 18:00 -> 02:00"
- [x] PASS -- `shiftLabel` computed from baseline vs. optimized schedule start/end
- [x] PASS -- Rendered as blue badge with ArrowRight icon: "Laden verschoben: {shiftLabel}"
- [x] PASS -- Hidden when baseline and optimized start at same time

##### AC-3: Cost comparison: Baseline X EUR vs. Optimized Y EUR + savings badge
- [x] PASS -- Horizontal bar chart shows baseline (red) vs. optimized (green) with EUR labels
- [x] PASS -- Bars scale proportionally to max cost
- [x] PASS -- Green savings badge shows "Ersparnis: X.XX EUR" with PiggyBank icon

#### Monthly/Yearly View

##### AC-4: Daily bars: Baseline costs (red) vs. optimized (green)
- [x] PASS -- Multi-day view renders `ComposedChart` with red and green Bar components
- [x] PASS -- X-axis shows date labels formatted "d. MMM" in German locale

##### AC-5: Cumulative savings line over the time period
- [x] PASS -- Blue line (`dataKey="cumSavings"`) plotted on secondary Y-axis
- [x] PASS -- Cumulative calculation correct: running sum of daily savings

##### AC-6: KPI cards: Total saved, avg. savings/day, days analyzed, kWh shifted
- [x] PASS -- 4 KPI cards in 2x2 / 4x1 responsive grid:
  - "Gesamt gespart" (green)
  - "Durchschnitt Ersparnis/Tag" (blue)
  - "Tage analysiert" (gray)
  - "Gesamt verschoben" in kWh (purple)

#### Batch Optimization

##### AC-7: Server-side batch endpoint for multi-day optimization
- [x] PASS -- `POST /api/optimize/batch` endpoint exists at `src/app/api/optimize/batch/route.ts`
- [x] PASS -- Zod schema validates all inputs with descriptive German error messages
- [x] PASS -- Limit of 365 days enforced

##### AC-8: Per day, both baseline + optimized are calculated and aggregated
- [x] PASS -- Iterates over days, calls `runOptimization()` per day
- [x] PASS -- Baseline cost derived from `baseline_avg_price * energy_charged_kwh`
- [x] PASS -- Daily results include `cost_baseline_eur`, `cost_optimized_eur`, `savings_eur`

##### AC-9: Results are cached for fast repeat access
- [ ] FAIL -- Batch optimization results themselves are NOT cached
- [x] PASS -- However, the underlying price data is cached via `price-cache.ts`

### Edge Cases Tested

#### EC-1: No optimization data available (day view)
- [x] PASS -- Shows "Keine Optimierungsdaten verfügbar. Bitte Konfiguration prüfen."

#### EC-2: No batch data for multi-day view
- [x] PASS -- Shows "Keine Batch-Daten verfügbar für diesen Zeitraum."

#### EC-3: Batch API call fails silently
- [x] PASS -- `catch {}` in fetchBatch sets batchResults to null, component shows empty state

#### EC-4: Baseline and optimized overlap (no shift possible)
- [x] PASS -- `shiftLabel` returns null when `baselineStart === optStart`, no shift indicator shown

#### EC-5: Batch endpoint accessible without authentication
- [x] NOTE -- `/api/optimize` is in PUBLIC_PATHS, so `/api/optimize/batch` is also public (middleware matches prefix)

### Security Audit

#### SEC-1: Batch optimize endpoint DoS vector
- **Finding:** The batch optimize endpoint calls `/api/prices/batch` internally (self-referencing HTTP call) for up to 365 days of data, which can be slow and resource-intensive
- **Severity:** Medium
- **Location:** `src/app/api/optimize/batch/route.ts` line 62-82 (`fetchPricesForRange`)
- **Impact:** A single unauthenticated POST request can trigger heavy server-side work (365 days x price fetching + optimization)
- **Recommendation:** Either require auth for batch endpoints or add rate limiting

#### SEC-2: Self-referencing HTTP call in batch endpoint
- **Finding:** `fetchPricesForRange` constructs a URL from `NEXT_PUBLIC_APP_URL` or `VERCEL_URL` and makes an HTTP call to itself. This is fragile and could fail in certain deployment configs.
- **Severity:** Low
- **Impact:** May fail if env vars not set correctly; also doubles the request load
- **Recommendation:** Import price-fetching logic directly instead of calling own API

### Bugs Found

#### BUG-1: Batch Optimization Results Not Cached
- **Severity:** Medium
- **Description:** The batch optimization endpoint recomputes all daily optimizations on every request. Only the underlying price data is cached.
- **Location:** `src/app/api/optimize/batch/route.ts`
- **Impact:** Slow responses for large date ranges; unnecessary computation on repeated requests
- **Steps to Reproduce:** Call POST `/api/optimize/batch` with same date range twice -- both execute full optimization
- **Recommendation:** Cache batch results in Supabase keyed by (startDate, endDate, vehicle, config hash)
- **Priority:** Medium

#### BUG-2: Batch Optimize Endpoint is Unauthenticated
- **Severity:** High
- **Description:** The middleware PUBLIC_PATHS includes `/api/optimize` which matches `/api/optimize/batch` via `startsWith`. The batch endpoint is accessible without login, allowing anyone to trigger expensive server-side computation.
- **Location:** `src/middleware.ts` line 4: `const PUBLIC_PATHS = ['/login', '/api/auth', '/api/prices', '/api/optimize']`
- **Impact:** Unauthenticated users can trigger heavy batch optimizations, potential abuse
- **Steps to Reproduce:** `curl -X POST http://localhost:3000/api/optimize/batch -H "Content-Type: application/json" -d '...'` without session cookie -- returns 200
- **Recommendation:** Change PUBLIC_PATHS to use exact matching or exclude batch: either remove `/api/optimize` from public paths, or use exact path matching instead of `startsWith`
- **Priority:** HIGH -- Fix before production deployment

#### BUG-3: Self-Referencing HTTP Call in Batch Endpoint
- **Severity:** Low
- **Description:** `fetchPricesForRange` in batch/route.ts makes an HTTP request to its own server (`localhost:3000/api/prices/batch`). This is fragile and adds unnecessary network overhead.
- **Location:** `src/app/api/optimize/batch/route.ts` lines 61-82
- **Impact:** May fail in certain deployments; doubles request processing
- **Recommendation:** Import and call the price-fetching logic directly
- **Priority:** Low (works in current setup)

### Responsive Testing
- [x] Desktop (1440px): Charts render full-width with clear labels
- [x] Tablet (768px): KPI grid responsive (2x2 layout)
- [x] Mobile (375px): Charts use ResponsiveContainer, KPIs stack to 2-col grid

### Summary
- **Acceptance Criteria:** 8.5/9 passed (1 partial: batch results not cached)
- **Edge Cases:** 5/5 handled
- **Bugs Found:** 3 total (0 critical, 1 high, 1 medium, 1 low)
- **Security:** 1 high-priority issue (unauthenticated batch endpoint)
- **Production Ready:** NO -- Fix BUG-2 (unauthenticated batch endpoint) before deployment
