# PROJ-40 — Management Dashboard

**Status:** Planned
**Owner:** Lars
**Created:** 2026-04-18
**Route:** `/management`

## Purpose

A standalone, read-optimized dashboard at `/management` for executives and management stakeholders. Answers one question at a glance: **what is load-shifting worth right now, and how has that changed?** Fixed scenario (not configurable per user like `/v2`) so the headline number is comparable across months, years, and audiences.

## Scope

- New Next.js App Router page at `/management` (behind the same `DASHBOARD_PASSWORD` gate as `/v2`)
- Three time-period views in one page: **Month**, **Rolling 365 days**, **Full year**
- Hero row of KPI tiles (4 tiles) with Δ vs. prior period and sparkline
- Month-on-month change panel: grouped bar chart (YoY — 2025 vs 2026) with Δ% labels per month
- Explainer panel: average QH price profile for the selected month with baseline/optimized windows shaded, annotated to reconcile with the headline savings number (audit trail)
- Light settings drawer (battery kWh, charge kW, plug-in/departure, sessions/week) persisted to `localStorage` only — **not** URL
- Precomputed monthly aggregates written to `public/data/management-monthly.json` by the existing `.github/workflows/update-smard-data.yml` workflow

## Audience & Design Principles

- **Audience:** internal execs, investor-facing demos, fleet partners.
- **Fixed scenario:** the displayed "load-shifting value" uses a locked default scenario so the number is comparable month-to-month. Light settings adjust assumptions only locally (localStorage), they do not change the shareable view.
- **Audit trail:** every headline number must be traceable in the explainer panel: `spread × kWh/session × sessions ≡ headline € savings`. If a viewer asks "why that number?" the answer is on the same page.
- **Visual-first:** no wizard, no tabs, no stepper. Everything visible on one scroll.

## Page Layout

```
┌──────────────────────────────────────────────────────────────┐
│  Time period: [ Month ▾ April 2026 ]  [ Rolling 365d ] [ Year ▾ 2026 ]   [ settings ⚙ ] │
├──────────────────────────────────────────────────────────────┤
│  ┌────────────┐ ┌────────────┐ ┌────────────┐ ┌────────────┐ │
│  │ Savings €  │ │ Avg spread │ │ Sessions   │ │ Δ vs prior │ │
│  │  ╱╲     42 │ │  ╱╲   7.1  │ │  ╱╲   124  │ │  ╱╲  +18%  │ │
│  └────────────┘ └────────────┘ └────────────┘ └────────────┘ │
├──────────────────────────────────────────────────────────────┤
│  Month-on-month change (YoY)                                  │
│  ▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇ ▇▇                       │
│  J  F  M  A  M  J  J  A  S  O  N  D   (2025 vs 2026)         │
├──────────────────────────────────────────────────────────────┤
│  Why this number? — April 2026 average QH price profile      │
│  [line chart 00:00..24:00, avg ct/kWh per QH slot]           │
│   baseline window (18:00→dep) shaded red                     │
│   optimized window shaded green                              │
│   avg baseline = 28.4  avg optimized = 21.3  spread = 7.1     │
│   spread × 11 kWh × 124 sessions ≈ 97 € (matches headline)   │
└──────────────────────────────────────────────────────────────┘
```

## Time-Period Views

All three views share the same four KPIs and the same explainer template. Only the aggregation window differs:

| View | Window | Prior period (for Δ) |
|------|--------|----------------------|
| Month | Calendar month | Previous calendar month |
| Rolling 365d | Last 365 days from today | Prior 365-day window |
| Full year | Calendar year | Prior calendar year |

Month selector offers the trailing ~24 months where SMARD data exists. Year selector offers all full years in the dataset (2023, 2024, 2025, 2026…).

## KPI Tiles (4)

| Tile | Primary number | Sparkline | Δ |
|------|---------------|-----------|---|
| Total savings € | Sum of €/session × sessions in window | Daily savings trend | vs prior period |
| Avg spread ct/kWh | `avg(baseline_window_price) − avg(optimized_window_price)` | Daily spread trend | vs prior period |
| Sessions counted | Plug-in days × configured sessions/day | Weekly count | vs prior period |
| Δ vs prior period | % change of total savings | Bar mini-chart | absolute € delta inline |

