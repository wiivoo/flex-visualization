# Phase 8: Plug-in Battery Business Case (DE/NL) — Research

**Researched:** 2026-04-17
**Domain:** Home battery economics, DE/NL regulation, battery optimizer architecture
**Confidence:** MEDIUM (product specs HIGH; regulatory details MEDIUM; NL post-2027 specifics LOW-MEDIUM)

---

## Summary

Phase 8 builds a new v2-style sub-page for plug-in home battery ROI analysis covering three product variants in Germany and the Netherlands. The research covers three domains: (1) the actual 2026 product landscape with sourced specs and prices, (2) the current DE Steckerspeicher regulatory regime, and (3) the NL post-2027 regime following salderingsregeling abolition.

The product landscape has matured rapidly. By 2026 there are several well-defined product tiers: Schuko plug-in batteries under 2 kWh (pure arbitrage), all-in-one balcony systems with integrated inverter and 1.6–5 kWh storage (Anker, EcoFlow, Zendure), and larger wall-mounted AC-coupled batteries requiring electrician commissioning (Marstek Venus E 3.0, Zendure SolarFlow 2400 AC). The "simple flat-friendly electrician install" category does exist — the Marstek Venus E 3.0 is the canonical example: single-phase 230V, no subpanel work, but commissioning by a certified electrician is legally required.

DE regulation is clarified: 800W feed-in cap remains in force as of 2026-04 (the 2000W increase is not yet enacted); VDE-AR-N 4105:2026-03 now covers standalone Steckerspeicher; battery discharge back to the grid for arbitrage is explicitly **not permitted** under the plug-in regime — only self-consumption via the internal inverter counts; the 0% VAT (Nullsteuersatz) requires the battery to be connected to eligible PV modules. NL post-2027: salderingsregeling ends definitively on 2027-01-01; minimum compensation is 50% of net supply tariff until 2030; dynamic tariffs are the value-enabling mechanism; time-dependent network tariffs are coming from 2028.

