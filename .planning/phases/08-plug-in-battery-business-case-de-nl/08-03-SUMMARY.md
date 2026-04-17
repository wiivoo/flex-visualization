---
phase: 08-plug-in-battery-business-case-de-nl
plan: 03
subsystem: shadcn / feature-tracking / requirements
tags: [shadcn, select, feature-spec, requirements, batt]
requires:
  - "@radix-ui/react-select (already pinned at ^2.2.6 in package.json)"
provides:
  - "src/components/ui/select.tsx — shadcn Select primitive, 10 exports"
  - "features/PROJ-39-plug-in-battery-business-case.md — Phase 8 feature spec"
  - "features/INDEX.md — PROJ-39 row + Next Available ID bumped to PROJ-40"
  - ".planning/REQUIREMENTS.md — BATT-01..BATT-11 + Traceability row"
affects:
  - "Wave 2/3 battery page + component work (BatteryVariantPicker, RegulationPanel now have Select available)"
tech_stack_added: []
patterns:
  - "shadcn-first UI primitive install (forwardRef + cn() + Radix wrappers)"
  - "feature tracking via features/INDEX.md + per-feature spec file"
  - "requirement IDs (BATT-XX) traced to phase in REQUIREMENTS.md Traceability table"
key_files:
  created:
    - "src/components/ui/select.tsx"
    - "features/PROJ-39-plug-in-battery-business-case.md"
    - ".planning/phases/08-plug-in-battery-business-case-de-nl/deferred-items.md"
  modified:
    - "features/INDEX.md"
    - ".planning/REQUIREMENTS.md"
decisions:
  - "shadcn CLI output accepted verbatim — do not hand-edit"
  - "PROJ-38 skipped (reserved for insights/quick-tasks work); Next Available ID = PROJ-40"
  - "Build-time Supabase env var failure is pre-existing and out-of-scope for 08-03 — logged in deferred-items.md"
metrics:
  duration_minutes: 3
  duration_seconds: 191
  tasks_completed: 3
  files_created: 3
  files_modified: 2
  commits: 3
  completed_date: "2026-04-17"
  start_time: "2026-04-17T11:34:23Z"
  end_time: "2026-04-17T11:37:34Z"
---

# Phase 08 Plan 03: Shadcn Select + PROJ-39 Feature Spec + BATT Requirements Summary

One-liner: Installed the shadcn Select primitive, registered PROJ-39 as the tracking feature for Phase 8, and seeded eleven BATT-XX requirements to trace the battery business case work.

## What Was Built

### Task 1 — shadcn Select primitive (commit `17c2ad0`)

Ran `npx shadcn@latest add select --yes`. The CLI created `src/components/ui/select.tsx` (160 lines) as a Radix-wrapped composition with 10 exported identifiers in a single `export { ... }` block:

- `Select`, `SelectGroup`, `SelectValue` (thin aliases of Radix primitives)
- `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton` (forwardRef-wrapped with `cn()` utility)

The `@radix-ui/react-select ^2.2.6` dependency was already declared in `package.json` (added by an earlier Phase 8 preparatory commit that scaffolded the shadcn additions index) — the CLI only needed to emit the component file, so `package.json` and `package-lock.json` did not change in this commit.

### Task 2 — PROJ-39 feature spec + INDEX registration (commit `4384fcb`)

Created `features/PROJ-39-plug-in-battery-business-case.md` (53 lines) mirroring the header style of PROJ-29:

- Status: In Progress, Owner: Lars, Phase: 8, Created: 2026-04-17
- Scope section: three product variants (Marstek Venus B, Anker SOLIX Solarbank 2 E1600 Pro, Marstek Venus E 3.0)
- Value streams: dynamic tariff arbitrage + balcony PV self-consumption
- Regulation: DE 800W cap, VDE-AR-N 4105:2026-03 export prohibition, 19%/0% VAT split; NL post-2027 regime, min 50% export compensation
- Out of scope: V2G, C&I, backup, NL pre-2027, DE grid export
- Files section listing `src/app/battery/page.tsx`, `src/components/battery/*`, `src/lib/battery-*.ts`, static profile JSON assets, precompute script
- Requirements link to `.planning/REQUIREMENTS.md` (BATT-01..BATT-11)

Updated `features/INDEX.md`:

- New row in Active Features table after PROJ-37: `PROJ-39 | Plug-in Battery Business Case (DE/NL) | In Progress | [spec](PROJ-39-plug-in-battery-business-case.md) | app/battery/, components/battery/, lib/battery-*.ts`
- Next Available ID bumped from PROJ-38 → PROJ-40 (PROJ-38 left reserved per plan instructions)
- No other rows touched

### Task 3 — BATT-01..BATT-11 in REQUIREMENTS.md (commit `cbaccfd`)

Inserted a new `### Battery Business Case (Phase 8)` subsection under Active Requirements (In Progress), immediately after the Intraday INTRA-05 line. Eleven unchecked requirements with phase tags:

