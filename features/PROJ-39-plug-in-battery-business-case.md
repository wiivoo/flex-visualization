# PROJ-39 — Plug-in Battery Business Case (DE/NL)

## Status: In Progress
**Owner:** Lars
**Phase:** 8
**Created:** 2026-04-17
**Scope narrowed:** 2026-04-18 (see quick task [260418-wgz](../.planning/quick/260418-wgz-rewrite-proj-39-spec-to-narrow-scope-to-/))

## Scope

`/battery` sub-page that models the economics of a **single, plug-and-play home battery** for **apartment dwellers without PV**, in Germany (current 2026 regime) and the Netherlands (post-2027 regime). One fixed product, one value stream: dynamic-tariff arbitrage via Schuko plug.

## Target Product (single variant)

**Marstek Venus B** — 2 kWh LFP plug-in battery with Schuko plug. Configurable output (800 W / 1500 W); this project assumes **800 W mode** because that is the inflection point for simplified regulatory treatment in both DE and NL. Max charge power 1.5 kW. No PV input.

Per pv-magazine (2026-03-17) and Marstek EU product page.

## Target Audience

- Apartment dwellers without access to roof/balcony PV
- Renters and owners in dynamic-tariff markets (Tibber, aWATTar DE; Tibber, Frank Energie, ANWB NL)
- Users who want a set-and-forget plug-in device with no electrician, no permits beyond self-registration

## Value Stream (single)

- **Dynamic-tariff arbitrage** — charge during cheap QH slots (SMARD DE, ENTSO-E NL), discharge during expensive QH slots. Self-consumption against the household load profile only; no grid export arbitrage (legally restricted in DE; economically capped in NL).

## Regulation (corrected 2026-04-18 per research)

Both countries permit a ≤ 800 W plug-in battery **without grid-operator approval**, but **both require self-registration in a national registry**. "Without registration" is incorrect for either country — the distinction is that no *Netzbetreiber* / *netbeheerder* approval step is required.

### Germany

- **Legal basis:** VDE-AR-N 4105:**2026-03** (effective 2026-03-01) explicitly adds plug-in battery storage *without* PV via new Form **F.1.2**. This is the first formal grid-code recognition of battery-only Steckerspeicher.
- **Feed-in cap:** 800 VA at the inverter nameplate
- **Storage capacity cap:** not limited
- **Registration:** **MaStR (Marktstammdatenregister)** self-registration, Form F.1.2, within 1 month of commissioning
- **Grid-operator approval:** not required (Netzbetreiber-Meldung was abolished by Solarpaket I in 2024; MaStR remains mandatory)
- **Installation:** layperson Schuko plug-in permitted
- **VAT:** 19 % on standalone battery (no 0 % PV bundle exemption since no PV)
- **Backfeed to grid:** VDE-AR-N 4105:2026-03 permits up to 800 VA feed-in; however, this project's optimizer enforces **self-consumption only** to avoid edge cases around metering direction and the evolving §14a interactions

Sources: VDE-AR-N 4105:2026-03 summary (photovoltaik.sh), DKE/VDE product-standard press release, Verbraucherzentrale MaStR guidance, Solarpaket I 2024.

### Netherlands

- **Legal basis:** **informal / "grey area"** per trade sources. No NL statute caps plug-in battery feed-in at 800 W. The 800 W figure derives from:
  1. EU Regulation 2016/631 Article 5 (RfG) "non-significant" generator threshold
  2. EN 50549-1 Type A installation threshold
  3. NVWA (Dutch consumer safety authority) guidance on max discharge to a shared circuit
