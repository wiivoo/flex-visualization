# PROJ-39 — Plug-in Battery Business Case (DE/NL)

**Status:** In Progress
**Owner:** Lars
**Phase:** 8
**Created:** 2026-04-17

## Scope

New /battery sub-page that models the business case for plug-in home batteries in Germany (current 2026 regime) and the Netherlands (post-2027 regime). Covers three product variants with a split layout: consumer ROI calculator on top, management/investor view below.

## Product Variants

1. **Marstek Venus B** — 2 kWh Schuko plug-in, no PV, 19% VAT. Pure dynamic-tariff arbitrage.
2. **Anker SOLIX Solarbank 2 E1600 Pro** — 800 Wp PV + 1.52 kWh battery, 0% VAT (PV bundle). Arbitrage + PV self-consumption.
3. **Marstek Venus E 3.0** — 5.12 kWh wall-mount, electrician-required commissioning, 19% VAT. Larger-capacity arbitrage.

## Value Streams

- Dynamic tariff arbitrage (SMARD DE, ENTSO-E NL)
- Balcony PV self-consumption (PVGIS south-facing 800W array)

## Key Regulation Modeled

- **DE:** 800W feed-in cap (with 2000W sensitivity toggle). VDE-AR-N 4105:2026-03 prohibits battery-to-grid export → optimizer enforces self-consumption only. 19% VAT on standalone, 0% on PV bundles.
- **NL:** Post-2027 regime only (salderingsregeling ended 2027-01-01). Minimum 50% export compensation through 2030. Configurable terugleverkosten.

## Out of Scope

- V2G / EV-as-battery (Phase 1 / PROJ-29)
- C&I / fleet-scale batteries
- Backup / resilience value stream
- NL current-regime (pre-2027) modeling
- Grid export arbitrage in DE (legally prohibited)

## Files

- `src/app/battery/page.tsx` — main page
- `src/components/battery/*` — BatteryVariantPicker, BatteryDayChart, BatteryRoiCard, RegulationPanel, ManagementView
- `src/lib/battery-config.ts` — types, variants, defaults
- `src/lib/battery-optimizer.ts` — greedy three-pass optimizer
- `public/data/bdew-h0-profile.json`, `nedu-e1a-normalized.json`, `pvgis-de-south-800w.json`, `pvgis-nl-south-800w.json`
- `scripts/precompute-battery-profiles.mjs`

## Requirements

BATT-01..BATT-11 — see `.planning/REQUIREMENTS.md`.

## Related

- Phase 8 plans: `.planning/phases/08-plug-in-battery-business-case-de-nl/08-*-PLAN.md`
- Research: `.planning/phases/08-plug-in-battery-business-case-de-nl/08-RESEARCH.md`
- UI contract: `.planning/phases/08-plug-in-battery-business-case-de-nl/08-UI-SPEC.md`