Sparkline: `<svg>` path, ~60×20px, no axes, single stroke. No Recharts for the sparkline (too heavy for a tile — match `/v2` pattern of inline SVG where possible).

## Month-on-Month Change Panel

- **Chart:** Recharts `ComposedChart` with two `Bar` series (grouped, not stacked)
- **Series:** `savings_2025` (muted gray), `savings_2026` (brand red `#EA1C0A`)
- **X axis:** Jan…Dec
- **Y axis:** € savings
- **Labels:** Δ% above each 2026 bar vs its 2025 counterpart, green for positive, red for negative
- **Empty handling:** bars render transparent for months without data (e.g. future months in current year)

Design rationale (locked): grouped bars read faster than YoY line overlay for non-technical audiences and handle sparse future months cleanly.

## Explainer Panel (Audit Trail)

For the currently selected **month** (even when Rolling 365d or Full year is the active KPI view, the explainer always shows one representative month — default to the selected month if Month view is active, else current month):

1. Compute the **average QH price profile** across the selected month: for each of the 96 QH slots of the day, average across every day in the month.
2. Render as a Recharts `LineChart` (or `ComposedChart` with `Area` gradient).
3. Shade the baseline window red: 18:00 → configured departure time. Use `ReferenceArea` from Recharts.
4. Shade the optimized window green: the N cheapest contiguous slots needed to fill `energy_per_session / charge_power` hours inside the plug-in window.
5. Annotate three numbers beside the chart:
   - `avg baseline = X.X ct/kWh`
   - `avg optimized = Y.Y ct/kWh`
   - `spread = Z.Z ct/kWh`
6. Footer caption: `spread × kWh/session × sessions = € headline` — shown as an equation with live values, must numerically match the Total-savings KPI tile within rounding tolerance. Discrepancy > 1% is a bug.

### Energy-per-QH Intuition (mandatory tooltip copy)

Non-technical viewers have to understand why a QH price matters in €. The explainer must expose the identity:

```
energy_per_QH_slot = power × 0.25 h
```

Worked examples to render inline (hover tooltip on the shaded bands, or a small "how to read this" caption under the chart):

| Power | Energy per 15-min slot | Slots to fill a session |
|-------|------------------------|-------------------------|
| 0.8 kW (800 W) | 0.2 kWh | e.g. 10 kWh → 50 slots (12.5 h) |
| 3.7 kW | 0.925 kWh | 10 kWh → ≈11 slots (2.75 h) |
| 7 kW | 1.75 kWh | 10 kWh → ≈6 slots (1.5 h) |
| 11 kW | 2.75 kWh | 10 kWh → ≈4 slots (1 h) |
| 22 kW | 5.5 kWh | 10 kWh → 2 slots (0.5 h) |

This is the bridge between **price (ct/kWh per QH slot)** and **€ savings (per session)**: each QH slot in the green/red band contributes `ct/kWh × power × 0.25h` to the session cost. The reconciliation equation in point 6 is therefore:

```
Σ(price_optimized_slot × power × 0.25) − Σ(price_baseline_slot × power × 0.25)
  = avg_spread × energy_per_session
  × sessions_in_month
  = headline €
```

Render the first line as a small subscript under the headline to make the derivation auditable.

## Settings Drawer (Light)

Accessed via a settings gear in the time-period row. A shadcn `Dialog` or right-side `Sheet` (install if missing — note that `sheet` is not in the current kept list of 6 primitives).

| Setting | Default | Range |
|---------|---------|-------|
| Battery kWh | 60 | 20–100 |
| Charge power kW | 7 | 3.7–22 |
| Plug-in time | 18:00 | 16:00–22:00 |
| Departure time | 07:00 | 05:00–09:00 |
| Sessions/week | 4 | 1–14 |

Persisted to `localStorage` key `management-dashboard-settings-v1`. **Not** synced to URL — the management view is intentionally non-shareable (each viewer sees the same fixed scenario numbers unless they tweak locally).

Reset-to-defaults button in drawer.

## Data Flow

```
public/data/management-monthly.json
  └── { months: [{ year, month, savings_eur, avg_spread_ct_kwh,
                   sessions, avg_baseline_price_ct_kwh,
                   avg_optimized_price_ct_kwh,
                   avg_qh_profile: number[96] }] }

/management page
  ├── reads JSON at build time via fetch('/data/management-monthly.json')
  ├── applies localStorage settings to recompute sessions × kWh only
  │   (avg prices are fixed; they come from real market data)
  └── renders KPIs, YoY bars, explainer
```

