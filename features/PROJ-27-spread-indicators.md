# PROJ-27: Spread Indicators Panel

## Status: Planned
**Created:** 2026-02-27
**Last Updated:** 2026-02-27

## Dependencies
- PROJ-1 (SMARD Data Integration) — price data required
- PROJ-12 (Interactive Price Chart) — host component
- PROJ-18 (Mini Calendar) — selected date drives weekend/overnight spreads
- PROJ-2 (Price Optimization Engine) — plugInTime/departureTime from ChargingScenario

---

## Overview

A new panel showing three contextual spread indicators for the selected day, plus a 12-month rolling historical breakdown. Each indicator has **two dimensions**:

1. **Market Spread** (ct/kWh) = max(window prices) − min(window prices). Raw market opportunity, independent of vehicle.
2. **Capturable Savings** (EUR) = baseline cost − optimized cost for the user's actual ChargingScenario (energy per session, charge power). Uses the same `computeWindowSavings()` logic as the existing optimization engine.

---

## User Stories

- As a fleet operator, I want to see the overnight market spread so I know today's price range for each overnight session.
- As a user, I want to see my capturable savings alongside the market spread so I understand what I actually earn vs. what the market offers.
- As a user, I want to see the weekend spread on Fridays so I can decide whether to defer or split charging across the weekend.
- As a user, I want the weekly spread to understand how much better I could do if I could defer charging by up to 7 days.
- As an analyst, I want a 12-month breakdown of both market spreads and capturable savings to understand seasonal patterns.

---

## Acceptance Criteria

### Overnight Spread
- [ ] Window: `plugInTime` → `departureTime` next morning (both from ChargingScenario)
- [ ] **Market Spread**: max(hourly prices) − min(hourly prices), in ct/kWh
- [ ] **Capturable Savings**: baseline cost − optimized cost (EUR), using `computeWindowSavings()` with user's energy per session
- [ ] Displayed as a KPI tile: primary = market spread (ct/kWh), secondary = savings (EUR)
- [ ] Tooltip or sub-label shows cheapest and most expensive hours

### Weekend Spread
- [ ] Only active if the selected date is a **Friday** (day-of-week = 5)
- [ ] Window: Friday `plugInTime` → Monday `departureTime` (covers Fri eve + all day Sat + all day Sun + Mon early morning)
- [ ] **Market Spread**: max − min across all prices in window, in ct/kWh
- [ ] **Capturable Savings**: baseline cost − optimized cost (EUR), using same energy per session
- [ ] If selected day is NOT Friday: displays "N/A" with a note "Select a Friday to see weekend spread"
- [ ] If price data for Saturday, Sunday, or Monday is unavailable: displays "N/A — data not available"

### Weekly Spread
- [ ] Window: selected date `plugInTime` → day +7 `departureTime` (7 full rolling days)
- [ ] **Market Spread**: max − min across all prices in the 7-day window, in ct/kWh
- [ ] **Capturable Savings**: baseline cost − optimized cost (EUR) for the best session in the 7-day window
- [ ] If fewer than 4 days of data available: displays "N/A — insufficient data"
- [ ] Sub-label shows the date of the cheapest hour and the date of the most expensive hour

### 12-Month Historical Breakdown (Rolling 365 Days)
- [ ] For each of the trailing 365 calendar days (ending on the selected date), compute all three spread types (overnight, weekend, weekly) and their capturable savings
- [ ] Group by calendar month (YYYY-MM) → compute monthly averages
- [ ] Display as a bar chart (same layout as existing MonthlySavingsCard)
- [ ] **Dual metric**: each bar shows market spread (ct/kWh) with capturable savings (EUR) as a secondary value (tooltip or overlaid label)
- [ ] X-axis: month abbreviations; Y-axis: average spread in ct/kWh
- [ ] Tooltip per bar: month name, avg overnight spread, avg weekend spread (Fridays only), avg weekly spread, avg capturable savings (EUR), number of days included
- [ ] Projected-data months shown with a dashed border or muted colour (same convention as other charts)

### Display & Layout
- [ ] Indicators are grouped in a card titled "Spread Indicators"
- [ ] The three KPI values (Overnight, Weekend, Weekly) are shown as a horizontal row of stat tiles within the card
- [ ] The 12-month chart sits below the KPI row inside the same card
- [ ] The card is positioned in the dashboard after the existing Savings Potential Box
- [ ] All values update whenever the selected date or ChargingScenario changes

---

## Edge Cases

| Scenario | Expected Behaviour |
|---|---|
| Selected date is Saturday | Weekend Spread → N/A ("Select a Friday") |
| Price data missing for next-day morning | Overnight Spread → computed from available hours only; if < 2 hours available show N/A |
| 7-day window extends beyond available data | Weekly Spread → computed from available days; if < 4 days show "partial" label |
| All prices in window are equal (zero spread) | Show "0.0 ct/kWh" — not N/A |
| Negative prices in window (e.g. min < 0) | Include in spread calculation; spread = max − min can be > max if min is negative |
| Less than 6 months of historical data available | 12-month chart shows only available months; missing months shown as empty bar with "–" label |
| ChargingScenario.plugInTime changes | All three KPI indicators recalculate immediately (plugInTime affects window start) |

---

## Technical Notes (for Architecture)

- Spread calculations should live in `src/lib/charging-helpers.ts` as pure functions (no side effects)
- The weekly spread requires 8 days of price data to be loaded (7 days + morning of day 8)
- The 12-month chart reuses the price data already fetched for the existing MonthlySavingsCard — no additional API calls needed
- Weekend spread window: Friday `plugInTime`:00 → Monday `departureTime`:00 = up to ~62 hours of data
- Weekly spread window: Day 0 `plugInTime`:00 → Day 7 `departureTime`:00 = up to ~158 hours of data
- All windows use the user's `departureTime` from ChargingScenario as the end boundary
- Capturable savings use `computeWindowSavings()` from `charging-helpers.ts` with the user's energy per session and charge power

---

## Tech Design (Solution Architect)
_To be added by /architecture_

## QA Test Results
_To be added by /qa_

## Deployment
_To be added by /deploy_
