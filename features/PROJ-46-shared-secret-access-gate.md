# PROJ-46 - Shared-Secret Access Gate

## Status: In Review
**Created:** 2026-05-07

## Summary

Add a lightweight shared-secret access gate for limited internal/prep access when Entra, email verification, and database-backed user accounts are unavailable.

This is not Entra/SSO and does not identify individual users. It grants access to anyone who possesses the shared magic access link.

## Runtime Behavior

- In production, missing `ACCESS_TOKEN` or `SESSION_SECRET` fails closed: app and API URLs return an empty `404`.
- In local development, when both env vars are absent, the gate is disabled so normal development remains open.
- When both env vars are present, normal app URLs require a valid signed session cookie.
- Requests without a valid cookie return an empty `404`.
- Opening `/access/<ACCESS_TOKEN>` validates the shared token, sets a `Secure`, `HttpOnly`, `SameSite=Lax` session cookie, and redirects to `/v2`.
- `/access/<ACCESS_TOKEN>?next=/some-path` redirects to the supplied relative path after setting the cookie.
- The session cookie is stateless and expires after 90 days.
- `/logout` clears the session cookie.

## Required Server Environment Variables

- `ACCESS_TOKEN` - long random token embedded in the private magic link
- `SESSION_SECRET` - long random server-only secret used to sign and verify the session cookie

Do not commit either value to the repo.

## Revocation

- Rotate `ACCESS_TOKEN` to stop new access grants from the old magic link.
- Rotate `SESSION_SECRET` to invalidate all existing session cookies immediately.

## Acceptance Criteria

- [x] With no access-gate env vars, production fails closed with `404`.
- [x] With no access-gate env vars, local development remains open.
- [x] With access-gate env vars present, app and API URLs without a valid cookie return `404`.
- [x] A valid `/access/<ACCESS_TOKEN>` request sets a signed 90-day session cookie and redirects to `/v2`.
- [x] A valid signed session cookie allows subsequent normal app URLs without the magic link.
- [x] Invalid access tokens return `404` and do not set a session cookie.
- [x] Session cookies are signed, `HttpOnly`, `Secure`, `SameSite=Lax`, path-scoped to `/`, and stateless.

## Key Files

- `src/proxy.ts`
