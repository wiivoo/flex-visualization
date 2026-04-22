# PROJ-28: Two-Column Layout & UX Refresh

## Status: Deployed
**Backfilled:** 2026-04-21

## Summary

Backfilled feature spec for the layout refresh that reshaped the main `/v2` experience into a clearer two-column composition: scenario controls and supporting context in one column, chart-led analysis in the other.

This spec exists to close the inventory gap in `features/INDEX.md`. It is intentionally bounded and documents the deployed surface at a high level rather than reconstructing every intermediate design decision.

## Scope

- Two-column dashboard composition on `/v2`
- Stronger visual separation between controls, KPIs, and the core chart area
- Supporting navigation/date-selection affordances tied into the refreshed layout

## Current Runtime Notes

- The main implementation lives in `src/components/v2/steps/Step2ChargingScenario.tsx`
- `src/components/v2/DateStrip.tsx` is part of the supporting interaction layer called out by the original inventory entry
- This refresh is already reflected in the deployed dashboard; this file only documents it

## Out of Scope

- Re-documenting all child features that already have dedicated specs
- Reconstructing historical design iterations
- Any visual redesign work beyond the currently shipped `/v2` experience

## Related

- PROJ-12 - Interactive Price Chart
- PROJ-17 - Customer Profile Configurator
- PROJ-18 - Mini Calendar (Date Picker)
- PROJ-22 - Savings Potential Box
