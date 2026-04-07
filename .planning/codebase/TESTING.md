# Testing Patterns

**Analysis Date:** 2026-04-07

## Test Framework

**Runner:**
- Vitest 4.1.2 (devDependency)
- Config: `vitest.config.ts`

**Assertion Library:**
- Vitest built-in (`expect`, `describe`, `test`)
- Globals enabled (`globals: true` in config)

**Run Commands:**
```bash
npx vitest                # Run all tests (watch mode)
npx vitest run            # Run once (CI mode)
npx vitest run --coverage # Coverage (no coverage provider configured)
```

**Note:** No `test` script in `package.json` — tests run via `npx vitest` directly.

## Configuration

**`vitest.config.ts`:**
```typescript
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    globals: true,
  },
})
```

- Path alias `@/` configured to match `tsconfig.json`
- Default `node` environment (no jsdom)
- No setup files, no coverage thresholds

## Test File Organization

**Location:** Separate `tests/` directory at project root (not co-located)

**Current test files:**
- `tests/savings-math.test.ts` (710 lines) — comprehensive math tests for the savings calculation pipeline

**Naming:** `<domain>.test.ts`

**New test file placement:** `tests/<module-name>.test.ts`

## Test Structure

**Suite Organization — numbered sections with describe/test:**
```typescript
/* ═══════════════════════════════════════════════════════════════════ */
/* 1. deriveEnergyPerSession                                          */
/* ═══════════════════════════════════════════════════════════════════ */

describe('deriveEnergyPerSession', () => {
  test('basic: 12000 km/yr, 2 weekday + 0 weekend = 2/wk', () => {
    const eps = deriveEnergyPerSession(12000, 2, 0)
    // 12000 / (2*52) = 115.38 km/session → 115.38/100 * 19 = 21.9 kWh
    expect(eps).toBeCloseTo(21.9, 1)
  })

  test('more plug-ins = less energy per session (fixed mileage)', () => {
    const eps2 = deriveEnergyPerSession(12000, 2, 0)
    const eps4 = deriveEnergyPerSession(12000, 4, 0)
    expect(eps2).toBeGreaterThan(eps4)
  })
})
```

**Conventions:**
- Top-level `describe` per function/module under test
- Numbered `/* === */` block comment headers for visual separation
- Descriptive test names with colons: `'basic: 12000 km/yr, 2 weekday + 0 weekend = 2/wk'`
- Inline comments explaining expected math
- Each test is self-contained — no `beforeEach`/`afterEach`
- No setup/teardown files

## Test Helpers

**Defined at top of test file (`tests/savings-math.test.ts`):**

```typescript
/** Build a synthetic HourlyPrice array for a single overnight window */
function makeWindow(
  prices: number[],     // ct/kWh for each hour
  startHour: number,
  date: string = '2026-03-15',
): HourlyPrice[] {
  // Creates HourlyPrice[] with correct date wrapping for overnight windows
  // Automatically handles next-day date for hours wrapping past midnight
}

/** Build PricePoint array for runOptimization (15-min intervals) */
function makePricePoints(
  hourlyPrices: number[],
  startHour: number,
  date: string = '2026-03-15',
): PricePoint[] {
  // Expands hourly prices into quarter-hourly PricePoints
}

const EPSILON = 0.01 // tolerance for floating point
```

## What Is Tested

**`tests/savings-math.test.ts` — 8 test suites, ~46 tests:**

1. **`deriveEnergyPerSession`** (7 tests) — `src/lib/v2-config.ts`
   - Mileage/frequency to kWh conversion
   - Scaling, rounding, energy conservation invariant
   - Edge: zero plug-ins (division guard)

2. **`computeWindowSavings`** (8 tests) — `src/lib/charging-helpers.ts`
   - Flat prices (zero savings), simple spread, single/all slots
   - EUR formula verification, non-negative savings invariant
   - Quarter-hourly mode, energy scaling

3. **`computeSpread`** (5 tests) — `src/lib/charging-helpers.ts`
   - Market spread, capturable vs market relationship
   - Consistency with `computeWindowSavings`, null for <2 points
   - Cheapest/most expensive hour labels

4. **`computeV2gWindowSavings`** (8 tests) — `src/lib/charging-helpers.ts`
   - Empty input, load shifting vs arbitrage separation
   - SoC constraints, energy accounting
   - Degradation and efficiency impact
   - Invariant: `profitEur = loadShiftingBenefitEur + arbitrageUpliftEur`

5. **`runOptimization`** (7 tests) — `src/lib/optimizer.ts`
   - Cheapest-slot selection, energy calculation
   - Zero energy, flat prices, savings formula
   - Overnight window wrapping, customer benefit split