- **Feed-in cap (de-facto):** 800 W (device self-limit, not a statute)
- **Registration:** **mandatory** via [energieleveren.nl](https://www.energieleveren.nl) per Netbeheer Nederland / RVO guidance (threshold 0.8 kW)
- **Grid-operator approval:** not required for plug-in ≤ 800 W (larger installs need *teruglever-toestemming*)
- **Installation:** layperson Schuko plug-in de-facto tolerated; NEN 1010 binds only certified installers
- **Legal clarity:** described as "grey area" by Dutch trade sources; no binding ACM ruling
- **Salderingsregeling:** ended **2027-01-01**; net metering no longer applies. Minimum 50 % export compensation through 2030 per the Energiewet. Terugleverkosten (feed-in fees) are supplier-specific and configurable in the model.

Sources: Netbeheer Nederland ("Meld thuisbatterijen"), IOTDomotica trade analysis, Zonneplan regulation page, Chambers Renewable Energy 2025 NL, Marstek.nl distributor.

## Key Regulatory Assumptions in the Model

- DE optimizer enforces self-consumption only (no grid export) for conservatism
- NL optimizer respects configurable terugleverkosten and the post-2027 salderingsregeling end
- Both countries' models assume 800 W output mode on the Marstek Venus B (the user must configure the device to match)
- Neither model attempts grid export arbitrage — economically and legally marginal for a 2 kWh device

## Out of Scope

- **Multi-variant comparison** (removed 2026-04-18 — was Anker SOLIX Solarbank E1600 Pro and Marstek Venus E 3.0)
- **Balcony PV value stream** (removed 2026-04-18 — target audience is explicitly apartments without PV)
- **PV bundle VAT (0 %)** — only applies to PV-integrated devices, out of scope here
- **Wall-mount / electrician-required installations** (Marstek Venus E 3.0 removed)
- V2G / EV-as-battery (Phase 1 / PROJ-29)
- C&I / fleet-scale batteries
- Backup / resilience value stream
- NL current-regime (pre-2027) modeling — already scoped out
- Grid export arbitrage in DE (legally restricted for battery storage)
- Multi-battery or series/parallel stacking

## Files

### In scope (single-variant model)

- `src/app/battery/page.tsx` — main page (retain, simplify to single variant)
- `src/components/battery/BatteryIntroCard.tsx` — retain
- `src/components/battery/BatteryDayChart.tsx` — retain
- `src/components/battery/BatteryRoiCard.tsx` — retain (single-variant ROI)
- `src/components/battery/BatteryCycleKpiStrip.tsx` — retain
- `src/components/battery/RegulationPanel.tsx` — retain (update copy per corrected regulation)
- `src/lib/battery-config.ts` — retain, trim to single variant + 800 W mode default
- `src/lib/battery-optimizer.ts` — retain, remove PV self-consumption branch
- `src/lib/battery-economics.ts` — retain, remove PV revenue / 0 % VAT branches

### Flagged out of scope (for later cleanup, DO NOT delete in this quick task)

- `src/components/battery/BatteryVariantPicker.tsx` — no longer needed (single variant)
- `src/components/battery/ManagementView.tsx` — review: keep only if still useful as a single-variant investor summary; delete if it depends on multi-variant comparison
- `public/data/pvgis-de-south-800w.json` — PV irradiance data, no longer needed
- `public/data/pvgis-nl-south-800w.json` — PV irradiance data, no longer needed
- `public/data/bdew-h0-profile.json` — keep only if used for the base household load profile (not specifically PV); verify before deleting
- `public/data/nedu-e1a-normalized.json` — keep only if used for NL household load profile (not specifically PV); verify before deleting
- `scripts/precompute-battery-profiles.mjs` — audit and trim PV precompute steps
- PV-related branches in `src/lib/battery-optimizer.ts` and `src/lib/battery-economics.ts` — remove self-consumption-from-PV logic; keep arbitrage logic

Cleanup will be handled by a follow-up phase (or a follow-up quick task), not as part of this scope-narrowing task.

## Requirements

BATT-01..BATT-11 — see `.planning/REQUIREMENTS.md` — to be audited and possibly renumbered against the narrowed scope. Anything referencing PV self-consumption, variant selection, or multiple products is superseded by this spec.

## Related

- **Regulation research:** `.planning/quick/260418-wgz-rewrite-proj-39-spec-to-narrow-scope-to-/260418-wgz-RESEARCH.md` — DE/NL 800 W feed-in, registration obligations, Marstek Venus B legality
- **Phase 8 plans:** `.planning/phases/08-plug-in-battery-business-case-de-nl/08-*-PLAN.md` — need reconciliation against narrowed scope
- **Phase 8 research:** `.planning/phases/08-plug-in-battery-business-case-de-nl/08-RESEARCH.md`
- **UI contract:** `.planning/phases/08-plug-in-battery-business-case-de-nl/08-UI-SPEC.md` — needs update for single-variant UI
- **Quick task (scope narrowing):** `.planning/quick/260418-wgz-rewrite-proj-39-spec-to-narrow-scope-to-/`
