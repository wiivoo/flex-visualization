# PROJ-11: Step 1 — The Price Curve (Price Explorer)

## Status: Planned
## Version: v2
## Priority: P0

## Overview
The opening screen of the v2 storytelling flow. Introduces the viewer to German electricity price volatility using real SMARD/aWATTar data. The goal: make it viscerally clear that prices swing wildly every single day — and that this volatility is the raw material for flexibility monetization. Also shows how volatility varies by season.

## User Story
As a **CEO**, I want to see real electricity price data and immediately understand that prices vary dramatically hour by hour and season by season, so that I grasp why "buying smart" matters.

## Acceptance Criteria

### Data
- [ ] Interactive calendar showing 3 years of day-ahead prices (2023-2025)
- [ ] Click any day → see 24-hour price curve
- [ ] Calendar cells color-coded by daily spread (volatility)
- [ ] Current/most recent day auto-selected on load
- [ ] Data from aWATTar API (primary) with SMARD fallback

### Core Visualization — Daily Price Chart
- [ ] Line chart: X = hours (00:00-23:00), Y = EUR/MWh
- [ ] Highlight cheapest hour (green) and most expensive hour (red)
- [ ] Average price reference line (dashed)
- [ ] Gradient fill below curve
- [ ] Animated line drawing on day selection

### Volatility Seasonality View
- [ ] Monthly heatmap: rows = months, columns = hours → color = avg price
- [ ] Shows summer midday solar dips vs. winter evening peaks
- [ ] Monthly bar chart: average daily spread by month
- [ ] Annotation: "Summer months show low midday prices (solar surplus)"
- [ ] Annotation: "Winter evenings show highest prices (heating + dark)"

### KPIs (animated counters)
- [ ] Daily Spread: X EUR/MWh (max - min)
- [ ] Average Price: X ct/kWh
- [ ] Negative Price Hours (this year): X
- [ ] Best Hour / Worst Hour with timestamps

### Storytelling Elements
- [ ] Headline: "Electricity prices fluctuate — every hour, every day"
- [ ] Subtext: "Real EPEX Spot day-ahead prices for the German market"
- [ ] Insight callout: "On this day, the price swing was X EUR/MWh"
- [ ] Seasonal insight: "Volatility peaks in Q1 and Q4 — winter is the biggest opportunity"
- [ ] Transition: "What if we shift EV charging to the cheapest hours?"

### Navigation
- [ ] "Next" button → Step 2 (Charging Scenario)
- [ ] Step indicator showing 1/5
- [ ] Selected day carries forward to Step 2

## Technical Notes
- Primary data source: aWATTar API (`api.awattar.de/v1/marketdata`)
- Fallback: SMARD API with corrected URL pattern
- Cache all prices in Supabase on first load
- Calendar: custom grid with Tailwind, color-coded cells
- Chart: Recharts ComposedChart (Line + Area + ReferenceLine)
