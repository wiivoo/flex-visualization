# FlexMon Dashboard — Testing State

## Current Test Setup

**There are no tests.** The project has zero test files.

Verified by searching:
- `src/**/*.test.*` — no matches
- `src/**/*.spec.*` — no matches
- `tests/` directory — does not exist
- Root-level `*.test.*` — no matches

## Test Framework

None installed. The `package.json` devDependencies contain:
- `eslint` + `eslint-config-next` — linting only
- `playwright` — listed as a production dependency but no test scripts or spec files exist; likely installed for potential future use or scraping

No Jest, Vitest, Testing Library, or Cypress configuration exists.

## Coverage

Zero. There is no coverage tooling configured.

The `.gitignore` does include `/coverage`, indicating the slot was anticipated but never used.

## Available Scripts

```bash
npm run dev       # Development server
npm run build     # Production build (acts as a compile/lint check)
npm run lint      # ESLint (next/core-web-vitals ruleset only)
```

There is no `npm run test` script defined.

## What Acts as Quality Gates Today

1. **TypeScript** (`strict: true` in tsconfig) — catches type errors at compile time
2. **ESLint** (`next/core-web-vitals`) — catches React hook rules, accessibility issues
3. **`npm run build`** — full Next.js build fails loudly on type errors, missing imports, broken routes

## Testing Gaps

### Critical (pure logic, highly testable)
| File | Functions |
|------|-----------|
| `src/lib/charging-helpers.ts` | `computeWindowSavings`, `computeSpread`, `computeV2gWindowSavings`, `buildOvernightWindows`, `buildMultiDayWindow` |
| `src/lib/grid-fees.ts` | `getTarifzone`, `getGridFee`, `isModul3Active`, `calculateTotalCost`, `getDailyGridFees` |
| `src/lib/optimizer.ts` | Core slot-selection algorithm |

These functions are pure (no side effects, no I/O) and have well-defined inputs/outputs with financial correctness requirements — ideal unit test candidates.

### High Value (integration-level)
| Area | Gap |
|------|-----|
| Price conversion | EUR/MWh → ct/kWh pipeline (divide-by-10 rule) |
| Savings calculation | Baseline vs. optimized cost delta end-to-end |
| V2G optimizer | SoC constraints, chronological validation, dual value stream split |
| Date windowing | Overnight window construction across midnight, DST edge cases |

### UI Components
No component tests exist. Components are complex (MiniCalendar, DateStrip have significant calendar logic) but testing them requires a DOM environment and React Testing Library — not currently set up.

### API Routes
No API route tests. The batch price route (`src/app/api/prices/batch/route.ts`) and optimize route are untested.

## Recommendations

### To add tests (minimal setup)

1. Install Vitest (fast, native ESM, works with Next.js without extra config):
   ```bash
   npm install -D vitest @vitest/coverage-v8
   ```

2. Add to `package.json`:
   ```json
   "test": "vitest run",
   "test:watch": "vitest",
   "test:coverage": "vitest run --coverage"
   ```

3. Start with the pure lib functions — no mocking required:
   - `src/lib/grid-fees.ts` — deterministic, 100% coverable
   - `src/lib/charging-helpers.ts` — critical financial logic, complex V2G algorithm

4. For component tests, add:
   ```bash
   npm install -D @testing-library/react @testing-library/jest-dom jsdom
   ```

### Priority order
1. `grid-fees.ts` — small, deterministic, safety-critical (financial)
2. `charging-helpers.ts` — largest risk surface (V2G optimizer is ~200 lines of greedy algorithm)
3. `optimizer.ts` — core value-prop of the product
4. API route integration tests (use `next/test-utils` or MSW)
5. Component tests for calendar/date logic
