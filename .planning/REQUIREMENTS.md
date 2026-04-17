# FlexMon Dashboard — Requirements

## v1 Requirements (Validated — Deployed)

### Data Integration
- [x] **DATA-01**: User sees real German day-ahead electricity prices (hourly) — PROJ-1
- [x] **DATA-02**: User sees quarter-hourly price resolution — PROJ-1
- [x] **DATA-03**: Prices auto-update via GitHub Actions with SMARD data — PROJ-1
- [x] **DATA-04**: Incremental price fetching fills gaps between static data and today — PROJ-1
- [x] **DATA-05**: Supabase cache prevents redundant API calls — PROJ-1

### Optimization
- [x] **OPT-01**: User sees baseline (immediate) vs. optimized (smart) charging cost — PROJ-2
- [x] **OPT-02**: Optimization respects plug-in window, departure time, and charge power — PROJ-2
- [x] **OPT-03**: Grid fees (§14a Module 3) applied for 10 DSOs — PROJ-2

### Visualization
- [x] **VIZ-01**: Interactive price chart with day-ahead curve and charging blocks — PROJ-12
- [x] **VIZ-02**: Chart zoom levels: 12h, 24h, 72h — PROJ-12
- [x] **VIZ-03**: Renewable generation overlay (solar, wind) — PROJ-12
- [x] **VIZ-04**: Session cost breakdown card (baseline vs. optimized) — PROJ-19
- [x] **VIZ-05**: Monthly savings bar chart — PROJ-20
- [x] **VIZ-06**: Savings sensitivity heatmap (mileage × frequency matrix) — PROJ-21
- [x] **VIZ-07**: Savings potential summary box — PROJ-22
- [x] **VIZ-08**: Spread indicators & scenario cards — PROJ-27
- [x] **VIZ-09**: Fleet portfolio view — PROJ-25

### User Configuration
- [x] **CFG-01**: User can set yearly mileage — PROJ-17
- [x] **CFG-02**: User can set weekday/weekend plug-in frequency — PROJ-24
- [x] **CFG-03**: User can set plug-in time and departure time — PROJ-17
- [x] **CFG-04**: User can set charge power — PROJ-17

### Navigation & UX
- [x] **NAV-01**: Date picker with spread-colored indicators — PROJ-18, PROJ-28
- [x] **NAV-02**: DateStrip with year/month navigation — PROJ-28
- [x] **NAV-03**: URL state persistence & sharing — PROJ-23
- [x] **NAV-04**: Two-column layout with sidebar — PROJ-28
- [x] **NAV-05**: Tutorial/guide overlay — PROJ-28

### Auth
- [x] **AUTH-01**: Password-protected dashboard access — PROJ-6

## Active Requirements (In Progress)

### V2G
- [ ] **V2G-01**: User sees V2G (vehicle-to-grid) discharge value alongside charging savings — PROJ-29
- [ ] **V2G-02**: Dual value stream visualization (charging savings + discharge revenue) — PROJ-29

### Multi-Country
- [ ] **INTL-01**: User can switch between DE and NL price data — code exists, UI disabled
- [ ] **INTL-02**: NL prices fetched via ENTSO-E with separate cache — implemented
- [ ] **INTL-03**: Country-aware data flows (no cross-contamination) — implemented

### Intraday
- [ ] **INTRA-01**: EPEX intraday price display alongside day-ahead — scraper exists
- [ ] **INTRA-02**: Scraper captures all EPEX fields (low, high, last, wavg, id_full, id1, id3, buy_vol, sell_vol, volume) — Phase 4
- [ ] **INTRA-03**: Batch API serves full intraday data (all fields per QH) — Phase 4
- [ ] **INTRA-04**: Convergence funnel visualization showing price narrowing DA → ID3 → ID1 → settlement — Phase 5
- [ ] **INTRA-05**: Animated re-optimization showing charging blocks shifting at each intraday stage — Phase 5

### Battery Business Case (Phase 8)
- [ ] **BATT-01**: Static profile JSON assets (BDEW H0 DE, NEDU E1a NL, PVGIS DE, PVGIS NL) — Phase 8
- [ ] **BATT-02**: Battery config types and variants (Marstek Venus B, Anker SOLIX Solarbank 2 E1600 Pro, Marstek Venus E 3.0) — Phase 8
- [ ] **BATT-03**: Battery day optimizer with DE grid-export prohibition enforced (`gridExportKwh = 0`) — Phase 8
- [ ] **BATT-04**: Battery annual roll-up (`runBatteryYear`) producing monthly + annual results — Phase 8
- [ ] **BATT-05**: `/battery` page route with URL↔state sync (variant, country, tariff, date, feed-in cap) — Phase 8
- [ ] **BATT-06**: BatteryVariantPicker component with three-variant selection + inline country/tariff/load controls — Phase 8
- [ ] **BATT-07**: BatteryDayChart (ComposedChart: price, load, PV, charge/discharge, SoC) — Phase 8
- [ ] **BATT-08**: BatteryRoiCard with annual savings, simple payback, break-even year, 10yr NPV, 12-month breakdown — Phase 8
- [ ] **BATT-09**: RegulationPanel (DE 800W/2000W toggle, NL terugleverkosten + export compensation) — Phase 8
- [ ] **BATT-10**: ManagementView (DE vs NL unit-economics table + revenue-stream breakdown + market framing) — Phase 8
- [ ] **BATT-11**: Feature spec PROJ-39 + INDEX.md update — Phase 8

## v2 Requirements (Deferred)

- Theory/education overlay explaining load shifting concepts
- Additional countries beyond DE/NL (AT, FR, BE, etc.)
- Mobile-responsive layout optimization
- Real-time price updates (WebSocket)
- Export/download functionality (PDF, CSV)

## Out of Scope

- User accounts / multi-tenant auth — single password sufficient for demo
- Real-time bidding / trading integration — visualization only
- Battery degradation modeling — too complex for demo scope
- Mobile app — web dashboard only

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| DATA-01..05 | — | Validated (deployed) |
| OPT-01..03 | — | Validated (deployed) |
| VIZ-01..09 | — | Validated (deployed) |
| CFG-01..04 | — | Validated (deployed) |
| NAV-01..05 | — | Validated (deployed) |
| AUTH-01 | — | Validated (deployed) |
| V2G-01..02 | Phase 1 | In Progress |
| INTL-01..03 | Phase 2 | Implemented, UI disabled |
| INTRA-01 | Phase 3 | Scraper exists |
| BATT-01..11 | Phase 8 | In Progress |

---
*Last updated: 2026-03-26 after initialization*
