# PROJ-15: Step 5 — The Market Context

## Status: Planned
## Version: v2
## Priority: P1

## Overview
Provides the macro context: why now? Shows 3-year trend of increasing volatility, seasonal patterns, growing negative price hours, regulatory tailwinds, and competitive landscape. Helps the viewer interpret when the opportunity is biggest throughout the year.

## User Story
As a **CEO**, I want to see that the market opportunity is growing structurally and understand the seasonal dynamics, so that I'm confident this is a secular trend, not a one-time opportunity.

## Acceptance Criteria

### Volatility Trend (3-Year SMARD Data)
- [ ] Monthly average daily spread (2023-2025): line chart, trend line overlay
- [ ] Monthly negative price hours: bar chart, year-over-year comparison
- [ ] Monthly average price with min/max bands (area chart)
- [ ] Clear upward trend annotation: "Volatility is increasing — more renewables = more swings"

### Seasonal Opportunity Map
- [ ] Heatmap: months (Y) × hours (X), color = average price
- [ ] Shows: summer midday = cheap (solar), winter evening = expensive
- [ ] Annotation: "The biggest optimization window is October-March (winter)"
- [ ] Annotation: "Summer midday offers negative prices for opportunistic charging"
- [ ] Monthly boxplot of daily spreads showing seasonal variation

### Key Market Statistics
- [ ] 2023: X avg spread, X negative hours
- [ ] 2024: 117 EUR/MWh avg spread, 459 negative hours
- [ ] 2025: 130 EUR/MWh avg spread, 575+ negative hours
- [ ] Maximum price 2025: 583 EUR/MWh (Jan 20)
- [ ] Minimum price 2025: -250 EUR/MWh (May 11)
- [ ] Year-over-year comparison table

### Regulatory Drivers Timeline
- [ ] 2024: §14a EnWG takes effect (controllable devices)
- [ ] 2025: Dynamic tariffs mandatory for all suppliers
- [ ] 2025 Oct: 15-minute day-ahead products on EPEX
- [ ] 2026: Smart meter rollout acceleration
- [ ] Visual timeline with milestones

### Competitive Landscape
- [ ] Positioning chart: X = annual value per EV, Y = hardware requirement
- [ ] Octopus (450 EUR, low hardware), Mobility House (650 EUR, V2G hardware), Sonnen (250 EUR, battery), 1KOMMA5 (2,201 EUR, full system)
- [ ] E.ON positioned as: "competitive value, minimal hardware"
- [ ] Market share narrative: "<20% monetized = massive opportunity"

### Storytelling
- [ ] Headline: "Why now? — The market is ready"
- [ ] Closing: "Flexibility is the next major value creation layer in the energy market"
- [ ] Summary card: key numbers from all 5 steps
- [ ] Option to restart from Step 1 with different scenario

## Technical Notes
- Aggregated from 3-year SMARD/aWATTar dataset (precomputed in Supabase)
- Monthly/yearly stats calculated server-side
- Static regulatory and competitor data hardcoded
- Recharts: multiple chart types (line, bar, heatmap, area)
