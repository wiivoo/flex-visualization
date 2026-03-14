# PROJ-29: V2G Dual Value Streams (Load Shifting + Arbitrage)

**Status:** Planned
**Priority:** High
**Depends on:** PROJ-2, PROJ-12, PROJ-20

## Problem

V2G mode currently only calculates **arbitrage profit** (buy low, sell high). It ignores the **load shifting benefit** — the cost savings from charging the net energy (startSoC → targetSoC) at optimal times instead of immediately at plug-in. This undervalues V2G and makes V1G/V2G comparison misleading.

## Solution

Decompose V2G benefits into two distinct, additive value streams:

```
V2G Total Benefit = Load Shifting Benefit + Arbitrage Uplift

Load Shifting Benefit:
  = baseline_charge_cost − optimized_charge_cost
  where both are for NET energy only (startSoC → targetSoC)
  Baseline = charge immediately at plug-in (same as V1G baseline)

Arbitrage Uplift:
  = discharge_revenue − recharge_cost − degradation − efficiency_losses
  Only for EXTRA cycling beyond the net charge
  Existing SoC discharged = sunk cost (no cost basis applied)
```

## Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| V2G baseline | Same as V1G (charge immediately) | Direct V1G↔V2G comparison |
| Cost basis of existing SoC | Sunk cost / free | Energy already in battery; only degradation + efficiency matter |
| Load shifting scope | Net energy only (startSoC→targetSoC) | Clean separation; recharge after discharge belongs to arbitrage |
| Time ordering | Enforce chronological order | Discharge only after sufficient charge; realistic, not theoretical max |
| Display | Expandable detail | One headline total, collapsible split showing load shifting + arbitrage |
| Charts (monthly/yearly) | Stacked bars | Green = load shifting, blue = arbitrage; shows both and total |

## Algorithm Changes

### `computeV2gWindowSavings()` in `charging-helpers.ts`

Current algorithm:
1. Reserve cheapest slots for net charge
2. Greedy arbitrage pairing (cheapest buy ↔ most expensive sell)

New algorithm:
1. **Compute V1G baseline**: cost of charging net energy immediately at plug-in prices
2. **Compute V1G optimized**: cost of charging net energy at cheapest available slots
3. **Load Shifting Benefit** = (1) − (2)
4. **Enforce chronological ordering** for arbitrage:
   - Build a time-ordered SoC trajectory
   - At each slot, decide: charge (if price is low) or discharge (if price is high and SoC > minSoC)
   - Discharge can only happen when current SoC > minSoC AND energy was previously charged
   - Track charge/discharge pairs with timestamps
5. **Arbitrage Uplift** = Σ(discharge_revenue) − Σ(recharge_cost) − degradation − efficiency_losses
   - Only count cycling beyond the net charge
6. **Total Benefit** = Load Shifting Benefit + Arbitrage Uplift

### SoC Trajectory (new, for chronological enforcement)

```typescript
interface SocTrajectoryPoint {
  timestamp: number;
  socPercent: number;
  action: 'charge' | 'discharge' | 'idle';
  priceCtKwh: number;
  energyKwh: number;
}
```

Walk through slots chronologically:
- Start at `startSocPercent`
- For each slot, greedily decide action based on price threshold
- Never go below `minSocPercent`, never above 100%
- Must reach `targetSocPercent` by departure

### Return type changes

```typescript
interface V2gResult {
  // Existing fields (keep)
  chargeSlots: number[];
  dischargeSlots: number[];
  profitEur: number;              // now = total benefit (load shifting + arbitrage)
  degradationCostEur: number;

  // New fields
  loadShiftingBenefitEur: number; // V1G-equivalent savings on net charge
  arbitrageUpliftEur: number;     // extra profit from cycling
  baselineChargeCostEur: number;  // what immediate charging would cost
  optimizedChargeCostEur: number; // what smart charging costs for net energy
  socTrajectory: SocTrajectoryPoint[];
  totalCyclesCompleted: number;
}
```

## UI Changes

### Session Cost Card (`SessionCostCard.tsx`)

In V2G mode, show:
- **Headline**: Total benefit (€) — large number
- **Expandable detail**:
  - Load Shifting: €X.XX (baseline €Y.YY → optimized €Z.ZZ for N kWh net charge)
  - Arbitrage: €X.XX (M cycles, N kWh discharged, degradation €D.DD)

### Monthly Savings Card (`MonthlySavingsCard.tsx`)

- Stacked bars: green bottom segment = load shifting, blue top segment = arbitrage
- Legend labels: "Load Shifting" / "Arbitrage"
- Cumulative line shows total (both streams combined)
- Tooltip shows breakdown per month

### Yearly Savings Card (`YearlySavingsCard.tsx`)

- Same stacked bar approach
- Total headline, breakdown in tooltip

### Savings Heatmap (`SavingsHeatmap.tsx`)

- Cell value = total benefit (both streams)
- No split needed in heatmap (too complex for matrix cells)

### Chart (`Step2ChargingScenario.tsx`)

- Keep existing green (charge) / blue (discharge) dots
- No changes to chart visualization itself

## Acceptance Criteria

- [ ] V2G mode shows total benefit = load shifting + arbitrage uplift
- [ ] Load shifting benefit uses identical baseline as V1G (charge immediately at plug-in)
- [ ] Load shifting scope is net energy only (startSoC → targetSoC)
- [ ] Existing SoC at plug-in treated as sunk cost (no cost basis)
- [ ] Chronological ordering enforced: discharge only after prior charge
- [ ] Expandable detail in cost card shows both value streams
- [ ] Monthly chart uses stacked bars (green = load shifting, blue = arbitrage)
- [ ] Yearly chart uses stacked bars (same color scheme)
- [ ] V2G total benefit >= V1G savings (always, by construction)
- [ ] URL state unchanged (no new URL params needed)
- [ ] Edge case: when startSoC >= targetSoC, load shifting = €0, only arbitrage shown
- [ ] Edge case: when no profitable arbitrage pairs exist, only load shifting shown (same as V1G)

