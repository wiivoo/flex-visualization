---
quick_id: 260418-wgz
slug: rewrite-proj-39-spec-to-narrow-scope-to-
date: 2026-04-18
scope: docs-only
---

# Quick Task 260418-wgz — Rewrite PROJ-39 Spec

## Description

Narrow PROJ-39 scope to a **single plug-and-play battery variant** (Marstek Venus B) for apartments without PV. Drop balcony PV, drop variant selection, drop non-plug-and-play variants. Correct the DE/NL regulation section per research findings (neither country allows "without registration" — both require national-registry self-registration; DE legal basis is VDE-AR-N 4105:2026-03 Form F.1.2, NL legal basis is informal and "grey area" per trade sources).

## Tasks

### T1. Rewrite `features/PROJ-39-plug-in-battery-business-case.md`

Keep the filename (already in INDEX.md), rewrite contents:

- Scope → one variant only (Marstek Venus B 2 kWh Schuko), target audience = apartments without PV
- Product Variants → remove Anker SOLIX Solarbank and Marstek Venus E 3.0 sections
- Value Streams → pure dynamic-tariff arbitrage only (drop balcony PV self-consumption)
- Regulation section → correct per RESEARCH.md:
  - DE: 800 VA cap, VDE-AR-N 4105:2026-03 Form F.1.2, **MaStR self-registration required**, no grid-operator approval
  - NL: 800 W de-facto cap (no NL statute — derives from EU RfG 2016/631 + EN 50549-1 + NVWA safety guidance), **energieleveren.nl registration required** per Netbeheer Nederland, described by trade sources as a "grey area"
  - Both countries: no grid-operator approval needed for ≤ 800 W devices; Marstek Venus B must be configured to 800 W output mode
- Out of Scope → add: multi-variant comparison, PV bundle economics, balcony PV self-consumption, wall-mount/electrician-required installs
- Files → flag which existing files become out-of-scope for cleanup later (but do not delete):
  - `src/components/battery/BatteryVariantPicker.tsx`
  - `public/data/pvgis-de-south-800w.json`
  - `public/data/pvgis-nl-south-800w.json`
  - `public/data/bdew-h0-profile.json` (only if used for PV bundle logic)
  - `public/data/nedu-e1a-normalized.json` (only if used for PV bundle logic)
  - PV-related logic in `src/lib/battery-optimizer.ts` / `src/lib/battery-economics.ts`
- Reference the research file at `.planning/quick/260418-wgz-.../260418-wgz-RESEARCH.md` under Related

## Out of Scope (for this task)

- Deleting code
- Editing `src/` or `public/data/` files
- Updating `.planning/phases/08-*` plan files (will be a separate follow-up if the user wants)
- Editing `features/INDEX.md` (PROJ-39 row stays as-is)

## Definition of Done

- `features/PROJ-39-plug-in-battery-business-case.md` reflects narrowed scope
- Regulation section cites VDE-AR-N 4105:2026-03 and Netbeheer Nederland energieleveren.nl
- Research file preserved in quick task directory
- STATE.md records the quick task with commit hash
- No source code or data files touched
