# Research Questions

## 2026-04-14 — Typical German EV owner parameter defaults
**Context:** Needed for the "ideal parameters" sweep feature
(see `.planning/notes/ideal-parameters-feature.md` and
`.planning/seeds/ideal-parameters-sweep.md`). The product/sensitivity view
pins all parameters except one at "typical" values — those defaults must be
defensible, not made up.

**Questions:**
- What is the average annual mileage of a German private EV owner? (KBA
  Verkehr in Zahlen? ADAC? mobility panel?)
- What is the typical home plug-in time distribution? (evening peak — when?)
- What is the typical plug-in window length (plug-in to next departure)?
- What share of EV owners have 3.7 / 7.4 / 11 / 22 kW home charging?
- Average kWh per session for a private home charger?

**Sources to check:** KBA, BDEW, ADAC, NEDU equivalent for Germany,
Mobilität in Deutschland (MiD) study.

**Why it matters:** Without sourced defaults the sensitivity view becomes a
toy — the "typical customer" baseline anchors every claim made from the
heatmap and curves.

## 2026-04-17 — Plug-in home battery product landscape & unit economics (DE/NL)
**Context:** Needed for the "Plug-in Battery Business Case (DE/NL)" phase
(see `.planning/notes/plug-in-battery-exploration.md`). The consumer ROI
calculator and management-view unit economics are only credible if battery
specs and retail prices are sourced, not guessed.

**Questions:**
- Which plug-in Schuko batteries (Steckerspeicher) are actually on the DE/NL
  market in 2026? Reference products: Anker SOLIX Solarbank 2/3, Zendure
  SolarFlow / Hyper, Marstek Venus, EcoFlow PowerStream.
- For each reference product: usable capacity (kWh), max charge/discharge
  power (kW), round-trip efficiency (%), standby consumption (W), retail
  price incl. VAT (DE and NL), warranty / cycle life.
- Is there a "simple but needs electrician" product category between pure
  Schuko and full home-battery installs? (e.g. single-phase wall-mount, no
  subpanel work, flat-compatible.) Price delta vs Schuko plug-in?
- Balcony-PV + battery combo products — what is the typical bundled price
  for 800W PV + 2 kWh battery in DE?
- What PV generation profile should we assume for a south-facing 800W
  balcony setup in DE and NL? (annual kWh, daily shape.)
- What is a defensible apartment household baseline load profile?
  (kWh/year, daily shape — morning + evening peaks.)

**Sources to check:** manufacturer data sheets, Geizhals/Idealo (DE),
Tweakers (NL), HTW Berlin Stromspeicher-Inspektion (RTE benchmarks), PVGIS
(PV profiles), NEDU / BDEW household load profiles.

**Why it matters:** The three modeled technical constraints (800W cap,
household consumption, battery spec) compound — without sourced values the
ROI and payback curves are fiction. Management view's unit economics need
a real price point per household to be actionable.

## 2026-04-17 — DE Steckerspeicher regulation (2026 regime)
**Context:** Regulation is a first-class input to the plug-in battery
business case. We need the actual rules as of the modeled window, not a
general overview.

**Questions:**
- 800W feed-in cap — what is the current legal status, and what is the
  likelihood/timeline of the 2000W cap coming into force?
- VDE-AR-N 4105 — what does it require for a Schuko-plugged battery with
  PV? Is a simplified registration (Marktstammdatenregister only) sufficient?
- §12 Abs. 3 UStG (0% VAT) — does it extend to pure plug-in batteries
  without PV, or only to battery-as-part-of-PV-system installations?
- §14a EnWG Module 3 — does it apply to plug-in batteries at all, or only
  to >4.2kW steuerbare Verbrauchseinrichtungen?
- Does a plug-in battery that also discharges *back* to the grid (i.e.
  arbitrage export) change the legal classification vs self-consumption only?
- Dynamic tariff availability — which suppliers offer them in 2026,
  minimum/maximum battery sizes they support, any contract exclusions for
  battery-owning households?

**Sources to check:** BNetzA guidance, VDE-FNN, EnWG text, UStG §12,
DGS/SFV publications, Tibber/aWATTar/Rabot T&Cs.

**Why it matters:** If feed-in back to grid is legally restricted or
economically throttled (feed-in caps, EEG payments), the arbitrage value
stream collapses and the model must reflect that.

## 2026-04-17 — NL home battery regime post-2027 (salderingsregeling phase-out)
**Context:** NL-side modeling is scoped to the post-2027 regime — i.e.
after salderingsregeling is fully phased out. This is when home batteries
become materially attractive in NL, and it is the only window we model.

**Questions:**
- What is the exact end-state of salderingsregeling in 2027? (Full removal
  vs residual compensation at market rate vs supplier-choice.)
- Terugleverkosten — how widespread are they in 2027, and what structures
  dominate? (Flat monthly fee by PV size, per-kWh fee, tiered?)
- Dynamic tariff landscape in NL — which suppliers, penetration, any
  structural differences vs DE? (ANWB Energie, Frank Energie, Tibber NL,
  Zonneplan, etc.)
- Grid fees for small consumers (kleinverbruikers) — capacity component?
  Time-of-use component? Any battery-specific tariff structure emerging?
- Is there a NL equivalent of the 800W balcony feed-in cap, or are
  balcony PV + battery setups effectively unregulated for kleinverbruikers?
- Post-2027 feed-in compensation for surplus PV — what rate applies and
  how does it compare to retail? (Drives the balcony PV self-consumption
  value stream.)
- Any NL-specific VAT / subsidy regime for home batteries or balcony PV?

**Sources to check:** ACM, RVO, Belastingdienst, Energie-Nederland,
Consumentenbond energiemarkt reports, NEDU profiles, dominant suppliers'
2026/27 tariff schedules if published.

**Why it matters:** NL is where the business case is most dramatic, and
the whole management-view "market size" argument depends on correctly
modeling the post-phase-out regime. Getting salderingsregeling end-state
wrong would invert the conclusion.