| ID | Description |
|----|-------------|
| BATT-01 | Static profile JSON assets (BDEW H0 DE, NEDU E1a NL, PVGIS DE, PVGIS NL) |
| BATT-02 | Battery config types and variants |
| BATT-03 | Battery day optimizer with DE grid-export prohibition (`gridExportKwh = 0`) |
| BATT-04 | Battery annual roll-up (`runBatteryYear`) |
| BATT-05 | `/battery` page route with URL↔state sync |
| BATT-06 | BatteryVariantPicker component |
| BATT-07 | BatteryDayChart |
| BATT-08 | BatteryRoiCard |
| BATT-09 | RegulationPanel |
| BATT-10 | ManagementView |
| BATT-11 | Feature spec PROJ-39 + INDEX.md update |

Appended a Traceability row: `| BATT-01..11 | Phase 8 | In Progress |`. No existing requirement rows were modified.

## Acceptance Criteria — Verification Results

| Criterion | Result |
|-----------|--------|
| `src/components/ui/select.tsx` exists | ✓ (160 lines) |
| `@radix-ui/react-select` in package.json | ✓ (^2.2.6) |
| `SelectTrigger` / `SelectContent` / `SelectItem` grep count ≥ 2 | ✓ (3 each) |
| `SelectValue` grep count ≥ 2 | ✓ (2) |
| `npx tsc --noEmit -p .` exit code 0 | ✓ |
| Build compiles (`next build` "Compiled successfully") | ✓ |
| PROJ-39 spec file present with required header fields | ✓ |
| All three variant names present in PROJ-39 spec | ✓ |
| `BATT-01` reference in PROJ-39 spec | ✓ |
| PROJ-39 line count ≥ 40 | ✓ (53) |
| `PROJ-39` grep in INDEX.md ≥ 1 | ✓ (1) |
| `Next Available ID: PROJ-40` in INDEX.md | ✓ |
| `Next Available ID: PROJ-38` removed | ✓ |
| `**BATT-0[1-9]**` grep count ≥ 9 in REQUIREMENTS.md | ✓ (9) |
| `**BATT-1[01]**` grep count ≥ 2 in REQUIREMENTS.md | ✓ (2) |
| `Battery Business Case (Phase 8)` section | ✓ (1) |
| `gridExportKwh = 0` string preserved | ✓ (1) |
| Traceability row appended | ✓ |
| V2G-01 unchanged (grep ≥ 2) | ✓ (2) |
| DATA-01 unchanged (grep ≥ 2) | ✓ (2) |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 — Scope boundary] Pre-existing `npm run build` Supabase env failure**

- **Found during:** Task 1 verification (`npm run build 2>&1 | tail -30`)
- **Issue:** `next build` compiled TypeScript successfully ("Compiled successfully in 2.7s") but failed during page-data collection with `Error: supabaseUrl is required.` from `/api/prices/batch`. The error originates in `src/lib/supabase.ts` which initializes the Supabase client at module import time from `NEXT_PUBLIC_SUPABASE_URL`.
- **Determination:** Pre-existing environment issue. The worktree has no `.env.local`. The error is unrelated to the shadcn select install — only archived files import `@/components/ui/select`, so the select primitive is not on the runtime path at all. `npx tsc --noEmit -p .` returns 0 cleanly.
- **Action:** Logged to `.planning/phases/08-plug-in-battery-business-case-de-nl/deferred-items.md` per scope-boundary rule. Did NOT attempt to fix (would require adding env vars, outside 08-03 scope).
- **Files logged:** `.planning/phases/08-plug-in-battery-business-case-de-nl/deferred-items.md`

### Scope Notes

- The plan's acceptance criterion `grep -c 'export' src/components/ui/select.tsx returns at least 8` evaluates to 1 because shadcn emits all 10 exports inside a single `export { ... }` block. The intent of the criterion (≥ 8 named exports) is satisfied: `Select`, `SelectGroup`, `SelectValue`, `SelectTrigger`, `SelectContent`, `SelectLabel`, `SelectItem`, `SelectSeparator`, `SelectScrollUpButton`, `SelectScrollDownButton`. The plan explicitly states "DO NOT edit the shadcn output — the shadcn CLI is canonical", so the export style was preserved. No deviation applied; flagging here for transparency.

## Known Stubs

None. No hardcoded UI-facing empty arrays, placeholder text, or TODOs introduced. The new select primitive is a library component (no business data); the PROJ-39 spec is markdown documentation; the REQUIREMENTS.md entries are all unchecked items correctly reflecting not-yet-built state.

## Commits

| Task | Hash | Message |
|------|------|---------|
| 1 | `17c2ad0` | feat(08-03): install shadcn select primitive |
| 2 | `4384fcb` | docs(PROJ-39): create feature spec and register in INDEX.md |
| 3 | `cbaccfd` | docs(08-03): add BATT-01..BATT-11 requirements for Phase 8 |

## Self-Check: PASSED

- `src/components/ui/select.tsx`: present
- `features/PROJ-39-plug-in-battery-business-case.md`: present
- `.planning/phases/08-plug-in-battery-business-case-de-nl/deferred-items.md`: present
- commit `17c2ad0`: present in `git log`
- commit `4384fcb`: present in `git log`
- commit `cbaccfd`: present in `git log`
