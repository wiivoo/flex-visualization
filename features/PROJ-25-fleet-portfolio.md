# PROJ-25: Fleet Portfolio View

## Status: Deployed
**Created:** 2026-02-26
**Location:** `src/components/v2/FleetPortfolioCard.tsx`

## Description

A fleet-level analysis card that simulates aggregated charging behavior for 10–10,000 EVs with distributed arrival times and mileage profiles, demonstrating portfolio diversification effects.

## Features

### Fleet Size Slider
- Logarithmic scale: 10 → 10,000 EVs
- Displayed in card header alongside title
- All values update reactively

### Load Curve Chart
- Two overlapping `stepAfter` area curves (Recharts ComposedChart):
  - **Red dashed area**: Unmanaged/baseline charging (immediate start)
  - **Green solid area**: Optimized charging (shifted to cheapest hours)
- **Gray line**: Spot price on right Y-axis (ct/kWh)
- **Left Y-axis**: Fleet charging load in MW
- Gradient fills for both areas
- Tooltip shows price + both load values

### Fleet Savings Summary
- **Total fleet savings**: Smart formatting — `1,476` / `14.8k` / `1.24M` EUR/yr
- **Per EV average**: Animated number with EUR/yr
- **Average kWh/session**: Weighted across mileage buckets
- **Portfolio effect**: Percentage vs. single-arrival baseline
- **Diversification realization**: `1 - exp(-fleetSize / 150)` — exponential saturation curve

### Arrival Distribution
- 9 time slots (14:00–22:00) with percentage bars
- Muted uniform gray (`#313131/20`) for all bars
- Shows EV count per slot scaled by fleet size
- Based on BDEW smart-meter research (peak at 18:00 = 27%)

### Mileage Distribution
- Toggle button: "Distributed" (KBA mix) vs "Uniform" (all EVs at slider value)
- When distributed: 6 mileage buckets (5–10k through 30–40k km/yr)
- Each bucket shows: share %, kWh/session derived from its average mileage
- Computation weights savings across all mileage × arrival combinations

## Performance

- Pre-indexes prices by date in a `Map`
- Samples ~50 dates (every Nth) for annual savings instead of all ~700
- Splits computation: fleet-size-independent `coreData` (expensive) vs fleet-size-dependent `fleetData` (cheap multiplication)
- Moving the fleet slider only triggers `fleetData` recomputation

## Portfolio Effect Model

```
realizationFactor = 1 - exp(-fleetSize / 150)
```

| Fleet Size | Realization |
|-----------|-------------|
| 10 EVs | ~6% |
| 50 EVs | ~28% |
| 100 EVs | ~49% |
| 500 EVs | ~96% |
| 1,000+ EVs | ~99%+ |

The portfolio effect represents the savings uplift from distributed arrival times vs. all EVs arriving simultaneously at 18:00.

## Computation Flow

1. **Per arrival hour** (14–22h): Build overnight window, compute savings weighted across mileage buckets
2. **Daily chart data**: For each hour, sum optimized/baseline load fractions across all arrival slots
3. **Annual estimate**: Sample ~50 dates, compute single-arrival and distributed-arrival average daily savings
4. **Fleet scaling**: Multiply load by fleet size (kW → MW), apply portfolio realization factor to per-EV savings