**Primary recommendation:** Mirror the /v2 architecture exactly. Build a greedy hourly battery optimizer (charge/discharge decision per slot given SoC, load, PV, price) as a new `src/lib/battery-optimizer.ts`. Run it client-side — 24×96 slot optimization is trivially fast in TS. Reuse `use-prices.ts` unchanged. Precompute BDEW H0 and NEDU E1a load profiles as normalized static JSON arrays (96 QH per day × 365 days). Precompute PVGIS hourly PV yield curves for representative DE and NL locations as static JSON. No external solver library needed or exists in TS.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Price data (DE/NL hourly/QH) | API / Backend | Static JSON | Reuse existing use-prices.ts and /api/prices/batch |
| Battery optimizer | Browser / Client | — | Pure TS, no server needed; 24h optimization completes < 5 ms |
| Load profile (BDEW H0 / NEDU E1a) | Static JSON | Browser | Pre-normalized, ship as public/data/*.json |
| PV generation profile (PVGIS) | Static JSON | Browser | Pre-computed per location, ship as public/data/*.json |
| Consumer ROI calculator | Browser / Client | — | All inputs known client-side after price load |
| Management / investor view | Browser / Client | — | Aggregation of per-household unit economics |
| Feed-in cap logic | Browser / Client | — | Pure parameter in optimizer, no server logic needed |
| URL ↔ state sync | Frontend Server (SSR) | Browser | Mirror v2/page.tsx pattern |

---

## Standard Stack

### Core — reuse existing, no new installs required

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Next.js (App Router) | ^16.1.1 | Page, API routes | Already in project |
| React | ^19.0.0 | UI | Already in project |
| TypeScript | ^5 | Type safety | Already in project |
| Recharts | ^3.7.0 | ComposedChart for intra-day viz | Already in project; ComposedChart handles price + SoC + load + PV overlays |
| shadcn/ui (card, button, input, label, tooltip) | existing | UI primitives | Already in project |
| Tailwind CSS | ^3.4.1 | Styling | Already in project |
| use-prices.ts | internal | DE/NL price fetching | Reuse verbatim |

### Supporting — no new npm packages needed

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| lucide-react | ^0.562.0 | Icons | Already in project |
| sonner | ^2.0.7 | Toast notifications | Already in project |

**No new npm packages are required.** All computation runs in TypeScript. No MILP solver library exists for TS that is worth the bundle size — the greedy algorithm described below is sufficient and matches industry practice for consumer-grade battery optimization at 24h horizon.

**Version verification:** All packages are existing project dependencies — no install needed.

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Greedy TS optimizer | linopy/pyomo (Python MILP) | Python requires server-side execution, breaks client-only architecture; overkill for single-battery, 24h, 96-slot problem |
| Static JSON load/PV profiles | Live pvlib-python API | Static JSON is zero-latency, reproducible, sufficient for this use case |
| New page route `/v3` | Extend `/v2` | Separate page is cleaner; v2 is EV-focused, battery is a different product |

---

## Architecture Patterns

### System Architecture Diagram

```
User browser
    │
    ├── src/app/battery/page.tsx (new route, mirrors v2/page.tsx)
    │       ├── usePrices('DE' | 'NL')          ← reuse verbatim
    │       ├── useBatteryScenario()             ← new hook, URL↔state
    │       └── [React state: scenario, country]
    │
    ├── Static JSON (precomputed, shipped in public/data/)
    │       ├── bdew-h0-profile.json             ← 96 QH slots, normalized to 1kWh/year
    │       ├── nedu-e1a-profile.json            ← same format, NL profile
    │       ├── pvgis-de-south-800w.json         ← hourly PV kWh for DE (Frankfurt)
    │       └── pvgis-nl-south-800w.json         ← hourly PV kWh for NL (Rotterdam)
    │
    ├── src/lib/battery-optimizer.ts (new)
    │       runBatteryDay(prices[], pvGen[], load[], params) → DayResult
    │       runBatteryYear(prices[], pvGen[], load[], params) → YearResult
    │
    ├── src/lib/battery-config.ts (new)
    │       BATTERY_VARIANTS[], DEFAULT_BATTERY_SCENARIO
    │
    └── src/components/battery/ (new)
            ├── BatteryDayChart.tsx              ← ComposedChart: price + SoC + load + PV
            ├── BatteryRoiCard.tsx               ← payback period, break-even year
            ├── BatteryVariantPicker.tsx         ← 3 product variants
            └── ManagementView.tsx               ← unit economics, DE vs NL TAM
```

### Recommended Project Structure

```
src/
├── app/battery/page.tsx         # New page (mirrors v2/page.tsx pattern)
├── components/battery/          # Battery-specific components
├── lib/battery-optimizer.ts     # Pure computation: daily + annual optimization
├── lib/battery-config.ts        # Types, constants, battery presets
public/data/
├── bdew-h0-profile.json         # BDEW H0 normalized load profile (96 slots × 365 days)
├── nedu-e1a-profile.json        # NEDU E1a normalized load profile
├── pvgis-de-south-800w.json     # PVGIS hourly DE PV generation (Frankfurt, south, 30°)
└── pvgis-nl-south-800w.json     # PVGIS hourly NL PV generation (Rotterdam, south, 30°)
scripts/
└── precompute-battery-profiles.mjs  # One-time script to fetch PVGIS + BDEW data
```

### Pattern 1: Battery Day Optimizer (Greedy SoC-Constrained)

**What:** For each 15-min slot, decide to charge, discharge, or idle the battery given current SoC, available PV, household load, and electricity price. Greedy optimization: if price < threshold → charge from grid; if price > threshold → discharge to load; PV surplus → charge battery first.

**When to use:** Single battery, 24h horizon, 96 slots. O(n log n) sort is sufficient. DP is unnecessary overhead for this problem size.

**Example:**

```typescript
// src/lib/battery-optimizer.ts
export interface BatteryParams {
  usableKwh: number          // usable capacity after DoD limit
  maxChargeKw: number        // max charge power (AC-side)
  maxDischargeKw: number     // max discharge power (AC-side)
  roundTripEff: number       // 0.85–0.93 (AC-to-AC, not just battery RTE)
  standbyWatts: number       // parasitic loss while idle
  feedInCapKw: number        // DE: 0.8kW | NL: uncapped for battery
}

export interface SlotResult {
  hour: number
  minute: number
  actionKw: number           // + = charge, - = discharge, 0 = idle
  socKwhStart: number
  socKwhEnd: number
  gridKwh: number            // net grid consumption this slot (positive = import)
  pvSelfKwh: number          // PV directly consumed this slot
  battChargeFromPvKwh: number
  battChargeFromGridKwh: number
  battDischargeKwh: number
  priceCtKwh: number
  slotCostEur: number        // negative = savings vs no-battery baseline
}

export function runBatteryDay(
  prices: HourlyPrice[],        // 96 QH slots for the day (from use-prices.ts)
  pvGenKwh: number[],           // 96-slot PV generation (from pvgis profile, scaled to system W)
  loadKwh: number[],            // 96-slot household load (from BDEW/NEDU profile, scaled to annual kWh)
  params: BatteryParams,
  startSocKwh: number = 0,
): { slots: SlotResult[]; summary: DaySummary }
```

**Algorithm (three-pass greedy):**
1. Pass 1 — PV self-consumption: for each slot, use PV directly first; if PV > load, send surplus to battery (up to charge limit and SoC cap).
2. Pass 2 — Arbitrage: rank remaining slots by price. Identify cheap charge slots and expensive discharge slots. Assign charge/discharge pairs greedily, respecting SoC bounds at each step.
3. Pass 3 — SoC continuity check: walk slots chronologically, correct any SoC violations from pass 2 reassignments.

This mirrors the existing `computeV2gWindowSavings` pattern in `charging-helpers.ts`.

### Pattern 2: Reuse use-prices.ts Unchanged

```typescript
// In battery/page.tsx — reuse the existing hook directly
const prices = usePrices(country)  // 'DE' | 'NL' — no changes needed
// prices.hourlyQH gives 96 QH slots per day — pass directly to runBatteryDay()
```

### Pattern 3: Normalized Load Profile JSON

Pre-normalize the BDEW H0 profile to 1 kWh total annual consumption. At runtime, scale by actual household kWh/year:

```typescript
// Precomputed: bdew-h0-profile.json — array of 8760 hourly values summing to 1.0
// Usage:
const loadKwhPerYear = 3000  // user input
const scaledHourly = bdewH0.map(frac => frac * loadKwhPerYear)
```

### Anti-Patterns to Avoid

- **Using a Python MILP solver (linopy, pyomo):** No TS equivalent exists worth the complexity. The greedy three-pass algorithm is sufficient and matches the V2g optimizer pattern already in the codebase.
- **Running the optimizer server-side:** No API route needed. The computation takes < 5 ms in the browser for a 96-slot day.
- **Fetching PVGIS live:** PVGIS API has rate limits and CORS issues. Precompute and ship as static JSON.
- **Hand-rolling load profiles:** BDEW H0 and NEDU E1a are freely available normalized datasets. Use them directly.
- **Modeling battery arbitrage export to the grid for DE:** Explicitly illegal under the plug-in regime. The optimizer must model self-consumption only for DE (battery discharge to load, not to grid).
- **Applying 0% VAT to standalone batteries without PV:** Only qualifies if the battery is functionally connected to eligible PV modules.

---

## Research Topic 1: Product Landscape & Unit Economics (DE/NL 2026)

### Three Product Variants — Sourced Specs

#### Variant 1: Pure Schuko Steckerspeicher (2 kWh, no PV)

**Canonical product: Marstek Venus B**
[VERIFIED: ess-news.com/2026/03/17]

| Spec | Value |
|------|-------|
| Usable capacity | 2.0 kWh (90% DoD of 2.22 kWh nominal) |
| Max charge power | 1.5 kW (AC-side) |
| Max discharge power | 0.8 kW (grid feed-in capped) / 1.5 kW (self-consumption) |
| Round-trip efficiency | 88% (stated) |
| Cycle life | 6,000 cycles at 80% residual capacity |
| Battery chemistry | LFP |
| Installation | Schuko plug, no electrician |
| IP rating | IP65 |
| Price (DE) | Not confirmed in sources — estimate ~€400–600 based on Venus A at €499 |
| Warranty | Not confirmed in this source |

**Note:** Marstek Venus A (another Schuko variant) is priced at €499. The Venus B 2 kWh is a March 2026 launch; retail price not confirmed in research. [LOW confidence on price]

#### Variant 2: Balcony PV + Battery (integrated system, ~1.6 kWh, with 800W PV)

**Canonical product: Anker SOLIX Solarbank 2 E1600 Pro**
[VERIFIED: notebookcheck.net review, anker.com/eu-en]

| Spec | Value |
|------|-------|
| Usable capacity | 1.52 kWh (of 1.6 kWh nominal) |
| Max charge power (AC/MPPT) | 2.0 kW (MPPT up to 2.4 kW) |
| Max discharge power | 1.0 kW (AC output) |
| Round-trip efficiency | Not published by Anker; HTW-tested small systems avg ~85–90% |
| Cycle life | 6,000 cycles (LFP) |
| Battery chemistry | LFP |
| Expandable | Yes, up to 9.6 kWh with expansion batteries |
| Feed-in cap compliance | Hardware-limited to 800 VA per VDE-AR-N 4105 |
| Installation | Plug-in (Schuko or Wieland depending on config) |
| Price (DE) | €1,199 (base unit) |
| Warranty | 10 years |

**Alternative: Zendure SolarFlow Hyper 2000** [VERIFIED: zendure.com product page]
- Base config: €959 (1× Hyper + 1× AB2000X = 1.92 kWh usable), expandable to 7.68 kWh
- Max AC discharge: 1.2 kW bidirectional
- 10-year warranty, 15-year product life
- Up to 93% round-trip efficiency (per SolarFlow 2400 AC spec; Hyper 2000 not confirmed)
- Plug-and-play design; VDE-AR-N 4105 certified

**Typical 800W balcony PV + 1.6 kWh battery bundle cost: €1,200–€1,500 all-in.** [MEDIUM confidence based on Anker Solarbank 2 Pro at €1,199 plus ~€300 for 2× 400W panels]

#### Variant 3: Simple Electrician-Installed Flat-Friendly Battery (5 kWh)

**Canonical product: Marstek Venus E 3.0**
[VERIFIED: marstek.de/en-eu/products/venus-e-3]

| Spec | Value |
|------|-------|
| Nominal capacity | 5.12 kWh |
| Usable capacity | ~4.6 kWh (90% DoD) |
| Max charge power | 2.5 kW (AC input) |
| Max discharge power | 2.5 kW (0.8 kW default, 2.5 kW with premium setting) |
| Round-trip efficiency | >93.5% (stated); real-world testing: ~82.5% [MEDIUM — one source] |
| Cycle life | >6,000 cycles at 80% capacity |
| Battery chemistry | LFP |
| Installation | 230V Euro 16A (Schuko-compatible), but **electrician commissioning legally required** |
| Price (DE) | €1,319 (sale) / €1,999 (list) |
| Warranty | 10 years |
| Expandable | Yes, up to 15.36 kWh (3 units) |
| P1 smart meter | Native integration |

**NL price context:** Marstek Venus E 3.0 actively sold in NL through multiple retailers. NL price approximately €1,299–€1,499 (including P1 meter adapter). [MEDIUM confidence — based on patrickphang.nl comparison]

**Key finding on the "electrician" category:** The Marstek Venus E 3.0 uses a standard 230V Schuko outlet **but legally requires electrician commissioning** in Germany. This is the "flat-friendly but needs an electrician" product the exploration notes anticipated — it exists as a real category.

### Load Profile Data Sources

**Germany — BDEW H0 Profile:**
[VERIFIED: flrd.github.io/standardlastprofile, demandlib.readthedocs.io]
- Official standard household profile published by BDEW
- Updated 2025 version available (monthly granularity, vs old 3-season grouping)
- 96 QH per day, normalized to 1,000 kWh/year
- Daily shape: morning peak ~07:00–09:00, evening peak ~18:00–21:00
- Available via R package `standardlastprofile` or directly from bdew.de/energie/standardlastprofile-strom/
- German apartment (2-person): ~2,200–3,000 kWh/year [VERIFIED: multiple German statistical sources]

**Netherlands — NEDU E1a Profile:**
[VERIFIED: mffbas.nl, energiedatawijzer.nl]
- Standard consumption profile for kleinverbruikers (≤3×25A, no switching tariff)
- Published annually by MFFBAS on behalf of NEDU
- 2025 profiles published July 3, 2024
- Available from energiedatawijzer.nl/onderwerpen/profielen/standaardprofielen/
- Format: 96 QH slots per day, per month/season

**Precomputation approach for the app:** Write a one-off Node script (`scripts/precompute-battery-profiles.mjs`) to:
1. Download BDEW H0 and NEDU E1a normalized to 1 kWh/year across 365 days
2. Call PVGIS REST API for hourly DE and NL PV yields (Frankfurt + Rotterdam, south, 30°, 800 Wp)
3. Write to `public/data/` as compact JSON (same format as smard-prices.json)

### PV Generation Profile

**Source: PVGIS REST API (JRC European Commission)**
[VERIFIED: joint-research-centre.ec.europa.eu/pvgis]
- Free, no API key required for basic hourly data
- Output: hourly AC power (kWh) for specified location, tilt, orientation, system size
- REST endpoint: `https://re.jrc.ec.europa.eu/api/v5_2/seriescalc`

**Typical annual yields for 800 Wp south-facing:**
[VERIFIED: balkonkraftwerkaudit.com, real user reports 2024-2025]

| Location | Orientation | Tilt | Annual Yield |
|----------|-------------|------|-------------|
| South Germany (Munich/Stuttgart) | South | 30° | 900–1,050 kWh |
| Central Germany (Frankfurt) | South | 30° | 800–850 kWh |
| North Germany (Hamburg) | South | 30° | 660–740 kWh |
| Netherlands (Rotterdam) | South | 30° | ~700–800 kWh (estimated, similar latitude to N. Germany) |

**Representative defaults for the model:**
- DE: Frankfurt, south, 30°, 800 Wp → ~820 kWh/year
- NL: Rotterdam, south, 30°, 800 Wp → ~730 kWh/year [ASSUMED — derive from PVGIS at planning time]

**Daily shape:** Bell curve centered at solar noon. Peak power ~400–700 W (summer) around 12:00–14:00. Winter days produce 15–25% of peak summer days.

### HTW Berlin Round-Trip Efficiency Benchmarks

[VERIFIED: solar.htw-berlin.de/studien/stromspeicher-inspektion-2025/]
- HTW Berlin Stromspeicher-Inspektion 2025: 22 battery systems tested
- Best-in-class (Kostal Plenticore G3 + SAX Power): 98.2% / 98.0% AC-AC round-trip efficiency
- Worst tested: 92% (inverter efficiency only; overall system RTE would be lower)
- Typical small plug-in systems: **85–91% AC-to-AC round-trip efficiency** [ASSUMED — small plug-in systems were not explicitly tested in the 2025 report which focused on larger PV-coupled systems]
- The Marstek Venus E 3.0 states >93.5% but real-world test showed 82.5% — use 85% as a conservative default for the model

**Default RTE to use in model: 88%** (midpoint of typical range; matches existing EV V2g default in v2-config.ts)

---

## Research Topic 2: DE Steckerspeicher Regulation (2026 Regime)

### Feed-in Cap — 800W Status

[VERIFIED: solantiq.com/balkonkraftwerk/regeln-2026/, VDE press releases]

**Current status (2026-04):** The 800 W feed-in cap at the grid connection point remains in force. This was enacted via Solarpaket I (May 2024, EEG 2023 amendments). Maximum inverter AC output is 800 VA.

**2000W increase:** The proposed increase to 2000 W has NOT been enacted as of April 2026. It remains under discussion. The 800 W cap applies for the model's current-regime scenario. Include a "2000W scenario" toggle in the UI as a sensitivity lever — this directly affects arbitrage ceiling. [MEDIUM confidence on "not yet enacted" — legislation moves fast]

**Module power:** Up to 2000 Wp of PV module capacity is permitted (changed from 600 Wp in Solarpaket I). The DC side is uncapped; only the inverter AC output is capped at 800 VA.

### VDE-AR-N 4105:2026-03 — Steckerspeicher Rules

[VERIFIED: solantiq.com, photovoltaik.sh/news/aktualisierte-vde-ar-n-4105-2026-03]

**In force since:** March 1, 2026

**Key rules for standalone Steckerspeicher (battery without PV):**
- Explicitly covered for the first time — same connection conditions as plug-in solar devices
- Feed-in cap: 800 VA at the inverter (same as PV)
- Registration: MaStR (Marktstammdatenregister) only — no separate Netzbetreiber notification required
- Registration deadline: 1 month after commissioning

**Critical finding — arbitrage export is NOT permitted:**
[VERIFIED: solantiq.com — "Speicher darf nicht ins Netz einspeisen (nur der Wechselrichter)"]
The storage system itself may NOT feed back into the grid. Only the inverter (microinverter connected to PV panels) can feed in. A standalone battery discharging into the household circuit to reduce grid draw is permitted — this is self-consumption. Battery directly exporting to grid for price arbitrage (export when price is high) is prohibited under this regime.

**Implication for the model:** The battery optimizer for DE must only model self-consumption arbitrage: charge from grid when cheap, discharge to reduce load when expensive. Not export. This is structurally different from V2G and simpler to implement.

### §12 Abs. 3 UStG — 0% VAT Scope

[VERIFIED: bundesfinanzministerium.de FAQ]

**Rule:** The Nullsteuersatz (0% VAT) applies to battery storage ONLY if the battery is "intended to store electricity from eligible solar modules" in the specific application.

**Standalone battery without PV:** Does NOT qualify for 0% VAT. Standard 19% VAT applies to a pure Steckerspeicher purchased without PV.

**Battery with PV (balcony system):** Qualifies. Combined PV+battery systems sold together qualify fully.

**Presumption for ≥5 kWh batteries:** Batteries ≥5 kWh are presumed to store solar power (no individual proof needed). Below 5 kWh, the buyer must demonstrate the battery is used with PV.

**Impact on model:** Consumer ROI section must add 19% VAT to Variant 1 (pure battery, no PV); Variant 2 (PV+battery bundle) qualifies for 0%. Marstek Venus E 3.0 at 5.12 kWh qualifies if sold with PV — as standalone, 19% applies.

### §14a EnWG Module 3 — Applicability to Plug-in Batteries

[VERIFIED: bundesnetzagentur.de, finanztip.de/stromtarife/steuerbare-verbrauchseinrichtungen-14a-enwg/]

**Threshold:** §14a EnWG applies to controllable consumption devices with electrical load > 4.2 kW (or rather, >4.2 kVA AC) connected to the low-voltage network.

**Plug-in batteries (≤ 2.5 kW):** Marstek Venus E 3.0 at 2.5 kW and all other reference products are BELOW the 4.2 kW threshold. **§14a Module 3 does NOT apply** to these products.

**Caveat:** If the battery charger/inverter can exceed 4.2 kW (e.g. a larger wall-mount system), §14a applies and the battery must participate in controllable consumption. For all three variants modeled here (max 2.5 kW), this is not relevant.

**For the model:** Skip Module 3 grid fee modeling for the battery page. The existing DSO tariff infrastructure in `grid-fees.ts` is not needed for this phase.

### Dynamic Tariff Availability for Battery Households

[VERIFIED: pv-magazine.de/2025/12/02, balkonkraftwerk-kompendium.de, EU mandated since 2025]

**Legal mandate:** Since January 2025, every German electricity supplier must offer a dynamic tariff (§41a EnWG).

**Providers and battery compatibility:**
- **Tibber** (€5.99/month): Offers smart battery feature integrated with Kostal and SolaxX inverters. Expanding to additional inverters. No contract exclusion for battery owners found. Dynamic hourly prices via EPEX Spot.
- **aWATTar** (€4.58/month): Open API (Home Assistant, ioBroker integration). No contract exclusion found. Most popular for DIY battery automation.
- **Rabot Charge** (€4.99/month + 20% of savings vs Grundversorger): No battery exclusion found.
- **Octopus Energy DE**: Dynamic tariff available, no battery restrictions found.

**Finding:** No German dynamic tariff provider was found to explicitly exclude battery-owning households. Battery arbitrage (charge when cheap, discharge to own load) is contractually permitted. [MEDIUM confidence — T&C not reviewed line-by-line]

**For the model:** Dynamic tariff assumption (EPEX day-ahead prices) is valid for DE households. Use SMARD prices as proxy, consistent with /v2 approach.

---

## Research Topic 3: NL Post-2027 Regime

### Salderingsregeling End State

[VERIFIED: rijksoverheid.nl, eerstekamer.nl (Wet beeindiging salderingsregeling 36.611)]

**Confirmed end date:** January 1, 2027. Full abolition — no residual net metering.

**Mechanism post-2027:**
- Households may still feed electricity into the grid
- They receive a **terugleververgoeding** (return delivery compensation) from their supplier
- Until 2030: minimum compensation must be at least **50% of the net (tax-exclusive) supply tariff**
- Energy tax is NOT refunded on exported electricity (changed from current regime where tax is effectively refunded via netting)
- Self-consumed electricity continues to pay no taxes

**Key economic impact:** Under current salderingsregeling, 1 kWh exported = 1 kWh of retail consumption offset (~€0.30–0.35/kWh all-in). Post-2027, 1 kWh exported yields approximately €0.05–0.10/kWh (market rate × compensation fraction). This makes PV export ~3–5× less valuable than self-consumption, creating a strong incentive for home batteries.

### Terugleverkosten (Return Delivery Costs)

[VERIFIED: rijksoverheid.nl, ANWB article 2025-03]

**Current (2024–2026):** Suppliers charge €100–€697/year depending on PV system size. These are fees for processing returned electricity.

**Post-2027:** Suppliers may only charge terugleverkosten for "costs actually incurred" (ACM oversight). The structure is expected to shift toward lower per-kWh fees or flat connection fees. Specific post-2027 structures are not yet published by most suppliers. [LOW confidence — post-2027 tariff schedules not confirmed]

**Frank Energie (confirmed post-2027 offer, 2025):**
[VERIFIED: frankenergie.nl post-2027 article]
- **No terugleverkosten** — no return delivery fee charged
- Compensation: ~15% above market rate for returned electricity
- Dynamic tariff (hourly EPEX prices) — no separate return delivery fee
- Positioned as the post-2027 winner for solar households

**For the model — use these as NL default assumptions:**
- Terugleverkosten: €0/year (best-case, Frank/ANWB-style dynamic contract)
- Export compensation rate: market price (EPEX) with no uplift (conservative), or +15% (Frank Energie case)
- Recommended: expose as a toggle between "dynamic contract (no terugleverkosten)" and "fixed contract (€150/year terugleverkosten, 50% market rate compensation)"

### NL Dynamic Tariff Landscape

[VERIFIED: ioplus.nl, energienerds.nl]

**Penetration (2025):** ~7% of Dutch households (~600,000) on dynamic contracts.

**Key providers:**
- **Frank Energie**: Hourly EPEX prices, no terugleverkosten, +15% export compensation
- **ANWB Energie**: Hourly rates via EnergyZero platform, positioned well for post-2027
- **Tibber NL**: Quarter-hourly pricing (unique), expanding market position
- **Vandebron, Zonneplan**: Hourly rates

**Hourly pricing standard:** All major NL dynamic providers use hourly EPEX pricing. Tibber NL uniquely offers QH (15-min) pricing.

**For the model:** Use ENTSO-E NL hourly prices via existing `use-prices.ts` (country='NL') — no new data pipeline needed.

### NL Grid Fees for Kleinverbruikers

[VERIFIED: energienerds.nl, thuisbatterij.nl/blog]

**Current (2026):** Kleinverbruikers pay a capacity tariff based on fuse size (connection capacity), NOT on kWh consumed. This means battery arbitrage does not increase network costs for the consumer. Network costs are essentially flat.

**From 2028:** Time-dependent network tariffs are being introduced. Four price levels based on grid load:
- Night (00:00–06:00): Low tariff (~€0.11/kWh)
- Daytime (09:00–17:00): Mid tariff (~€0.08/kWh — lower due to solar)
- Evening (17:00–22:00): High tariff (~€0.24/kWh)
- Morning (06:00–09:00): Medium

**Impact on battery ROI:** The 2028 time-dependent tariffs make batteries significantly more attractive in NL. Payback period estimated to drop from ~8.8 years to ~5.4 years with smart optimization.

**For the model:** Current NL (2026): flat grid fees — battery arbitrage value is purely EPEX price spread. Post-2028: grid fee spreading amplifies arbitrage value. Since Phase 8 models post-2027 NL, the model should note the 2028 tariff change as an additional upside but not try to model it quantitatively (no confirmed tariff levels yet).

### NL Balcony PV Feed-in Cap

[VERIFIED: energieleveren.nl registration requirement; multiple NL sources]

**Finding:** The Netherlands does NOT have a statutory 800W feed-in cap equivalent to Germany's. Balcony PV systems are limited by microinverter hardware (typically 800W in practice) but there is no statutory feed-in cap law. Registration on `energieleveren.nl` is required.

**For the model:** NL battery discharge to grid is not restricted by a statutory cap. However, practical inverter limits still apply. Use the same 800W hardware cap for the combined PV+battery system but note it's a hardware limit, not a legal one.

### NL VAT / Subsidies for Home Batteries

[ASSUMED — not confirmed via NL government sources; based on known patterns]

**NL BTW (VAT):** Netherlands reduced VAT on solar panels to 0% for residential installations. Home batteries as standalone products: standard 21% BTW likely applies. Batteries sold as part of a PV system may qualify for reduced rate. [LOW confidence — requires Belastingdienst source]

**Subsidies:** No significant national subsidy for home batteries in NL as of research date. Some municipalities may offer local incentives. [LOW confidence]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Load profile (DE households) | Custom consumption curve | BDEW H0 — precomputed static JSON | Published standard, normalized, 96 QH × 365 days |
| Load profile (NL households) | Custom consumption curve | NEDU E1a — precomputed static JSON | Published standard, used by all NL grid operators |
| PV generation profile | Weather API integration | PVGIS precomputed static JSON | Free EU JRC data, hourly, accurate, no CORS issues |
| Battery round-trip efficiency benchmarks | Own testing | HTW Berlin Stromspeicher-Inspektion | Authoritative independent test, published annually |
| Dynamic tariff prices | Price scraper | Existing use-prices.ts (SMARD/ENTSO-E) | Already works for DE and NL |
| MILP/LP battery solver | Custom solver | Greedy three-pass algorithm | Sufficient for single battery, 24h, 96 slots; no TS MILP library worth using |

**Key insight:** The hard problem in home battery modeling is not the optimization algorithm — it is getting the load profile and PV generation profile right. Sourced real datasets make the model credible; hand-rolled curves make it a toy.

---

## Common Pitfalls

### Pitfall 1: Modeling Battery Export for DE Arbitrage

**What goes wrong:** The optimizer allows the battery to discharge to the grid (sell high) as well as to household load, overstating the DE arbitrage value by 2–5×.

**Why it happens:** V2G in /v2 models exactly this pattern. A developer might copy-paste without noticing the regulatory difference.

**How to avoid:** The `runBatteryDay()` function must enforce: in DE mode, `battDischargeKwh` can only reduce load to zero — it cannot push net consumption negative (no export). Check `gridKwh >= 0` for every slot.

**Warning signs:** Annual savings numbers > €300/year for a 2 kWh battery on dynamic tariffs should trigger a review.

### Pitfall 2: Using AC Power Rating as Round-Trip Efficiency

**What goes wrong:** Using the manufacturer's stated "battery efficiency" (often only the cell-level RTE) rather than the full AC-to-AC system efficiency including inverter losses.

**Why it happens:** Marstek states >93.5% but real-world AC-to-AC measured at 82.5%. The difference is inverter conversion losses.

**How to avoid:** Use AC-to-AC RTE as the single efficiency parameter. Apply it as: `kWh_discharged_to_load = kWh_charged_from_grid × RTE`. Default: 88%.

**Warning signs:** If RTE in specs is >93% and the system has an AC-coupled inverter, it is cell-level efficiency only.

### Pitfall 3: Applying 0% VAT to All Battery Variants

**What goes wrong:** Displaying a hardware cost that excludes 19% VAT for the standalone battery (Variant 1), making the ROI falsely optimistic.

**Why it happens:** The PV+battery bundle (Variant 2) correctly gets 0% VAT; easy to apply the same rule to Variant 1.

**How to avoid:** In `BATTERY_VARIANTS[]`, include a `vatRate` field: Variant 1 (pure battery, no PV) → 19%; Variant 2 (PV+battery bundle) → 0%; Variant 3 (≥5 kWh with PV) → 0%.

### Pitfall 4: Modeling NL with Salderingsregeling Still Active

**What goes wrong:** The model uses current NL net metering (1:1 offset) making batteries look unattractive because export already earns full retail rate.

**Why it happens:** The exploration note says "post-2027 only" but use-prices.ts fetches today's NL prices — a developer might inadvertently model today's economics.

**How to avoid:** The NL view must display a clear disclaimer: "Modeled for post-2027 regime (no salderingsregeling)." Use a `nlRegime` toggle: `'current'` (salderingsregeling active) | `'post2027'` (50% compensation floor). The consumer ROI in post-2027 mode should apply a much lower export value.

### Pitfall 5: Forgetting Standby Consumption in Annual ROI

**What goes wrong:** Annual savings are overstated because the battery's own standby power consumption (5–15 W continuously) is not counted as a cost.

**Why it happens:** Standby consumption is not in most manufacturer datasheets and is easy to overlook.

**How to avoid:** Include `standbyWatts` in `BatteryParams`. Annual standby cost = `standbyWatts × 8760h × retailCtKwh / 100`. For a 10W standby at 30 ct/kWh: ~€26/year — material at 2 kWh battery scale.

### Pitfall 6: Ignoring the Daily PV Excess vs Battery Capacity Mismatch

**What goes wrong:** In summer, 800 Wp PV produces 4–5 kWh/day but household base load may only be 8–10 kWh/day with a typical 2-person apartment, and a 2 kWh battery fills up in ~1.5 hours of peak solar. The model overstates PV self-consumption by not enforcing the battery's fill constraint.

**Why it happens:** Annual average yield is used instead of per-slot battery SoC tracking.

**How to avoid:** The three-pass optimizer enforces SoC bounds per slot. Never aggregate PV yield to daily totals without slot-level SoC tracking.

---

## Code Examples

### Battery Variant Config

```typescript
// src/lib/battery-config.ts
export interface BatteryVariant {
  id: 'schuko-2kwh' | 'balcony-pv-1.6kwh' | 'wall-5kwh'
  label: string
  description: string
  // Physical specs
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number       // AC-to-AC, default 0.88
  standbyWatts: number
  includePv: boolean         // true for Variant 2
  pvCapacityWp: number       // 0 if no PV
  // Economics
  hardwareCostEurIncVat: number   // incl. VAT at correct rate
  vatRate: number                 // 0 or 0.19
  warrantyYears: number
  cycleLife: number
  // Regulation
  feedInCapKw: number        // DE: 0.8 | NL: hardware limit (use 0.8 for safety)
  electricianRequired: boolean
}

export const BATTERY_VARIANTS: BatteryVariant[] = [
  {
    id: 'schuko-2kwh',
    label: 'Schuko Steckerspeicher',
    description: 'Marstek Venus B — 2 kWh, Schuko plug, no PV',
    usableKwh: 2.0,
    maxChargeKw: 1.5,
    maxDischargeKw: 0.8,   // self-consumption to load only in DE
    roundTripEff: 0.88,
    standbyWatts: 10,
    includePv: false,
    pvCapacityWp: 0,
    hardwareCostEurIncVat: 595,  // estimate at 19% VAT — LOW confidence
    vatRate: 0.19,
    warrantyYears: 5,     // LOW confidence — not confirmed
    cycleLife: 6000,
    feedInCapKw: 0.8,
    electricianRequired: false,
  },
  {
    id: 'balcony-pv-1.6kwh',
    label: 'Balkonkraftwerk + Speicher',
    description: 'Anker SOLIX Solarbank 2 E1600 Pro — 800 Wp PV + 1.52 kWh',
    usableKwh: 1.52,
    maxChargeKw: 2.0,
    maxDischargeKw: 1.0,
    roundTripEff: 0.88,
    standbyWatts: 8,
    includePv: true,
    pvCapacityWp: 800,
    hardwareCostEurIncVat: 1499,  // €1,199 unit + ~€300 panels, 0% VAT
    vatRate: 0.00,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    electricianRequired: false,
  },
  {
    id: 'wall-5kwh',
    label: 'Wandbatterie (Elektriker)',
    description: 'Marstek Venus E 3.0 — 5.12 kWh, requires electrician',
    usableKwh: 4.6,         // 90% DoD
    maxChargeKw: 2.5,
    maxDischargeKw: 2.5,
    roundTripEff: 0.88,     // conservative; stated >93.5% is cell-level only
    standbyWatts: 12,
    includePv: false,       // can be combined with PV but sold standalone
    pvCapacityWp: 0,
    hardwareCostEurIncVat: 1570,  // €1,319 + 19% VAT = €1,570 (standalone, no PV)
    vatRate: 0.19,
    warrantyYears: 10,
    cycleLife: 6000,
    feedInCapKw: 0.8,
    electricianRequired: true,
  },
]
```

### Battery Day Optimizer (skeleton)

```typescript
// src/lib/battery-optimizer.ts
import type { HourlyPrice } from '@/lib/v2-config'

export interface BatteryParams {
  usableKwh: number
  maxChargeKw: number
  maxDischargeKw: number
  roundTripEff: number
  standbyWatts: number
  feedInCapKw: number        // hard cap on feed-in; discharge above this rejected in DE mode
  allowGridExport: boolean   // DE: false | NL: false (for plug-in regime)
}

export interface SlotResult {
  timestamp: number          // ms
  hour: number
  minute: number
  priceCtKwh: number
  pvKwh: number              // PV generation this slot (kWh)
  loadKwh: number            // household load this slot (kWh)
  chargeFromGridKwh: number
  chargeFromPvKwh: number
  dischargeToLoadKwh: number
  gridImportKwh: number      // positive = buy from grid
  gridExportKwh: number      // positive = sell to grid (usually 0 in DE)
  socKwhStart: number
  socKwhEnd: number
  slotCostEur: number        // negative = savings vs no-battery baseline
}

export function runBatteryDay(
  prices: HourlyPrice[],   // 96 QH slots
  pvKwhPerSlot: number[],  // 96 values, from PVGIS profile scaled to actual Wp
  loadKwhPerSlot: number[], // 96 values, from BDEW/NEDU profile scaled to annual kWh
  params: BatteryParams,
  startSocKwh: number = 0,
): { slots: SlotResult[]; baselineCostEur: number; optimizedCostEur: number; savingsEur: number }
```

### Static JSON Profile Shape

```typescript
// public/data/bdew-h0-profile.json
// Array of 8760 hourly values (or 35040 QH values), normalized so sum = 1.0 kWh/year
// Usage: multiply each value by actual_kwh_per_year to get kWh for that slot
[0.000082, 0.000078, 0.000074, ..., 0.000112]  // 8760 or 35040 entries
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Wieland socket required for Steckersolar | Schuko normatively permitted (DIN VDE V 0126-95) | December 2025 | Simpler installation; no electrician for <800W PV |
| Solarpaket I rumored 2000W cap | 800W cap still in force (2000W proposed, not enacted) | April 2026 | Model must use 800W until further notice |
| Salderingsregeling (NL 1:1 net metering) | Ends 2027-01-01 definitively | January 2027 (scheduled) | Home batteries become materially attractive in NL post-2027 |
| BDEW H0 profile (1999, 3 seasons) | BDEW 2025 profiles (per-month granularity) | 2025 | Use 2025 version for more accurate seasonal modeling |
| Separate Netzbetreiber notification for Steckersolar | MaStR only (since Solarpaket I) | May 2024 | Registration simpler |

**Deprecated/outdated:**
- Wieland socket requirement: still legally valid but no longer mandatory for plug-in systems under 800 VA (as of Dec 2025)
- NEDU E1a "old" profiles: 2025 profiles supersede 2023 — use mffbas.nl 2025 version

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | 2000W Steckersolar cap not enacted as of April 2026 | Research Topic 2 | If enacted, arbitrage ceiling doubles; model shows wrong value |
| A2 | DE dynamic tariff providers have no battery exclusion clauses | Research Topic 2 | If exclusion exists, battery arbitrage on dynamic tariff is contractually blocked |
| A3 | Marstek Venus B retail price ~€400–600 | Research Topic 1 | Official pricing not found; payback period for Variant 1 may be wrong |
| A4 | NL default terugleverkosten post-2027 = €0 (dynamic contract) | Research Topic 3 | If most households end up on fixed contracts with high terugleverkosten, battery ROI is overstated |
| A5 | NL BTW on standalone home battery = 21% | Research Topic 3 | If 0% BTW applies, hardware cost is lower and ROI better |
| A6 | Marstek Venus E 3.0 AC-to-AC RTE = 88% (using conservative estimate) | Research Topic 1 | Stated >93.5% may be accurate; using 88% understates savings slightly |
| A7 | PVGIS NL yield for Rotterdam ~730 kWh/year (800 Wp, south, 30°) | Research Topic 1 | Must be confirmed by running PVGIS API at planning/build time |
| A8 | NL does not have a statutory feed-in cap equivalent to DE 800W | Research Topic 3 | If cap exists, NL battery arbitrage export is restricted similarly to DE |

---

## Open Questions

1. **Marstek Venus B retail price (Variant 1)**
   - What we know: Product launched March 2026; specs confirmed
   - What's unclear: Retail price in DE/NL not published in any source found
   - Recommendation: Check marstek.de and Geizhals at planning time; use €499 (Venus A price) as placeholder

2. **2000W Solarpaket II / Steckersolar cap increase timeline**
   - What we know: 800W is current law; 2000W discussed
   - What's unclear: Whether Solarpaket II has been tabled in Bundestag by plan execution date
   - Recommendation: Model 800W as default; make it a UI toggle labeled "2000W (proposed)"

3. **NL BTW (VAT) on standalone home battery**
   - What we know: PV panels = 0% BTW in NL since 2023
   - What's unclear: Whether standalone battery qualifies (Belastingdienst ruling not found)
   - Recommendation: Use 21% as conservative default; note as assumption

4. **NL grid fees post-2027 terugleverkosten exact structure**
   - What we know: ACM oversight; suppliers can only charge actual costs; Frank Energie charges €0
   - What's unclear: What Eneco, Vattenfall, Nuon will charge
   - Recommendation: Expose as user input with €0 (dynamic contract) and €150 (fixed contract) as presets

5. **PVGIS API for NL yield**
   - What we know: Free REST API exists; can compute hourly per location
   - What's unclear: Exact yield for Rotterdam, 800 Wp, south, 30°
   - Recommendation: Run PVGIS query at script-writing time during Wave 0

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | precompute-battery-profiles.mjs script | ✓ | 20 (GitHub Actions target) | — |
| PVGIS REST API | PV generation profile precomputation | ✓ (public, no auth) | v5.2 | Use approximate values from research |
| BDEW H0 data | Load profile precomputation | ✓ (public, bdew.de) | 2025 version | Use 1999 version from R package |
| NEDU E1a data | Load profile precomputation | ✓ (public, energiedatawijzer.nl) | 2025 version | Use older version from MFFBAS |
| SMARD/ENTSO-E prices | Battery optimizer | ✓ (via existing use-prices.ts) | existing | — |

---

## Security Domain

`security_enforcement` is not set to `false`. However, this phase adds no new API routes, authentication flows, or user-input surfaces beyond what already exists in /v2. All computation is client-side. No new database writes. No secrets involved.

**ASVS categories relevant to new code:**

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | No — no new auth | Existing middleware |
| V5 Input Validation | Yes — user inputs battery specs, annual consumption | Clamp/validate in component before passing to optimizer |
| V6 Cryptography | No | — |

**Input validation for battery optimizer parameters:** All numeric inputs (usableKwh, roundTripEff, loadKwh, pvWp) must be clamped to valid ranges before passing to `runBatteryDay`. Division-by-zero guards needed: if `usableKwh === 0` or `maxChargeKw === 0`, return zeroed result immediately (same pattern as `runOptimization` in optimizer.ts line ~179).

---

## Sources

### Primary (HIGH confidence)
- `ess-news.com/2026/03/17` — Marstek Venus B 2 kWh specs (verified March 2026 launch)
- `marstek.de/en-eu/products/venus-e-3` — Marstek Venus E 3.0 official specs
- `solantiq.com/balkonkraftwerk/regeln-2026/` — VDE-AR-N 4105:2026-03 Steckerspeicher rules
- `bundesfinanzministerium.de/Content/DE/FAQ/foerderung-photovoltaikanlagen.html` — 0% VAT conditions
- `rijksoverheid.nl/onderwerpen/energie-thuis/salderingsregeling` — Salderingsregeling end 2027
- `notebookcheck.net Anker SOLIX Solarbank 2 Pro review` — Solarbank specs verified
- `solar.htw-berlin.de/studien/stromspeicher-inspektion-2025/` — HTW RTE benchmarks
- `flrd.github.io/standardlastprofile` — BDEW H0 profile data access
- `mffbas.nl/nieuws/profielen-elektriciteit-en-aardgas-2025-plus-wegingsfactoren-gepubliceerd/` — NEDU 2025 profiles
- `zendure.com/products/solarflow-hyper-2000` — Zendure Hyper specs

### Secondary (MEDIUM confidence)
- `patrickphang.nl/2026/03/25` — comparative review Marstek Venus E 3.0 vs alternatives; NL pricing
- `frankenergie.nl` — post-2027 terugleververgoeding structure (single supplier, may not represent market)
- `energienerds.nl/2025/10/15` — NL 2028 time-dependent network tariff impact on home batteries
- `pv-magazine.de/2025/12/02` — Tibber battery feature (Kostal/SolaxX compatible)
- `balkonkraftwerkaudit.com/jahresertrag-balkonkraftwerk` — real-world PV yield DE by region

### Tertiary (LOW confidence)
- NL BTW on standalone batteries (inferred from PV BTW rules; not verified from Belastingdienst)
- Marstek Venus B retail price (product too new; no confirmed retail listings found)
- 2000W Steckersolar cap not-yet-enacted status (confirmed as of April 2026 but fast-moving)

---

## Metadata

**Confidence breakdown:**
- Product specs (Marstek Venus E, Anker Solarbank, Zendure Hyper): HIGH — official product pages verified
- Product specs (Marstek Venus B price): LOW — product too new, price not published
- DE regulation (800W cap, VDE-AR-N 4105:2026-03, 0% VAT, §14a scope): HIGH — official government and standards sources
- DE arbitrage legality (no export permitted): HIGH — explicit statement in VDE source
- NL salderingsregeling end 2027: HIGH — confirmed by Rijksoverheid and multiple suppliers
- NL post-2027 terugleververgoeding rate: MEDIUM — confirmed as minimum 50% of net tariff until 2030; supplier-specific rates vary
- NL grid fees post-2027: LOW — 2028 time-dependent tariffs announced but rates preliminary
- BDEW H0 / NEDU E1a load profiles: HIGH — official published data sources identified
- PVGIS yields for DE/NL: MEDIUM — tool verified; specific yields for target locations require API call at build time
- Battery optimizer algorithm approach: HIGH — consistent with existing codebase pattern (V2G optimizer)

**Research date:** 2026-04-17
**Valid until:** 2026-07-17 (stable for regulation; product pricing may shift faster)