## Files to Modify

| File | Changes |
|------|---------|
| `src/lib/charging-helpers.ts` | Add baseline/optimized calc for net charge; enforce time ordering; return split metrics |
| `src/components/v2/SessionCostCard.tsx` | Expandable detail with load shifting + arbitrage breakdown |
| `src/components/v2/MonthlySavingsCard.tsx` | Stacked bars (green + blue) |
| `src/components/v2/YearlySavingsCard.tsx` | Stacked bars (green + blue) |
| `src/lib/v2-config.ts` | Extended V2gResult type |

---

## Tech Design (Solution Architect)

### No backend changes needed
All data is computed client-side from price data already in memory. No new API routes, no Supabase tables.

### Component Tree (V2G mode)

```
Step2ChargingScenario.tsx  [orchestrator — reads gridMode, calls optimizer]
│
├── computeV2gWindowSavings()         ← MODIFIED: returns split fields
│     ├── loadShiftingBenefitEur      ← NEW: V1G-equivalent savings on net charge
│     ├── arbitrageUpliftEur          ← NEW: profit from cycling only
│     ├── baselineChargeCostEur       ← NEW: cost if charged immediately
│     ├── optimizedChargeCostEur      ← NEW: cost at cheapest slots for net energy
│     └── profitEur                   ← KEPT: total = loadShifting + arbitrage
│
├── SessionCostCard.tsx               ← MODIFIED: V2G layout variant
│     ├── Headline total benefit (€)
│     └── Expandable breakdown
│           ├── Load Shifting row (green)
│           └── Arbitrage Uplift row (blue)
│
├── MonthlySavingsCard.tsx            ← MODIFIED: stacked bars
│     ├── Bar "loadShiftingEur" (green, bottom)
│     ├── Bar "arbitrageEur"   (blue, top)
│     └── Line cumulative total (unchanged)
│
└── YearlySavingsCard.tsx             ← MODIFIED: stacked bars (same pattern)
      ├── Segment "loadShiftingEur" (green)
      └── Segment "arbitrageEur"   (blue)
```

---

### Data Model Changes (plain language)

**What `computeV2gWindowSavings()` returns — new fields added:**

| Field | Type | What it means |
|-------|------|---------------|
| `loadShiftingBenefitEur` | number | Savings from timing the net charge (same as V1G would give) |
| `arbitrageUpliftEur` | number | Extra profit from discharge+recharge cycles only |
| `baselineChargeCostEur` | number | What charging immediately at plug-in would cost |
| `optimizedChargeCostEur` | number | What the net charge costs when shifted to cheapest slots |
| `profitEur` | number | **Unchanged field, new meaning**: total = loadShifting + arbitrage |

Existing fields (`chargeSlots`, `dischargeSlots`, `chargeAvgCt`, etc.) are all preserved for chart rendering.

**What `MonthlySavingsEntry` gains:**

| Field | Type | What it means |
|-------|------|---------------|
| `loadShiftingEur` | number | Monthly load shifting portion |
| `arbitrageEur` | number | Monthly arbitrage portion |

`savings` stays as the total (sum of both) for backward compatibility.

---

### Algorithm Change (time-ordered arbitrage)

Current arbitrage: sort all prices, pair cheapest buy with most expensive sell regardless of when they occur in time.

New arbitrage:
1. Walk all window slots in **chronological order**
2. Track real SoC at each slot (starts at `startSocPercent`)
3. At each slot: charge if price ≤ lower threshold AND SoC < 100%; discharge if price ≥ upper threshold AND SoC > minSoc
4. Price thresholds determined by the window's price distribution (e.g. bottom/top quartile)
5. Only count a discharge/recharge pair as "arbitrage" if the net energy at departure still meets `targetSocPercent`

This ensures discharge can only happen when energy was previously charged — no time-travel pairing.

Load shifting for net energy uses existing `computeWindowSavings()` logic on the net kWh gap only.

---

### Key Design Constraints

- `profitEur` stays as the single summary number used throughout the codebase — backward compatible
- New split fields are additive: `profitEur = loadShiftingBenefitEur + arbitrageUpliftEur`
- If `startSoc >= targetSoc`, `loadShiftingBenefitEur = 0` (no net charge needed)
- If no profitable arbitrage cycles exist, `arbitrageUpliftEur = 0` (result matches V1G)
- Monthly/yearly entries gain two extra fields; existing `savings` field = their sum

---

### No New Dependencies

All existing packages already support stacked bars in Recharts (`<Bar stackId="v2g" />`). No new npm packages.

---

### Files Modified (no new files)

| File | Nature of Change |
|------|-----------------|
| `src/lib/charging-helpers.ts` | Extend `V2gResult` type + update `computeV2gWindowSavings()` |
| `src/components/v2/SessionCostCard.tsx` | V2G layout variant with expandable split |
| `src/components/v2/MonthlySavingsCard.tsx` | Stacked bars + updated entry type |
| `src/components/v2/YearlySavingsCard.tsx` | Stacked bars + updated entry type |
| `src/components/v2/steps/Step2ChargingScenario.tsx` | Propagate new fields to cards + monthly/yearly assembly |

---

## Out of Scope

- SoC trajectory visualization on the chart (future feature)
- Variable round-trip efficiency by SoC level
- Multi-day cycle limits
- Feed-in tariff / grid export compensation modeling
