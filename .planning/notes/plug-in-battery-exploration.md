---
title: Plug-in home battery business case — exploration decisions
date: 2026-04-17
context: Output of /gsd-explore session. Anchors scope for the upcoming "Plug-in Battery Business Case (DE/NL)" phase so downstream research and planning don't drift.
---

# Plug-in home battery business case (DE/NL) — exploration decisions

Output of an exploration session. Captures the scope decisions made before research/planning, so the phase can be scoped without re-litigating.

## Product scope — what "plug-in battery" means here

Three apartment-installable home-battery variants, all simple enough for a non-expert consumer to consider:

1. **Plug-in battery (Schuko Steckerspeicher)** — pure battery, plugs into a household socket. No PV required. Pure dynamic-tariff arbitrage use case.
2. **Plug-in battery + balcony PV** — Steckerspeicher combined with a Balkonkraftwerk (e.g. Anker SOLIX Solarbank, Zendure SolarFlow, Marstek). Both arbitrage and PV self-consumption.
3. **Simple / cheap wall-mounted battery requiring an electrician** — still apartment-friendly (no subpanel work, single-phase), but not plug-and-play. Include **only if a product category actually exists** at a price point that makes sense for flats — research needs to confirm.

## Audience & deliverable

Single sub-page, v2-style, but **split layout**:

- **Top — Consumer ROI tool:** "Is a plug-in battery worth buying for my flat?" Tangible € figures like /v2 — annual savings, payback period vs hardware cost, break-even year.
- **Bottom — Management / investor view:** TAM, unit economics per household, revenue streams, DE vs NL market comparison. Strategic framing.

## Geography + regulation

Both DE and NL. Regulation is a **first-class input**, not decoration — changes the battery economics materially.

- **Germany:** Current regime (2026) — 0% VAT on PV+battery, 800W balcony cap (with ongoing push to 2000W), VDE-AR-N 4105, §14a EnWG Module 3 grid fees, dynamic tariffs mandated for suppliers.
- **Netherlands:** **Post-2027 only** — model the regime *after* salderingsregeling is fully phased out. This is when home batteries become materially attractive in NL. Include terugleverkosten and dynamic tariff pricing from this period.

## Value streams to model

1. **Dynamic tariff arbitrage** — charge battery at cheap hours, discharge at peak. Same price engine as /v2 (SMARD DE, ENTSO-E NL).
2. **Balcony PV self-consumption** — store excess daytime solar, use in the evening. Requires a PV generation profile on top of prices.

Backup/resilience was considered and dropped as a value stream — non-financial, not the focus.

## Technical constraints — model these as first-class parameters

- **800W feed-in cap** (DE, likely rising to 2000W in 2026/27) — throttles both PV injection and battery discharge back to grid. Shapes optimizer decisions.
- **Household consumption profile** — baseline load (fridge, standby, lighting) + evening peak. Without this, battery discharge value is undefined. Analogous to how /v2 needs a charging schedule input.
- **Battery specs:**
  - Usable capacity (kWh)
  - Max charge power / max discharge power (kW, i.e. effective C-rate)
  - Charge and discharge duration implications (how long to fill/empty)
  - Round-trip efficiency (typically 85-92% for small consumer batteries)
  - Standby / parasitic losses

All three of these constraints compound — a 2 kWh battery at 800W feed-in cap and 90% RTE has a very different arbitrage ceiling than the nameplate suggests.

## "Like /v2" means what, architecturally

Mirror /v2's patterns:

- Client component page under `src/app/vX/page.tsx` (number TBD)
- Shared lib for optimizer logic (analogue of `src/lib/optimizer.ts`) — but optimizing battery charge/discharge schedule, not EV charging
- Reuse `use-prices.ts` for DE/NL price fetching
- shadcn/ui primitives only; data-dense, desktop-first
- URL ↔ state sync for scenario params (battery capacity, load profile, tariff, country)
- Recharts ComposedChart for intra-day visualization (price curve + battery SoC curve + load/PV curves)

## Open unknowns (→ research questions)

- Battery product landscape in DE/NL 2026: capacity, power, RTE, price points
- Exact DE Steckerspeicher regulatory status — 800W→2000W timeline, VDE rules
- NL post-2027 regime specifics — terugleverkosten structure, dynamic-tariff landscape, grid fees for small consumers

## What this is NOT

- Not a V2G/EV battery extension (that's Phase 1)
- Not a C&I battery sizing tool
- Not a backup-power / resilience calculator
- Not a marketing landing page — data-dense analytical view