6. **Monthly aggregation math** (3 tests)
   - Weekly savings from weekday/weekend averages
   - Plug-in frequency vs energy tradeoff
   - Monthly scale formula cross-check

7. **`buildOvernightWindows`** (3 tests) — `src/lib/charging-helpers.ts`
   - Window construction, sorted prices, weekend detection

8. **Edge cases & invariants** (5 tests)
   - Negative prices, energy exceeding slots
   - Single price point, unit consistency
   - Energy conservation across parameter combos

## What Is NOT Tested

**No test coverage for these modules:**

| Module | File | Risk |
|--------|------|------|
| Grid fees | `src/lib/grid-fees.ts` | Pure, easily testable, financial correctness |
| Fleet optimizer | `src/lib/fleet-optimizer.ts` | Complex scheduling logic |
| Price hook | `src/lib/use-prices.ts` | Data fetching, caching, error states |
| SMARD client | `src/lib/smard.ts` | API response parsing |
| ENTSO-E client | `src/lib/entsoe.ts` | API response parsing |
| Excel export | `src/lib/excel-export.ts` | Spreadsheet generation |
| Auth | `src/lib/auth.ts` | JWT creation/validation |
| API routes | `src/app/api/*/route.ts` | Request handling, validation |
| React components | `src/components/v2/*.tsx` | UI rendering, interactions |
| URL parsing | `parseScenario()` in `src/app/v2/page.tsx` | User input parsing |

## Mocking

**Currently:** No mocking used. All tested functions are pure (no I/O).

**For future tests requiring mocking:**
- API route tests: mock fetch/Supabase client
- Component tests: need `@testing-library/react` + `jsdom` environment
- Hook tests: need `renderHook` from testing-library

## Assertion Patterns

**Floating point — use `toBeCloseTo`:**
```typescript
expect(r.bAvg).toBeCloseTo(11, 1)        // 1 decimal precision
expect(r.savingsEur).toBeCloseTo(1.12, 2) // 2 decimal precision
```

**Comparison assertions:**
```typescript
expect(r.savingsEur).toBeGreaterThanOrEqual(0)
expect(rHighEff.arbitrageUpliftEur).toBeGreaterThanOrEqual(rLowEff.arbitrageUpliftEur)
```

**Invariant checking — verify mathematical relationships:**
```typescript
expect(r.profitEur).toBeCloseTo(r.loadShiftingBenefitEur + r.arbitrageUpliftEur, 2)
expect(r.totalChargedKwh).toBe(r.chargeSlots.length * kwhPerSlot)
```

**Null/edge cases:**
```typescript
expect(computeSpread(win, 7, 7, 1)).toBeNull()
expect(r.energy_charged_kwh).toBe(0)
```

## Coverage

**Requirements:** None enforced — no coverage thresholds configured
**Coverage provider:** Not installed (would need `@vitest/coverage-v8`)

**Estimated coverage by module:**
- `src/lib/charging-helpers.ts` — high (all exported functions tested)
- `src/lib/v2-config.ts` — partial (`deriveEnergyPerSession` tested, other functions not)
- `src/lib/optimizer.ts` — moderate (`runOptimization` tested)
- All other modules — zero

## Quality Gates (non-test)

1. **TypeScript** (`strict: true`) — type errors at compile time
2. **ESLint** (`next/core-web-vitals`) — React hook rules, accessibility
3. **`npm run build`** — Next.js build fails on type errors, missing imports

## E2E Tests

- `playwright` ^1.58.2 is in production dependencies but no test files or config exist
- No `playwright.config.ts`
- Likely installed for scraping purposes, not testing

## Adding New Tests

**New unit test for a pure lib function:**
1. Create `tests/<module-name>.test.ts`
2. Import from `@/lib/<module>` (path alias works via vitest config)
3. `describe`/`test`/`expect` available globally (no import needed)
4. Use `makeWindow()` or `makePricePoints()` helpers for price data (copy from `savings-math.test.ts` or extract to shared helper)

**Priority candidates for new tests:**
1. `src/lib/grid-fees.ts` — small, deterministic, financial correctness
2. `src/lib/fleet-optimizer.ts` — complex scheduling, high business value
3. `src/app/v2/page.tsx` `parseScenario()` — URL input parsing edge cases

**Missing infrastructure for component tests:**
- Install: `npm install -D @testing-library/react @testing-library/jest-dom jsdom`
- Update vitest config: `test: { environment: 'jsdom' }`

---

*Testing analysis: 2026-04-07*
