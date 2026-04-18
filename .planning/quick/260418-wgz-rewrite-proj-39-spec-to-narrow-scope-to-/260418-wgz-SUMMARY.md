---
quick_id: 260418-wgz
slug: rewrite-proj-39-spec-to-narrow-scope-to-
date: 2026-04-18
status: complete
scope: docs-only
---

# Quick Task 260418-wgz — Summary

## Outcome

Rewrote PROJ-39 spec to narrow scope to a single plug-and-play battery variant, and corrected the DE/NL regulation section based on focused web research.

## Key Changes to PROJ-39

### Scope narrowing

- **One variant only:** Marstek Venus B (2 kWh Schuko, 800 W mode)
- **Removed:** Anker SOLIX Solarbank E1600 Pro (PV bundle), Marstek Venus E 3.0 (wall-mount, electrician)
- **Removed value stream:** balcony PV self-consumption (target is explicitly apartments without PV)
- **Target audience:** apartment dwellers without PV, dynamic tariff (Tibber, aWATTar, Frank Energie, ANWB)

### Regulation correction (per research)

User's original belief: "both DE and NL allow 800 W plug-in feed-in without registration."

Corrected position:
- **DE:** 800 VA cap is codified in VDE-AR-N 4105:**2026-03** via new Form F.1.2. No grid-operator approval, but MaStR (Marktstammdatenregister) self-registration **is required**.
- **NL:** 800 W is *not* a NL statute — derives from EU RfG 2016/631 Art. 5 + EN 50549-1 + NVWA safety guidance. Registration via **energieleveren.nl is mandatory** per Netbeheer Nederland. Legal status called "grey area" in trade sources. No grid-operator approval needed for plug-in ≤ 800 W.
- Spec now says "self-registration required in both countries, but no grid-operator approval."

### Out-of-scope code flagged (NOT deleted in this task)

Listed in spec's "Flagged out of scope" section for later cleanup:
- `src/components/battery/BatteryVariantPicker.tsx`
- `src/components/battery/ManagementView.tsx` (audit dependency on multi-variant)
- `public/data/pvgis-de-south-800w.json`, `pvgis-nl-south-800w.json`
- PV self-consumption branches in `battery-optimizer.ts` and `battery-economics.ts`
- `scripts/precompute-battery-profiles.mjs` — PV precompute steps to trim

## Files Created

- `.planning/quick/260418-wgz-rewrite-proj-39-spec-to-narrow-scope-to-/260418-wgz-PLAN.md`
- `.planning/quick/260418-wgz-rewrite-proj-39-spec-to-narrow-scope-to-/260418-wgz-RESEARCH.md` (from research agent)
- `.planning/quick/260418-wgz-rewrite-proj-39-spec-to-narrow-scope-to-/260418-wgz-SUMMARY.md`

## Files Edited

- `features/PROJ-39-plug-in-battery-business-case.md` — full rewrite
- `.planning/STATE.md` — quick task row + last_activity

## Out of Scope (for this quick task)

- No source code (`src/`) touched
- No data files (`public/data/`) touched
- No `.planning/phases/08-*` plan files edited — they need reconciliation against the narrowed scope in a follow-up
- No Vercel deployment (docs-only; no UI impact)

## Next Step

If the user wants to act on the scope narrowing:
1. Create a new phase (or quick task) to clean up the flagged out-of-scope files in `src/` and `public/data/`
2. Reconcile `.planning/phases/08-plug-in-battery-business-case-de-nl/08-*-PLAN.md` against the new spec
3. Update `UI-SPEC.md` for the single-variant UI
