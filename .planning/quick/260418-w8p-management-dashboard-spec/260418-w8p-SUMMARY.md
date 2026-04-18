---
quick_id: 260418-w8p
slug: management-dashboard-spec
date: 2026-04-18
status: complete
scope: docs-only
---

# Quick Task 260418-w8p — Summary

## Outcome

Wrote a docs-only feature spec (PROJ-40) for a new `/management` dashboard page. No source code touched.

## Files Created

- `features/PROJ-40-management-dashboard.md` — full spec
- `.planning/quick/260418-w8p-management-dashboard-spec/260418-w8p-PLAN.md`
- `.planning/quick/260418-w8p-management-dashboard-spec/260418-w8p-SUMMARY.md`

## Files Edited

- `features/INDEX.md` — added PROJ-40 row, bumped next ID to PROJ-41
- `.planning/STATE.md` — quick task row + last_activity

## Key Design Decisions Captured in Spec

- Fixed scenario (not per-user configurable) so the headline € is comparable across months
- Three views: Month, Rolling 365d, Full year — same KPI shape, different aggregation window
- YoY grouped bars (not line overlay) — reads faster for non-technical audiences
- Explainer panel reconciles headline € to avg QH prices via `spread × energy_per_session × sessions`
- Energy-per-QH intuition (power × 0.25h) rendered inline — bridges ct/kWh price to € savings
- Settings drawer persists to `localStorage` only, not URL — management view is intentionally non-shareable
- Precompute `public/data/management-monthly.json` via existing GitHub Actions workflow

## Out of Scope (for this quick task)

- Any implementation / `.tsx` / `.ts` / script files
- Any CI/workflow changes
- NL parity — DE-only for v1

## Next Step

Create a planned phase (or follow-up quick task) to implement the page per this spec.
