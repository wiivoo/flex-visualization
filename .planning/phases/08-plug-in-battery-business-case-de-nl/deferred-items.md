# Phase 8 — Deferred Items

> Out-of-scope issues discovered during plan execution. Not fixed in this phase. Tracked here for future attention.

## 08-03 Execution

### `npm run build` requires Supabase env vars at page-data collection

- **Discovered during:** Task 1 verification (`npm run build`)
- **Symptom:** `Error: supabaseUrl is required.` from `/api/prices/batch` route during page-data collection.
- **Root cause:** `src/lib/supabase.ts` initializes the Supabase client at module import time using `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`, which are not present in the worktree environment.
- **Scope:** Pre-existing — unrelated to the shadcn select install. TypeScript compiles cleanly (`npx tsc --noEmit -p .` returns 0). The compilation phase of `next build` succeeds ("Compiled successfully"). The failure is at runtime data-collection, not at build/compile.
- **Why deferred:** Out of 08-03 scope (per Rule 4 — architectural/environment concern, not a bug in the task changes). Worktree agents commonly lack `.env.local`.
- **Evidence of non-relation:** `grep -r "from.*@/components/ui/select" src/` shows only archived files importing `select` — no active code depends on it, so the error cannot be caused by Task 1.
