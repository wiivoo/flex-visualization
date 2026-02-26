# PROJ-24: Weekday/Weekend Charging Split

**Status:** Deployed
**Created:** 2026-02-26

## Description

Replaces the single `weeklyPlugIns` (1–7) slider with a weekday/weekend split, reflecting that commuters charge primarily on weekdays with different weekend patterns.

## Files Modified

| File | Change |
|------|--------|
| `src/lib/v2-config.ts` | `weekdayPlugIns` + `weekendPlugIns` fields, `totalWeeklyPlugIns()` helper, updated `deriveEnergyPerSession()` |
| `src/lib/charging-helpers.ts` | `isWeekend: boolean` on `OvernightWindow`, computed via `getUTCDay()` |
| `src/components/v2/steps/Step2ChargingScenario.tsx` | Two sliders, split savings computation, day block visual |
| `src/components/v2/MiniCalendar.tsx` | Weekend column headers with `bg-gray-50` tint |
| `src/components/v2/MonthlySavingsCard.tsx` | Tooltip shows weekday/weekend savings breakdown |
| `src/components/v2/SavingsHeatmap.tsx` | Uses `weekdayPlugIns + weekendPlugIns` |
| `src/app/v2/page.tsx` | URL params: `plugins_wd`, `plugins_we` with backward compat |

## Savings Computation

Monthly savings are weighted by day type:
- **Weekday scale** = `weekdayPlugIns / 5` (fraction of weekdays the user plugs in)
- **Weekend scale** = `weekendPlugIns / 2` (fraction of weekend days)
- Monthly savings = `weekdayAvgSavings × weekdayScale × 21.74` + `weekendAvgSavings × weekendScale × 8.70`
- 21.74 = average weekdays/month, 8.70 = average weekend days/month

## Type Changes

```typescript
interface ChargingScenario {
  weekdayPlugIns: number   // 0-5 (Mon-Fri)
  weekendPlugIns: number   // 0-2 (Sat-Sun)
  chargePowerKw: number    // 7 or 11
  chargingMode: 'overnight' | 'fullday'
  // ... other fields unchanged
}
```

## Calendar Weekend Styling

- Sa/Su column headers: `bg-gray-50 rounded-t`
- Weekend day cells: `bg-gray-50` background computed via `getUTCDay()`
- Subtle, not distracting — matches real calendar conventions
