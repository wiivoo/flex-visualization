# PROJ-14: Step 4 — The Portfolio Scale

## Status: Planned
## Version: v2
## Priority: P0

## Overview
Scales the per-EV value from Step 3 to a fleet. Interactive logarithmic slider from 1 to 100,000 EVs shows how revenue grows — including the non-linear portfolio effect.

## User Story
As a **CEO**, I want to see how the total annual revenue scales with fleet size, so that I understand the business case at different growth stages and can set targets.

## Acceptance Criteria

### Portfolio Slider
- [ ] Logarithmic slider: 1 → 100 → 1,000 → 10,000 → 50,000 → 100,000 EVs
- [ ] Quick-select buttons for key milestones
- [ ] Direct number input for precise values
- [ ] Slider updates all visuals in real-time

### Revenue Projection Chart
- [ ] Stacked area chart: revenue by stream as fleet grows
- [ ] X-axis: number of EVs (log scale)
- [ ] Y-axis: annual revenue in EUR (switching to millions at scale)
- [ ] Each layer colored consistently with Step 3 waterfall
- [ ] Portfolio bonus visible: curve bends upward slightly (sqrt(N) effect)

### Milestone Markers
- [ ] 1,000 EVs: "Reliable forecasting, reduced balancing costs"
- [ ] 10,000 EVs: "Market access to balancing energy markets"
- [ ] 50,000 EVs: "Virtual power plant — equivalent to X wind turbines in flexibility"
- [ ] 100,000 EVs: "Major market participant, significant grid stabilization"

### KPIs (live with slider)
- [ ] Annual Total Value: X million EUR
- [ ] Customer Benefit: X million EUR
- [ ] E.ON Margin: X million EUR
- [ ] Flexibility Capacity: X MW (N × avg wallbox power)
- [ ] Equivalent comparison: "Like X wind turbines in flexibility capacity"

### Context Panel
- [ ] Market sizing: "Less than 20% of available flexibility is monetized today" (BCG)
- [ ] German EV stock: ~2.5 million BEVs and growing
- [ ] Competitor reference: "1KOMMA5 has already connected 500 MW"
- [ ] TAM calculation: total addressable market in Germany

### Storytelling
- [ ] Headline: "The scaling effect — from one car to a virtual power plant"
- [ ] Show the compounding value of aggregation
- [ ] Transition: "Why now? The market is ready."

## Technical Notes
- Pure client-side calculation, no API calls
- Revenue = N × per_EV_value + portfolio_bonus(N)
- Portfolio bonus: sqrt(N) * base_improvement_factor
- Recharts AreaChart with logarithmic X-axis
