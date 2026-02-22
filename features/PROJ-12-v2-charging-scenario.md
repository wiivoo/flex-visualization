# PROJ-12: Step 2 — The Charging Scenario (Interactive Load Shifting)

## Status: Planned
## Version: v2
## Priority: P0

## Overview
The interactive core of v2. The viewer configures an EV charging scenario and sees in real-time how load shifting creates value. Two charging profiles are overlaid on the price curve: baseline ("charge immediately") vs. optimized ("charge at cheapest hours"). The shaded area between them is the net steering value — the money.

This is THE graph that makes the concept click for a CEO.

## User Story
As a **CEO**, I want to interactively adjust charging parameters and immediately see how shifting charging to cheap hours creates measurable savings, so that I understand the core mechanism of flexibility monetization.

## Acceptance Criteria

### Interactive Controls (sliders with live preview)
- [ ] **Plug-in time**: 14:00-23:00 (default: 18:00), draggable slider
- [ ] **Departure time**: 04:00-10:00 (default: 07:00), draggable slider
- [ ] **Vehicle preset**: Compact (40 kWh/11 kW) / Mid (60 kWh/22 kW) / SUV (100 kWh/22 kW)
- [ ] **Start charge level**: 10%-80% (default: 20%)
- [ ] **Target charge level**: 50%-100% (default: 80%)
- [ ] All changes update visualization instantly (<100ms perceived latency)

### Core Visualization — The Load Shifting Graph
- [ ] X-axis: Time from plug-in to departure (e.g., 18:00-07:00)
- [ ] Y-axis: Price (ct/kWh or EUR/MWh, toggleable)
- [ ] **Price curve** as background line (blue/dark)
- [ ] **Baseline charging blocks** (red/orange bars): sequential from plug-in time
- [ ] **Optimized charging blocks** (green bars): cheapest hours within window
- [ ] **Shaded difference area** between baseline cost line and optimized cost line
- [ ] Clear visual: red blocks are "what you'd pay without us", green blocks are "what you pay with us"
- [ ] Arrows or annotations pointing out the savings

### Cost Breakdown (live-updating panel)
- [ ] Cost without optimization: XX.XX EUR
- [ ] Cost with optimization: XX.XX EUR
- [ ] **Savings: XX.XX EUR** (large, highlighted, animated on change)
- [ ] Average price baseline: XX.X ct/kWh
- [ ] Average price optimized: XX.X ct/kWh
- [ ] Charging duration: X hours
- [ ] Optimal charging window: HH:MM - HH:MM
- [ ] Energy charged: XX kWh

### Per-Session to Annual Projection
- [ ] "Per charge session" → "Per week" → "Per year" toggle
- [ ] Assumption: 3-4 sessions/week, ~4,000 kWh/year
- [ ] Annual day-ahead value prominently displayed
- [ ] "This is just Layer 1 of 5 value streams" teaser

### Storytelling Elements
- [ ] Headline: "Charge when electricity is cheap"
- [ ] Plain-language explanation: "The red bars show charging at peak prices. The green bars show our optimized schedule."
- [ ] Callout: "Net steering value: X EUR per charge — X EUR per year"
- [ ] Negative price highlight: "On this day, we'd get paid to charge" (when applicable)
- [ ] Transition: "But day-ahead is just the beginning — there are more value drivers"

### Edge Cases
- [ ] Flat price days (low spread): show "Low spread today — value varies by day"
- [ ] Negative prices: highlight "We get paid to charge during these hours"
- [ ] Insufficient window: warn "Car can't reach target charge in this time window"
- [ ] Weekend vs. weekday patterns noted

## Technical Notes
- Reuse/adapt optimization algorithm from v1 (`src/lib/optimizer.ts`)
- 15-minute resolution for charging blocks
- Price data from Step 1's selected day (carried via state/URL)
- Recharts ComposedChart: Bar (baseline) + Bar (optimized) + Line (price) + ReferenceArea
- Controls: shadcn/ui Slider + Select components
