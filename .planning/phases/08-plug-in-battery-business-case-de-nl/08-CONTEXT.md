# Phase 8: Plug-in Battery Business Case (DE/NL) - Context

**Gathered:** 2026-04-17
**Status:** Ready for planning
**Source:** Derived from /gsd-explore session + /gsd-research-phase findings — see `.planning/notes/plug-in-battery-exploration.md` and `08-RESEARCH.md`.

<domain>
## Phase Boundary

Ship a new v2-style sub-page that shows the business case for a plug-in home battery in Germany and the Netherlands (post-2027 regime), covering three product variants with a split layout: consumer ROI calculator on top, management/investor view below.

**In scope:**
- New dashboard sub-page (route TBD during planning — suggested `/battery`)
- Three battery product variants as modeled options:
  1. Plug-in battery (Schuko Steckerspeicher) — pure arbitrage, no PV
  2. Plug-in battery + balcony PV — arbitrage + PV self-consumption
  3. Simple wall-mounted battery requiring electrician commissioning — still apartment-compatible
- Two value streams: dynamic tariff arbitrage + balcony PV self-consumption
- Germany (current 2026 regime) and Netherlands (post-2027 regime only)
- Regulation modeled as first-class parameters

**Out of scope:**
- V2G or EV-as-battery (that's Phase 1)
- C&I batteries or fleet-scale storage
- Backup power / resilience value stream
- Marketing landing-page framing — this is data-dense analytical UI
- Grid export arbitrage in DE mode (VDE-AR-N 4105:2026-03 forbids it — RESEARCH.md §2)

</domain>

<decisions>
## Implementation Decisions

### Locked (from exploration + research)

**Product variants — model exactly these three:**
- Variant A: Marstek Venus B (~2 kWh, Schuko plug-in, €499 placeholder until verified)
- Variant B: Anker SOLIX Solarbank 2 E1600 Pro (800W PV + 1.52 kWh, €1,199, no electrician)
- Variant C: Marstek Venus E 3.0 (5.12 kWh wall-mount, €1,319 sale / €1,999 list, electrician commissioning legally required)

**Audience & layout — split single page:**
- Top: Consumer ROI calculator (v2-style tangible € figures — annual savings, payback period, break-even year per variant)
- Bottom: Management / investor view (unit economics per household, DE vs NL market comparison, strategic framing)

**Value streams — model exactly these two:**
- Dynamic tariff arbitrage (SMARD DE, ENTSO-E NL)
- Balcony PV self-consumption (PVGIS south-facing profile, 800W array for variants with PV)

**Regulation — first-class parameters, not decoration:**
- DE: 800W feed-in cap (with toggle to 2000W transition scenario for sensitivity)
- DE: VDE-AR-N 4105:2026-03 prohibits battery export to grid → optimizer enforces `gridExportKwh = 0` in DE mode (self-consumption arbitrage only)
- DE: §14a EnWG Module 3 DOES NOT apply (products ≤ 2.5 kW, below 4.2 kW threshold)
- DE: 0% VAT applies only to PV-bundled systems; standalone batteries carry 19% VAT
- NL: post-2027 regime only — salderingsregeling ends 2027-01-01, minimum 50% compensation through 2030, energy tax NOT refunded on exports
- NL: terugleverkosten modeled per supplier (default: Frank Energie-style no-fee profile)

**Technical constraints — first-class model parameters:**
- 800W feed-in cap (DE baseline, 2000W toggle)
- Household consumption profile: apartment baseline — use BDEW H0 (DE) and NEDU E1a (NL) as source profiles, shipped as precomputed static JSON in `public/data/`
- Battery specs per variant: usable kWh, max charge/discharge kW (C-rate), round-trip efficiency (default 88% AC-to-AC per HTW Berlin Stromspeicher-Inspektion), standby loss
- Balcony PV generation profile: PVGIS output for south-facing 800W array, Berlin (DE) + Rotterdam (NL), daily hourly shape, shipped as static JSON

**Architectural pattern — mirror /v2 exactly:**
- Client component under `src/app/` (e.g. `src/app/battery/page.tsx`)
- Shared optimizer lib (`src/lib/battery-optimizer.ts`) — greedy three-pass schedule consistent with existing V2G pattern in `charging-helpers.ts`
- Reuse `src/lib/use-prices.ts` unchanged for DE/NL price fetching
- shadcn/ui primitives only
- Recharts ComposedChart for intra-day visualization (price + SoC + load/PV curves)
- URL ↔ state sync for scenario params (variant, country, tariff, DSO/supplier)
- Desktop-first (1440px), mobile secondary
- TypeScript, strict mode, `@/*` path alias

**No new npm packages:** greedy TS optimizer is sufficient; everything else (Recharts, shadcn, Tailwind, Next.js) already installed.

### Claude's Discretion

- Exact route name for the new sub-page (suggested `/battery`, final at planning time)
- File naming within `src/components/v{X}/` — mirror `v2/` structure; may be `src/components/battery/` or `src/components/v3/` — planner decides
- Optimizer algorithm internals (greedy three-pass documented in RESEARCH.md is the blueprint; planner finalizes data structures)
- Visual hierarchy within the split layout — top vs bottom dividers, transitions
- Which Recharts series ordering best communicates the story (layering of price curve, SoC, load, PV)
- Copy and micro-labels — match the sober, data-dense tone of /v2

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Phase 8 artifacts
- `.planning/phases/08-plug-in-battery-business-case-de-nl/08-RESEARCH.md` — Standard Stack, Architecture Patterns, Don't Hand-Roll list, Common Pitfalls, Code Examples, sourced regulation and product data
- `.planning/notes/plug-in-battery-exploration.md` — original scope decisions from exploration session
- `.planning/research/questions.md` — research questions dated 2026-04-17 (now resolved by RESEARCH.md)

### Codebase patterns to mirror
- `src/app/v2/page.tsx` — page layout pattern
- `src/lib/optimizer.ts` — optimizer structure (but battery optimizer has different logic)
- `src/lib/charging-helpers.ts` — `computeV2gWindowSavings` is the closest analog for the new greedy three-pass battery optimizer
- `src/lib/use-prices.ts` — price fetching hook (reuse unchanged)
- `src/lib/v2-config.ts` — types/constants pattern
- `src/lib/grid-fees.ts` — regulation modeling pattern (DE DSO tariffs)
- `src/components/v2/SessionCostCard.tsx` — "baseline vs optimized" card pattern
- `src/components/v2/MonthlySavingsCard.tsx` — annual aggregation pattern

### Data assets
- `public/data/smard-prices.json`, `smard-prices-qh.json`, `smard-meta.json` — DE day-ahead prices
- `public/data/e1a-profile-2025.json`, `e1a-profile-relative.json` — NL NEDU E1a load profile (already present)
- NEW: `public/data/bdew-h0-profile.json` — DE BDEW H0 apartment load profile (to be generated from BDEW specification)
- NEW: `public/data/pvgis-balcony-de.json`, `pvgis-balcony-nl.json` — 800W south-facing balcony PV profiles for Berlin and Rotterdam (to be precomputed via PVGIS API in a Wave 0 script)

### Project conventions
- `CLAUDE.md` (repo root) — client/server component rules, shadcn-first, Tailwind-only, feature tracking
- `.claude/rules/general.md`, `frontend.md`, `security.md` — supplementary rules

</canonical_refs>

<specifics>
## Specific Ideas

- Three product variants have sourced specs in RESEARCH.md — use those numbers as defaults; expose them as user-editable parameters.
- Round-trip efficiency default 88% (conservative, consistent with HTW Berlin benchmark range 85-91%).
- Consumer ROI section must show at minimum: annual savings €, payback period (years), break-even year, NPV over 10 years.
- Management view must show at minimum: DE vs NL unit economics per household, addressable market sizing qualitatively, revenue-stream breakdown per variant.
- Regulation toggles that MUST be user-changeable: DE 800W ↔ 2000W cap, NL supplier terugleverkosten structure, NL minimum export compensation %.
- Sensitivity hook: because /v2 has an Insights tab with sensitivity analysis (Phase 7), Phase 8 should follow the same pattern — design the optimizer and state so that a sensitivity/sweep can be layered in later without refactor.

</specifics>

<deferred>
## Deferred Ideas

- Sensitivity/sweep view (bin-daily heatmap analog) — deferred to a follow-up phase, but optimizer interface must not foreclose it.
- V2G / EV battery integration — not this phase.
- C&I battery scaling — not this phase.
- Backup / resilience value stream — explicitly dropped.
- NL current-regime (pre-2027) modeling — explicitly out of scope.
- Grid export arbitrage in DE mode — legally prohibited, must not be implemented.
- Battery degradation / cycle-life modeling over payback period — deferred unless a quick win emerges during planning.

</deferred>

---

*Phase: 08-plug-in-battery-business-case-de-nl*
*Context gathered: 2026-04-17 via /gsd-explore + /gsd-research-phase (no discuss-phase — exploration already captured locked decisions)*