## Precompute Script (GitHub Actions)

Extend `.github/workflows/update-smard-data.yml` (or add a sibling step) to run a new script (out of scope for this spec — tracked as implementation work):

- Reads `public/data/smard-prices-qh.json`
- For every complete calendar month in the dataset:
  - Computes `avg_qh_profile[96]` by averaging prices at each QH slot across all days of that month
  - Applies the fixed scenario to compute `avg_baseline_price_ct_kwh` (avg across 18:00→07:00 for every day), `avg_optimized_price_ct_kwh` (cheapest N-slot window per day, averaged), `savings_eur` per session
  - Aggregates `sessions`, `savings_eur` for the month
- Writes `public/data/management-monthly.json`

Runs on the same daily schedule as SMARD updates (13:30 UTC).

## Stack Constraints (Must)

- Next.js 16 App Router page at `src/app/management/page.tsx`
- Client component (`'use client'` first line) — same convention as `/v2`
- Recharts for bar chart + line chart
- Tailwind CSS + `tabular-nums` on all numeric displays
- shadcn/ui primitives only for buttons/cards/dialog — if `sheet` or `select` needed, install via `npx shadcn@latest add <name> --yes` (per `.claude/rules/frontend.md`)
- Path alias `@/` for all imports
- Brand red `#EA1C0A` for active state / 2026 series / accent
- `emerald-*` = optimized/savings, `red-*` = baseline/unmanaged (match `/v2` convention)

## Out of Scope

- Implementation (this spec is docs-only; code work is a separate planned phase)
- The precompute script itself (listed above as a stub, tracked separately)
- Multi-country support (DE only for v1; NL parity is a follow-up)
- User accounts, roles, or per-user saved views
- PDF / CSV / PNG export of the dashboard
- Embedding in external sites or public unauthenticated access
- Historical backfill UI for months where SMARD data is missing

## Files (Planned)

| File | Purpose |
|------|---------|
| `src/app/management/page.tsx` | Main page, Suspense wrapper, settings drawer |
| `src/components/management/KpiTile.tsx` | Single KPI tile with sparkline and Δ |
| `src/components/management/YoyBarChart.tsx` | Month-on-month grouped bar chart (YoY) |
| `src/components/management/ExplainerPanel.tsx` | Average QH profile + shaded windows + reconciliation equation |
| `src/components/management/SettingsDrawer.tsx` | Light settings dialog/sheet, localStorage persistence |
| `src/lib/management-config.ts` | Types, fixed-scenario defaults, localStorage key constant |
| `src/lib/management-helpers.ts` | Pure aggregation + reconciliation math (no JSX) |
| `public/data/management-monthly.json` | Precomputed monthly aggregates |
| `scripts/precompute-management-monthly.mjs` | Precompute script run by GitHub Actions |

## Requirements

| ID | Requirement |
|----|-------------|
| MGMT-01 | `/management` route exists, password-gated, renders three time-period toggles |
| MGMT-02 | Four KPI tiles render with sparkline and Δ vs prior period |
| MGMT-03 | YoY grouped-bar chart shows 2025 vs 2026 (or selected year vs prior), with Δ% labels |
| MGMT-04 | Explainer panel renders avg QH price profile for the selected month |
| MGMT-05 | Baseline window (18:00→departure) shaded red; optimized window shaded green |
| MGMT-06 | Reconciliation equation below explainer matches headline Total-savings tile within 1% |
| MGMT-07 | Settings drawer persists to `localStorage`, reset-to-defaults works |
| MGMT-08 | Page renders without JS crash when `public/data/management-monthly.json` is missing or empty (graceful fallback) |
| MGMT-09 | Desktop layout at 1440px is the primary target; no mobile optimization required in v1 |
| MGMT-10 | Precompute script writes `public/data/management-monthly.json` on the existing GitHub Actions schedule |

## Related

- `/v2` main dashboard — audience inversion: `/v2` is configurable/B2C, `/management` is fixed/exec
- PROJ-20 Monthly Savings Chart — same underlying math; `/management` aggregates further and re-presents
- PROJ-32 Daily Savings Heatmap — sibling aggregation view, daily granularity
- `.github/workflows/update-smard-data.yml` — precompute host
