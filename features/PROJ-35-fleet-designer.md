# PROJ-35: Fleet Designer

## Status: In Review
**Created:** 2026-04-02
**Last Updated:** 2026-04-02

## Dependencies
- Requires: PROJ-12 (Interactive Price Chart) — chart toolbar toggle placement
- Requires: PROJ-17 (Customer Profile Configurator) — existing single-EV scenario state

## Overview

A configurable fleet composition panel that defines a heterogeneous fleet using statistical distributions. Activated via a toggle pill ("Fleet") in the chart toolbar, with a compact configuration panel appearing below the chart. The single-EV scenario controls remain visible as the reference vehicle; the fleet designer adds aggregate fleet parameters on top.

## User Stories

1. **As a** fleet manager, **I want to** define my fleet size and composition **so that** I can see how load shifting value scales with more vehicles.

2. **As a** business development user, **I want to** configure arrival time distributions **so that** the flex band reflects realistic home charging patterns where vehicles arrive throughout the evening.

3. **As a** business development user, **I want to** set departure time distributions **so that** the flex band accounts for varied morning departure needs across the fleet.

4. **As a** analyst, **I want to** adjust the battery size mix and charge power ratio **so that** I can model different fleet compositions (e.g., mostly compact cars vs. SUVs).

5. **As a** analyst, **I want to** set the arrival SoC spread **so that** the flex band reflects that some vehicles arrive nearly empty while others arrive partially charged.

6. **As a** user, **I want to** toggle fleet mode on and off quickly **so that** I can switch between single-EV and fleet perspectives without losing my fleet configuration.

## Acceptance Criteria

### Fleet Toggle
- [ ] A pill button labeled "Fleet" appears in the chart toolbar, next to the existing "Renew." toggle
- [ ] Clicking the pill toggles fleet mode on/off; active state uses the same visual style as the renewable toggle (white bg + shadow when active, gray text when inactive)
- [ ] Fleet configuration state persists when toggling off and back on within the same session
- [ ] When fleet is active, a sub-toggle allows switching the chart between "Single EV" and "Fleet" overlay views

### Fleet Configuration Panel
- [ ] When fleet mode is active, a compact configuration panel appears below the chart (inside the same Card)
- [ ] Panel contains:
  - **Fleet size** slider: 10–1,000 EVs, logarithmic scale (same pattern as FleetPortfolioCard)
  - **Arrival distribution**: visual bar histogram showing % of fleet arriving at each hour (14:00–23:00). Default: existing `PLUGIN_TIME_DIST` data (peak at 18:00, 27%)
  - **Departure distribution**: visual bar histogram showing % of fleet departing at each hour (05:00–09:00). Default: bell curve peaking at 07:00
  - **Battery mix**: three-way ratio slider or percentage inputs for compact (40 kWh) / mid (60 kWh) / SUV (100 kWh). Default: 30% / 50% / 20%
  - **Charge power mix**: simple toggle or slider for 7kW vs 11kW ratio. Default: 80% / 20%
  - **Arrival SoC spread**: min/max range slider (10%–60%). Default: 15%–55%

### Distribution Editing
- [ ] Arrival and departure distributions are editable by dragging bar heights in the histogram
- [ ] Distributions always sum to 100% — adjusting one bar proportionally adjusts others
- [ ] Distributions can be reset to defaults via a small reset button

### Data Model
- [ ] Fleet configuration is stored as a `FleetConfig` interface in `v2-config.ts`
- [ ] Fleet state lives in `Step2ChargingScenario` component state (not URL params — fleet config is too complex for URL serialization)
- [ ] The `FleetConfig` type exports cleanly so PROJ-36 and PROJ-37 can import it

### Mode Scope
- [ ] Fleet mode only operates in overnight charging mode (14:00–09:00 window)
- [ ] If the user switches to fullday or 3-day mode while fleet is active, show a subtle note: "Fleet view available in overnight mode" and keep fleet toggle visible but inactive

## Edge Cases

