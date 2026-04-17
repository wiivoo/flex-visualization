---
phase: 08-plug-in-battery-business-case-de-nl
plan: 02
subsystem: battery-config
tags: [types, config, constants, battery]
requires: []
provides:
  - BatteryVariant (interface)
  - BatteryScenario (interface)
  - Tariff (interface)
  - BATTERY_VARIANTS (const BatteryVariant[])
  - DEFAULT_BATTERY_SCENARIO (const BatteryScenario)
  - DE_TARIFFS (const Tariff[])
  - NL_TARIFFS (const Tariff[])
  - HourlyPrice (re-export from v2-config)
  - getVariant / getTariff / getTariffsFor (helper functions)
affects:
  - src/lib/battery-config.ts (created)
tech_stack_added: []
patterns:
  - Mirror of src/lib/v2-config.ts typing and organization
  - Re-export of shared types to prevent duplicate type drift
key_files_created:
  - src/lib/battery-config.ts
key_files_modified: []
decisions:
  - Re-export HourlyPrice from v2-config rather than redefining (single source of truth)
  - Keep file as pure TypeScript — no React imports, no 'use client' directive
  - Variant feedInCapKw baseline is 0.8 (DE default); the 2000W scenario lives on BatteryScenario.feedInCapKw
metrics:
  duration_seconds: 92
  tasks_completed: 1
  files_created: 1
  files_modified: 0
  completed_date: 2026-04-17
---

# Phase 08 Plan 02: Battery Config Types Summary

Shipped `src/lib/battery-config.ts` — the shared type surface and locked constants (three product variants, DE/NL tariff lists, default scenario) that downstream Wave 2+ plans compile against.

## Final Export List

Matches `<interfaces>` block of the plan verbatim.

| Export | Kind | Notes |
|--------|------|-------|
| `HourlyPrice` | type (re-export) | Re-exported from `@/lib/v2-config` — not redefined |
| `BatteryVariant` | interface | id union, physical specs, economics, regulation flags |
| `BatteryScenario` | interface | URL-synced scenario state (variantId, country, tariffId, annualLoadKwh, feedInCapKw, terugleverCostEur, exportCompensationPct, selectedDate, nlRegime) |
| `Tariff` | interface | Supplier id/label/country/monthlyFeeEur/exportCompensationDefaultPct |
| `BATTERY_VARIANTS` | const | Three variants (schuko-2kwh, balcony-pv-1.6kwh, wall-5kwh) with locked specs and prices |
| `DEFAULT_BATTERY_SCENARIO` | const | schuko-2kwh / DE / awattar-de / 2500 kWh / 800W / post2027 |
| `DE_TARIFFS` | const | Tibber DE, aWATTar, Rabot Charge, Octopus DE |
| `NL_TARIFFS` | const | Frank Energie, ANWB Energie, Tibber NL, Zonneplan |
| `getVariant(id)` | function | Throws on unknown id |
| `getTariffsFor(country)` | function | Returns DE_TARIFFS or NL_TARIFFS |
| `getTariff(id, country)` | function | Returns undefined if not found |

## Locked Values (match CONTEXT.md)

- Variant A (schuko-2kwh) — Marstek Venus B, 2.0 kWh, €595 incl. 19% VAT, LOW confidence
- Variant B (balcony-pv-1.6kwh) — Anker SOLIX Solarbank 2 E1600 Pro, 1.52 kWh + 800 Wp PV, €1,499 at 0% VAT, HIGH confidence
- Variant C (wall-5kwh) — Marstek Venus E 3.0, 4.6 kWh usable (90% DoD of 5.12 kWh), €1,570 incl. 19% VAT, electrician required, MEDIUM confidence
- Round-trip efficiency: 0.88 (HTW Berlin Stromspeicher-Inspektion conservative default)
- DE feed-in cap baseline: 0.8 kW (scenario toggle for 2.0 kW lives on BatteryScenario.feedInCapKw)

## Verification

- `npx tsc --noEmit -p .` returns exit code **0** (no new type errors).
- All 21 grep acceptance checks from the plan pass.
- File length: **175 lines** (plan required ≥ 140).
- No `'use client'` directive, no React imports — pure tree-shakeable TypeScript library.
- `HourlyPrice` re-exported from `@/lib/v2-config` via `import type { HourlyPrice } from '@/lib/v2-config'` + `export type { HourlyPrice }`.

## Commits

| Task | Description | Commit |
|------|-------------|--------|
| 1 | Create src/lib/battery-config.ts with variants, tariffs, scenario defaults | `c68f236` |

## Deviations from Plan

None — plan executed exactly as written. All locked values, identifiers, and file organization match the plan's `<action>` block verbatim.

## Authentication Gates

None — pure code change, no external services touched.

## Known Stubs

None — this plan ships the type contract that downstream plans will consume. All values are concrete constants, not placeholders. `nlRegime: 'post2027'` is intentionally a single-value union (future-proofed for a pre-2027 toggle that is explicitly out of scope for Phase 8).

## Self-Check: PASSED

- File `src/lib/battery-config.ts` exists — FOUND.
- Commit `c68f236` present in git log — FOUND.
- `npx tsc --noEmit -p .` exit 0 — FOUND.
- All 21 grep checks pass — FOUND.
