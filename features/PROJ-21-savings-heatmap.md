# PROJ-21: Savings Sensitivity Heatmap

## Status: Deployed
**Location:** `src/components/v2/steps/Step2ChargingScenario.tsx` (lines 1686–1795)

## Description

Matrix visualization showing how yearly savings vary across different mileage × plug-in frequency combinations, helping users understand the sensitivity of the business case.

## Axes

- **Rows**: Yearly mileage (5k, 10k, 15k, 20k, 25k, 30k, 35k, 40k km)
- **Columns**: Weekly plug-ins (1x through 7x)
- **Cell value**: EUR/yr savings (or ct/kWh spread, togglable)

## Controls

- **Unit toggle**: EUR/yr vs ct/kWh
- **Vertical plug-in time slider**: 14:00–22:00, recalculates the entire matrix

## Visual

- Green intensity scale based on value relative to maximum
- Current user profile highlighted with red ring
- Active row/column headers highlighted in red
- Tooltip shows full details (km, sessions, kWh/session, EUR/yr, ct/kWh)

## Computation

Uses last 12 months of hourly data. For each (mileage, plug-ins) pair, derives energy per session, computes baseline vs optimized for every overnight window, averages, and scales to annual.
