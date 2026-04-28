# PROJ-6: Password Protection

## Status: Removed
**Created:** 2025-02-21
**Updated:** 2026-04-28

## Summary

The dormant shared-password login and session-cookie implementation has been removed from the live runtime. The application no longer ships a login page, auth API, or JWT session helper.

## Removed Runtime Pieces

- Deleted `src/lib/auth.ts`
- Deleted `src/app/api/auth/route.ts`
- Deleted `src/app/login/page.tsx`

## Current Runtime State

- There is no password gate in the current Next.js App Router runtime
- There is no session cookie issued by the app
- `DASHBOARD_PASSWORD`, `AUTH_SECRET`, and `DASHBOARD_SESSION_SECRET` are no longer needed by the removed auth flow

## Follow-Up Outside This Task

- Remove or revise stale historical references in archived docs if those files should also stop mentioning the old password flow.

## Notes

- This document remains in place only as a feature-history record because `features/INDEX.md` still points at `PROJ-6`.
- If access control is reintroduced later, it should be specified as a new active feature rather than reviving the removed session-cookie design by default.
