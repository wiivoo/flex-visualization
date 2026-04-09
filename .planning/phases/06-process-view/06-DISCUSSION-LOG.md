# Phase 6: Process View — Chronological Optimization Timeline - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-09
**Phase:** 06-process-view
**Areas discussed:** Presentation mode, Timeline mechanism, Uncertainty & value drag, Data source

---

## Presentation Mode

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay on existing chart | Progressive reveal layers on top of normal chart | |
| Dedicated process view | Replaces normal chart temporarily | ✓ |
| Enhance TheoryOverlay | Use real data instead of synthetic in existing full-screen overlay | |

**User's choice:** Dedicated process view (option b)
**Notes:** Not an overlay on the existing chart, not a full-screen takeover. Replaces the chart area temporarily.

---

## Timeline Mechanism

| Option | Description | Selected |
|--------|-------------|----------|
| Stepper buttons | Click prev/next like TheoryOverlay | |
| Time-axis scrubber | Drag along time axis | ✓ |
| Scroll-driven reveal | Scroll to progress through stages | ✓ |
| Auto-play animation | Automatic playback | |

**User's choice:** Time-axis scrubber or scroll-driven reveal (either approach)
**Notes:** User wants it to feel like "walking along the timeline and it is revealed." Claude has discretion on which mechanism works best with Recharts.

---

## Uncertainty & Value Drag

| Option | Description | Selected |
|--------|-------------|----------|
| Show forecast cone | DA forecast uncertainty as widening/narrowing bands | |
| Scenario selector + waterfall | Pick scenario, see waterfall decomposition | ✓ |
| Static annotation only | Just label where uncertainty exists | |

**User's choice:** Scenario selector with waterfall value-drag visualization
**Notes:** Three scenarios (perfect foresight, realistic, worst case). User selects scenario → chart updates AND waterfall card shows decomposed value drag. Key factors: DA price forecast error, car availability error (plug-in time/SoC variance), intraday correction cost (forced trades). Currently dashboard shows "perfect world" — this feature is the reality check. User explicitly stated "I pick the scenario and then see the result on the waterfall."

---

## Data Source

| Option | Description | Selected |
|--------|-------------|----------|
| Actual real-time data | Use DA + intraday prices for selected date | ✓ |
| Synthetic/illustrative | Anchored to selected date but generated | |
| Hybrid | Real DA, synthetic intraday when unavailable | |

**User's choice:** Actual real-time data
**Notes:** Requires intraday data for full experience. Graceful fallback when intraday unavailable.

---

## Claude's Discretion

- Scrubber vs. scroll-driven UX (evaluate Recharts constraints)
- Exact uncertainty percentages for realistic/worst-case scenarios
- Waterfall chart implementation (Recharts stacked bar vs. custom SVG)
- Entry point for process view (button on chart vs. TheoryOverlay nav)

## Deferred Ideas

None