1. **Fleet size = 1**: Should degenerate to approximately the single-EV view. The flex band becomes very narrow (single vehicle's flexibility window).
2. **All arrivals at same hour**: Distribution histogram shows 100% at one hour. Valid — represents a company fleet scenario.
3. **All departures at same hour**: Same as above — single departure time is a valid configuration.
4. **Arrival after latest departure**: If arrival distribution extends past the departure distribution start (e.g., arriving at 22:00 but some depart at 05:00), vehicles in that cohort have minimal flex. The band should still render correctly — just narrow at those hours.
5. **Extreme SoC spread**: If arrival SoC range is 10%–10% (no spread), all vehicles need the same charge. Band narrows.
6. **100% one battery type**: Selecting 100% compact / 0% mid / 0% SUV should work — effectively a homogeneous fleet.

## Technical Requirements

- **Performance**: Fleet configuration changes should update the flex band within 100ms for 1,000 EVs (computation happens in PROJ-36, but the config panel must not introduce lag)
- **Bundle size**: No new dependencies — use native HTML range inputs styled with Tailwind, not a slider library
- **Responsive**: Panel should stack vertically on narrow viewports (< 768px)

---

## Tech Design (Solution Architect)

### Component Structure

```
Step2ChargingScenario (existing — adds fleet state + toggle)
├── Chart Toolbar (existing row)
│   ├── [60min] [15min]          ← existing resolution toggle
│   ├── [☀ Renew.]               ← existing renewable toggle
│   └── [⚡ Fleet]                ← NEW: fleet mode toggle pill
│       └── [Single EV | Fleet]  ← NEW: sub-toggle (visible when Fleet active)
├── ComposedChart (existing — PROJ-36/37 add layers here)
└── FleetConfigPanel             ← NEW component (below chart, inside Card)
    ├── Fleet Size Row
    │   └── Log slider (10–1,000) + numeric display
    ├── Distribution Row (horizontal layout)
    │   ├── ArrivalHistogram      ← draggable bar chart (14:00–23:00)
    │   └── DepartureHistogram    ← draggable bar chart (05:00–09:00)
    ├── Vehicle Mix Row
    │   ├── Battery mix: 3-segment bar (compact / mid / SUV)
    │   └── Charge power: 2-segment bar (7kW / 11kW)
    └── SoC Spread Row
        └── Range slider (min–max arrival SoC)
```

### Data Model

**FleetConfig** (stored in `v2-config.ts`):
```
Each fleet configuration has:
- fleetSize: number of EVs (10–1,000)
- arrivalDist: list of {hour, percent} entries (14:00–23:00, sums to 100)
- departureDist: list of {hour, percent} entries (05:00–09:00, sums to 100)
- batteryMix: three percentages for compact/mid/SUV (sum to 100)
- chargePowerMix: percentage of fleet at 7kW vs 11kW (sum to 100)
- socMin: minimum arrival SoC percentage (10–60)
- socMax: maximum arrival SoC percentage (10–60, ≥ socMin)

Stored in: React component state (useState in Step2ChargingScenario)
Not in URL — too complex for URL serialization
Persists within session only
```

**Default values** come from existing data already in the codebase:
- Arrival distribution: `PLUGIN_TIME_DIST` from FleetPortfolioCard
- Battery sizes: `VEHICLE_PRESETS` from v2-config.ts
- Fleet size: 100

### Tech Decisions

1. **New component `FleetConfigPanel`** — extracted to its own file (`src/components/v2/FleetConfigPanel.tsx`) rather than inline in Step2ChargingScenario (which is already ~2,900 lines). The panel is self-contained: receives `FleetConfig` + `onChange` callback.

2. **Draggable histogram bars** — built with native HTML divs + mouse/touch events (same drag pattern as the existing arrival/departure handle drag in the chart). No chart library needed for the config histograms — they're simple vertical bars with drag handles.

3. **No new dependencies** — range sliders use native `<input type="range">` styled with Tailwind. The 3-segment battery mix bar is a row of proportional `<div>` blocks with drag handles at boundaries.

4. **Fleet state lives alongside scenario state** — `Step2ChargingScenario` gets a new `useState<FleetConfig>` with defaults. The toggle state (`showFleet`, `fleetView: 'single' | 'fleet'`) are simple booleans.

5. **Mode gate** — fleet toggle renders in all modes but only activates in overnight mode. A visual hint (muted text) tells the user why it's inactive in fullday/3-day. No structural change to the mode system.

### Dependencies
- None (no new packages)

## QA Test Results

**Tested by:** QA Engineer (code review + build verification)
**Date:** 2026-04-02
**Build status:** PASS (production build succeeds, 0 TypeScript errors)
**Existing tests:** PASS (48/48 in savings-math.test.ts)

### Acceptance Criteria Results

#### Fleet Toggle
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | "Fleet" pill button in chart toolbar, next to "Renew." toggle | PASS | Rendered at line 1762-1770 in Step2ChargingScenario.tsx, positioned after Renew. toggle |
| 2 | Clicking toggles fleet mode on/off; active state matches Renew. style | PASS | Uses same pill pattern: white bg + shadow when active, gray text when inactive |
| 3 | Fleet config state persists when toggling off/on within session | PASS | `useState` holds FleetConfig; toggling `showFleet` does not reset `fleetConfig` |
| 4 | Sub-toggle for "Single EV" / "Fleet" overlay views when active | PASS | Lines 1773-1788, conditional rendering when `showFleet && !isFullDay` |

#### Fleet Configuration Panel
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Panel appears below chart when fleet active | PASS | Lines 2499-2506, inside CardContent |
| 2a | Fleet size slider 10-1000, logarithmic scale | PASS | Log slider with `Math.log10` transform, range 10-1000 |
| 2b | Arrival distribution histogram (14:00-23:00) | **FAIL** | Default data covers hours 14-22 only (9 entries). Spec requires 14:00-23:00 (10 hours). Hour 23 is missing from `DEFAULT_ARRIVAL_DIST`. Label says "14-22h" matching data but not spec. |
| 2c | Departure distribution histogram (05:00-09:00) | PASS | 5 entries, hours 5-9, label "Departure (5-9h)" |
| 2d | Battery mix 3-way segment bar (40/60/100 kWh) | PASS | SegmentBar with 3 segments, draggable dividers |
| 2e | Charge power mix toggle/slider (7kW/11kW) | PASS | SegmentBar with 2 segments |
| 2f | Arrival SoC spread min/max range slider (10%-60%) | PASS | Two `<input type="range">` sliders with clamping |

#### Distribution Editing
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Editable by dragging bar heights | PASS | Pointer events with capture in DistHistogram |
| 2 | Distributions always sum to 100% | PASS | Normalization logic at lines 50-58 |
| 3 | Reset to defaults via reset button | PASS | Reset button at line 71-77 |

#### Data Model
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | FleetConfig interface in v2-config.ts | PASS | Lines 117-125 |
| 2 | Fleet state in Step2ChargingScenario, not URL params | PASS | `useState<FleetConfig>` at line 111, not synced to URL |
| 3 | FleetConfig type exports cleanly for PROJ-36/37 | PASS | Imported by fleet-optimizer.ts and FleetConfigPanel.tsx |

#### Mode Scope
| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | Fleet only in overnight mode | PASS | `isFleetActive` requires `!isFullDay` (line 471) |
| 2 | Note shown in fullday/3-day mode | PASS | Title attribute shows "Fleet view available in overnight mode" + disabled + opacity-40 |

### Edge Cases Tested (Code Review)

| # | Case | Result | Notes |
|---|------|--------|-------|
| 1 | Fleet size = 1 | PASS | logToFleet(logMin) = 10, not 1. Min is 10 not 1. Spec says "should degenerate to approximately single-EV view" for size=1 but min is 10. Minor discrepancy with edge case description. |
| 2 | All arrivals at same hour | PASS | Single bar at 100%, normalization handles this |
| 3 | 100% one battery type | PASS | SegmentBar allows 100/0/0 splits |
| 4 | Extreme SoC: socMin = socMax | PASS | `socSamples` array has 1 entry when range=0 |

### Bugs Found

**BUG-35-1: Arrival distribution missing hour 23**
- Severity: Medium
- Description: Spec requires arrival distribution covering 14:00-23:00 (10 hours), but `DEFAULT_ARRIVAL_DIST` only covers hours 14-22 (9 entries). The label in FleetConfigPanel also says "14-22h" instead of "14-23h".
- Location: `src/lib/v2-config.ts` lines 127-137, `src/components/v2/FleetConfigPanel.tsx` line 232
- Steps to reproduce: Open fleet config panel, observe arrival histogram only shows hours 14-22
- Expected: 10 bars covering hours 14 through 23
- Actual: 9 bars covering hours 14 through 22
- Priority: P3 (functional but doesn't match spec; late arrivals at 23:00 cannot be modeled)

**BUG-35-2: Fleet size KPI missing from KPI row**
- Severity: Low
- Description: PROJ-37 spec says KPIs should include "Fleet size: '100 EVs'" but the KPI row in FleetConfigPanel only shows 4 columns: Fleet energy, Baseline, Optimized, Savings. Fleet size is already shown in the slider row above, so this is partially addressed but not in the KPI summary as specified.
- Location: `src/components/v2/FleetConfigPanel.tsx` lines 305-334
- Steps to reproduce: Activate fleet mode, observe KPI row
- Expected: KPI row includes fleet size label
- Actual: KPI row has 4 columns without explicit fleet size
- Priority: P4 (cosmetic, fleet size is visible in slider row)

**BUG-35-3: No input validation on fleet size slider value**
- Severity: Low
- Description: `logToFleet` uses `Math.pow(10, v)` which could theoretically produce values like 9.999... rounding to 10 or 1000.001 rounding to 1000. No explicit clamping to [10, 1000] range after rounding.
- Location: `src/components/v2/FleetConfigPanel.tsx` line 194
- Steps to reproduce: Drag slider to extreme ends
- Expected: Value always between 10 and 1000
- Actual: Likely fine due to input range constraints, but no defensive clamping
- Priority: P4 (defensive coding improvement)

### Security Audit
- No XSS vectors: No `dangerouslySetInnerHTML`, no `innerHTML`, no `eval`
- All data is client-side React state; no API calls from fleet features
- No user-provided strings rendered as HTML
- No sensitive data exposure
- **PASS** -- no security concerns

### Responsive Testing (Code Review)
- Panel uses Tailwind flex/grid layout
- `grid-cols-2` for battery/power mix may be too wide on 375px mobile -- needs visual verification
- Distribution histograms use `flex-1` which should adapt, but bar labels at 8px may be unreadable on mobile
- **Needs manual visual testing on device**

### Production Ready: CONDITIONAL
- 1 Medium bug (BUG-35-1) should be addressed before deployment
- 2 Low bugs are acceptable for initial release

## Deployment
_To be added by /deploy_
