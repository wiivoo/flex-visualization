---
phase: 06-process-view
plan: 02
subsystem: process-view
tags: [chart, waterfall, fleet, ui, visualization]
dependency_graph:
  requires: [process-view-engine, process-view-chart, optimizer, fleet-optimizer]
  provides: [waterfall-card, process-view-fleet-overlays]
  affects: [Step2ChargingScenario, ProcessViewChart]
tech_stack:
  added: []
  patterns: [lifted-computation, waterfall-stacked-bar, fleet-portfolio-visualization]
key_files:
  created:
    - src/components/v2/WaterfallCard.tsx
  modified:
    - src/components/v2/ProcessViewChart.tsx
    - src/components/v2/steps/Step2ChargingScenario.tsx
decisions:
  - Lifted computeProcessViewResults from ProcessViewChart to Step2 useMemo for single computation shared by chart and WaterfallCard
  - Recharts Bar label typed via cast to never to bypass strict Recharts 3.7 generics (same pattern as plan 01)
  - WaterfallCard placed inside right content column below chart, before savings overview section
metrics:
  duration: 290s
  completed: 2026-04-09T08:25:31Z
  tasks: 2/2 (task 3 is checkpoint:human-verify, awaiting verification)
  files_created: 1
  files_modified: 2
---

# Phase 6 Plan 2: WaterfallCard + Fleet Overlays + Step2 Integration Summary

Waterfall value-drag decomposition card with Recharts stacked bars (Perfect -> DA Error -> Avail. Error -> ID Cost -> Realized), fleet dual-series portfolio effect visualization, and lifted process view computation for shared data flow.

## What Was Built

### Task 1: WaterfallCard component (eaeb09c)

Created `src/components/v2/WaterfallCard.tsx` (227 lines) -- a `'use client'` component that renders:

- **Recharts ComposedChart waterfall** using invisible-offset stacked bars technique (`fill="transparent"` base bar + visible value bar with `<Cell>` per-bar coloring)
- **5 bars in order:** Perfect (emerald), DA Error (red), Avail. Error (red), ID Cost (red), Realized (emerald)
- **Fleet mode:** second grouped bar series (`fleetStack`) with blue fills showing visibly shorter drag bars (sqrt(N) portfolio effect from plan 01 computation)
- **Bar labels:** inside bars when absValue >= 0.3 ct/kWh, white text, `tabular-nums`, +/- prefix
- **Footer:** Single EV (gray dot) + Fleet (blue dot) legend, realized vs. perfect summary line
- **Portfolio effect note:** "sqrt(N) portfolio effect reduces uncertainty per car" (fleet mode only)
- **Animations:** 200ms ease-out bar height transitions via Recharts `isAnimationActive`/`animationDuration`

### Task 2: Step2 wiring + ProcessViewChart refactor (5e97aa3)

**ProcessViewChart refactor:**
- Removed internal `computeProcessViewResults` useMemo and `uncertaintyScenario` state
- Added external props: `processResult`, `uncertaintyScenario`, `onUncertaintyChange`, `currentStage`, `onStageChange`
- Kept fleet flex band overlay (`fill="#DBEAFE"`, `fillOpacity={0.3}`)
- Stage navigation now uses callbacks to parent instead of local state

**Step2ChargingScenario updates:**
- Added `uncertaintyScenario` state (default: 'realistic')
- Added `processStage` state (default: 'forecast')
- Added `processResult` useMemo calling `computeProcessViewResults()` -- guarded by `showProcessView` to avoid unnecessary computation (threat mitigation T-06-03)
- WaterfallCard rendered conditionally below chart when process view active
- Process stage resets to 'forecast' when toggling process view on

### Task 3: Human verification checkpoint (pending)

Awaiting human verification of end-to-end process view experience (stages, scenarios, waterfall, fleet mode, toggle).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Recharts Bar label prop type mismatch**
- **Found during:** Task 1
- **Issue:** Recharts 3.7 strict `Bar` label prop typing rejects custom render functions with typed parameters
- **Fix:** Cast label function via `as never` (same pattern established in plan 01)
- **Files modified:** src/components/v2/WaterfallCard.tsx
- **Commit:** eaeb09c

## Known Stubs

None. WaterfallCard receives real computed data from `computeProcessViewResults()`. All waterfall bars reflect actual optimization results.

## Threat Flags

None. No new trust boundaries or network endpoints introduced.

## Self-Check: PASSED

- [x] src/components/v2/WaterfallCard.tsx exists (227 lines, > 100 min)
- [x] Commit eaeb09c exists
- [x] Commit 5e97aa3 exists
- [x] WaterfallCard starts with 'use client'
- [x] WaterfallCard imports from @/components/ui/card
- [x] WaterfallCard contains 'Value Breakdown' heading
- [x] WaterfallCard contains fill="transparent" (invisible base bar)
- [x] WaterfallCard contains #10B981 (emerald) and #EF4444 (red)
- [x] WaterfallCard contains 'portfolio effect' text
- [x] WaterfallCard contains animationDuration and isAnimationActive
- [x] WaterfallCard contains tabular-nums
- [x] ProcessViewChart contains processResult in Props
- [x] ProcessViewChart contains computeFlexBand import
- [x] ProcessViewChart contains fill="#DBEAFE"
- [x] Step2 contains import { WaterfallCard }
- [x] Step2 contains import { computeProcessViewResults
- [x] Step2 contains uncertaintyScenario state
- [x] Step2 contains processStage state
- [x] Step2 contains <WaterfallCard JSX
- [x] Step2 contains processResult useMemo
- [x] npx tsc --noEmit produces zero errors
