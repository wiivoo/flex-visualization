# PROJ-13: Step 3 — The Value Waterfall (Breaking Down 430 EUR/year)

## Status: Planned
## Version: v2
## Priority: P0

## Overview
Shows the full revenue stack beyond day-ahead. Presented as an interactive waterfall chart that builds up from the day-ahead value (computed live in Step 2) through estimated additional layers. Each layer is explained in plain language with expandable detail cards. Includes a competitor comparison for market context.

The key message: the 430 EUR/year is not a magic number — it's built from 5 concrete, explainable value streams.

## User Story
As a **CEO**, I want to see all revenue streams stacked together in one clear chart with explanations for each, so that I understand the total business opportunity and can explain it to others.

## Acceptance Criteria

### Interactive Waterfall Chart
- [ ] **Bar 1 — Day-Ahead Load Shifting**: Actual value from Step 2 (green, animated)
- [ ] **Bar 2 — Forward Purchasing**: Estimated (lighter green), with range indicator
- [ ] **Bar 3 — Intraday Re-Optimization**: Estimated (teal), with range indicator
- [ ] **Bar 4 — Portfolio Effect**: Estimated (blue), with range indicator
- [ ] **Bar 5 — Grid Fee Reduction (§14a)**: Estimated (amber), with range indicator
- [ ] **Total bar**: Full annual value per EV (E.ON Red, bold)
- [ ] Connecting lines between bars showing cumulative build-up
- [ ] Animated bar-by-bar reveal on scroll/entry
- [ ] Hover on any bar → tooltip with range (conservative / realistic / optimistic)

### Explanation Cards (expandable per layer)
- [ ] **Day-Ahead**: "We shift charging to the cheapest hours of the day. The price difference is our steering value. Today's data shows X EUR per session."
- [ ] **Forward Purchasing**: "We buy baseload futures instead of expensive peakload products. The spread (currently ~8 EUR/MWh on EEX) translates to ~50 EUR/year per EV."
- [ ] **Intraday**: "After day-ahead procurement, we re-optimize as wind/solar forecasts update. Intraday spreads can reach 1,000+ EUR/MWh on extreme days."
- [ ] **Portfolio Effect**: "With thousands of EVs, our load forecast becomes 95% accurate. This cuts balancing energy costs by >70% (BCG estimate)."
- [ ] **§14a Grid Fees**: "Customers with registered wallboxes get ~165 EUR/year in reduced grid fees — a tangible, guaranteed benefit."

### Value Split View
- [ ] Toggle: "Total Value" / "Who Gets What"
- [ ] Customer receives: §14a (full pass-through) + share of day-ahead savings
- [ ] E.ON keeps: remaining day-ahead margin + forward/intraday/portfolio
- [ ] Visual: stacked bar split into two colors (customer green, E.ON blue)
- [ ] "Win-Win" framing: both sides benefit

### Competitor Comparison Panel
- [ ] Side panel or bottom section with benchmarks:
  - Octopus Energy: 450 EUR/year (smart tariff, V1G)
  - The Mobility House: 650+ EUR/year (V2G, needs hardware)
  - Sonnen: 250 EUR/year (VPP + grid)
  - 1KOMMA5: 2,201 EUR/year (full system, not comparable)
- [ ] E.ON position highlighted: "Competitive with Octopus, no special hardware needed"

### KPIs
- [ ] Total value per EV/year: ~430 EUR (realistic)
- [ ] Customer benefit: ~215-265 EUR/year
- [ ] E.ON margin: ~110-390 EUR/year
- [ ] Conservative / Realistic / Optimistic scenario toggle

### Storytelling
- [ ] Headline: "The full value lever — more than just day-ahead"
- [ ] Subtext: "From one charging session to annual value per EV"
- [ ] Callout: "Our 430 EUR/year is competitive with Octopus (450 EUR) — without V2G hardware"
- [ ] Transition: "What happens with 10,000 or 100,000 vehicles?"

## Technical Notes
- Day-ahead bar uses live data from Step 2 optimization result
- Other bars use configurable estimates:
  - Forward: 30-80 EUR/year (default: 50)
  - Intraday: 10-50 EUR/year (default: 25)
  - Portfolio: 20-60 EUR/year (default: 40)
  - §14a: 110-190 EUR/year (default: 165)
- Recharts BarChart with waterfall pattern (invisible connector bars)
- Expandable cards: shadcn/ui Collapsible or Accordion
