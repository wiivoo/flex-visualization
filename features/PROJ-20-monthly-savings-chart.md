# PROJ-20: Monthly Savings Chart

## Status: Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 1541–1670)

## Description

Bar chart showing monthly savings potential over the last 12 months, with a cumulative line overlay and seasonal color coding.

## Computation

For each day in the trailing 365-day window:
1. Build the overnight (or full day) price window
2. Compute savings = baseline avg − optimized avg, times energy per session
3. Aggregate by month: average savings/session × plug-in days per month

## Visual Elements

- **Bars**: Monthly EUR savings, colored by season (winter=blue, spring=green, summer=yellow, autumn=orange)
- **Season background bands**: Light colored reference areas behind bars
- **Cumulative line**: Dashed dark line on right Y-axis showing running total
- **Season legend**: Bottom row with colored squares
- **Cumulative annotation**: Total EUR ≈ annual EUR/yr

## Collapsible Methodology Section

Shows: avg savings/session × sessions/year = annual EUR.
Displays monthly EUR breakdown.
