# PROJ-22: Savings Potential Box

**Status:** Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 902–933)

## Description

Hero KPI card in the top-right corner showing the annual savings potential as a large animated number, derived from the rolling 12-month average.

## Metrics Displayed

- **Annual Savings**: Large animated EUR value (rolling 365-day average × sessions/year)
- **Avg Spread**: ct/kWh average price difference between baseline and optimized
- **Context**: Overnight/full day mode, rolling 12 months, sessions/year

## Computation

1. For each day in trailing 365 days: compute overnight savings (baseline − optimized)
2. Average daily savings × (weeklyPlugIns × 52) = annual savings
3. Spread = annual savings / sessions / energyPerSession × 100
