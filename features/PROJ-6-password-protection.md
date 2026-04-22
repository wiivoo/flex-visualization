# PROJ-6: Password Protection

## Status: Dormant
**Created:** 2025-02-21
**Last Reviewed:** 2026-04-21

## Summary

The repository still contains authentication primitives, but password protection is not active in the current runtime. This spec was rewritten to reflect the current codebase after the middleware-based protection layer was removed.

## Current Runtime State

- `src/lib/auth.ts` still provides JWT session creation and verification helpers
- `src/app/api/auth/route.ts` still exposes login/logout endpoints
- `src/app/login/page.tsx` currently redirects to `/v2`
- There is no runtime route-guard layer in the current tree, and the app does not enforce route protection at runtime

## What Exists Today

- Single-password auth model based on `DASHBOARD_PASSWORD`
- HTTP-only session cookie named `flexmon-session`
- Basic in-memory rate limiting on `POST /api/auth`
- Logout endpoint via `DELETE /api/auth`

## What Is Missing For A Shipped Feature

- A real login screen instead of a redirect-only `/login` page
- Runtime route enforcement for protected pages
- An app-level session check wired into the current Next.js App Router flow
- Updated QA coverage for the non-middleware architecture

## Files

- `src/app/login/page.tsx`
- `src/app/api/auth/route.ts`
- `src/lib/auth.ts`

## Notes

- Historical references to the deleted route-guard layer were removed from this spec so the document matches the current tree.
- Keep this feature documented as `Dormant` until login is reintroduced into the actual runtime.
