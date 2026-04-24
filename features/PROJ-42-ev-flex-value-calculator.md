# PROJ-42 - EV Flex Value Calculator

## Status

In Review

## Goal

Add a fast interactive calculator that turns the existing `/v2` price data and load-shifting logic into a commercial estimate surface with instant feedback.

## User Story

As a commercial or product user,
I want to adjust a few EV charging assumptions in one place
so I can quickly see an annual value estimate before going deeper into the full scenario analysis.

## Scope

- Add a dedicated route at `/v2/calculator`.
- Use a `/v2`-style two-column layout with sticky controls and live result cards.
- Reuse existing historical price data from `usePrices`.
- Add a focused calculator helper for annualized baseline-vs-optimized charging value.
- Show cross-year comparison for the same calculator profile.
- Provide explicit suggestions for how to leverage richer repo price data next.

## Out Of Scope

- New lead capture flows.
- Intraday / quarter-hour repricing in the first calculator version.
- New backend APIs.

## Acceptance Criteria

- The calculator updates live when mileage, frequency, window, market year, or charge power changes.
- The result shows annual savings, per-session savings, baseline cost, optimized cost, and captured spread.
- The page shows how the same profile performs across multiple historical years.
- The page can deep-link into `/v2` with the same scenario assumptions.
- The surface feels visually consistent with `/v2`, not like a separate product.
